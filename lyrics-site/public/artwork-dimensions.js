/** Read container dimensions without allocating a decoded image. */
export function artworkDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const uint24 = offset => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
  if (bytes.length >= 24 && text(0, 8) === '\x89PNG\r\n\x1a\n' && text(12, 4) === 'IHDR') {
    return { width:view.getUint32(16), height:view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
        return { width:view.getUint16(offset + 5), height:view.getUint16(offset + 3) };
      }
      offset += length;
    }
  }
  if (bytes.length >= 12 && text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = text(offset, 4), length = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + length > bytes.length) break;
      if (kind === 'VP8X' && length >= 10) return { width:uint24(start + 4) + 1, height:uint24(start + 7) + 1 };
      if (kind === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
        const bits = view.getUint32(start + 1, true);
        return { width:(bits & 0x3fff) + 1, height:((bits >>> 14) & 0x3fff) + 1 };
      }
      if (kind === 'VP8 ' && length >= 10 && text(start + 3, 3) === '\x9d\x01\x2a') return { width:view.getUint16(start + 6, true) & 0x3fff, height:view.getUint16(start + 8, true) & 0x3fff };
      offset = start + length + (length % 2);
    }
  }
  throw new Error('Не удалось прочитать размеры JPG, PNG или WebP.');
}
