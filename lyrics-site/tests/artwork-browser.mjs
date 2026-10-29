import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installWorkspaceDirectory } from './workspace-test-directory.mjs';

const temporary = await mkdtemp(resolve(tmpdir(), 'kaada-original-artwork-'));
const port = Number(process.env.LYRICS_ARTWORK_PORT || 8168), apiPort = port + 1;
const origin = `http://127.0.0.1:${port}/lyrics/`;
const password = 'ephemeral original artwork test password', salt = Buffer.alloc(16, 19);
const credentials = resolve(temporary, 'credentials.json');
await writeFile(credentials, JSON.stringify({ salt: salt.toString('hex'), hash: scryptSync(password, salt, 32).toString('hex') }));
const dataDirectory = resolve(temporary, 'api-data');
const env = { ...process.env, LYRICS_DATA_DIR: dataDirectory, LYRICS_PASSWORD_FILE: credentials, LYRICS_ORIGIN: new URL(origin).origin, LYRICS_COOKIE_PATH: '/', LYRICS_COOKIE_SECURE: 'false' };
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
  const page = await context.newPage(), errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().includes('/api/') && ['POST', 'PUT'].includes(request.method()) && request.headers()['content-type']?.startsWith('application/json') && request.postData()) {
      writes.push({ url: request.url(), method: request.method(), body: request.postData() });
    }
  });
  const directory = resolve(temporary, 'workspace'); await mkdir(directory);
  await installWorkspaceDirectory(page, directory);
  await page.goto(origin);
  await page.locator('#login').click();
  await page.locator('#login-password').fill(password);
  await page.locator('#login-form button[type=submit]').click();
  await page.locator('#logout').waitFor({ state: 'visible' });

  const cloud = await page.evaluate(async () => {
    const { prepareArtwork, artworkLimits } = await import('./artwork.js');
    const remote = await import('./remote.js');
    async function makeArtwork(width, height, seed, type = 'image/png', minimumSize = 2 * 1024 * 1024) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d'), pixels = context.createImageData(width, height);
      let state = seed >>> 0;
      for (let index = 0; index < pixels.data.length; index++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        pixels.data[index] = state >>> 24;
      }
      context.putImageData(pixels, 0, 0);
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[type];
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.9));
      const file = new File([blob], `original-${seed}.${extension}`, { type: blob.type });
      const dataUrl = await prepareArtwork(file);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (blob.size < minimumSize) throw new Error(`Test image too small to cover original quality: ${blob.size}`);
      if (blob.size > artworkLimits.source) throw new Error(`Test image exceeded source admission limit: ${blob.size}`);
      const readBack = Uint8Array.from(atob(dataUrl.split(',')[1]), character => character.charCodeAt(0));
      const mismatch = readBack.findIndex((byte, index) => byte !== bytes[index]);
      if (readBack.length !== bytes.length || mismatch >= 0) throw new Error(`prepareArtwork changed source bytes (blob ${bytes.length}, file ${file.size}, returned ${readBack.length}, file type ${file.type}, data URL ${dataUrl.slice(0, 40)}, first mismatch ${mismatch})`);
      return { dataUrl, bytes: Array.from(bytes), width, height };
    }
    // Three separate legacy data URLs aggregate well above the JSON write cap.
    const artwork = [
      await makeArtwork(900, 900, 41),
      await makeArtwork(900, 900, 73),
      await makeArtwork(1800, 400, 109),
    ];
    artwork.push(await makeArtwork(80, 64, 151, 'image/jpeg', 0), await makeArtwork(72, 96, 197, 'image/webp', 0));
    if (artwork[2].width <= 1600) throw new Error('Wide source regression was not exercised');
    const totalBytes = artwork.reduce((sum, item) => sum + item.bytes.length, 0);
    if (totalBytes <= 5 * 1024 * 1024) throw new Error(`Aggregate original bytes did not exceed 5 MiB: ${totalBytes}`);

    const { createSong } = await import('./core.js');
    for (const [index, source] of artwork.slice(3).entries()) {
      const standalone = createSong({
        title: `Original ${index ? 'WebP' : 'JPEG'} artwork roundtrip`, artist: 'Format Test', album: 'Format Originals',
        duration: 10, reviewed: true, cover: source.dataUrl,
        cues: [{ id: `format-cue-${index}`, start: 0, type: 'lyric', text: 'Format byte preservation' }],
      });
      standalone.reviewed = true;
      const createdFormatSong = await remote.createSong({ migrationKey: crypto.randomUUID(), song: standalone });
      const currentFormatSong = await remote.getSong(createdFormatSong.songId);
      await remote.saveSong(createdFormatSong.songId, {
        revisionId: createdFormatSong.revisionId,
        song: { ...currentFormatSong.song, title: `${standalone.title} updated` },
        audioId: null, backingAudioId: null,
      });
    }
    const projectIdForOverride = `legacy-project-${crypto.randomUUID()}`;
    const song = createSong({
      title: 'Original artwork regression', artist: 'Artwork Test', duration: 10, reviewed: true, album: 'Originals',
      cover: artwork[0].dataUrl,
      projectCovers: [{ projectId: projectIdForOverride, cover: artwork[1].dataUrl }],
      cues: [{ id: 'cue', start: 0, type: 'lyric', text: 'Original artwork test' }],
    });
    song.reviewed = true;
    const created = await remote.createSong({ migrationKey: crypto.randomUUID(), song });
    const createdSong = await remote.getSong(created.songId);
    const initialProject = await remote.createProject('Original artwork project');
    const projectSong = { ...createdSong.song, projectCovers: [{ projectId: initialProject.id, cover: artwork[1].dataUrl }] };
    const savedSong = await remote.saveSong(created.songId, { revisionId: created.revisionId, song: projectSong, audioId: null, backingAudioId: null });
    const project = await remote.saveProject(initialProject.id, {
      revision: initialProject.revision, name: initialProject.name, cover: artwork[2].dataUrl,
      songs: [{ ...createdSong, ...savedSong, song: projectSong }],
    });
    const reopened = await remote.getProject(project.id);
    const originals = [artwork[2], artwork[0], artwork[1]];

    // Retrying an unchanged save should use existing content-addressed assets.
    const repeated = await remote.saveProject(project.id, {
      revision: reopened.revision, name: reopened.name, cover: artwork[2].dataUrl,
      songs: reopened.songs,
    });
    const afterRepeat = await remote.getProject(repeated.id);
    const local = await import('./local-workspace.js');
    await local.connectWorkspace(await window.showDirectoryPicker());
    const transfers = await import('./cloud-transfers.js');
    const files = await transfers.downloadProjectFiles(afterRepeat);
    await local.saveWorkspace({ schemaVersion: 1, library: [], projects: [files.local], links: { [`project:${files.local.id}`]: transfers.projectLink(files.local, afterRepeat) } }, files.audio);
    const loadedLocal = await local.connectWorkspace(await window.showDirectoryPicker());
    const presentation = await import('./artwork.js');
    const localSong = loadedLocal.projects[0].songs[0];
    const offlineCover = presentation.presentationArtwork(localSong, localSong.projectCovers[0].projectId, loadedLocal.projects[0].cover);

    // Also exercise automatic storage on a local-to-cloud import with data URLs still embedded.
    const importSource = {
      schemaVersion: 1, id: `local-${crypto.randomUUID()}`, name: 'Legacy local artwork transfer',
      cover: artwork[2].dataUrl,
      songs: [{ ...projectSong, id: `song-${crypto.randomUUID()}`, title: 'Local artwork transfer copy', projectCovers: [{ projectId: `local-${crypto.randomUUID()}`, cover: artwork[1].dataUrl }] }],
    };
    importSource.songs[0].projectCovers[0].projectId = importSource.id;
    const imported = await transfers.uploadLocalProject(importSource, null);
    const importedAgain = await remote.getProject(imported.id);

    return {
      artwork, totalBytes,
      originals: originals.map(item => ({ bytes: item.bytes, width: item.width, height: item.height })),
      project: { id: afterRepeat.id, revision: afterRepeat.revision, cover: afterRepeat.cover },
      local: { projectCover: loadedLocal.projects[0].cover, songCover: localSong.cover, override: localSong.projectCovers[0].cover, offlineCover },
      imported: { id: importedAgain.id, cover: importedAgain.cover, songCover: importedAgain.songs[0].song.cover, override: importedAgain.songs[0].song.projectCovers[0].cover },
    };
  });

  assert.ok(cloud.totalBytes > 5 * 1024 * 1024);
  assert.equal(cloud.originals[0].width, 1800);
  assert.equal(cloud.local.projectCover, cloud.artwork[2].dataUrl);
  assert.equal(cloud.local.songCover, cloud.artwork[0].dataUrl);
  assert.equal(cloud.local.override, cloud.artwork[1].dataUrl);
  assert.equal(cloud.local.offlineCover, cloud.local.override, 'project-specific cover keeps presentation precedence in the local copy');
  assert.equal(cloud.imported.cover, cloud.artwork[2].dataUrl);
  assert.equal(cloud.imported.songCover, cloud.artwork[0].dataUrl);
  assert.equal(cloud.imported.override, cloud.artwork[1].dataUrl);

  let failProjectSave = true;
  await page.route('**/api/projects/**', route => {
    if (failProjectSave && route.request().method() === 'PUT') {
      failProjectSave = false;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected final-save failure', code: 'test_failure' }) });
    }
    return route.continue();
  });
  const failure = await page.evaluate(async ({ id, artwork }) => {
    const remote = await import('./remote.js'), current = await remote.getProject(id);
    const attempted = { revision: current.revision, name: current.name, cover: artwork, songs: current.songs };
    let rejected = false;
    try { await remote.saveProject(id, attempted); } catch (error) { rejected = error.status === 503; }
    const afterFailure = await remote.getProject(id);
    if (!rejected) throw new Error('Injected final save failure was reported as success');
    if (attempted.cover !== artwork) throw new Error('Failed save discarded the caller original');
    if (afterFailure.cover !== current.cover) throw new Error('Failed final save changed previously saved artwork');
    await remote.saveProject(id, attempted);
    return { rejected, priorCover: current.cover, retriedCover: (await remote.getProject(id)).cover };
  }, { id: cloud.project.id, artwork: cloud.artwork[0].dataUrl });
  assert.equal(failure.rejected, true);
  assert.equal(failure.priorCover, cloud.artwork[2].dataUrl);
  assert.equal(failure.retriedCover, cloud.artwork[0].dataUrl);

  const parsedWrites = writes.map(write => ({ ...write, payload: JSON.parse(write.body) }));
  for (const write of parsedWrites.filter(item => ['POST', 'PUT'].includes(item.method) && !new URL(item.url).pathname.endsWith('/api/artwork'))) {
    assert.ok(!write.body.includes('data:image/'), `embedded artwork reached JSON endpoint ${write.url}`);
    assert.ok(new TextEncoder().encode(write.body).byteLength < 5 * 1024 * 1024, `JSON write exceeded cap at ${write.url}`);
  }
  const refs = [...new Set(parsedWrites.flatMap(write => JSON.stringify(write.payload).match(/\.\/api\/artwork\/[a-f0-9]{64}/g) || []))];
  assert.equal(refs.length, 5, 'project, primary song, project override, JPEG, and WebP should be stored as separate assets');
  for (let index = 0; index < refs.length; index++) assert.match(refs[index], /^\.\/api\/artwork\/[a-f0-9]{64}$/);
  const downloaded = await page.evaluate(async refs => Promise.all(refs.map(async ref => {
    const response = await fetch(ref); if (!response.ok) throw new Error(`Could not fetch original artwork ${response.status}`);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  })), refs);
  const byHash = new Map(cloud.artwork.map(item => [createHash('sha256').update(Buffer.from(item.bytes)).digest('hex'), item.bytes]));
  for (let index = 0; index < refs.length; index++) {
    const hash = refs[index].split('/').at(-1);
    assert.ok(byHash.has(hash), `stored reference ${hash} is not keyed by source SHA-256`);
    assert.deepEqual(downloaded[index], byHash.get(hash), `stored artwork ${hash} differs from source bytes`);
  }
  const artworkFiles = await readdir(resolve(dataDirectory, 'artwork'));
  assert.equal(artworkFiles.length, refs.length, 'unchanged artwork should not create duplicate stored assets');

  // Exercise the editor's committed-save recovery: the song head changes while
  // this project remains open, then artwork hydration fails after its rename
  // has been committed. Retrying must use the returned raw wire payload and new
  // project revision so the structural edit does not conflict or lose artwork.
  await page.reload();
  await page.locator('#projects').click();
  const cloudProjectCard = page.locator(`#hub-list [data-cloud-id="${cloud.project.id}"]`);
  await cloudProjectCard.locator('h2').click();
  await page.locator('#set-name').waitFor({ state: 'visible' });
  const beforeRecovery = await page.evaluate(async id => {
    const current = await (await import('./remote.js')).getProject(id);
    return { name: current.name, revision: current.revision, songId: current.songs[0].songId, revisionId: current.songs[0].revisionId, song: current.songs[0].song };
  }, cloud.project.id);
  assert.equal(await page.locator('#set-name').inputValue(), beforeRecovery.name);
  const jpegHead = await page.evaluate(async ({ songId, artwork }) => {
    const remote = await import('./remote.js'), current = await remote.getSong(songId);
    const next = await remote.saveSong(songId, {
      revisionId: current.revisionId,
      song: { ...current.song, cover: artwork },
      audioId: current.audioId ?? null, backingAudioId: current.backingAudioId ?? null,
    });
    return { revisionId: next.revisionId, cover: next.song.cover };
  }, { songId: beforeRecovery.songId, artwork: cloud.artwork[3].dataUrl });
  assert.equal(jpegHead.cover, cloud.artwork[3].dataUrl, 'out-of-band song save installs the already-stored JPEG original');

  const renamed = 'Artwork commit recovery project';
  await page.locator('#set-name').fill(renamed);
  await page.locator('#set-name').blur();
  const jpegHash = createHash('sha256').update(Buffer.from(cloud.artwork[3].bytes)).digest('hex');
  const unavailableArtwork = `**/api/artwork/${jpegHash}`;
  await page.route(unavailableArtwork, route => route.request().method() === 'GET'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected artwork hydration failure' }) })
    : route.continue());
  await page.locator('#save-project').click();
  await page.waitForFunction(() => document.querySelector('#remote-state')?.textContent === 'Облако обновлено · загрузку обложек нужно повторить');
  await page.unroute(unavailableArtwork);
  await page.locator('#save-project').click();
  await page.waitForFunction(() => document.querySelector('#remote-state')?.textContent === 'Сохранено в облаке');
  const recovered = await page.evaluate(async id => (await (await import('./remote.js')).getProject(id)), cloud.project.id);
  assert.equal(recovered.name, renamed);
  assert.equal(recovered.songs[0].song.cover, cloud.artwork[3].dataUrl, 'retry adopts the out-of-band JPEG head after recovering the committed save');
  assert.ok(recovered.revision > beforeRecovery.revision, 'retry uses the revision returned by the committed save');
  const uiArtworkSources = await page.locator('#editor img, #project-cover-preview').evaluateAll(images => images.map(image => image.getAttribute('src')).filter(Boolean));
  assert.ok(uiArtworkSources.every(src => !/^\.\/api\/artwork\//.test(src)), 'hydrated editor state does not leak cloud asset references into local data URLs');

  const ref = refs[0];
  const logoutRequest = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/logout') && response.request().method() === 'POST' && response.status() === 204);
  await page.locator('#logout').click();
  await logoutRequest;
  await page.locator('#login').waitFor({ state: 'visible' });
  await page.locator('#logout').waitFor({ state: 'hidden' });
  const unauthenticated = await page.evaluate(async ref => (await fetch(ref)).status, ref);
  assert.equal(unauthenticated, 401, 'artwork references require an authenticated session');

  // Reload the local workspace with all API requests unavailable. Local cover
  // data remains readable and presentation does not need cloud artwork access.
  await context.route('**/api/**', route => route.abort());
  await page.reload();
  const localOffline = await page.evaluate(async () => {
    const local = await import('./local-workspace.js');
    const state = await local.connectWorkspace(await window.showDirectoryPicker());
    const project = state.projects[0], song = project.songs[0];
    const { presentationArtwork } = await import('./artwork.js');
    return { projectCover: project.cover, songCover: song.cover, override: song.projectCovers[0].cover, presented: presentationArtwork(song, song.projectCovers[0].projectId, project.cover) };
  });
  assert.equal(localOffline.projectCover.startsWith('data:image/png;base64,'), true);
  assert.equal(localOffline.override.startsWith('data:image/png;base64,'), true);
  assert.equal(localOffline.presented, localOffline.override);
  assert.deepEqual(errors, []);
  console.log('PASS: original bytes, >5 MiB automatic offload, song/project/local transfer, deduplication, offline reopening, and authentication');
} catch (error) {
  if (logs) error.message += `\nDisposable service logs:\n${logs}`;
  throw error;
} finally {
  await browser?.close(); api.kill(); server.kill();
  await Promise.all([api, server].filter(child => child.exitCode === null).map(child => new Promise(resolve => child.once('exit', resolve))));
  await rm(temporary, { recursive: true, force: true });
}
