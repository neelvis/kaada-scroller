import assert from 'node:assert/strict';
import test from 'node:test';
import { contentFingerprint, downloadProjectFiles, projectLink, transferState, uploadLocalProject, uploadLocalSong } from '../public/cloud-transfers.js';
import { createSong } from '../public/core.js';
import { exportPortableSet, importPortableSet } from '../public/portable.js';

const project = () => ({ schemaVersion: 1, id: 'local-project', name: 'Project', songs: [createSong({ id: 'local-song', title: 'Song' })] });

test('transferState distinguishes local, current, one-sided edits, and two-sided conflicts', () => {
  const local = project();
  const link = { id: 'cloud-project', revision: 3, fingerprint: contentFingerprint(local) };
  const edited = structuredClone(local);
  edited.songs[0].title = 'Local edit';
  assert.equal(transferState(local, null, 4), 'local');
  assert.equal(transferState(local, link, 3), 'current');
  assert.equal(transferState(edited, link, 3), 'local-changes');
  assert.equal(transferState(local, link, 4), 'cloud-changes');
  assert.equal(transferState(edited, link, 4), 'conflict');
  assert.equal(transferState(local, link, undefined), 'current');
  assert.equal(transferState(edited, link, null), 'local-changes');
});

test('same-name media replacement revisions survive portable roundtrip and detect conflicts', async () => {
  const local = project();
  local.songs[0] = createSong({ ...local.songs[0], backing: { fileName: 'same.wav' }, mediaRevision: 'old-media' });
  const link = projectLink(local, { id: 'cloud', revision: 3, songs: [{ songId: 'song', revisionId: 'revision' }] });
  const changed = structuredClone(local);
  changed.songs[0].mediaRevision = 'new-media';
  assert.equal(changed.songs[0].backing.fileName, local.songs[0].backing.fileName);
  assert.equal(changed.songs[0].reviewed, local.songs[0].reviewed);
  assert.equal(transferState(changed, link, 3), 'local-changes');
  assert.equal(transferState(changed, link, 4), 'conflict');
  const zip = await exportPortableSet(changed, async () => new Blob(['replacement bytes'], { type: 'audio/wav' }));
  const restored = await importPortableSet(new File([zip], 'project.zip', { type: 'application/zip' }));
  assert.equal(restored.set.songs[0].mediaRevision, 'new-media');
  assert.equal(transferState(restored.set, link, 3), 'local-changes');
  assert.equal(transferState(restored.set, link, 4), 'conflict');
  assert.equal(await restored.backingAudio.get('local-song').text(), 'replacement bytes');
});

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
  assert.equal(transferState(local, link, 9), 'current');
  local.songs[0].cues.push({ id: 'cue', start: 0, text: 'Local lyrics', type: 'lyric' });
  assert.equal(transferState(local, link, 9), 'local-changes');
  assert.equal(transferState(local, link, 10), 'conflict');
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
    await assert.rejects(uploadLocalSong(project().songs[0], { id: 'song-id', revision: 'old-song-revision' }), error => error.code === 'conflict');
    assert.deepEqual(requests.map(request => request.url), ['./api/projects/project-id', './api/songs/song-id']);
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
  const source = createSong({ id: 'cloud-song', title: 'Song', backing: { fileName: 'track.wav' } });
  const cloud = { name: 'Cloud project', songs: [{ song: source, backingAudioId: 'backing-id', audioId: 'original-id' }] };
  globalThis.fetch = async url => new Response(url.endsWith('backing-id') ? 'backing bytes' : 'original bytes');
  try {
    const downloaded = await downloadProjectFiles(cloud);
    const localSong = downloaded.local.songs[0];
    assert.notEqual(localSong.id, source.id);
    assert.equal(source.id, 'cloud-song');
    assert.equal(await downloaded.audio.get(`backing:${localSong.id}`).text(), 'backing bytes');
    assert.equal(await downloaded.audio.get(`original:${localSong.id}`).text(), 'original bytes');
    assert.equal(downloaded.audio.size, 2);
    await assert.rejects(downloadProjectFiles({ ...cloud, songs: [{ song: source, backingAudioId: null }] }), /отсутствует в облаке/);
  } finally { globalThis.fetch = originalFetch; }
});
