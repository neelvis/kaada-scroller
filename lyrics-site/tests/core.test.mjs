import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSong,
  cueAt,
  exportSet,
  formatTime,
  importSet,
  invalidateReview,
  parseLrc,
  parseTime,
  validateSong,
} from '../public/core.js';

function song(partial = {}) {
  return createSong({
    id: 'song-1', title: 'Песня', duration: 120, reviewed: true,
    cues: [{ id: 'a', start: 1, text: 'Первая' }, { id: 'b', start: 5, text: 'Second' }],
    ...partial,
  });
}

test('LRC expands every timestamp occurrence and preserves repeated chorus text', () => {
  const parsed = parseLrc('[ar:Artist]\n[00:03.00][00:43.50]Припев\n[01:04]Verse');
  assert.deepEqual(parsed.cues.map(({ start, text }) => ({ start, text })), [
    { start: 3, text: 'Припев' }, { start: 43.5, text: 'Припев' }, { start: 64, text: 'Verse' },
  ]);
  assert.equal(parsed.metadata.ar, 'Artist');
});

test('LRC applies the offset once and leaves negative times visible for validation', () => {
  const parsed = parseLrc('[offset:-1500]\n[00:01.00]Начало\n[00:03.00]Дальше');
  assert.deepEqual(parsed.cues.map((cue) => cue.start), [-0.5, 1.5]);
  const errors = validateSong(song({ cues: parsed.cues }));
  assert.ok(errors.some((error) => error.includes('не может быть отрицательным')));
});

test('LRC refuses malformed or unsynchronised nonempty lines', () => {
  assert.throws(() => parseLrc('Просто слова без времени'), /не содержит корректной/);
  assert.throws(() => parseLrc('[00:70]Неверное время'), /неверное время/);
  assert.throws(() => parseLrc('[offset:1]\n[offset:2]'), /повторно/);
  assert.throws(() => parseLrc('[offset:foo]'), /неверный offset/);
});

test('time helpers parse and format negative values', () => {
  assert.equal(parseTime('-1:02.5'), -62.5);
  assert.equal(parseTime('1:60'), null);
  assert.equal(formatTime(-62.5), '-1:02.5');
});

test('draft import is preserved while malformed structural input is rejected', () => {
  const draft = song({ reviewed: false, cues: [{ id: 'draft', start: null, text: 'Черновик' }] });
  const imported = importSet(JSON.stringify({ schemaVersion: 1, id: 'set', name: 'Концерт', songs: [draft] }));
  assert.equal(imported.songs[0].cues[0].start, null);
  assert.equal(imported.songs[0].reviewed, false);
  assert.ok(validateSong(imported.songs[0]).length > 0);
  assert.throws(() => importSet('{"schemaVersion":1,"id":"x","name":"x","songs":"bad"}'), /число песен/);
});

test('cue lookup honors positive delay and declared end', () => {
  const current = song({ delayMs: 1000, duration: 10 });
  assert.deepEqual(cueAt(current, 1), { index: -1, effectiveTime: 0, ended: false });
  assert.deepEqual(cueAt(current, 2), { index: 0, effectiveTime: 1, ended: false });
  assert.deepEqual(cueAt(current, 11), { index: -1, effectiveTime: 10, ended: true });
});

test('25-song export and import preserves order and manual fields', () => {
  const songs = Array.from({ length: 25 }, (_, index) => song({
    id: `song-${index}`, title: `Song ${index}`, version: 'radio edit', reviewed: index % 2 === 0,
  }));
  const original = { schemaVersion: 1, id: 'set-25', name: 'Большой концерт', songs };
  const restored = importSet(exportSet(original));
  assert.equal(restored.songs.length, 25);
  assert.deepEqual(restored.songs.map((item) => item.id), songs.map((item) => item.id));
  assert.equal(restored.songs[14].version, 'radio edit');
});

test('untrusted prototype-pollution fields are rejected and review invalidation copies data', () => {
  const polluted = '{"schemaVersion":1,"id":"x","name":"x","__proto__":{"polluted":true},"songs":[]}';
  assert.throws(() => importSet(polluted), /недопустимое поле/);
  assert.equal({}.polluted, undefined);
  const ready = song();
  const edited = invalidateReview(ready);
  assert.equal(edited.reviewed, false);
  assert.notEqual(edited.cues, ready.cues);
});

test('import rejects ambiguous empty and duplicate song and cue identifiers', () => {
  const base = song();
  const set = { schemaVersion: 1, id: 'set', name: 'Набор', songs: [base] };
  base.cues[1].id = base.cues[0].id;
  assert.throws(() => importSet(JSON.stringify(set)), /id строки.*повторяется/);

  const first = song({ id: 'same' });
  const second = song({ id: 'same' });
  assert.throws(
    () => importSet(JSON.stringify({ schemaVersion: 1, id: 'set', name: 'Набор', songs: [first, second] })),
    /id песни.*повторяется/,
  );

  first.id = '   ';
  assert.throws(
    () => importSet(JSON.stringify({ schemaVersion: 1, id: 'set', name: 'Набор', songs: [first] })),
    /не может быть пустым/,
  );
});
