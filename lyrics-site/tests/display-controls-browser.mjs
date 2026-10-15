import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = Number(process.env.LYRICS_DISPLAY_CONTROLS_PORT || 8117);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe' });
let browser;

function song(id, title, backing = '') {
  return {
    schemaVersion: 1, id, title, artist: '', version: 'Проверочная версия', language: 'ru', duration: 30,
    delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' },
    ...(backing ? { backing: { fileName: backing } } : {}),
    cues: [
      { id: `${id}-a`, start: .2, text: `${title}: первая строка`, type: 'lyric' },
      { id: `${id}-b`, start: 10, text: `${title}: вторая строка`, type: 'lyric' },
    ],
  };
}

async function ready(page, songs) {
  await page.goto(`${origin}/lyrics/`);
  await page.waitForSelector('#editor h1');
  await page.locator('#set-file').setInputFiles({
    name: 'display.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, id: 'display-controls', name: 'Проверка показа', songs })),
  });
  await page.waitForFunction(count => document.querySelectorAll('.song-item').length === count, songs.length);
  await page.getByRole('button', { name: 'Режим показа', exact: true }).click();
  await page.waitForSelector('#event-view:not([hidden])');
}

try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`${origin}/lyrics/`)).ok) break; } catch {}
    if (attempt === 39) throw new Error('Preview server did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await ready(page, [song('ready-no-backing', 'Без минусовки')]);

  assert.equal(await page.locator('#fullscreen').getAttribute('aria-keyshortcuts'), 'F');
  assert.match(await page.locator('#fullscreen').getAttribute('data-tooltip'), /\bF\b/);
  assert.equal(await page.locator('#event-mute').isVisible(), true);
  assert.equal(await page.locator('#event-mute').isDisabled(), true);
  assert.equal(await page.locator('#event-mute use').getAttribute('href'), '#icon-muted');
  assert.equal(await page.locator('#event-mute').getAttribute('data-tooltip'), 'для этой песни нет минусовки');
  await page.locator('#event-mute').hover();
  assert.equal(await page.locator('#event-mute').evaluate(button => getComputedStyle(button, '::after').visibility), 'visible', 'disabled speaker tooltip appears on hover');
  assert.ok(await page.locator('#event-mute').evaluate(button => getComputedStyle(button, '::after').content.includes('для этой песни нет минусовки')));
  const unavailableMute = await page.locator('#event-mute').getAttribute('aria-pressed');
  await page.keyboard.press('m');
  assert.equal(await page.locator('#event-mute').getAttribute('aria-pressed'), unavailableMute, 'unavailable mute shortcut is inert');

  // Font buttons and keyboard shortcuts share four-pixel steps and the same limits.
  const fontSize = async () => page.locator('#audience-lines').evaluate(lines => Number.parseFloat(getComputedStyle(lines).fontSize));
  assert.equal(await fontSize(), 54);
  await page.locator('#font-up').click();
  assert.equal(await fontSize(), 58, 'font button increases the audience text by 4px');
  await page.keyboard.press('+');
  assert.equal(await fontSize(), 62, '+ increases the audience text by 4px');
  await page.keyboard.press('=');
  assert.equal(await fontSize(), 66, '= is a convenient increase shortcut');
  await page.locator('#audience').evaluate(audience => audience.dispatchEvent(new KeyboardEvent('keydown', { key: '+', code: 'NumpadAdd', bubbles: true })));
  assert.equal(await fontSize(), 70, 'NumpadAdd increases the audience text by 4px');
  await page.locator('#font-down').click();
  assert.equal(await fontSize(), 66, 'font button decreases the audience text by 4px');
  await page.keyboard.press('-');
  assert.equal(await fontSize(), 62, '- decreases the audience text by 4px');
  await page.locator('#audience').evaluate(audience => audience.dispatchEvent(new KeyboardEvent('keydown', { key: '−', bubbles: true })));
  assert.equal(await fontSize(), 58, 'Unicode minus decreases the audience text by 4px');
  await page.locator('#audience').evaluate(audience => audience.dispatchEvent(new KeyboardEvent('keydown', { key: '-', code: 'NumpadSubtract', bubbles: true })));
  assert.equal(await fontSize(), 54, 'NumpadSubtract decreases the audience text by 4px');
  for (let index = 0; index < 20; index++) await page.keyboard.press('+');
  assert.equal(await fontSize(), 100, 'font increase stops at 100px');
  await page.keyboard.press('+');
  assert.equal(await fontSize(), 100, 'font increase stays at the 100px limit');
  for (let index = 0; index < 20; index++) await page.keyboard.press('-');
  assert.equal(await fontSize(), 28, 'font decrease stops at 28px');
  await page.keyboard.press('-');
  assert.equal(await fontSize(), 28, 'font decrease stays at the 28px limit');

  // Tooltips appear on hover and keyboard focus, with the accessible action text.
  const tooltip = async selector => page.locator(selector).evaluate(button => {
    const style = getComputedStyle(button, '::after');
    return { opacity: style.opacity, visibility: style.visibility, content: style.content, label: button.getAttribute('aria-label') };
  });
  await page.locator('#event-start').hover();
  let tip = await tooltip('#event-start');
  assert.equal(tip.opacity, '1');
  assert.equal(tip.visibility, 'visible');
  assert.ok(tip.content.includes('Пробел') && tip.label === 'Старт', JSON.stringify(tip));
  await page.mouse.move(10, 10);
  await page.locator('#event-start').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'event-reset');
  tip = await tooltip('#event-reset');
  assert.equal(tip.opacity, '1', 'keyboard focus reveals the tooltip');
  assert.equal(tip.visibility, 'visible');

  // Shortcut keys are inert in text entry and while a dialog is open.
  const states = async () => page.evaluate(() => ({
    start: document.querySelector('#event-start').getAttribute('aria-label'),
    mute: document.querySelector('#event-mute').getAttribute('aria-pressed'),
    emphasis: document.querySelector('#highlight-current').getAttribute('aria-pressed'),
    fullscreen: Boolean(document.fullscreenElement),
  }));
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'shortcut-guard-input';
    input.style.cssText = 'position:fixed;left:20px;top:20px;z-index:10000';
    document.querySelector('#event-view').append(input); input.focus();
  });
  const beforeEditableShortcuts = await fontSize();
  await page.locator('#shortcut-guard-input').evaluate(input => {
    for (const [key, code] of [['f', 'KeyF'], ['+', 'Equal'], ['-', 'Minus']]) input.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
  });
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false, 'synthetic F keydown on an editable field does not toggle fullscreen');
  assert.equal(await fontSize(), beforeEditableShortcuts, 'font shortcuts do not trigger while editing text');
  const beforeInput = await states();
  await page.keyboard.press('Space'); await page.keyboard.press('m'); await page.keyboard.press('c'); await page.keyboard.press('f');
  assert.deepEqual(await states(), beforeInput, 'Space, M, C, and F do not trigger while editing text');
  await page.locator('#shortcut-guard-input').evaluate(input => input.remove());

  const fullscreenBeforeGuards = await page.evaluate(() => Boolean(document.fullscreenElement));
  await page.evaluate(() => {
    const audience = document.querySelector('#audience');
    audience.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true, ctrlKey: true }));
    audience.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', bubbles: true, repeat: true }));
    audience.dispatchEvent(new KeyboardEvent('keydown', { key: '+', code: 'Equal', bubbles: true, ctrlKey: true }));
    audience.dispatchEvent(new KeyboardEvent('keydown', { key: '+', code: 'Equal', bubbles: true, repeat: true }));
  });
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), fullscreenBeforeGuards, 'modifier and repeated F keydowns do not toggle fullscreen');
  assert.equal(await fontSize(), 28, 'modifier and repeated font shortcut keydowns are ignored');

  await page.locator('#event-menu-toggle').click();
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true);
  const beforeDialog = await states();
  const fontBeforeDialog = await fontSize();
  await page.locator('#event-menu').evaluate(dialog => {
    for (const [key, code] of [[' ', 'Space'], ['m', 'KeyM'], ['c', 'KeyC'], ['f', 'KeyF'], ['+', 'Equal'], ['-', 'Minus']]) {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    }
  });
  assert.deepEqual(await states(), beforeDialog, 'shortcuts do not trigger while a dialog is open');
  assert.equal(await fontSize(), fontBeforeDialog, 'font shortcuts do not trigger while a dialog is open');
  await page.locator('#event-menu-close').click();
  await page.waitForFunction(() => !document.querySelector('#event-menu').open);
  await page.waitForFunction(() => document.querySelector('#event-menu-toggle').getAttribute('aria-expanded') === 'false');

  // Space cannot restart after seeking to the declared song end.
  await page.locator('#event-progress').evaluate(input => {
    input.value = input.max; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#event-start').disabled);
  const endPosition = await page.locator('#event-progress').inputValue();
  await page.locator('#audience').click();
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#event-start').isDisabled(), true);
  assert.equal(await page.locator('#event-progress').inputValue(), endPosition, 'Space does not move playback past song end');

  // Physical F enters and exits fullscreen using the same fullscreen action as the button.
  await page.keyboard.press('f');
  await page.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await page.keyboard.press('f');
  await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#event-view').classList.contains('is-fullscreen'));

  // Idle controls stay in place at reduced opacity; hover and focus restore full contrast.
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await page.evaluate(() => document.activeElement?.blur());
  await page.locator('#audience').hover();
  await page.waitForTimeout(1700);
  assert.equal(await page.locator('#event-view').evaluate(view => view.classList.contains('controls-dimmed')), false, 'idle dimming waits for two seconds');
  await page.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-dimmed'), null, { timeout: 900 });
  await page.waitForFunction(() => Math.abs(Number(getComputedStyle(document.querySelector('#event-controls')).opacity) - .3) < .02);
  const idle = await page.locator('#event-controls').evaluate(panel => ({
    rect: panel.getBoundingClientRect().toJSON(),
    opacity: Number(getComputedStyle(panel).opacity),
    pointerEvents: getComputedStyle(panel).pointerEvents,
  }));
  assert.ok(Math.abs(idle.opacity - .3) < .02, `idle panel opacity is 0.3: ${JSON.stringify(idle)}`);
  assert.equal(idle.pointerEvents, 'auto');
  assert.equal(await page.locator('#event-controls-reveal').count(), 0, 'the reveal strip is removed');
  await page.locator('#event-controls').hover({ position: { x: 4, y: 4 } });
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('#event-controls')).opacity) > .98);
  const hovered = await page.locator('#event-controls').evaluate(panel => ({ rect: panel.getBoundingClientRect().toJSON(), opacity: Number(getComputedStyle(panel).opacity) }));
  assert.ok(Math.abs(hovered.opacity - 1) < .02);
  assert.deepEqual(
    { x: hovered.rect.x, y: hovered.rect.y, width: hovered.rect.width, height: hovered.rect.height },
    { x: idle.rect.x, y: idle.rect.y, width: idle.rect.width, height: idle.rect.height },
    'hover restores opacity without changing panel size or location',
  );
  await page.evaluate(() => document.activeElement?.blur());
  await page.locator('#audience').hover();
  await page.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-dimmed'), null, { timeout: 5000 });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#event-view').classList.contains('is-fullscreen'));
  assert.equal(await page.locator('#event-view').evaluate(view => view.classList.contains('controls-dimmed')), false);
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#event-view').evaluate(view => view.classList.contains('controls-dimmed')), false, 'fullscreen reentry starts with a fresh dim delay');
  await page.evaluate(() => document.activeElement?.blur());
  await page.locator('#audience').hover();
  await page.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-dimmed'), null, { timeout: 3500 });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await page.locator('#exit-event').click();

  // Touching the full, dimmed panel restores controls without seeking.
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const touch = await touchContext.newPage();
  await ready(touch, [song('touch-ready', 'Проверка касания')]);
  await touch.locator('#fullscreen').tap();
  await touch.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await touch.evaluate(() => document.activeElement?.blur());
  await touch.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-dimmed'), null, { timeout: 5000 });
  const beforeTouch = await touch.locator('#event-progress').inputValue();
  const touchPanel = await touch.locator('#event-controls').boundingBox();
  await touch.touchscreen.tap(touchPanel.x + 4, touchPanel.y + touchPanel.height / 2);
  await touch.waitForFunction(() => Number(getComputedStyle(document.querySelector('#event-controls')).opacity) > .98);
  assert.ok(await touch.locator('#event-controls').evaluate(panel => Number(getComputedStyle(panel).opacity) > .98), 'touch restores full panel opacity');
  assert.equal(await touch.locator('#event-progress').inputValue(), beforeTouch, 'touch reveal does not seek');
  await touch.evaluate(() => document.exitFullscreen());
  await touch.waitForFunction(() => !document.fullscreenElement);
  await touchContext.close();

  // Audio failure in fullscreen pins both the explanation and recovery controls open.
  const missing = await context.newPage();
  await ready(missing, [song('missing-backing', 'Файл отсутствует', 'not-present.wav')]);
  await missing.locator('#fullscreen').click();
  await missing.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await missing.locator('#event-start').click();
  await missing.waitForSelector('#event-audio-status:not([hidden])');
  await missing.waitForSelector('#event-lyrics-only:not([hidden])');
  await missing.evaluate(() => document.activeElement?.blur());
  await missing.locator('#audience').hover();
  await missing.waitForTimeout(3300);
  assert.equal(await missing.locator('#event-view').evaluate(view => view.classList.contains('controls-dimmed')), false);
  assert.equal(await missing.locator('#event-audio-status').isVisible(), true);
  assert.equal(await missing.locator('#event-lyrics-only').isVisible(), true);
  await missing.evaluate(() => document.exitFullscreen());
  await missing.waitForFunction(() => !document.fullscreenElement);
  await missing.close();

  console.log('PASS: supplemental display tooltip, shortcut guards, dimmed controls, touch restore, and audio-error visibility.');
} finally {
  if (browser) await browser.close();
  server.kill();
}
