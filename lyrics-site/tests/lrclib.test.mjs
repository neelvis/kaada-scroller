import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSynchronizedLyrics, LrclibClient, prepareLrcImport } from '../public/lrclib.js';

const record = (overrides = {}) => ({ id: 7, trackName: 'Песня & Song', artistName: 'Исполнитель', albumName: 'Album', duration: 123, instrumental: false, syncedLyrics: '[00:01.00]Припев\n[00:03.00][00:08.00]Again <tag>', ...overrides });
const response = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });

test('LRC availability excludes plain, malformed, empty and instrumental lyrics', () => {
  assert.equal(hasSynchronizedLyrics(record()), true);
  for (const syncedLyrics of [null, '', '  ', 'plain text', '[bad timestamp]broken', '[00:70]bad']) {
    assert.equal(hasSynchronizedLyrics(record({ syncedLyrics })), false);
  }
  assert.equal(hasSynchronizedLyrics(record({ instrumental: true })), false);
});

test('search encodes only title and artist and uses privacy-limited request options', async () => {
  let request;
  const client = new LrclibClient({ fetch: async (url, init) => { request = { url, init }; return response(JSON.stringify([record()])); } });
  const results = await client.search({ title: ' Песня & Song ', artist: ' Исполнитель ' });
  assert.equal(results[0].syncedLyrics, record().syncedLyrics);
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('track_name'), 'Песня & Song');
  assert.equal(url.searchParams.get('artist_name'), 'Исполнитель');
  assert.equal(request.init.credentials, 'omit');
  assert.equal(request.init.referrerPolicy, 'no-referrer');
  assert.equal(request.init.headers.Accept, 'application/json');
  assert.match(request.init.headers['Lrclib-Client'], /KaadaScroller v0\.1\.0/);
  await assert.rejects(client.search({ title: '  ' }), /Введите название/);
});

test('search rejects malformed service responses and timeout/cancellation with actionable messages', async () => {
  const malformed = new LrclibClient({ fetch: async () => response('{bad json') });
  await assert.rejects(malformed.search({ title: 'x' }), /некорректный ответ/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new LrclibClient({ fetch: async () => response('[]') }).search({ title: 'x', signal: controller.signal }), /отменён/);
  const inFlightController = new AbortController();
  const cancellable = new LrclibClient({ fetch: (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })) });
  const pending = cancellable.search({ title: 'x', signal: inFlightController.signal });
  inFlightController.abort();
  await assert.rejects(pending, /отменён/);
  let rejectFetch;
  const timeout = new LrclibClient({ fetch: (_url, init) => new Promise((_, reject) => { rejectFetch = reject; if (init.signal.aborted) reject(new DOMException('aborted', 'AbortError')); else init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }); }), setTimeout: (fn) => { fn(); return 1; }, clearTimeout: () => {} });
  await assert.rejects(timeout.search({ title: 'x' }), /не ответил за 15 секунд/);
  assert.equal(typeof rejectFetch, 'function');
});

test('search serializes requests, enforces pause, and preserves a rate-limit cooldown before parsing a non-JSON body', async () => {
  let now = 1_000;
  const waits = [];
  let resolveFirst;
  let calls = 0;
  const client = new LrclibClient({ clock: () => now, wait: async (ms) => { waits.push(ms); now += ms; }, fetch: () => (++calls === 1 ? new Promise((resolve) => { resolveFirst = resolve; }) : Promise.resolve(response('[]'))) });
  const first = client.search({ title: 'one' });
  await assert.rejects(client.search({ title: 'two' }), /уже выполняется/);
  resolveFirst(response('[]')); await first;
  await client.search({ title: 'two' });
  assert.deepEqual(waits, [350]);
  const limited = new LrclibClient({ clock: () => now, fetch: async () => response('not json', { status: 503, headers: { 'Retry-After': '2' } }) });
  await assert.rejects(limited.search({ title: 'x' }), /ограничил/);
  assert.equal(limited.retryAt, now + 2_000);
  await assert.rejects(limited.search({ title: 'x' }), /попросил подождать/);
  const noHeader = new LrclibClient({ clock: () => now, fetch: async () => response('not json', { status: 429 }) });
  await assert.rejects(noHeader.search({ title: 'x' }), /ограничил/);
  assert.equal(noHeader.retryAt, now + 60_000);
});

test('LRC import preserves literal repeated occurrences and fills only missing metadata', () => {
  const song = { title: '  ', artist: '', duration: 0, version: 'radio', delayMs: 100, source: { kind: 'audio', fileName: 'original.mp3' }, backing: { fileName: 'backing.mp3' }, reviewed: true };
  const snapshot = structuredClone(song);
  const imported = prepareLrcImport(song, record());
  assert.deepEqual(imported.cues.map(({ start, text }) => ({ start, text })), [
    { start: 1, text: 'Припев' }, { start: 3, text: 'Again <tag>' }, { start: 8, text: 'Again <tag>' },
  ]);
  assert.deepEqual(imported.details, { title: 'Песня & Song', artist: 'Исполнитель', duration: 123 });
  assert.deepEqual(song, snapshot);
  const complete = prepareLrcImport({ ...song, title: 'Own', artist: 'Own artist', duration: 1 }, record());
  assert.deepEqual(complete.details, {});
  assert.throws(() => prepareLrcImport(song, record({ syncedLyrics: '[00:70]bad' })), /некорректен/);
  assert.throws(() => prepareLrcImport(song, record({ instrumental: true })), /Инструментальную/);
  assert.throws(() => prepareLrcImport(song, record({ syncedLyrics: '' })), /нет синхронизированного/);
});

test('successful empty search stays empty even with Retry-After, and permits another search', async () => {
  for (const headers of [{}, { 'Retry-After': '60' }]) {
    let requests = 0;
    const client = new LrclibClient({ minRequestIntervalMs: 0, fetch: async () => {
      requests += 1;
      return response(requests === 1 ? '[]' : JSON.stringify([record()]), { headers });
    } });
    assert.deepEqual(await client.search({ title: 'no such song' }), []);
    assert.equal(client.retryAt, 0);
    assert.equal((await client.search({ title: 'Песня & Song' })).length, 1);
    assert.equal(requests, 2);
  }
});

test('cancellation while reading a slow body releases the client for a new search', async () => {
  const abort = new AbortController();
  let reading;
  const bodyStarted = new Promise(resolve => { reading = resolve; });
  let calls = 0;
  const client = new LrclibClient({ minRequestIntervalMs: 0, fetch: async (_url, init) => {
    if (++calls > 1) return response('[]');
    return { status: 200, ok: true, headers: new Headers(), text: () => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      reading();
    }) };
  } });
  const request = client.search({ title: 'slow body', signal: abort.signal });
  await bodyStarted; abort.abort();
  await assert.rejects(request, /отменён/);
  assert.deepEqual(await client.search({ title: 'retry', artist: '' }), []);
});

test('invalid records and service errors fail without exposing a partial result', async () => {
  for (const invalid of [{}, { ...record(), duration: '123' }, { ...record(), syncedLyrics: {} }]) {
    const client = new LrclibClient({ fetch: async () => response(JSON.stringify([record(), invalid])) });
    await assert.rejects(client.search({ title: 'x' }), /LRCLIB вернул/);
  }
  const client = new LrclibClient({ fetch: async () => response('upstream error', { status: 500 }) });
  await assert.rejects(client.search({ title: 'x' }), /ошибку 500/);
});

test('imports exceeding portable storage limits are rejected before any song mutation', () => {
  const song = { title: '', artist: '', duration: 0 };
  const snapshot = structuredClone(song);
  assert.throws(() => prepareLrcImport(song, record({ trackName: 'x'.repeat(1001) })), /нельзя сохранить/);
  assert.throws(() => prepareLrcImport(song, record({ syncedLyrics: '[00:01]' + 'x'.repeat(20001) })), /нельзя сохранить/);
  assert.throws(() => prepareLrcImport(song, record({ syncedLyrics: '[00:01]line\n'.repeat(5001) })), /нельзя сохранить/);
  assert.deepEqual(song, snapshot);
});
