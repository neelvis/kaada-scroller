import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { connectTestWorkspace, installWorkspaceDirectory } from './workspace-test-directory.mjs';

const port = Number(process.env.LYRICS_WORKSPACE_PORT || 8138);
const origin = `http://127.0.0.1:${port}/lyrics/`;
const output = resolve(process.env.LYRICS_TEST_OUTPUT || 'test-results/workspace');
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe' });
const workspaceRoot = await mkdtemp(resolve(tmpdir(), 'kaada-workspace-browser-'));
let browser;

function song(id, title, text) {
  return { schemaVersion: 1, id, title, artist: 'Проверка', version: '', language: 'ru', duration: 30, delayMs: 0, cues: [{ id: `${id}-cue`, start: 0, text, type: 'lyric' }], reviewed: false, source: { kind: 'manual', fileName: '' } };
}

async function clearBrowserStorage(page, context) {
  await page.evaluate(async () => {
    localStorage.clear();
    for (const database of await indexedDB.databases()) if (database.name) await new Promise(resolve => {
      const request = indexedDB.deleteDatabase(database.name); request.onsuccess = request.onerror = request.onblocked = resolve;
    });
    for (const key of await caches.keys()) await caches.delete(key);
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  });
  await context.clearCookies();
}

try {
  await mkdir(output, { recursive: true });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox'],
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await installWorkspaceDirectory(page, workspaceRoot);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Войдите' } }));
  await page.goto(origin);
  await page.locator('#home-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#preparation-view').isVisible(), false, 'Projects is the initial destination.');
  assert.equal(await page.locator('#projects').isVisible(), true, 'Projects navigation is available while logged out.');
  assert.equal(await page.locator('#login').isVisible(), true);
  assert.equal((await page.locator('#hub-filter option').allTextContents()).join('|'), 'Все|На этом устройстве|В облаке');

  await connectTestWorkspace(page);
  await page.locator('#hub-create').click();
  await page.locator('#create-local-project-dialog').waitFor({ state: 'visible' });
  await page.locator('#local-project-name').fill('Первый проект');
  await page.locator('#create-local-project-form button[type=submit]').click();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#preparation-view').isVisible(), true, `Project creation did not open the editor: ${await page.locator('.toast').allTextContents()}`);
  await page.locator('#local-save-status').filter({ hasText: 'Сохранено' }).waitFor();
  await page.locator('#add-song').click();
  await page.getByLabel('Название', { exact: true }).fill('Локальная новая песня');
  await page.getByLabel('Название', { exact: true }).blur();
  await page.locator('#local-save-status').filter({ hasText: 'Сохранено' }).waitFor();
  await page.locator('#back-home').click();
  assert.match(await page.locator('#hub-list').innerText(), /Первый проект/);

  const portableFixture = {
    schemaVersion: 1, id: 'fixture-set', name: 'Загруженная программа',
    songs: [song('fixture-one', 'Первая библиотечная', 'Первый текст'), song('fixture-two', 'Вторая библиотечная', 'Второй текст')],
  };
  await page.locator('#set-file').setInputFiles({ name: 'workspace-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portableFixture)) });
  await page.locator('#local-save-status').filter({ hasText: 'Сохранено' }).waitFor();
  await page.locator('#back-home').click();
  await page.locator('#library').click();
  await page.locator('#hub-list').getByText('Первая библиотечная', { exact: true }).waitFor();
  await page.locator('.toast').waitFor({ state: 'detached' });
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true });

  await page.locator('#projects').click();
  await page.locator('#hub-create').click();
  await page.locator('#local-project-name').fill('Проект с песнями');
  await page.locator('#create-local-project-form button[type=submit]').click();
  await page.locator('#preparation-view').waitFor({ state: 'visible' });
  await page.locator('#add-library-song').click();
  await page.locator('#library-list').getByLabel('Первая библиотечная').check();
  await page.locator('#library-list').getByLabel('Вторая библиотечная').check();
  await page.locator('#library-add-selected').click();
  await page.waitForFunction(() => document.querySelectorAll('#song-list .song-item').length === 2);
  assert.equal((await page.locator('#song-list .song-item-title').allTextContents()).join('|'), 'Первая библиотечная|Вторая библиотечная');
  await page.getByRole('button', { name: 'Переместить песню ниже' }).first().click();
  await page.waitForFunction(() => document.querySelector('#song-list .song-item-title')?.textContent === 'Вторая библиотечная');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Убрать из проекта', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#song-list .song-item').length === 1);
  await page.locator('#back-home').click();
  await page.locator('#library').click();
  assert.match(await page.locator('#hub-list').innerText(), /Первая библиотечная/);
  assert.match(await page.locator('#hub-list').innerText(), /Вторая библиотечная/);
  await page.locator('#projects').click();
  await page.locator('#hub-filter').selectOption('local');
  await page.locator('#hub-search').fill('Проект с песнями');
  assert.match(await page.locator('#hub-list').innerText(), /Проект с песнями/);
  await page.locator('#hub-search').fill(''); await page.locator('#hub-filter').selectOption('all');

  await page.setViewportSize({ width: 375, height: 740 });
  await page.locator('.toast').waitFor({ state: 'detached' });
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true });
  const mobileWidth = await page.evaluate(() => ({
    width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('body *')].map(element => ({ id: element.id, className: String(element.className || ''), right: Math.round(element.getBoundingClientRect().right), left: Math.round(element.getBoundingClientRect().left) })).filter(item => item.right > document.documentElement.clientWidth + 1 || item.left < -1).slice(0, 12),
  }));
  assert.deepEqual(pageErrors, []);

  await clearBrowserStorage(page, context);
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const restored = await fresh.newPage();
  await installWorkspaceDirectory(restored, workspaceRoot);
  const restoreErrors = [];
  restored.on('pageerror', error => restoreErrors.push(error.message));
  await restored.route('**/api/**', route => route.fulfill({ status: 401, json: { error: 'Войдите' } }));
  await restored.goto(origin);
  await connectTestWorkspace(restored);
  await restored.locator('#hub-list').getByText('Первый проект', { exact: true }).waitFor();
  await restored.locator('#projects').click();
  await restored.locator('#hub-list').getByText('Проект с песнями', { exact: true }).waitFor();
  await restored.locator('#library').click();
  await restored.locator('#hub-list').getByText('Первая библиотечная', { exact: true }).waitFor();
  assert.ok((await readdir(resolve(workspaceRoot, 'kaada-workspace/snapshots'))).some(name => name.endsWith('.commit.json')));
  assert.deepEqual(restoreErrors, []);
  assert.equal(mobileWidth.scrollWidth <= mobileWidth.width, true, `the hub has no horizontal overflow at narrow width: ${JSON.stringify(mobileWidth)}`);
  await restored.evaluate(async () => {
    const storage = await import('./storage.js'), cache = await import('./offline-projects.js');
    const song = { schemaVersion:1,id:'legacy-song',title:'Legacy backing',artist:'',version:'',language:'ru',duration:30,delayMs:0,reviewed:true,source:{kind:'manual',fileName:''},backing:{fileName:'legacy.wav'},cues:[{id:'legacy-cue',start:0,text:'Legacy words',type:'lyric'}] };
    await storage.saveSet({schemaVersion:1,id:'legacy-set',name:'Legacy set',songs:[song]});
    await storage.putBacking(song.id,new Blob(['legacy backing bytes'],{type:'audio/wav'}));
    await cache.cacheProject({id:'legacy-cloud-project',name:'Legacy snapshot',revision:1,songs:[{song, songId:'legacy-song',revisionId:'legacy-revision',backingAudioId:'legacy-audio',audioId:null}]},[{id:'backing:legacy-audio',blob:new Blob(['cached backing bytes'],{type:'audio/wav'})}]);
  });
  restored.once('dialog', dialog => dialog.accept());
  await restored.locator('#migrate-browser').click();
  await restored.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => /Перенос (завершён|не завершён)/.test(el.textContent)));
  assert.match((await restored.locator('.toast').allTextContents()).join(' | '), /Перенос завершён/, 'migration must finish successfully before checking committed state');
  const migration = await restored.evaluate(async () => {
    const local = await import('./local-workspace.js'), old = await import('./storage.js');
    const state = local.localState(), project = state.projects.find(item=>item.name==='Legacy snapshot');
    if (!project) throw new Error(JSON.stringify({ projects: state.projects.map(item => ({id:item.id,name:item.name})), status:document.querySelector('#local-save-status').textContent, toasts:[...document.querySelectorAll('.toast')].map(el=>el.textContent),links:state.links }));
    const pinned = project.songs[0], source = state.library.find(item=>item.id===state.links[`pin:${pinned.id}`]);
    const before = await (await local.getBacking(pinned.id)).text();
    await local.putBacking(source.id,new Blob(['changed library backing'],{type:'audio/wav'}));
    await local.saveWorkspace(state);
    return {differentIds:pinned.id!==source.id, before, after:await (await local.getBacking(pinned.id)).text(), oldTitle:(await old.loadSet()).songs[0].title};
  });
  assert.deepEqual(migration,{differentIds:true,before:'cached backing bytes',after:'cached backing bytes',oldTitle:'Legacy backing'});
  console.log('PASS: logged-out projects-first workspace, folder-backed autosave, project/library actions, responsive hub, and recovery after browser storage was cleared.');
  await fresh.close(); await context.close();
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await rm(workspaceRoot, { recursive: true, force: true });
}
