import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = Number(process.env.LYRICS_LIVE_TEST_PORT || 8107);
const origin = `http://127.0.0.1:${port}`;
const output = process.env.LYRICS_TEST_OUTPUT || 'test-results/live-display';
await mkdir(output, { recursive: true });

function wave(seconds = 30) {
  const samples = 8000 * seconds;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) bytes.writeInt16LE(Math.round(Math.sin(index / 8000 * Math.PI * 880) * 1500), 44 + index * 2);
  return bytes;
}

function readySong(id, title, { backing = '' } = {}) {
  return {
    schemaVersion: 1, id, title, artist: 'Школа', version: 'Проверочная версия', language: 'ru', duration: 30,
    delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' },
    ...(backing ? { backing: { fileName: backing } } : {}),
    cues: [
      { id: `${id}-a`, start: .2, text: `${title}: первая строка`, type: 'lyric' },
      { id: `${id}-b`, start: 10, text: `${title}: вторая строка`, type: 'lyric' },
      { id: `${id}-c`, start: 22, text: `${title}: финальная строка`, type: 'lyric' },
    ],
  };
}

const server = spawn(process.execPath, ['tools/serve.mjs'], {
  env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe',
});
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(origin + '/lyrics/')).ok) break; } catch {}
    if (attempt === 39) throw new Error('Preview server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/lyrics/');
  await page.waitForSelector('#editor h1');

  const readyOne = readySong('live-one', 'Открытие');
  const readyTwo = readySong('live-two', 'Финал');
  const unready = { ...readySong('live-draft', 'Черновик'), reviewed: false };
  const localSet = { schemaVersion: 1, id: 'live-display', name: 'Концерт показа', songs: [readyOne, readyTwo, unready] };
  await page.locator('#set-file').setInputFiles({ name: 'live.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(localSet)) });
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 3);
  console.log('live-display: imported initial songs');

  await page.evaluate(async audio => {
    const storage = await import('./storage.js');
    const set = await storage.loadSet();
    const song = set.songs[0];
    song.source = { kind: 'manual', fileName: 'original.wav' };
    await storage.saveSet(set);
    await storage.putAudio(song.id, new Blob([new Uint8Array(audio)], { type: 'audio/wav' }));
  }, [...wave()]);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 3);
  await page.locator('.song-select').first().click();

  // TL-AC37: LRCLIB is the default; LRC and plain-text drafts remain separate and the original preview stays available.
  assert.equal(await page.locator('#lrclib-tab').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#original-file').count(), 0, 'original upload is hidden');
  assert.equal(await page.getByRole('button', { name: /Распознать MP3|Рассчитать время по тексту/ }).count(), 0, 'recognition controls are hidden');
  await page.waitForFunction(() => document.querySelector('.text-reference audio')?.readyState >= 1);
  await page.locator('.text-reference audio').evaluate(player => { player.currentTime = 3; });
  await page.locator('#lrc-tab').click();
  await page.locator('#lrc-panel textarea').fill('[00:00.20]Черновой LRC остаётся');
  await page.locator('#plain-tab').click();
  await page.locator('#plain-panel textarea').fill('Отдельный черновик чистого текста');
  await page.locator('#lrclib-tab').click();
  await page.locator('#lrc-tab').click();
  assert.equal(await page.locator('#lrc-panel textarea').inputValue(), '[00:00.20]Черновой LRC остаётся');
  await page.locator('#plain-tab').click();
  assert.equal(await page.locator('#plain-panel textarea').inputValue(), 'Отдельный черновик чистого текста');
  await page.locator('#lrclib-tab').click();
  assert.ok(Math.abs(await page.locator('.text-reference audio').evaluate(player => player.currentTime) - 3) < .15, 'tab switch keeps original preview position');
  console.log('live-display: preparation tabs');

  // A separate backing file invalidates readiness, while the original remains independently selected.
  await page.locator('#backing-file').setInputFiles({ name: 'backing.wav', mimeType: 'audio/wav', buffer: wave() });
  await page.waitForFunction(() => document.querySelector('.backing-card .file-name')?.textContent.includes('backing.wav'));
  assert.equal(await page.locator('.status-pill').textContent(), 'Нужно проверить');
  assert.equal(await page.locator('.text-reference audio').count(), 1, 'backing upload does not replace original preview');
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click();
  assert.equal(await page.locator('.status-pill').textContent(), 'Готова');
  console.log('live-display: backing and readiness');

  // TL-AC28/29: the backing follows the timeline; progress, mute, emphasis and keys are interactive.
  await page.getByRole('button', { name: 'Режим показа', exact: true }).click();
  await page.waitForSelector('#event-view:not([hidden])');
  assert.equal(await page.locator('#highlight-current').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#event-progress').getAttribute('max'), '30');
  assert.equal(await page.locator('#event-mute').isHidden(), false);
  assert.equal(await page.locator('#event-mute').isEnabled(), true, 'backing audio enables sound control');
  await page.locator('#event-start').click();
  await page.waitForSelector('#event-player', { state: 'attached' });
  await page.waitForTimeout(1200);
  const startState = await page.evaluate(() => {
    const player = document.querySelector('#event-player');
    return {
      status: document.querySelector('#event-audio-status')?.textContent,
      start: { disabled: document.querySelector('#event-start')?.disabled, label: document.querySelector('#event-start')?.getAttribute('aria-label') },
      progress: document.querySelector('#event-progress')?.value,
      player: player && { paused: player.paused, readyState: player.readyState, duration: player.duration, currentTime: player.currentTime, error: player.error?.message, ended: player.ended },
    };
  });
  assert.ok(startState.player.currentTime > 0, JSON.stringify(startState));
  console.log('live-display: event audio started');
  // TL-AC40: pause freezes backing audio and timeline; Start resumes in place.
  assert.equal(startState.start.label, 'Пауза');
  await page.locator('#event-start').click();
  assert.equal(await page.locator('#event-start').getAttribute('aria-label'), 'Старт');
  const paused = Number(await page.locator('#event-progress').inputValue());
  assert.equal(await page.locator('#event-player').count(), 0, 'pause releases the stopped audio');
  await page.waitForTimeout(300);
  assert.equal(Number(await page.locator('#event-progress').inputValue()), paused);
  await page.locator('#event-start').click();
  await page.waitForFunction(position => {
    const player = document.querySelector('#event-player');
    return player && !player.paused && player.currentTime > position;
  }, paused);
  assert.equal(await page.locator('#event-start').getAttribute('aria-label'), 'Пауза');
  await page.locator('#event-mute').click();
  assert.equal(await page.locator('#event-mute').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#event-player').evaluate(player => player.muted), true);
  const beforeMutePosition = await page.locator('#event-player').evaluate(player => player.currentTime);
  await page.waitForTimeout(180);
  assert.ok(await page.locator('#event-player').evaluate((player, before) => player.currentTime >= before, beforeMutePosition), 'mute keeps audio running');
  assert.ok(await page.evaluate(() => Math.abs(Number(document.querySelector('#event-progress').value) - document.querySelector('#event-player').currentTime) < .25), 'audio and progress agree within 250 ms');

  await page.locator('#highlight-current').click();
  assert.equal(await page.locator('#highlight-current').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#audience').evaluate(element => element.classList.contains('no-highlight')), true);
  await page.locator('#event-progress').evaluate(input => { input.value = '12'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => Math.abs(document.querySelector('#event-player').currentTime - 12) < .35);
  await page.waitForFunction(() => {
    const styles = [...document.querySelectorAll('.audience-line:not(.rest):not(.neutral)')].map(line => { const s = getComputedStyle(line); return [s.color, s.opacity, s.fontWeight, s.transform].join('|'); });
    return new Set(styles).size === 1;
  });

  // TL-AC47: the icon row follows the timeline and stays inside common viewport widths.
  for (const width of [1920, 1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const row = await page.evaluate(() => {
      const panel = document.querySelector('#event-controls');
      const timeline = document.querySelector('#event-progress').getBoundingClientRect();
      const controls = ['#event-start', '#event-reset', '#fullscreen', '#event-mute', '#highlight-current']
        .map(selector => document.querySelector(selector))
        .filter(button => button && getComputedStyle(button).display !== 'none')
        .map(button => ({ rect: button.getBoundingClientRect().toJSON(), icon: Boolean(button.querySelector('svg')), label: button.getAttribute('aria-label'), tooltip: button.getAttribute('data-tooltip') }));
      return { width: innerWidth, panel: { left: panel.getBoundingClientRect().left, right: panel.getBoundingClientRect().right, client: panel.clientWidth, scroll: panel.scrollWidth }, timeline: timeline.toJSON(), controls };
    });
    assert.ok(row.panel.left >= 0 && row.panel.right <= width + 1 && row.panel.scroll <= row.panel.client + 1, JSON.stringify(row));
    assert.ok(row.controls.every(control => control.rect.left >= 0 && control.rect.right <= width + 1 && control.icon && control.label && control.tooltip), JSON.stringify(row));
    assert.ok(row.controls[0].rect.left >= row.timeline.right - 1, `icons follow timeline at ${width}px: ${JSON.stringify(row)}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // TL-AC49: Space controls playback on focused display buttons exactly once.
  await page.locator('#event-start').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#event-start').getAttribute('aria-label'), 'Старт', 'Space pauses once when Start/Pause has focus');
  const focusedFontBeforeSpace = await page.locator('#audience-lines').evaluate(lines => Number.parseFloat(getComputedStyle(lines).fontSize));
  await page.locator('#font-up').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#event-start').getAttribute('aria-label') === 'Пауза');
  assert.equal(await page.locator('#audience-lines').evaluate(lines => Number.parseFloat(getComputedStyle(lines).fontSize)), focusedFontBeforeSpace, 'Space on a focused display button controls playback without activating that button');
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), false, 'Space on the focused font button does not open the library');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#audience-lines').evaluate(lines => Number.parseFloat(getComputedStyle(lines).fontSize)), focusedFontBeforeSpace + 4, 'Enter still activates the focused font button');
  await page.locator('#audience').click();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#event-start').getAttribute('aria-label') === 'Старт');
  assert.equal(await page.locator('#event-start').getAttribute('aria-label'), 'Старт', 'Space pauses from display content');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('#event-start').getAttribute('aria-label') === 'Пауза');
  assert.equal(await page.locator('#event-start').getAttribute('aria-label'), 'Пауза', 'Space resumes from display content');
  const muteBeforeShortcut = await page.locator('#event-mute').getAttribute('aria-pressed');
  await page.keyboard.press('m');
  assert.notEqual(await page.locator('#event-mute').getAttribute('aria-pressed'), muteBeforeShortcut, 'M toggles backing mute');
  const emphasisBeforeShortcut = await page.locator('#highlight-current').getAttribute('aria-pressed');
  await page.keyboard.press('c');
  assert.notEqual(await page.locator('#highlight-current').getAttribute('aria-pressed'), emphasisBeforeShortcut, 'C toggles current-line emphasis');
  await page.keyboard.press('c');
  assert.equal(await page.locator('#highlight-current').getAttribute('aria-pressed'), emphasisBeforeShortcut, 'restore emphasis for the song-switch persistence check');
  const guardedMute = await page.locator('#event-mute').getAttribute('aria-pressed');
  await page.keyboard.press('Control+m');
  assert.equal(await page.locator('#event-mute').getAttribute('aria-pressed'), guardedMute, 'modifier shortcuts do not toggle mute');
  await page.locator('#audience').evaluate(audience => audience.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true, repeat: true })));
  assert.equal(await page.locator('#event-mute').getAttribute('aria-pressed'), guardedMute, 'auto-repeated keydown does not toggle mute');
  await page.screenshot({ path: output + '/desktop-display.png' });
  const beforeUp = Number(await page.locator('#event-progress').inputValue());
  await page.locator('#event-progress').press('ArrowUp');
  await page.waitForFunction(before => Math.abs(Number(document.querySelector('#event-progress').value) - (before - 5)) < .25, beforeUp);
  const beforeDown = Number(await page.locator('#event-progress').inputValue());
  await page.locator('#event-progress').press('ArrowDown');
  await page.waitForFunction(before => Math.abs(Number(document.querySelector('#event-progress').value) - (before + 5)) < .25, beforeDown);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) >= 16.5);
  await page.locator('#event-progress').evaluate(input => { input.value = '30'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.querySelector('#event-elapsed').textContent === '0:30');
  await page.locator('#event-progress').press('ArrowUp');
  await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) <= 25.1);
  await page.locator('#event-reset').click();
  assert.equal(await page.locator('#event-player').count(), 0, 'reset stops and removes backing player');
  assert.equal(await page.locator('#event-progress').inputValue(), '0');
  console.log('live-display: timeline controls');

  // TL-AC30: display navigation preserves playback while open, blocks unready songs, and returns focus.
  await page.locator('#event-start').click();
  await page.waitForSelector('#event-player', { state: 'attached' });
  await page.locator('#event-menu-toggle').click();
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true);
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.matches(':modal')), false, 'library popup is nonmodal');
  assert.equal(await page.locator('#event-menu-songs button').count(), 3);
  assert.equal(await page.getByRole('button', { name: /Черновик.*нужна подготовка/ }).isDisabled(), true);
  assert.ok(await page.locator('#event-player').evaluate(player => !player.paused), 'opening menu does not pause playback');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#event-menu').open);
  await page.locator('#event-start').click();
  assert.equal(await page.locator('#event-player').count(), 0, 'test pauses and releases audio before reopening the library');
  await page.locator('#event-progress').evaluate(input => {
    input.value = '5'; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) === 5);
  await page.keyboard.press('l');
  await page.waitForFunction(() => document.querySelector('#event-menu').open);
  await page.keyboard.press('l');
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true, 'L opens the library popup and a repeated L leaves it open');
  assert.equal(await page.locator('#event-song-name').textContent(), 'Открытие', 'opening the library does not change the selected song');

  // Space must be wholly inert while the popup is open, including native button activation.
  const menuSong = name => page.getByRole('button', { name, exact: true });
  const selectedWhileMenuOpen = await page.locator('#event-song-name').textContent();
  const player = page.locator('#event-player');
  assert.equal(await player.count(), 0, 'paused Space case starts with released audio at a nonzero position');
  const pausedPosition = await page.locator('#event-progress').inputValue();
  await menuSong('Открытие').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true, 'Space on the current ready song does not close the popup');
  assert.equal(await page.locator('#event-song-name').textContent(), selectedWhileMenuOpen, 'Space does not activate the current song button');
  assert.equal(await page.locator('#event-progress').inputValue(), pausedPosition, 'Space leaves a paused nonzero timeline exactly unchanged');
  assert.equal(await player.count(), 0, 'Space does not resume paused playback');
  await menuSong('Финал').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true, 'Space on another ready song does not close the popup');
  assert.equal(await page.locator('#event-song-name').textContent(), selectedWhileMenuOpen, 'Space does not select another ready song');
  assert.equal(await page.locator('#event-progress').inputValue(), pausedPosition, 'Space does not reset the paused timeline');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#event-menu').open);
  await page.locator('#event-start').click();
  await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > 5.1);
  await page.keyboard.press('l');
  await page.waitForFunction(() => document.querySelector('#event-menu').open);
  const runningPosition = Number(await page.locator('#event-progress').inputValue());
  await menuSong('Финал').focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  const runningAfterSpace = Number(await page.locator('#event-progress').inputValue());
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true, 'Space does not close the popup while playback runs');
  assert.equal(await page.locator('#event-song-name').textContent(), selectedWhileMenuOpen, 'Space does not select another song while playback runs');
  assert.equal(await player.evaluate(audio => audio.paused), false, 'Space does not pause running playback');
  assert.ok(runningAfterSpace > runningPosition && runningAfterSpace < runningPosition + 2, `Space does not reset or restart the running timeline: ${runningPosition} -> ${runningAfterSpace}`);

  for (const selector of ['#event-menu-close', '#event-menu-toggle']) {
    await page.locator(selector).focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true, `Space does not activate ${selector} while the library is open`);
    assert.equal(await page.locator('#event-song-name').textContent(), selectedWhileMenuOpen);
    assert.equal(await player.evaluate(audio => audio.paused), false, `Space on ${selector} does not pause playback`);
  }
  const muteBeforeMenuShortcut = await page.locator('#event-mute').getAttribute('aria-pressed');
  await page.keyboard.press('m');
  assert.equal(await page.locator('#event-mute').getAttribute('aria-pressed'), muteBeforeMenuShortcut, 'shortcuts are ignored while the library popup is open');
  const desktopPopup = await page.evaluate(() => {
    const menu = document.querySelector('#event-menu').getBoundingClientRect();
    const trigger = document.querySelector('#event-menu-toggle').getBoundingClientRect();
    return { menu: menu.toJSON(), trigger: trigger.toJSON(), viewport: { width: innerWidth, height: innerHeight } };
  });
  assert.ok(desktopPopup.menu.left >= 0 && desktopPopup.menu.right <= desktopPopup.viewport.width && desktopPopup.menu.top >= 0 && desktopPopup.menu.bottom <= desktopPopup.viewport.height, JSON.stringify(desktopPopup));
  assert.ok(Math.abs(desktopPopup.menu.left - desktopPopup.trigger.left) < 120 && Math.abs(desktopPopup.menu.top - desktopPopup.trigger.bottom) < 120, `popup is anchored beside its trigger: ${JSON.stringify(desktopPopup)}`);
  await page.setViewportSize({ width: 375, height: 740 });
  const narrowPopup = await page.locator('#event-menu').evaluate(menu => {
    const rect = menu.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
  });
  assert.ok(narrowPopup.left >= 0 && narrowPopup.right <= narrowPopup.width && narrowPopup.top >= 0 && narrowPopup.bottom <= narrowPopup.height, JSON.stringify(narrowPopup));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), false);
  await page.waitForFunction(() => document.activeElement?.id === 'event-menu-toggle');
  await page.locator('#event-menu-toggle').click();
  await page.locator('#audience').click();
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), false, 'outside interaction dismisses the popup');
  await page.waitForFunction(() => document.activeElement?.id === 'event-menu-toggle');

  // The library trigger keeps focus after every dismissal, while Space remains the playback shortcut.
  const assertSpaceAfterMenuDismissal = async (dismiss, label) => {
    await page.locator('#event-menu-toggle').click();
    assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true);
    await dismiss();
    await page.waitForFunction(() => document.querySelector('#event-menu-toggle').getAttribute('aria-expanded') === 'false');
    await page.waitForFunction(() => document.activeElement?.id === 'event-menu-toggle');
    const before = await page.locator('#event-start').getAttribute('aria-label');
    await page.keyboard.press('Space');
    await page.waitForFunction(previous => document.querySelector('#event-start').getAttribute('aria-label') !== previous, before);
    assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), false, `Space after ${label} controls playback without reopening the library`);
    assert.equal(await page.locator('#event-menu-toggle').getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Space');
    await page.waitForFunction(previous => document.querySelector('#event-start').getAttribute('aria-label') === previous, before);
    assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), false, `second Space after ${label} keeps the library closed`);
  };
  await assertSpaceAfterMenuDismissal(() => page.keyboard.press('Escape'), 'Escape');
  await assertSpaceAfterMenuDismissal(() => page.locator('#event-menu-close').click(), 'close-button dismissal');
  await assertSpaceAfterMenuDismissal(() => page.locator('#audience').click(), 'outside dismissal');

  await page.locator('#event-menu-toggle').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Финал', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#event-song-name').textContent === 'Финал');
  assert.equal(await page.locator('#event-mute').isVisible(), true, 'no-backing songs keep sound control in place');
  assert.equal(await page.locator('#event-mute').isDisabled(), true);
  assert.equal(await page.locator('#event-mute use').getAttribute('href'), '#icon-muted');
  assert.equal(await page.locator('#event-mute').getAttribute('data-tooltip'), 'для этой песни нет минусовки');
  assert.equal(await page.locator('#event-player').count(), 0, 'song switch awaits manual Start');
  assert.equal(await page.locator('#highlight-current').getAttribute('aria-pressed'), 'false', 'line-emphasis preference follows song switching');
  await page.locator('#event-start').click();
  await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > .2);
  assert.equal(await page.locator('#event-start').getAttribute('aria-label'), 'Пауза');
  await page.locator('#event-start').click();
  const lyricsPaused = Number(await page.locator('#event-progress').inputValue());
  await page.waitForTimeout(300);
  assert.equal(Number(await page.locator('#event-progress').inputValue()), lyricsPaused);
  await page.locator('#event-progress').evaluate(input => { input.value = '5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('#event-start').getAttribute('aria-label'), 'Старт');
  await page.locator('#event-start').click();
  await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > 5);
  assert.equal(await page.locator('#event-player').count(), 0);
  await page.locator('#event-reset').click();
  await page.locator('#event-progress').evaluate(input => { input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForSelector('.audience-line.active');
  if (await page.locator('#fullscreen').evaluate(button => Boolean(button.closest('#event-view')?.requestFullscreen))) {
    await page.locator('#fullscreen').click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await page.waitForFunction(() => document.querySelector('#event-view').classList.contains('is-fullscreen'));
    assert.equal(await page.locator('#exit-event').isHidden(), true, 'preparation navigation hides in fullscreen');
    await page.locator('#event-menu-toggle').click();
    assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true, 'menu remains usable during fullscreen');
    const fullscreenPopup = await page.locator('#event-menu').evaluate(menu => {
      const rect = menu.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    assert.ok(fullscreenPopup.left >= 0 && fullscreenPopup.right <= fullscreenPopup.width && fullscreenPopup.top >= 0 && fullscreenPopup.bottom <= fullscreenPopup.height, JSON.stringify(fullscreenPopup));
    await page.locator('#event-menu-close').click();
    await page.waitForFunction(() => document.querySelector('#event-menu-toggle').getAttribute('aria-expanded') === 'false');
    await page.evaluate(() => { document.activeElement?.blur(); });
    await page.locator('#audience').hover();
    const beforeHide = await page.evaluate(() => ({
      progress: Number(document.querySelector('#event-progress').value),
      activeCenter: (() => { const rect = document.querySelector('.audience-line.active').getBoundingClientRect(); return (rect.top + rect.bottom) / 2; })(),
    }));
    await page.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-dimmed'), null, { timeout: 5000 });
    await page.waitForFunction(() => Math.abs(Number(getComputedStyle(document.querySelector('#event-controls')).opacity) - .3) < .02);
    const dimmed = await page.evaluate(() => ({
      progress: Number(document.querySelector('#event-progress').value),
      activeCenter: (() => { const rect = document.querySelector('.audience-line.active').getBoundingClientRect(); return (rect.top + rect.bottom) / 2; })(),
      panel: document.querySelector('#event-controls').getBoundingClientRect().toJSON(),
      opacity: Number(getComputedStyle(document.querySelector('#event-controls')).opacity),
    }));
    assert.equal(dimmed.progress, beforeHide.progress, 'dimming controls does not seek');
    assert.ok(Math.abs(dimmed.activeCenter - beforeHide.activeCenter) < 2, 'dimming controls does not shift the lyrics');
    assert.ok(Math.abs(dimmed.opacity - .3) < .02, `idle controls use 0.3 opacity: ${JSON.stringify(dimmed)}`);
    assert.equal(await page.locator('#event-controls-reveal').count(), 0, 'there is no miniature reveal strip');
    assert.ok(await page.locator('#event-controls').evaluate(panel => panel.getBoundingClientRect().height > 10), 'the full controls panel remains present');
    const startBeforeHiddenShortcut = await page.locator('#event-start').getAttribute('aria-label');
    await page.keyboard.press('Space');
    assert.notEqual(await page.locator('#event-start').getAttribute('aria-label'), startBeforeHiddenShortcut, 'Space works while the fullscreen panel is dimmed');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#event-start').getAttribute('aria-label'), startBeforeHiddenShortcut, 'Space toggles back while the panel remains dimmed');
    const muteWithoutBacking = await page.locator('#event-mute').getAttribute('aria-pressed');
    await page.keyboard.press('m');
    assert.equal(await page.locator('#event-mute').getAttribute('aria-pressed'), muteWithoutBacking, 'M does not change mute state without backing audio');
    await page.keyboard.press('c');
    assert.equal(await page.locator('#highlight-current').getAttribute('aria-pressed'), 'true', 'C works while the fullscreen panel is dimmed');
    await page.keyboard.press('c');
    assert.equal(await page.locator('#highlight-current').getAttribute('aria-pressed'), 'false', 'restore the saved emphasis preference');
    const panelBox = await page.locator('#event-controls').boundingBox();
    assert.ok(panelBox);
    await page.locator('#event-controls').hover({ position: { x: panelBox.width / 2, y: panelBox.height / 2 } });
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#event-controls')).opacity) > .98);
    const restored = await page.evaluate(() => ({
      panel: document.querySelector('#event-controls').getBoundingClientRect().toJSON(),
      opacity: Number(getComputedStyle(document.querySelector('#event-controls')).opacity),
    }));
    assert.ok(Math.abs(restored.opacity - 1) < .02, 'hover over the full panel restores opacity');
    assert.deepEqual(
      { x: restored.panel.x, y: restored.panel.y, width: restored.panel.width, height: restored.panel.height },
      { x: dimmed.panel.x, y: dimmed.panel.y, width: dimmed.panel.width, height: dimmed.panel.height },
      'dimming and restoring controls do not move or resize the panel',
    );
    await page.waitForTimeout(3200);
    assert.ok(await page.locator('#event-controls').evaluate(panel => Number(getComputedStyle(panel).opacity) > .98), 'hover keeps the panel fully visible');
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator('#audience').hover();
    await page.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-dimmed'), null, { timeout: 5000 });
    await page.locator('#font-up').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'event-progress', 'Tab reaches the dimmed timeline');
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#event-controls')).opacity) > .98);
    assert.ok(await page.locator('#event-controls').evaluate(panel => Number(getComputedStyle(panel).opacity) > .98), 'keyboard focus restores the panel');
    await page.waitForTimeout(3200);
    assert.ok(await page.locator('#event-controls').evaluate(panel => Number(getComputedStyle(panel).opacity) > .98), 'keyboard focus keeps the panel visible');
    const progressBox = await page.locator('#event-progress').boundingBox();
    assert.ok(progressBox);
    await page.mouse.move(progressBox.x + progressBox.width * .25, progressBox.y + progressBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(progressBox.x + progressBox.width * .55, progressBox.y + progressBox.height / 2, { steps: 5 });
    await page.waitForTimeout(3200);
    assert.ok(await page.locator('#event-controls').evaluate(panel => Number(getComputedStyle(panel).opacity) > .98), 'dragging the timeline keeps the panel visible');
    await page.mouse.up();
    await page.evaluate(() => document.activeElement?.blur());
    await page.locator('#audience').hover();
    await page.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-dimmed'), null, { timeout: 5000 });
    const beforeReveal = await page.evaluate(() => ({
      progress: Number(document.querySelector('#event-progress').value),
      activeCenter: (() => { const rect = document.querySelector('.audience-line.active').getBoundingClientRect(); return (rect.top + rect.bottom) / 2; })(),
    }));
    const idlePanel = await page.locator('#event-controls').boundingBox();
    await page.locator('#event-controls').hover({ position: { x: 1, y: 1 } });
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#event-controls')).opacity) > .98);
    const afterReveal = await page.evaluate(() => ({
      progress: Number(document.querySelector('#event-progress').value),
      activeCenter: (() => { const rect = document.querySelector('.audience-line.active').getBoundingClientRect(); return (rect.top + rect.bottom) / 2; })(),
    }));
    const revealedPanel = await page.locator('#event-controls').boundingBox();
    assert.deepEqual(revealedPanel, idlePanel, 'hovering any panel region restores controls without moving or resizing them');
    assert.equal(afterReveal.progress, beforeReveal.progress, 'revealing controls does not seek');
    assert.ok(Math.abs(afterReveal.activeCenter - beforeReveal.activeCenter) < 2, 'revealing controls does not shift the lyrics');
    await page.locator('#fullscreen').click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.waitForFunction(() => !document.querySelector('#event-view').classList.contains('is-fullscreen'));
    assert.equal(await page.locator('#exit-event').isVisible(), true, 'preparation navigation returns after fullscreen exit');
  }
  await page.locator('#exit-event').click();
  console.log('live-display: event menu');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 3);
  await page.locator('.song-select').first().click();
  await page.getByRole('button', { name: 'Режим показа', exact: true }).click();
  assert.equal(await page.locator('#highlight-current').getAttribute('aria-pressed'), 'false', 'line-emphasis preference survives reload');
  await page.locator('#exit-event').click();

  // TL-AC31: adding stays directly under a short list and a long list scrolls before it.
  const controlPlacement = await page.evaluate(() => ({ newSong: document.querySelector('#add-song').previousElementSibling?.id, library: document.querySelector('#add-library-song')?.previousElementSibling?.id }));
  assert.equal(controlPlacement.newSong, 'song-list');
  assert.equal(controlPlacement.library, 'add-song');
  const many = { ...localSet, id: 'many-live', songs: Array.from({ length: 25 }, (_, index) => readySong(`many-${index}`, `Номер ${index + 1}`)) };
  await page.locator('#set-file').setInputFiles({ name: 'many.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(many)) });
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 25);
  const listGeometry = await page.locator('#song-list').evaluate(list => ({ scroll: list.scrollHeight, client: list.clientHeight, next: list.nextElementSibling?.id }));
  assert.equal(listGeometry.next, 'add-song');
  assert.ok(listGeometry.scroll > listGeometry.client, 'long sidebar list has its own scroll range');
  console.log('live-display: desktop list geometry');

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(origin + '/lyrics/');
  await mobile.locator('#set-file').setInputFiles({ name: 'mobile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(many)) });
  await mobile.waitForFunction(() => document.querySelectorAll('.song-item').length === 25);
  const mobileGeometry = await mobile.locator('#song-list').evaluate(list => ({ height: list.getBoundingClientRect().height, scroll: list.scrollHeight, client: list.clientHeight }));
  assert.ok(mobileGeometry.height <= 186 && mobileGeometry.scroll > mobileGeometry.client, JSON.stringify(mobileGeometry));
  await mobile.screenshot({ path: output + '/mobile-preparation.png', fullPage: true });
  await mobile.locator('.song-select').first().click();
  await mobile.getByRole('button', { name: 'Режим показа', exact: true }).click();
  await mobile.screenshot({ path: output + '/mobile-display.png' });
  await mobile.close();
  console.log('live-display: mobile geometry');

  // A metadata-only backing file must fail visibly and still offer an explicit lyrics-only launch.
  const missingBacking = { schemaVersion: 1, id: 'missing-backing', name: 'Нет файла', songs: [readySong('missing', 'Без файла', { backing: 'missing.wav' })] };
  await page.locator('#set-file').setInputFiles({ name: 'missing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(missingBacking)) });
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 1);
  await page.getByRole('button', { name: 'Режим показа', exact: true }).click();
  await page.locator('#event-start').click();
  await page.waitForSelector('#event-lyrics-only:not([hidden])');
  assert.ok((await page.locator('#event-audio-status').textContent()).length > 0);
  await page.locator('#event-lyrics-only').click();
  await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > 0);
  await page.locator('#event-reset').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#event-player').count(), 0, 'failed or cancelled load cannot start audio after reset');
  assert.deepEqual(errors, []);
  console.log('PASS: revision 6 display controls, navigation, tabs, original preview and responsive layout.');
} finally {
  if (browser) await browser.close();
  server.kill();
}
