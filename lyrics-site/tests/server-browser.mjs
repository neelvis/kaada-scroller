import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const port = Number(process.env.LYRICS_SERVER_TEST_PORT || 8104);
const apiPort = port + 1;
const origin = `http://127.0.0.1:${port}`;
const temporary = await mkdtemp(tmpdir() + '/lyrics-browser-');
const password = 'test-only organizer password';
const salt = Buffer.alloc(16, 7);
const { scryptSync } = await import('node:crypto');
await writeFile(temporary + '/credentials.json', JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const output = process.env.LYRICS_TEST_OUTPUT || 'test-results/server';
await mkdir(output, { recursive: true });
const env = { ...process.env, LYRICS_DATA_DIR: temporary + '/data', LYRICS_PASSWORD_FILE: temporary + '/credentials.json', LYRICS_ORIGIN: origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const api = spawn('backend/.venv/bin/python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let logs = ''; api.stderr.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
let browser;
function wave(seconds = 5) {
  const bytes = Buffer.alloc(44 + 16000 * seconds * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}
const song = index => ({ schemaVersion: 1, id: `legacy-${index}`, title: `Песня ${index + 1}`, artist: 'Школа', version: 'Оригинал', language: 'ru', duration: 5, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [{ id: 'a', start: .15, text: 'Первая строка', type: 'lyric' }, { id: 'b', start: 2, text: 'Вторая строка', type: 'lyric' }] });
async function login(page) {
  await page.locator('#login').click(); await page.locator('#login-password').fill(password);
  await page.locator('#login-form button[type=submit]').click(); await page.waitForSelector('#logout', { state: 'visible' });
}
async function apiCall(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const module = await import('./remote.js'); if (method !== 'GET') await module.session();
    if (method === 'PUT') return module.saveProject(path, body);
    if (method === 'POST') return module.createProject(body);
    const response = await fetch('./api/' + path); return { status: response.status, data: await response.json() };
  }, { path, method, body });
}
async function openProject(page, name) {
  await page.locator('#projects').click(); const row = page.locator('#project-list .project-row').filter({ hasText: name }).filter({ hasNot: page.getByText('подготовлен для показа') });
  await row.getByRole('button', { name: 'Открыть', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
}
async function save(page) {
  await page.locator('#save-project').click(); await page.waitForFunction(() => document.querySelector('#remote-state').textContent === 'Сохранено на сервере');
}
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + '/lyrics/api/health')).ok) break; } catch {}
    if (i === 79) throw new Error('Servers failed to start: ' + logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const first = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const second = await browser.newContext();
  const page = await first.newPage(); const other = await second.newPage(); const errors = [];
  let uploads = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/audio')) uploads += 1; });
  for (const tab of [page, other]) { tab.on('pageerror', error => errors.push(error.message)); tab.on('dialog', dialog => dialog.accept()); }
  await page.goto(origin + '/lyrics/'); await other.goto(origin + '/lyrics/');
  assert.equal((await apiCall(page, 'projects')).status, 401);
  await login(page); await login(other);
  const legacy = { schemaVersion: 1, id: 'migration-test', name: 'Концерт 25', songs: Array.from({ length: 25 }, (_, i) => song(i)) };
  await page.locator('#set-file').setInputFiles({ name: 'concert.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 25);
  await page.evaluate(async bytes => { const storage = await import('./storage.js'); await storage.putAudio('legacy-0', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' })); }, [...wave()]);
  await page.locator('#projects').click(); await page.locator('#migration-audio').check(); await page.locator('#migrate-legacy').click();
  await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
  assert.equal(await page.locator('.song-item').count(), 25);
  let projects = (await apiCall(page, 'projects')).data.projects;
  const id = projects.find(item => item.name === 'Концерт 25').id;
  let saved = (await apiCall(page, `projects/${id}`)).data;
  assert.equal(saved.songs.length, 25); assert.ok(saved.songs[0].audioId);
  assert.notEqual(saved.songs[0].song.id, 'legacy-0');
  const audioId = saved.songs[0].audioId;
  const uploadsAfterMigration = uploads;
  assert.equal(await page.evaluate(async () => (await (await import('./storage.js')).loadSet()).songs[0].id), 'legacy-0');
  await page.locator('#projects').click(); await page.locator('#migrate-legacy').click();
  await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
  assert.equal((await apiCall(page, 'projects')).data.projects.length, 1, 'migration retry creates no duplicate project');
  assert.equal((await apiCall(page, `projects/${id}`)).data.songs[0].audioId, audioId);
  assert.equal(uploads, uploadsAfterMigration, 'completed migration lookup avoids repeated audio upload/quota');
  await openProject(other, 'Концерт 25'); assert.equal(await other.locator('.song-item').count(), 25);
  assert.equal((await other.request.get(origin + '/lyrics/api/audio/' + audioId)).status(), 200, 'second device has original audio');
  assert.equal(await page.evaluate(async () => (await (await import('./storage.js')).getAudio('legacy-0')).size), wave().length);
  const pinned = await apiCall(page, '', 'POST', 'Второй концерт');
  await apiCall(page, pinned.id, 'PUT', { revision: pinned.revision, name: pinned.name, songs: [saved.songs[0]] });
  await page.getByLabel('Текст строки 1', { exact: true }).fill('Правка первого концерта'); await page.getByLabel('Текст строки 1', { exact: true }).blur();
  await save(page);
  assert.equal((await apiCall(page, `projects/${pinned.id}`)).data.songs[0].song.cues[0].text, 'Первая строка', 'other project keeps pinned revision');
  await other.getByLabel('Текст строки 1', { exact: true }).fill('Черновик второго устройства'); await other.getByLabel('Текст строки 1', { exact: true }).blur();
  await other.locator('#save-project').click(); await other.waitForFunction(() => document.querySelector('#remote-state').textContent.includes('не удалось'));
  assert.equal(await other.getByLabel('Текст строки 1', { exact: true }).inputValue(), 'Черновик второго устройства');
  await other.reload(); await openProject(other, 'Концерт 25');
  assert.equal(await other.getByLabel('Текст строки 1', { exact: true }).inputValue(), 'Черновик второго устройства', 'durable conflicting draft restores');
  // Restore readiness after editing, then save an explicit immutable offline snapshot.
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click(); await save(page);
  await page.waitForFunction(() => document.querySelector('#offline-state').textContent.includes('Готово'));
  await page.getByRole('button', { name: 'Подготовить показ', exact: true }).click();
  await page.waitForFunction(async () => (await (await import('./offline-projects.js')).preparedProjects()).length === 1);
  await page.screenshot({ path: output + '/projects.png', fullPage: true });
  await first.setOffline(true); await page.reload(); await page.locator('#projects').click();
  await page.getByRole('button', { name: 'Открыть без сети', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
  assert.equal(await page.getByLabel('Текст строки 1', { exact: true }).isDisabled(), true);
  assert.equal(await page.locator('.song-reorder:not(:disabled)').count(), 0);
  await page.getByRole('button', { name: 'Режим показа', exact: true }).click(); await page.locator('#event-start').click();
  await page.waitForFunction(() => document.querySelector('.audience-line.active')?.textContent === 'Правка первого концерта');
  await page.locator('#event-reset').click(); await page.locator('#exit-event').click(); await first.setOffline(false);
  await page.reload(); await page.waitForSelector('#logout', { state: 'visible' });
  // Logout removes private v2 data without deleting legacy audio or unrelated browser data.
  await page.locator('#logout').click(); await page.waitForSelector('#login', { state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#login').disabled);
  assert.equal((await apiCall(page, 'projects')).status, 401);
  assert.equal((await page.request.get(origin + '/lyrics/api/audio/' + audioId)).status(), 401);
  assert.equal(await page.evaluate(async () => (await (await import('./offline-projects.js')).preparedProjects()).length), 0);
  assert.equal(await page.evaluate(async () => (await (await import('./storage.js')).loadSet()).songs.length), 25);
  await login(page);
  await page.locator('#projects').click(); await page.locator('#new-project-name').fill('Новая загрузка'); await page.locator('#create-project').click();
  await page.waitForFunction(() => !document.querySelector('#projects-dialog').open);
  await page.locator('#add-song').click();
  await page.getByLabel('Название', { exact: true }).fill('Новая песня'); await page.getByLabel('Название', { exact: true }).blur();
  await page.locator('input[type=file][accept*="audio/mpeg"]').setInputFiles({ name: 'original.wav', mimeType: 'audio/x-wav', buffer: wave() });
  await page.waitForFunction(() => document.querySelector('.file-name')?.textContent === 'original.wav');
  await page.locator('textarea').first().fill('[00:00.15]Новая строка\n[00:02.00]Ещё строка');
  await page.getByRole('button', { name: 'Заменить из LRC', exact: true }).click();
  await page.getByLabel('Длительность, секунды', { exact: true }).fill('5'); await page.getByLabel('Длительность, секунды', { exact: true }).blur();
  await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click(); await save(page);
  const newId = (await apiCall(page, 'projects')).data.projects.find(item => item.name === 'Новая загрузка').id;
  assert.ok((await apiCall(page, `projects/${newId}`)).data.songs[0].audioId);
  await openProject(other, 'Новая загрузка'); assert.equal(await other.locator('.file-name').textContent(), 'original.wav');
  assert.equal(await other.getByLabel('Текст строки 1', { exact: true }).inputValue(), 'Новая строка');
  // Delay an already-committed save response, then edit again before it returns.
  let releaseSave, saveFetched;
  const saveReady = new Promise(resolve => { saveFetched = resolve; });
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  await page.route(`**/api/projects/${newId}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue();
    const response = await route.fetch(); saveFetched(); await saveGate; await route.fulfill({ response });
  });
  await page.getByLabel('Текст строки 1', { exact: true }).fill('Первое сохранение'); await page.getByLabel('Текст строки 1', { exact: true }).blur();
  await page.locator('#save-project').click(); await saveReady;
  await page.getByLabel('Текст строки 1', { exact: true }).fill('Новая правка во время сохранения'); await page.getByLabel('Текст строки 1', { exact: true }).blur();
  releaseSave(); await page.waitForTimeout(150); await page.unroute(`**/api/projects/${newId}`);
  assert.equal(await page.getByLabel('Текст строки 1', { exact: true }).inputValue(), 'Новая правка во время сохранения');
  await save(page);
  assert.equal((await apiCall(page, `projects/${newId}`)).data.songs[0].song.cues[0].text, 'Новая правка во время сохранения');
  // A slower open must not replace the project chosen later.
  let releaseOpen, openFetched;
  const openReady = new Promise(resolve => { openFetched = resolve; });
  const openGate = new Promise(resolve => { releaseOpen = resolve; });
  await page.route(`**/api/projects/${id}`, async route => { const response = await route.fetch(); openFetched(); await openGate; await route.fulfill({ response }); });
  await page.locator('#projects').click();
  await page.locator('#project-list .project-row').filter({ hasText: 'Концерт 25' }).getByRole('button', { name: 'Открыть', exact: true }).click(); await openReady;
  await page.locator('#project-list .project-row').filter({ hasText: 'Новая загрузка' }).getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#projects-dialog').open); releaseOpen(); await page.waitForTimeout(150); await page.unroute(`**/api/projects/${id}`);
  assert.equal(await page.locator('#set-name').inputValue(), 'Новая загрузка');
  // An authenticated read already in flight cannot repopulate private lyrics after logout.
  let releasePrivate, privateFetched;
  const privateReady = new Promise(resolve => { privateFetched = resolve; });
  const privateGate = new Promise(resolve => { releasePrivate = resolve; });
  await page.route(`**/api/projects/${newId}`, async route => { const response = await route.fetch(); privateFetched(); await privateGate; await route.fulfill({ response }); });
  await page.locator('#projects').click(); await page.locator('#project-list .project-row').filter({ hasText: 'Новая загрузка' }).getByRole('button', { name: 'Открыть', exact: true }).click(); await privateReady;
  await page.locator('#projects-dialog').press('Escape'); await page.locator('#logout').click(); await page.waitForSelector('#login', { state: 'visible' });
  releasePrivate(); await page.waitForTimeout(150); await page.unroute(`**/api/projects/${newId}`);
  assert.equal(await page.locator('#set-name').inputValue(), 'Концерт 25');
  assert.equal(await page.getByLabel('Текст строки 1', { exact: true }).inputValue(), 'Первая строка', 'late private response cannot restore server data');
  await login(page);
  await openProject(page, 'Новая загрузка');
  await page.getByLabel('Текст строки 1', { exact: true }).fill('Приватный черновик'); await page.getByLabel('Текст строки 1', { exact: true }).blur();
  let releaseLogout, logoutStarted;
  const logoutReady = new Promise(resolve => { logoutStarted = resolve; });
  const logoutGate = new Promise(resolve => { releaseLogout = resolve; });
  await page.route('**/api/logout', async route => { logoutStarted(); await logoutGate; await route.continue(); });
  await page.locator('#logout').click(); await logoutReady;
  assert.equal(await page.locator('#login').isVisible(), true, 'logout clears private view before network completes');
  assert.equal(await page.locator('#set-name').inputValue(), 'Концерт 25');
  assert.equal(await page.evaluate(async id => (await (await import('./offline-projects.js')).getDraft(id)) || null, newId), null, 'private draft cleared while request hangs');
  assert.equal(await page.evaluate(() => localStorage.getItem('lyrics-v2-pending-logout')), '1');
  releaseLogout(); await page.waitForFunction(() => !document.querySelector('#login').disabled); await page.unroute('**/api/logout');
  await login(page);
  await page.route('**/api/logout', route => route.abort());
  await page.locator('#logout').click(); await page.waitForSelector('#login', { state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#login').disabled);
  assert.equal(await page.evaluate(() => localStorage.getItem('lyrics-v2-pending-logout')), '1');
  assert.equal((await page.request.get(origin + '/lyrics/api/session')).status(), 200, 'unreachable logout has not claimed cookie revocation');
  await page.unroute('**/api/logout'); await page.reload(); await page.waitForSelector('#login', { state: 'visible' });
  assert.equal((await page.request.get(origin + '/lyrics/api/session')).status(), 401, 'reconnect revokes session using recovered CSRF');
  assert.equal(await page.evaluate(() => localStorage.getItem('lyrics-v2-pending-logout')), null);
  await page.evaluate(async () => {
    const cache = await import('./offline-projects.js');
    await cache.cacheProject({ id: 'interrupted-logout', name: 'Private snapshot', songs: [] });
    await cache.saveDraft({ id: 'interrupted-logout' }, { name: 'Private draft', songs: [] });
    await cache.putPrivateAudio('interrupted-logout:audio', new Blob(['private']));
    localStorage.setItem('lyrics-v2-pending-logout', '1');
  });
  await first.setOffline(true); await page.reload(); await page.waitForSelector('#login', { state: 'visible' });
  assert.deepEqual(await page.evaluate(async () => {
    const cache = await import('./offline-projects.js'); return [(await cache.preparedProjects()).length, (await cache.getDraft('interrupted-logout')) || null, (await cache.getPrivateAudio('interrupted-logout:audio')) || null];
  }), [0, null, null], 'pending logout startup clears private stores even while offline');
  await first.setOffline(false);
  await login(page); await page.reload(); await page.waitForSelector('#logout', { state: 'visible' });
  assert.equal(await page.evaluate(() => localStorage.getItem('lyrics-v2-pending-logout')), null, 'explicit new login finishes pending cleanup/revocation');
  // Identical artifact at domain root uses the same relative API contract.
  const rootContext = await browser.newContext(); const rootPage = await rootContext.newPage();
  await rootPage.goto(origin + '/'); await login(rootPage); assert.equal((await apiCall(rootPage, 'projects')).data.projects.length, 3);
  assert.deepEqual(errors, []);
  console.log('PASS: login, 25-song/audio migration + retry, new upload, second device, pins, durable conflict, offline readonly/show, private logout, deferred save/open/logout, root mount.');
} finally {
  if (browser) await browser.close(); api.kill('SIGTERM'); server.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 150)); await rm(temporary, { recursive: true, force: true });
  await writeFile(output + '/service.log', logs);
}
