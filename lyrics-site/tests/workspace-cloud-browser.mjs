import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { exportPortableSet } from '../public/portable.js';
import { connectTestWorkspace, installWorkspaceDirectory } from './workspace-test-directory.mjs';

const port = Number(process.env.LYRICS_WORKSPACE_CLOUD_PORT || 8140);
const apiPort = Number(process.env.LYRICS_WORKSPACE_CLOUD_API_PORT || port + 1);
const origin = `http://127.0.0.1:${port}/lyrics/`;
const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-workspace-cloud-'));
const password = 'ephemeral workspace cloud test password';
const salt = Buffer.alloc(16, 41);
const credentials = resolve(temporary, 'credentials.json');
const env = {
  ...process.env,
  LYRICS_DATA_DIR: resolve(temporary, 'api-data'),
  LYRICS_PASSWORD_FILE: credentials,
  LYRICS_ORIGIN: new URL(origin).origin,
  LYRICS_COOKIE_PATH: '/',
  LYRICS_COOKIE_SECURE: 'false',
};
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const python = process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python';
const api = spawn(python, ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
const firstDirectory = resolve(temporary, 'performance-folder-one');
const secondDirectory = resolve(temporary, 'performance-folder-two');
let logs = '';
api.stderr.on('data', chunk => { logs += chunk; });
server.stderr.on('data', chunk => { logs += chunk; });
let browser;

function wave(seconds = 5) {
  const bytes = Buffer.alloc(44 + 8000 * seconds * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let offset = 44; offset < bytes.length; offset += 2) bytes.writeInt16LE(Math.round(Math.sin((offset - 44) / 15) * 900), offset);
  return bytes;
}

function makeSong(id, title, text, backing = false) {
  return {
    schemaVersion: 1, id, title, artist: 'Проверка облака', version: '', language: 'ru', duration: 5, delayMs: 0,
    reviewed: true, source: { kind: 'manual', fileName: '' },
    cues: [{ id: `${id}-one`, start: 0.2, text: `${text} — первая строка`, type: 'lyric' }, { id: `${id}-two`, start: 2, text: `${text} — вторая строка`, type: 'lyric' }],
    ...(backing ? { backing: { fileName: `${id}.wav` } } : {}),
  };
}

async function login(page) {
  await page.locator('#login').click();
  await page.locator('#login-password').fill(password);
  await page.locator('#login-form button[type=submit]').click();
  await page.locator('#logout').waitFor({ state: 'visible' });
}

async function stateInPage(page) {
  return page.evaluate(async () => (await import('./local-workspace.js')).localState());
}

async function cloudInPage(page) {
  return page.evaluate(async () => {
    const remote = await import('./remote.js');
    const [projects, library] = await Promise.all([remote.listProjects(), remote.listLibrary()]);
    return { projects: projects.projects, library: library.songs };
  });
}

async function waitToast(page, expression) {
  try { await page.waitForFunction(pattern => [...document.querySelectorAll('.toast')].some(toast => new RegExp(pattern, 'i').test(toast.textContent)), expression); }
  catch (error) { throw new Error(`Expected toast /${expression}/; current toasts: ${(await page.locator('.toast').allTextContents()).join(' | ') || '(none)'}`, { cause: error }); }
}

try {
  await mkdir(firstDirectory, { recursive: true });
  await mkdir(secondDirectory, { recursive: true });

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`Ephemeral API and web servers failed to start: ${logs}`);

  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const firstContext = await browser.newContext({ viewport: { width: 1360, height: 950 }, acceptDownloads: true });
  const page = await firstContext.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.on('dialog', dialog => dialog.accept());
  await installWorkspaceDirectory(page, firstDirectory);
  await page.goto(origin);
  await page.evaluate(() => {
    window.__toastHistory = [];
    new MutationObserver(() => document.querySelectorAll('.toast').forEach(item => {
      if (!window.__toastHistory.includes(item.textContent)) window.__toastHistory.push(item.textContent);
    })).observe(document.body, { childList: true, subtree: true });
  });
  await connectTestWorkspace(page);
  const sourceSongs = [
    makeSong('cloud-backing', 'Минусовка для выступления', 'Минусовка', true),
    makeSong('cloud-lyrics', 'Текст без минусовки', 'Только текст'),
    makeSong('standalone-only', 'Отдельная песня', 'Библиотека'),
  ];
  const sourceSet = { schemaVersion: 1, id: 'cloud-source-set', name: 'Проект для облака', songs: sourceSongs };
  const archive = await exportPortableSet(sourceSet, async song => song.id === 'cloud-backing' ? new Blob([wave()], { type: 'audio/wav' }) : null);
  await page.locator('#set-file').setInputFiles({ name: 'cloud-source.zip', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
  await page.locator('#local-save-status').filter({ hasText: 'Сохранено' }).waitFor();
  await page.locator('#back-home').click();
  assert.equal(await page.evaluate(async () => (await fetch('./api/projects')).status), 401, 'cloud projects remain private before login.');
  await login(page);

  let audioUploads = 0;
  let importPostRequests = 0;
  let lostImportResponses = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/audio')) audioUploads += 1; });
  let loseFirstImportResponse = true;
  await page.route('**/api/imports', async route => {
    const response = await route.fetch();
    if (loseFirstImportResponse && route.request().method() === 'POST') {
      importPostRequests += 1;
      loseFirstImportResponse = false;
      lostImportResponses += 1;
      await route.abort();
    } else {
      if (route.request().method() === 'POST') importPostRequests += 1;
      await route.fulfill({ response });
    }
  });

  const projectCard = name => page.locator('#hub-list [data-local-id]').filter({ hasText: name });
  await projectCard('Проект для облака').getByRole('button', { name: 'Загрузить в облако', exact: true }).click();
  for (let attempt = 0; attempt < 200 && !lostImportResponses; attempt += 1) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(lostImportResponses, 1, `upload import response was intercepted and dropped (requests=${importPostRequests}); toast history: ${await page.evaluate(() => window.__toastHistory.join(' | '))}`);
  await page.waitForTimeout(250);
  assert.match(await page.evaluate(() => window.__toastHistory.join(' | ')), /fetch|сеть|связ|ошиб|не удалось/i, 'the lost import response is reported to the user.');
  assert.equal(audioUploads, 1, 'the backing file reached the API before the import response was lost.');
  const afterLostResponse = await cloudInPage(page);
  assert.equal(afterLostResponse.projects.length, 1, 'the server committed the first upload despite the lost response.');
  assert.equal(afterLostResponse.projects[0].name, 'Проект для облака');

  await projectCard('Проект для облака').getByRole('button', { name: 'Загрузить в облако', exact: true }).click();
  await waitToast(page, 'Загружено в облако');
  const projectState = await stateInPage(page);
  const localProject = projectState.projects.find(item => item.name === 'Проект для облака');
  const projectLink = projectState.links[`project:${localProject.id}`];
  assert.ok(projectLink, 'the retried upload records its cloud link locally.');
  assert.equal((await cloudInPage(page)).projects.length, 1, 'retry uses the migration key and does not duplicate the cloud project.');
  assert.equal(audioUploads, 1, 'retry does not upload already committed backing bytes again.');
  const uploaded = await page.evaluate(async id => (await (await import('./remote.js')).getProject(id)), projectLink.id);
  assert.equal(uploaded.songs.length, 3);
  assert.ok(uploaded.songs[0].backingAudioId);
  const cloudAudioBase64 = await page.evaluate(async id => {
    const bytes = new Uint8Array(await (await (await import('./remote.js')).downloadAudio(id)).arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  }, uploaded.songs[0].backingAudioId);
  assert.equal(Buffer.from(cloudAudioBase64, 'base64').compare(wave()), 0, 'cloud upload preserves the exact backing bytes.');
  assert.equal(uploaded.songs[0].song.id, uploaded.songs[0].songId, 'the server pins a cloud song revision in the project.');

  await page.locator('#library').click();
  const standaloneCard = page.locator('#hub-list [data-local-id]').filter({ hasText: 'Отдельная песня' });
  await standaloneCard.getByRole('button', { name: 'Загрузить в облако', exact: true }).click();
  await waitToast(page, 'Загружено в облако');
  const afterStandalone = await cloudInPage(page);
  assert.equal(afterStandalone.projects.length, 1, 'uploading a standalone library song does not create a cloud project.');
  assert.ok(afterStandalone.library.some(song => song.title === 'Отдельная песня'));

  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const secondPage = await secondContext.newPage();
  secondPage.setDefaultTimeout(20000);
  const secondErrors = [];
  secondPage.on('pageerror', error => secondErrors.push(error.message));
  await secondPage.on('dialog', dialog => dialog.accept());
  await installWorkspaceDirectory(secondPage, secondDirectory);
  await secondPage.goto(origin);
  await connectTestWorkspace(secondPage);
  await login(secondPage);
  const cloudProjectCard = secondPage.locator('#hub-list [data-cloud-id]').filter({ hasText: 'Проект для облака' });
  await cloudProjectCard.getByRole('button', { name: '↓ Скачать для выступления', exact: true }).click();
  const downloadedCard = secondPage.locator('#hub-list [data-local-id]').filter({ hasText: 'Проект для облака' });
  await downloadedCard.waitFor();
  await secondPage.waitForFunction(() => [...document.querySelectorAll('#hub-list .hub-card[data-local-id] .hub-readiness')].some(node => node.textContent.includes('Готов к запуску без интернета')));
  const secondState = await stateInPage(secondPage);
  const downloadedProject = secondState.projects.find(item => item.name === 'Проект для облака');
  assert.ok(downloadedProject);
  assert.equal(downloadedProject.songs.length, 3);
  assert.ok(downloadedProject.songs[0].backing?.fileName);
  const persistedWorkspace = resolve(secondDirectory, 'kaada-workspace');
  assert.ok((await readdir(resolve(persistedWorkspace, 'snapshots'))).some(name => name.endsWith('.commit.json')));
  assert.ok((await readdir(resolve(persistedWorkspace, 'audio'))).some(name => name.endsWith('.bin')));

  await secondPage.locator('#logout').click();
  await secondContext.setOffline(true);
  await downloadedCard.getByRole('button', { name: '▶ Запустить', exact: true }).click();
  await secondPage.locator('#event-view:not([hidden])').waitFor();
  await secondPage.locator('#event-start').click();
  await secondPage.waitForFunction(() => Number(document.querySelector('#event-progress').value) > 0.1);
  assert.equal(await secondPage.locator('#event-audio-status').isVisible(), false, 'lyrics and backing begin from the selected local directory while logged out and offline.');
  await secondContext.setOffline(false);

  // Change the cloud revision independently, then verify a local edit cannot overwrite it.
  const cloudChanged = await page.evaluate(async id => {
    const remote = await import('./remote.js');
    const current = await remote.getProject(id);
    const songs = current.songs.map((entry, index) => index ? entry : ({ ...entry, song: { ...entry.song, title: 'Минусовка — облачная версия' } }));
    return remote.saveProject(id, { revision: current.revision, name: current.name, songs });
  }, projectLink.id);
  assert.equal(cloudChanged.songs[0].song.title, 'Минусовка — облачная версия');
  await page.locator('#projects').click();
  await projectCard('Проект для облака').getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.locator('#preparation-view').waitFor({ state: 'visible' });
  await page.getByLabel('Название', { exact: true }).first().fill('Минусовка — локальная версия');
  await page.getByLabel('Название', { exact: true }).first().blur();
  await page.locator('#local-save-status').filter({ hasText: 'Сохранено' }).waitFor();
  await page.locator('#back-home').click();
  const uploadsBeforeConflict = audioUploads;
  await projectCard('Проект для облака').getByRole('button', { name: 'Обновить в облаке', exact: true }).click();
  await waitToast(page, 'В облаке другая версия');
  assert.equal(audioUploads, uploadsBeforeConflict, 'revision mismatch blocks before re-uploading audio.');
  const cloudAfterConflict = await page.evaluate(async id => (await (await import('./remote.js')).getProject(id)), projectLink.id);
  assert.equal(cloudAfterConflict.songs[0].song.title, 'Минусовка — облачная версия');
  const retainedLocal = (await stateInPage(page)).projects.find(item => item.id === localProject.id);
  assert.equal(retainedLocal.songs[0].title, 'Минусовка — локальная версия');

  await page.locator('#projects').click();
  const conflictCard = projectCard('Проект для облака');
  await conflictCard.getByRole('button', { name: 'Скачать версию из облака', exact: true }).click();
  const conflictCopy = page.locator('#hub-list [data-local-id]').filter({ hasText: 'Проект для облака — версия из облака' });
  await conflictCopy.waitFor();
  const afterConflictDownload = await stateInPage(page);
  assert.equal(afterConflictDownload.projects.length, 2, 'the newer cloud revision downloads as a separate project copy.');
  assert.equal(afterConflictDownload.projects.find(item => item.id === localProject.id).songs[0].title, 'Минусовка — локальная версия');
  assert.equal(afterConflictDownload.projects.find(item => item.id !== localProject.id).songs[0].title, 'Минусовка — облачная версия');
  assert.equal((await page.evaluate(async id => (await (await import('./remote.js')).getProject(id)).songs[0].song.title, projectLink.id)), 'Минусовка — облачная версия');
  await page.locator('#hub-create').click();
  await page.locator('#local-project-name').fill('Dirty cloud draft');
  await page.locator('#new-project-location').selectOption('cloud');
  await page.locator('#create-local-project-form button[type=submit]').click();
  await page.locator('#preparation-view').waitFor({ state: 'visible' });
  await page.locator('#add-song').click();
  await page.getByLabel('Название', { exact: true }).fill('Unsaved cloud song');
  await page.getByLabel('Название', { exact: true }).blur();
  await page.locator('#projects').click();
  page.removeAllListeners('dialog');
  page.once('dialog', dialog => dialog.dismiss());
  await projectCard('Проект для облака').first().getByRole('button', { name: '▶ Запустить', exact: true }).click();
  assert.equal(await page.locator('#event-view').isVisible(), false, 'cancelling a project switch must not launch the previous project');
  assert.deepEqual(errors, []);
  assert.deepEqual(secondErrors, []);
  console.log('PASS: idempotent cloud project retry, standalone song upload, complete offline download and playback, and conflict-preserving version download.');
  await secondContext.close(); await firstContext.close();
} finally {
  await browser?.close();
  api.kill('SIGTERM'); server.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 150));
  await rm(temporary, { recursive: true, force: true });
}
