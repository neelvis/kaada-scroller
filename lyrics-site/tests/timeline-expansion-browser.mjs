import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const port = Number(process.env.LYRICS_TIMELINE_TEST_PORT || 8188), apiPort = port + 1;
const origin = `http://127.0.0.1:${port}/lyrics/`;
const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-timeline-expansion-'));
const password = 'temporary timeline test password', salt = Buffer.alloc(16, 48);
const credentials = resolve(temporary, 'credentials.json');
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: resolve(temporary, 'api-data'), LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const python = process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python';
const api = spawn(python, ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let browser, logs = '';
for (const child of [api, server]) { child.stderr.on('data', data => { logs += data; }); child.on('error', error => { logs += error.message; }); }
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, logs);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 950 } });
  page.setDefaultTimeout(10000);
  await page.goto(origin); await page.locator('#login').click(); await page.locator('#login-password').fill(password); await page.locator('#login-form button[type=submit]').click(); await page.locator('#logout').waitFor({ state: 'visible' });
  const songId = await page.evaluate(async () => {
    const remote = await import('./remote.js');
    const song = { schemaVersion: 1, title: 'Expansion regression', artist: 'Test', version: '', language: 'ru', duration: 40, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [
      { id: 'intro', start: 0, type: 'rest', text: 'Вступление' },
      { id: 'a', start: 10, type: 'lyric', text: 'Первая строка' },
      { id: 'b', start: 15, type: 'lyric', text: 'Вторая строка' },
      { id: 'c', start: 25, type: 'lyric', text: 'Третья строка' },
      { id: 'outro', start: 35, type: 'rest', text: 'Конец' },
    ] };
    return (await remote.createSong({ song, migrationKey: 'timeline-expansion-regression' })).songId;
  });
  await page.locator('#library').click();
  const card = page.locator(`#hub-list [data-cloud-id="${songId}"]`);
  await card.waitFor(); await card.click(); await page.locator('.cue-row[data-cue-id="b"]').waitFor();
  const table = page.locator('#song-timeline .cue-table');
  const expanded = () => table.evaluate(element => !element.hidden);
  assert.equal(await page.locator('.cue-row').count(), 5);
  await page.locator('.cue-row[data-cue-id="b"] .cue-insert-rest').click();
  assert.equal(await page.locator('.cue-row').count(), 6);
  assert.equal(await expanded(), true, 'inserting a Проигрыш across the five-row threshold keeps the visible timeline expanded');
  const toggles = page.locator('.timeline-toggle');
  await toggles.first().click(); assert.equal(await expanded(), false);
  await page.locator('#ignore-timecodes').check();
  assert.equal(await expanded(), false, 'a song update preserves explicit collapse');
  assert.deepEqual(await toggles.evaluateAll(items => items.map(item => item.getAttribute('aria-expanded'))), ['false', 'false']);
  await toggles.first().click(); assert.equal(await expanded(), true);
  assert.deepEqual(await toggles.evaluateAll(items => items.map(item => item.getAttribute('aria-expanded'))), ['true', 'true'], 'both controls reflect expansion');
  await toggles.last().click(); assert.equal(await expanded(), false);
  assert.deepEqual(await toggles.evaluateAll(items => items.map(item => item.getAttribute('aria-expanded'))), ['false', 'false'], 'both controls reflect collapse');
  await toggles.first().click(); assert.equal(await expanded(), true);
  await page.locator('.cue-row[data-cue-id="b"] .cue-insert-rest').click();
  assert.equal(await page.locator('.cue-row').count(), 7); assert.equal(await expanded(), true, 'inserting a Проигрыш preserves explicit expansion');
  await page.locator('.cue-row.rest').nth(1).locator('.cue-remove').click();
  assert.equal(await page.locator('.cue-row').count(), 6); assert.equal(await expanded(), true, 'deleting a row preserves expansion');
  const lyric = page.locator('.cue-row[data-cue-id="b"] .cue-text');
  await lyric.fill('Edited'); await lyric.dispatchEvent('change'); assert.equal(await expanded(), true, 'editing a row preserves expansion');
  await page.locator('.cue-row[data-cue-id="b"] .cue-text').fill('Вторая строка');
  await page.locator('.cue-row[data-cue-id="b"] .cue-text').dispatchEvent('change');
  await page.locator('.cue-row[data-cue-id="b"] .cue-move-up').click(); assert.equal(await expanded(), true, 'reordering a row preserves expansion');
  await page.locator('.cue-row[data-cue-id="b"] .cue-move-down').click(); assert.equal(await expanded(), true);
  console.log('PASS timeline expansion persists across threshold insertion, interlude insertion/deletion, editing, and reordering; explicit collapse and expand still work.');
} finally {
  await browser?.close(); api.kill('SIGTERM'); server.kill('SIGTERM'); await rm(temporary, { recursive: true, force: true });
}
