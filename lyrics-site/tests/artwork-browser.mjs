import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installWorkspaceDirectory } from './workspace-test-directory.mjs';

const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-artwork-'));
const port = Number(process.env.LYRICS_ARTWORK_PORT || 8168), apiPort = port + 1;
const origin = `http://127.0.0.1:${port}/lyrics/`;
const password = 'ephemeral artwork test password', salt = Buffer.alloc(16, 19);
const credentials = resolve(temporary, 'credentials.json');
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const env = { ...process.env, LYRICS_DATA_DIR: resolve(temporary, 'api-data'), LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
const api = spawn(process.env.LYRICS_TEST_PYTHON || 'backend/.venv/bin/python', ['-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', String(apiPort)], { env, stdio: 'pipe' });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...env, LYRICS_PORT: String(port), LYRICS_API_PORT: String(apiPort) }, stdio: 'pipe' });
let browser, logs = '';
for (const child of [api, server]) { child.stderr.on('data', data => { logs += data; }); child.on('error', error => { logs += error.message; }); }
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin + 'api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const directory = resolve(temporary, 'workspace'); await mkdir(directory);
  await installWorkspaceDirectory(page, directory);
  await page.goto(origin);
  const result = await page.evaluate(async password => {
    const { prepareArtwork, artworkLimits } = await import('./artwork.js');
    const remote = await import('./remote.js');
    await remote.login(password);
    const canvas = document.createElement('canvas'); canvas.width = 1100; canvas.height = 1100;
    const context = canvas.getContext('2d'), pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 37;
    for (let index = 0; index < pixels.data.length; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[index] = seed >>> 24;
    }
    context.putImageData(pixels, 0, 0);
    const covers = [];
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 1));
      const cover = await prepareArtwork(new File([blob], 'cover', { type: blob.type }));
      if ((await (await fetch(cover)).blob()).size > artworkLimits.stored) throw new Error('Stored artwork too large');
      covers.push(cover);
      if (type === 'image/png' && blob.size <= 4 * 1024 * 1024) throw new Error('Large source regression was not exercised');
    }
    const { createSong } = await import('./core.js');
    const song = createSong({ title:'Artwork regression', duration:10, reviewed:true, album:'Album', cover:covers[0], cues:[{id:'cue',start:0,type:'lyric',text:'Lyrics'}] });
    song.reviewed = true;
    const entry = await remote.createSong({ migrationKey:crypto.randomUUID(), song });
    const project = await remote.createProject('Artwork project');
    const saved = await remote.saveProject(project.id, { revision:project.revision, name:project.name, cover:covers[1], songs:[entry] });
    const reopened = await remote.getProject(saved.id);
    const local = await import('./local-workspace.js');
    await local.connectWorkspace(await window.showDirectoryPicker());
    const { downloadProjectFiles, projectLink } = await import('./cloud-transfers.js');
    const files = await downloadProjectFiles(reopened);
    await local.saveWorkspace({schemaVersion:1,library:[],projects:[files.local],links:{[`project:${files.local.id}`]:projectLink(files.local,reopened)}}, files.audio);
    return { songCover:reopened.songs[0].song.cover, projectCover:reopened.cover, expectedSong:covers[0], expectedProject:covers[1] };
  }, password);
  assert.equal(result.songCover, result.expectedSong); assert.equal(result.projectCover, result.expectedProject);
  await page.reload();
  const reopened = await page.evaluate(async () => {
    const local = await import('./local-workspace.js');
    const state = await local.connectWorkspace(await window.showDirectoryPicker());
    return { songCover:state.projects[0].songs[0].cover, projectCover:state.projects[0].cover };
  });
  assert.equal(reopened.songCover, result.expectedSong); assert.equal(reopened.projectCover, result.expectedProject);
  assert.deepEqual(errors, []);
  console.log('PASS: large PNG/JPEG/WebP preparation, authenticated cloud roundtrip and fresh local folder reopening');
} finally {
  await browser?.close(); api.kill(); server.kill();
  await Promise.all([api, server].filter(child => child.exitCode === null).map(child => new Promise(resolve => child.once('exit', resolve))));
  await rm(temporary, { recursive:true, force:true });
}
