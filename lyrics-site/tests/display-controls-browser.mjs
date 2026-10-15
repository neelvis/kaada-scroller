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
  }));
  await page.evaluate(() => {
    const input = document.createElement('input'); input.id = 'shortcut-guard-input';
    input.style.cssText = 'position:fixed;left:20px;top:20px;z-index:10000';
    document.querySelector('#event-view').append(input); input.focus();
  });
  const beforeInput = await states();
  await page.keyboard.press('Space'); await page.keyboard.press('m'); await page.keyboard.press('c');
  assert.deepEqual(await states(), beforeInput, 'Space, M, and C do not trigger while editing text');
  await page.locator('#shortcut-guard-input').evaluate(input => input.remove());

  await page.locator('#event-menu-toggle').click();
  assert.equal(await page.locator('#event-menu').evaluate(dialog => dialog.open), true);
  const beforeDialog = await states();
  await page.locator('#event-menu').evaluate(dialog => {
    for (const [key, code] of [[' ', 'Space'], ['m', 'KeyM'], ['c', 'KeyC']]) {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true }));
    }
  });
  assert.deepEqual(await states(), beforeDialog, 'shortcuts do not trigger while a dialog is open');
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

  // Exiting with a hide timer pending must leave the panel visible; reentry gets a fresh delay.
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await page.evaluate(() => document.activeElement?.blur());
  await page.locator('#audience').hover();
  await page.waitForTimeout(2500);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#event-view').classList.contains('is-fullscreen'));
  assert.equal(await page.locator('#event-view').evaluate(view => view.classList.contains('controls-hidden')), false);
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#event-view').evaluate(view => view.classList.contains('controls-hidden')), false, 'fullscreen reentry starts with a fresh hide delay');
  await page.evaluate(() => document.activeElement?.blur());
  await page.locator('#audience').hover();
  await page.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-hidden'), null, { timeout: 3500 });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement && !document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await page.locator('#exit-event').click();

  // A touch tap on the bottom reveal strip restores controls without seeking.
  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const touch = await touchContext.newPage();
  await ready(touch, [song('touch-ready', 'Проверка касания')]);
  await touch.locator('#fullscreen').tap();
  await touch.waitForFunction(() => Boolean(document.fullscreenElement) && document.querySelector('#event-view').classList.contains('is-fullscreen'));
  await touch.evaluate(() => document.activeElement?.blur());
  await touch.waitForFunction(() => document.querySelector('#event-view').classList.contains('controls-hidden'), null, { timeout: 5000 });
  const beforeTouch = await touch.locator('#event-progress').inputValue();
  const touchSize = await touch.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await touch.touchscreen.tap(touchSize.width / 2, touchSize.height - 5);
  await touch.waitForFunction(() => !document.querySelector('#event-view').classList.contains('controls-hidden'));
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
  assert.equal(await missing.locator('#event-view').evaluate(view => view.classList.contains('controls-hidden')), false);
  assert.equal(await missing.locator('#event-audio-status').isVisible(), true);
  assert.equal(await missing.locator('#event-lyrics-only').isVisible(), true);
  await missing.evaluate(() => document.exitFullscreen());
  await missing.waitForFunction(() => !document.fullscreenElement);
  await missing.close();

  console.log('PASS: supplemental display tooltip, shortcut guards, timer restore, touch reveal, and audio-error visibility.');
} finally {
  if (browser) await browser.close();
  server.kill();
}
