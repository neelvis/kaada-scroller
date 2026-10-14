import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { scryptSync } from 'node:crypto';
import { chromium } from 'playwright';

const port = Number(process.env.LYRICS_PLAIN_SERVER_PORT || 8127);
const apiPort = Number(process.env.LYRICS_PLAIN_API_PORT || 8128);
const origin = `http://127.0.0.1:${port}`;
const temporary = await mkdtemp(tmpdir() + '/lyrics-plain-server-');
const password = 'ephemeral plain-song organizer password';
const salt = Buffer.alloc(16, 29);
await writeFile(temporary + '/credentials.json', JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: temporary + '/data', LYRICS_PASSWORD_FILE: temporary + '/credentials.json', LYRICS_ORIGIN: origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const python = process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python';
const api = spawn(python, ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let logs = '';
api.stderr.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
let browser;
const lyricText = ['Первая строка', 'Second line <i>', 'Припев', 'Припев', 'Последняя строка'].join('\n');
const lrclibRecord = { id: 91, trackName: 'Untimed shared song', artistName: 'Test artist', albumName: 'Plain album', duration: 70, instrumental: false, syncedLyrics: null, plainLyrics: lyricText };
let lyricRequests = 0;

async function login(page) {
  await page.locator('#login').click(); await page.locator('#login-password').fill(password);
  await page.locator('#login-form button[type=submit]').click(); await page.waitForSelector('#logout', { state: 'visible' });
}
async function createProject(page, name) {
  await page.locator('#projects').click(); await page.locator('#new-project-name').fill(name); await page.locator('#create-project').click();
  await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
  if (await page.locator('.song-select').count()) await page.locator('.song-select').first().click();
}
async function openProject(page, name) {
  await page.locator('#projects').click();
  const row = page.locator('#project-list .project-row').filter({ hasText: name });
  await row.getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
  if (await page.locator('.song-select').count()) await page.locator('.song-select').first().click();
}
async function save(page) {
  await page.locator('#save-project').click();
  await page.waitForFunction(() => document.querySelector('#remote-state').textContent === 'Сохранено на сервере');
}
async function getProject(page, id) {
  return page.evaluate(async id => (await (await import('./remote.js')).getProject(id)), id);
}
async function projectByName(page, name) {
  return page.evaluate(async name => (await (await import('./remote.js')).listProjects()).projects.find(project => project.name === name), name);
}
async function addPlainSong(page) {
  await page.locator('#add-song').click();
  await page.locator('#lrclib-title').fill('Untimed shared song');
  await page.locator('#lrclib-search-form').evaluate(form => form.requestSubmit());
  await page.waitForSelector('.lrclib-result');
  await page.locator('.lrclib-result').first().getByRole('button', { name: 'Вставить чистый текст' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.cue-row').length === 5);
  assert.deepEqual(await page.locator('.cue-row').evaluateAll(rows => rows.map(row => row.querySelectorAll('input')[1].value)), lyricText.split('\n'));
  assert.equal(await page.locator('.cue-row').first().locator('input').first().inputValue(), '');
  await page.locator('#ignore-timecodes').check();
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click();
  assert.equal(await page.locator('.status-pill').textContent(), 'Готова');
}

try {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(origin + '/lyrics/api/health')).ok) break; }
    catch { if (i === 79) throw new Error(`ephemeral servers failed: ${logs}`); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('https://lrclib.net/api/search**', async route => {
    lyricRequests += 1;
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([lrclibRecord]) });
  });

  await page.goto(origin + '/lyrics/'); await login(page); await createProject(page, 'Plain persistence source'); await addPlainSong(page);
  assert.match(await page.locator('#remote-state').textContent(), /несохранённые/i);
  const sourceBeforeSave = await projectByName(page, 'Plain persistence source');
  assert.equal((await getProject(page, sourceBeforeSave.id)).songs.length, 0, 'plain preparation is not saved to the shared project implicitly');
  await save(page);
  const source = await projectByName(page, 'Plain persistence source');
  const savedSource = await getProject(page, source.id);
  const savedSong = savedSource.songs[0].song;
  assert.equal(savedSong.ignoreTimecodes, true); assert.equal(savedSong.reviewed, true);
  assert.deepEqual(savedSong.cues.map(cue => cue.text), lyricText.split('\n'));
  assert.ok(savedSong.cues.every(cue => cue.start === null));

  // A server reload/reopen must restore both the per-song mode and untimed cues.
  await page.reload(); await openProject(page, 'Plain persistence source');
  assert.equal(await page.locator('#ignore-timecodes').isChecked(), true);
  assert.ok((await page.locator('.cue-row').evaluateAll(rows => rows.every(row => row.querySelector('input').value === ''))));

  // Exercise the portable archive boundary using the saved server song.
  const portableSong = await page.evaluate(async song => {
    const portable = await import('./portable.js');
    const sourceSet = { schemaVersion: 1, id: 'plain-portable', name: 'Plain portable', songs: [song] };
    const archive = await portable.exportPortableSet(sourceSet, async () => null);
    return (await portable.importPortableSet(archive)).set.songs[0];
  }, savedSong);
  assert.equal(portableSong.ignoreTimecodes, true);
  assert.deepEqual(portableSong.cues.map(cue => cue.start), Array(5).fill(null));

  // Reuse the saved revision in another project, then explicitly save that project.
  await createProject(page, 'Plain library destination');
  await page.locator('#add-library-song').click();
  await page.locator('#library-list .project-row').filter({ hasText: 'Untimed shared song' }).getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.cue-row').length === 5);
  assert.equal(await page.locator('#ignore-timecodes').isChecked(), true);
  await save(page);
  const destination = await projectByName(page, 'Plain library destination');
  const reused = (await getProject(page, destination.id)).songs[0].song;
  assert.equal(reused.ignoreTimecodes, true);
  assert.deepEqual(reused.cues.map(cue => cue.text), lyricText.split('\n'));
  assert.ok(reused.cues.every(cue => cue.start === null));

  // The prepared snapshot can reopen and start with no network call to LRCLIB.
  await page.locator('#prepare-offline').click();
  await page.waitForFunction(async () => (await (await import('./offline-projects.js')).preparedProjects()).some(item => item.name === 'Plain library destination'));
  const beforeOfflineStart = lyricRequests;
  await context.setOffline(true); await page.reload();
  await page.waitForFunction(() => !document.querySelector('#offline-projects').hidden);
  await page.locator('#offline-projects').click();
  await page.locator('#project-list .project-row').filter({ hasText: 'Plain library destination' }).getByRole('button', { name: 'Открыть без сети', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
  await page.locator('.song-select').first().click();
  assert.equal(await page.locator('#ignore-timecodes').isChecked(), true);
  assert.ok((await page.locator('.cue-row').evaluateAll(rows => rows.every(row => row.querySelector('input').value === ''))));
  await page.getByRole('button', { name: 'Режим показа', exact: true }).click();
  await page.locator('#event-start').click();
  await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > 0.05);
  assert.equal(lyricRequests, beforeOfflineStart, 'offline Start does not request LRCLIB');
  assert.deepEqual(errors, []);
  console.log('PASS: plain-song explicit shared save, reopen, library reuse, portable archive, and offline Start.');
} finally {
  if (browser) await browser.close();
  api.kill('SIGTERM'); server.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 150));
  await rm(temporary, { recursive: true, force: true });
}
