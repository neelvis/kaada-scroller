import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// TL-AC26: real API, serializable native directory handles and rendered UI.
const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-revision26-'));
const port = Number(process.env.LYRICS_REVISION26_PORT || 8174), apiPort = port + 1;
const origin = `http://127.0.0.1:${port}/lyrics/`;
const output = resolve(process.env.LYRICS_TEST_OUTPUT || 'test-results/revision-26');
const password = 'ephemeral revision 26 password', salt = Buffer.alloc(16, 26);
const credentials = resolve(temporary, 'credentials.json');
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: resolve(temporary, 'api-data'), LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const api = spawn(process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let browser, logs = '';
for (const child of [api, server]) { child.stderr.on('data', data => { logs += data; }); child.on('error', error => { logs += error.message; }); }
const card = (page, id) => page.locator(`#hub-list [data-cloud-id="${id}"]`);
const seek = async (page, time) => { await page.locator('#event-progress').fill(String(time)); await page.locator('#event-progress').dispatchEvent('input'); };
const change = async (page, label, value) => { const field = page.getByLabel(label, { exact: true }); await field.fill(value); await field.dispatchEvent('change'); };
async function library(page) { await page.locator('#library').click(); await page.locator('#hub-title').filter({ hasText: 'Библиотека песен' }).waitFor(); }
async function projects(page) { await page.locator('#projects').click(); await page.locator('#hub-title').filter({ hasText: 'Проекты' }).waitFor(); }
async function home(page) { await page.locator('#event-home').click(); await page.locator('#home-view').waitFor({ state: 'visible' }); }
try {
  await mkdir(output, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1360, height: 950 }, serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  // OPFS returns a real FileSystemDirectoryHandle that IndexedDB can clone and
  // restore after reload. OS permission prompts are covered by action unit tests.
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      localStorage.setItem('picker-count', String(Number(localStorage.getItem('picker-count') || 0) + 1));
      return (await navigator.storage.getDirectory()).getDirectoryHandle('performance', { create: true });
    };
  });
  await page.goto(origin);
  await page.locator('#login').click(); await page.locator('#login-password').fill(password);
  await page.locator('#login-form button[type=submit]').click(); await page.locator('#logout').waitFor({ state: 'visible' });
  const seeded = await page.evaluate(async () => {
    const remote = await import('./remote.js');
    const cover = async (width, height) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#23c0eb'; ctx.fillRect(0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return (await import('./artwork.js')).prepareArtwork(new File([blob], 'rectangular.png', { type: 'image/png' }));
    };
    const portrait = await cover(120, 240), landscape = await cover(300, 100);
    const song = (title, endCaption = '') => ({ schemaVersion: 1, id: crypto.randomUUID(), title, artist: 'Исполнитель', album: 'Альбом', version: 'Концертная', cover: portrait, endCaption, language: 'ru', duration: 8, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cues: [
      { id: 'intro', start: 1, type: 'rest', text: '' }, { id: 'lyric', start: 3, type: 'lyric', text: 'Текст песни' }, { id: 'outro', start: 5, type: 'rest', text: '' },
    ] });
    const wav = new Uint8Array(44 + 8000 * 8 * 2), view = new DataView(wav.buffer);
    const text = (offset, value) => [...value].forEach((char, i) => { wav[offset + i] = char.charCodeAt(0); });
    text(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, wav.length - 44, true);
    const audio = await remote.uploadAudio(new File([wav], 'backing.wav', { type: 'audio/wav' }));
    const withAudio = await remote.createSong({ migrationKey: crypto.randomUUID(), song: { ...song('С музыкой', 'Спасибо от песни'), backing: { fileName: 'backing.wav' } }, backingAudioId: audio.id });
    const textOnly = await remote.createSong({ migrationKey: crypto.randomUUID(), song: { ...song('Только текст'), ignoreTimecodes: true } });
    const created = await remote.createProject('Квартирник');
    const project = await remote.saveProject(created.id, { revision: created.revision, name: created.name, cover: landscape, endCaption: 'Спасибо от проекта', songs: [withAudio, textOnly] });
    return { project: project.id, audioSong: withAudio.songId, textSong: textOnly.songId };
  });
  await library(page);
  await card(page, seeded.audioSong).waitFor();
  assert.equal(await card(page, seeded.audioSong).locator('[data-tooltip="есть звуковая дорожка"]').count(), 1);
  assert.equal(await card(page, seeded.textSong).locator('[data-tooltip="только текст"]').count(), 1);
  assert.equal(await card(page, seeded.audioSong).locator('.hub-recording-version').innerText(), 'Концертная');
  const sizes = await card(page, seeded.audioSong).evaluate(el => ({
    artist: getComputedStyle(el.querySelector('.hub-artist')).fontWeight,
    album: parseFloat(getComputedStyle(el.querySelector('.hub-album')).fontSize),
    version: parseFloat(getComputedStyle(el.querySelector('.hub-recording-version')).fontSize),
  }));
  assert.ok(Number(sizes.artist) >= 700); assert.ok(sizes.version < sizes.album);
  const iconBounds = await card(page, seeded.audioSong).evaluate(el => {
    const card = el.getBoundingClientRect(), icons = el.querySelector('.hub-card-icons').getBoundingClientRect(), title = el.querySelector('h2').getBoundingClientRect();
    const [media, notes] = [...el.querySelector('.hub-card-icons').children].map(icon => icon.getBoundingClientRect());
    return { right: card.right - icons.right, top: icons.top - card.top, titleTop: title.top, iconsBottom: icons.bottom, mediaRight: media.right, notesLeft: notes.left, centerDelta: Math.abs(media.top + media.height / 2 - notes.top - notes.height / 2) };
  });
  assert.ok(iconBounds.right >= 14 && iconBounds.right <= 17);
  assert.ok(iconBounds.top >= 14 && iconBounds.top <= 17);
  assert.ok(iconBounds.titleTop >= iconBounds.iconsBottom);
  assert.ok(iconBounds.mediaRight < iconBounds.notesLeft); assert.ok(iconBounds.centerDelta < 1);
  assert.equal(await page.locator('#hub-list .storage-badge').count(), 0);
  const coverShape = await card(page, seeded.audioSong).locator('.hub-card-cover').evaluate(async el => { await el.decode(); return { ratio: el.naturalWidth / el.naturalHeight, fit: getComputedStyle(el).objectFit }; });
  assert.equal(coverShape.ratio, 0.5); assert.equal(coverShape.fit, 'contain');
  await page.locator('#workspace-connect').click();
  await page.waitForFunction(async () => Boolean((await import('./local-workspace.js')).connectedWorkspace()));
  assert.equal(await page.evaluate(() => localStorage.getItem('picker-count')), '1');
  await projects(page);
  await page.evaluate(() => {
    const original = FileSystemFileHandle.prototype.createWritable;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.resumeSnapshot = release;
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const writer = await original.apply(this, args);
      if (!this.name.endsWith('.commit.json')) return writer;
      return { write: data => writer.write(data), abort: () => writer.abort(), close: async () => { window.snapshotWaiting = true; await gate; return writer.close(); } };
    };
  });
  let releaseDownload;
  const gate = new Promise(resolve => { releaseDownload = resolve; });
  await page.route('**/api/audio/*', async route => { if (route.request().method() === 'GET') await gate; await route.continue(); });
  await card(page, seeded.project).getByRole('button', { name: 'Сохранить локальную копию', exact: true }).click();
  await card(page, seeded.project).locator('[aria-busy=true]').waitFor();
  await page.screenshot({ path: resolve(output, 'download-progress.png') });
  assert.equal(await page.locator('#home-view').evaluate(el => el.inert), false);
  assert.equal(await page.locator('.topbar').evaluate(el => el.inert), false);
  // Navigation remains usable while the actual media request is pending.
  await library(page); await card(page, seeded.textSong).waitFor();
  releaseDownload();
  await page.waitForFunction(() => window.snapshotWaiting === true);
  await projects(page);
  await card(page, seeded.project).locator('[aria-busy=true]').waitFor();
  assert.equal(await card(page, seeded.project).locator('.hub-local-copy-check').count(), 0, 'pending disk write must not show a successful copy');
  await page.evaluate(() => window.resumeSnapshot());
  await page.waitForFunction(async () => (await import('./local-workspace.js')).durableLocalState().projects.length === 1);
  await page.unroute('**/api/audio/*');
  await projects(page);
  await card(page, seeded.project).getByRole('button', { name: 'есть локальная копия', exact: true }).waitFor();
  assert.match(await card(page, seeded.project).innerText(), /песен: 2/);
  assert.doesNotMatch(await card(page, seeded.project).innerText(), /В облаке|сохранены локально|Есть локальная копия/);
  await page.reload();
  await card(page, seeded.project).getByRole('button', { name: 'есть локальная копия', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('picker-count')), '1');
  await card(page, seeded.project).getByRole('button', { name: 'есть локальная копия', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(el => el.textContent.startsWith('Локальная копия')));
  assert.deepEqual(await page.locator('.toast').allTextContents(), ['Локальная копия проекта сохранена.']);
  assert.equal(await page.evaluate(() => localStorage.getItem('picker-count')), '1', 'repeated saving reuses configured folder');
  await card(page, seeded.project).getByRole('button', { name: 'Запустить', exact: true }).click();
  await page.locator('#event-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#event-song-name').innerText(), 'С музыкой');
  const notes = page.locator('.empty-interlude').first().locator('.interlude-notes');
  assert.equal(await notes.isVisible(), true, 'empty intro shows notes before activation');
  const displayCover = await page.locator('#audience-cover').evaluate(async el => { await el.decode(); return { ratio: el.naturalWidth / el.naturalHeight, fit: getComputedStyle(el).objectFit }; });
  assert.equal(displayCover.ratio, 3); assert.equal(displayCover.fit, 'contain');
  await seek(page, 1.2); await page.locator('#event-start').click();
  await page.waitForFunction(() => document.querySelector('.audience-lines').classList.contains('playback-running'));
  assert.equal(await notes.locator('span').first().evaluate(el => getComputedStyle(el).animationPlayState), 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await notes.locator('span').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#event-start').click();
  assert.equal(await notes.locator('span').first().evaluate(el => getComputedStyle(el).animationPlayState), 'paused');
  await seek(page, 4); assert.equal(await notes.isVisible(), true, 'past empty intro keeps static notes');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.audience-line.active')).color === 'rgb(35, 192, 235)');
  const activeColor = await page.locator('.audience-line.active').evaluate(el => getComputedStyle(el).color);
  await seek(page, 8); assert.equal(await page.locator('.audience-line.neutral').innerText(), 'Спасибо от песни');
  assert.equal(await page.locator('.end-caption').evaluate(el => getComputedStyle(el).color), activeColor);
  await home(page);
  // Project caption editing uses the same save and refresh path as other metadata.
  await card(page, seeded.project).locator('h2').click();
  await page.locator('#project-end-caption').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#project-end-caption').inputValue(), 'Спасибо от проекта');
  await change(page, 'Подпись в конце песни для проекта', 'Новая подпись проекта');
  await page.locator('#save-project').click();
  await page.waitForFunction(async id => (await (await import('./remote.js')).getProject(id)).endCaption === 'Новая подпись проекта', seeded.project);
  await page.waitForFunction(() => document.querySelector('#remote-state').textContent === 'Сохранено в облаке');
  await page.locator('#song-list .song-select').first().click();
  assert.ok(await page.locator('.song-item-artist').first().evaluate(el => Number(getComputedStyle(el).fontWeight) >= 700));
  const listSizes = await page.locator('#song-list').evaluate(el => ({ album: parseFloat(getComputedStyle(el.querySelector('.song-item-album')).fontSize), version: parseFloat(getComputedStyle(el.querySelector('.song-item-version')).fontSize), color: getComputedStyle(el.querySelector('.song-item-status.ready')).color }));
  assert.ok(listSizes.version < listSizes.album);
  await page.screenshot({ path: resolve(output, 'project-editor.png') });
  await projects(page);
  // The local launcher skips an unready first song and selects the playable one.
  await page.evaluate(async () => {
    const local = await import('./local-workspace.js'), next = structuredClone(local.localState());
    next.projects[0].songs[0].reviewed = false;
    await local.saveWorkspace(next);
  });
  await page.reload();
  await card(page, seeded.project).getByRole('button', { name: 'Запустить', exact: true }).waitFor();
  await context.setOffline(true);
  await card(page, seeded.project).getByRole('button', { name: 'Запустить', exact: true }).click();
  await page.locator('#event-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#event-song-name').innerText(), 'Только текст');
  await seek(page, 8); assert.equal(await page.locator('.audience-line.neutral').innerText(), 'Новая подпись проекта');
  await context.setOffline(false);
  await home(page); await library(page);
  await card(page, seeded.audioSong).getByRole('button', { name: 'Запустить', exact: true }).click();
  await page.locator('#event-view').waitFor({ state: 'visible' });
  await seek(page, 8); assert.equal(await page.locator('.audience-line.neutral').innerText(), 'Спасибо от песни');
  await home(page);
  await card(page, seeded.audioSong).locator('h2').click();
  await change(page, 'Подпись в конце песни', 'Новая подпись песни');
  await page.locator('#save-project').click();
  await page.waitForFunction(async id => (await (await import('./remote.js')).getSong(id)).song.endCaption === 'Новая подпись песни', seeded.audioSong);
  await page.locator('#show-mode').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#show-mode').disabled);
  await page.locator('#show-mode').click(); await seek(page, 8);
  assert.equal(await page.locator('.audience-line.neutral').innerText(), 'Новая подпись песни');
  await home(page);
  await card(page, seeded.textSong).getByRole('button', { name: 'Запустить', exact: true }).click();
  await page.locator('#event-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.empty-interlude .interlude-notes').first().isVisible(), true, 'untimed empty interludes show static notes');
  await page.locator('#event-start').click();
  assert.equal(await page.locator('.empty-interlude .interlude-notes span').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  await seek(page, 8); assert.equal(await page.locator('.audience-line.neutral').innerText(), 'Ваша песенка спета');
  await home(page);
  // Dynamic title updates on custom tooltips must not create native duplicates.
  await page.evaluate(() => { document.querySelector('#workspace-connect').title = 'Native duplicate'; });
  await page.waitForFunction(() => !document.querySelector('#workspace-connect').hasAttribute('title'));
  for (const width of [1360, 375]) {
    await page.setViewportSize({ width, height: 950 });
    await page.screenshot({ path: resolve(output, `library-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.locator('[data-tooltip][title]').count(), 0);
  }
  await page.setViewportSize({ width: 1360, height: 950 });
  await card(page, seeded.audioSong).locator('h2').click();
  await page.locator('#cue-time-shift').fill('-4');
  await page.locator('.time-shift-controls').getByRole('button', { name: 'Применить' }).click();
  assert.deepEqual(await page.locator('.cue-time').evaluateAll(fields => fields.map(field => field.value)), ['0:00', '0:00', '0:01']);
  assert.match(await page.locator('.validation').innerText(), /строго позже/);
  assert.equal(await page.locator('#save-project').isDisabled(), true);
  await page.locator('.cue-insert-start').first().click();
  assert.equal(await page.locator('.cue-row').first().locator('.cue-text').inputValue(), '');
  assert.equal(await page.locator('.cue-row').first().locator('.cue-type').inputValue(), 'rest');
  assert.deepEqual(errors, []);
  console.log('PASS: revision 26 card metadata/media, nonblocking durable save/reload/retry, direct local launch, end captions, empty interludes and tooltips');
} finally {
  await browser?.close(); api.kill(); server.kill();
  await Promise.all([api, server].filter(child => child.exitCode === null).map(child => new Promise(resolve => child.once('exit', resolve))));
  await rm(temporary, { recursive: true, force: true });
}
