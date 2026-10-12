import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { scryptSync } from 'node:crypto';
import { chromium } from 'playwright';

const port = Number(process.env.LYRICS_LRCLIB_SERVER_PORT || 8110);
const apiPort = Number(process.env.LYRICS_LRCLIB_API_PORT || 8111);
const origin = `http://127.0.0.1:${port}`;
const temporary = await mkdtemp(tmpdir() + '/lyrics-lrclib-');
const password = 'ephemeral lrclib organizer password';
const salt = Buffer.alloc(16, 13);
await writeFile(temporary + '/credentials.json', JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: temporary + '/data', LYRICS_PASSWORD_FILE: temporary + '/credentials.json', LYRICS_ORIGIN: origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const api = spawn('backend/.venv/bin/python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let logs = ''; api.stderr.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
let browser;
const lrc = '[00:00.10]literal <tag>\n[00:01.20][00:03.40]chorus';
let lyricRequests = 0; let changed = false; let holdSearch = false; let releaseSearch; let slowStarted;
const result = () => [{ id: 11, trackName: 'Literal song', artistName: 'Test artist', albumName: 'Test album', duration: 5, instrumental: false, syncedLyrics: changed ? '[00:00.10]new literal\n[00:01.20]new chorus' : lrc }];
async function login(page) { await page.locator('#login').click(); await page.locator('#login-password').fill(password); await page.locator('#login-form button[type=submit]').click(); await page.waitForSelector('#logout', { state: 'visible' }); }
async function createProject(page, name) { await page.locator('#projects').click(); await page.locator('#new-project-name').fill(name); await page.locator('#create-project').click(); await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); }
async function save(page) { await page.locator('#save-project').click(); await page.waitForFunction(() => document.querySelector('#remote-state').textContent === 'Сохранено на сервере'); }
async function apiCall(page, path, method = 'GET', body) { return page.evaluate(async ({ path, method, body }) => { const remote = await import('./remote.js'); if (method !== 'GET') await remote.session(); if (method === 'POST') return remote.createProject(body); if (method === 'PUT') return remote.saveProject(path, body); return remote.getProject(path); }, { path, method, body }); }
async function openProject(page, name) { await page.locator('#projects').click(); const row = page.locator('#project-list .project-row').filter({ hasText: name }); await row.getByRole('button', { name: 'Открыть', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); }
async function searchAndImport(page) {
  await page.locator('#lrclib-title').fill('Literal song');
  await page.locator('#lrclib-search-form').evaluate(form => form.requestSubmit());
  await page.getByRole('button', { name: 'Просмотреть LRC', exact: true }).click();
  await page.getByRole('button', { name: 'Импортировать LRC', exact: true }).click();
  if (await page.locator('#confirm-dialog').isVisible()) await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('LRC импортирован'));
}
async function beginSlowSearch(page) {
  holdSearch = true;
  const started = new Promise(resolve => { slowStarted = resolve; });
  await page.locator('#lrclib-title').fill('Literal song');
  await page.locator('#lrclib-search-form').evaluate(form => form.requestSubmit());
  await started;
}

try {
  for (let i = 0; i < 80; i += 1) { try { if ((await fetch(origin + '/lyrics/api/health')).ok) break; } catch {} if (i === 79) throw new Error('ephemeral servers failed: ' + logs); await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.route('https://lrclib.net/api/search**', async route => {
    lyricRequests += 1;
    if (holdSearch) await new Promise(resolve => { releaseSearch = resolve; slowStarted(); });
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result()) });
  });
  await page.goto(origin + '/lyrics/'); await login(page); await createProject(page, 'Первый LRCLIB проект');
  await page.locator('#add-song').click(); await page.getByLabel('Название', { exact: true }).fill('Literal song'); await page.getByLabel('Название', { exact: true }).blur();
  await searchAndImport(page);
  assert.deepEqual(await page.locator('.cue-row').evaluateAll(rows => rows.map(row => ({ time: row.querySelector('input').value, text: row.querySelectorAll('input')[1].value }))), [{ time: '0:00.1', text: 'literal <tag>' }, { time: '0:01.2', text: 'chorus' }, { time: '0:03.4', text: 'chorus' }]);
  assert.match(await page.locator('#remote-state').textContent(), /несохранённые/i);
  const unsavedProject = await page.evaluate(async () => (await (await import('./remote.js')).listProjects()).projects[0]);
  assert.equal((await apiCall(page, unsavedProject.id)).songs.length, 0, 'import never saves the server project implicitly');
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click(); await save(page);
  const firstProject = await page.evaluate(async () => (await (await import('./remote.js')).listProjects()).projects.find(item => item.name === 'Первый LRCLIB проект'));
  const savedFirst = await apiCall(page, firstProject.id); assert.equal(savedFirst.songs[0].song.cues[2].text, 'chorus'); assert.equal(savedFirst.songs[0].song.cues[2].start, 3.4);
  const second = await apiCall(page, '', 'POST', 'Второй закреплённый проект'); await apiCall(page, second.id, 'PUT', { revision: second.revision, name: second.name, songs: [savedFirst.songs[0]] });
  await openProject(page, 'Первый LRCLIB проект');
  assert.equal(await page.getByLabel('Текст строки 3', { exact: true }).inputValue(), 'chorus', 'saved import reopens with repeated lyrics');
  changed = true; await searchAndImport(page); await save(page);
  assert.equal((await apiCall(page, second.id)).songs[0].song.cues[0].text, 'literal <tag>', 'second project keeps the pinned shared revision');
  await openProject(page, 'Второй закреплённый проект'); await context.setOffline(true); await page.locator('#lrclib-search-form').evaluate(form => form.requestSubmit()); await page.waitForFunction(() => document.querySelector('#lrclib-status').textContent.includes('доступен при подключении')); await context.setOffline(false);
  await page.getByRole('button', { name: 'Подготовить показ', exact: true }).click(); await page.waitForFunction(async () => (await (await import('./offline-projects.js')).preparedProjects()).length === 1);
  await context.setOffline(true); await page.reload(); await page.locator('#projects').click(); await page.getByRole('button', { name: 'Открыть без сети', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
  assert.match(await page.locator('#lrclib-status').textContent(), /недоступен в автономном снимке/);
  assert.equal(await page.getByLabel('Текст строки 3', { exact: true }).inputValue(), 'chorus', 'offline snapshot retains repeated occurrences');
  const beforeStart = lyricRequests; await page.getByRole('button', { name: 'Режим показа', exact: true }).click(); await page.locator('#event-start').click(); await page.waitForFunction(() => document.querySelector('.audience-line.active')?.textContent === 'literal <tag>'); assert.equal(lyricRequests, beforeStart, 'offline Start makes no LRCLIB request');
  await page.locator('#exit-event').click();
  await context.setOffline(false); await page.reload(); await page.waitForSelector('#projects:not([disabled])'); if (await page.locator('#login').isVisible()) await login(page); await openProject(page, 'Первый LRCLIB проект');
  await beginSlowSearch(page);
  await openProject(page, 'Второй закреплённый проект'); holdSearch = false; releaseSearch();
  assert.equal(await page.locator('.lrclib-result').count(), 0, 'project switch cannot receive an obsolete result');
  await beginSlowSearch(page);
  await page.locator('#logout').click(); holdSearch = false; releaseSearch();
  await page.waitForSelector('#login', { state: 'visible' }); assert.equal(await page.locator('.cue-row').count(), 0, 'logout/new workspace cannot receive a pending import');
  assert.deepEqual(errors, []);
  console.log('PASS: LRCLIB shared draft/pin/offline/race integration.');
} finally {
  if (browser) await browser.close(); api.kill('SIGTERM'); server.kill('SIGTERM'); await new Promise(resolve => setTimeout(resolve, 150)); await rm(temporary, { recursive: true, force: true });
}
