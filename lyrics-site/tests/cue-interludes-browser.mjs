import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installWorkspaceDirectory } from './workspace-test-directory.mjs';

// TL-AC72–AC75: real authenticated API, timeline editing and audience playback.
const port = Number(process.env.LYRICS_CUE_TEST_PORT || 8148), apiPort = port + 1;
const origin = `http://127.0.0.1:${port}/lyrics/`;
const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-cue-test-'));
const output = resolve(process.env.LYRICS_TEST_OUTPUT || 'test-results/revision-17');
const python = process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python';
const password = 'temporary cue test password', salt = Buffer.alloc(16, 39);
const credentials = resolve(temporary, 'credentials.json');
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: resolve(temporary, 'api-data'), LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const api = spawn(python, ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let logs = '', browser;
for (const child of [api, server]) { child.stderr.on('data', data => { logs += data; }); child.on('error', error => { logs += error.message; }); }
const fixture = (id, title, artist) => ({ schemaVersion: 1, id, title, artist, version: '', language: 'ru', duration: 40, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [
  { id: `${id}-intro`, start: 0, type: 'rest', text: 'Вступление' },
  { id: `${id}-a`, start: 10, type: 'lyric', text: 'Повтор' },
  { id: `${id}-b`, start: 14, type: 'lyric', text: 'Повтор' },
  { id: `${id}-c`, start: 30, type: 'lyric', text: 'Последняя строка' },
  { id: `${id}-outro`, start: 35, type: 'rest', text: 'Завершение' },
] });
const card = (page, id) => page.locator(`#hub-list [data-cloud-id="${id}"]`);
const save = page => page.locator('.song-actions button').filter({ hasText: /^Сохранить в облаке$/ });
const row = (page, id) => page.locator(`.cue-row[data-cue-id="${id}"]`);
async function library(page) { await page.locator('#library').click(); await page.locator('#hub-library-sort').waitFor(); }
async function open(page, id) { await library(page); await card(page, id).getByRole('button', { name: 'Открыть', exact: true }).click(); await page.locator('.cue-row').first().waitFor(); }
async function getSong(page, id) { return page.evaluate(async id => (await import('./remote.js')).getSong(id), id); }
async function confirmReady(page) { await page.getByRole('button', { name: 'Подтвердить готовность', exact: true }).click(); await page.locator('.status-pill.ready').waitFor(); }
async function seek(page, seconds) { await page.locator('#event-progress').evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, seconds); }
async function activeRest(page, label) { await page.waitForFunction(label => document.querySelector('.audience-line.rest.active')?.getAttribute('aria-label') === label, label); assert.equal(await page.locator('.rest.active .interlude-notes').isVisible(), true); }

async function drag(page, source, target) {
  await source.scrollIntoViewIfNeeded();
  const start = await source.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2 + 8, { steps: 5 });
  await target.scrollIntoViewIfNeeded();
  const end = await target.boundingBox();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
}

try {
  await mkdir(output, { recursive: true });
  const directory = resolve(temporary, 'local-copy'); await mkdir(directory);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, logs);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  page.setDefaultTimeout(10000); await installWorkspaceDirectory(page, directory);
  await page.goto(origin); await page.locator('#login').click(); await page.locator('#login-password').fill(password); await page.locator('#login-form button[type=submit]').click(); await page.locator('#logout').waitFor({ state: 'visible' });
  const songs = await page.evaluate(async fixtures => { const remote = await import('./remote.js'); const result = []; for (const song of fixtures) result.push(await remote.createSong({ song, migrationKey: `cue-${song.id}` })); return result; }, [fixture('one', 'Бета', 'Яна'), { ...fixture('two', 'Альфа', 'Анна'), delayMs: 1000 }, fixture('three', 'Gamma', '')]);
  const setDates = spawnSync(python, ['-c', 'import sqlite3,sys\ndb=sqlite3.connect(sys.argv[1])\nfor i,song in enumerate(sys.argv[2:]): db.execute("UPDATE songs SET created_at=? WHERE id=?",(f"202{i}-01-01 00:00:00",song))\ndb.commit()', resolve(env.LYRICS_DATA_DIR, 'lyrics.sqlite3'), ...songs.map(item => item.songId)], { encoding: 'utf8' });
  assert.equal(setDates.status, 0, setDates.stderr);
  await library(page); await page.waitForFunction(() => document.querySelectorAll('#hub-list .hub-card').length === 3);
  const sort = page.locator('#hub-library-sort');
  const ids = () => page.locator('#hub-list .hub-card').evaluateAll(cards => cards.map(card => card.dataset.cloudId));
  assert.equal(await sort.inputValue(), 'date-newest'); assert.deepEqual(await ids(), [songs[2].songId, songs[1].songId, songs[0].songId]);
  for (const [choice, order] of [['date-oldest', [0, 1, 2]], ['date-newest', [2, 1, 0]], ['artist-asc', [1, 0, 2]], ['artist-desc', [0, 1, 2]], ['title-asc', [1, 0, 2]], ['title-desc', [2, 0, 1]]]) { await sort.selectOption(choice); assert.deepEqual(await ids(), order.map(i => songs[i].songId)); }
  await page.locator('#hub-search').fill('Альфа'); assert.deepEqual(await ids(), [songs[1].songId]); await page.locator('#hub-search').fill('');
  await open(page, songs[0].songId);
  const original = (await getSong(page, songs[0].songId)).song;
  assert.equal(await row(page, 'one-intro').locator('.cue-reorder button').nth(1).isDisabled(), true);
  await row(page, 'one-b').locator('.cue-text').fill('Повтор — правка');
  await row(page, 'one-b').locator('.cue-move-up').click();
  assert.equal(await row(page, 'one-b').locator('.cue-text').inputValue(), 'Повтор — правка', 'first arrow click commits the focused edit and moves the row');
  assert.equal(await save(page).isDisabled(), true, 'moving invalidates readiness');
  assert.deepEqual(await page.locator('.cue-row').evaluateAll(rows => rows.map(row => row.dataset.cueId)), ['one-intro', 'one-b', 'one-a', 'one-c', 'one-outro']);
  assert.match(await page.locator('.validation').innerText(), /строго позже/);
  await row(page, 'one-b').locator('.cue-move-down').click();
  // Native drag also commits a focused edit without losing its drag source.
  await row(page, 'one-b').locator('.cue-text').fill('Повтор — правка перед переносом');
  await drag(page, row(page, 'one-a').locator('.cue-drag-handle'), page.locator('.cue-boundary').last());
  assert.equal(await page.locator('.cue-row').last().getAttribute('data-cue-id'), 'one-a');
  await drag(page, row(page, 'one-a').locator('.cue-drag-handle'), page.locator('.cue-boundary').nth(1));
  assert.deepEqual(await page.locator('.cue-row').evaluateAll(rows => rows.map(row => row.dataset.cueId)), original.cues.map(cue => cue.id));
  await row(page, 'one-b').locator('.cue-text').fill('Повтор');
  await row(page, 'one-b').locator('.cue-insert-rest').click();
  assert.equal(await row(page, 'one-b').locator('.cue-text').inputValue(), 'Повтор', 'insertion commits the focused edit before deriving its estimate');
  const inserted = page.locator('.cue-row').nth(3), restId = await inserted.getAttribute('data-cue-id');
  assert.equal(await inserted.locator('.cue-time').inputValue(), '0:18');
  assert.match(await inserted.innerText(), /Приблиз|Пример|Оцен/i);
  await confirmReady(page); await save(page).click();
  await page.waitForFunction(async id => (await (await import('./remote.js')).getSong(id)).song.cues.length === 6, songs[0].songId);
  const saved = (await getSong(page, songs[0].songId)).song;
  assert.deepEqual(saved.cues.filter(cue => cue.id !== restId), original.cues, 'neighbors and repeated lyric identities survive edits');
  assert.deepEqual(saved.cues[3], { id: restId, start: 18, text: 'Проигрыш', type: 'rest' });
  await open(page, songs[0].songId); assert.equal(await row(page, restId).count(), 1);
  await drag(page, row(page, restId).locator('.cue-drag-handle'), page.locator('.cue-boundary').nth(3));
  assert.equal(await page.locator('.status-pill.ready').count(), 1, 'same-position drop retains confirmation');
  assert.equal(await page.locator('.cue-toolbar .cue-add-rest').count(), 0);
  assert.equal(await row(page, restId).locator('.cue-insert-rest').innerText(), '+ ♪');
  assert.deepEqual(await row(page, restId).evaluate(row => [...row.children].filter(el => el.matches('.cue-type,.cue-insert-rest,.cue-retap')).map(el => el.classList.contains('cue-type') ? 'type' : el.classList.contains('cue-insert-rest') ? 'insert' : 'time')), ['type', 'insert', 'time']);
  await library(page); assert.equal(await sort.inputValue(), 'title-desc');
  const listed = await page.evaluate(async () => (await (await import('./remote.js')).listLibrary()).songs);
  assert.equal(listed.find(item => item.id === songs[0].songId).createdAt, '2020-01-01T00:00:00Z');

  // Save a real local snapshot and verify the rest cue in the persisted project.
  const project = await page.evaluate(async entry => { const remote = await import('./remote.js'); const project = await remote.createProject('Проигрыши'); return remote.saveProject(project.id, { name: project.name, revision: project.revision, songs: [entry] }); }, await getSong(page, songs[0].songId));
  await page.locator('#workspace-connect').click(); await page.locator('#projects').click();
  await card(page, project.id).getByRole('button', { name: 'Открыть', exact: true }).click();
  await page.locator('#prepare-offline').click();
  await page.waitForFunction(async restId => (await import('./local-workspace.js')).localState().projects.some(project => project.songs.some(song => song.cues.some(cue => cue.id === restId))), restId);
  const local = await page.evaluate(async () => (await import('./local-workspace.js')).localState().projects);
  assert.ok(local.some(project => project.songs.some(song => song.cues.some(cue => cue.id === restId && cue.type === 'rest' && cue.start === 18))));

  await page.locator('#song-list .song-select').first().click(); await page.locator('#show-mode').click(); await page.locator('#event-view').waitFor({ state: 'visible' });
  await activeRest(page, 'Вступление');
  assert.equal(await page.locator('.rest.active .interlude-notes').innerText(), '♪ ♪ ♪');
  assert.equal(await page.locator('.rest.active .interlude-notes span').count(), 3);
  const note = page.locator('.rest.active .interlude-notes span').first();
  assert.equal(await note.evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  await page.locator('#event-start').click(); await page.waitForFunction(() => document.querySelector('#event-start').getAttribute('aria-label') === 'Пауза');
  assert.equal(await note.evaluate(el => getComputedStyle(el).animationPlayState), 'running');
  await seek(page, 18.5); await activeRest(page, 'Проигрыш');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.rest.active')).color === 'rgb(35, 192, 235)');
  await page.locator('#highlight-current').click(); await page.waitForFunction(() => getComputedStyle(document.querySelector('.rest.active')).color === 'rgb(35, 192, 235)');
  await page.locator('#event-start').click();
  assert.equal(await note.evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  await note.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.ready)); await new Promise(requestAnimationFrame); });
  const frozen = await note.evaluate(el => getComputedStyle(el).transform); await page.waitForTimeout(120); assert.equal(await note.evaluate(el => getComputedStyle(el).transform), frozen);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await note.evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seek(page, 30.1); assert.equal(await page.locator('.rest.active').count(), 0); assert.equal(await page.locator('.interlude-notes:visible').count(), 0);
  await seek(page, 35.1); await activeRest(page, 'Завершение');
  await seek(page, 40); await page.getByText('Песня закончилась', { exact: true }).waitFor(); assert.equal(await page.locator('.interlude-notes').count(), 0);
  await seek(page, 18.5); await activeRest(page, 'Проигрыш');
  await page.screenshot({ path: resolve(output, 'interlude.png') });
  await page.locator('#exit-event').click();
  for (const width of [1360, 1120, 375, 320]) {
    await page.setViewportSize({ width, height: 950 });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, id: el.id, cls: el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })).filter(el => el.right > innerWidth + 1 && el.width > 0) }));
    assert.ok(overflow.scroll <= overflow.width, `no overflow at ${width}: ${JSON.stringify(overflow)}`);
    await page.screenshot({ path: resolve(output, `editor-${width}.png`), fullPage: true });
    await library(page); assert.equal(await sort.isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `library no overflow at ${width}`);
    await page.screenshot({ path: resolve(output, `library-${width}.png`), fullPage: true });
    await open(page, songs[0].songId);
  }
  await page.locator('#ignore-timecodes').check(); await confirmReady(page); await save(page).click();
  await page.waitForFunction(async id => (await (await import('./remote.js')).getSong(id)).song.ignoreTimecodes === true, songs[0].songId);
  await library(page); await card(page, songs[0].songId).getByRole('button', { name: '▶ Запустить', exact: true }).click();
  await page.locator('#event-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.interlude-notes:visible').count(), 0, 'untimed mode keeps interlude labels');
  assert.equal(await page.locator('.audience-line.rest .interlude-label').first().isVisible(), true);
  await page.locator('#exit-event').click(); await library(page);
  await card(page, songs[1].songId).getByRole('button', { name: '▶ Запустить', exact: true }).click();
  await page.locator('#event-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.rest.active').count(), 0, 'positive delay postpones the intro notes');
  await seek(page, 1.2); await activeRest(page, 'Вступление');
  assert.deepEqual(errors, []);
  console.log('PASS TL-AC72–AC75: cue moves, interlude estimates/cloud/local persistence, timed animated notes/pause/seek/reduced motion, six library sorts, creation dates, session selection, responsive layouts.');
} catch (error) { if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
finally { await browser?.close(); api.kill('SIGTERM'); server.kill('SIGTERM'); await rm(temporary, { recursive: true, force: true }); }
