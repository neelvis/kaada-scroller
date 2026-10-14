import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { importPortableSet } from '../public/portable.js';

const port = Number(process.env.LYRICS_REDESIGN_PORT || 8114);
const origin = `http://127.0.0.1:${port}`;
const output = 'test-results/redesign';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe' });
let browser;
const makeSong = (id, duration) => ({ schemaVersion: 1, id, title: id, artist: 'Artist', version: 'Version', language: 'en', duration, delayMs: 250, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [{ id: 'line', start: 1, text: 'Hello', type: 'lyric' }] });
const fixture = { schemaVersion: 1, id: 'redesign', name: 'Portable set', songs: [makeSong('first', 125.75), makeSong('second', 70), makeSong('third', 90)] };
function wave(seconds = 2) {
  const bytes = Buffer.alloc(44 + 16000 * seconds * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/lyrics/')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/lyrics/'); await page.waitForSelector('#editor h1');
  assert.equal(await page.locator('#projects').isDisabled(), true);
  assert.equal(await page.locator('#projects').isVisible(), false);
  assert.equal(await page.locator('#add-song').textContent(), '+ Новая песня');
  await page.locator('#set-file').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.waitForFunction(() => document.querySelector('#editor h1')?.textContent === 'Выберите песню для редактирования');
  assert.equal(await page.locator('.song-item.active').count(), 0);
  assert.equal(await page.locator('#editor input').count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector('#show-mode').nextElementSibling.id), 'song-list');
  await page.locator('#show-mode').click();
  await page.waitForSelector('#event-view:not([hidden])');
  await page.locator('#exit-event').click();
  assert.equal(await page.locator('.song-item.active').count(), 0);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#editor h1')?.textContent === 'Выберите песню для редактирования');
  await page.locator('.song-select').first().click();
  await page.waitForSelector('#lrclib-search-form');
  const cueText = page.getByLabel('Текст строки 1', { exact: true });
  await cueText.fill('Updated on first confirmation');
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click();
  await page.waitForFunction(async () => {
    const song = (await (await import('./storage.js')).loadSet()).songs[0];
    return song.reviewed && song.cues[0].text === 'Updated on first confirmation';
  });
  assert.equal(await page.locator('.status-pill').textContent(), 'Готова');
  // Reject an invalid pending edit, then confirm its focused correction once.
  await cueText.fill('');
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click();
  assert.equal(await page.locator('.status-pill').textContent(), 'Нужно проверить');
  await cueText.fill('Corrected on first confirmation');
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click();
  await page.waitForFunction(async () => {
    const song = (await (await import('./storage.js')).loadSet()).songs[0];
    return song.reviewed && song.cues[0].text === 'Corrected on first confirmation';
  });


  const duration = page.getByLabel('Длительность, ММ:СС', { exact: true });
  assert.equal(await duration.inputValue(), '02:05');
  assert.equal(await page.getByLabel('Язык', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Общая задержка, мс', { exact: true }).count(), 0);
  assert.equal(await page.locator('#original-tab').count(), 0);
  assert.equal(await page.locator('#original-file').count(), 0);
  assert.equal(await page.getByText('Название и исполнитель из полей поиска отправляются в LRCLIB.', { exact: false }).count(), 0);
  await page.getByRole('tab', { name: 'Свой LRC', exact: true }).click();
  await page.getByLabel('LRC с таймкодами', { exact: true }).fill('[00:03]Draft');
  await page.getByRole('tab', { name: 'Чистый текст', exact: true }).click();
  await page.getByLabel('Обычный текст', { exact: true }).fill('plain draft');
  await page.getByRole('tab', { name: 'Свой LRC', exact: true }).click();
  assert.equal(await page.getByLabel('LRC с таймкодами', { exact: true }).inputValue(), '[00:03]Draft');
  assert.equal(await page.locator('.cue-row').isVisible(), true);
  // Renders, song switches and rejected values preserve hidden values and fractions.
  await page.locator('.song-select').nth(1).click(); await page.locator('.song-select').first().click();
  let saved = await page.evaluate(async () => (await import('./storage.js')).loadSet());
  assert.equal(saved.songs[0].duration, 125.75); assert.equal(saved.songs[0].delayMs, 250); assert.equal(saved.songs[0].language, 'en');
  await duration.fill('02:99'); await duration.blur();
  assert.equal((await page.evaluate(async () => (await import('./storage.js')).loadSet())).songs[0].duration, 125.75);
  await duration.fill('03:05'); await duration.blur();
  await page.waitForFunction(async () => (await (await import('./storage.js')).loadSet()).songs[0].duration === 185);
  for (const i of [0, 1]) {
    await page.locator('.song-select').nth(i).click();
    await page.locator('#backing-file').setInputFiles({ name: 'same.wav', mimeType: 'audio/wav', buffer: wave(i + 2) });
    await page.waitForFunction(() => document.querySelector('.backing-card .file-name').textContent === 'same.wav');
  }
  const downloadWait = page.waitForEvent('download'); await page.locator('#export-set').click();
  const download = await downloadWait; assert.match(download.suggestedFilename(), /\.zip$/);
  const bytes = await readFile(await download.path());
  const imported = await importPortableSet(new Blob([bytes]));
  assert.equal(imported.set.songs.length, 3); assert.equal(imported.backingAudio.size, 2);
  assert.deepEqual(Buffer.from(await imported.backingAudio.get('first').arrayBuffer()), wave(2));
  assert.deepEqual(Buffer.from(await imported.backingAudio.get('second').arrayBuffer()), wave(3));
  // An aborted storage transaction must leave both prior metadata and audio intact.
  const atomic = await page.evaluate(async () => {
    const storage = await import('./storage.js'); const before = await storage.loadSet();
    const oldAudio = Array.from(new Uint8Array(await (await storage.getBacking('first')).arrayBuffer()));
    const real = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = real.apply(this, args);
      if (args[1] === 'readwrite') queueMicrotask(() => tx.abort());
      return tx;
    };
    let rejected = false;
    try { await storage.replaceStoredSet({ ...before, name: 'Must not persist' }, new Map([['first', new Blob(['replacement'])]])); } catch { rejected = true; }
    finally { IDBDatabase.prototype.transaction = real; }
    return { rejected, before, after: await storage.loadSet(), oldAudio, audio: Array.from(new Uint8Array(await (await storage.getBacking('first')).arrayBuffer())) };
  });
  assert.equal(atomic.rejected, true); assert.deepEqual(atomic.before, atomic.after); assert.deepEqual(atomic.oldAudio, atomic.audio);
  // A decoded old replacement must never overwrite freshly imported backing data.
  await page.evaluate(() => {
    window.realAudio = window.Audio;
    window.Audio = class { duration = 4; constructor() { window.pendingBacking = this; } removeAttribute() {} load() {} };
  });
  await page.locator('#backing-file').setInputFiles({ name: 'late.wav', mimeType: 'audio/wav', buffer: wave(4) });
  await page.locator('#set-file').setInputFiles({ name: 'portable.zip', mimeType: 'application/zip', buffer: bytes });
  await page.waitForFunction(() => document.querySelector('.song-item-title').textContent === 'first');
  await page.waitForFunction(() => document.querySelector('#editor h1')?.textContent === 'Выберите песню для редактирования');
  await page.locator('.song-select').first().click();
  await page.waitForFunction(() => document.querySelector('#backing-preview')?.duration === 2);
  await page.waitForFunction(() => !document.querySelector('#import-set').disabled);
  await page.evaluate(async () => { window.Audio = window.realAudio; window.pendingBacking.onloadedmetadata(); await new Promise(resolve => setTimeout(resolve, 100)); });
  const restoredSecond = await page.evaluate(async () => Array.from(new Uint8Array(await (await (await import('./storage.js')).getBacking('second')).arrayBuffer())));
  assert.deepEqual(Buffer.from(restoredSecond), wave(3), 'late backing upload cannot replace imported audio');

  const corrupt = Buffer.from(bytes); corrupt[0] = 0;
  const beforeBad = await page.evaluate(async () => (await import('./storage.js')).loadSet());
  await page.locator('#set-file').setInputFiles({ name: 'corrupt.zip', mimeType: 'application/zip', buffer: corrupt });
  await page.waitForFunction(() => !document.querySelector('#import-set').disabled);
  assert.deepEqual(await page.evaluate(async () => (await import('./storage.js')).loadSet()), beforeBad);
  await page.locator('#add-song').click();
  assert.equal(await page.getByRole('tab', { name: 'LRCLIB', exact: true }).getAttribute('aria-selected'), 'true');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Удалить песню', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#editor h1')?.textContent === 'Выберите песню для редактирования');
  assert.equal(await page.locator('.song-item.active').count(), 0);
  await page.waitForFunction(() => !document.querySelector('.toast'));
  await page.screenshot({ path: output + '/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 740 });
  await page.screenshot({ path: output + '/mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: redesign fields/tabs, portable backing round trip, atomic storage failure, corrupt import and narrow layout.');
} finally { await browser?.close(); server.kill('SIGTERM'); }
