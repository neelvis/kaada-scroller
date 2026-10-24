import assert from 'node:assert/strict';
import test from 'node:test';
import { createDirectoryFixture, pauseNextSnapshot } from './workspace-memory-fixture.mjs';
import { createSong } from '../public/core.js';

function installDom() {
  const elements = new Map();
  globalThis.Element = class Element {};
  globalThis.Document = class Document {};
  globalThis.MutationObserver = class { observe() {} };
  globalThis.document = {
    readyState: 'complete', documentElement: {}, body: { append() {} },
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {
        textContent: '', value: '', hidden: false,
        setAttribute() {}, remove() {},
      });
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { return { setAttribute() {}, hasAttribute() { return false; }, append() {}, remove() {} }; },
  };
  return elements;
}

function installIndexedDb() {
  const records = new Map();
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {}, close() {},
          transaction(_name, mode) {
            const transaction = {
              objectStore() {
                return {
                  put(value, key) { records.set(key, value); queueMicrotask(() => transaction.oncomplete?.()); },
                  get(key) {
                    const get = {};
                    queueMicrotask(() => { get.result = records.get(key); get.onsuccess?.(); });
                    return get;
                  },
                };
              },
            };
            return transaction;
          },
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('workspace actions restore configured folders, reserve picker actions, and preserve edits during download', async () => {
  installDom(); installIndexedDb();
  const { createWorkspaceActions } = await import('../public/workspace-actions.js');
  const workspace = await import('../public/local-workspace.js');
  const pickerStarted = deferred(), pickerChoice = deferred();
  let pickerCalls = 0;
  globalThis.window = {
    async showDirectoryPicker() {
      pickerCalls++; pickerStarted.resolve();
      return pickerChoice.promise;
    },
  };
  globalThis.showDirectoryPicker = globalThis.window.showDirectoryPicker;
  const state = { sessionActive: true, transfers: new Map(), persistChain: Promise.resolve() };
  const context = {
    state,
    resources: { els: {}, hub: { render() {} } },
    actions: { cancelRecognition() {}, clearAudioPreview() {}, render() {}, openProject() {}, createLibrarySong() {}, confirmProjectExit: async () => true },
  };
  const actions = createWorkspaceActions(context);
  const originalFetch = globalThis.fetch;
  try {
    // A second click while the picker is open must not open another picker.
    const first = actions.downloadItem('project', 'cloud-project');
    await pickerStarted.promise;
    assert.equal(await actions.downloadItem('project', 'cloud-project'), false);
    assert.equal(pickerCalls, 1);
    const aborted = new Error('Cancelled'); aborted.name = 'AbortError';
    pickerChoice.reject(aborted);
    assert.equal(await first, false);
    assert.equal(workspace.connectedWorkspace(), null);

    // A remembered handle is queried and permission is requested on the save
    // action. Denial reports failure without opening a second picker.
    const fs = createDirectoryFixture();
    let requestPermissionResult = 'denied', queryCount = 0, requestCount = 0;
    fs.handle.queryPermission = async () => { queryCount++; return 'denied'; };
    fs.handle.requestPermission = async () => { requestCount++; return requestPermissionResult; };
    await workspace.rememberDirectory(fs.handle);
    workspace.rememberWorkspaceHandle(null);
    assert.equal(await actions.downloadItem('project', 'cloud-project'), false);
    assert.equal(queryCount, 1); assert.equal(requestCount, 1);
    assert.equal(pickerCalls, 1);

    // Granting access restores the same folder. While media is downloading,
    // persist an unrelated edit and verify the transfer merges into it.
    requestPermissionResult = 'granted';
    let mediaStarted, releaseMedia;
    const mediaGate = new Promise(resolve => { releaseMedia = resolve; });
    mediaStarted = deferred();
    globalThis.fetch = async url => {
      if (String(url).includes('/audio/')) {
        mediaStarted.resolve(); await mediaGate; return new Response(new Blob(['audio']));
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const cloud = {
      id: 'cloud-project', revision: 1, name: 'Cloud', songs: [
        { song: createSong({ id: 'cloud-song', title: 'Cloud song' }), songId: 'cloud-song', revisionId: 'rev-1', audioId: 'audio-1', backingAudioId: null },
      ],
    };
    const transfer = actions.downloadItem('project', 'cloud-project', { cloud });
    await mediaStarted.promise;
    assert.equal(state.transfers.get('cloud-project').hadLocalCopy, false);
    const concurrent = structuredClone(workspace.localState());
    concurrent.projects.push({ schemaVersion: 1, id: 'concurrent-project', name: 'Concurrent edit', songs: [] });
    await workspace.saveWorkspace(concurrent);
    releaseMedia();
    assert.equal(await transfer, true);
    assert.ok(workspace.localState().projects.some(project => project.id === 'concurrent-project'));
    assert.ok(workspace.localState().projects.some(project => workspace.localState().links[`project:${project.id}`]?.id === 'cloud-project'));
    assert.equal(queryCount, 2); assert.equal(requestCount, 2);
    assert.equal(pickerCalls, 1);

    // Replacing a copy keeps its durable check visible while the new snapshot
    // is still being written, and the action cannot report success early.
    const pause = pauseNextSnapshot(fs);
    let finished = false;
    const refresh = actions.downloadItem('project', 'cloud-project', { cloud: { ...cloud, songs: [{ ...cloud.songs[0], audioId: null }] } }).then(value => { finished = true; return value; });
    await pause.paused;
    assert.equal(state.transfers.get('cloud-project').hadLocalCopy, true);
    assert.equal(state.transfers.get('cloud-project').phase, 'saving');
    assert.equal(finished, false);
    pause.release();
    assert.equal(await refresh, true);
    assert.equal(finished, true);

    let deleteMediaStarted, releaseDeleteMedia;
    const deleteGate = new Promise(resolve => { releaseDeleteMedia = resolve; });
    deleteMediaStarted = deferred();
    globalThis.fetch = async url => {
      if (String(url).includes('/audio/')) {
        deleteMediaStarted.resolve(); await deleteGate; return new Response(new Blob(['audio']));
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const deletedDuringTransfer = actions.downloadItem('project', 'cloud-project', { cloud });
    await deleteMediaStarted.promise;
    const withoutCopy = structuredClone(workspace.localState());
    const removed = withoutCopy.projects.find(project => withoutCopy.links[`project:${project.id}`]?.id === 'cloud-project');
    withoutCopy.projects = withoutCopy.projects.filter(project => project !== removed);
    delete withoutCopy.links[`project:${removed.id}`];
    await workspace.saveWorkspace(withoutCopy);
    releaseDeleteMedia();
    assert.equal(await deletedDuringTransfer, false);
    assert.equal(workspace.localState().projects.some(project => workspace.localState().links[`project:${project.id}`]?.id === 'cloud-project'), false);

    // A folder switch during media download must stop before writing into the
    // newly selected folder.
    let switchMediaStarted, releaseSwitchMedia;
    const switchGate = new Promise(resolve => { releaseSwitchMedia = resolve; });
    switchMediaStarted = deferred();
    globalThis.fetch = async url => {
      if (String(url).includes('/audio/')) {
        switchMediaStarted.resolve(); await switchGate; return new Response(new Blob(['audio']));
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const switchedCloud = { ...cloud, id: 'different-cloud-project', songs: [{ ...cloud.songs[0], audioId: 'audio-2' }] };
    const switchedTransfer = actions.downloadItem('project', 'different-cloud-project', { cloud: switchedCloud });
    await switchMediaStarted.promise;
    const nextFs = createDirectoryFixture();
    await workspace.connectWorkspace(nextFs.handle);
    releaseSwitchMedia();
    assert.equal(await switchedTransfer, false);
    assert.equal(workspace.localState().projects.length, 0);
    assert.equal(workspace.localState().links['project:project-cloud-project'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('linked local projects open their snapshot while signed out and honor playback and exit guards', async () => {
  installDom(); installIndexedDb();
  const { createWorkspaceActions } = await import('../public/workspace-actions.js');
  const workspace = await import('../public/local-workspace.js');
  await workspace.connectWorkspace(createDirectoryFixture().handle);
  const snapshot = {
    schemaVersion: 1, id: 'local-copy', name: 'Offline copy',
    songs: [{ ...createSong({ id: 'offline-song', title: 'Offline song' }), extra: 'local snapshot' }],
  };
  await workspace.saveWorkspace({
    schemaVersion: 1, library: [], projects: [snapshot],
    links: { 'project:local-copy': { id: 'cloud-project', fingerprint: 'cloud-fingerprint' } },
  });

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0, cloudOpens = [], confirms = 0, cancels = 0, clears = 0, renders = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('Unexpected network request'); };
  const state = {
    sessionActive: false, persistChain: Promise.resolve(), localProjectId: null,
    project: null, projectEntries: new Map(), onlineSongOpen: true, remoteDirty: true,
    selectedId: null, set: null,
  };
  let allowExit = true;
  const context = {
    state,
    resources: { els: { prep: { hidden: true } }, hub: { render() {} } },
    actions: {
      cancelRecognition() { cancels++; }, clearAudioPreview() { clears++; },
      render() { renders++; }, openProject(id) { cloudOpens.push(id); },
      createLibrarySong() {}, async confirmProjectExit() { confirms++; return allowExit; },
    },
  };
  const actions = createWorkspaceActions(context);
  try {
    assert.equal(await actions.openLocalProject('local-copy'), true);
    assert.deepEqual(cloudOpens, []);
    assert.equal(fetchCalls, 0);
    assert.equal(state.localProjectId, 'local-copy');
    assert.equal(state.set.name, 'Offline copy');
    assert.equal(state.set.songs[0].extra, 'local snapshot');
    assert.equal(state.onlineSongOpen, false);
    assert.equal(state.remoteDirty, false);

    // Authenticated linked copies keep the existing cloud editing route.
    state.sessionActive = true;
    assert.equal(await actions.openLocalProject('local-copy'), undefined);
    assert.deepEqual(cloudOpens, ['cloud-project']);
    assert.equal(confirms, 1);

    // Playback-only mode always opens the local snapshot, even when signed in.
    assert.equal(await actions.openLocalProject('local-copy', { playbackOnly: true }), true);
    assert.deepEqual(cloudOpens, ['cloud-project']);
    assert.equal(state.localProjectId, 'local-copy');

    // A cancelled exit leaves the current project and associated state intact.
    state.sessionActive = false;
    state.localProjectId = 'keep-me';
    state.project = { id: 'currently-open' };
    state.projectEntries = new Map([['entry', { id: 'entry' }]]);
    state.set = { id: 'currently-open', name: 'Current', songs: [] };
    state.selectedId = 'selected'; state.onlineSongOpen = true; state.remoteDirty = true;
    allowExit = false;
    assert.equal(await actions.openLocalProject('local-copy'), false);
    assert.equal(state.localProjectId, 'keep-me');
    assert.deepEqual(state.project, { id: 'currently-open' });
    assert.deepEqual([...state.projectEntries], [['entry', { id: 'entry' }]]);
    assert.equal(state.set.name, 'Current'); assert.equal(state.selectedId, 'selected');
    assert.equal(state.onlineSongOpen, true); assert.equal(state.remoteDirty, true);
    assert.equal(cancels, 2); assert.equal(clears, 2); assert.equal(renders, 2);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
