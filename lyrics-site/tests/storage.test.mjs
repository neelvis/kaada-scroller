import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSet, lyricsStorageName, replaceStoredSet, resetLyrics } from '../public/storage.js';
import { createSong } from '../public/core.js';

test('storage uses an isolated lyrics database and fails cleanly without IndexedDB', async () => {
  assert.equal(lyricsStorageName, 'kaada-lyrics-v1');
  await assert.rejects(loadSet(), /недоступно/);
  await assert.rejects(resetLyrics(), /недоступно/);
});

test('portable backing validation happens before opening a replacing transaction', async () => {
  const set = { schemaVersion: 1, id: 'set', name: 'Set', songs: [createSong({ id: 'song', title: 'Song' })] };
  await assert.rejects(replaceStoredSet(set, []), /Map/);
  await assert.rejects(replaceStoredSet(set, new Map([['another-song', new Blob(['bytes'])]])), /не принадлежит/);
  await assert.rejects(replaceStoredSet(set, new Map([['song', 'bytes']])), /Blob/);
  await assert.rejects(replaceStoredSet(set, new Map([['song', new Blob()]])), /непустым/);
  await assert.rejects(replaceStoredSet(set, new Map([['song', new Blob(['valid'])]])), /недоступно/);
});
