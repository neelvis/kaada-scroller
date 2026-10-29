import test from 'node:test';
import assert from 'node:assert/strict';
import { sameEntryContent, reconcileProjectSave, recoverCommittedProjectSave } from '../public/save-reconciliation.js';
const entry = (id, text, revisionId, backingAudioId = null) => ({ songId: id, revisionId, audioId: null, backingAudioId, song: { id, title: id, reviewed: true, cues: [{ text }], ...(backingAudioId ? { backing: { fileName: 'track.wav' } } : {}) } });
test('save reconciliation adopts newer cloud content for untouched songs while retaining new local edits', () => {
  const a = entry('a', 'old A', 'a1'), b = entry('b', 'old B', 'b1');
  const currentB = { ...b.song, title: 'New local title' };
  const saved = { songs: [entry('a', 'new cloud A', 'a2'), b] };
  const result = reconcileProjectSave([a.song, currentB], new Map([['a', a], ['b', b]]), { songs: [a, b] }, saved, 'b');
  assert.equal(result.songs[0].cues[0].text, 'new cloud A');
  assert.equal(result.entries.get('a').revisionId, 'a2');
  assert.equal(result.songs[1].title, 'New local title');
  assert.equal(result.entries.get('b').revisionId, 'b1');
});
test('a locally edited stale song keeps its old revision so the next write conflicts', () => {
  const a = entry('a', 'old', 'a1'), cloud = entry('a', 'cloud edit', 'a2');
  const local = { ...a.song, title: 'local edit' };
  const result = reconcileProjectSave([local], new Map([['a', a]]), { songs: [a] }, { songs: [cloud] }, 'a');
  assert.equal(result.songs[0], local);
  assert.equal(result.entries.get('a').revisionId, 'a1');
});
test('new server IDs rebase without losing newer audio edits or restoring removed entries', () => {
  const sent = entry('draft', 'draft', undefined), saved = entry('cloud-id', 'draft', 'r1');
  saved.song.title = 'draft';
  const current = { ...sent.song, title: 'latest edit' };
  const result = reconcileProjectSave([current], new Map([['draft', { ...sent, audioId: 'new-audio' }]]), { songs: [sent] }, { songs: [saved] }, 'draft');
  assert.equal(result.songs[0].id, 'cloud-id'); assert.equal(result.songs[0].title, 'latest edit');
  assert.equal(result.entries.get('cloud-id').audioId, 'new-audio'); assert.equal(result.selectedId, 'cloud-id');
  assert.deepEqual(reconcileProjectSave([], new Map(), { songs: [sent] }, { songs: [saved] }, null).songs, []);
});
test('content equality ignores JSON key order, local IDs and absent empty backing', () => {
  assert.equal(sameEntryContent({ song: { id: 'a', title: 'T', backing: { fileName: '' } } }, { audioId: null, song: { title: 'T', id: 'b' } }), true);
});

test('committed save recovery binds known uploaded songs while protecting an unavailable newer head', () => {
  const before = entry('draft', 'uploaded', undefined), stale = entry('shared', 'old', 'r1');
  before.song.cover = 'data:image/png;base64,YQ==';
  stale.song.cover = 'data:image/png;base64,Yg==';
  const wire = structuredClone({ songs: [before, stale] });
  wire.songs[0].song.cover = './api/artwork/' + 'a'.repeat(64);
  wire.songs[1].song.cover = './api/artwork/' + 'b'.repeat(64);
  const saved = { revision: 2, songs: [
    { ...wire.songs[0], songId: 'created', revisionId: 'created-r1', song: { ...wire.songs[0].song, id: 'created' } },
    { ...wire.songs[1], revisionId: 'r2', song: { ...wire.songs[1].song, cover: './api/artwork/' + 'c'.repeat(64) } },
  ] };
  const sent = { songs: [before, stale] }, recovered = recoverCommittedProjectSave(sent, wire, saved);
  const newerEdit = { ...before.song, title: 'Edited during upload' };
  const result = reconcileProjectSave([newerEdit, stale.song], new Map([['draft', before], ['shared', stale]]), sent, recovered, 'draft');
  assert.equal(recovered.revision, 2);
  assert.equal(result.songs[0].title, 'Edited during upload');
  assert.equal(result.songs[0].cover, before.song.cover);
  assert.equal(result.entries.get('created').revisionId, 'created-r1');
  assert.equal(result.entries.get('shared').revisionId, 'r1', 'unavailable newer head cannot become an edit baseline');
  assert.equal(result.songs[1].cover, stale.song.cover, 'local data never contains unresolved cloud refs');
});
