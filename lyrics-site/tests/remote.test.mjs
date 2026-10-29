import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSong, getSong, maxJsonBytes, saveProject } from '../public/remote.js';

const toDataUrl = bytes => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
const artworkId = bytes => createHash('sha256').update(bytes).digest('hex');
const artworkRef = bytes => `./api/artwork/${artworkId(bytes)}`;
const response = (body, status = 200, type = 'application/json') => new Response(body, { status, headers: { 'Content-Type': type } });

test('oversize non-artwork JSON fails before any network request', async () => {
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('Unexpected request'); };
  try {
    await assert.rejects(createSong({ title: 'x'.repeat(maxJsonBytes) }), error => error.status === 413 && error.code === 'too_large');
    await assert.rejects(saveProject('project', { name: 'x'.repeat(maxJsonBytes), cover: toDataUrl([1]) }), error => error.status === 413);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = previous; }
});

test('save uploads original bytes once and restores submitted artwork without rereading it', async () => {
  const previous = globalThis.fetch;
  const original = Buffer.from([0, 1, 17, 128, 255, 9]);
  const dataUrl = toDataUrl(original);
  const id = artworkId(original), ref = artworkRef(original);
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === `./api/artwork/${id}` && options.method === 'HEAD') {
      assert.equal(options.cache, 'no-store');
      return response(null, 404);
    }
    if (url === './api/artwork') {
      assert.deepEqual(Buffer.from(options.body), original);
      assert.equal(options.headers['Content-Type'], 'image/png');
      return response(JSON.stringify({ id, cover: ref }));
    }
    if (url === './api/songs') {
      const body = JSON.parse(options.body);
      assert.equal(body.song.cover, ref);
      assert.equal(body.song.projectCovers[0].cover, ref);
      return response(JSON.stringify({ songId: 'song', song: body.song }));
    }
    if (url === `./api/artwork/${id}`) return response(JSON.stringify({ error: 'asset reread should not happen' }), 503);
    throw new Error(`Unexpected request ${url}`);
  };
  const payload = { song: { title: 'Song', cover: dataUrl, projectCovers: [{ projectId: 'p', cover: dataUrl }] } };
  try {
    const result = await createSong(payload);
    assert.equal(payload.song.cover, dataUrl, 'input remains unchanged');
    assert.equal(result.song.cover, dataUrl);
    assert.equal(result.song.projectCovers[0].cover, dataUrl);
    assert.equal(calls.filter(call => call.options.method === 'HEAD').length, 1, 'same bytes are checked once per operation');
    assert.equal(calls.filter(call => call.url === './api/artwork').length, 1, 'same data URL uploads once per operation');
    assert.equal(calls.filter(call => call.url === `./api/artwork/${id}` && call.options.method !== 'HEAD').length, 0, 'submitted artwork is reused without a post-save GET');
  } finally { globalThis.fetch = previous; }
});

test('large legacy embedded cover is uploaded before the 5 MiB JSON guard', async () => {
  const previous = globalThis.fetch;
  const original = Buffer.alloc(5 * 1024 * 1024, 5);
  const dataUrl = toDataUrl(original);
  const id = artworkId(original), ref = artworkRef(original);
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push(url);
    if (url === `./api/artwork/${id}` && options.method === 'HEAD') return response(null, 404);
    if (url === './api/artwork') return response(JSON.stringify({ id, cover: ref }));
    if (url === './api/projects/p') {
      const body = JSON.parse(options.body);
      assert.equal(body.cover, ref);
      assert.ok(options.body.length < maxJsonBytes);
      return response(JSON.stringify({ id: 'p', cover: ref }));
    }
    if (url === `./api/artwork/${id}`) return response(original, 200, 'image/png');
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const result = await saveProject('p', { name: 'Large legacy cover', cover: dataUrl, songs: [] });
    assert.equal(result.cover, dataUrl);
    assert.equal(calls.filter(url => url === './api/artwork').length, 1);
  } finally { globalThis.fetch = previous; }
});

test('unchanged artwork reuses its content hash when later uploads would exceed server quota', async () => {
  const previous = globalThis.fetch;
  const original = Buffer.from([22, 23, 24, 25]);
  const dataUrl = toDataUrl(original);
  const id = artworkId(original), ref = artworkRef(original);
  let headChecks = 0, uploads = 0, saves = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === `./api/artwork/${id}` && options.method === 'HEAD') {
      headChecks += 1;
      return response(null, headChecks === 1 ? 404 : 200);
    }
    if (url === './api/artwork') {
      uploads += 1;
      if (uploads > 1) return response(JSON.stringify({ error: 'quota exhausted' }), 507);
      return response(JSON.stringify({ id, cover: ref }));
    }
    if (url === './api/projects/p') {
      saves += 1;
      assert.equal(JSON.parse(options.body).cover, ref);
      return response(JSON.stringify({ id: 'p', cover: ref }));
    }
    if (url === `./api/artwork/${id}`) return response(original, 200, 'image/png');
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    const project = { name: 'Artwork project', cover: dataUrl, songs: [] };
    assert.equal((await saveProject('p', project)).cover, dataUrl);
    assert.equal((await saveProject('p', project)).cover, dataUrl);
    assert.equal(headChecks, 2, 'each operation checks authenticated asset existence');
    assert.equal(uploads, 1, 'existing content does not consume quota again');
    assert.equal(saves, 2);
  } finally { globalThis.fetch = previous; }
});

test('artwork existence-check errors stop before upload', async () => {
  const previous = globalThis.fetch;
  const bytes = Buffer.from([31, 32, 33]);
  const id = artworkId(bytes);
  let requests = 0;
  globalThis.fetch = async (url, options = {}) => {
    requests += 1;
    assert.equal(url, `./api/artwork/${id}`);
    assert.equal(options.method, 'HEAD');
    return response(JSON.stringify({ error: 'authentication required' }), 401);
  };
  try {
    await assert.rejects(createSong({ song: { cover: toDataUrl(bytes) } }), error => error.status === 401);
    assert.equal(requests, 1, 'no asset upload or song write follows a failed check');
  } finally { globalThis.fetch = previous; }
});

test('payload snapshot is retained while the existence HEAD is pending', async () => {
  const previous = globalThis.fetch;
  const original = Buffer.from([41, 42, 43]);
  const editedLater = Buffer.from([51, 52, 53]);
  const originalUrl = toDataUrl(original), laterUrl = toDataUrl(editedLater);
  const id = artworkId(original), ref = artworkRef(original);
  let releaseHead;
  let signalHead;
  const headStarted = new Promise(resolve => { signalHead = resolve; });
  const pendingHead = new Promise(resolve => { releaseHead = resolve; });
  globalThis.fetch = async (url, options = {}) => {
    if (url === `./api/artwork/${id}` && options.method === 'HEAD') {
      assert.equal(options.cache, 'no-store');
      signalHead();
      await pendingHead;
      return response(null, 404);
    }
    if (url === './api/artwork') {
      assert.deepEqual(Buffer.from(options.body), original);
      return response(JSON.stringify({ id, cover: ref }));
    }
    if (url === './api/songs') {
      assert.equal(JSON.parse(options.body).song.cover, ref);
      return response(JSON.stringify({ songId: 'song', song: { cover: ref } }));
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const payload = { song: { cover: originalUrl } };
  try {
    const saving = createSong(payload);
    await headStarted;
    payload.song.cover = laterUrl;
    releaseHead();
    const result = await saving;
    assert.equal(payload.song.cover, laterUrl);
    assert.equal(result.song.cover, originalUrl);
  } finally {
    releaseHead();
    globalThis.fetch = previous;
  }
});

test('post-save hydration failure is reported as committed and exposes raw response', async () => {
  const previous = globalThis.fetch;
  const submitted = Buffer.from([61, 62, 63]);
  const submittedId = artworkId(submitted), submittedRef = artworkRef(submitted);
  const newerRef = artworkRef(Buffer.from('new shared head'));
  const rawResult = { id: 'p', cover: newerRef };
  let saveCompleted = false;
  globalThis.fetch = async (url, options = {}) => {
    if (url === `./api/artwork/${submittedId}` && options.method === 'HEAD') return response(null, 404);
    if (url === './api/artwork') return response(JSON.stringify({ id: submittedId, cover: submittedRef }));
    if (url === './api/projects/p') { saveCompleted = true; return response(JSON.stringify(rawResult)); }
    if (url === `./api/artwork/${newerRef.split('/').at(-1)}`) return response(JSON.stringify({ error: 'temporarily unavailable' }), 503);
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await assert.rejects(saveProject('p', { name: 'Saved', cover: toDataUrl(submitted), songs: [] }), error => {
      assert.equal(saveCompleted, true);
      assert.equal(error.code, 'saved_artwork_unavailable');
      assert.equal(error.committed, true);
      assert.deepEqual(error.result, rawResult);
      assert.deepEqual(error.wirePayload, { name: 'Saved', cover: submittedRef, songs: [] });
      assert.match(error.message, /сохранены в облаке/);
      return true;
    });
  } finally { globalThis.fetch = previous; }
});

test('malformed artwork refs are rejected without fetching arbitrary cover URLs', async () => {
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('Unexpected request'); };
  try {
    await assert.rejects(createSong({ song: { cover: './api/artwork/not-a-hash' } }), error => error.code === 'invalid_artwork');
    globalThis.fetch = async url => {
      requests += 1;
      assert.equal(url, './api/songs/song');
      return response(JSON.stringify({ songId: 'song', song: { cover: 'https://example.test/image.png' } }));
    };
    const result = await getSong('song');
    assert.equal(result.song.cover, 'https://example.test/image.png');
    assert.equal(requests, 1, 'only metadata request was made');
  } finally { globalThis.fetch = previous; }
});

test('failed upload rejects save and a retry can upload again without mutating the draft', async () => {
  const previous = globalThis.fetch;
  const bytes = Buffer.from([3, 4, 5]);
  const id = artworkId(bytes), ref = artworkRef(bytes);
  const draft = { song: { cover: toDataUrl(bytes) } };
  let fail = true;
  let uploads = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === `./api/artwork/${id}` && options.method === 'HEAD') return response(null, 404);
    if (url === './api/artwork') {
      uploads += 1;
      if (fail) return response(JSON.stringify({ error: 'temporary failure' }), 503);
      return response(JSON.stringify({ id, cover: ref }));
    }
    if (url === './api/songs') return response(JSON.stringify({ songId: 'song', song: { cover: '' } }));
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await assert.rejects(createSong(draft), error => error.status === 503);
    assert.equal(draft.song.cover, toDataUrl(bytes));
    fail = false;
    const result = await createSong(draft);
    assert.equal(result.song.cover, '');
    assert.equal(uploads, 2);
  } finally { globalThis.fetch = previous; }
});

test('missing referenced artwork rejects response hydration', async () => {
  const previous = globalThis.fetch;
  const ref = artworkRef(Buffer.from('missing'));
  const id = ref.split('/').at(-1);
  globalThis.fetch = async (url, options = {}) => {
    if (url === './api/songs/song') return response(JSON.stringify({ songId: 'song', song: { cover: ref } }));
    if (url === `./api/artwork/${id}`) {
      assert.equal(options.cache, 'no-store');
      return response(JSON.stringify({ error: 'missing' }), 404);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  try {
    await assert.rejects(getSong('song'), error => error.status === 404);
  } finally { globalThis.fetch = previous; }
});
