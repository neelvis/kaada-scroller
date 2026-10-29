import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-revision31-'));
const port = Number(process.env.LYRICS_REVISION31_PORT || 8194), apiPort = port + 1;
const origin = `http://127.0.0.1:${port}/lyrics/`, password = 'ephemeral revision 31 password';
const output = resolve('test-results/revision-31');
const salt = Buffer.alloc(16, 31), credentials = resolve(temporary, 'credentials.json');
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: resolve(temporary, 'api-data'), LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const api = spawn(process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'ignore' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, 'test server did not become ready');
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(15000); await page.goto(origin);
  await page.locator('#login').click(); await page.locator('#login-password').fill(password); await page.locator('#login-form button[type=submit]').click(); await page.locator('#logout').waitFor({ state: 'visible' });
  const seeded = await page.evaluate(async () => {
    const remote = await import('./remote.js');
    const songs = [];
    for (let i = 1; i <= 18; i++) songs.push(await remote.createSong({ migrationKey: crypto.randomUUID(), song: { schemaVersion: 1, id: crypto.randomUUID(), title: `Numbered song ${i}`, artist: 'Artist', language: 'en', duration: 20, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [{ id: crypto.randomUUID(), start: 0, type: 'lyric', text: 'Line' }] } }));
    const created = await remote.createProject('Scroll test');
    const saved = await remote.saveProject(created.id, { revision: created.revision, name: created.name, songs });
    return { projectId: saved.id, songId: songs[0].songId };
  });
  const { projectId, songId } = seeded;
  await page.locator('#projects').click();
  const card = page.locator(`#hub-list [data-cloud-id="${projectId}"]`); await card.waitFor();
  let release, failOnce = true;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/projects/${projectId}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    if (failOnce) { failOnce = false; await gate; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'temporary failure' }) }); }
    return route.continue();
  });
  const projectTitle = card.locator('h2'); await projectTitle.click();
  await page.waitForFunction(id => document.querySelector(`#hub-list [data-cloud-id="${id}"]`)?.getAttribute('aria-busy') === 'true', projectId);
  assert.equal(await card.evaluate(el => el.classList.contains('is-opening')), true);
  await projectTitle.click(); // duplicate activation remains guarded while the request is pending
  release();
  await page.locator('.toast').filter({ hasText: 'Сервер не смог выполнить действие.' }).waitFor();
  await page.locator('.toast').filter({ hasText: 'Сервер не смог выполнить действие.' }).evaluate(el => el.remove());
  await page.waitForFunction(() => !document.querySelector('[data-cloud-id]')?.hasAttribute('aria-busy'));
  await page.locator(`#hub-list [data-cloud-id="${projectId}"] h2`).click();
  await page.locator('#project-songs').waitFor({ state: 'visible' });
  assert.deepEqual((await page.locator('#song-list .song-number').allTextContents()).slice(0, 3), ['1', '2', '3']);
  const orderBeforeMove = await page.locator('#song-list .song-item-title').allTextContents();
  await page.locator('#song-list .song-item').nth(1).getByRole('button', { name: 'Переместить песню выше' }).click();
  const orderAfterMove = await page.locator('#song-list .song-item-title').allTextContents();
  assert.notDeepEqual(orderAfterMove, orderBeforeMove);
  assert.deepEqual(await page.locator('#song-list .song-number').allTextContents(), orderAfterMove.map((_, index) => String(index + 1)));
  await page.locator('#song-list .song-select').first().dragTo(page.locator('#song-list .song-item').nth(3));
  const orderAfterDrag = await page.locator('#song-list .song-item-title').allTextContents();
  assert.notDeepEqual(orderAfterDrag, orderAfterMove);
  assert.deepEqual(await page.locator('#song-list .song-number').allTextContents(), orderAfterDrag.map((_, index) => String(index + 1)));
  await page.locator('#show-mode').click();
  // Retain menu scroll while selecting a different project song.
  await page.locator('#event-view').waitFor({ state: 'visible' });
  const toggle = page.locator('#event-menu-toggle'), menu = page.locator('#event-menu'), songs = page.locator('#event-menu-songs');
  await toggle.click(); await page.locator('#event-menu-songs button').last().waitFor();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await songs.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(100);
  const before = await songs.evaluate(el => el.scrollTop);
  assert.ok(before > 0);
  await songs.locator('button').nth(15).click();
  const selectedProjectTitle = (await page.locator('#event-song-name').innerText()).trim();
  await toggle.click(); await page.locator('#event-menu-songs button').last().waitFor();
  await page.waitForFunction(() => document.querySelector('#event-menu-songs').scrollTop > 0);
  assert.ok(await songs.evaluate((el, expected) => Math.abs(el.scrollTop - expected) < 2, before));
  const current = await songs.locator('[aria-current="true"]').count(); assert.equal(current, 1);
  assert.ok((await songs.locator('[aria-current="true"]').innerText()).includes(selectedProjectTitle));
  const currentStyle = await songs.locator('[aria-current="true"]').evaluate(el => getComputedStyle(el).backgroundColor);
  assert.notEqual(currentStyle, 'rgba(0, 0, 0, 0)');
  await mkdir(output, { recursive: true }); await page.screenshot({ path: resolve(output, 'current-song-menu.png') });
  assert.deepEqual(await page.evaluate(async id => { const r = await (await import('./remote.js')).getProject(id); return Object.keys(r.songs[0]).filter(key => key.toLowerCase().includes('number')); }, projectId), []);
  assert.ok(await menu.isVisible());
  await page.locator('#event-menu-close').click(); await page.locator('#event-home').click();
  if (await page.locator('#leave-project-dialog').isVisible()) await page.locator('#leave-project-dialog button[value="discard"]').click();
  await page.locator('#home-view').waitFor({ state: 'visible' });
  await page.locator('#library').click();
  const libraryCard = page.locator(`#hub-list [data-cloud-id="${songId}"]`); await libraryCard.waitFor();
  await libraryCard.getByRole('button', { name: 'Запустить' }).click(); await page.locator('#event-view').waitFor({ state: 'visible' });
  let releaseLibrary, delayLibrary = false;
  const libraryGate = new Promise(resolve => { releaseLibrary = resolve; });
  await page.route('**/api/library*', async route => {
    if (delayLibrary && route.request().method() === 'GET') { delayLibrary = false; await libraryGate; }
    await route.continue();
  });
  await toggle.click(); await page.locator('#event-menu-songs button').last().waitFor();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await songs.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(80);
  const libraryScroll = await songs.evaluate(el => el.scrollTop); assert.ok(libraryScroll > 0);
  const selectedLibraryTitle = (await songs.locator('button').nth(15).innerText()).replace(/^\d+\.\s*/, '').split(' · ')[0];
  await songs.locator('button').nth(15).click();
  await page.waitForFunction(title => document.querySelector('#event-song-name').textContent.trim() === title, selectedLibraryTitle);
  delayLibrary = true; await toggle.click();
  await page.getByText('Загружаем песни…').waitFor();
  await toggle.click(); // closing while the list is a loading placeholder must keep the previous offset
  await toggle.click();
  await page.locator('#event-menu-songs button').last().waitFor();
  await page.waitForFunction(() => document.querySelector('#event-menu-songs').scrollTop > 0);
  assert.ok(await songs.evaluate((el, expected) => Math.abs(el.scrollTop - expected) < 2, libraryScroll));
  releaseLibrary();
  assert.equal(await songs.locator('[aria-current="true"]').count(), 1);
  await page.waitForFunction(() => document.querySelectorAll('.toast').length === 0).catch(() => {});
  console.log('revision 31 browser checks passed');
} finally {
  await browser?.close(); api.kill('SIGTERM'); server.kill('SIGTERM'); await new Promise(resolve => setTimeout(resolve, 150)); await rm(temporary, { recursive: true, force: true });
}
