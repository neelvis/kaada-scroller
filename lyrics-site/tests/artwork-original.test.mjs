import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkLimits, prepareArtwork } from '../public/artwork.js';

test('prepareArtwork retains original data URL and accepts original dimensions above legacy resize limits', async () => {
  const previousBitmap = globalThis.createImageBitmap;
  const previousReader = globalThis.FileReader;
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, 2048);
  new DataView(bytes.buffer).setUint32(20, 1024);
  const original = 'data:image/png;base64,original-full-quality-bytes';
  let bitmapClosed = false;
  let readerUsed = false;
  globalThis.createImageBitmap = async () => ({ width: 2048, height: 1024, close() { bitmapClosed = true; } });
  globalThis.FileReader = class {
    readAsDataURL(file) { readerUsed = true; this.result = original; this.onload(); }
  };
  try {
    const file = { type: 'image/png', size: 3 * 1024 * 1024, async arrayBuffer() { return bytes.buffer; } };
    assert.equal(artworkLimits.source, 8 * 1024 * 1024);
    assert.equal('stored' in artworkLimits, false);
    assert.equal(await prepareArtwork(file), original);
    assert.equal(bitmapClosed, true);
    assert.equal(readerUsed, true);
  } finally {
    globalThis.createImageBitmap = previousBitmap;
    globalThis.FileReader = previousReader;
  }
});
