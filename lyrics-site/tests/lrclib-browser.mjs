import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = Number(process.env.LYRICS_LRCLIB_TEST_PORT || 8107);
const origin = `http://127.0.0.1:${port}`;
const output = process.env.LYRICS_TEST_OUTPUT || 'test-results/lrclib';
await mkdir(output, { recursive: true });

const lrc = '[00:00.15]Привет <b>мир</b>\n[00:01.20]Hello again\n[00:01.20]Hello again';
const records = [
  { id: 1, trackName: 'Тест & Test', artistName: 'Автор', albumName: 'Альбом A', duration: 123, instrumental: false, syncedLyrics: lrc },
  { id: 2, trackName: 'Тест & Test', artistName: 'Автор', albumName: 'Альбом B', duration: 127, instrumental: false, syncedLyrics: null },
  { id: 3, trackName: 'Тест & Test', artistName: 'Оркестр', albumName: 'Инструментал', duration: 129, instrumental: true, syncedLyrics: lrc },
];
const song = (id, title, artist = 'Исходный артист', extras = {}) => ({
  schemaVersion: 1, id, title, artist, version: 'Оригинальная запись', language: 'ru', duration: 77, delayMs: 240,
  reviewed: true, ignoreTimecodes: false, source: { kind: 'audio', fileName: 'private-original.wav' }, backing: { fileName: 'private-backing.wav' },
  cues: [{ id: `${id}-cue`, start: .5, text: 'Существующая строка', type: 'lyric' }], ...extras,
});
const fixture = () => ({ schemaVersion: 1, id: 'lrclib-fixture', name: 'LRCLIB fixture', songs: [song('first', 'Тест & Test'), song('second', 'Другая песня')] });

const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe' });
let browser;
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(origin + '/lyrics/')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Preview server did not start');
}
async function load(page, path = '/lyrics/') {
  await page.goto(origin + path);
  await page.waitForSelector('#editor h1');
  await page.locator('#set-file').setInputFiles({ name: 'lrclib-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture())) });
  await page.waitForFunction(() => document.querySelector('#editor h1')?.textContent === 'Выберите песню для редактирования');
  await page.locator('.song-select').first().click();
  await page.waitForSelector('#lrclib-search-form');
}
async function search(page, title = 'Тест & Test', artist = 'Автор') {
  await page.locator('#lrclib-title').fill(title);
  await page.locator('#lrclib-artist').fill(artist);
  await page.locator('#lrclib-search-form').getByRole('button', { name: 'Найти LRC', exact: true }).click();
}
async function expectSong(page, expected) {
  const actual = await page.evaluate(async () => (await import('./storage.js')).loadSet());
  assert.deepEqual(actual.songs.find(item => item.id === expected.id), expected);
}

try {
  await waitForServer();
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  let response = records;
  let releaseHold;
  let held;
  const stall = () => { held = new Promise(resolve => { releaseHold = resolve; }); response = 'hold'; };
  await context.route('https://lrclib.net/api/search**', async route => {
    const request = route.request();
    requests.push({ url: request.url(), headers: request.headers() });
    if (response === 'hold') { await held; return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(records) }); }
    if (response instanceof Error) return route.abort();
    if (typeof response === 'object' && !Array.isArray(response)) return route.fulfill({ ...response, headers: { 'Access-Control-Allow-Origin': '*', ...(response.headers || {}) } });
    return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(response) });
  });

  await load(page);
  assert.equal(await page.locator('#lrclib-title').inputValue(), 'Тест & Test');
  assert.equal(await page.locator('#lrclib-artist').inputValue(), 'Исходный артист');
  await page.locator('#lrclib-title').fill('');
  assert.equal(await page.locator('#lrclib-search-form').getByRole('button', { name: 'Найти LRC', exact: true }).isDisabled(), true);
  assert.equal(requests.length, 0, 'empty title never requests LRCLIB');
  await page.locator('#lrclib-title').fill('Тест & Test');
  await page.locator('#lrclib-artist').fill('Автор');
  await page.waitForTimeout(80);
  assert.equal(requests.length, 0, 'typing alone never searches');
  await page.locator('#lrclib-search-form').getByRole('button', { name: 'Найти LRC', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.lrclib-result').count(), 3, `search status: ${await page.locator('#lrclib-status').textContent()}`);
  assert.equal(requests.length, 1);
  const sent = new URL(requests[0].url);
  assert.equal(sent.searchParams.get('track_name'), 'Тест & Test');
  assert.equal(sent.searchParams.get('artist_name'), 'Автор');
  assert.equal(sent.searchParams.has('album_name'), false);
  assert.match(requests[0].headers['lrclib-client'] || '', /KaadaScroller/);
  assert.ok(Object.values(requests[0].headers).every(value => !String(value).includes('private-original') && !String(value).includes('Существующая строка')), 'no private audio or lyrics leave the browser');
  assert.equal(await page.locator('.lrclib-result').count(), 3);
  assert.equal(await page.locator('.lrclib-result').nth(1).getByRole('button', { name: 'LRC недоступен' }).isDisabled(), true);
  assert.equal(await page.locator('.lrclib-result').nth(2).getByRole('button', { name: 'LRC недоступен' }).isDisabled(), true);
  const beforeSearch = fixture().songs[0];
  await expectSong(page, beforeSearch);
  await page.locator('.lrclib-result').first().getByRole('button', { name: 'Просмотреть LRC' }).click();
  assert.equal(await page.locator('#lrclib-preview').inputValue(), lrc, 'preview retains repeated timestamps and literal markup');
  assert.equal(await page.locator('#lrclib-preview').getAttribute('readonly'), '');
  await page.waitForFunction(() => !document.querySelector('.toast'));
  await page.screenshot({ path: output + '/desktop.png', fullPage: true });
  await expectSong(page, beforeSearch);

  // Declining replacement leaves every existing field intact.
  await page.locator('#lrclib-import').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' }); await page.locator('#confirm-dialog button[value=cancel]').click();
  await page.waitForTimeout(50);
  await expectSong(page, beforeSearch);

  await page.locator('#lrclib-import').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  await page.getByLabel('Исполнитель', { exact: true }).evaluate(field => { field.value = 'Правка во время подтверждения'; field.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('Песня изменилась'));
  assert.equal(await page.getByLabel('Текст строки 1', { exact: true }).inputValue(), 'Существующая строка', 'edit during confirmation blocks stale import');
  assert.equal(await page.getByLabel('Исполнитель', { exact: true }).inputValue(), 'Правка во время подтверждения');

  await search(page); await page.waitForSelector('.lrclib-result'); await page.locator('.lrclib-result').first().getByRole('button', { name: 'Просмотреть LRC' }).click();
  await page.locator('#lrclib-import').click(); await page.locator('#confirm-dialog').waitFor({ state: 'visible' }); await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => document.querySelectorAll('.cue-row').length === 3);
  const imported = await page.evaluate(async () => (await import('./storage.js')).loadSet());
  const importedSong = imported.songs.find(item => item.id === 'first');
  assert.deepEqual(importedSong.cues.map(cue => [cue.start, cue.text]), [[.15, 'Привет <b>мир</b>'], [1.2, 'Hello again'], [1.2, 'Hello again']]);
  assert.equal(importedSong.title, 'Тест & Test'); assert.equal(importedSong.artist, 'Правка во время подтверждения');
  assert.equal(importedSong.version, 'Оригинальная запись'); assert.equal(importedSong.duration, 77);
  assert.equal(importedSong.delayMs, 240); assert.deepEqual(importedSong.source, beforeSearch.source);
  assert.match(await page.locator('#lrclib-status').textContent(), /123|длительност/i, 'duration mismatch remains visible for review');

  // Normal local persistence and portable export/import retain the imported timeline.
  await page.reload(); await page.locator('.song-select').first().click(); await page.waitForSelector('#lrclib-search-form'); await page.waitForFunction(() => document.querySelectorAll('.cue-row').length === 3);
  assert.equal(await page.getByLabel('Текст строки 3', { exact: true }).inputValue(), 'Hello again');
  await page.evaluate(async () => { const storage = await import('./storage.js'); for (const song of (await storage.loadSet()).songs) await storage.putBacking(song.id, new Blob(['backing fixture'], { type: 'audio/wav' })); });
  const exportDownload = page.waitForEvent('download'); await page.locator('#export-set').click();
  const exported = await readFile(await (await exportDownload).path());
  await page.locator('#set-file').setInputFiles({ name: 'lrclib-export.zip', mimeType: 'application/zip', buffer: exported });
  await page.waitForFunction(() => document.querySelector('#editor h1')?.textContent === 'Выберите песню для редактирования');
  await page.locator('.song-select').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.cue-row').length === 3);
  assert.equal(await page.getByLabel('Текст строки 1', { exact: true }).inputValue(), 'Привет <b>мир</b>');

  // A missing title/artist/duration is filled, while album never becomes recording version.
  await page.locator('.song-select').filter({ hasText: 'Другая песня' }).click();
  await page.getByLabel('Название', { exact: true }).fill(''); await page.getByLabel('Название', { exact: true }).blur();
  await page.getByLabel('Исполнитель', { exact: true }).fill(''); await page.getByLabel('Исполнитель', { exact: true }).blur();
  await page.getByLabel('Длительность, ММ:СС', { exact: true }).fill('00:00'); await page.getByLabel('Длительность, ММ:СС', { exact: true }).blur();
  await search(page); await page.waitForSelector('.lrclib-result'); await page.locator('.lrclib-result').first().getByRole('button', { name: 'Просмотреть LRC' }).click();
  await page.locator('#lrclib-import').click(); await page.locator('#confirm-dialog').waitFor({ state: 'visible' }); await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => document.querySelectorAll('.cue-row').length === 3);
  assert.equal(await page.getByLabel('Название', { exact: true }).inputValue(), 'Тест & Test');
  assert.equal(await page.getByLabel('Исполнитель', { exact: true }).inputValue(), 'Автор');
  assert.equal(await page.getByLabel('Длительность, ММ:СС', { exact: true }).inputValue(), '02:03');
  assert.equal(await page.getByLabel('Версия записи', { exact: true }).inputValue(), 'Оригинальная запись');

  // Successful empty searches must not inherit Retry-After as a rate limit.
  response = { status: 200, contentType: 'application/json', headers: { 'Retry-After': '60' }, body: '[]' };
  await search(page, 'no such song'); await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('Ничего не найдено'));
  assert.equal(await page.locator('.lrclib-result').count(), 0);
  response = records; await search(page); await page.waitForSelector('.lrclib-result');

  // A syntactically bad LRC is unavailable and cannot change the song.
  const beforeInvalid = (await page.evaluate(async () => (await import('./storage.js')).loadSet())).songs.find(item => item.id === 'second');
  response = [{ ...records[0], id: 4, syncedLyrics: '[bad timestamp]broken' }];
  await page.locator('#lrclib-title').fill('bad lrc'); await search(page, 'bad lrc'); await page.waitForSelector('.lrclib-result');
  assert.equal(await page.locator('.lrclib-result').first().getByRole('button', { name: 'LRC недоступен' }).isDisabled(), true);
  assert.equal(await page.locator('#lrclib-import').count(), 0);
  await expectSong(page, beforeInvalid);

  // Same-song edits, query edits and song switches invalidate a late response.
  await page.locator('.song-select').filter({ hasText: 'Тест & Test' }).first().click();
  stall(); await search(page, 'edit while pending', 'Автор'); await page.waitForSelector('#lrclib-cancel:not([hidden])');
  await page.getByLabel('Текст строки 1', { exact: true }).fill('Новая правка во время поиска'); await page.getByLabel('Текст строки 1', { exact: true }).blur(); releaseHold();
  await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('Песня изменилась'));
  assert.equal(await page.locator('.lrclib-result').count(), 0, 'late response cannot overwrite a same-song edit');
  stall(); await search(page, 'slow', 'Автор'); await page.waitForSelector('#lrclib-cancel:not([hidden])');
  await page.locator('#lrclib-title').fill('new query'); assert.equal(await page.locator('.lrclib-result').count(), 0);
  await page.locator('.song-select').filter({ hasText: 'Тест & Test' }).first().click(); releaseHold(); await page.waitForTimeout(80);
  assert.equal(await page.locator('.lrclib-result').count(), 0, 'stale result cannot cross song boundary');

  response = { status: 503, contentType: 'text/plain', body: 'service unavailable' };
  await search(page, 'service failure'); await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('503'));
  response = new Error('network offline');
  await search(page, 'network failure'); await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('Не удалось связаться'));
  stall(); await search(page, 'timeout'); await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('15 секунд'), null, { timeout: 17000 }); releaseHold();
  response = { status: 429, headers: { 'Retry-After': '60' }, body: 'slow down' };
  await search(page); await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('временно ограничил'));
  const rateLimitedCount = requests.length; await search(page); await page.waitForTimeout(80);
  assert.equal(requests.length, rateLimitedCount, 'retry cooldown prevents another request');
  assert.match(await page.locator('#lrclib-status').textContent(), /попросил подождать/i);

  // The same controls are usable at the root route and at a narrow keyboard viewport.
  const narrow = await context.newPage(); await narrow.setViewportSize({ width: 375, height: 740 }); await load(narrow, '/');
  await narrow.locator('#lrclib-title').focus(); await narrow.locator('#lrclib-title').press('Control+A'); await narrow.locator('#lrclib-title').fill('keyboard');
  response = records; await narrow.locator('#lrclib-title').press('Enter'); await narrow.waitForSelector('.lrclib-result');
  await narrow.locator('.lrclib-result').first().getByRole('button', { name: 'Просмотреть LRC' }).click();
  await narrow.waitForFunction(() => !document.querySelector('.toast'));
  await narrow.screenshot({ path: output + '/mobile.png', fullPage: true });
  assert.equal(await narrow.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'narrow LRCLIB panel has no horizontal overflow');
  const beforeOfflineRequest = requests.length; await narrow.context().setOffline(true); await narrow.locator('#lrclib-title').fill('offline'); await narrow.locator('#lrclib-title').press('Enter');
  await narrow.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('подключении'));
  assert.equal(requests.length, beforeOfflineRequest, 'offline search does not contact LRCLIB'); await narrow.context().setOffline(false);
  await narrow.close();
  assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
  console.log('LRCLIB browser: explicit, private, safe import, failure/race, and narrow-route flows passed.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
}
