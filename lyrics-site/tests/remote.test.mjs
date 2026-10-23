import test from 'node:test';
import assert from 'node:assert/strict';
import { createSong, saveProject, maxJsonBytes } from '../public/remote.js';

test('oversize JSON writes fail before a network request with an actionable error', async () => {
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('Unexpected request'); };
  try {
    const payload = { cover: 'x'.repeat(maxJsonBytes) };
    await assert.rejects(async () => createSong(payload), error => error.status === 413 && error.code === 'too_large' && /облож/.test(error.message));
    await assert.rejects(async () => saveProject('project', payload), error => error.status === 413);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = previous; }
});
