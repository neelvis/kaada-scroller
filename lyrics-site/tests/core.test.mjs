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
  assert.equal(cueAt(current, 10).ended, true, 'delay must not extend the declared audio duration');
  assert.equal(cueAt({ ...current, delayMs: -1000 }, 9).ended, false, 'negative delay must not end the show early');
});

test('portable backing labels survive round trips while private audio identities are excluded', () => {
  const original = { schemaVersion: 1, id: 'backing-set', name: 'Concert', songs: [song({ backing: { fileName: 'instrumental.wav', audioId: 'private' }, backingAudioId: 'private-entry' })] };
  const restored = importSet(exportSet(original));
  assert.deepEqual(restored.songs[0].backing, { fileName: 'instrumental.wav' });
  assert.equal(restored.songs[0].backingAudioId, undefined);
  const malformed = structuredClone(original); malformed.songs[0].backing = 'not-an-object';
  assert.throws(() => importSet(JSON.stringify(malformed)), /минусовка/);
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

test('ignore timecodes preserves text validation and bypasses all stored timing checks', () => {
  const untimed = song({ ignoreTimecodes: true, cues: [
    { id: 'a', start: null, text: 'Первая' }, { id: 'b', start: -1, text: 'Second' },
    { id: 'c', start: 200, text: 'Third' }, { id: 'd', start: 0, text: 'Last' },
  ] });
  untimed.reviewed = true;
  assert.deepEqual(validateSong(untimed), []);
  assert.ok(validateSong({ ...untimed, ignoreTimecodes: false }).length >= 3);
  assert.ok(validateSong({ ...untimed, duration: 0 }).length);
  assert.ok(validateSong({ ...untimed, reviewed: false }).length);
  assert.ok(validateSong({ ...untimed, cues: [{ ...untimed.cues[0], text: '' }] }).length);
  assert.equal(invalidateReview(untimed).ignoreTimecodes, true);
  assert.equal(cueAt(untimed, 50).index, -1);
  assert.equal(cueAt(untimed, 120).ended, true);
});

test('blank interlude labels and optional end captions survive portable round trips', () => {
  const original = {
    schemaVersion: 1, id: 'set', name: 'Концерт', endCaption: 'Финальная подпись проекта', songs: [{ ...song({
      endCaption: 'Финальная подпись песни',
      cues: [{ id: 'rest', start: 1, text: '', type: 'rest' }],
    }), reviewed: true }],
  };
  assert.deepEqual(validateSong(original.songs[0]), []);
  const restored = importSet(exportSet(original));
  assert.equal(restored.endCaption, 'Финальная подпись проекта');
  assert.equal(restored.songs[0].endCaption, 'Финальная подпись песни');
  assert.equal(restored.songs[0].cues[0].text, '');
  assert.ok(validateSong({ ...original.songs[0], cues: [{ id: 'lyric', start: 1, text: '', type: 'lyric' }] }).some(error => error.includes('введите текст')));
});

test('legacy sets receive empty end captions and reject oversized captions', () => {
  const legacy = importSet(JSON.stringify({ schemaVersion: 1, id: 'legacy', name: 'Legacy', songs: [song()] }));
  assert.equal(legacy.endCaption, '');
  assert.equal(legacy.songs[0].endCaption, '');
  assert.deepEqual(legacy.songs[0].projectCovers, []);
  const oversized = { schemaVersion: 1, id: 'set', name: 'Set', endCaption: 'x'.repeat(1001), songs: [] };
  assert.throws(() => exportSet(oversized), /финальная подпись набора.*слишком длинное/);
});

test('project song covers round trip and malformed or duplicate project IDs are rejected', () => {
  const set = { schemaVersion: 1, id: 'set', name: 'Set', songs: [{ ...song(), projectCovers: [{ projectId: 'project-a', cover: 'data:image/webp;base64,YQ==', libraryName: 'Evening song' }, { projectId: 'project-b', cover: '', libraryName: 'Name only' }] }] };
  assert.deepEqual(importSet(exportSet(set)).songs[0].projectCovers, set.songs[0].projectCovers);
  const legacyArtwork = importSet(JSON.stringify({ ...set, songs: [{ ...set.songs[0], projectCovers: [{ projectId: 'project-a', cover: null }] }] }));
  assert.deepEqual(legacyArtwork.songs[0].projectCovers, [{ projectId: 'project-a', cover: '' }]);
  assert.throws(() => importSet(JSON.stringify({ ...set, songs: [{ ...set.songs[0], projectCovers: [...set.songs[0].projectCovers, ...set.songs[0].projectCovers] }] })), /повторяется/);
  assert.throws(() => importSet(JSON.stringify({ ...set, songs: [{ ...set.songs[0], projectCovers: [{ projectId: 'project-a', cover: 'invalid' }] }] })), /обложка проекта/);
  assert.throws(() => importSet(JSON.stringify({ ...set, songs: [{ ...set.songs[0], projectCovers: [{ projectId: 'project-a', cover: '', libraryName: 'x'.repeat(1001) }] }] })), /имя в медиатеке/);
});

test('ignore timecodes survives portable normalization and defaults off for legacy songs', () => {
  const original = song({ ignoreTimecodes: true, cues: [{ id: 'a', start: null, text: 'Line' }] });
  const set = { schemaVersion: 1, id: 'set', name: 'Test', songs: [original] };
  const restored = importSet(exportSet(set)).songs[0];
  assert.equal(restored.ignoreTimecodes, true);
  assert.equal(restored.cues[0].start, null);
  delete original.ignoreTimecodes;
  assert.equal(importSet(exportSet(set)).songs[0].ignoreTimecodes, false);
  original.ignoreTimecodes = 'true';
  assert.throws(() => exportSet(set), /ignoreTimecodes/);
});

test('uniform scroll progress has fixed ten-second intro and follows elapsed time', async () => {
  const { uniformScrollProgress } = await import('../public/core.js');
  const value = { duration: 70, delayMs: 5000 };
  for (const elapsed of [-1, 0, 9.9, 10]) assert.equal(uniformScrollProgress(value, elapsed), 0);
  assert.equal(uniformScrollProgress(value, 40), .5);
  assert.equal(uniformScrollProgress(value, 70), 1);
  assert.equal(uniformScrollProgress(value, 100), 1);
  assert.equal(uniformScrollProgress(value, 25), .25);
  assert.equal(uniformScrollProgress({ duration: 10 }, 10), 0);
  assert.equal(uniformScrollProgress({ duration: 5 }, 3), 0);
});


test('backing-only playback is valid with reviewed metadata and a linked track', () => {
  assert.deepEqual(validateSong({ ...song({ cues: [], backing: { fileName: 'instrumental.wav' } }), reviewed: true }), []);
  assert.ok(validateSong(song({ cues: [], backing: { fileName: '' } })).some(message => message.includes('текст или минусовку')));
  assert.ok(validateSong(song({ cues: [], reviewed: false, backing: { fileName: 'instrumental.wav' } })).some(message => message.includes('Подтвердите')));
});
