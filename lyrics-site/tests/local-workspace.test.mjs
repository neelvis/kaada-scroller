import assert from 'node:assert/strict';
import test from 'node:test';
import { createSong } from '../public/core.js';
import { createWorkspace } from '../public/workspace-files.js';
import { createDirectoryFixture, pauseNextSnapshot } from './workspace-memory-fixture.mjs';

let session = 0;
const freshSession = () => import(`../public/local-workspace.js?test-session=${++session}`);
const song = (id = 'song') => createSong({ id, title: `Song ${id}`, backing: { fileName: 'backing.wav' }, cues: [{ id: 'cue', start: 0, text: 'Words' }] });
const state = (title = 'Project') => ({ schemaVersion: 1, library: [song()], projects: [{ schemaVersion: 1, id: 'project', name: title, songs: [song('pinned-song')] }], links: { 'pin:pinned-song': 'song' } });

test('queued session saves never report saved while another snapshot is pending', async () => {
  const fs = createDirectoryFixture();
  const local = await freshSession();
  await local.connectWorkspace(fs.handle);
  const statuses = [];
  local.onWorkspaceStatus(status => statuses.push(status));
  const gate = pauseNextSnapshot(fs);
  const first = local.saveWorkspace(state('First'));
  await gate.paused;
  const second = local.saveWorkspace(state('Latest'));
  assert.deepEqual(statuses, ['Сохранение…', 'Сохранение…']);
  gate.release();
  await first;
  assert.equal(statuses.includes('Сохранено'), false);
  await second;
  assert.equal(statuses.at(-1), 'Сохранено');
  assert.equal(statuses.filter(status => status === 'Сохранено').length, 1);
  assert.equal((await createWorkspace(fs.handle).load()).projects[0].name, 'Latest');
});

test('failed session save retains staged backing and metadata for an explicit retry', async () => {
  const fs = createDirectoryFixture();
  const local = await freshSession();
  await local.connectWorkspace(fs.handle);
  await local.saveWorkspace(state('Previous'));
  const statuses = [];
  local.onWorkspaceStatus(status => statuses.push(status));
  const backing = new Blob(['pending backing'], { type: 'audio/wav' });
  await local.putBacking('song', backing);
  fs.control.fail = (path, phase) => phase === 'close' && path.endsWith('.json') ? new DOMException('Disk full', 'QuotaExceededError') : null;
  await assert.rejects(local.saveWorkspace(state('Unsaved edit')), { name: 'QuotaExceededError' });
  assert.ok(statuses.at(-1).startsWith('Не сохранено:'));
  assert.equal(statuses.includes('Сохранено'), false);
  assert.strictEqual(await local.getBacking('song'), backing);
  fs.control.fail = null;
  assert.equal((await createWorkspace(fs.handle).load()).projects[0].name, 'Previous');
  await local.retryWorkspaceSave();
  assert.equal(statuses.at(-1), 'Сохранено');
  const reopened = await freshSession();
  assert.equal((await reopened.connectWorkspace(fs.handle)).projects[0].name, 'Unsaved edit');
  assert.equal(await (await reopened.getBacking('song')).text(), 'pending backing');
});

test('permission reconnect with the same or equivalent handle retains the failed snapshot and audio for retry', async () => {
  for (const equivalentHandle of [false, true]) {
    const fs = createDirectoryFixture();
    const local = await freshSession();
    await local.connectWorkspace(fs.handle);
    await local.saveWorkspace(state('Previous'));
    const statuses = [];
    local.onWorkspaceStatus(status => statuses.push(status));
    const backing = new Blob(['unsaved after permission loss']);
    await local.putBacking('song', backing);
    fs.control.fail = (_path, phase) => phase === 'close' ? new DOMException('Permission revoked', 'NotAllowedError') : null;
    await assert.rejects(local.saveWorkspace(state('Retained edit')), { name: 'NotAllowedError' });
    fs.control.fail = null;
    const handle = equivalentHandle ? { ...fs.handle, isSameEntry: async other => other === fs.handle } : fs.handle;
    await local.connectWorkspace(handle);
    assert.ok(statuses.at(-1).startsWith('Не сохранено:'), 'reconnect must not report the failed snapshot as saved');
    assert.strictEqual(await local.getBacking('song'), backing);
    await local.retryWorkspaceSave();
    assert.equal(statuses.at(-1), 'Сохранено');
    const restored = await freshSession();
    assert.equal((await restored.connectWorkspace(fs.handle)).projects[0].name, 'Retained edit');
    assert.equal(await (await restored.getBacking('song')).text(), 'unsaved after permission loss');
  }
});

test('switching directories cannot discard staged or failed-save data and succeeds after retry', async () => {
  const fs = createDirectoryFixture(), other = createDirectoryFixture();
  const local = await freshSession();
  await local.connectWorkspace(fs.handle);
  await local.saveWorkspace(state('Previous'));
  const backing = new Blob(['pending bytes']);
  await local.putBacking('song', backing);
  await assert.rejects(local.connectWorkspace(other.handle), /несохранённые данные/);
  assert.equal(other.operations.length, 0, 'the other directory must remain untouched');
  assert.strictEqual(await local.getBacking('song'), backing);
  fs.control.fail = (_path, phase) => phase === 'close' ? new DOMException('Full', 'QuotaExceededError') : null;
  await assert.rejects(local.saveWorkspace(state('Retried project')), { name: 'QuotaExceededError' });
  await assert.rejects(local.connectWorkspace(other.handle), /несохранённые данные/);
  fs.control.fail = null;
  await local.retryWorkspaceSave();
  await local.connectWorkspace(other.handle);
  assert.deepEqual(local.localState(), { schemaVersion: 1, library: [], projects: [], links: {} });
  const prior = await freshSession();
  assert.equal((await prior.connectWorkspace(fs.handle)).projects[0].name, 'Retried project');
  assert.equal(await (await prior.getBacking('song')).text(), 'pending bytes');
});

test('fresh session reconnect restores core-valid library, pinned projects, links and both audio kinds', async () => {
  const fs = createDirectoryFixture();
  const local = await freshSession();
  await local.connectWorkspace(fs.handle);
  const original = state();
  await local.saveWorkspace(original, new Map([['backing:song', new Blob(['backing'])], ['original:song', new Blob(['recording'])]]));
  const nextSession = await freshSession();
  const restored = await nextSession.connectWorkspace(fs.handle);
  assert.deepEqual(restored, { ...original, projects: original.projects.map(project => ({ ...project, cover: '' })) });
  assert.equal(restored.projects[0].cover, '', 'legacy projects without artwork normalize to an empty cover');
  assert.equal(await (await nextSession.getBacking('song')).text(), 'backing');
  assert.equal(await (await nextSession.getAudio('song')).text(), 'recording');
  assert.equal(nextSession.connectedWorkspace().name, 'Music');
});

test('duplicated songs isolate backing and original IDs while retaining source media', async () => {
  const fs = createDirectoryFixture();
  const local = await freshSession();
  await local.connectWorkspace(fs.handle);
  const source = song();
  await local.putBacking(source.id, new Blob(['source backing']));
  await local.putAudio(source.id, new Blob(['source original']));
  assert.equal(fs.files.size, 0, 'staging is not reported as a durable save');
  const copy = await local.duplicateSong(source);
  assert.notEqual(copy.id, source.id);
  copy.cues[0].text = 'Changed copy';
  assert.equal(source.cues[0].text, 'Words');
  const next = { schemaVersion: 1, library: [source, copy], projects: [], links: {} };
  await local.saveWorkspace(next);
  await local.putBacking(source.id, new Blob(['replaced source backing']));
  await local.putAudio(source.id, new Blob(['replaced source original']));
  await local.saveWorkspace(next);
  const reopened = await freshSession();
  await reopened.connectWorkspace(fs.handle);
  assert.equal(await (await reopened.getBacking(copy.id)).text(), 'source backing');
  assert.equal(await (await reopened.getAudio(copy.id)).text(), 'source original');
  assert.equal(await (await reopened.getBacking(source.id)).text(), 'replaced source backing');
  assert.equal(await (await reopened.getAudio(source.id)).text(), 'replaced source original');
});

test('failed reconnect leaves the current workspace and its staged media available', async () => {
  const fs = createDirectoryFixture();
  const local = await freshSession();
  await local.connectWorkspace(fs.handle);
  await local.saveWorkspace(state('Current'));
  const staged = new Blob(['staged']);
  await local.putBacking('song', staged);
  const invalid = createDirectoryFixture();
  await createWorkspace(invalid.handle).save({ schemaVersion: 1, library: [{ id: 'broken' }], projects: [], links: {} });
  await assert.rejects(local.connectWorkspace(invalid.handle));
  assert.equal(local.localState().projects[0].name, 'Current');
  assert.strictEqual(await local.getBacking('song'), staged);
});


test('artwork survives a fresh directory session beyond portable JSON and text limits', async () => {
  const fs = createDirectoryFixture();
  const local = await freshSession();
  await local.connectWorkspace(fs.handle);
  const snapshot = state('Artwork');
  const cover = 'data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024);
  snapshot.library[0].cover = cover;
  snapshot.projects[0].cover = cover;
  snapshot.projects[0].songs[0].cover = cover;
  await local.saveWorkspace(snapshot);
  const reopened = await freshSession();
  const loaded = await reopened.connectWorkspace(fs.handle);
  assert.equal(loaded.library[0].cover, cover);
  assert.equal(loaded.projects[0].cover, cover);
  assert.equal(loaded.projects[0].songs[0].cover, cover);
  assert.deepEqual(loaded.links, snapshot.links);
});
