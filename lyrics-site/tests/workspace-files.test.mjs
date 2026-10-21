import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspace, supportsWorkspaceFiles } from '../public/workspace-files.js';

const state = name => ({ schemaVersion: 1, library: [{ id: 'song', title: name }], projects: [{ id: 'project', name, songs: [] }], links: {} });
const notFound = () => new DOMException('Missing file', 'NotFoundError');

function directory() {
  const files = new Map();
  const directories = new Set(['']);
  const operations = [];
  const control = { fail: null };
  function check(path, phase) {
    operations.push({ path, phase });
    const failure = control.fail?.(path, phase);
    if (failure) throw failure;
  }
  function handle(path = '') {
    return {
      kind: 'directory', name: path.split('/').at(-1) || 'Music',
      async getDirectoryHandle(name, { create = false } = {}) {
        const target = `${path}/${name}`;
        check(target, 'directory');
        if (!directories.has(target)) { if (!create) throw notFound(); directories.add(target); }
        return handle(target);
      },
      async getFileHandle(name, { create = false } = {}) {
        const target = `${path}/${name}`;
        check(target, 'file');
        if (!files.has(target)) { if (!create) throw notFound(); files.set(target, new Blob()); }
        return {
          kind: 'file', name,
          async getFile() { check(target, 'read'); return files.get(target); },
          async createWritable() {
            check(target, 'writable');
            let pending;
            return {
              async write(blob) { check(target, 'write'); pending = blob; },
              async close() { check(target, 'close'); files.set(target, pending); },
              async abort() {},
            };
          },
        };
      },
      async *entries() {
        check(path, 'entries');
        for (const file of files.keys()) {
          if (file.slice(0, file.lastIndexOf('/')) === path) yield [file.split('/').at(-1), { kind: 'file' }];
        }
      },
    };
  }
  return { handle: handle(), files, directories, operations, control };
}

function commits(fs) { return [...fs.files.keys()].filter(path => path.endsWith('.commit.json')).sort(); }

test('a new directory loads without creating or changing any files', async () => {
  const fs = directory();
  const workspace = createWorkspace(fs.handle);
  assert.equal(workspace.name, 'Music');
  assert.deepEqual(await workspace.load(), { schemaVersion: 1, library: [], projects: [], links: {} });
  assert.equal(fs.files.size, 0);
  assert.equal(fs.directories.size, 1);
});

test('fresh handles recover library, projects, links, and exact audio bytes from ordinary files', async () => {
  const fs = directory();
  const original = state('Local song');
  original.links = { song: { remoteId: 'remote', revision: 2 } };
  const bytes = new Uint8Array([0, 255, 1, 2, 127]);
  await createWorkspace(fs.handle).save(original, { audio: new Map([['song:backing', new Blob([bytes], { type: 'audio/wav' })]]) });
  const reopened = createWorkspace(fs.handle);
  assert.deepEqual(await reopened.load(), original);
  const audio = await reopened.readAudio('song:backing');
  assert.equal(audio.type, 'audio/wav');
  assert.deepEqual(new Uint8Array(await audio.arrayBuffer()), bytes);
  assert.equal(await reopened.readAudio('absent'), null);
  assert.ok([...fs.files.keys()].every(path => path.startsWith('/kaada-workspace/')));
});

test('rapid saves serialize and capture input before a later edit mutates it', async () => {
  const fs = directory();
  const workspace = createWorkspace(fs.handle);
  const first = state('first');
  const pending = workspace.save(first);
  first.library[0].title = 'changed after invocation';
  const latest = workspace.save(state('second'));
  assert.equal((await pending).library[0].title, 'first');
  await latest;
  assert.equal(commits(fs).length, 2);
  assert.deepEqual(await createWorkspace(fs.handle).load(), state('second'));
});

test('failed audio and metadata writes preserve previous complete state and permit a retry', async () => {
  for (const failingPart of ['audio-', '.json', '.commit.json']) {
    const fs = directory();
    const workspace = createWorkspace(fs.handle);
    await workspace.save(state('previous'), { audio: { song: new Blob(['previous audio']) } });
    fs.control.fail = (path, phase) => phase === 'close' && (failingPart === '.json' ? path.endsWith('.json') && !path.endsWith('.commit.json') : path.includes(failingPart)) ? new DOMException('No space', 'QuotaExceededError') : null;
    await assert.rejects(workspace.save(state('failed'), { audio: { song: new Blob(['new audio']) } }), { name: 'QuotaExceededError' });
    fs.control.fail = null;
    const reopened = createWorkspace(fs.handle);
    assert.deepEqual(await reopened.load(), state('previous'));
    assert.equal(await (await reopened.readAudio('song')).text(), 'previous audio');
    await workspace.save(state('retried'));
    assert.deepEqual(await createWorkspace(fs.handle).load(), state('retried'));
  }
});

test('corrupt latest snapshot and missing audio fall back to a complete prior generation', async () => {
  for (const corruption of ['snapshot', 'audio', 'commit']) {
    const fs = directory();
    const workspace = createWorkspace(fs.handle);
    await workspace.save(state('previous'), { audio: { song: new Blob(['first audio']) } });
    await workspace.save(state('latest'), { audio: { song: new Blob(['second audio']) } });
    const latest = commits(fs).at(-1);
    if (corruption === 'commit') fs.files.set(latest, new Blob(['{']));
    else if (corruption === 'snapshot') fs.files.set(latest.replace('.commit.json', '.json'), new Blob(['{}']));
    else fs.files.delete([...fs.files.keys()].filter(path => path.endsWith('.bin')).at(-1));
    const reopened = createWorkspace(fs.handle);
    assert.deepEqual(await reopened.load(), state('previous'));
    assert.equal(reopened.recovered, true);
    assert.equal(await (await reopened.readAudio('song')).text(), 'first audio');
  }
});

test('all-corrupt saved generations reject without replacing source files', async () => {
  const fs = directory();
  await createWorkspace(fs.handle).save(state('original'));
  fs.files.set(commits(fs)[0], new Blob(['bad data']));
  const before = new Map(fs.files);
  const reopened = createWorkspace(fs.handle);
  await assert.rejects(reopened.load(), /нет полностью читаемого/);
  await assert.rejects(reopened.save(state('replacement')), /нет полностью читаемого/);
  assert.deepEqual(fs.files, before);
});

test('a tampered manifest cannot traverse outside the audio directory', async () => {
  const fs = directory();
  const workspace = createWorkspace(fs.handle);
  await workspace.save(state('previous'));
  await workspace.save(state('tampered'), { audio: { song: new Blob(['track']) } });
  const markerPath = commits(fs).at(-1);
  const snapshotPath = markerPath.replace('.commit.json', '.json');
  const snapshot = JSON.parse(await fs.files.get(snapshotPath).text());
  snapshot.audio.song.file = '../../outside';
  const blob = new Blob([JSON.stringify(snapshot)]);
  fs.files.set(snapshotPath, blob);
  const marker = JSON.parse(await fs.files.get(markerPath).text());
  marker.sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  fs.files.set(markerPath, new Blob([JSON.stringify(marker)]));
  assert.deepEqual(await createWorkspace(fs.handle).load(), state('previous'));
  assert.equal(fs.operations.some(operation => operation.path.includes('outside')), false);
});

test('same-size audio corruption is detected on recovery and playback reads', async () => {
  const fs = directory();
  const workspace = createWorkspace(fs.handle);
  await workspace.save(state('original'), { audio: { song: new Blob(['sound']) } });
  const audioPath = [...fs.files.keys()].find(path => path.endsWith('.bin'));
  fs.files.set(audioPath, new Blob(['wrong']));
  await assert.rejects(workspace.readAudio('song'), /проверку/);
  await assert.rejects(createWorkspace(fs.handle).load(), /нет полностью читаемого/);
  const before = commits(fs).length;
  await assert.rejects(workspace.save(state('updated')), /проверку/);
  assert.equal(commits(fs).length, before);
});

test('permission loss is reported instead of treated as corruption or a new workspace', async () => {
  const fs = directory();
  await createWorkspace(fs.handle).save(state('original'));
  const before = new Map(fs.files);
  fs.control.fail = (_path, phase) => phase === 'read' ? new DOMException('Permission revoked', 'NotAllowedError') : null;
  await assert.rejects(createWorkspace(fs.handle).load(), { name: 'NotAllowedError' });
  assert.deepEqual(fs.files, before);
});

test('missing workspace subdirectories cannot silently create an empty replacement', async () => {
  const fs = directory();
  await createWorkspace(fs.handle).save(state('original'));
  fs.directories.delete('/kaada-workspace/audio');
  await assert.rejects(createWorkspace(fs.handle).load(), /отсутствует каталог/);
  assert.equal(fs.directories.has('/kaada-workspace/audio'), false);
});

test('invalid state and audio fail before any file writes', async () => {
  const fs = directory();
  const workspace = createWorkspace(fs.handle);
  for (const input of [null, { ...state('bad'), schemaVersion: 2 }, { ...state('bad'), links: [] }, { ...state('bad'), links: new Date() }, { ...state('bad'), library: [null] }, { ...state('bad'), extra: undefined }]) await assert.rejects(workspace.save(input), /повреждена/);
  await assert.rejects(workspace.save(state('bad'), { audio: { song: 'string' } }), /Blob/);
  await assert.rejects(workspace.writeAudio('', new Blob(['audio'])), /id/);
  await assert.rejects(workspace.writeAudio('song', new Blob()), /непустым/);
  assert.equal(fs.operations.length, 0);
});

test('audio identifiers remain data and cannot create paths or special object properties', async () => {
  const fs = directory();
  const workspace = createWorkspace(fs.handle);
  await workspace.save(state('safe'), { audio: new Map([['../../outside', new Blob(['track'])], ['__proto__', new Blob(['special'])]]) });
  assert.equal(await (await workspace.readAudio('../../outside')).text(), 'track');
  assert.equal(await (await createWorkspace(fs.handle).readAudio('__proto__')).text(), 'special');
  assert.ok([...fs.files.keys()].every(path => !path.includes('outside') && !path.includes('__proto__')));
});

test('writeAudio itself persists its bytes and preserves current metadata', async () => {
  const fs = directory();
  const workspace = createWorkspace(fs.handle);
  await workspace.save(state('retained'));
  await workspace.writeAudio('song', new Blob(['durable']));
  const reopened = createWorkspace(fs.handle);
  assert.deepEqual(await reopened.load(), state('retained'));
  assert.equal(await (await reopened.readAudio('song')).text(), 'durable');
});

test('feature detection requires the directory picker and secure context', () => {
  const originalPicker = globalThis.showDirectoryPicker;
  const originalSecure = globalThis.isSecureContext;
  try {
    delete globalThis.showDirectoryPicker;
    assert.equal(supportsWorkspaceFiles(), false);
    globalThis.showDirectoryPicker = () => {};
    globalThis.isSecureContext = true;
    assert.equal(supportsWorkspaceFiles(), true);
    globalThis.isSecureContext = false;
    assert.equal(supportsWorkspaceFiles(), false);
  } finally {
    if (originalPicker === undefined) delete globalThis.showDirectoryPicker; else globalThis.showDirectoryPicker = originalPicker;
    if (originalSecure === undefined) delete globalThis.isSecureContext; else globalThis.isSecureContext = originalSecure;
  }
});
