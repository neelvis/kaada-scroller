import { installWorkspaceDirectory, connectTestWorkspace } from './workspace-test-directory.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const port = 8117, origin = `http://127.0.0.1:${port}`;
const output = process.env.LYRICS_TEST_OUTPUT || 'test-results/plain-scroll';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe' });
let browser;
const workspaceDirectory = await mkdtemp(tmpdir() + '/kaada-scroll-');
const fixture = { schemaVersion: 1, id: 'plain-set', name: 'Plain', songs: [{ schemaVersion: 1, id: 'plain', title: 'Песня', artist: 'Автор', version: 'Original', language: 'ru', duration: 30, delayMs: 5000, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [{ id: 'old', start: 1, text: 'Existing', type: 'lyric' }] }] };
const text = ['Первый куплет', 'Hello <b>world</b>', 'Припев', 'Припев', 'Длинная строка '.repeat(24), 'Финал'].join('\n');
const records = [{ id: 1, trackName: 'Песня', artistName: 'Автор', albumName: 'Album', duration: 70, instrumental: false, syncedLyrics: null, plainLyrics: text }, { id: 2, trackName: 'No text', artistName: 'Автор', albumName: '', duration: 80, instrumental: false, syncedLyrics: null, plainLyrics: null }];
async function stored(page) { return page.evaluate(async () => (await import('./local-workspace.js')).localState().projects.at(-1).songs[0]); }
async function seek(page, value) { await page.locator('#event-progress').evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); }, value); }
async function position(page) { return page.locator('#audience-lines').evaluate(el => {
  const first = el.children[0], last = el.children[el.children.length - 1];
  const start = first.offsetTop + first.offsetHeight / 2, end = last.offsetTop + last.offsetHeight / 2;
  const y = -new DOMMatrix(getComputedStyle(el).transform).m42;
  return { y, ratio: end === start ? 0 : (y - start) / (end - start) };
}); }
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/lyrics/')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  await installWorkspaceDirectory(page, workspaceDirectory);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://lrclib.net/api/search*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(records), headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.goto(origin + '/lyrics/'); await connectTestWorkspace(page);
  await page.locator('#set-file').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.locator('.song-select').first().click();
  assert.equal(await page.getByRole('tab', { name: 'Свой текст', exact: true }).count(), 1);
  await page.locator('#plain-tab').click(); assert.equal(await page.locator('#plain-panel h2').textContent(), 'Свой текст'); await page.locator('#lrclib-tab').click();
  const search = async () => { await page.locator('#lrclib-search-form').getByRole('button', { name: 'Найти LRC', exact: true }).click(); await page.waitForSelector('.lrclib-result'); };
  await search();
  await page.setViewportSize({ width: 320, height: 780 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 5000 });
  await page.screenshot({ path: output + '/plain-import-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.locator('.lrclib-result').nth(1).getByRole('button', { name: 'Вставить чистый текст' }).isDisabled(), true);
  await page.locator('.lrclib-result').first().getByRole('button', { name: 'Вставить чистый текст' }).click();
  await page.locator('#confirm-dialog button[value=cancel]').click();
  assert.equal((await stored(page)).cues[0].text, 'Existing');
  await page.locator('.lrclib-result').first().getByRole('button', { name: 'Вставить чистый текст' }).click();
  await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => document.querySelectorAll('.cue-row').length === 6);
  const saved = await stored(page);
  assert.equal(saved.duration, 70); assert.equal(saved.reviewed, false); assert.equal(saved.delayMs, 5000);
  assert.deepEqual(saved.cues.map(cue => cue.text), text.split('\n')); assert.ok(saved.cues.every(cue => cue.start === null)); assert.equal(saved.ignoreTimecodes, false);
  assert.ok((await page.locator('.validation').textContent()).includes('не задано время'));
  await page.locator('#ignore-timecodes').check();
  assert.equal((await page.locator('.validation').textContent()).includes('не задано время'), false);
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click(); assert.equal(await page.locator('.status-pill').textContent(), 'Готова');
  assert.equal((await stored(page)).reviewed, true);
  await page.waitForFunction(() => document.querySelector('#local-save-status').textContent === 'Сохранено');
  await page.reload(); await connectTestWorkspace(page); await page.locator('#hub-list .hub-card[data-local-id]').last().getByRole('button', {name:'Открыть',exact:true}).click(); await page.locator('#song-list .song-select').first().click(); assert.equal(await page.locator('#ignore-timecodes').isChecked(), true);
  await page.locator('#show-mode').click(); assert.equal(await page.locator('#event-view').isVisible(), true, JSON.stringify({ saved: await stored(page), errors })); assert.equal(await page.locator('#audience-lines b').count(), 0);
  assert.deepEqual(errors, []);
  for (const time of [0, 5, 10]) { await seek(page, time); assert.ok(Math.abs((await position(page)).ratio) < .001); }
  await seek(page, 40); assert.ok(Math.abs((await position(page)).ratio - .5) < .001);
  await page.locator('#font-up').click(); assert.ok(Math.abs((await position(page)).ratio - .5) < .001);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100); assert.ok(Math.abs((await position(page)).ratio - .5) < .001);
  await page.screenshot({ path: output + '/uniform-mobile.png' });
  await seek(page, 69.9); assert.ok((await position(page)).ratio > .99);
  await seek(page, 25); await page.locator('#event-start').click(); await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > 25.2);
  await page.locator('#event-start').click(); const paused = await position(page); await page.waitForTimeout(250); assert.equal((await position(page)).y, paused.y);
  await page.locator('#event-start').click(); await page.waitForFunction(y => -new DOMMatrix(getComputedStyle(document.querySelector('#audience-lines')).transform).m42 > y, paused.y);
  await page.locator('#event-start').click(); await seek(page, 5); assert.ok(Math.abs((await position(page)).ratio) < .001);
  await page.locator('#event-reset').click(); assert.equal(await page.locator('#event-progress').inputValue(), '0');
  await seek(page, 70); assert.equal(await page.locator('.audience-line.neutral').textContent(), 'Песня закончилась');
  await seek(page, 40); assert.ok(Math.abs((await position(page)).ratio - .5) < .001);
  await page.locator('#exit-event').click(); await page.locator('#ignore-timecodes').uncheck();
  assert.ok((await page.locator('.validation').textContent()).includes('не задано время')); assert.ok((await stored(page)).cues.every(cue => cue.start === null));
  await search(); await page.locator('input[aria-label="Текст строки 1"]').fill('New edit'); await page.locator('input[aria-label="Текст строки 1"]').blur();
  await page.locator('.lrclib-result').first().getByRole('button', { name: 'Вставить чистый текст' }).click();
  assert.ok((await page.locator('#lrclib-status').textContent()).includes('Песня изменилась')); assert.equal((await stored(page)).cues[0].text, 'New edit');
  // Backing playback uses the same uniform timeline, including paused seeks.
  const backingSong = { ...fixture.songs[0], duration: 70, delayMs: 0, ignoreTimecodes: true, reviewed: true,
    cues: Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, start: null, text: `Line ${i}`, type: 'lyric' })) };
  const importSong = async (song, path = '/lyrics/') => {
    await page.goto(origin + path); await connectTestWorkspace(page);
    await page.locator('#set-file').setInputFiles({ name: 'case.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...fixture, songs: [song] })) });
    await page.locator('.song-select').first().click();
  };
  await importSong(backingSong, '/');
  const wave = Buffer.alloc(44 + 16000 * 70 * 2);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(wave.length - 44, 40);
  await page.locator('#backing-file').setInputFiles({ name: 'backing.wav', mimeType: 'audio/wav', buffer: wave });
  await page.waitForFunction(() => document.querySelector('.backing-card .file-name')?.textContent.includes('backing.wav'));
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click();
  await page.locator('#show-mode').click(); await seek(page, 40);
  assert.ok(Math.abs((await position(page)).ratio - .5) < .001);
  await page.locator('#event-start').click(); await page.waitForFunction(() => document.querySelector('#event-player')?.currentTime > 40);
  await page.locator('#event-start').click(); const backingPaused = await position(page); await page.waitForTimeout(250);
  assert.equal((await position(page)).y, backingPaused.y);
  await seek(page, 25); assert.ok(Math.abs((await position(page)).ratio - .25) < .001);
  await page.locator('#event-start').click(); await page.waitForFunction(() => document.querySelector('#event-player')?.currentTime > 25);
  await page.locator('#event-reset').click(); assert.ok(Math.abs((await position(page)).ratio) < .001); await page.locator('#exit-event').click();
  // Short songs retain the initial position, and one-line songs never travel.
  for (const song of [{ ...backingSong, duration: 5 }, { ...backingSong, cues: [backingSong.cues[0]] }]) {
    await importSong(song); await page.locator('#show-mode').click();
    const initial = (await position(page)).y;
    await seek(page, song.duration - .1); assert.equal((await position(page)).y, initial);
    await seek(page, song.duration); assert.equal(await page.locator('.audience-line.neutral').textContent(), 'Песня закончилась');
    await page.locator('#exit-event').click();
  }
  assert.deepEqual(errors, []); console.log('PASS: plain import, readiness, persistence, uniform positions, wrapping, controls and stale guard');
} finally { if (browser) await browser.close(); server.kill(); await rm(workspaceDirectory, { recursive: true, force: true }); }
