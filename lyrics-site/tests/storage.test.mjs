import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSet, lyricsStorageName, resetLyrics } from '../public/storage.js';

test('storage uses an isolated lyrics database and fails cleanly without IndexedDB', async () => {
  assert.equal(lyricsStorageName, 'kaada-lyrics-v1');
  await assert.rejects(loadSet(), /недоступно/);
  await assert.rejects(resetLyrics(), /недоступно/);
});
