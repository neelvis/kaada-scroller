import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { createSong, exportSet } from '../public/core.js';
import { exportPortableSet, importPortableSet, portableLimits } from '../public/portable.js';

const track = Uint8Array.from([0, 1, 255, 9, 0, 32, 7]);
function fixture() {
  const song = createSong({ id: 'one', title: 'Песня', language: 'ru', duration: 125.375, delayMs: -70, version: 'live',
    backing: { fileName: 'same.wav' }, source: { kind: 'original', fileName: 'private-vocals.mp3' },
    cues: [{ id: 'line', start: .125, text: '<b>Точный текст</b>', type: 'lyric' }, { id: 'rest', start: 20, text: 'Проигрыш', type: 'rest' }] });
  song.reviewed = true;
  return { schemaVersion: 1, id: 'set', name: 'Concert', songs: [song, { ...song, id: 'two', reviewed: false }, createSong({ id: 'none', title: 'No track' })] };
}
function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Independent ZIP fixtures also cover externally compressed files and invalid references.
function zip(records, { compressed = false, descriptor = false } = {}) {
  let offset = 0;
  const locals = [], central = [];
  for (const [name, content] of records) {
    const bytes = Buffer.from(content), filename = Buffer.from(name);
    const packed = compressed ? deflateRawSync(bytes) : bytes;
    const crc = checksum(bytes), flags = 0x800 | (descriptor ? 8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(compressed ? 8 : 0, 8);
    if (!descriptor) { local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); }
    local.writeUInt16LE(filename.length, 26);
    const ending = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
    if (descriptor) { ending.writeUInt32LE(0x08074b50, 0); ending.writeUInt32LE(crc, 4); ending.writeUInt32LE(packed.length, 8); ending.writeUInt32LE(bytes.length, 12); }
    locals.push(local, filename, packed, ending);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(flags, 8); directory.writeUInt16LE(compressed ? 8 : 0, 10);
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(bytes.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, filename);
    offset += local.length + filename.length + packed.length + ending.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(records.length, 8); end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(central.reduce((total, part) => total + part.length, 0), 12); end.writeUInt32LE(offset, 16);
  return new Blob([...locals, ...central, end]);
}
async function manifest(archive) {
  const bytes = Buffer.from(await archive.arrayBuffer());
  const start = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
  return JSON.parse(bytes.toString('utf8', start, start + bytes.readUInt32LE(18)));
}
function smallManifest(path = 'audio/track.wav') {
  const set = fixture(); set.songs = [set.songs[0]];
  set.songs[0].backingTrack = path;
  return set;
}
function archiveFor(set, files = [['audio/track.wav', track]], options) {
  return zip([['set.json', JSON.stringify(set)], ...files], options);
}

test('portable ZIP round trip keeps ordered songs, metadata and exact backing bytes with duplicate names', async () => {
  const set = fixture();
  set.serverProjectId = 'secret-project'; set.songs[0].audioId = 'secret-original'; set.songs[0].backingAudioId = 'secret-backing';
  set.songs[0].source.url = 'https://private.invalid/vocal';
  const second = Uint8Array.from([8, 6, 4, 2]);
  const archive = await exportPortableSet(set, async song => song.id === 'one' ? new Blob([track], { type: 'audio/wav' }) : song.id === 'two' ? new Blob([second]) : null);
  assert.equal(archive.type, 'application/zip');
  const json = await manifest(archive);
  assert.notEqual(json.songs[0].backingTrack, json.songs[1].backingTrack);
  assert.equal(json.songs[2].backingTrack, null);
  for (const value of ['secret-project', 'secret-original', 'secret-backing', 'https://private.invalid']) assert.ok(!JSON.stringify(json).includes(value));
  const imported = await importPortableSet(archive);
  assert.deepEqual(imported.set, JSON.parse(exportSet(set)));
  assert.deepEqual(new Uint8Array(await imported.backingAudio.get('one').arrayBuffer()), track);
  assert.deepEqual(new Uint8Array(await imported.backingAudio.get('two').arrayBuffer()), second);
  assert.equal(imported.backingAudio.has('none'), false);
});

test('legacy JSON imports remain accepted without backing bytes', async () => {
  const set = fixture();
  const imported = await importPortableSet(new Blob([exportSet(set)], { type: 'application/json' }));
  assert.deepEqual(imported.set, JSON.parse(exportSet(set))); assert.equal(imported.backingAudio.size, 0);
});

test('export rejects missing, unreadable or empty linked audio', async () => {
  await assert.rejects(exportPortableSet(fixture(), async () => null), /не удалось прочитать/);
  await assert.rejects(exportPortableSet(fixture(), async () => { throw new Error('Access lost'); }), /Access lost/);
  await assert.rejects(exportPortableSet(fixture(), async () => new Blob()), /пуст/);
});

test('empty sets export and import with a manifest only', async () => {
  const set = { schemaVersion: 1, id: 'empty', name: 'Empty', songs: [] };
  const archive = await exportPortableSet(set, async () => { assert.fail('No song loader'); });
  assert.deepEqual((await importPortableSet(archive)).set, { ...set, cover: '', endCaption: '', liveSongs: {} });
});

test('ZIP imports reject missing manifests, missing audio and absent path fields', async () => {
  await assert.rejects(importPortableSet(zip([['audio/track.wav', track]])), /set.json/);
  await assert.rejects(importPortableSet(archiveFor(smallManifest(), [])), /отсутствует минусовка/);
  const set = smallManifest(); delete set.songs[0].backingTrack;
  await assert.rejects(importPortableSet(archiveFor(set)), /небезопасный путь/);
  set.songs[0].backingTrack = null;
  await assert.rejects(importPortableSet(archiveFor(set, [])), /указана без файла/);
});

test('unsafe references and archive names fail before restoration', async () => {
  for (const path of ['../track.wav', '/track.wav', 'audio/../track.wav', 'C:/track.wav', 'audio\\track.wav', 'audio/%2e%2e/track.wav', 'audio//track.wav', 'audio/track.wav\u0000']) {
    await assert.rejects(importPortableSet(archiveFor(smallManifest(path))), /небезопасн/);
    await assert.rejects(importPortableSet(archiveFor(smallManifest(), [[path, track]])), /небезопасн/);
  }
});

test('duplicate and unreferenced entries cannot hide conflicting or original files', async () => {
  await assert.rejects(importPortableSet(archiveFor(smallManifest(), [['audio/track.wav', track], ['audio/track.wav', track]])), /повторяющееся/);
  await assert.rejects(importPortableSet(archiveFor(smallManifest(), [['audio/track.wav', track], ['original.mp3', track]])), /не указанные/);
});

test('corrupt audio, local headers, central headers and truncated archives fail', async () => {
  const good = Buffer.from(await archiveFor(smallManifest()).arrayBuffer());
  const manifestLength = good.readUInt32LE(18), manifestName = good.readUInt16LE(26);
  const audioOffset = 30 + manifestName + manifestLength;
  const payloadOffset = audioOffset + 30 + good.readUInt16LE(audioOffset + 26);
  const centralOffset = good.readUInt32LE(good.length - 6);
  for (const index of [payloadOffset, audioOffset, centralOffset]) {
    const bad = Buffer.from(good); bad[index] ^= 255;
    await assert.rejects(importPortableSet(new Blob([bad])), /целостность|поврежд/);
  }
  await assert.rejects(importPortableSet(new Blob([good.subarray(0, good.length - 8)])), /ZIP/);
});

test('stored and deflated ZIP entries accept verified data descriptors', async () => {
  for (const compressed of [false, true]) {
    const result = await importPortableSet(archiveFor(smallManifest(), undefined, { compressed, descriptor: true }));
    assert.deepEqual(new Uint8Array(await result.backingAudio.get('one').arrayBuffer()), track);
  }
});

test('ZIP rejects encrypted/unsupported compression and excessive declared sizes', async () => {
  const bytes = Buffer.from(await archiveFor(smallManifest()).arrayBuffer());
  const directory = bytes.readUInt32LE(bytes.length - 6);
  for (const [offset, value, width] of [[directory + 8, 1, 2], [directory + 10, 99, 2], [directory + 24, portableLimits.json + 1, 4]]) {
    const bad = Buffer.from(bytes); width === 2 ? bad.writeUInt16LE(value, offset) : bad.writeUInt32LE(value, offset);
    await assert.rejects(importPortableSet(new Blob([bad])), /неподдерживаем|превышает/);
  }
});

test('declared decompression size bounds stop oversized compressed output', async () => {
  const bytes = Buffer.from(await archiveFor(smallManifest(), undefined, { compressed: true }).arrayBuffer());
  const directory = bytes.readUInt32LE(bytes.length - 6);
  bytes.writeUInt32LE(1, directory + 24); bytes.writeUInt32LE(1, 22);
  await assert.rejects(importPortableSet(new Blob([bytes])), /превышает заявленный размер/);
});

test('export paths remain safe for unusual filenames and no-name remote links get metadata', async () => {
  const set = smallManifest(); set.songs[0].backing.fileName = '../../C:\\а.wav';
  const archive = await exportPortableSet(set, async () => new Blob([track]));
  assert.match((await manifest(archive)).songs[0].backingTrack, /^audio\/001-[a-zA-Z0-9._-]+$/);
  await importPortableSet(archive);
  delete set.songs[0].backing;
  const remote = await importPortableSet(await exportPortableSet(set, async () => new Blob([track], { type: 'audio/wav' })));
  assert.ok(remote.set.songs[0].backing.fileName.endsWith('.wav'));
});

test('track cap rejects oversized Blobs without reading them', async () => {
  class HugeBlob extends Blob { get size() { return portableLimits.track + 1; } arrayBuffer() { assert.fail('Oversize read'); } }
  await assert.rejects(exportPortableSet(fixture(), async () => new HugeBlob(['x'])), /15 МиБ/);
});

test('archives above one GiB reach structural validation without a project byte cap', async () => {
  const source = zip([['set.json', JSON.stringify(smallManifest())], ['audio/track.wav', track]]);
  const bytes = Buffer.from(await source.arrayBuffer());
  const end = bytes.length - 22, directory = bytes.readUInt32LE(end + 16), gap = 1024 ** 3;
  bytes.writeUInt32LE(directory + gap, end + 16);
  // Model a sparse gap before the directory without allocating a GiB fixture.
  class SparseArchive extends Blob {
    get size() { return bytes.length + gap; }
    slice(start = 0, end = this.size) {
      const result = Buffer.alloc(end - start);
      for (let i = 0; i < result.length; i++) {
        const offset = start + i;
        if (offset < directory) result[i] = bytes[offset];
        else if (offset >= directory + gap) result[i] = bytes[offset - gap];
      }
      return new Blob([result]);
    }
  }
  await assert.rejects(importPortableSet(new SparseArchive()), /лишние данные перед описанием файлов/);
});
