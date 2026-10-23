import assert from 'node:assert/strict';
import test from 'node:test';
import { contentFingerprint, downloadProjectFiles, matchesContentFingerprint, projectLink, uploadLocalProject } from '../public/cloud-transfers.js';
import { createSong, normalizeSet } from '../public/core.js';

const project = () => ({ schemaVersion: 1, id: 'local-project', name: 'Project', songs: [createSong({ id: 'local-song', title: 'Song' })] });

test('projectLink pins cloud song revisions to their local project version IDs', () => {
  const local = project();
  local.songs.push(createSong({ id: 'second-local', title: 'Second' }));
  const cloud = { id: 'cloud-project', revision: 9, songs: [
    { songId: 'cloud-song', revisionId: 'song-revision-2' },
    { songId: 'second-cloud', revisionId: 'second-revision-1' },
  ] };
  const link = projectLink(local, cloud);
  assert.deepEqual(link.entries, [
    { localId: 'local-song', songId: 'cloud-song', revisionId: 'song-revision-2' },
    { localId: 'second-local', songId: 'second-cloud', revisionId: 'second-revision-1' },
  ]);
  assert.equal(link.id, 'cloud-project');
  assert.equal(link.revision, 9);
});

test('project fingerprints survive local normalization and still accept stored legacy fingerprints', () => {
  const original = project();
  const song = original.songs[0];
  original.songs[0] = Object.fromEntries(Object.entries(song).reverse());
  const oldFingerprint = JSON.stringify(original);
  const normalized = normalizeSet(original);
  assert.ok(matchesContentFingerprint(normalized, oldFingerprint));
  assert.equal(contentFingerprint(normalized), contentFingerprint(original));
});

test('stale linked uploads refuse writes before touching media or cloud content', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method });
    return new Response(JSON.stringify({ revision: 4, revisionId: 'new-song-revision' }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await assert.rejects(uploadLocalProject(project(), { id: 'project-id', revision: 3 }), error => error.code === 'conflict');
    assert.deepEqual(requests.map(request => request.url), ['./api/projects/project-id']);
    assert.ok(requests.every(request => request.method === 'GET'));
  } finally { globalThis.fetch = originalFetch; }
});

test('replaying an unlinked project upload returns the previously completed migration', async () => {
  const originalFetch = globalThis.fetch;
  const completed = { id: 'already-uploaded', revision: 1, name: 'Project', songs: [] };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method });
    return new Response(JSON.stringify(completed), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await uploadLocalProject(project(), null), completed);
    assert.deepEqual(requests, [{ url: './api/imports/local-project', method: 'GET' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('project downloads keep cloud IDs unchanged and assign independent local media keys', async () => {
  const originalFetch = globalThis.fetch;
  const source = { ...createSong({ id: 'cloud-song', title: 'Song', backing: { fileName: 'track.wav' } }), projectCovers: [{ projectId: 'cloud-project', cover: 'data:image/png;base64,YQ==' }] };
  const cloud = { id: 'cloud-project', name: 'Cloud project', songs: [{ song: source, backingAudioId: 'backing-id', audioId: 'original-id' }] };
  globalThis.fetch = async url => new Response(url.endsWith('backing-id') ? 'backing bytes' : 'original bytes');
  try {
    const downloaded = await downloadProjectFiles(cloud);
    const localSong = downloaded.local.songs[0];
    assert.notEqual(localSong.id, source.id);
    assert.equal(downloaded.local.id, localSong.projectCovers[0].projectId);
    assert.equal(source.id, 'cloud-song');
    assert.equal(await downloaded.audio.get(`backing:${localSong.id}`).text(), 'backing bytes');
    assert.equal(await downloaded.audio.get(`original:${localSong.id}`).text(), 'original bytes');
    assert.equal(downloaded.audio.size, 2);
    await assert.rejects(downloadProjectFiles({ ...cloud, songs: [{ song: source, backingAudioId: null }] }), /отсутствует в облаке/);
  } finally { globalThis.fetch = originalFetch; }
});

test('linked upload remaps the local project cover association to its cloud project ID', async () => {
  const { connectWorkspace } = await import('../public/local-workspace.js');
  const { createDirectoryFixture } = await import('./workspace-memory-fixture.mjs');
  await connectWorkspace(createDirectoryFixture().handle);
  const originalFetch = globalThis.fetch, writes = [];
  const local = project();
  local.songs[0].projectCovers = [{ projectId: local.id, cover: 'data:image/png;base64,YQ==' }];
  globalThis.fetch = async (url, options) => {
    if (options.method === 'GET') return new Response(JSON.stringify({ revision: 4 }), { headers: { 'Content-Type': 'application/json' } });
    writes.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ id: 'cloud-project', revision: 5 }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await uploadLocalProject(local, { id: 'cloud-project', revision: 4 });
    assert.equal(writes[0].songs[0].song.projectCovers[0].projectId, 'cloud-project');
    assert.equal(local.songs[0].projectCovers[0].projectId, local.id);
  } finally { globalThis.fetch = originalFetch; }
});

test('project download reports structured song progress and preserves the project closing caption', async () => {
  const originalFetch = globalThis.fetch;
  const source = createSong({ id: 'cloud-song', title: 'Song' });
  const cloud = { name: 'Cloud project', endCaption: 'Спасибо за песню', songs: [{ song: source, backingAudioId: null, audioId: null }] };
  const progress = [];
  globalThis.fetch = async () => { throw new Error('no media should be requested'); };
  try {
    const downloaded = await downloadProjectFiles(cloud, update => progress.push(update));
    assert.equal(downloaded.local.endCaption, 'Спасибо за песню');
    assert.deepEqual(progress, [
      { phase: 'downloading', completed: 0, total: 1, label: 'Скачивание: 1 из 1' },
      { phase: 'downloading', completed: 1, total: 1, label: 'Скачивание: 1 из 1' },
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test('lost import response retries retain newer edits and original song bindings after reorder', async () => {
  const { connectWorkspace } = await import('../public/local-workspace.js');
  const { createDirectoryFixture } = await import('./workspace-memory-fixture.mjs');
  await connectWorkspace(createDirectoryFixture().handle);
  const baseline = project(); baseline.songs.push(createSong({ id: 'local-second', title: 'Second' }));
  baseline.songs[0].projectCovers = [{ projectId: baseline.id, cover: 'data:image/png;base64,YQ==' }];
  const completed = { id: 'created', name: baseline.name, revision: 1, songs: baseline.songs.map((song, index) => ({ songId: `cloud-${index}`, revisionId: `r-${index}`, audioId: null, backingAudioId: null, song: { ...song, id: `cloud-${index}`, projectCovers: song.projectCovers.map(item => ({ ...item, projectId: item.projectId === baseline.id ? 'created' : item.projectId })) } })) };
  const current = structuredClone(baseline); current.songs.reverse(); current.songs[1].title = 'Changed after lost response'; current.name = 'New local name';
  const originalFetch = globalThis.fetch, writes = [];
  globalThis.fetch = async (url, options) => {
    if (options.method === 'PUT') { const body = JSON.parse(options.body); writes.push(body); return new Response(JSON.stringify({ ...completed, name: body.name, revision: 2, songs: body.songs }), { headers: { 'Content-Type': 'application/json' } }); }
    return new Response(JSON.stringify(completed), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    assert.deepEqual(await uploadLocalProject(baseline, null, () => {}, baseline), completed, 'an unchanged retry accepts the imported project artwork association');
    const saved = await uploadLocalProject(current, null, () => {}, baseline);
    assert.equal(saved.name, 'New local name'); assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].songs.map(entry => entry.songId), ['cloud-1', 'cloud-0']);
    assert.equal(writes[0].songs[1].song.title, 'Changed after lost response');
    assert.equal(writes[0].songs[1].song.projectCovers[0].projectId, completed.id);
    assert.equal(writes[0].revision, 1);
    completed.name = 'Concurrent cloud rename';
    await assert.rejects(uploadLocalProject(current, null, () => {}, baseline), error => error.code === 'conflict');
    assert.equal(writes.length, 1, 'a newer project name must not be overwritten on recovery');
    completed.name = baseline.name; completed.songs[0].song.title = 'Concurrent cloud song edit';
    await assert.rejects(uploadLocalProject(current, null, () => {}, baseline), error => error.code === 'conflict');
    assert.equal(writes.length, 1, 'a newer song head must not be used to overwrite newer cloud content');
    completed.songs[0].song.title = baseline.songs[0].title;
    completed.songs[0].song.projectCovers[0].cover = 'data:image/png;base64,Yg==';
    await assert.rejects(uploadLocalProject(current, null, () => {}, baseline), error => error.code === 'conflict');
    assert.equal(writes.length, 1, 'a newer cloud cover must not be overwritten on recovery');
  } finally { globalThis.fetch = originalFetch; }
});
