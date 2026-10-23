import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// TL-AC27: synthetic songs/projects on an isolated real API plus browser UI.
const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-revision27-'));
const port = Number(process.env.LYRICS_REVISION27_PORT || 8184), apiPort = port + 1;
const origin = `http://127.0.0.1:${port}/lyrics/`;
const output = resolve(process.env.LYRICS_TEST_OUTPUT || 'test-results/revision-27');
const password = 'ephemeral revision 27 password', salt = Buffer.alloc(16, 27);
const credentials = resolve(temporary, 'credentials.json');
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: resolve(temporary, 'api-data'), LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const api = spawn(process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let browser, logs = '';
for (const child of [api, server]) { child.stderr.on('data', data => { logs += data; }); child.on('error', error => { logs += error.message; }); }

async function login(page) {
  await page.locator('#login').click(); await page.locator('#login-password').fill(password);
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#logout').waitFor({ state: 'visible' });
}
async function uploadCover(page, label, color) {
  const data = await page.evaluate(async color => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 240;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return await (await import('./artwork.js')).prepareArtwork(new File([blob], 'synthetic.png', { type: 'image/png' }));
  }, color);
  await page.getByLabel(label, { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64') });
  await page.waitForFunction(({ label, data }) => {
    const input = [...document.querySelectorAll('input[type=file]')].find(el => el.getAttribute('aria-label') === label);
    const preview = input?.closest('.project-song-cover-field')?.querySelector('img.song-cover-preview') || input?.closest('.cover-field')?.querySelector('img.song-cover-preview');
    return preview?.src === data;
  }, { label, data });
}

try {
  await mkdir(output, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Ephemeral services failed to start: ${logs}`);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.goto(origin); await login(page);

  const seeded = await page.evaluate(async () => {
    const remote = await import('./remote.js');
    const mkCover = async color => {
      const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 240;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 120, 240);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return await (await import('./artwork.js')).prepareArtwork(new File([blob], 'fixture.png', { type: 'image/png' }));
    };
    const song = { schemaVersion: 1, id: crypto.randomUUID(), title: 'Песня проекта', artist: 'Тест', album: 'Синтетический альбом', version: '', cover: await mkCover('#e34d4d'), projectCovers: [], language: 'ru', duration: 8, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [{ id: 'one', start: 1, type: 'lyric', text: 'Строка теста' }] };
    const created = await remote.createSong({ migrationKey: crypto.randomUUID(), song });
    const a = await remote.createProject('Проект A'), b = await remote.createProject('Проект B'), c = await remote.createProject('Посторонний проект');
    const entry = { songId: created.songId, revisionId: created.revisionId, song: created.song };
    const projects = [];
    for (const project of [a, b, c]) projects.push(await remote.saveProject(project.id, { revision: project.revision, name: project.name, cover: await mkCover(project.name === 'Проект A' ? '#33bb77' : '#3355cc'), songs: project.id === c.id ? [] : [entry] }));
    return { songId: created.songId, projectIds: projects.map(p => p.id), projectNames: projects.map(p => p.name), projectCovers: projects.map(p => p.cover) };
  });

  // Membership must be loaded from the real endpoint and exclude unrelated C.
  await page.locator('#library').click();
  const songCard = page.locator(`#hub-list [data-cloud-id="${seeded.songId}"]`);
  await songCard.waitFor();
  let membershipFailures = 0;
  await page.route(`**/api/songs/${seeded.songId}/projects`, async route => {
    if (!membershipFailures++) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'temporary test failure' }) });
    else await route.continue();
  });
  await songCard.locator('h2').click();
  try { await page.locator('.project-song-artwork').waitFor({ state: 'attached', timeout: 5000 }); }
  catch { await page.screenshot({ path: resolve(output, 'editor-open-failure.png') }); throw new Error(`Song editor did not open. Card: ${await songCard.innerText()}; Hub: ${await page.locator('#hub-message').innerText()}; editor: ${await page.locator('#editor').innerText()}; errors: ${errors.join(' | ')}`); }
  await page.getByLabel('Выбрать обложку: Основная обложка · JPG, PNG, WebP', { exact: true }).waitFor();
  await page.getByText('Не удалось загрузить проекты. Повторите попытку.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Выбрать обложку: Обложка песни · Посторонний проект', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Повторить загрузку проектов', exact: true }).click();
  await page.getByLabel('Выбрать обложку: Обложка песни · Проект A', { exact: true }).waitFor();
  await page.getByLabel('Выбрать обложку: Обложка песни · Проект B', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Выбрать обложку: Обложка песни · Посторонний проект', { exact: true }).count(), 0);
  await page.unroute(`**/api/songs/${seeded.songId}/projects`);

  // Assign three independent images; verify serialized song data and reload.
  await uploadCover(page, 'Выбрать обложку: Обложка песни · Проект A', '#ff0000');
  const validA = await page.locator('.project-song-cover-field').filter({ has: page.getByLabel('Выбрать обложку: Обложка песни · Проект A', { exact: true }) }).locator('img.song-cover-preview').getAttribute('src');
  await page.getByLabel('Выбрать обложку: Обложка песни · Проект A', { exact: true }).setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(toast => toast.textContent.includes('Не удалось')));
  assert.equal(await page.locator('.project-song-cover-field').filter({ has: page.getByLabel('Выбрать обложку: Обложка песни · Проект A', { exact: true }) }).locator('img.song-cover-preview').getAttribute('src'), validA, 'invalid upload leaves previous project cover intact');
  await uploadCover(page, 'Выбрать обложку: Обложка песни · Проект B', '#0000ff');
  await uploadCover(page, 'Выбрать обложку: Основная обложка · JPG, PNG, WebP', '#ffff00');
  await page.screenshot({ path: resolve(output, 'project-song-artwork-desktop.png') });
  await page.setViewportSize({ width: 375, height: 950 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'artwork editor fits a 375px viewport');
  await page.screenshot({ path: resolve(output, 'project-song-artwork-375.png') });
  await page.setViewportSize({ width: 1360, height: 950 });
  await page.locator('#save-project').click();
  await page.waitForFunction(() => document.querySelector('#remote-state')?.textContent === 'В облаке');
  let saved = await page.evaluate(async id => (await (await import('./remote.js')).getSong(id)).song, seeded.songId);
  assert.equal(saved.projectCovers.length, 2);
  assert.deepEqual(saved.projectCovers.map(item => item.projectId).sort(), seeded.projectIds.slice(0, 2).sort());
  const original = { primary: saved.cover, a: saved.projectCovers.find(item => item.projectId === seeded.projectIds[0]).cover, b: saved.projectCovers.find(item => item.projectId === seeded.projectIds[1]).cover };
  assert.notEqual(original.a, original.b); assert.notEqual(original.primary, original.a); assert.notEqual(original.primary, original.b);
  await page.reload(); await page.locator('#library').click(); await page.locator(`#hub-list [data-cloud-id="${seeded.songId}"] h2`).click();
  await page.getByLabel('Выбрать обложку: Обложка песни · Проект A', { exact: true }).waitFor();
  assert.equal(await page.locator('.project-song-artwork .song-cover-preview').count(), 2);

  const portableResult = await page.evaluate(async projectId => {
    const source = await (await import('./remote.js')).getProject(projectId);
    const portable = await import('./portable.js');
    const archive = await portable.exportPortableSet({ schemaVersion: 1, id: projectId, name: source.name, cover: source.cover, songs: source.songs.map(entry => entry.song) }, async () => null);
    const imported = await portable.importPortableSet(archive);
    const { downloadProjectFiles, uploadLocalProject } = await import('./cloud-transfers.js');
    const downloaded = await downloadProjectFiles(source);
    downloaded.local.songs[0].title += ' — portable copy';
    const reimported = await uploadLocalProject(downloaded.local, null);
    return { covers: imported.set.songs[0].projectCovers, copiedId: reimported.id, copiedCovers: reimported.songs[0].song.projectCovers };
  }, seeded.projectIds[0]);
  assert.deepEqual(portableResult.covers, saved.projectCovers, 'native portable round trip retains both independent assignments');
  assert.ok(portableResult.copiedCovers.some(item => item.projectId === portableResult.copiedId && item.cover === original.a));
  assert.ok(portableResult.copiedCovers.some(item => item.projectId === seeded.projectIds[1] && item.cover === original.b));

  // Standalone presentation uses the primary cover. Project A follows all four
  // fallback tiers, so B's assignment cannot leak into A's audience display.
  await page.locator('#library').click();
  await songCard.waitFor();
  const primaryLibraryImage = songCard.locator('.hub-card-cover');
  try { await primaryLibraryImage.waitFor({ timeout: 5000 }); } catch { await page.screenshot({ path: resolve(output, 'library-primary-missing.png') }); throw new Error(`Primary cover missing from library card: ${await songCard.innerText()}; cloud=${JSON.stringify(await page.evaluate(async id => (await (await import('./remote.js')).getSong(id)).song, seeded.songId))}`); }
  assert.equal(await primaryLibraryImage.evaluate(async el => { await el.decode(); return el.naturalWidth / el.naturalHeight; }), 0.5);
  await songCard.getByRole('button', { name: 'Запустить', exact: true }).click();
  await page.locator('#event-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#audience-cover').getAttribute('src'), original.primary);
  await page.locator('#event-home').click(); await page.locator('#home-view').waitFor({ state: 'visible' });

  async function launchProjectA() {
    await page.reload();
    await page.locator('#projects').click();
    const row = page.locator(`#hub-list [data-cloud-id="${seeded.projectIds[0]}"]`);
    await row.getByRole('button', { name: 'Запустить', exact: true }).click();
    await page.locator('#event-view').waitFor({ state: 'visible' });
    return await page.locator('#audience-cover').isHidden() ? null : page.locator('#audience-cover').getAttribute('src');
  }
  const colorAtCenter = async data => page.evaluate(async src => {
    const img = new Image(); img.src = src; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  }, data);
  assert.equal(await launchProjectA(), original.a, 'project-specific song cover is first fallback');
  await page.locator('#event-home').click();
  await page.evaluate(async ({ songId, projectId }) => {
    const remote = await import('./remote.js'), current = await remote.getSong(songId);
    const song = { ...current.song, projectCovers: current.song.projectCovers.filter(item => item.projectId !== projectId) };
    await remote.saveSong(songId, { revisionId: current.revisionId, song });
  }, { songId: seeded.songId, projectId: seeded.projectIds[0] });
  assert.deepEqual(await colorAtCenter(await launchProjectA()), await colorAtCenter(seeded.projectCovers[0]), 'project cover is second fallback; B artwork stays isolated');
  await page.locator('#event-home').click();
  await page.evaluate(async ({ projectId }) => {
    const remote = await import('./remote.js'), current = await remote.getProject(projectId);
    await remote.saveProject(projectId, { revision: current.revision, name: current.name, cover: '', songs: current.songs });
  }, { projectId: seeded.projectIds[0] });
  assert.equal(await launchProjectA(), original.primary, 'primary/album cover is third fallback');
  await page.locator('#event-home').click();
  await page.evaluate(async songId => {
    const remote = await import('./remote.js'), current = await remote.getSong(songId);
    await remote.saveSong(songId, { revisionId: current.revisionId, song: { ...current.song, cover: '' } });
  }, seeded.songId);
  assert.equal(await launchProjectA(), null, 'no artwork is the final fallback');
  await page.locator('#event-home').click(); await page.locator('#library').click();
  assert.equal(await songCard.locator('.hub-card-cover').count(), 0, 'library has no cover when primary artwork is absent');

  // Restore the independent covers, save A twice through actual UI/OPFS, and
  // rehearse after a network-disabled reload using the restored local handle.
  await page.evaluate(async ({ songId, original, projectIds }) => {
    const remote = await import('./remote.js'), current = await remote.getSong(songId);
    await remote.saveSong(songId, { revisionId: current.revisionId, song: { ...current.song, cover: original.primary, projectCovers: [{ projectId: projectIds[0], cover: original.a }, { projectId: projectIds[1], cover: original.b }] } });
    window.artworkWorkspace = await import('./local-workspace.js');
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('revision27', { create: true });
  }, { songId: seeded.songId, original, projectIds: seeded.projectIds });
  await page.locator('#workspace-connect').click();
  await page.waitForFunction(() => Boolean(window.artworkWorkspace.connectedWorkspace()));
  await page.locator('#projects').click();
  const projectCard = page.locator(`#hub-list [data-cloud-id="${seeded.projectIds[0]}"]`);
  await projectCard.getByRole('button', { name: 'Сохранить локальную копию', exact: true }).click();
  await page.waitForFunction(id => {
    const state = window.artworkWorkspace.durableLocalState();
    return state.projects.some(item => state.links[`project:${item.id}`]?.id === id);
  }, seeded.projectIds[0]);
  const local = await page.evaluate(async id => {
    const state = (await import('./local-workspace.js')).durableLocalState();
    return state.projects.find(item => state.links[`project:${item.id}`]?.id === id);
  }, seeded.projectIds[0]);
  assert.ok(local.songs[0].projectCovers.some(item => item.projectId === local.id && item.cover === original.a));
  await projectCard.getByRole('button', { name: 'есть локальная копия', exact: true }).waitFor();
  const priorSongId = local.songs[0].id;
  await projectCard.getByRole('button', { name: 'есть локальная копия', exact: true }).click();
  await page.waitForFunction(({ id, priorSongId }) => {
    const state = window.artworkWorkspace.durableLocalState();
    const project = state.projects.find(item => item.id === id);
    return project && project.songs[0].id !== priorSongId;
  }, { id: local.id, priorSongId });
  const refreshed = await page.evaluate(async id => (await import('./local-workspace.js')).durableLocalState().projects.find(item => item.id === id), local.id);
  assert.ok(refreshed.songs[0].projectCovers.some(item => item.projectId === local.id && item.cover === original.a), 'repeat download keeps stable local project artwork association');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload();
  const localCard = page.locator(`#hub-list [data-local-id="${local.id}"]`);
  await localCard.waitFor();
  await localCard.getByRole('button', { name: 'Запустить', exact: true }).click();
  await page.locator('#event-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#audience-cover').getAttribute('src'), original.a);

  assert.deepEqual(errors, []);
  console.log('PASS: revision 27 editor membership/retry, upload safety, independent artwork, four presentation fallbacks, primary-only library, portable/cloud remapping, repeat local save and offline reload/playback');
} finally {
  await browser?.close(); api.kill(); server.kill();
  await Promise.all([api, server].filter(child => child.exitCode === null).map(child => new Promise(resolve => child.once('exit', resolve))));
  await rm(temporary, { recursive: true, force: true });
}
