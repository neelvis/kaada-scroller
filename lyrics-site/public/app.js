import { createSong, cueAt, uniformScrollProgress, validateSong } from './core.js';
import { loadSet } from './storage.js';
import { getAudio, getBacking, localState, connectedWorkspace, saveWorkspace, retryWorkspaceSave, onWorkspaceStatus, duplicateSong } from './local-workspace.js';
import { $, node, button, iconTextButton, toast, plural, input } from './ui.js';
import { createWorkspaceHub } from './workspace-hub.js';
import { createSongEditor } from './song-editor.js';
import { createWorkspaceActions } from './workspace-actions.js';
import { uploadLocalSong } from './cloud-transfers.js';
import { Playback } from './playback.js';
import { exportPortableSet, importPortableSet } from './portable.js';
import * as remote from './remote.js';
import { clearPrivateProjectCache, getDraft, getPrivateAudio, openCachedProject, preparedProjects, removeDraft, saveDraft } from './offline-projects.js';

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
let tapHistory = new Map();
let persistChain = Promise.resolve();
let importing = false;
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
let editGeneration = 0;
let offlineProjectOpen = false;
let onlineSongOpen = false;
let librarySongs = [];
let libraryRequest = 0;
let librarySelection = 0;
let libraryMessage = '';
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

const { showPreparation, syncLocalLibrary, restoreDirectory, openLocalProject, createLocalProject, submitLocalProject, createLocalSong, refreshHubCloud, readiness, uploadItem, downloadItem, removeLocalItem, copyLocalItem, migrateBrowserData, adoptLocalLibraryVersion, chooseDirectory, ensureDirectory } = createWorkspaceActions({
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
  actions: { cancelRecognition, clearAudioPreview, render, openProject, openLocalSong, addSong, backingKey },
});

const { renderEditor, cancelLrclib, resetPreparation, resetEditorTab, refreshConnectivity } = createSongEditor({
  state: {
    get audioSongId() { return audioSongId; },
    get legacySet() { return legacySet; },
    get localProjectId() { return localProjectId; },
    get offlineProjectOpen() { return offlineProjectOpen; },
    get persistChain() { return persistChain; }, set persistChain(value) { persistChain = value; },
    get project() { return project; },
    get projectEntries() { return projectEntries; },
    get selectedId() { return selectedId; }, set selectedId(value) { selectedId = value; },
    get sessionActive() { return sessionActive; },
    get set() { return set; }, set set(value) { set = value; },
    get workspaceGeneration() { return workspaceGeneration; }
  },
  resources: { els, previewPlayer, backingPreview, recognition, tapHistory, sourceGeneration },
  actions: { currentSong, status, changeSong, render, showLibrary, addSong, clearAudioPreview, clearBackingPreview, setAudioPreview, setBackingPreview, entryFor, privateMutation, backingKey, markRemoteDirty, persist, syncLocalLibrary, adoptLatest, displayTime },
});

function currentSong() { return set.songs.find((song) => song.id === selectedId) || null; }
function status(song) { if (song.reviewed && !validateSong(song).length) return 'Готова'; if (song.cues.length) return 'Нужно проверить'; return 'Не подготовлена'; }
function changeSong(songId, change) {
  if (onlineSongOpen) return;
  if (offlineProjectOpen) { toast('Подготовленный снимок открыт только для показа. Для редактирования нужен сервер.'); return; }
  const index = set.songs.findIndex((song) => song.id === songId); if (index < 0) return;
  const next = change(set.songs[index]); if (!next) return;
  set = { ...set, songs: set.songs.map((song, i) => i === index ? next : song) };
  if (project) markRemoteDirty(); else persist();
}
function markRemoteDirty() { remoteDirty = true; remoteFailed = false; editGeneration += 1; if (project) privateMutation(() => saveDraft(project, projectPayload())).catch(() => {}); updateRemoteState(); }
function updateRemoteState() {
  els.clearDownloaded.hidden = !offlineProjectOpen;
  if (onlineSongOpen) { els.remote.textContent = 'В облаке · просмотр'; els.save.hidden = true; $('#prepare-offline').hidden = true; $('#add-library-song').disabled = true; $('#prepare-offline').disabled = true; return; }
  const libraryButton = $('#add-library-song');
  if (libraryButton) libraryButton.disabled = offlineProjectOpen || onlineSongOpen;
  $('#export-set').hidden = false; $('#import-set').hidden = false;
  const prepareButton = $('#prepare-offline');
  if (prepareButton) prepareButton.textContent = 'Скачать для выступления';
  if (prepareButton) prepareButton.hidden = !project;
  if (prepareButton) prepareButton.disabled = !project || !sessionActive || offlineProjectOpen || remoteDirty;
  if (!project) { els.remote.textContent = `На этом устройстве · ${savedStatus}`; els.save.hidden = true; return; }
  els.save.hidden = false;
  els.remote.textContent = remoteFailed ? 'Сохранение не удалось — черновик сохранён' : remoteDirty ? 'Есть несохранённые изменения' : 'Сохранено на сервере';
  els.save.disabled = !remoteDirty || !sessionActive || offlineProjectOpen;
}
function persist() {
  const snapshot = structuredClone(set);
  const state = structuredClone(localState());
  if (localProjectId) state.projects = state.projects.map(item => item.id === localProjectId ? snapshot : item);
  else { legacySet = snapshot; state.library = snapshot.songs; }
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
  projectEntries = new Map((next.songs || []).map(entry => [entry.song.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId, backingAudioId: entry.backingAudioId ?? null }]));
  set = { schemaVersion: 1, id: next.id, name: next.name, songs: (next.songs || []).map(entry => entry.song) };
  selectedId = set.songs.some(song => song.id === previousSelection) ? previousSelection : (set.songs[selectedIndex]?.id || null);
  remoteDirty = false; remoteFailed = false; updateRemoteState(); render();
}
function rebaseSavedProjectMetadata(saved, sent) {
  project = saved;
  const returned = saved.songs || [];
  const sentSongs = sent.songs || [];
  const byLocalId = new Map(set.songs.map(song => [song.id, song]));
  returned.forEach((entry, index) => {
    const before = sentSongs[index]?.song;
    const current = before && byLocalId.get(before.id);
    if (!current) return;
    if (entry.song?.id && entry.song.id !== current.id) {
      const oldId = current.id; current.id = entry.song.id; if (selectedId === oldId) selectedId = current.id; projectEntries.delete(oldId);
    }
    projectEntries.set(current.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId, backingAudioId: entry.backingAudioId ?? null });
  });
}
async function saveRemoteProject() {
  if (!project || !sessionActive || !remoteDirty) return;
  const generation = editGeneration; const savingProjectId = project.id; const draft = projectPayload();
  try { const saved = await remote.saveProject(savingProjectId, draft); if (!sessionActive || project?.id !== savingProjectId) return; if (generation !== editGeneration) { rebaseSavedProjectMetadata(saved, draft); remoteDirty = true; await privateMutation(() => saveDraft(project, projectPayload())); updateRemoteState(); toast('Сервер сохранил предыдущую версию. Новые правки остались в черновике.'); return; } await privateMutation(() => removeDraft(savingProjectId)); adoptProject(saved, { preserveSelection: true }); toast('Проект сохранён на сервере.'); refreshLibrary(); }
  catch (error) { if (!sessionActive || project?.id !== savingProjectId) return; remoteFailed = true; updateRemoteState(); if (error.code === 'conflict') toast('На сервере есть более новая версия. Черновик оставлен; откройте проект заново или сохраните после сверки.'); else toast(error.message); }
}
async function openProject(id, { cached = false } = {}) {
  if (cached && localStorage.getItem('lyrics-v2-pending-logout')) return toast('Сначала завершите очистку данных выхода: откройте приложение заново.');
  if (remoteDirty && !confirm('Есть несохранённые изменения. Открыть другой проект без сохранения?')) return;
  resetEditorTab();
  const fromDisplay = !els.event.hidden;
  if (fromDisplay) playback.stop();
  cancelRecognition(); const workspaceRun = workspaceGeneration; const sessionAtStart = sessionActive; clearAudioPreview();
  try { const next = cached ? await openCachedProject(id) : await remote.getProject(id); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; if (!next) throw new Error('Подготовленный снимок не найден.'); offlineProjectOpen = cached; adoptProject(next); if (!cached) { const draft = await getDraft(id); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; if (draft && confirm('Для этого проекта есть несохранённый черновик на этом устройстве. Открыть его?')) { project = draft.project; projectEntries = new Map(draft.payload.songs.map(entry => [entry.song.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId, backingAudioId: entry.backingAudioId ?? null }])); set = { ...set, name: draft.payload.name, songs: draft.payload.songs.map(entry => entry.song) }; selectedId = null; remoteDirty = true; updateRemoteState(); render(); } } toast(cached ? 'Открыт подготовленный автономный снимок.' : 'Проект открыт.'); }
  catch (error) { toast(error.message); return; }
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
}
function refreshOfflineProjectEntry() { $('#offline-projects').hidden = true; $('#event-offline-projects').hidden = true; }
async function showLibrary() {
  if (onlineSongOpen || offlineProjectOpen) return;
  const dialog = $('#library-dialog'); dialog.showModal(); await searchLibrary();
}
let librarySearchRequest = 0;
let selectedLibrarySongs = new Map();
async function searchLibrary() {
  const query = $('#library-search').value.trim().toLowerCase();
  const list = $('#library-list'); list.replaceChildren();
  const candidates = legacySet.songs.filter(song => `${song.title} ${song.artist}`.toLowerCase().includes(query));
  for (const song of candidates) {
    const check = input('', 'checkbox', { 'aria-label': song.title || 'Без названия' }); check.checked = selectedLibrarySongs.has(song.id);
    check.addEventListener('change', () => { if (check.checked) selectedLibrarySongs.set(song.id, song); else selectedLibrarySongs.delete(song.id); });
    list.append(node('label', { className: 'project-row' }, [check, node('span', { text: `${song.title || 'Без названия'}${song.artist ? ` — ${song.artist}` : ''}` })]));
  }
  if (!candidates.length) list.append(node('p', { className: 'hint', text: 'Нет подходящих песен. Скачайте облачную песню в библиотеке или создайте новую.' }));
}
async function addSelectedLibrarySongs() {
  if (!connectedWorkspace() && !project) return toast('Выберите рабочую папку.');
  try {
    for (const song of selectedLibrarySongs.values()) {
      if (project) {
        const entry = await uploadLocalSong(song, localState().links[`song:${song.id}`]);
        if (set.songs.some(item => item.id === entry.song.id)) continue;
        set = { ...set, songs: [...set.songs, entry.song] }; projectEntries.set(entry.song.id, entry); selectedId = entry.song.id;
      } else {
        const copy = await duplicateSong(song);
        localState().links[`pin:${copy.id}`] = song.id;
        set = { ...set, songs: [...set.songs, copy] }; selectedId = copy.id;
      }
    }
    selectedLibrarySongs.clear();
    if (project) markRemoteDirty(); else await persist();
    $('#library-dialog').close(); render();
  } catch (error) { toast(error.message); }
}
async function adoptLatest(song) {
  if (localProjectId) return adoptLocalLibraryVersion(song);
  const current = entryFor(song); if (!current.songId || !sessionActive || offlineProjectOpen) return;
  if (!confirm('Применить последнюю версию из библиотеки к этому проекту? Текущий закреплённый таймлайн сменится только здесь.')) return;
  try { const latest = await remote.getSong(current.songId); set = { ...set, songs: set.songs.map(item => item.id === song.id ? latest.song : item) }; projectEntries.delete(song.id); projectEntries.set(latest.song.id, { songId: latest.songId, revisionId: latest.revisionId, audioId: latest.audioId, backingAudioId: latest.backingAudioId ?? null }); selectedId = latest.song.id; markRemoteDirty(); render(); } catch (error) { toast(error.message); }
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

async function refreshLibrary() {
  const request = ++libraryRequest;
  librarySongs = []; libraryMessage = 'Загрузка…'; renderLibrary();
  if (!sessionActive) return;
  try {
    const result = await remote.listLibrary();
    if (!sessionActive || request !== libraryRequest) return;
    librarySongs = result.songs || []; libraryMessage = '';
  } catch (error) {
    if (!sessionActive || request !== libraryRequest) return;
    libraryMessage = error.message;
  }
  renderLibrary();
}
function openLocalSong(id) {
  localProjectId = null; showPreparation();
  librarySelection += 1;
  if (project && remoteDirty && !confirm('Перейти в локальную библиотеку? Изменения проекта останутся в черновике.')) return;
  cancelRecognition(); clearAudioPreview();
  onlineSongOpen = false; project = null; offlineProjectOpen = false; projectEntries.clear();
  remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = id; render();
}
async function openLibrarySong(id) {
  if (!sessionActive) return;
  const request = ++librarySelection, workspace = workspaceGeneration;
  try {
    const entry = await remote.getSong(id);
    if (!sessionActive || request !== librarySelection || workspace !== workspaceGeneration) return;
    cancelRecognition(); clearAudioPreview();
    localProjectId = null; showPreparation(); project = null; offlineProjectOpen = false; onlineSongOpen = true; remoteDirty = false;
    projectEntries = new Map([[entry.song.id, entry]]);
    set = { schemaVersion: 1, id: 'online-library', name: 'Онлайн-библиотека', songs: [entry.song] };
    selectedId = entry.song.id; render();
  } catch (error) { if (sessionActive && request === librarySelection) toast(error.message); }
}
function renderLibrary() {
  $('#online-library').hidden = !sessionActive;
  const list = $('#online-song-list'); list.replaceChildren();
  if (!sessionActive) return;
  for (const item of librarySongs) {
    const control = button(`${item.title || 'Без названия'}${item.artist ? ` — ${item.artist}` : ''}`, 'song-select', () => openLibrarySong(item.id));
    list.append(node('div', { className: 'library-song' }, [control]));
  }
  if (!list.children.length) list.append(node('p', { className: 'hint', text: libraryMessage || 'В онлайн-библиотеке пока нет песен.' }));
}
function renderList() {
  els.list.replaceChildren();
  const localList = $('#local-song-list'); localList.replaceChildren();
  $('#project-songs').hidden = !project && !localProjectId;
  els.count.textContent = `${set.songs.length} ${plural(set.songs.length, 'песня', 'песни', 'песен')}`;
  const songs = project || localProjectId ? set.songs : legacySet.songs;
  songs.forEach((song, index) => {
    const ready = song.reviewed && !validateSong(song).length;
    const local = !project && !localProjectId;
    const select = node('button', { type: 'button', className: 'song-select', onclick: () => { if (local) openLocalSong(song.id); else { librarySelection += 1; selectedId = song.id; resetEditorTab(); render(); } } }, [
      node('span', { className: `song-dot${ready ? ' ready' : ''}`, 'aria-hidden': true }),
      node('span', { className: 'song-item-copy' }, [node('span', { className: 'song-item-title', text: song.title || 'Без названия' }), node('span', { className: 'song-item-status', text: status(song) })])
    ]);
    const move = (direction) => { const target = index + direction; if (target < 0 || target >= songs.length) return; if (local && onlineSongOpen) openLocalSong(song.id); const reordered = [...set.songs]; [reordered[index], reordered[target]] = [reordered[target], reordered[index]]; set = { ...set, songs: reordered }; if (project) markRemoteDirty(); else persist(); render(); };
    const up = iconTextButton('↑', 'Переместить песню выше', 'song-reorder', () => move(-1)); up.disabled = index === 0;
    const down = iconTextButton('↓', 'Переместить песню ниже', 'song-reorder', () => move(1)); down.disabled = index === songs.length - 1;
    (project || localProjectId ? els.list : localList).append(node('div', { className: `song-item${!onlineSongOpen && song.id === selectedId ? ' active' : ''}` }, [select, node('div', { className: 'song-reorder-wrap' }, [up, down])]));
  });
  if (project) for (const song of legacySet.songs) localList.append(node('div', { className: 'library-song' }, [button(song.title || 'Без названия', 'song-select', () => openLocalSong(song.id))]));
  if (!localList.children.length) localList.append(node('p', { className: 'hint', text: 'Локальных песен пока нет. Добавьте песню или импортируйте набор.' }));
  renderLibrary();
  $('#local-library').hidden = Boolean(project || localProjectId);
  $('#online-library').hidden = true;
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
function render() { $('#add-library-song').hidden = !project && !localProjectId; $('#back-home').textContent = localProjectId || project ? '← Проекты' : '← Библиотека'; $('#local-save-status').textContent = savedStatus; $('#upload-current').hidden = !sessionActive || Boolean(project) || onlineSongOpen; renderList(); els.setName.value = set.name || 'Мой набор'; els.setName.disabled = offlineProjectOpen || onlineSongOpen || (!project && !localProjectId); updateSetNameMarquee(); $('#add-song').disabled = offlineProjectOpen; $('#show-mode').disabled = !set.songs.length; renderEditor(); updateRemoteState(); if (offlineProjectOpen || onlineSongOpen) { [...els.editor.querySelectorAll('input,textarea,select,button')].forEach(control => { control.disabled = true; }); [...els.list.querySelectorAll('.song-reorder')].forEach(control => control.disabled = true); } }
function addSong() { if (!connectedWorkspace() && !project) { toast('Сначала выберите рабочую папку.'); return; } if (onlineSongOpen) openLocalSong(null); resetEditorTab(); const song = createSong({ language: 'ru' }); set = { ...set, songs: [...set.songs, song] }; selectedId = song.id; if (project) markRemoteDirty(); else persist(); render(); }

$('#show-mode').addEventListener('click', () => {
  const song = currentSong() || set.songs.find(song => !validateSong(song).length) || set.songs[0];
  if (song) launchEvent(song);
});

function launchEvent(song) {
  if (validateSong(song).length) { toast('Для показа песня должна быть подготовлена и подтверждена.'); return; }
  playback.dispose(); previewPlayer.pause(); backingPreview.pause(); document.querySelectorAll('.toast').forEach(item => item.remove());
  $('#home-view').hidden = true; $('.topbar').hidden = true; els.prep.hidden = true; els.event.hidden = false; els.eventName.textContent = song.title;
  eventState = { song: structuredClone(song), frame: 0, lastIndex: null, ended: false, manualScrollIndex: 0 };
  $('#event-progress').disabled = false;
  const owner = project, entry = { ...entryFor(song) }, offline = offlineProjectOpen;
  let loaded = null;
  const loader = () => loaded ||= loadBacking(song, owner, entry, offline).catch(error => { loaded = null; throw error; });
  buildAudience(); playback.arm(song.duration, song.backing?.fileName || entry.backingAudioId ? loader : null);
  $('#event-audio-status').hidden = true; $('#event-lyrics-only').hidden = true;
  applyHighlight(); renderAudience(-1, false); updateEvent();
  restoreEventControls();
}
function buildAudience() {
  if (!eventState.song.cues.length) { els.audienceLines.replaceChildren(node('div', { className: 'audience-line neutral', text: eventState.song.title })); centerAudience(0); return; }
  const untimed = eventState.song.ignoreTimecodes === true;
  els.audienceLines.classList.toggle('uniform-scroll', untimed && eventState.song.autoScrollEnabled !== false);
  els.audienceLines.classList.toggle('manual-scroll', untimed && eventState.song.autoScrollEnabled === false);
  els.audienceLines.replaceChildren(...eventState.song.cues.map(cue => node('div', {
    className: `audience-line${cue.type === 'rest' ? ' rest' : ''}`,
    text: cue.type === 'rest' ? `— ${cue.text} —` : cue.text,
  })));
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
  const elapsed = playback.elapsed(); const current = cueAt(song, elapsed);
  if (current.index !== eventState.lastIndex || current.ended !== eventState.ended) {
    eventState.lastIndex = current.index; eventState.ended = current.ended; renderAudience(current.index, current.ended);
  }
  if (song.ignoreTimecodes && song.autoScrollEnabled !== false && !current.ended) positionUniformAudience();
  $('#event-progress').max = String(song.duration); $('#event-progress').value = String(elapsed);
  $('#event-progress').setAttribute('aria-valuetext', `${displayTime(elapsed)} из ${displayTime(song.duration)}`);
  $('#event-elapsed').textContent = displayTime(elapsed); $('#event-duration').textContent = displayTime(song.duration);
  $('#event-start').disabled = playback.starting || elapsed >= song.duration;
  setControlIcon('event-start', playback.starting ? 'loading' : playback.running ? 'pause' : 'play', playback.starting ? 'Запуск…' : playback.running ? 'Пауза' : 'Старт', 'Пробел');
  $('#event-mute').disabled = !playback.loadAudio;
  if (playback.loadAudio) {
    setControlIcon('event-mute', playback.muted ? 'muted' : 'volume', playback.muted ? 'Включить звук' : 'Выключить звук', 'M');
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
function showEventMenu() {
  if ($('#event-menu').open) { $('#event-menu').close(); return; }
  const list = $('#event-menu-songs'); list.replaceChildren(); $('#event-project-name').textContent = set.name;
  for (const song of set.songs) {
    const ready = !validateSong(song).length;
    const item = button(`${song.title || 'Без названия'}${ready ? '' : ' · нужна подготовка'}`, 'button quiet', () => { $('#event-menu').close(); selectedId = song.id; render(); launchEvent(song); });
    item.disabled = !ready; if (eventState.song?.id === song.id) item.setAttribute('aria-current', 'true'); list.append(item);
  }
  $('#event-menu-toggle').setAttribute('aria-expanded', 'true'); $('#event-menu').show(); positionEventMenu();
  ($('#event-menu-songs button:not(:disabled)') || $('#event-menu-close')).focus();
}
function showProjects() { if (!els.event.hidden) exitEvent(); hub.show('projects'); }
async function showOfflineProjects() { showProjects(); }
function transferUi(busy) {
  importing = busy;
  $('#home-view').inert = busy;
  els.prep.inert = busy;
  $('.topbar').inert = busy;
  $('#import-set').disabled = busy;
  $('#export-set').disabled = busy;
  $('#set-file').disabled = busy;
}
async function downloadSet() {
  if (importing || transferBusy) return toast('Дождитесь завершения переноса файлов.');
  const snapshot = structuredClone(set), owner = project && structuredClone(project);
  const entries = new Map([...projectEntries].map(([id, entry]) => [id, { ...entry }]));
  const offline = offlineProjectOpen, workspace = workspaceGeneration, session = sessionActive;
  const current = () => workspaceGeneration === workspace && sessionActive === session;
  transferUi(true);
  try {
    await persistChain;
    const blob = await exportPortableSet(snapshot, async song => {
      if (!current()) throw new Error('Рабочая область изменилась. Повторите экспорт.');
      const entry = entries.get(song.id) || {};
      const audio = await loadBacking(song, owner, entry, offline);
      if (entry.backingAudioId && !audio) throw new Error(`Минусовка песни «${song.title}» недоступна.`);
      return audio;
    });
    if (!current()) throw new Error('Рабочая область изменилась. Повторите экспорт.');
    const url = URL.createObjectURL(blob);
    const a = node('a', { href: url, download: `${(snapshot.name || 'lyrics-set').replace(/[^\wа-яё-]+/gi, '-').toLowerCase()}.zip` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { toast(`Не удалось экспортировать набор: ${error.message}`); }
  finally { transferUi(false); }
}
async function importFile(file) {
  if (importing || transferBusy) return toast('Дождитесь завершения переноса файлов.');
  if (!connectedWorkspace()) return toast('Сначала выберите рабочую папку для импорта.');
  transferUi(true);
  try {
    const { set: imported, backingAudio } = await importPortableSet(file);
    const next = structuredClone(localState());
    const audio = new Map();
    const local = { ...imported, id: `project-${crypto.randomUUID()}`, songs: [] };
    for (const song of imported.songs) {
      const copy = structuredClone(song); copy.id = `song-${crypto.randomUUID()}`; local.songs.push(copy);
      if (backingAudio.has(song.id)) audio.set(`backing:${copy.id}`, backingAudio.get(song.id));
      const libraryCopy = structuredClone(copy); libraryCopy.id = `song-${crypto.randomUUID()}`;
      if (backingAudio.has(song.id)) audio.set(`backing:${libraryCopy.id}`, backingAudio.get(song.id));
      next.library.push(libraryCopy); next.links[`pin:${copy.id}`] = libraryCopy.id;
    }
    next.projects.push(local); await saveWorkspace(next, audio); syncLocalLibrary(); await openLocalProject(local.id);
    toast('Проект, песни и минусовки сохранены в рабочую папку.');
  } catch (error) { toast(error.message); }
  finally { transferUi(false); }
}
function initOffline() {
  if (!('serviceWorker' in navigator)) { els.offline.textContent = 'Автономная оболочка недоступна'; return; }
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { els.offline.textContent = 'Не удалось подготовить автономную оболочку'; });
  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data?.type !== 'OFFLINE_READY') return;
    offlineShellReady = Boolean(data.ready);
    els.offline.textContent = offlineShellReady ? 'Приложение доступно без интернета' : 'Автономная оболочка ещё готовится';
    hub.render();
  });
  navigator.serviceWorker.ready.then(registration => registration.active?.postMessage({ type: 'CHECK_OFFLINE' })).catch(() => {});
}
function updateSessionUi() {
  els.login.hidden = sessionActive; els.logout.hidden = !sessionActive;
  $('#projects').disabled = false; $('#projects').hidden = false; $('#event-projects').disabled = false; $('#event-projects').hidden = false;
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
  localProjectId = null; cloudProjects = []; sessionActive = false; onlineSongOpen = false; librarySongs = []; libraryRequest += 1; librarySelection += 1; $('#library-dialog').close(); $('#library-list').replaceChildren(); project = null; offlineProjectOpen = false; projectEntries.clear(); remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = null; updateSessionUi(); render(); els.login.disabled = true;
  let cleared = true; await privateMutation(() => clearPrivateProjectCache()).catch(() => { cleared = false; });
  let revoked = true; try { await remote.logout(); if (cleared) localStorage.removeItem('lyrics-v2-pending-logout'); } catch { revoked = false; }
  els.login.disabled = false;
  toast(!cleared ? 'Очистка локальных данных не завершилась. Откройте приложение заново, чтобы повторить её.' : revoked ? 'Вы вышли. Локальный набор и его записи не изменены.' : 'Данные на этом устройстве очищены, но сервер пока не подтвердил выход. Подключитесь к сети и откройте приложение ещё раз.');
}
async function clearDownloadedProjectData() {
  if (!offlineProjectOpen || !confirm('Очистить загруженный проект и его черновики с этого устройства?')) return;
  cancelRecognition(); clearAudioPreview(); await privateMutation(() => clearPrivateProjectCache()).catch(error => toast(error.message)); project = null; offlineProjectOpen = false; projectEntries.clear(); remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = null; updateRemoteState(); render(); refreshOfflineProjectEntry(); toast('Загруженный проект очищен с этого устройства.');
}
$('#add-song').addEventListener('click', addSong); $('#add-library-song').addEventListener('click', showLibrary); $('#prepare-offline').addEventListener('click', () => project ? downloadItem('project', project.id) : toast('Проект сохраняется в рабочую папку автоматически.')); $('#offline-projects').addEventListener('click', showOfflineProjects); $('#event-offline-projects').addEventListener('click', () => { $('#event-menu').close(); showOfflineProjects(); }); $('#export-set').addEventListener('click', downloadSet); $('#import-set').addEventListener('click', () => $('#set-file').click()); $('#set-file').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ''; }); els.setName.addEventListener('change', () => { set = { ...set, name: els.setName.value.trim() || 'Мой набор' }; if (project) markRemoteDirty(); else persist(); }); $('#exit-event').addEventListener('click', exitEvent); $('#event-start').addEventListener('click', startEvent); $('#event-reset').addEventListener('click', resetEvent); $('#fullscreen').addEventListener('click', toggleFullscreen); $('#font-up').addEventListener('click', () => changeAudienceFont(4)); $('#font-down').addEventListener('click', () => changeAudienceFont(-4));
$('#library').addEventListener('click', () => hub.show('library'));
$('#projects').addEventListener('click', showProjects);
$('#event-menu-toggle').addEventListener('click', showEventMenu);
$('#event-menu-close').addEventListener('click', () => $('#event-menu').close());
$('#event-menu').addEventListener('close', () => { $('#event-menu-toggle').setAttribute('aria-expanded', 'false'); if (!els.event.hidden) $('#event-menu-toggle').focus(); });
document.addEventListener('pointerdown', event => {
  const menu = $('#event-menu');
  if (menu.open && !menu.contains(event.target) && !$('#event-menu-toggle').contains(event.target)) menu.close();
});
$('#event-projects').addEventListener('click', () => { $('#event-menu').close(); showProjects(); });

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
  const space = event.code === 'Space' || event.key === ' ';
  if (space) {
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (eventState.song && !$('#event-start').disabled) startEvent();
    return;
  }
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
  const mute = key === 'm' || event.code === 'KeyM';
  const highlight = key === 'c' || event.code === 'KeyC';
  const fullscreen = key === 'f' || event.code === 'KeyF';
  const fontUp = ['+', '='].includes(event.key) || event.code === 'NumpadAdd';
  const fontDown = ['-', '−'].includes(event.key) || event.code === 'NumpadSubtract';
  if (!mute && !highlight && !fullscreen && !library && !fontUp && !fontDown) return;
  event.preventDefault();
  if (event.repeat) return;
  if (mute) toggleMute();
  else if (fullscreen) toggleFullscreen();
  else if (library) showEventMenu();
  else if (fontUp || fontDown) changeAudienceFont(fontUp ? 4 : -4);
  else toggleHighlight();
}, true);
els.audience.addEventListener('wheel', event => {
  if (!event.deltaY || !eventState.song?.ignoreTimecodes || eventState.song.autoScrollEnabled !== false || eventState.ended) return;
  event.preventDefault();
  scrollManualAudience(event.deltaY > 0 ? 5 : -5);
}, { passive: false });
document.addEventListener('keyup', event => {
  if (els.event.hidden || (event.code !== 'Space' && event.key !== ' ')) return;
  event.preventDefault(); event.stopImmediatePropagation();
}, true);
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
els.save.addEventListener('click', saveRemoteProject); els.login.addEventListener('click', () => $('#login-dialog').showModal()); els.logout.addEventListener('click', signOut); $('#login-form').addEventListener('submit', event => { event.preventDefault(); signIn(); }); $('#library-search').addEventListener('input', () => searchLibrary());
els.clearDownloaded.addEventListener('click', clearDownloadedProjectData);

const hub = createWorkspaceHub({
  state: () => ({ ...localState(), cloudProjects, cloudSongs: librarySongs, session: sessionActive, message: hubMessage }),
  actions: {
    leaveEditor: () => { if (!els.event.hidden) exitEvent(); cancelRecognition(); clearAudioPreview(); },
    refresh: refreshHubCloud, createProject: createLocalProject, createSong: createLocalSong,
    openProject: openLocalProject, openSong: id => { syncLocalLibrary(); openLocalSong(id); },
    openCloudProject: id => openProject(id), openCloudSong: openLibrarySong,
    upload: uploadItem, download: downloadItem, copy: copyLocalItem, remove: removeLocalItem, readiness,
    play: async id => { if (!await openLocalProject(id)) return; const song = set.songs.find(item => !validateSong(item).length); if (song) launchEvent(song); else toast('Сначала подготовьте песни проекта.'); },
  },
});
onWorkspaceStatus(text => { savedStatus = text; $('#local-save-status').textContent = text; $('#retry-local-save').hidden = !text.startsWith('Не сохранено:'); $('#workspace-retry').hidden = !text.startsWith('Не сохранено:'); updateRemoteState(); });
for (const id of ['#retry-local-save', '#workspace-retry']) $(id).addEventListener('click', async () => {
  try { await retryWorkspaceSave(); syncLocalLibrary(); hub.render(); render(); }
  catch (error) { toast(error.message); }
});
$('#create-local-project-form').addEventListener('submit', submitLocalProject);
$('#cancel-local-project').addEventListener('click', () => $('#create-local-project-dialog').close());
$('#workspace-connect').addEventListener('click', chooseDirectory);
$('#migrate-browser').addEventListener('click', migrateBrowserData);
$('#back-home').addEventListener('click', () => hub.show(localProjectId || project ? 'projects' : 'library'));
$('#upload-current').addEventListener('click', () => uploadItem(localProjectId ? 'project' : 'song', localProjectId || selectedId));
$('#library-add-selected').addEventListener('click', addSelectedLibrarySongs);
$('#library-create-new').addEventListener('click', () => { $('#library-dialog').close(); addSong(); });
window.addEventListener('beforeunload', event => { if ((savedStatus.startsWith('Сохранение') || savedStatus.startsWith('Не сохранено:')) && connectedWorkspace() || remoteDirty) { event.preventDefault(); event.returnValue = ''; } });

try { const stored = await loadSet(); if (stored) { set = stored; legacySet = stored; selectedId = null; } } catch (error) { toast(`Не удалось открыть сохранённый набор: ${error.message}`); }
updateSessionUi(); render(); initOffline();
await restoreDirectory(); hub.show('projects');
try { if (localStorage.getItem('lyrics-v2-pending-logout')) { await privateMutation(() => clearPrivateProjectCache()); try { await remote.session(); await remote.logout(); localStorage.removeItem('lyrics-v2-pending-logout'); } catch (error) { if (error.status === 401) localStorage.removeItem('lyrics-v2-pending-logout'); } } else { await remote.session(); sessionActive = true; } } catch {} updateSessionUi(); render(); refreshOfflineProjectEntry(); if (sessionActive) refreshHubCloud();

window.addEventListener('resize', () => { if (!els.event.hidden) { centerAudience(eventState.lastIndex ?? -1); positionEventMenu(); } });
els.setName.addEventListener('input', updateSetNameMarquee);
window.addEventListener('resize', updateSetNameMarquee);
window.addEventListener('online', refreshConnectivity);
window.addEventListener('offline', refreshConnectivity);

document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || els.prep.hidden || $('#confirm-dialog').open) return;
  if (event.target.closest('input,textarea,select,button,[contenteditable]')) return;
  const tap = [...els.editor.querySelectorAll('button')].find(button => button.textContent === 'Отметить следующую');
  if (tap) { event.preventDefault(); tap.click(); }
});
