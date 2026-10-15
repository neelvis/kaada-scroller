import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 8128;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe' });
let browser;
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let authenticated = false, libraryReads = 0, releaseLibrary, releaseSong;
  const song = { schemaVersion: 1, id: 'online-song', title: 'Серверная песня', artist: 'Школа', duration: 30, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [{ id: 'cue', start: 0, text: 'Онлайн-текст', type: 'lyric' }] };
  const entry = { songId: 'shared-song', revisionId: 'revision', song, audioId: null, backingAudioId: null };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/api/')[1];
    const reply = data => route.fulfill({ json: data });
    if (path === 'login') { authenticated = true; return reply({ csrf: 'test' }); }
    if (path === 'logout') { authenticated = false; return reply({}); }
    if (!authenticated) return route.fulfill({ status: 401, json: { error: 'Войдите' } });
    if (path === 'session') return reply({ csrf: 'test' });
    if (path.startsWith('library')) {
      libraryReads++;
      if (releaseLibrary) await new Promise(resolve => { releaseLibrary = resolve; });
      return reply({ songs: [{ id: 'shared-song', title: song.title }] });
    }
    if (path === 'songs/shared-song') {
      if (releaseSong) await new Promise(resolve => { releaseSong = resolve; });
      return reply(entry);
    }
    if (path === 'projects') return reply({ projects: [{ id: 'project', name: 'Концерт', songCount: 0 }] });
    if (path === 'projects/project') return reply({ id: 'project', revision: 1, name: 'Концерт', songs: [] });
    throw new Error(`Unexpected API request ${path}`);
  });
  const login = async () => {
    await page.locator('#login').click(); await page.locator('#login-password').fill('test');
    await page.locator('#login-form button[type=submit]').click(); await page.locator('#logout').waitFor();
    await page.locator('#online-song-list button').waitFor();
  };
  await page.goto(origin);
  await page.locator('#add-song').click();
  await page.getByLabel('Название', { exact: true }).fill('Локальная песня');
  await page.getByLabel('Название', { exact: true }).blur();
  assert.equal(await page.locator('#online-library').isVisible(), false);
  assert.equal(libraryReads, 0, 'anonymous visitors never fetch private library');
  await login();
  assert.match(await page.locator('#local-song-list').innerText(), /Локальная песня/);
  await page.locator('#online-song-list button').click();
  await page.waitForFunction(() => document.querySelector('#set-name').value === 'Онлайн-библиотека');
  assert.equal(await page.getByLabel('Название', { exact: true }).inputValue(), song.title);
  assert.equal(await page.getByLabel('Название', { exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(async () => (await (await import('./storage.js')).loadSet()).songs[0].title), 'Локальная песня');
  await page.locator('#show-mode').click(); await page.locator('#event-start').click(); await page.locator('#exit-event').click();
  await page.locator('#local-song-list .song-select').click();
  assert.equal(await page.getByLabel('Название', { exact: true }).inputValue(), 'Локальная песня');
  await page.locator('#projects').click();
  await page.locator('#project-list').getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.locator('#online-song-list button').click();
  await page.waitForFunction(() => document.querySelectorAll('#song-list .song-item').length === 1);
  assert.equal(await page.locator('#save-project').isEnabled(), true, 'online song is added to the project as an explicit save');
  assert.match(await page.locator('#local-song-list').innerText(), /Локальная песня/);
  await page.locator('#logout').click();
  assert.equal(await page.locator('#online-library').isVisible(), false);
  assert.equal(await page.locator('#online-song-list').innerText(), '');
  await page.waitForFunction(() => !document.querySelector('#login').disabled);
  await login();
  releaseSong = true;
  await page.locator('#online-song-list button').click();
  await page.waitForTimeout(100);
  await page.locator('#logout').click();
  releaseSong(); releaseSong = null;
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#online-library').isVisible(), false);
  assert.equal(await page.locator('#set-name').inputValue(), 'Мой набор');
  await page.waitForFunction(() => !document.querySelector('#login').disabled);
  await login();
  releaseLibrary = true;
  await page.locator('#library').click(); await page.waitForTimeout(100);
  await page.locator('#logout').click();
  releaseLibrary(); releaseLibrary = null;
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#online-song-list').innerText(), '', 'late library response cannot repopulate private songs');
  assert.deepEqual(errors, []);
  console.log('PASS: anonymous local library, authenticated online songs, read-only display, project additions, local preservation, logout races.');
} finally {
  await browser?.close(); server.kill('SIGTERM');
}
