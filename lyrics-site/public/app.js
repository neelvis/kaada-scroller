import { createSong, cueAt, uniformScrollProgress, validateSong } from './core.js';
import { getAudio, getBacking, localState, connectedWorkspace, saveWorkspace, retryWorkspaceSave, onWorkspaceStatus } from './local-workspace.js';
import { $, node, button, iconTextButton, toast, plural, input } from './ui.js';
import { createWorkspaceHub } from './workspace-hub.js';
import { createSongEditor } from './song-editor.js';
import { createWorkspaceActions } from './workspace-actions.js';
import { uploadLocalProject, projectLink } from './cloud-transfers.js';
import { Playback } from './playback.js';
import { sameEntryContent, reconcileProjectSave } from './save-reconciliation.js';
import * as remote from './remote.js';
import { clearPrivateProjectCache, getPrivateAudio, openCachedProject, preparedProjects, removeDraft, removePreparedProject } from './offline-projects.js';
import { DEFAULT_LIBRARY_SORT, LIBRARY_SORTS, sortLibrarySongs } from './library-sort.js';

const els = { editor: $('#editor'), list: $('#song-list'), count: $('#song-count'), setName: $('#set-name'), prep: $('#preparation-view'), event: $('#event-view'), eventName: $('#event-song-name'), audience: $('#audience'), audienceLines: $('#audience-lines'), offline: $('#offline-state'), remote: $('#remote-state'), save: $('#save-project'), login: $('#login'), logout: $('#logout'), clearDownloaded: $('#clear-downloaded') };
let set = { schemaVersion: 1, id: crypto.randomUUID?.() || `set-${Date.now()}`, name: 'Мой набор', songs: [] };
let legacySet = set;
let localProjectId = null;
let cloudProjects = [];
let hubMessage = '';
let savedStatus = 'Выберите рабочую папку';
let transferBusy = false;
let offlineShellReady = false;
let selectedId = null;
let audioUrl = null;
let audioSongId = null;
let audioGeneration = 0;
const previewPlayer = document.createElement('audio');
previewPlayer.id = 'audio-player';
previewPlayer.controls = true;
previewPlayer.preload = 'metadata';
let recognition = new Map();
let persistChain = Promise.resolve();
let eventState = { song: null, startedAt: 0, running: false, frame: 0, lastIndex: null };
let fontSize = 54;
let highlightEnabled = true;
const eventControls = $('#event-controls');
const controlsVisibility = { timer: null, hovered: false, dragging: false };
let sessionActive = false;
let project = null;
let projectEntries = new Map();
let remoteDirty = false;
let remoteFailed = false;
let pendingLocalRefresh = null;
let saveBusy = false;
const copyAttempts = new Map();
let editGeneration = 0;
let offlineProjectOpen = false;
let onlineSongOpen = false;
let librarySongs = [];
let librarySelection = 0;
let onlineLibraryItems = [];
let onlineLibraryRequest = 0;
let eventOrigin = 'projects';
let eventMenuRequest = 0;
const sourceGeneration = new Map();
let workspaceGeneration = 0;
let backingPreviewId = null;
let backingPreviewUrl = null;
let backingPreviewGeneration = 0;
const backingPreview = document.createElement('audio');
backingPreview.id = 'backing-preview';
backingPreview.controls = true;
backingPreview.preload = 'metadata';
let privateMutationChain = Promise.resolve();
function privateMutation(operation) { const next = privateMutationChain.then(operation, operation); privateMutationChain = next.catch(() => {}); return next; }

const { showPreparation, syncLocalLibrary, restoreDirectory, openLocalProject, createLocalProject, submitLocalProject, createLocalSong, refreshHubCloud, readiness, downloadItem, removeLocalItem, removeMissingCloudProject, chooseDirectory } = createWorkspaceActions({
  state: {
    get set() { return set; }, set set(value) { set = value; },
    get legacySet() { return legacySet; }, set legacySet(value) { legacySet = value; },
    get localProjectId() { return localProjectId; }, set localProjectId(value) { localProjectId = value; },
    get cloudProjects() { return cloudProjects; }, set cloudProjects(value) { cloudProjects = value; },
    get hubMessage() { return hubMessage; }, set hubMessage(value) { hubMessage = value; },
    get savedStatus() { return savedStatus; },
    get transferBusy() { return transferBusy; }, set transferBusy(value) { transferBusy = value; },
    get selectedId() { return selectedId; }, set selectedId(value) { selectedId = value; },
    get persistChain() { return persistChain; },
    get sessionActive() { return sessionActive; },
    get project() { return project; }, set project(value) { project = value; },
    get projectEntries() { return projectEntries; },
    get remoteDirty() { return remoteDirty; }, set remoteDirty(value) { remoteDirty = value; },
    get offlineProjectOpen() { return offlineProjectOpen; }, set offlineProjectOpen(value) { offlineProjectOpen = value; },
    get onlineSongOpen() { return onlineSongOpen; }, set onlineSongOpen(value) { onlineSongOpen = value; },
    get offlineShellReady() { return offlineShellReady; },
    get librarySongs() { return librarySongs; }, set librarySongs(value) { librarySongs = value; }
  },
  resources: { els, get hub() { return hub; } },
  actions: { cancelRecognition, clearAudioPreview, render, openProject, createLibrarySong, backingKey },
});

const { renderEditor, cancelLrclib, resetPreparation, resetEditorTab, refreshConnectivity } = createSongEditor({
  state: {
    get audioSongId() { return audioSongId; },
    get legacySet() { return legacySet; },
    get localProjectId() { return localProjectId; },
    get offlineProjectOpen() { return offlineProjectOpen; },
    get onlineSongOpen() { return onlineSongOpen; },
    get persistChain() { return persistChain; }, set persistChain(value) { persistChain = value; },
    get project() { return project; },
    get projectEntries() { return projectEntries; },
    get selectedId() { return selectedId; }, set selectedId(value) { selectedId = value; },
    get sessionActive() { return sessionActive; },
    get set() { return set; }, set set(value) { set = value; },
    get workspaceGeneration() { return workspaceGeneration; }
  },
  resources: { els, previewPlayer, backingPreview, get backingPreviewId() { return backingPreviewId; }, recognition, sourceGeneration },
  actions: { currentSong, status, changeSong, render, showLibrary, addSong, clearAudioPreview, clearBackingPreview, setAudioPreview, setBackingPreview, entryFor, privateMutation, backingKey, markRemoteDirty, persist, syncLocalLibrary, saveLibrarySong, deleteLibrarySong, displayTime },
});

function currentSong() { return set.songs.find((song) => song.id === selectedId) || null; }
function status(song) {
  const errors = validateSong(song);
  if (onlineSongOpen && remoteDirty && song.reviewed && !errors.length) return 'Изменена';
  if (song.reviewed) return errors.length ? 'Есть ошибки' : 'Готова';
  if (song.cues.length) return 'Нужно проверить';
  return 'Не подготовлена';
}
function changeSong(songId, change) {
  if (offlineProjectOpen) { toast('Подготовленный снимок открыт только для показа. Для редактирования нужен сервер.'); return; }
  const index = set.songs.findIndex((song) => song.id === songId); if (index < 0) return;
  const next = change(set.songs[index]); if (!next) return;
  set = { ...set, songs: set.songs.map((song, i) => i === index ? next : song) };
  if (project || onlineSongOpen || localProjectId) markRemoteDirty();
}
function markRemoteDirty() { remoteDirty = true; remoteFailed = false; editGeneration += 1; updateRemoteState(); }
function updateRemoteState() {
  els.remote.hidden = els.prep.hidden;
  els.clearDownloaded.hidden = !offlineProjectOpen;
  $('#add-library-song').disabled = !sessionActive || offlineProjectOpen;
  const song = currentSong();
  const editingLibrarySong = onlineSongOpen && !els.prep.hidden && Boolean(song);
  const songReady = Boolean(song?.reviewed && !validateSong(song).length);
  els.save.hidden = els.prep.hidden || (!editingLibrarySong && !project && !localProjectId);
  els.save.disabled = editingLibrarySong
    ? saveBusy || !sessionActive || !songReady || !remoteDirty
    : saveBusy || !sessionActive || offlineProjectOpen || (!remoteDirty && pendingLocalRefresh !== project?.id);
  const saveLabel = editingLibrarySong
    ? !song?.reviewed ? 'сначала подтвердите таймлайн' : !songReady ? 'исправьте ошибки перед сохранением' : remoteDirty ? 'Сохранить в облаке' : 'изменения сохранены'
    : 'Сохранить проект';
  els.save.title = saveLabel; els.save.dataset.tooltip = saveLabel; els.save.setAttribute('aria-label', saveLabel);
  $('#delete-library-song').hidden = !editingLibrarySong;
  $('#toolbar-song-actions').hidden = $('#show-mode').hidden && $('#project-add-menu').hidden && $('#delete-library-song').hidden && els.save.hidden;
  if (editingLibrarySong) {
    const pill = els.editor.querySelector('.status-pill');
    if (pill) { pill.textContent = status(song); pill.classList.toggle('ready', songReady); }
  }
  els.remote.textContent = pendingLocalRefresh && pendingLocalRefresh === project?.id ? 'В облаке сохранено · локальную копию нужно обновить' : remoteFailed ? 'Сохранение не удалось · изменения ожидают повтора' : remoteDirty ? 'Есть несохранённые изменения' : onlineSongOpen ? 'В облаке' : project ? 'Сохранено в облаке' : localProjectId ? 'Локальная копия' : '';
}

function askLeaveProject() {
  const dialog = $('#leave-project-dialog');
  $('#leave-dialog-title').textContent = onlineSongOpen ? 'Песня не сохранена' : 'Проект не сохранён';
  $('#leave-dialog-copy').textContent = onlineSongOpen
    ? 'Сохраните песню в облаке перед выходом. Если продолжить без сохранения, изменения будут сброшены.'
    : 'Сохраните проект перед выходом. Если продолжить без сохранения, изменения будут сброшены.';
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
}
async function confirmProjectExit() {
  if (!remoteDirty || (!project && !localProjectId && !onlineSongOpen)) return true;
  const decision = await askLeaveProject();
  if (decision === 'stay' || !decision) return false;
  if (decision === 'save') return onlineSongOpen ? await saveLibrarySong() : await saveRemoteProject() && !remoteDirty;
  if (decision === 'discard') {
    if (onlineSongOpen) {
      const song = currentSong(), songId = song && entryFor(song).songId;
      if (songId) {
        try {
          const clean = await remote.getSong(songId);
          if (!onlineSongOpen || currentSong()?.id !== song.id) return false;
          set = { ...set, songs: [clean.song] }; selectedId = clean.song.id; projectEntries = new Map([[clean.song.id, clean]]);
        } catch (error) { toast(`Не удалось загрузить сохранённую песню: ${error.message}`); return false; }
      } else { set = { ...set, songs: [] }; selectedId = null; projectEntries.clear(); }
      render();
    } else if (project) {
      const clean = project;
      await privateMutation(() => removeDraft(clean.id)).catch(() => {});
      adoptProject(clean);
    } else if (localProjectId) {
      const clean = localState().projects.find(item => item.id === localProjectId);
      if (clean) { set = structuredClone(clean); selectedId = set.songs[0]?.id || null; render(); }
    }
    remoteDirty = false; remoteFailed = false; updateRemoteState();
    return true;
  }
  return false;
}

function persist() {
  if (!localProjectId) return Promise.resolve();
  const snapshot = structuredClone(set), state = structuredClone(localState());
  state.projects = state.projects.map(item => item.id === localProjectId ? snapshot : item);
  persistChain = persistChain.catch(() => {}).then(() => saveWorkspace(state)).catch(error => toast(error.message));
  return persistChain;
}

function clearAudioPreview() {
  clearBackingPreview();
  audioGeneration += 1;
  previewPlayer.pause(); previewPlayer.removeAttribute('src'); previewPlayer.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null; audioSongId = null;
}
function clearBackingPreview() {
  backingPreviewGeneration += 1;
  backingPreview.pause(); backingPreview.removeAttribute('src'); backingPreview.load();
  if (backingPreviewUrl) URL.revokeObjectURL(backingPreviewUrl);
  backingPreviewId = null; backingPreviewUrl = null;
}
function backingKey(id) { return `backing:${id}`; }
async function loadBacking(song, owner = project, entry = entryFor(song), offline = offlineProjectOpen) {
  if (!owner && !entry.backingAudioId) return getBacking(song.id);
  if (!entry.backingAudioId) return null;
  const cached = await getPrivateAudio(backingKey(entry.backingAudioId));
  if (cached || offline) return cached;
  return remote.downloadAudio(entry.backingAudioId);
}
function setBackingPreview(song) {
  const key = `${project?.id || 'local'}:${song.id}:${entryFor(song).backingAudioId || song.backing?.fileName || ''}`;
  if (backingPreviewId === key) return;
  clearBackingPreview(); backingPreviewId = key;
  if (!song.backing?.fileName) return;
  const generation = backingPreviewGeneration;
  loadBacking(song).then(blob => {
    if (!blob || generation !== backingPreviewGeneration || currentSong()?.id !== song.id) return;
    backingPreviewUrl = URL.createObjectURL(blob); backingPreview.src = backingPreviewUrl;
  }).catch(error => { if (generation === backingPreviewGeneration) toast(`Не удалось открыть минусовку: ${error.message}`); });
}
function cancelRecognition({ preserveDrafts = false } = {}) { resetPreparation({ preserveDrafts }); workspaceGeneration += 1; for (const job of recognition.values()) job.controller?.abort(); recognition.clear(); }
function entryFor(song) { return projectEntries.get(song.id) || {}; }
function projectPayload() {
  return {
    revision: project.revision, name: set.name || project.name,
    songs: set.songs.map(song => ({ ...entryFor(song), song: structuredClone(song) })),
  };
}
function adoptProject(next, { preserveSelection = false } = {}) {
  localProjectId = null; showPreparation();
  const previousSelection = preserveSelection && project?.id === next.id ? selectedId : null;
  const selectedIndex = previousSelection ? set.songs.findIndex(song => song.id === previousSelection) : -1;
  cancelLrclib();
  onlineSongOpen = false;
  project = next;
  const local = localState().projects.find(item => localState().links[`project:${item.id}`]?.id === next.id);
  const link = local && localState().links[`project:${local.id}`];
  if (link && (link.revision !== next.revision || link.entries?.length !== next.songs.length || next.songs.some((entry, index) => link.entries?.[index]?.revisionId !== entry.revisionId))) pendingLocalRefresh = next.id;
  projectEntries = new Map((next.songs || []).map(entry => [entry.song.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId, backingAudioId: entry.backingAudioId ?? null }]));
  set = { schemaVersion: 1, id: next.id, name: next.name, songs: (next.songs || []).map(entry => entry.song) };
  selectedId = set.songs.some(song => song.id === previousSelection) ? previousSelection : (set.songs[selectedIndex]?.id || null);
  remoteDirty = false; remoteFailed = false; updateRemoteState(); render();
}
function rebaseSavedProjectMetadata(saved, sent) {
  const result = reconcileProjectSave(set.songs, projectEntries, sent, saved, selectedId);
  project = saved; set = { ...set, songs: result.songs }; projectEntries = result.entries; selectedId = result.selectedId;
}

function changedProjectSongs() {
  return set.songs.filter(song => {
    const entry = entryFor(song), base = project?.songs.find(item => item.songId === entry.songId && item.revisionId === entry.revisionId);
    return !base || !sameEntryContent(base, { ...entry, song });
  });
}
async function saveRemoteProject() {
  if (saveBusy || !sessionActive || (!project && !localProjectId)) return false;
  if ((project ? changedProjectSongs() : set.songs).some(song => validateSong(song).length)) { toast('Подтвердите готовность изменённых песен перед сохранением.'); return false; }
  const generation = editGeneration, owner = project?.id, localId = localProjectId, workspace = workspaceGeneration;
  saveBusy = true; updateRemoteState();
  try {
    if (!project) {
      const snapshot = structuredClone(set), link = localState().links[`project:${localId}`];
      const pendingKey = `pending-project:${localId}`;
      let baseline = localState().links[pendingKey];
      if (!link && !baseline) {
        baseline = snapshot;
        const staged = structuredClone(localState()); staged.links[pendingKey] = snapshot;
        await saveWorkspace(staged);
      }
      const saved = await uploadLocalProject(snapshot, link, () => {}, baseline);
      if (!sessionActive || workspaceGeneration !== workspace) return;
      // Record the exact successful cloud result before a later local refresh can fail.
      const next = structuredClone(localState());
      next.projects = next.projects.map(item => item.id === localId ? snapshot : item);
      next.links[`project:${localId}`] = projectLink(snapshot, saved);
      delete next.links[pendingKey];
      pendingLocalRefresh = saved.id;
      await saveWorkspace(next);
      if (!sessionActive || workspaceGeneration !== workspace) return;
      if (generation !== editGeneration) {
        remoteDirty = true; toast('Предыдущая версия сохранена в облаке. Новые правки остались в редакторе.'); return false;
      }
      adoptProject(saved, { preserveSelection: true });
    } else if (remoteDirty) {
      const draft = projectPayload(), saved = await remote.saveProject(owner, draft);
      if (!sessionActive || project?.id !== owner || workspaceGeneration !== workspace) return;
      const local = localState().projects.find(item => localState().links[`project:${item.id}`]?.id === saved.id);
      if (local) pendingLocalRefresh = saved.id;
      if (generation !== editGeneration) {
        rebaseSavedProjectMetadata(saved, draft); remoteDirty = true;
        toast('Предыдущая версия сохранена в облаке. Новые правки ожидают сохранения.'); return false;
      }
      await privateMutation(() => removeDraft(owner)); adoptProject(saved, { preserveSelection: true });
    }
    if (pendingLocalRefresh && pendingLocalRefresh === project?.id) {
      if (!await downloadItem('project', pendingLocalRefresh, { quiet: true })) { updateRemoteState(); return; }
      pendingLocalRefresh = null;
    }
    toast('Проект сохранён в облаке' + (connectedWorkspace() ? '. Локальная копия обновлена, если она была сохранена.' : '.'));
    await refreshHubCloud();
    return true;
  } catch (error) {
    remoteFailed = true;
    if (error.status === 409) toast('Проект изменился в облаке. Ваши изменения остались в редакторе; при выходе вы сможете сбросить их.');
    else toast(error.message);
    return false;
  }
  finally { saveBusy = false; updateRemoteState(); }
}
async function saveLibrarySong() {
  const song = currentSong();
  if (saveBusy || !sessionActive || !song) return false;
  if (!song.reviewed) { toast('Сначала подтвердите таймлайн.'); return false; }
  if (validateSong(song).length) { toast('Исправьте ошибки перед сохранением.'); return false; }
  const snapshot = structuredClone(song), original = { ...entryFor(song) }, generation = editGeneration, workspace = workspaceGeneration;
  saveBusy = true; updateRemoteState();
  try {
    const payload = { song: snapshot, audioId: original.audioId ?? null, backingAudioId: original.backingAudioId ?? null };
    let saved = !original.songId
      ? await remote.createSong({ ...payload, migrationKey: snapshot.id })
      : await remote.saveSong(original.songId, { ...payload, revisionId: original.revisionId });
    if (!sessionActive || workspace !== workspaceGeneration) return false;
    if (!original.songId && !sameEntryContent(saved, payload)) {
      saved = await remote.saveSong(saved.songId, { ...payload, revisionId: saved.revisionId });
      if (!sessionActive || workspace !== workspaceGeneration) return false;
    }
    if (generation === editGeneration && onlineSongOpen) {
      projectEntries = new Map([[saved.song.id, saved]]); set = { ...set, songs: [saved.song] }; selectedId = saved.song.id; remoteDirty = false;
    } else if (onlineSongOpen && currentSong()?.id === snapshot.id) {
      const result = reconcileProjectSave(set.songs, projectEntries, { songs: [{ ...original, song: snapshot }] }, { songs: [saved] }, selectedId);
      set = { ...set, songs: result.songs }; projectEntries = result.entries; selectedId = result.selectedId;
    }
    toast('Песня сохранена в облаке.');
    await refreshHubCloud();
    await loadOnlineLibraryItems();
    // Existing-song saves do not change the editor's content. Keep its inputs
    // mounted so a refresh cannot interrupt the next edit between focus/input.
    if (saved.song.id !== snapshot.id || !sameEntryContent(saved, payload)) render();
    else updateRemoteState();
    return !remoteDirty;
  } catch (error) { toast(error.message); return false; }
  finally { saveBusy = false; updateRemoteState(); }
}
async function deleteLibrarySong(song = currentSong()) {
  const id = song && entryFor(song).songId;
  if (id) return removeCloudSong(id);
  if (!confirm('Удалить несохранённую песню?')) return;
  remoteDirty = false; set = { ...set, songs: [] }; selectedId = null; render();
}
async function removeCloudSong(id) {
  if (!sessionActive || !confirm('Удалить песню из облачной библиотеки и всех облачных проектов? Локальные копии останутся до обновления.')) return;
  try {
    await remote.deleteSong(id);
    if (onlineSongOpen && entryFor(currentSong() || {}).songId === id) { cancelRecognition(); clearAudioPreview(); remoteDirty = false; set = { ...set, songs: [] }; selectedId = null; projectEntries.clear(); }
    await refreshHubCloud(); render(); await loadOnlineLibraryItems(); toast('Песня удалена из библиотеки и облачных проектов.');
  } catch (error) { toast(error.message); }
}
async function removeCloudProject(id) {
  if (!sessionActive || !confirm('Удалить облачный проект? Песни останутся в библиотеке. Если проекта на сервере уже нет, его устаревшая локальная копия будет очищена.')) return;
  try {
    const current = await remote.getProject(id);
    await remote.deleteProject(id, current.revision);
    await refreshHubCloud();
  } catch (error) {
    if (error.status !== 404) { toast(error.message); return; }
    try {
      await privateMutation(() => Promise.all([removePreparedProject(id), removeDraft(id)]));
      const hadLocalCopy = await removeMissingCloudProject(id);
      cloudProjects = cloudProjects.filter(item => item.id !== id);
      await refreshHubCloud();
      toast(hadLocalCopy ? 'Проект удалён из браузера и рабочей папки.' : 'Устаревшая копия проекта удалена из браузера.');
    } catch (cleanupError) { toast(`Серверного проекта уже нет. Не удалось очистить рабочую папку: ${cleanupError.message}`); }
  }
}

async function openProject(id, { cached = false } = {}) {
  if (cached && localStorage.getItem('lyrics-v2-pending-logout')) return toast('Сначала завершите очистку данных выхода: откройте приложение заново.');
  if (!await confirmProjectExit()) return false;
  resetEditorTab();
  const fromDisplay = !els.event.hidden;
  if (fromDisplay) playback.stop();
  cancelRecognition(); const workspaceRun = workspaceGeneration; const sessionAtStart = sessionActive; clearAudioPreview();
  try {
    const next = cached ? await openCachedProject(id) : await remote.getProject(id);
    if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return false;
    if (!next) throw new Error('Подготовленный снимок не найден.');
    offlineProjectOpen = cached;
    adoptProject(next);
    if (!cached) {
      // Old versions may have persisted a draft; the cloud snapshot is authoritative.
      await privateMutation(() => removeDraft(id));
      if (pendingLocalRefresh === next.id && connectedWorkspace()) {
        if (await downloadItem('project', next.id, { cloud: next, quiet: true })) pendingLocalRefresh = null;
        updateRemoteState();
      }
    }
    toast(cached ? 'Открыт подготовленный автономный снимок.' : 'Проект открыт.');
  }
  catch (error) { toast(error.message); return false; }
  if (fromDisplay) {
    const ready = set.songs.find(song => !validateSong(song).length);
    if (ready) { selectedId = ready.id; render(); launchEvent(ready); }
    else {
      eventState.song = null; els.eventName.textContent = set.name;
      els.audienceLines.replaceChildren(node('div', { className: 'audience-line neutral', text: 'В проекте пока нет готовых песен' })); centerAudience(0);
      $('#event-start').disabled = true; $('#event-progress').disabled = true;
      $('#event-elapsed').textContent = '0:00'; $('#event-duration').textContent = '0:00'; $('#event-progress').value = '0';
      $('#event-audio-status').hidden = true; $('#event-lyrics-only').hidden = true; $('#event-mute').disabled = true;
    }
  }
  return true;
}
function refreshOfflineProjectEntry() { $('#offline-projects').hidden = true; $('#event-offline-projects').hidden = true; }
async function showLibrary() {
  if (onlineSongOpen || offlineProjectOpen) return;
  const dialog = $('#library-dialog'); dialog.showModal(); await searchLibrary();
}
let librarySearchRequest = 0;
let selectedLibrarySongs = new Map();
async function searchLibrary() {
  const request = ++librarySearchRequest, query = $('#library-search').value.trim().toLowerCase(), list = $('#library-list');
  list.replaceChildren(); if (!sessionActive) { list.append(node('p', { text: 'Войдите для доступа к библиотеке.' })); return; }
  try {
    const result = await remote.listLibrary(query);
    if (request !== librarySearchRequest || !sessionActive) return;
    for (const item of result.songs) {
      const check = input('', 'checkbox', { 'aria-label': item.title || 'Без названия' }); check.checked = selectedLibrarySongs.has(item.id);
      check.addEventListener('change', () => { if (check.checked) selectedLibrarySongs.set(item.id, item); else selectedLibrarySongs.delete(item.id); });
      list.append(node('label', { className: 'project-row' }, [check, node('span', { text: [item.title || 'Без названия', item.artist, item.version].filter(Boolean).join(' — ') })]));
    }
    if (!result.songs.length) list.append(node('p', { className: 'hint', text: 'Нет подходящих песен.' }));
  } catch (error) { if (request === librarySearchRequest && sessionActive) list.append(node('p', { text: error.message })); }
}
async function addSelectedLibrarySongs() {
  if (!project || !sessionActive) return;
  try {
    for (const item of selectedLibrarySongs.values()) {
      const entry = await remote.getSong(item.id);
      if (set.songs.some(song => entryFor(song).songId === entry.songId)) continue;
      set = { ...set, songs: [...set.songs, entry.song] }; projectEntries.set(entry.song.id, entry); selectedId = entry.song.id;
    }
    selectedLibrarySongs.clear(); markRemoteDirty(); $('#library-dialog').close(); render();
  } catch (error) { toast(error.message); }
}

function setAudioPreview(song) {
  if (audioSongId === song.id) return;
  clearAudioPreview(); audioSongId = song.id;
  const generation = audioGeneration;
  (async () => (project || onlineSongOpen) ? ((await getPrivateAudio(`${project?.id || 'library'}:${song.id}`)) || (entryFor(song).audioId ? remote.downloadAudio(entryFor(song).audioId) : null)) : getAudio(song.id))().then((blob) => {
    if (generation !== audioGeneration || currentSong()?.id !== song.id || !blob) return;
    audioUrl = URL.createObjectURL(blob); previewPlayer.src = audioUrl;
  }).catch((error) => toast(`Не удалось открыть запись: ${error.message}`));
}

async function openLibrarySong(id) {
  if (!sessionActive) return false;
  if (!await confirmProjectExit()) return false;
  const request = ++librarySelection, workspace = workspaceGeneration;
  try {
    const entry = await remote.getSong(id);
    if (!sessionActive || request !== librarySelection || workspace !== workspaceGeneration) return;
    cancelRecognition(); clearAudioPreview();
    localProjectId = null; showPreparation(); project = null; offlineProjectOpen = false; onlineSongOpen = true; remoteDirty = false;
    projectEntries = new Map([[entry.song.id, entry]]);
    set = { schemaVersion: 1, id: 'online-library', name: 'Онлайн-библиотека', songs: [entry.song] };
    selectedId = entry.song.id; render(); loadOnlineLibraryItems(); return true;
  } catch (error) { if (sessionActive && request === librarySelection) toast(error.message); return false; }
}
async function createLibraryCopy(item) {
  if (!sessionActive || saveBusy) return;
  saveBusy = true; updateRemoteState();
  try {
    const source = await remote.getSong(item.id);
    if (!source.song.reviewed || validateSong(source.song).length) throw new Error('Сначала подтвердите готовность песни.');
    const { songs } = await remote.listLibrary();
    const baseTitle = source.song.title.replace(/(?:\s+\(копия\s+\d+\))+\s*$/iu, '').trim() || source.song.title;
    const identity = (title, artist, version) => JSON.stringify([title, artist, version].map(value => (value || '').trim().toLocaleLowerCase('ru')));
    const occupied = new Set(songs.map(song => identity(song.title, song.artist, song.version)));
    let title = '';
    for (let number = 1; number <= songs.length + 1; number += 1) {
      const candidate = `${baseTitle} (копия ${number})`;
      if (!occupied.has(identity(candidate, source.song.artist, source.song.version))) { title = candidate; break; }
    }
    if (!title) throw new Error('Не удалось подобрать свободное название копии.');
    const copiedSong = { ...source.song, title }; delete copiedSong.id;
    const key = `${item.id}:${title}`;
    if (!copyAttempts.has(key)) copyAttempts.set(key, `song-copy-${crypto.randomUUID()}`);
    await remote.createSong({ song: copiedSong, audioId: source.audioId ?? null, backingAudioId: source.backingAudioId ?? null, migrationKey: copyAttempts.get(key) });
    copyAttempts.delete(key);
    await refreshHubCloud();
    toast(`Создана песня «${title}».`);
  } catch (error) { toast(error.message); }
  finally { saveBusy = false; updateRemoteState(); }
}
const onlineLibrarySort = $('#online-library-sort');
for (const option of LIBRARY_SORTS) onlineLibrarySort.append(node('option', { value: option.value, text: option.label }));
try {
  const savedSort = sessionStorage.getItem('kaada-library-sort');
  onlineLibrarySort.value = LIBRARY_SORTS.some(option => option.value === savedSort) ? savedSort : DEFAULT_LIBRARY_SORT;
} catch { onlineLibrarySort.value = DEFAULT_LIBRARY_SORT; }

function renderOnlineLibraryList() {
  const list = $('#online-song-list'), query = $('#online-library-search').value.trim().toLocaleLowerCase();
  const current = currentSong(), currentId = current && (entryFor(current).songId || current.id);
  const items = [...onlineLibraryItems];
  if (current && !items.some(item => item.id === currentId || item.id === current.id)) {
    items.push({ id: current.id, title: current.title, artist: current.artist, version: current.version, createdAt: '', currentDraft: true });
  }
  const filtered = sortLibrarySongs(items.filter(item => String(item.title || '').toLocaleLowerCase().includes(query)), onlineLibrarySort.value);
  list.replaceChildren();
  for (const item of filtered) {
    const active = item.id === currentId || item.id === selectedId;
    const label = [item.title || 'Без названия', item.artist, item.version].filter(Boolean).join(' — ');
    const select = button(label, `song-item library-song${active ? ' active' : ''}`, () => {
      if (item.currentDraft) { selectedId = current.id; render(); }
      else openLibrarySong(item.id);
    });
    select.setAttribute('aria-current', String(active));
    list.append(select);
  }
  if (!filtered.length) list.append(node('p', { className: 'hint', text: query ? 'Нет песен с таким названием.' : 'В онлайн-библиотеке пока нет песен.' }));
}

async function loadOnlineLibraryItems() {
  if (!sessionActive) return;
  const request = ++onlineLibraryRequest;
  try {
    const result = await remote.listLibrary();
    if (request !== onlineLibraryRequest || !onlineSongOpen || !sessionActive) return;
    onlineLibraryItems = result.songs || [];
    renderOnlineLibraryList();
  } catch (error) {
    if (request === onlineLibraryRequest && onlineSongOpen) {
      onlineLibraryItems = librarySongs;
      renderOnlineLibraryList();
      toast(`Не удалось обновить список онлайн-библиотеки: ${error.message}`);
    }
  }
}

function renderList() {
  els.list.replaceChildren(); $('#local-song-list').replaceChildren();
  $('#project-songs').hidden = !project && !localProjectId; $('#local-library').hidden = true; $('#online-library').hidden = true;
  els.count.textContent = `${set.songs.length} ${plural(set.songs.length, 'песня', 'песни', 'песен')}`;
  if (onlineSongOpen) {
    $('#online-library').hidden = false;
    renderOnlineLibraryList();
    return;
  }
  if (!project && !localProjectId) return;
  let draggedSongId = null;
  const moveSong = (songId, targetIndex) => {
    const sourceIndex = set.songs.findIndex(item => item.id === songId);
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= set.songs.length || sourceIndex === targetIndex) return;
    const songs = [...set.songs], [moved] = songs.splice(sourceIndex, 1);
    songs.splice(targetIndex, 0, moved); set = { ...set, songs }; markRemoteDirty(); render();
  };
  set.songs.forEach((song, index) => {
    const ready = !validateSong(song).length;
    const select = node('button', { type: 'button', className: 'song-select', onclick: () => { selectedId = song.id; resetEditorTab(); render(); } }, [
      node('span', { className: `song-dot${ready ? ' ready' : ''}`, 'aria-hidden': true }),
      node('span', { className: 'song-item-copy' }, [node('span', { className: 'song-item-title', text: song.title || 'Без названия' }), ...(song.artist ? [node('span', { className: 'song-item-status', text: song.artist })] : []), ...(song.version ? [node('span', { className: 'song-item-status', text: song.version })] : []), node('span', { className: 'song-item-status', text: status(song) })])
    ]);
    const move = direction => { const target = index + direction; if (target < 0 || target >= set.songs.length) return; const songs = [...set.songs]; [songs[index], songs[target]] = [songs[target], songs[index]]; set = { ...set, songs }; markRemoteDirty(); render(); };
    const up = iconTextButton('↑', 'Переместить песню выше', 'song-reorder', () => move(-1)); up.disabled = index === 0;
    const down = iconTextButton('↓', 'Переместить песню ниже', 'song-reorder', () => move(1)); down.disabled = index === set.songs.length - 1;
    select.draggable = true;
    select.addEventListener('dragstart', event => { draggedSongId = song.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', song.id); select.classList.add('song-dragging'); });
    select.addEventListener('dragend', () => { draggedSongId = null; select.classList.remove('song-dragging'); });
    const row = node('div', { className: `song-item${song.id === selectedId ? ' active' : ''}`, 'data-song-id': song.id }, [select, node('div', { className: 'song-reorder-wrap' }, [up, down])]);
    row.addEventListener('dragover', event => { if (draggedSongId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('song-drop-target'); } });
    row.addEventListener('dragleave', event => { if (!row.contains(event.relatedTarget)) row.classList.remove('song-drop-target'); });
    row.addEventListener('drop', event => { if (!draggedSongId) return; event.preventDefault(); row.classList.remove('song-drop-target'); moveSong(draggedSongId, index); });
    els.list.append(row);
  });
}

function updateSetNameMarquee() {
  const clip = $('#set-name-clip');
  const measure = $('#set-name-measure');
  const marquee = $('#set-name-marquee');
  if (!clip || !measure || !marquee) return;
  const value = els.setName.value || 'Мой набор';
  measure.textContent = value;
  measure.style.font = getComputedStyle(els.setName).font;
  marquee.querySelectorAll('.set-name-marquee-copy').forEach(copy => { copy.textContent = value; });
  const textWidth = measure.getBoundingClientRect().width;
  const overflowing = textWidth > els.setName.clientWidth + 1;
  clip.classList.toggle('is-overflowing', overflowing);
  if (overflowing) marquee.style.setProperty('--marquee-duration', `${Math.max(8, textWidth / 24)}s`);
}
function render() {
  $('#project-add-menu').hidden = !project && !localProjectId;
  $('#back-home').textContent = localProjectId || project ? '← Проекты' : '← Библиотека';
  els.prep.classList.toggle('online-song-open', onlineSongOpen);
  $('#local-save-status').textContent = localProjectId ? savedStatus : '';
  $('#upload-current').hidden = true; $('#show-mode').hidden = !project && !localProjectId;
  renderList(); els.setName.value = set.name || 'Библиотека песен';
  els.setName.disabled = offlineProjectOpen || onlineSongOpen || (!project && !localProjectId);
  updateSetNameMarquee(); $('#add-song').disabled = offlineProjectOpen || !sessionActive;
  $('#show-mode').disabled = !set.songs.length; renderEditor(); updateRemoteState();
  if (offlineProjectOpen) { [...els.editor.querySelectorAll('input,textarea,select,button')].forEach(control => { control.disabled = true; }); }
}
async function createLibrarySong() {
  if (!sessionActive) return toast('Войдите, чтобы создать песню в облачной библиотеке.');
  if (!await confirmProjectExit()) return;
  cancelRecognition(); clearAudioPreview(); resetEditorTab(); localProjectId = null; project = null; onlineSongOpen = true; offlineProjectOpen = false; projectEntries.clear();
  const song = createSong({ language: 'ru' }); set = { schemaVersion: 1, id: 'online-library', name: 'Библиотека песен', songs: [song] }; selectedId = song.id;
  markRemoteDirty(); showPreparation(); render(); loadOnlineLibraryItems();
}
function addSong() {
  if (!project) return createLibrarySong();
  resetEditorTab(); const song = createSong({ language: 'ru' }); set = { ...set, songs: [...set.songs, song] }; selectedId = song.id; markRemoteDirty(); render();
}

$('#show-mode').addEventListener('click', () => {
  const song = currentSong() || set.songs.find(song => !validateSong(song).length) || set.songs[0];
  if (song) launchEvent(song);
});

function launchEvent(song) {
  eventOrigin = onlineSongOpen && !project ? 'library' : 'projects';
  let localPlayback = false;
  if (project) {
    const local = localState().projects.find(item => localState().links[`project:${item.id}`]?.id === project.id);
    if (local) {
      const link = localState().links[`project:${local.id}`], songId = entryFor(song).songId;
      const mapping = link.entries.find(item => item.songId === songId);
      const snapshot = mapping && local.songs.find(item => item.id === mapping.localId);
      if (!snapshot) { toast('Песни нет в локальной копии. Сохраните проект локально перед запуском.'); return; }
      song = snapshot; localPlayback = true;
    }
  }
  if (validateSong(song).length) { toast('Для показа песня должна быть подготовлена и подтверждена.'); return; }
  playback.dispose(); previewPlayer.pause(); backingPreview.pause(); document.querySelectorAll('.toast').forEach(item => item.remove());
  $('#home-view').hidden = true; $('.topbar').hidden = true; els.prep.hidden = true; els.event.hidden = false; els.eventName.textContent = song.title;
  eventState = { song: structuredClone(song), frame: 0, lastIndex: null, ended: false, manualScrollIndex: 0 };
  $('#event-progress').disabled = false;
  const owner = localPlayback ? null : project, entry = localPlayback ? {} : { ...entryFor(song) }, offline = offlineProjectOpen;
  let loaded = null;
  const loader = () => loaded ||= loadBacking(song, owner, entry, offline).catch(error => { loaded = null; throw error; });
  buildAudience(); playback.arm(song.duration, song.backing?.fileName || entry.backingAudioId ? loader : null);
  $('#event-audio-status').hidden = true; $('#event-lyrics-only').hidden = true;
  applyHighlight(); updateEvent();
  restoreEventControls();
}
function buildAudience() {
  if (!eventState.song.cues.length) { els.audienceLines.replaceChildren(node('div', { className: 'audience-line neutral', text: eventState.song.title })); centerAudience(0); return; }
  const untimed = eventState.song.ignoreTimecodes === true;
  els.audienceLines.classList.toggle('timed-rests', !untimed);
  els.audienceLines.classList.toggle('uniform-scroll', untimed && eventState.song.autoScrollEnabled !== false);
  els.audienceLines.classList.toggle('manual-scroll', untimed && eventState.song.autoScrollEnabled === false);
  els.audienceLines.replaceChildren(...eventState.song.cues.map(cue => {
    if (cue.type !== 'rest') return node('div', { className: 'audience-line', text: cue.text });
    return node('div', { className: 'audience-line rest', role: 'group', 'aria-label': cue.text || 'Проигрыш' }, [
      node('span', { className: 'interlude-label', text: `— ${cue.text || 'Проигрыш'} —` }),
      node('span', { className: 'interlude-notes', 'aria-hidden': 'true' },
        [node('span', { text: '♪' }), ' ', node('span', { text: '♪' }), ' ', node('span', { text: '♪' })]),
    ]);
  }));
}
function centerAudience(index) {
  if (eventState.song?.ignoreTimecodes && !eventState.ended) {
    if (eventState.song.autoScrollEnabled === false) positionManualAudience(eventState.manualScrollIndex);
    else positionUniformAudience();
    return;
  }
  const line = els.audienceLines.children[Math.max(0, index)];
  if (line) els.audienceLines.style.transform = `translateY(-${line.offsetTop + line.offsetHeight / 2}px)`;
}
function changeAudienceFont(delta) {
  fontSize = Math.max(28, Math.min(100, fontSize + delta));
  els.audience.style.setProperty('--audience-size', `${fontSize}px`);
  centerAudience(eventState.lastIndex ?? -1);
}
function positionUniformAudience() {
  const lines = els.audienceLines.children;
  const first = lines[0], last = lines[lines.length - 1];
  if (!first || !last) return;
  const start = first.offsetTop + first.offsetHeight / 2;
  const end = last.offsetTop + last.offsetHeight / 2;
  const progress = uniformScrollProgress(eventState.song, playback.elapsed());
  els.audienceLines.style.transform = `translateY(-${start + (end - start) * progress}px)`;
}
function positionManualAudience(index) {
  const lines = els.audienceLines.children;
  if (!lines.length) return;
  eventState.manualScrollIndex = Math.max(0, Math.min(lines.length - 1, index));
  const line = lines[eventState.manualScrollIndex];
  els.audienceLines.style.transform = `translateY(-${line.offsetTop + line.offsetHeight / 2}px)`;
}
function scrollManualAudience(lines) {
  if (!eventState.song?.ignoreTimecodes || eventState.song.autoScrollEnabled !== false || eventState.ended) return false;
  positionManualAudience(eventState.manualScrollIndex + lines);
  return true;
}
function renderAudience(index, ended) {
  if (ended) {
    els.audienceLines.replaceChildren(node('div', { className: 'audience-line neutral', text: 'Песня закончилась' }));
    centerAudience(0); return;
  }
  if (els.audienceLines.children.length !== eventState.song.cues.length || els.audienceLines.querySelector('.neutral')) buildAudience();
  [...els.audienceLines.children].forEach((line, i) => {
    line.classList.toggle('active', i === index);
    line.classList.toggle('past', index >= 0 && i < index);
  });
  centerAudience(index);
}

const playback = new Playback({
  createAudio: () => { const audio = new Audio(); audio.id = 'event-player'; els.event.append(audio); return audio; },
  changed: () => {
    updateEvent(); cancelAnimationFrame(eventState.frame);
    if (playback.running) eventState.frame = requestAnimationFrame(tick);
  },
  failed: error => { $('#event-audio-status').textContent = error.message; $('#event-audio-status').hidden = false; $('#event-lyrics-only').hidden = false; restoreEventControls(); },
});
function setControlIcon(id, icon, label, shortcut = '') {
  const control = $(`#${id}`);
  const tooltip = `${label}${shortcut ? ` · ${shortcut}` : ''}`;
  if (control.getAttribute('aria-label') !== label) control.setAttribute('aria-label', label);
  if (control.dataset.tooltip !== tooltip) control.dataset.tooltip = tooltip;
  const use = control.querySelector('use');
  if (use.getAttribute('href') !== `#icon-${icon}`) use.setAttribute('href', `#icon-${icon}`);
}
function displayFullscreen() { return document.fullscreenElement === els.event; }
function cancelControlsDimming() { clearTimeout(controlsVisibility.timer); controlsVisibility.timer = null; }
function scheduleControlsDimming() {
  cancelControlsDimming();
  if (!displayFullscreen() || els.event.hidden || controlsVisibility.hovered || controlsVisibility.dragging ||
      eventControls.contains(document.activeElement) || !$('#event-audio-status').hidden) return;
  controlsVisibility.timer = setTimeout(() => {
    controlsVisibility.timer = null;
    if (displayFullscreen() && !els.event.hidden && !controlsVisibility.hovered && !controlsVisibility.dragging &&
        !eventControls.contains(document.activeElement) && $('#event-audio-status').hidden) {
      els.event.classList.add('controls-dimmed');
    }
  }, 2000);
}
function restoreEventControls() {
  els.event.classList.remove('controls-dimmed');
  scheduleControlsDimming();
}
function syncFullscreenControls() {
  const fullscreen = displayFullscreen();
  els.event.classList.toggle('is-fullscreen', fullscreen);
  setControlIcon('fullscreen', fullscreen ? 'fullscreen-exit' : 'fullscreen', fullscreen ? 'Выйти из полного экрана' : 'На весь экран', 'F');
  controlsVisibility.dragging = false;
  restoreEventControls(); positionEventMenu();
}
function toggleFullscreen() {
  const operation = displayFullscreen() ? document.exitFullscreen() : els.event.requestFullscreen?.();
  operation?.catch(() => toast('Не удалось переключить полноэкранный режим.'));
}
function displayTime(seconds) { return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
function updateEvent() {
  const song = eventState.song; if (!song) return;
  els.audienceLines.classList.toggle('playback-running', playback.running);
  const elapsed = playback.elapsed(); const current = cueAt(song, elapsed);
  if (current.index !== eventState.lastIndex || current.ended !== eventState.ended) {
    eventState.lastIndex = current.index; eventState.ended = current.ended; renderAudience(current.index, current.ended);
  }
  if (song.ignoreTimecodes && song.autoScrollEnabled !== false && !current.ended) positionUniformAudience();
  $('#event-progress').max = String(song.duration); $('#event-progress').value = String(elapsed);
  $('#event-progress').setAttribute('aria-valuetext', `${displayTime(elapsed)} из ${displayTime(song.duration)}`);
  $('#event-elapsed').textContent = displayTime(elapsed); $('#event-duration').textContent = displayTime(song.duration);
  $('#event-start').disabled = playback.starting || elapsed >= song.duration;
  setControlIcon('event-start', playback.starting ? 'loading' : playback.running ? 'pause' : 'play', playback.starting ? 'Запуск…' : playback.running ? 'Пауза' : 'Старт');
  $('#event-mute').disabled = !playback.loadAudio;
  if (playback.loadAudio) {
    setControlIcon('event-mute', playback.muted ? 'muted' : 'volume', playback.muted ? 'Включить звук' : 'Выключить звук');
  } else {
    setControlIcon('event-mute', 'muted', 'для этой песни нет минусовки');
  }
  $('#event-mute').setAttribute('aria-pressed', String(Boolean(playback.loadAudio && playback.muted)));
}
function tick() {
  updateEvent();
  if (playback.elapsed() >= playback.duration) { playback.stop(); return; }
  if (playback.running) eventState.frame = requestAnimationFrame(tick);
}
function startEvent() {
  if (!eventState.song || playback.starting) return;
  if (playback.running) { playback.stop(); return; }
  $('#event-audio-status').hidden = true; $('#event-lyrics-only').hidden = true;
  scheduleControlsDimming();
  return playback.start();
}
function resetEvent() {
  playback.reset(); eventState.lastIndex = null; eventState.ended = false;
  $('#event-audio-status').hidden = true; $('#event-lyrics-only').hidden = true;
  if (eventState.song) { renderAudience(-1, false); updateEvent(); }
  scheduleControlsDimming();
}
function exitEvent() {
  playback.dispose(); $('#event-menu').close();
  els.event.hidden = true; els.prep.hidden = false; $('.topbar').hidden = false;
  cancelControlsDimming(); controlsVisibility.hovered = false; controlsVisibility.dragging = false;
  els.event.classList.remove('controls-dimmed');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function positionEventMenu() {
  const menu = $('#event-menu'); if (!menu.open) return;
  const bounds = $('#event-menu-toggle').getBoundingClientRect();
  const top = Math.min(bounds.bottom + 8, Math.max(12, window.innerHeight - 80));
  menu.style.maxHeight = `${Math.max(40, Math.min(620, window.innerHeight - top - 12))}px`;
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(12, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 12))}px`;
}
async function launchLibrarySongInDisplay(id) {
  try {
    const entry = await remote.getSong(id);
    if (els.event.hidden || eventOrigin !== 'library') return;
    cancelRecognition(); clearAudioPreview();
    localProjectId = null; project = null; offlineProjectOpen = false; onlineSongOpen = true;
    projectEntries = new Map([[entry.song.id, entry]]);
    set = { schemaVersion: 1, id: 'online-library', name: 'Онлайн-библиотека', songs: [entry.song] };
    selectedId = entry.song.id; render(); launchEvent(entry.song);
  } catch (error) { toast(`Не удалось открыть песню: ${error.message}`); }
}
function showEventMenu() {
  if ($('#event-menu').open) { $('#event-menu').close(); return; }
  const list = $('#event-menu-songs'), request = ++eventMenuRequest;
  list.replaceChildren(); $('#event-project-name').textContent = eventOrigin === 'library' ? 'Онлайн-библиотека' : set.name;
  $('#event-menu-title').previousElementSibling.textContent = eventOrigin === 'library' ? 'Библиотека' : 'Проект';
  const addSongs = songs => {
    if (!$('#event-menu').open || request !== eventMenuRequest) return;
    list.replaceChildren();
    for (const song of songs) {
      const ready = song.song
        ? song.reviewed === true && song.valid === true
        : typeof song.valid === 'boolean' ? song.reviewed === true && song.valid === true : !validateSong(song).length;
      const item = button(`${song.title || song.song?.title || 'Без названия'}${ready ? '' : ' · нужна подготовка'}`, 'button quiet', () => {
        $('#event-menu').close();
        if (eventOrigin === 'library') launchLibrarySongInDisplay(song.id);
        else { selectedId = song.id; render(); launchEvent(song); }
      });
      item.disabled = !ready;
      if (eventState.song?.id === song.id || entryFor(eventState.song || {}).songId === song.id) item.setAttribute('aria-current', 'true');
      list.append(item);
    }
    if (!songs.length) list.append(node('p', { className: 'hint', text: 'В библиотеке пока нет песен.' }));
  };
  if (eventOrigin === 'library') {
    list.append(node('p', { className: 'hint', text: 'Загружаем песни…' }));
    remote.listLibrary().then(result => addSongs(result.songs || [])).catch(error => {
      if (request === eventMenuRequest) list.replaceChildren(node('p', { className: 'hint', text: error.message }));
    });
  } else {
    const projectSongs = set.songs;
    $('#event-menu-toggle').setAttribute('aria-expanded', 'true'); $('#event-menu').show(); positionEventMenu();
    addSongs(projectSongs);
    $('#event-menu-close').focus();
    return;
  }
  $('#event-menu-toggle').setAttribute('aria-expanded', 'true'); $('#event-menu').show(); positionEventMenu();
  $('#event-menu-close').focus();
}
function showProjects() { hub.show('projects'); }
async function showOfflineProjects() { showProjects(); }
function initOffline() {
  if (!('serviceWorker' in navigator)) { els.offline.textContent = 'Автономная оболочка недоступна'; return; }
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { els.offline.textContent = 'Не удалось подготовить автономную оболочку'; });
  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data?.type !== 'OFFLINE_READY') return;
    offlineShellReady = Boolean(data.ready);
    els.offline.textContent = offlineShellReady ? '' : 'Оболочка приложения готовится';
    hub.render();
  });
  navigator.serviceWorker.ready.then(registration => registration.active?.postMessage({ type: 'CHECK_OFFLINE' })).catch(() => {});
}
function updateSessionUi() {
  els.login.hidden = sessionActive; els.logout.hidden = !sessionActive;
  els.login.setAttribute('aria-label', 'Войти'); els.login.setAttribute('data-tooltip', 'Войти');
  els.logout.setAttribute('aria-label', 'Выйти'); els.logout.setAttribute('data-tooltip', 'Выйти');
  $('#projects').disabled = false; $('#projects').hidden = false;
  updateRemoteState(); refreshOfflineProjectEntry(); if (typeof hub !== 'undefined') hub.render();
}
async function signIn() {
  const password = $('#login-password').value; const error = $('#login-error'); error.hidden = true;
  try { if (localStorage.getItem('lyrics-v2-pending-logout')) { await privateMutation(() => clearPrivateProjectCache()); try { await remote.session(); await remote.logout(); } catch (problem) { if (problem.status !== 401) throw problem; } localStorage.removeItem('lyrics-v2-pending-logout'); } await remote.login(password); sessionActive = true; $('#login-dialog').close(); $('#login-password').value = ''; cancelLrclib(); updateSessionUi(); render(); refreshHubCloud(); toast('Вход выполнен.'); }
  catch (problem) { error.textContent = problem.message; error.hidden = false; }
}
async function signOut() {
  if (!els.event.hidden) exitEvent();
  playback.dispose();
  cancelRecognition(); clearAudioPreview();
  localStorage.setItem('lyrics-v2-pending-logout', '1');
  localProjectId = null; cloudProjects = []; sessionActive = false; onlineSongOpen = false; librarySongs = []; librarySelection += 1; $('#library-dialog').close(); $('#library-list').replaceChildren(); project = null; offlineProjectOpen = false; projectEntries.clear(); remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = null; updateSessionUi(); render(); els.login.disabled = true;
  let cleared = true; await privateMutation(() => clearPrivateProjectCache()).catch(() => { cleared = false; });
  let revoked = true; try { await remote.logout(); if (cleared) localStorage.removeItem('lyrics-v2-pending-logout'); } catch { revoked = false; }
  els.login.disabled = false;
  toast(!cleared ? 'Очистка локальных данных не завершилась. Откройте приложение заново, чтобы повторить её.' : revoked ? 'Вы вышли. Локальный набор и его записи не изменены.' : 'Данные на этом устройстве очищены, но сервер пока не подтвердил выход. Подключитесь к сети и откройте приложение ещё раз.');
}
async function clearDownloadedProjectData() {
  if (!offlineProjectOpen || !confirm('Очистить загруженный проект и его черновики с этого устройства?')) return;
  cancelRecognition(); clearAudioPreview(); await privateMutation(() => clearPrivateProjectCache()).catch(error => toast(error.message)); project = null; offlineProjectOpen = false; projectEntries.clear(); remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = null; updateRemoteState(); render(); refreshOfflineProjectEntry(); toast('Загруженный проект очищен с этого устройства.');
}
$('#add-song').addEventListener('click', () => { $('#project-add-menu').open = false; addSong(); }); $('#add-library-song').addEventListener('click', () => { $('#project-add-menu').open = false; showLibrary(); }); $('#offline-projects').addEventListener('click', showOfflineProjects); $('#event-offline-projects').addEventListener('click', () => { $('#event-menu').close(); showOfflineProjects(); }); els.setName.addEventListener('change', () => { set = { ...set, name: els.setName.value.trim() || 'Мой набор' }; if (project || localProjectId || onlineSongOpen) markRemoteDirty(); }); $('#exit-event').addEventListener('click', exitEvent); $('#event-start').addEventListener('click', startEvent); $('#event-reset').addEventListener('click', event => { if (event.detail >= 2) resetEvent(); }); $('#fullscreen').addEventListener('click', toggleFullscreen); $('#font-up').addEventListener('click', () => changeAudienceFont(4)); $('#font-down').addEventListener('click', () => changeAudienceFont(-4));
$('#library').addEventListener('click', () => hub.show('library'));
$('#projects').addEventListener('click', showProjects);
$('#event-menu-toggle').addEventListener('click', showEventMenu);
$('#event-menu-close').addEventListener('click', () => $('#event-menu').close());
$('#event-menu').addEventListener('close', () => { $('#event-menu-toggle').setAttribute('aria-expanded', 'false'); if (!els.event.hidden) $('#event-menu-toggle').focus(); });
document.addEventListener('pointerdown', event => {
  const menu = $('#event-menu');
  if (menu.open && !menu.contains(event.target) && !$('#event-menu-toggle').contains(event.target)) menu.close();
});
$('#event-home').addEventListener('click', () => hub.show(eventOrigin));
$('#online-library-search').addEventListener('input', renderOnlineLibraryList);
onlineLibrarySort.addEventListener('change', () => {
  try { sessionStorage.setItem('kaada-library-sort', onlineLibrarySort.value); } catch {}
  renderOnlineLibraryList();
});

$('#event-progress').addEventListener('input', event => { if (eventState.song) playback.seek(Number(event.target.value)); });
function toggleMute() { if (playback.loadAudio) playback.mute(!playback.muted); }
$('#event-mute').addEventListener('click', toggleMute);
$('#event-lyrics-only').addEventListener('click', () => { $('#event-audio-status').hidden = true; $('#event-lyrics-only').hidden = true; playback.lyricsOnly(); scheduleControlsDimming(); });
function applyHighlight() {
  els.audience.classList.toggle('no-highlight', !highlightEnabled);
  $('#highlight-current').setAttribute('aria-pressed', String(highlightEnabled));
  if (eventState.song) centerAudience(eventState.lastIndex ?? -1);
}
function toggleHighlight() {
  highlightEnabled = !highlightEnabled;
  try { localStorage.setItem('lyrics-highlight-current', String(highlightEnabled)); } catch {}
  applyHighlight();
}
try { highlightEnabled = localStorage.getItem('lyrics-highlight-current') !== 'false'; } catch {}
applyHighlight();
$('#highlight-current').addEventListener('click', toggleHighlight);
document.addEventListener('keydown', event => {
  if (els.event.hidden) return;
  if (event.key === 'Escape' && $('#event-menu').open) { event.preventDefault(); $('#event-menu').close(); return; }
  if (document.querySelector('dialog[open]') || event.ctrlKey || event.altKey || event.metaKey) return;
  const target = event.target instanceof Element ? event.target : document.body;
  const editable = target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])');
  const key = event.key.toLowerCase();
  const library = key === 'l' || event.code === 'KeyL';
  if (!eventState.song && !library) return;
  if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
    if (editable && target.id !== 'event-progress') return;
    if (event.key === 'ArrowDown' && target.id !== 'event-progress' && scrollManualAudience(5)) { event.preventDefault(); return; }
    event.preventDefault(); playback.seek(playback.elapsed() + (event.key === 'ArrowUp' ? -5 : 5));
    return;
  }
  if (editable) return;
  const highlight = key === 'c' || event.code === 'KeyC';
  const fullscreen = key === 'f' || event.code === 'KeyF';
  const fontUp = ['+', '='].includes(event.key) || event.code === 'NumpadAdd';
  const fontDown = ['-', '−'].includes(event.key) || event.code === 'NumpadSubtract';
  if (!highlight && !fullscreen && !library && !fontUp && !fontDown) return;
  event.preventDefault();
  if (event.repeat) return;
  if (fullscreen) toggleFullscreen();
  else if (library) showEventMenu();
  else if (fontUp || fontDown) changeAudienceFont(fontUp ? 4 : -4);
  else toggleHighlight();
}, true);
els.audience.addEventListener('wheel', event => {
  if (!event.deltaY || !eventState.song?.ignoreTimecodes || eventState.song.autoScrollEnabled !== false || eventState.ended) return;
  event.preventDefault();
  scrollManualAudience(event.deltaY > 0 ? 5 : -5);
}, { passive: false });
eventControls.addEventListener('pointerenter', event => {
  // Touch can leave CSS :hover sticky; only an actual hovering pointer pins the panel.
  controlsVisibility.hovered = event.pointerType !== 'touch';
  restoreEventControls();
});
eventControls.addEventListener('pointerleave', () => { controlsVisibility.hovered = false; scheduleControlsDimming(); });
eventControls.addEventListener('focusin', restoreEventControls);
eventControls.addEventListener('focusout', () => queueMicrotask(scheduleControlsDimming));
$('#event-progress').addEventListener('pointerdown', () => { controlsVisibility.dragging = true; restoreEventControls(); });
for (const event of ['pointerup', 'pointercancel']) document.addEventListener(event, () => {
  if (!controlsVisibility.dragging) return;
  controlsVisibility.dragging = false; scheduleControlsDimming();
});
eventControls.addEventListener('pointerdown', restoreEventControls);
document.addEventListener('fullscreenchange', syncFullscreenControls);
els.save.addEventListener('click', () => onlineSongOpen ? saveLibrarySong() : saveRemoteProject());
$('#delete-library-song').addEventListener('click', () => deleteLibrarySong());
els.login.addEventListener('click', () => $('#login-dialog').showModal()); els.logout.addEventListener('click', signOut); $('#login-form').addEventListener('submit', event => { event.preventDefault(); signIn(); }); $('#library-search').addEventListener('input', () => searchLibrary());
els.clearDownloaded.addEventListener('click', clearDownloadedProjectData);

const hub = createWorkspaceHub({
  state: () => ({ ...localState(), cloudProjects, cloudSongs: librarySongs, session: sessionActive, message: hubMessage }),
  actions: {
    leaveEditor: async () => {
      if (!await confirmProjectExit()) return false;
      if (!els.event.hidden) exitEvent();
      cancelRecognition(); clearAudioPreview(); els.save.hidden = true; els.remote.hidden = true;
      $('#show-mode').hidden = true; $('#project-add-menu').hidden = true; $('#delete-library-song').hidden = true; $('#toolbar-song-actions').hidden = true;
      if (project || localProjectId) {
        project = null; localProjectId = null; offlineProjectOpen = false; projectEntries.clear();
        remoteDirty = false; remoteFailed = false; pendingLocalRefresh = null; set = legacySet; selectedId = null;
      }
      if (onlineSongOpen) { onlineSongOpen = false; remoteDirty = false; projectEntries.clear(); set = legacySet; selectedId = null; updateRemoteState(); }
      return true;
    },
    confirmProjectExit,
    refresh: refreshHubCloud, createProject: createLocalProject, createSong: createLocalSong,
    openProject: openLocalProject,
    openCloudProject: id => openProject(id), openCloudSong: openLibrarySong,
    download: downloadItem, remove: removeLocalItem, readiness, removeCloudSong, removeCloudProject, createLibraryCopy,
    playCloudSong: async id => { if (await openLibrarySong(id)) { const song = currentSong(); if (song) launchEvent(song); } },
    playCloudProject: async id => { if (!await openProject(id)) return; const song = set.songs.find(item => !validateSong(item).length); if (song) { selectedId = song.id; launchEvent(song); } else toast('Сначала подготовьте песни проекта.'); },
    play: async id => { if (!await openLocalProject(id, { playbackOnly: true })) return; const song = set.songs.find(item => !validateSong(item).length); if (song) launchEvent(song); else toast('Сначала подготовьте песни проекта.'); },
  },
});
onWorkspaceStatus(text => { savedStatus = text; $('#local-save-status').textContent = text; $('#retry-local-save').hidden = !text.startsWith('Не сохранено:'); if ($('#workspace-retry')) $('#workspace-retry').hidden = !text.startsWith('Не сохранено:'); updateRemoteState(); });
for (const id of ['#retry-local-save', '#workspace-retry']) $(id)?.addEventListener('click', async () => {
  try { await retryWorkspaceSave(); syncLocalLibrary(); hub.render(); render(); }
  catch (error) { toast(error.message); }
});
$('#create-local-project-form').addEventListener('submit', submitLocalProject);
$('#cancel-local-project').addEventListener('click', () => $('#create-local-project-dialog').close());
$('#workspace-connect').addEventListener('click', chooseDirectory);

$('#back-home').addEventListener('click', () => hub.show(localProjectId || project ? 'projects' : 'library'));

$('#library-add-selected').addEventListener('click', addSelectedLibrarySongs);
$('#library-create-new').addEventListener('click', () => { $('#library-dialog').close(); addSong(); });
window.addEventListener('beforeunload', event => { if ((savedStatus.startsWith('Сохранение') || savedStatus.startsWith('Не сохранено:')) && connectedWorkspace() || remoteDirty) { event.preventDefault(); event.returnValue = ''; } });

syncLocalLibrary(); set = legacySet;
updateSessionUi(); render(); initOffline();
await restoreDirectory(); hub.show('projects');
try { if (localStorage.getItem('lyrics-v2-pending-logout')) { await privateMutation(() => clearPrivateProjectCache()); try { await remote.session(); await remote.logout(); localStorage.removeItem('lyrics-v2-pending-logout'); } catch (error) { if (error.status === 401) localStorage.removeItem('lyrics-v2-pending-logout'); } } else { await remote.session(); sessionActive = true; } } catch {} updateSessionUi(); render(); refreshOfflineProjectEntry(); if (sessionActive) refreshHubCloud();

window.addEventListener('resize', () => { if (!els.event.hidden) { centerAudience(eventState.lastIndex ?? -1); positionEventMenu(); } });
els.setName.addEventListener('input', updateSetNameMarquee);
window.addEventListener('resize', updateSetNameMarquee);
window.addEventListener('online', refreshConnectivity);
window.addEventListener('offline', refreshConnectivity);
