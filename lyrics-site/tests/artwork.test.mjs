import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareArtwork } from '../public/artwork.js';
import { artworkDimensions } from '../public/artwork-dimensions.js';

function png(width, height) {
  const bytes = Buffer.alloc(24);
  bytes.write('89504e470d0a1a0a', 0, 'hex'); bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

test('oversized raster headers are rejected before image decoding', async () => {
  const previous = globalThis.createImageBitmap;
  let decoded = false;
  globalThis.createImageBitmap = async () => { decoded = true; throw new Error('Unexpected decode'); };
  try {
    for (const [width, height] of [[100000, 100000], [10000, 10000], [0, 20]]) {
      await assert.rejects(prepareArtwork(new File([png(width, height)], 'bomb.png', { type:'image/png' })), /разрешению/);
    }
    assert.equal(decoded, false);
  } finally { globalThis.createImageBitmap = previous; }
});
test('header parser rejects truncated and unknown image containers', () => {
  assert.throws(() => artworkDimensions(new Uint8Array()), /размеры/);
  assert.deepEqual(artworkDimensions(png(320, 200)), { width:320, height:200 });
  const jpeg = Buffer.from('ffd8ffc000080800c8014000', 'hex');
  assert.deepEqual(artworkDimensions(jpeg), { width:320, height:200 });
  assert.throws(() => artworkDimensions(jpeg.subarray(0, 7)), /размеры/);
});
