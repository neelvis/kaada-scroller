import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-revision32-'));
const port = Number(process.env.LYRICS_REVISION32_PORT || 8196), apiPort = port + 1;
const origin = `http://127.0.0.1:${port}/lyrics/`, password = 'ephemeral revision 32 password';
const salt = Buffer.alloc(16, 32), credentials = resolve(temporary, 'credentials.json');
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: resolve(temporary, 'api-data'), LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const api = spawn(process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'ignore' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) { try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, 'test services did not become ready');
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(15000); await page.goto(origin);
  await page.locator('#login').click(); await page.locator('#login-password').fill(password); await page.locator('#login-form button[type=submit]').click(); await page.locator('#logout').waitFor({ state: 'visible' });
  const seeded = await page.evaluate(async () => {
    const remote = await import('./remote.js');
    const { prepareArtwork } = await import('./artwork.js');
    async function image(width, height, color) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      return prepareArtwork(new File([blob], 'cover.png', { type: 'image/png' }));
    }
    const portrait = await image(300, 600, '#2377aa'), landscape = await image(600, 240, '#ce7622');
    const makeSong = (title, cover, untimed = false, duration = 12) => ({ schemaVersion: 1, id: crypto.randomUUID(), title, artist: 'Revision 32', language: 'en', duration, delayMs: 0, reviewed: true, source: { kind: 'manual', fileName: '' }, cover, ignoreTimecodes: untimed, autoScrollEnabled: untimed ? false : undefined, cues: [{ id: crypto.randomUUID(), start: duration <= 2 ? 0 : 1, type: 'lyric', text: `${title} line one` }, { id: crypto.randomUUID(), start: duration <= 2 ? 1 : 6, type: 'lyric', text: `${title} line two` }] });
    const first = makeSong('Original portrait title', portrait), second = makeSong('Original landscape title', landscape, true), plain = makeSong('No artwork title', '', true), short = makeSong('Natural ending title', '', false, 2);
    plain.autoScrollEnabled = true;
    const entries = [];
    for (const song of [first, second, plain, short]) entries.push(await remote.createSong({ migrationKey: crypto.randomUUID(), song }));
    const wav = new Uint8Array(44 + 16000), view = new DataView(wav.buffer);
    const writeText = (offset, value) => [...value].forEach((char, index) => { wav[offset + index] = char.charCodeAt(0); });
    writeText(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); writeText(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeText(36, 'data'); view.setUint32(40, wav.length - 44, true);
    for (let sample = 0; sample < 8000; sample++) view.setInt16(44 + sample * 2, Math.round(Math.sin(sample / 8000 * Math.PI * 440) * 1200), true);
    const audio = await remote.uploadAudio(new File([wav], 'failure.wav', { type: 'audio/wav' }));
    const failure = makeSong('Failed audio title', landscape); failure.backing = { fileName: 'failure.wav' };
    entries.push(await remote.createSong({ migrationKey: crypto.randomUUID(), song: failure, backingAudioId: audio.id }));
    const backed = makeSong('Successful audio title', landscape); backed.backing = { fileName: 'backing.wav' };
    entries.push(await remote.createSong({ migrationKey: crypto.randomUUID(), song: backed, backingAudioId: audio.id }));
    const projectA = await remote.createProject('Standby A'), projectB = await remote.createProject('Standby B');
    const names = ['A only name', '   ', '   ', '', '', ''];
    const storedSongs = entries.map((entry, index) => ({ ...entry, song: { ...entry.song, projectCovers: [
      { projectId: projectA.id, cover: index === 0 ? portrait : index === 1 || index === 4 || index === 5 ? landscape : '', libraryName: names[index] },
      { projectId: projectB.id, cover: '', libraryName: index === 0 ? 'B only name' : '' },
    ] } }));
    const a = await remote.saveProject(projectA.id, { revision: projectA.revision, name: projectA.name, songs: storedSongs });
    const b = await remote.saveProject(projectB.id, { revision: projectB.revision, name: projectB.name, songs: storedSongs });
    return { projects: [a.id, b.id], songs: entries.map(entry => entry.songId), audioId: audio.id, titles: [first.title, second.title, plain.title], portrait, landscape };
  });

  await page.locator('#projects').click();
  await page.locator(`#hub-list [data-cloud-id="${seeded.projects[0]}"] h2`).click();
  await page.locator('#project-songs').waitFor({ state: 'visible' });
  await page.locator('#show-mode').click(); await page.locator('#event-view').waitFor({ state: 'visible' });
  const lines = page.locator('#audience-lines'), cover = page.locator('#audience-cover');
  const assertStandby = async (hasCover) => {
    assert.equal(await page.locator('#audience-lines').getAttribute('aria-hidden'), 'true');
    assert.equal(await page.locator('#audience').evaluate(el => el.classList.contains('lyrics-standby')), true);
    assert.equal(await cover.isVisible(), hasCover);
  };
  const assertRevealed = async () => {
    await page.waitForFunction(() => document.querySelector('#audience-lines').getAttribute('aria-hidden') === 'false' && document.querySelector('#event-start').getAttribute('aria-label') === 'Пауза');
    assert.equal(await lines.getAttribute('aria-hidden'), 'false');
    assert.equal(await page.locator('#audience').evaluate(el => el.classList.contains('lyrics-standby')), false);
  };
  await assertStandby(true);
  await cover.evaluate(img => img.decode());
  assert.equal(await cover.evaluate(img => img.naturalWidth / img.naturalHeight), 0.5, 'portrait cover proportions are retained');
  await mkdir(resolve('test-results/revision-32'), { recursive: true });
  await page.screenshot({ path: resolve('test-results/revision-32/portrait-standby.png') });
  await page.locator('#event-menu-toggle').click();
  const menuSongs = page.locator('#event-menu-songs button');
  assert.equal(await menuSongs.nth(0).innerText(), '1. A only name');
  assert.equal(await menuSongs.nth(1).innerText(), '2. Original landscape title', 'whitespace-only names fall back to library title');
  assert.equal(await menuSongs.nth(2).innerText(), '3. No artwork title');
  assert.equal(await menuSongs.nth(0).getAttribute('aria-current'), 'true');
  await menuSongs.nth(1).click(); await assertStandby(true);
  assert.equal(await cover.evaluate(async img => { await img.decode(); const r = img.getBoundingClientRect(); return [img.naturalWidth / img.naturalHeight, getComputedStyle(img).objectFit, Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; }).then(result => result.slice(0, 2).join('|')), '2.5|contain');
  const bounds = await cover.evaluate(img => { const r = img.getBoundingClientRect(), a = document.querySelector('#audience').getBoundingClientRect(); return { image: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }, audience: { left: a.left, right: a.right, top: a.top, bottom: a.bottom }, centerDelta: [Math.abs((r.left + r.right - a.left - a.right) / 2), Math.abs((r.top + r.bottom - a.top - a.bottom) / 2)] }; });
  assert.ok(bounds.image.left >= bounds.audience.left && bounds.image.right <= bounds.audience.right && bounds.image.top >= bounds.audience.top && bounds.image.bottom <= bounds.audience.bottom, JSON.stringify(bounds));
  assert.ok(bounds.centerDelta[0] <= 1 && bounds.centerDelta[1] <= 1, JSON.stringify(bounds));
  await page.screenshot({ path: resolve('test-results/revision-32/landscape-standby.png') });
  await page.locator('#audience').dispatchEvent('wheel', { deltaY: 500 }); await assertStandby(true);
  const manualBeforePlay = await lines.evaluate(el => getComputedStyle(el).transform);
  await page.locator('#event-progress').evaluate(el => { el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await assertStandby(true);
  await page.locator('#event-start').click(); await assertRevealed();
  await page.locator('#audience').dispatchEvent('wheel', { deltaY: 500 });
  assert.notEqual(await lines.evaluate(el => getComputedStyle(el).transform), manualBeforePlay, 'manual scrolling works after Play');
  await page.waitForTimeout(100);
  await page.locator('#event-start').click(); assert.equal(await page.locator('#audience-lines').getAttribute('aria-hidden'), 'false', 'pause keeps lyrics visible');
  await page.locator('#event-progress').evaluate(el => { el.value = '8'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.locator('#audience-lines').getAttribute('aria-hidden'), 'false', 'seek while paused keeps lyrics visible');
  await page.locator('#event-start').click(); await assertRevealed();
  await page.locator('#event-reset').dblclick(); await assertStandby(true);
  assert.equal(await page.locator('#event-progress').inputValue(), '0');
  await page.locator('#event-start').click(); await assertRevealed();

  await page.locator('#event-menu-toggle').click();
  await page.locator('#event-menu-songs button').nth(2).click(); await assertStandby(false);
  await page.locator('#event-progress').evaluate(el => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); }); await assertStandby(false);
  await page.locator('#event-start').click(); await assertRevealed();
  await page.locator('#event-home').click();
  await page.locator('#projects').click();
  await page.locator(`#hub-list [data-cloud-id="${seeded.projects[1]}"] h2`).click();
  await page.locator('#project-songs').waitFor({ state: 'visible' }); await page.locator('#show-mode').click();
  await page.locator('#event-menu-toggle').click();
  assert.equal(await page.locator('#event-menu-songs button').nth(0).innerText(), '1. B only name');

  // Project-specific names are editable in the song library editor and survive a reload.
  await page.locator('#event-home').click(); await page.locator('#library').click();
  await page.locator(`#hub-list [data-cloud-id="${seeded.songs[0]}"] h2`).click();
  const nameField = page.getByRole('textbox', { name: 'Имя в медиатеке · Standby A' });
  await nameField.waitFor();
  assert.equal(await nameField.inputValue(), 'A only name');
  await nameField.fill('Edited project name'); await nameField.dispatchEvent('change');
  await page.locator('#save-project').click();
  await page.waitForFunction(async id => (await (await import('./remote.js')).getSong(id)).song.projectCovers.some(item => item.libraryName === 'Edited project name'), seeded.songs[0]);
  await page.reload(); await page.locator('#logout').waitFor({ state: 'visible' });
  await page.locator('#library').click(); await page.locator(`#hub-list [data-cloud-id="${seeded.songs[0]}"] h2`).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Имя в медиатеке · Standby A"]')?.value === 'Edited project name');
  assert.equal(await page.getByRole('textbox', { name: 'Имя в медиатеке · Standby A' }).inputValue(), 'Edited project name');
  await page.locator('#show-mode').click(); await page.locator('#event-menu-toggle').click();
  await page.locator('#event-menu-songs button').last().waitFor();
  const directMenu = await page.locator('#event-menu-songs button').allTextContents();
  assert.ok(directMenu.some(text => text.includes('Original portrait title')), JSON.stringify(directMenu));
  await page.locator('#event-menu-close').click();
  await page.locator('#event-home').click(); await page.locator('#library').click();
  await page.locator(`#hub-list [data-cloud-id="${seeded.songs[0]}"] [aria-label="Запустить"]`).click();
  await page.locator('#event-menu-toggle').click(); await page.locator('#event-menu-songs button').last().waitFor();
  assert.equal(await page.locator('#event-menu-songs button').filter({ hasText: 'Original portrait title' }).count(), 1, 'direct library presentation keeps normal library titles');
  assert.equal(await page.locator('#event-menu-songs button').filter({ hasText: 'Edited project name' }).count(), 0);
  await page.locator('#event-menu-close').click(); await page.locator('#event-home').click(); await page.locator('#projects').click();
  await page.locator(`#hub-list [data-cloud-id="${seeded.projects[0]}"] h2`).click();
  await page.locator('#project-songs').waitFor({ state: 'visible' }); await page.locator('#show-mode').click(); await page.locator('#event-menu-toggle').click();
  await page.locator('#event-menu-songs button').last().waitFor();
  assert.equal(await page.locator('#event-menu-songs button').first().innerText(), '1. Edited project name', 'project display resolves the latest saved library name');
  await page.locator('#event-menu-close').click(); await page.locator('#event-home').click(); await page.locator('#library').click();
  await page.locator(`#hub-list [data-cloud-id="${seeded.songs[0]}"] [aria-label="Запустить"]`).click();
  await page.locator('#event-menu-toggle').click(); await page.locator('#event-menu-songs button').last().waitFor();
  assert.equal(await page.locator('#event-menu-songs button').filter({ hasText: 'Original portrait title' }).count(), 1, 'direct library presentation keeps normal library titles');
  assert.equal(await page.locator('#event-menu-songs button').filter({ hasText: 'Edited project name' }).count(), 0);

  await page.locator('#event-home').click(); await page.locator('#projects').click();
  await page.locator(`#hub-list [data-cloud-id="${seeded.projects[0]}"] h2`).click();
  await page.locator('#project-songs').waitFor({ state: 'visible' }); await page.locator('#show-mode').click();
  await page.route(`**/api/audio/${seeded.audioId}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Injected backing startup failure' }) }));
  await page.locator('#event-menu-toggle').click(); await page.locator('#event-menu-songs button').nth(4).click();
  await page.locator('#event-start').click(); await page.locator('#event-audio-status').waitFor({ state: 'visible' });
  await assertStandby(true); await page.locator('#event-lyrics-only').click(); await assertRevealed();
  await page.unroute(`**/api/audio/${seeded.audioId}`);
  await page.locator('#event-menu-toggle').click(); await page.locator('#event-menu-songs button').nth(3).click();
  await assertStandby(false); await page.locator('#event-start').click();
  await page.locator('.audience-line.end-caption').waitFor({ timeout: 5000 });
  assert.equal(await lines.getAttribute('aria-hidden'), 'false', 'natural completion keeps the end presentation visible');
  await page.locator('#event-menu-toggle').click(); await page.locator('#event-menu-songs button').nth(5).click();
  await assertStandby(true); await page.locator('#event-start').click(); await assertRevealed();
  assert.equal(await page.locator('#event-player').evaluate(audio => audio.paused), false, 'successful backing audio plays with the lyrics');
  await page.evaluate(() => { window.revision32Audio = document.querySelector('#event-player'); });
  await page.locator('#event-start').click();
  assert.equal(await page.evaluate(() => window.revision32Audio.paused), true, 'pause pauses backing audio');
  assert.equal(await lines.getAttribute('aria-hidden'), 'false');
  const pausedPosition = await page.locator('#event-progress').inputValue(); await page.waitForTimeout(150);
  assert.equal(await page.locator('#event-progress').inputValue(), pausedPosition, 'paused playback holds its timeline position');
  await page.locator('#event-start').click(); await assertRevealed();
  await page.locator('#event-reset').dblclick(); await assertStandby(true);
  assert.equal(await page.locator('#event-player').count(), 0, 'reset releases the active backing element');
  assert.equal(await page.locator('#event-progress').inputValue(), '0', 'reset returns the playhead to zero');
  console.log('revision 32 browser checks passed; standby cover bounds:', JSON.stringify(bounds));
} finally {
  await browser?.close(); api.kill('SIGTERM'); server.kill('SIGTERM'); await new Promise(resolve => setTimeout(resolve, 150)); await rm(temporary, { recursive: true, force: true });
}
