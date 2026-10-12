import test from 'node:test';
import assert from 'node:assert/strict';
import { recognitionCues, groupedWordCues, audioEnergy } from '../public/recognition-utils.js';

test('recognized repeats remain separate occurrences with model timestamps', () => {
  const cues = recognitionCues({ chunks: [{ text: ' Припев ', timestamp: [1.2, 2] }, { text: 'Припев', timestamp: [8.9, 10] }] }, 15);
  assert.deepEqual(cues.map(c => [c.start, c.text]), [[1.2, 'Припев'], [8.9, 'Припев']]);
  assert.notEqual(cues[0].id, cues[1].id);
});
test('missing or out-of-range starts remain untimed, not fabricated', () => {
  const cues = recognitionCues({ chunks: [{ text: 'a', timestamp: [null, 1] }, { text: 'b', timestamp: [30, 31] }] }, 20);
  assert.deepEqual(cues.map(c => c.start), [null, null]);
});
test('untimestamped text remains recoverable; silence is not successful', () => {
  assert.equal(recognitionCues({ text: 'Words without time' }, 20)[0].start, null);
  assert.throws(() => recognitionCues({ text: ' ', chunks: [] }, 20));
  assert.equal(audioEnergy(new Float32Array(400)), 0);
  assert.ok(audioEnergy(new Float32Array([0.5, -0.5])) > 0.4);
});

test('word timestamps become manageable MP3-only phrases without invented starts', () => {
  const chunks = [['one', 1], ['two', 1.2], ['three', 1.4], ['four', 1.6], ['five', 1.8], ['six', 2], ['seven', 2.2], ['eight,', 2.4], ['after-pause', 4]].map(([text, start]) => ({ text, timestamp: [start, start + 0.1] }));
  const cues = groupedWordCues(chunks, 10);
  assert.deepEqual(cues.map(cue => [cue.start, cue.text]), [[1, 'one two three four five six seven'], [2.4, 'eight,'], [4, 'after-pause']]);
  assert.ok(cues.length < chunks.length);
});

test('cancellation terminates its worker so a stale result cannot affect a retry', async () => {
  const previous = { AudioContext: globalThis.AudioContext, OfflineAudioContext: globalThis.OfflineAudioContext, Worker: globalThis.Worker };
  const workers = [];
  class FakeWorker {
    constructor() { this.listeners = { message: new Set(), error: new Set() }; workers.push(this); }
    addEventListener(type, callback) { this.listeners[type].add(callback); }
    removeEventListener(type, callback) { this.listeners[type].delete(callback); }
    postMessage() {}
    terminate() { this.terminated = true; }
    emit(data) { for (const callback of this.listeners.message) callback({ data }); }
  }
  class FakeAudioContext {
    async decodeAudioData() { return { duration: 1 }; }
    async close() {}
  }
  class FakeOfflineAudioContext {
    createBufferSource() { return { connect() {}, start() {}, set buffer(value) {} }; }
    get destination() { return {}; }
    async startRendering() { return { getChannelData: () => new Float32Array([0.5, -0.5]) }; }
  }
  globalThis.Worker = FakeWorker;
  globalThis.AudioContext = FakeAudioContext;
  globalThis.OfflineAudioContext = FakeOfflineAudioContext;
  try {
    const { recognizeFile } = await import(`../public/recognition.js?cancellation=${Date.now()}`);
    const controller = new AbortController();
    const file = { size: 1, name: 'voice.mp3', arrayBuffer: async () => new ArrayBuffer(1) };
    const cancelled = recognizeFile(file, { signal: controller.signal, profile: 'fast' });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    assert.equal(workers[0].terminated, true);
    workers[0].emit({ type: 'result', result: { cues: [{ text: 'stale', start: 0 }] } });

    const retried = recognizeFile(file, { profile: 'fast' });
    await new Promise(resolve => setTimeout(resolve, 0));
    workers[1].emit({ type: 'result', result: { cues: [{ text: 'fresh', start: 0 }] } });
    assert.equal((await retried).cues[0].text, 'fresh');
  } finally {
    globalThis.AudioContext = previous.AudioContext;
    globalThis.OfflineAudioContext = previous.OfflineAudioContext;
    globalThis.Worker = previous.Worker;
  }
});
