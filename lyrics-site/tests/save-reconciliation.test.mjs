import test from 'node:test';
import assert from 'node:assert/strict';
import { sameEntryContent, reconcileProjectSave } from '../public/save-reconciliation.js';
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
