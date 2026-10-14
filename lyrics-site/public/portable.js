import { exportSet, importSet } from './core.js';

export const portableLimits = Object.freeze({ track: 150 * 1024 * 1024, archive: 1024 * 1024 * 1024, json: 5 * 1024 * 1024, entries: 101 });
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes, crc = 0xffffffff) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}
function fail(message) { throw new Error(`Нельзя перенести набор: ${message}`); }
function safePath(path) {
  if (typeof path !== 'string' || !path || path.length > 1000 || /[\\:%\x00-\x1f\x7f]/.test(path)
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) fail('небезопасный путь файла в архиве.');
  return path;
}
function header(size) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
async function read(blob, start, size) {
  if (start < 0 || size < 0 || start + size > blob.size) fail('архив повреждён или обрезан.');
  const bytes = new Uint8Array(await blob.slice(start, start + size).arrayBuffer());
  if (bytes.length !== size) fail('не удалось прочитать файл полностью.');
  return bytes;
}
function checkBlob(blob) {
  if (!(blob instanceof Blob) || !blob.size) fail('аудиофайл отсутствует или пуст.');
  if (blob.size > portableLimits.track) fail('минусовка больше 150 МиБ.');
}
function trackPath(song, index, blob) {
  const fallback = blob.type.includes('wav') ? 'backing.wav' : 'backing.mp3';
  const label = (song.backing?.fileName || fallback).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/[. ]+$/g, '').slice(-150) || fallback;
  return safePath(`audio/${String(index + 1).padStart(3, '0')}-${label}`);
}

/** Export only core metadata and backing files; the loader resolves local/private/offline ownership. */
export async function exportPortableSet(set, loadBacking) {
  const clean = importSet(exportSet(set));
  const entries = [];
  let total = 22;
  for (const [index, song] of clean.songs.entries()) {
    const blob = await loadBacking(set.songs[index]);
    if (blob == null) {
      if (song.backing?.fileName) fail(`не удалось прочитать минусовку «${song.title}».`);
      song.backingTrack = null;
      continue;
    }
    checkBlob(blob);
    song.backingTrack = trackPath(song, index, blob);
    total += blob.size + 76 + encoder.encode(song.backingTrack).length * 2;
    if (total > portableLimits.archive) fail('архив больше 1 ГиБ.');
    entries.push({ name: song.backingTrack, blob });
  }
  const json = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
  if (json.size > portableLimits.json) fail('описание набора больше 5 МиБ.');
  entries.unshift({ name: 'set.json', blob: json });
  total += json.size + 76 + 16;
  if (total > portableLimits.archive) fail('архив больше 1 ГиБ.');
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, blob } of entries) {
    let checksum = 0xffffffff;
    // Read in chunks so a large recording never requires a second complete byte array.
    for (let start = 0; start < blob.size; start += 1024 * 1024) checksum = crc32(await read(blob, start, Math.min(1024 * 1024, blob.size - start)), checksum);
    checksum = (checksum ^ 0xffffffff) >>> 0;
    const filename = encoder.encode(name);
    const local = header(30);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true);
    local.view.setUint16(6, 0x800, true); local.view.setUint16(12, 33, true);
    local.view.setUint32(14, checksum, true); local.view.setUint32(18, blob.size, true); local.view.setUint32(22, blob.size, true);
    local.view.setUint16(26, filename.length, true);
    parts.push(local.bytes, filename, blob);
    const directory = header(46);
    directory.view.setUint32(0, 0x02014b50, true); directory.view.setUint16(4, 20, true); directory.view.setUint16(6, 20, true);
    directory.view.setUint16(8, 0x800, true); directory.view.setUint16(14, 33, true);
    directory.view.setUint32(16, checksum, true); directory.view.setUint32(20, blob.size, true); directory.view.setUint32(24, blob.size, true);
    directory.view.setUint16(28, filename.length, true); directory.view.setUint32(42, offset, true);
    central.push(directory.bytes, filename);
    offset += 30 + filename.length + blob.size;
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0);
  const end = header(22);
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, entries.length, true); end.view.setUint16(10, entries.length, true);
  end.view.setUint32(12, directorySize, true); end.view.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.bytes], { type: 'application/zip' });
}

async function directoryEntries(file) {
  const tail = await read(file, Math.max(0, file.size - 65557), Math.min(file.size, 65557));
  const view = new DataView(tail.buffer);
  let end = tail.length - 22;
  while (end >= 0 && !(view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === tail.length)) end -= 1;
  if (end < 0) fail('не найдено описание ZIP-архива.');
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count
    || count < 1 || count > portableLimits.entries || size > 1024 * 1024 || start + size !== file.size - tail.length + end) fail('неподдерживаемый или повреждённый ZIP-архив.');
  const bytes = await read(file, start, size);
  const central = new DataView(bytes.buffer);
  const entries = new Map();
  let cursor = 0;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > size || central.getUint32(cursor, true) !== 0x02014b50) fail('повреждено описание файлов ZIP.');
    const flags = central.getUint16(cursor + 8, true);
    const method = central.getUint16(cursor + 10, true);
    const packed = central.getUint32(cursor + 20, true);
    const unpacked = central.getUint32(cursor + 24, true);
    const nameLength = central.getUint16(cursor + 28, true);
    const recordLength = 46 + nameLength + central.getUint16(cursor + 30, true) + central.getUint16(cursor + 32, true);
    if (!nameLength || nameLength > 4096 || cursor + recordLength > size || flags & ~0x808 || ![0, 8].includes(method)
      || central.getUint16(cursor + 34, true)) fail('неподдерживаемый или повреждённый файл ZIP.');
    let name;
    try { name = safePath(decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength))); } catch { fail('небезопасное или некорректное имя файла ZIP.'); }
    if (entries.has(name)) fail('повторяющееся имя файла ZIP.');
    const limit = name === 'set.json' ? portableLimits.json : portableLimits.track;
    if (unpacked > limit || packed > portableLimits.archive || (method === 0 && packed !== unpacked)) fail('файл ZIP превышает допустимый размер или повреждён.');
    total += unpacked;
    if (total > portableLimits.archive) fail('содержимое архива больше 1 ГиБ.');
    entries.set(name, { name, flags, method, packed, unpacked, crc: central.getUint32(cursor + 16, true), offset: central.getUint32(cursor + 42, true), directoryStart: start });
    cursor += recordLength;
  }
  if (cursor !== size) fail('повреждено описание файлов ZIP.');
  return entries;
}

async function entryBlob(file, entry) {
  const bytes = await read(file, entry.offset, 30);
  const local = new DataView(bytes.buffer);
  if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== entry.flags || local.getUint16(8, true) !== entry.method) fail('повреждён заголовок файла ZIP.');
  const nameLength = local.getUint16(26, true);
  const extraLength = local.getUint16(28, true);
  const payloadStart = entry.offset + 30 + nameLength + extraLength;
  if (payloadStart + entry.packed > entry.directoryStart) fail('файл выходит за границы ZIP-архива.');
  let name;
  try { name = decoder.decode(await read(file, entry.offset + 30, nameLength)); } catch { fail('некорректное имя файла ZIP.'); }
  if (name !== entry.name || (!(entry.flags & 8) && (local.getUint32(14, true) !== entry.crc || local.getUint32(18, true) !== entry.packed || local.getUint32(22, true) !== entry.unpacked))) fail('заголовки файла ZIP не совпадают.');
  let recordEnd = payloadStart + entry.packed;
  if (entry.flags & 8) {
    const descriptor = new DataView((await read(file, recordEnd, Math.min(16, entry.directoryStart - recordEnd))).buffer);
    const base = descriptor.byteLength >= 4 && descriptor.getUint32(0, true) === 0x08074b50 ? 4 : 0;
    if (descriptor.byteLength < base + 12 || descriptor.getUint32(base, true) !== entry.crc || descriptor.getUint32(base + 4, true) !== entry.packed || descriptor.getUint32(base + 8, true) !== entry.unpacked) fail('повреждено окончание файла ZIP.');
    recordEnd += base + 12;
  }
  entry.recordEnd = recordEnd;
  const packed = file.slice(payloadStart, payloadStart + entry.packed);
  let stream = packed.stream();
  if (entry.method === 8) {
    let decompressor;
    try { decompressor = new DecompressionStream('deflate-raw'); } catch { fail('этот браузер не поддерживает сжатый ZIP. Используйте архив, созданный приложением.'); }
    stream = stream.pipeThrough(decompressor);
  }
  const reader = stream.getReader();
  const parts = [];
  let length = 0;
  let checksum = 0xffffffff;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > entry.unpacked) { await reader.cancel(); fail('распакованный файл превышает заявленный размер.'); }
      checksum = crc32(value, checksum); parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw new Error(`Нельзя перенести набор: повреждён файл «${entry.name}». ${error.message}`); }
  if (length !== entry.unpacked || ((checksum ^ 0xffffffff) >>> 0) !== entry.crc) fail(`нарушена целостность файла «${entry.name}».`);
  const type = entry.name.endsWith('.wav') ? 'audio/wav' : entry.name.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
  return new Blob(parts, { type });
}

/** Validate the complete archive before callers replace any persistent or visible state. */
export async function importPortableSet(file) {
  if (!(file instanceof Blob) || !file.size) fail('файл набора отсутствует или пуст.');
  if (file.size > portableLimits.archive) fail('архив больше 1 ГиБ.');
  const magic = await read(file, 0, Math.min(4, file.size));
  if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
    if (file.size > portableLimits.json) fail('JSON-файл больше 5 МиБ.');
    return { set: importSet(await file.text()), backingAudio: new Map() };
  }
  const entries = await directoryEntries(file);
  const manifest = entries.get('set.json');
  if (!manifest) fail('в архиве отсутствует set.json.');
  let json;
  try { json = decoder.decode(await (await entryBlob(file, manifest)).arrayBuffer()); } catch (error) { throw new Error(`Нельзя прочитать set.json: ${error.message}`); }
  const clean = importSet(json);
  const raw = JSON.parse(json);
  const backingAudio = new Map();
  const blobs = new Map();
  const referenced = new Set(['set.json']);
  for (const [index, song] of clean.songs.entries()) {
    const path = raw.songs[index].backingTrack;
    if (path === null) {
      if (song.backing?.fileName) fail('минусовка указана без файла в архиве.');
      continue;
    }
    safePath(path);
    if (path === 'set.json' || !entries.has(path)) fail(`в архиве отсутствует минусовка «${song.title}».`);
    referenced.add(path);
    let blob = blobs.get(path);
    if (!blob) { blob = await entryBlob(file, entries.get(path)); checkBlob(blob); blobs.set(path, blob); }
    backingAudio.set(song.id, blob);
    if (!song.backing?.fileName) song.backing = { fileName: path.split('/').at(-1) };
  }
  if (referenced.size !== entries.size) fail('архив содержит файлы, не указанные в наборе.');
  const ordered = [...entries.values()].sort((a, b) => a.offset - b.offset);
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index].offset !== (index ? ordered[index - 1].recordEnd : 0)) fail('записи ZIP пересекаются или содержат лишние данные.');
  }
  if (ordered.at(-1).recordEnd !== manifest.directoryStart) fail('ZIP содержит лишние данные перед описанием файлов.');
  return { set: clean, backingAudio };
}
