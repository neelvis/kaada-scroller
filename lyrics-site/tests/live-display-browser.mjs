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

  // TL-AC28/29: the backing follows the timeline; progress, mute, checkbox and keys are interactive.
  await page.getByRole('button', { name: 'Режим показа', exact: true }).click();
  await page.waitForSelector('#event-view:not([hidden])');
  assert.equal(await page.locator('#highlight-current').isChecked(), true);
  assert.equal(await page.locator('#event-progress').getAttribute('max'), '30');
  assert.equal(await page.locator('#event-mute').isHidden(), false);
  await page.locator('#event-start').click();
  await page.waitForSelector('#event-player', { state: 'attached' });
  await page.waitForTimeout(1200);
  const startState = await page.evaluate(() => {
    const player = document.querySelector('#event-player');
    return {
      status: document.querySelector('#event-audio-status')?.textContent,
      start: { disabled: document.querySelector('#event-start')?.disabled, text: document.querySelector('#event-start')?.textContent },
      progress: document.querySelector('#event-progress')?.value,
      player: player && { paused: player.paused, readyState: player.readyState, duration: player.duration, currentTime: player.currentTime, error: player.error?.message, ended: player.ended },
    };
  });
  assert.ok(startState.player.currentTime > 0, JSON.stringify(startState));
  console.log('live-display: event audio started');
  await page.locator('#event-mute').click();
  assert.equal(await page.locator('#event-player').evaluate(player => player.muted), true);
  const beforeMutePosition = await page.locator('#event-player').evaluate(player => player.currentTime);
  await page.waitForTimeout(180);
  assert.ok(await page.locator('#event-player').evaluate((player, before) => player.currentTime >= before, beforeMutePosition), 'mute keeps audio running');
  assert.ok(await page.evaluate(() => Math.abs(Number(document.querySelector('#event-progress').value) - document.querySelector('#event-player').currentTime) < .25), 'audio and progress agree within 250 ms');

  await page.locator('#highlight-current').uncheck();
  assert.equal(await page.locator('#audience').evaluate(element => element.classList.contains('no-highlight')), true);
  await page.locator('#event-progress').evaluate(input => { input.value = '12'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForFunction(() => Math.abs(document.querySelector('#event-player').currentTime - 12) < .35);
  await page.waitForFunction(() => {
    const styles = [...document.querySelectorAll('.audience-line:not(.rest):not(.neutral)')].map(line => { const s = getComputedStyle(line); return [s.color, s.opacity, s.fontWeight, s.transform].join('|'); });
    return new Set(styles).size === 1;
  });
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
  assert.equal(await page.locator('#event-menu-songs button').count(), 3);
  assert.equal(await page.getByRole('button', { name: /Черновик.*нужна подготовка/ }).isDisabled(), true);
  assert.ok(await page.locator('#event-player').evaluate(player => !player.paused), 'opening menu does not pause playback');
  await page.locator('#event-menu').press('Escape');
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), false);
  await page.getByRole('button', { name: 'Меню песен и проектов' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Финал', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#event-song-name').textContent === 'Финал');
  assert.equal(await page.locator('#event-player').count(), 0, 'song switch awaits manual Start');
  assert.equal(await page.locator('#highlight-current').isChecked(), false, 'line-emphasis preference follows song switching');
  if (await page.locator('#fullscreen').evaluate(button => Boolean(button.closest('#event-view')?.requestFullscreen))) {
    await page.locator('#fullscreen').click();
    await page.waitForTimeout(100);
    await page.locator('#event-menu-toggle').click();
    assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true, 'menu remains usable during fullscreen');
    await page.locator('#event-menu-close').click();
    await page.evaluate(() => document.exitFullscreen?.());
  }
  await page.locator('#exit-event').click();
  console.log('live-display: event menu');
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 3);
  await page.locator('.song-select').first().click();
  await page.getByRole('button', { name: 'Режим показа', exact: true }).click();
  assert.equal(await page.locator('#highlight-current').isChecked(), false, 'line-emphasis preference survives reload');
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
