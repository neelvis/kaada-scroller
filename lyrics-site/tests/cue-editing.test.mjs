import assert from 'node:assert/strict';
import test from 'node:test';
import { createSong, exportSet, importSet, validateSong } from '../public/core.js';
import { insertRestCue, moveCueToBoundary, suggestRestStart } from '../public/cue-editing.js';

const cues = [
  { id: 'first-chorus', start: 10.12345, text: 'Chorus', type: 'lyric' },
  { id: 'custom-rest', start: 14, text: 'Guitar solo', type: 'rest' },
  { id: 'second-chorus', start: 20, text: 'Chorus', type: 'lyric' },
];
const song = partial => ({ ...createSong({ id: 'song', title: 'Song', duration: 60, cues, ...partial }), reviewed: true });

test('first, middle and last occurrences move by identity without retiming or relabeling', () => {
  const original = song();
  for (const [cueId, boundary, ids] of [
    ['first-chorus', 3, ['custom-rest', 'second-chorus', 'first-chorus']],
    ['custom-rest', 0, ['custom-rest', 'first-chorus', 'second-chorus']],
    ['second-chorus', 0, ['second-chorus', 'first-chorus', 'custom-rest']],
    ['custom-rest', 3, ['first-chorus', 'second-chorus', 'custom-rest']],
  ]) {
    const moved = moveCueToBoundary(original, cueId, boundary);
    assert.deepEqual(moved.cues.map(cue => cue.id), ids);
    for (const cue of moved.cues) assert.deepEqual(cue, original.cues.find(item => item.id === cue.id));
    assert.equal(moved.reviewed, false);
  }
  assert.deepEqual(original.cues.map(cue => cue.id), cues.map(cue => cue.id));
  assert.equal(original.reviewed, true);
});

test('same-position boundaries and invalid moves keep the exact ready song', () => {
  const original = song();
  for (const [cueId, boundary] of [
    ['first-chorus', 0], ['first-chorus', 1],
    ['custom-rest', 1], ['custom-rest', 2],
    ['second-chorus', 2], ['second-chorus', 3],
    ['missing', 0], ['first-chorus', -1], ['first-chorus', 4], ['first-chorus', 0.5],
  ]) assert.equal(moveCueToBoundary(original, cueId, boundary), original);
});

test('reorder leaves conflicting times visible to the existing readiness validator', () => {
  const moved = moveCueToBoundary(song(), 'second-chorus', 0);
  const errors = validateSong({ ...moved, reviewed: true });
  assert.ok(errors.some(error => error.includes('строго позже предыдущей')));
  assert.deepEqual(moved.cues.map(cue => cue.start), [20, 10.12345, 14]);
});

test('rest estimate extrapolates two immediately preceding increasing nonnegative starts', () => {
  assert.equal(suggestRestStart([{ start: 10 }, { start: 14 }], 2), 18);
  assert.equal(suggestRestStart([{ start: 0 }, { start: 0.125 }], 2), 0.25);
});

test('one usable immediate predecessor uses five seconds without searching earlier rows', () => {
  for (const previous of [undefined, null, NaN, Infinity, -1, 10, 12]) {
    const prefix = previous === undefined ? [] : [{ start: previous }];
    assert.equal(suggestRestStart([...prefix, { start: 10 }], prefix.length + 1), 15);
  }
});

test('missing or unusable immediate predecessor and insertion at the beginning use zero', () => {
  assert.equal(suggestRestStart([], 0), 0);
  assert.equal(suggestRestStart([{ start: 10 }], 0), 0);
  for (const start of [undefined, null, NaN, Infinity, -1]) {
    assert.equal(suggestRestStart([{ start: 10 }, { start }], 2), 0);
  }
});

test('rest insertion works at every boundary and leaves existing cue data unchanged', () => {
  const original = song({ cues: [
    { id: 'a', start: 10, text: 'First', type: 'lyric' },
    { id: 'b', start: 14, text: 'Solo name', type: 'rest' },
  ] });
  for (const [boundary, start] of [[0, 0], [1, 15], [2, 18]]) {
    const inserted = insertRestCue(original, boundary, 'inserted');
    assert.deepEqual(inserted.cues[boundary], { id: 'inserted', start, text: '', type: 'rest' });
    assert.deepEqual(inserted.cues.filter(cue => cue.id !== 'inserted'), original.cues);
    assert.equal(inserted.reviewed, false);
  }
  const empty = insertRestCue(song({ cues: [] }), 0, 'intro');
  assert.deepEqual(empty.cues, [{ id: 'intro', start: 0, text: '', type: 'rest' }]);
  assert.equal(insertRestCue(original, -1, 'bad'), original);
  assert.equal(insertRestCue(original, 3, 'bad'), original);
});

test('estimates conflicting with the next cue or song end require ordinary timing correction', () => {
  const nextConflict = insertRestCue(song(), 1, 'rest-next');
  assert.ok(validateSong({ ...nextConflict, reviewed: true }).some(error => error.includes('строго позже предыдущей')));
  const endConflict = insertRestCue(song({ duration: 25 }), 3, 'rest-end');
  assert.equal(endConflict.cues.at(-1).start, 26);
  assert.ok(validateSong({ ...endConflict, reviewed: true }).some(error => error.includes('раньше конца песни')));
});

test('moving a new rest keeps its estimate, and portable JSON preserves order, IDs and rest labels', () => {
  const inserted = insertRestCue(song(), 3, 'new-rest');
  const moved = moveCueToBoundary(inserted, 'new-rest', 0);
  assert.equal(moved.cues[0].start, 26);
  const set = { schemaVersion: 1, id: 'set', name: 'Program', songs: [moved] };
  const reopened = importSet(exportSet(set)).songs[0];
  assert.deepEqual(reopened.cues, moved.cues);
  assert.equal(reopened.cues.find(cue => cue.id === 'custom-rest').text, 'Guitar solo');
  assert.equal(reopened.reviewed, false);
});
