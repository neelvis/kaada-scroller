import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { chromium } from 'playwright';
import { installWorkspaceDirectory } from './workspace-test-directory.mjs';

// TL-AC66–AC71: exercise actual UI, authenticated API, and durable directory bytes.
const port = Number(process.env.LYRICS_CLOUD_LIBRARY_PORT || 8144);
const apiPort = Number(process.env.LYRICS_CLOUD_LIBRARY_API_PORT || port + 1);
const origin = `http://127.0.0.1:${port}/lyrics/`;
const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-cloud-library-'));
const directory = resolve(temporary, 'performance-copy');
const output = resolve(process.env.LYRICS_TEST_OUTPUT || 'test-results');
const password = 'ephemeral cloud library test password';
const salt = Buffer.alloc(16, 53);
const credentials = resolve(temporary, 'credentials.json');
const python = process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python';
const env = { ...process.env, LYRICS_DATA_DIR: resolve(temporary, 'api-data'), LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const api = spawn(python, ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let logs = '', browser;
for (const child of [api, server]) { child.stderr.on('data', chunk => { logs += chunk; }); child.on('error', error => { logs += error.message; }); }
const songFixture = (id, title, artist, version = '') => ({ schemaVersion: 1, id, title, artist, version, language: 'ru', duration: 8, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [{ id: `${id}-a`, start: .2, type: 'lyric', text: 'Первая строка' }, { id: `${id}-b`, start: 3, type: 'lyric', text: 'Вторая строка' }] });
function wave() {
  const bytes = Buffer.alloc(44 + 8000 * 8 * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40); return bytes;
}
async function cloud(page) { return page.evaluate(async () => { const remote = await import('./remote.js'); return { library: (await remote.listLibrary()).songs, projects: (await remote.listProjects()).projects }; }); }
async function getSong(page, id) { return page.evaluate(async id => (await import('./remote.js')).getSong(id), id); }
async function getProject(page, id) { return page.evaluate(async id => (await import('./remote.js')).getProject(id), id); }
async function waitSong(page, id, expected) { await page.waitForFunction(async ({ id, expected }) => { const { song } = await (await import('./remote.js')).getSong(id); return Object.entries(expected).every(([key, value]) => song[key] === value); }, { id, expected }); }
async function toast(page, pattern) { await page.waitForFunction(pattern => [...document.querySelectorAll('.toast')].some(item => new RegExp(pattern).test(item.textContent)), pattern); }
const saveSongButton = page => page.locator('.song-actions button').filter({ hasText: /^Сохранить в облаке$/ });
const copyButton = page => page.locator('.song-actions button').filter({ hasText: /^Сохранить копию$/ });
async function changeField(page, label, value) { const field = page.getByLabel(label, { exact: true }); await field.fill(value); await field.dispatchEvent('change'); }
async function confirmReady(page) { await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click(); await page.locator('.status-pill.ready').waitFor(); }
async function showLibrary(page) { await page.locator('#library').click(); await page.locator('#hub-filter').waitFor({ state: 'hidden' }); assert.equal(await page.locator('#save-project').isVisible(), false, 'home hides the project editor save action'); assert.equal(await page.locator('#remote-state').isVisible(), false, 'home hides the project editor save status'); }
function libraryCard(page, id) { return page.locator(`#hub-list [data-cloud-id="${id}"]`); }
async function openLibrary(page, id) { await showLibrary(page); await libraryCard(page, id).getByRole('button', { name: 'Открыть', exact: true }).click(); await page.getByLabel('Название', { exact: true }).waitFor(); }
async function openProject(page, id) { await page.locator('#projects').click(); await libraryCard(page, id).getByRole('button', { name: 'Открыть', exact: true }).click(); await page.locator('#song-list .song-select').first().click(); await page.getByLabel('Название', { exact: true }).waitFor(); }
async function waitProjectSaved(page) { await page.waitForFunction(() => document.querySelector('#remote-state').textContent === 'Сохранено в облаке'); }

try {
  await mkdir(directory, { recursive: true }); await mkdir(output, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) { try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!ready) throw new Error(`Ephemeral servers failed to start: ${logs}`);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await installWorkspaceDirectory(page, directory);
  await page.goto(origin);
  assert.equal(await page.evaluate(async () => (await fetch('./api/library')).status), 401, 'the library requires authentication');
  await page.locator('#login').click(); await page.locator('#login-password').fill(password); await page.locator('#login-form button[type=submit]').click(); await page.locator('#logout').waitFor({ state: 'visible' });
  // The ordinary cloud creation flow needs no selected directory or local library.
  await showLibrary(page); await page.locator('#hub-create').click();
  await changeField(page, 'Название', 'Песня из формы'); await changeField(page, 'Исполнитель', 'Проверка формы');
  await changeField(page, 'Версия записи', 'Версия из формы'); await changeField(page, 'Длительность, ММ:СС', '00:08');
  await page.getByRole('tab', { name: 'Свой LRC', exact: true }).click();
  await page.getByLabel('LRC с таймкодами', { exact: true }).fill('[00:00.20]Первая строка\n[00:03.00]Вторая строка');
  await page.getByRole('button', { name: 'Заменить из LRC', exact: true }).click();
  assert.equal(await saveSongButton(page).isDisabled(), true); await confirmReady(page); await saveSongButton(page).click();
  await page.waitForFunction(async () => (await (await import('./remote.js')).listLibrary()).songs.some(song => song.title === 'Песня из формы'));
  const createdSong = (await cloud(page)).library.find(song => song.title === 'Песня из формы');
  assert.equal(createdSong.version, 'Версия из формы');
  assert.deepEqual(await page.evaluate(async () => { const workspace = await import('./local-workspace.js'); return { library: workspace.localState().library, connected: Boolean(workspace.connectedWorkspace()) }; }), { library: [], connected: false }, 'creating a cloud song does not create a local library or require a directory');
  assert.equal((await getSong(page, createdSong.id)).song.cues.length, 2);
  await page.locator('#projects').click(); await page.locator('#hub-create').click();
  await page.locator('#local-project-name').fill('Проект из формы'); await page.locator('#create-local-project-form button[type=submit]').click();
  await page.locator('#add-library-song').waitFor({ state: 'visible' }); await page.locator('#add-library-song').click();
  await page.locator('#library-dialog').getByRole('checkbox', { name: 'Песня из формы', exact: true }).check();
  await page.locator('#library-add-selected').click(); await page.locator('#save-project').click(); await waitProjectSaved(page);
  const createdProject = (await cloud(page)).projects.find(project => project.name === 'Проект из формы');
  assert.ok(createdProject); assert.deepEqual((await getProject(page, createdProject.id)).songs.map(entry => entry.songId), [createdSong.id], 'adding a song from the library reuses its cloud identity');
  assert.equal((await cloud(page)).library.length, 1);
  assert.equal(await page.evaluate(async () => Boolean((await import('./local-workspace.js')).connectedWorkspace())), false, 'cloud project creation also requires no directory');
  await page.locator('#projects').click(); await libraryCard(page, createdProject.id).getByRole('button', { name: 'Удалить проект', exact: true }).click();
  await page.waitForFunction(async () => (await (await import('./remote.js')).listProjects()).projects.length === 0);
  await showLibrary(page); await libraryCard(page, createdSong.id).getByRole('button', { name: 'Удалить песню', exact: true }).click();
  await page.waitForFunction(async () => (await (await import('./remote.js')).listLibrary()).songs.length === 0);
  await page.locator('#projects').click();
  await page.locator('#workspace-connect').click();
  await page.waitForFunction(name => document.querySelector('#workspace-status').textContent === name, basename(directory));
  await page.evaluate(() => { window.__selectedDirectoryPicker = window.showDirectoryPicker; window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); }; });
  await page.locator('#workspace-connect').click();
  assert.equal(await page.locator('#workspace-status').innerText(), basename(directory), 'cancelled directory selection preserves the chosen directory');
  await page.evaluate(() => { window.showDirectoryPicker = window.__selectedDirectoryPicker; delete window.__selectedDirectoryPicker; });
  assert.equal(await page.locator('#workspace-connect').innerText(), 'Локальная копия');
  assert.equal(await page.locator('#workspace-connect').getAttribute('data-tooltip'), 'папка для сохранения проектов для офлайн-работы');
  assert.equal(await page.locator('#migrate-browser').count(), 0);
  assert.equal(await page.locator('#new-project-location').getAttribute('type'), 'hidden');
  const seeded = await page.evaluate(async ({ fixtures, bytes }) => {
    const remote = await import('./remote.js');
    const backing = await remote.uploadAudio(new File([new Uint8Array(bytes)], 'performance.wav', { type: 'audio/wav' }));
    const songs = [];
    for (const [index, song] of fixtures.entries()) songs.push(await remote.createSong({ song, migrationKey: `browser-seed-${index}`, ...(index === 0 ? { backingAudioId: backing.id } : {}) }));
    const makeProject = async (name, entries) => { const project = await remote.createProject(name); return remote.saveProject(project.id, { revision: project.revision, name, songs: entries }); };
    return { songs, first: await makeProject('Первая программа', [songs[0], songs[1], songs[0]]), second: await makeProject('Вторая программа', [songs[1], songs[0]]) };
  }, { fixtures: [songFixture('shared', 'Общая песня', 'Ансамбль', 'Концерт 2026'), songFixture('other', 'Другая песня', 'Солист'), songFixture('legacy', 'Прежний черновик', 'Архив')], bytes: [...wave()] });
  const [shared, other, legacy] = seeded.songs;
  // Historical databases can contain unconfirmed songs; new writes correctly reject them.
  const legacySetup = spawnSync(python, ['-c', 'import json,sqlite3,sys\ndb=sqlite3.connect(sys.argv[1])\nrow=db.execute("SELECT id,body FROM song_revisions WHERE song_id=? ORDER BY rowid DESC LIMIT 1",(sys.argv[2],)).fetchone()\nsong=json.loads(row[1]);song["reviewed"]=False\ndb.execute("UPDATE song_revisions SET body=? WHERE id=?",(json.dumps(song,ensure_ascii=False,sort_keys=True,separators=(",",":")),row[0]));db.commit()', resolve(env.LYRICS_DATA_DIR, 'lyrics.sqlite3'), legacy.songId], { encoding: 'utf8' });
  assert.equal(legacySetup.status, 0, legacySetup.stderr);
  await showLibrary(page); await libraryCard(page, shared.songId).waitFor();
  assert.equal(await page.locator('#hub-list [data-local-id]').count(), 0, 'library only renders cloud songs');
  assert.equal(await libraryCard(page, shared.songId).getByRole('button', { name: '▶ Запустить', exact: true }).isEnabled(), true);
  assert.equal(await libraryCard(page, legacy.songId).getByRole('button', { name: '▶ Запустить', exact: true }).isDisabled(), true);
  const disabledPlay = libraryCard(page, legacy.songId).locator('.hub-disabled-play');
  await disabledPlay.focus(); assert.equal(await disabledPlay.getByRole('tooltip').isVisible(), true);
  assert.equal(await disabledPlay.getByRole('tooltip').innerText(), 'подтвердите готовность песни');
  await page.locator('#hub-title').click(); await disabledPlay.hover(); assert.equal(await disabledPlay.getByRole('tooltip').isVisible(), true);
  assert.equal(await libraryCard(page, other.songId).locator('.hub-recording-version').count(), 0);
  for (const query of ['Общая песня', 'Ансамбль', 'Концерт 2026']) { await page.locator('#hub-search').fill(query); assert.equal(await page.locator('#hub-list .hub-card').count(), 1); }
  const createBox = await page.locator('#hub-create').boundingBox(), searchBox = await page.locator('#hub-search').boundingBox(); assert.ok(createBox.y + createBox.height < searchBox.y);
  await libraryCard(page, shared.songId).getByRole('button', { name: '▶ Запустить', exact: true }).click(); await page.locator('#event-view').waitFor({ state: 'visible' }); await page.locator('#event-start').click(); await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > .1); await page.locator('#exit-event').click();

  await openLibrary(page, shared.songId);
  assert.equal(await page.getByLabel('Название', { exact: true }).isEditable(), true);
  assert.equal(await page.locator('#show-mode').isVisible(), false, 'standalone library playback belongs to song cards');
  const initialRevision = (await getSong(page, shared.songId)).revisionId;
  await changeField(page, 'Название', 'Общая песня — правка');
  assert.equal(await saveSongButton(page).isDisabled(), true, 'a material edit invalidates readiness');
  assert.equal((await getSong(page, shared.songId)).revisionId, initialRevision, 'editing alone never publishes');
  await confirmReady(page);
  assert.match(await page.locator('.review-row').innerText(), /Таймлайн был подтверждён, но последующие изменения отменяют подтверждение\./);
  await page.route(`**/api/songs/${shared.songId}`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { error: 'Проверка сбоя сохранения' } }) : route.continue());
  await saveSongButton(page).click(); await toast(page, 'Проверка сбоя сохранения');
  assert.equal(await page.getByLabel('Название', { exact: true }).inputValue(), 'Общая песня — правка');
  assert.equal((await getSong(page, shared.songId)).revisionId, initialRevision);
  await page.unroute(`**/api/songs/${shared.songId}`);
  await saveSongButton(page).click(); await waitSong(page, shared.songId, { title: 'Общая песня — правка' });
  await changeField(page, 'Текст строки 1', 'Исправленная строка');
  // A save may still be refreshing the editor after its server write completes.
  await page.waitForFunction(() => document.querySelector('.cue-text')?.value === 'Исправленная строка' && document.querySelector('.status-pill')?.textContent === 'Нужно проверить');
  assert.equal(await saveSongButton(page).isDisabled(), true, 'lyric edits invalidate readiness');
  await changeField(page, 'Время строки 1', '00:00.50'); await confirmReady(page); await saveSongButton(page).click();
  await page.waitForFunction(async id => { const { song } = await (await import('./remote.js')).getSong(id); return song.cues[0].text === 'Исправленная строка' && song.cues[0].start === .5; }, shared.songId);
  await copyButton(page).click(); await toast(page, 'уже есть');
  assert.equal((await cloud(page)).library.length, 3, 'an identical copy is rejected');
  await changeField(page, 'Название', '  Общая песня — правка  '); await confirmReady(page); await copyButton(page).click(); await toast(page, 'уже есть');
  assert.equal((await cloud(page)).library.length, 3, 'outer whitespace alone does not permit a copy');
  await changeField(page, 'Название', 'Общая песня — правка');
  await changeField(page, 'Версия записи', 'Студия'); await confirmReady(page); await copyButton(page).click(); await toast(page, 'Копия сохранена');
  const copied = (await cloud(page)).library.find(song => song.version === 'Студия'); assert.ok(copied); assert.notEqual(copied.id, shared.songId);
  assert.equal((await getSong(page, shared.songId)).song.version, 'Концерт 2026', 'saving a copy leaves the original unchanged');

  await openProject(page, seeded.first.id);
  assert.match(await page.locator('#song-list .song-item').first().innerText(), /Концерт 2026/);
  assert.equal(await page.getByLabel('Название', { exact: true }).inputValue(), 'Общая песня — правка', 'projects resolve the latest library song');
  await changeField(page, 'Название', 'Общая песня — из проекта');
  await page.locator('#save-project').click(); await toast(page, 'Подтвердите готовность изменённых песен');
  assert.equal((await getSong(page, shared.songId)).song.title, 'Общая песня — правка');
  await confirmReady(page); await page.locator('#save-project').click(); await waitProjectSaved(page);
  await waitSong(page, shared.songId, { title: 'Общая песня — из проекта' });
  const second = await getProject(page, seeded.second.id); assert.equal(second.songs[1].song.title, 'Общая песня — из проекта');
  assert.deepEqual(second.songs.map(entry => entry.songId), [other.songId, shared.songId]);

  await page.locator('#projects').click();
  await libraryCard(page, seeded.first.id).getByRole('button', { name: 'Сохранить локальную копию', exact: true }).click(); await toast(page, 'Локальная копия проекта сохранена');
  const workspace = resolve(directory, 'kaada-workspace');
  const commitsBefore = (await readdir(resolve(workspace, 'snapshots'))).filter(name => name.endsWith('.commit.json')).length;
  assert.ok(commitsBefore > 0); assert.ok((await readdir(resolve(workspace, 'audio'))).some(name => name.endsWith('.bin')));
  const localBeforeFailedWrite = await page.evaluate(async () => (await import('./local-workspace.js')).localState().projects);
  await page.evaluate(() => { window.__workingWorkspaceFs = window.__workspaceFs; window.__workspaceFs = async (...args) => { if (args[0] === 'write') throw new Error('Проверка ошибки локальной записи'); return window.__workingWorkspaceFs(...args); }; });
  await changeField(page, 'Название', 'Общая песня — единое сохранение'); await confirmReady(page); await page.locator('#save-project').click();
  await page.waitForFunction(() => document.querySelector('#remote-state').textContent.includes('локальную копию нужно обновить'));
  await toast(page, 'Проверка ошибки локальной записи');
  assert.deepEqual(await page.evaluate(async () => (await import('./local-workspace.js')).localState().projects), localBeforeFailedWrite, 'a failed local write preserves the previous local snapshot');
  const cloudAfterLocalFailure = await getProject(page, seeded.first.id);
  assert.equal(cloudAfterLocalFailure.songs[0].song.title, 'Общая песня — единое сохранение', 'cloud success is retained independently of local failure');
  await page.evaluate(() => { window.__workspaceFs = window.__workingWorkspaceFs; delete window.__workingWorkspaceFs; });
  await page.locator('#save-project').click(); await waitProjectSaved(page);
  assert.equal((await getProject(page, seeded.first.id)).revision, cloudAfterLocalFailure.revision, 'retry refreshes only the pending local snapshot without another cloud write');
  await waitSong(page, shared.songId, { title: 'Общая песня — единое сохранение' });
  await page.waitForFunction(async expected => (await import('./local-workspace.js')).localState().projects.some(item => item.songs[0]?.title === expected), 'Общая песня — единое сохранение');
  assert.ok((await readdir(resolve(workspace, 'snapshots'))).filter(name => name.endsWith('.commit.json')).length > commitsBefore, 'unified save refreshes durable local snapshot');
  // Later cloud changes do not silently replace the last successful local snapshot.
  await page.evaluate(async id => { const remote = await import('./remote.js'); const entry = await remote.getSong(id); return remote.saveSong(id, { ...entry, song: { ...entry.song, title: 'Общая песня — новая облачная правка' } }); }, shared.songId);
  await openProject(page, seeded.first.id);
  assert.equal(await page.getByLabel('Название', { exact: true }).inputValue(), 'Общая песня — новая облачная правка');
  await page.waitForFunction(() => document.querySelector('#backing-preview')?.getAttribute('src')?.startsWith('blob:'));
  let editorAudioRequests = 0; const countEditorAudio = request => { if (request.url().includes('/api/audio/') && request.method() === 'GET') editorAudioRequests++; }; page.on('request', countEditorAudio);
  await page.locator('#show-mode').click(); await page.locator('#event-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#event-song-name').innerText(), 'Общая песня — единое сохранение', 'editor launch uses lyrics from the complete local snapshot');
  await page.locator('#event-start').click(); await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > .2);
  assert.equal(await page.locator('#event-audio-status').isVisible(), false); assert.equal(editorAudioRequests, 0, 'editor launch also reads local backing without cloud asset downloads'); page.off('request', countEditorAudio);
  await page.locator('#exit-event').click();
  await page.locator('#projects').click(); const localCard = libraryCard(page, seeded.first.id); await localCard.locator('.hub-readiness').filter({ hasText: 'сохранены локально' }).waitFor();
  let audioRequests = 0; const countAudio = request => { if (request.url().includes('/api/audio/') && request.method() === 'GET') audioRequests++; }; page.on('request', countAudio);
  await localCard.getByRole('button', { name: '▶ Запустить', exact: true }).click(); await page.locator('#event-view').waitFor({ state: 'visible' }); await page.locator('#event-start').click(); await page.waitForFunction(() => Number(document.querySelector('#event-progress').value) > .2);
  assert.equal(await page.locator('#event-audio-status').isVisible(), false); assert.equal(audioRequests, 0, 'local launch/playback reads backing bytes from directory without cloud asset downloads'); page.off('request', countAudio);
  await page.locator('#exit-event').click();

  const staleProject = await getProject(page, seeded.first.id);
  const localBeforeDeletion = await page.evaluate(async () => (await import('./local-workspace.js')).localState().projects);
  await showLibrary(page); await libraryCard(page, shared.songId).getByRole('button', { name: 'Удалить песню', exact: true }).click(); await toast(page, 'Песня удалена из библиотеки');
  assert.equal((await cloud(page)).library.some(song => song.id === shared.songId), false);
  const firstAfter = await getProject(page, seeded.first.id), secondAfter = await getProject(page, seeded.second.id);
  assert.deepEqual(firstAfter.songs.map(entry => entry.songId), [other.songId], 'all duplicate project occurrences are removed');
  assert.deepEqual(secondAfter.songs.map(entry => entry.songId), [other.songId]);
  assert.equal((await cloud(page)).projects.length, 2, 'deletion retains both projects');
  assert.deepEqual(await page.evaluate(async () => (await import('./local-workspace.js')).localState().projects), localBeforeDeletion, 'cloud deletion does not erase or alter saved local snapshot');
  const staleResult = await page.evaluate(async ({ stale, revision }) => { try { await (await import('./remote.js')).saveProject(stale.id, { revision, name: stale.name, songs: stale.songs }); return 'saved'; } catch (error) { return error.status; } }, { stale: staleProject, revision: firstAfter.revision });
  assert.equal(staleResult, 404, 'a stale editor cannot recreate a deleted library song');
  await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0);
  for (const width of [1360, 375, 320]) {
    await page.setViewportSize({ width, height: 950 });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].map(item => ({ tag: item.tagName, id: item.id, className: typeof item.className === 'string' ? item.className : '', right: item.getBoundingClientRect().right, width: item.getBoundingClientRect().width })).filter(item => item.width && item.right > innerWidth + 1));
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) await page.screenshot({ path: '/tmp/cloud-library-overflow.png', fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `no page overflow at ${width}px: ${JSON.stringify(overflow)}`);
    await page.screenshot({ path: resolve(output, `cloud-library-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: UI cloud song/project creation without a directory; cloud-only library and filters; per-song playback/readiness tooltip; editable readiness/save failure retry; duplicate/version copy; current songs across projects; unified durable local refresh and local-asset playback; cascading song deletion; responsive widths.');
  await context.close();
} finally {
  await browser?.close(); api.kill('SIGTERM'); server.kill('SIGTERM'); await new Promise(resolve => setTimeout(resolve, 150)); await rm(temporary, { recursive: true, force: true });
}
