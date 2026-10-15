import { createSong, cueAt, exportSet, formatTime, invalidateReview, parseLrc, parseTime, uniformScrollProgress, validateSong } from './core.js';
import { deleteAudio, deleteBacking, getAudio, getBacking, loadSet, putAudio, putBacking, replaceStoredSet, saveSet } from './storage.js';
import { Playback } from './playback.js';
import { exportPortableSet, importPortableSet } from './portable.js';
import { hasPlainLyrics, hasSynchronizedLyrics, LrclibClient, prepareLrcImport, preparePlainImport } from './lrclib.js';
import { recognizeFile } from './recognition.js';
import * as remote from './remote.js';
import { cacheProject, clearPrivateProjectCache, getDraft, getPrivateAudio, openCachedProject, preparedProjects, putPrivateAudio, removeDraft, removePreparedProject, removePrivateAudio, saveDraft } from './offline-projects.js';

const $ = (selector, root = document) => root.querySelector(selector);
const els = { editor: $('#editor'), list: $('#song-list'), count: $('#song-count'), setName: $('#set-name'), prep: $('#preparation-view'), event: $('#event-view'), eventName: $('#event-song-name'), audience: $('#audience'), audienceLines: $('#audience-lines'), offline: $('#offline-state'), remote: $('#remote-state'), save: $('#save-project'), login: $('#login'), logout: $('#logout'), clearDownloaded: $('#clear-downloaded') };
let set = { schemaVersion: 1, id: crypto.randomUUID?.() || `set-${Date.now()}`, name: 'Мой набор', songs: [] };
let legacySet = set;
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
let migrationKey = null;
let editGeneration = 0;
let offlineProjectOpen = false;
const sourceGeneration = new Map();
let workspaceGeneration = 0;
const recognitionProfiles = new Map();
const backingGeneration = new Map();
let editorTab = 'lrclib';
let editorTabSongId = null;
const importDrafts = new Map();
let backingPreviewId = null;
let backingPreviewUrl = null;
let backingPreviewGeneration = 0;
const backingPreview = document.createElement('audio');
backingPreview.id = 'backing-preview';
backingPreview.controls = true;
backingPreview.preload = 'metadata';
let privateMutationChain = Promise.resolve();
const lrclibClient = new LrclibClient();
let lrclibState = null;
function lrclibContext() { return JSON.stringify([workspaceGeneration, set.id, project?.id, selectedId, sessionActive, offlineProjectOpen]); }
function cancelLrclib() { lrclibState?.controller?.abort(); if (lrclibState) lrclibState.token += 1; lrclibState = null; }
function privateMutation(operation) { const next = privateMutationChain.then(operation, operation); privateMutationChain = next.catch(() => {}); return next; }

function node(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'htmlFor') el.htmlFor = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of Array.isArray(children) ? children : [children]) if (child) el.append(child);
  return el;
}
function button(text, className = 'button', click) { return node('button', { type: 'button', className, text, onclick: click }); }
function iconTextButton(text, label, className, click) {
  const control = button(text, `${className} has-tooltip`, click);
  control.setAttribute('aria-label', label);
  control.setAttribute('data-tooltip', label);
  return control;
}
function toast(message) { const item = node('div', { className: 'toast', role: 'status', text: message }); document.body.append(item); setTimeout(() => item.remove(), 4200); }
function currentSong() { return set.songs.find((song) => song.id === selectedId) || null; }
function status(song) { if (song.reviewed && !validateSong(song).length) return 'Готова'; if (song.cues.length) return 'Нужно проверить'; return 'Не подготовлена'; }
function changeSong(songId, change) {
  if (offlineProjectOpen) { toast('Подготовленный снимок открыт только для показа. Для редактирования нужен сервер.'); return; }
  const index = set.songs.findIndex((song) => song.id === songId); if (index < 0) return;
  const next = change(set.songs[index]); if (!next) return;
  set = { ...set, songs: set.songs.map((song, i) => i === index ? next : song) };
  if (project) markRemoteDirty(); else persist();
}
function markRemoteDirty() { remoteDirty = true; remoteFailed = false; editGeneration += 1; if (project) privateMutation(() => saveDraft(project, projectPayload())).catch(() => {}); updateRemoteState(); }
function updateRemoteState() {
  els.clearDownloaded.hidden = !offlineProjectOpen;
  const libraryButton = $('#add-library-song');
  if (libraryButton) libraryButton.disabled = !project || !sessionActive || offlineProjectOpen;
  const prepareButton = $('#prepare-offline');
  if (prepareButton) prepareButton.disabled = !project || !sessionActive || offlineProjectOpen || remoteDirty;
  if (!project) { els.remote.textContent = legacySet.songs.length ? 'Локальный набор — перенесите на сервер' : 'Создайте серверный проект'; els.save.hidden = true; return; }
  els.save.hidden = false;
  els.remote.textContent = remoteFailed ? 'Сохранение не удалось — черновик сохранён' : remoteDirty ? 'Есть несохранённые изменения' : 'Сохранено на сервере';
  els.save.disabled = !remoteDirty || !sessionActive || offlineProjectOpen;
}
function persist() { const snapshot = JSON.parse(exportSet(set)); legacySet = snapshot; persistChain = persistChain.then(() => saveSet(snapshot)).catch((error) => toast(`Не удалось сохранить: ${error.message}`)); }
function invalidateChanged(song, changes) { return invalidateReview({ ...song, ...changes }); }
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
  if (!owner) return getBacking(song.id);
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
function cancelRecognition({ preserveDrafts = false } = {}) { cancelLrclib(); if (!preserveDrafts) importDrafts.clear(); editorTabSongId = null; workspaceGeneration += 1; for (const job of recognition.values()) job.controller?.abort(); recognition.clear(); }
function entryFor(song) { return projectEntries.get(song.id) || {}; }
function projectPayload() {
  return {
    revision: project.revision, name: set.name || project.name,
    songs: set.songs.map(song => ({ ...entryFor(song), song: structuredClone(song) })),
  };
}
function adoptProject(next, { preserveSelection = false } = {}) {
  const previousSelection = preserveSelection && project?.id === next.id ? selectedId : null;
  const selectedIndex = previousSelection ? set.songs.findIndex(song => song.id === previousSelection) : -1;
  cancelLrclib();
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
  try { const saved = await remote.saveProject(savingProjectId, draft); if (!sessionActive || project?.id !== savingProjectId) return; if (generation !== editGeneration) { rebaseSavedProjectMetadata(saved, draft); remoteDirty = true; await privateMutation(() => saveDraft(project, projectPayload())); updateRemoteState(); toast('Сервер сохранил предыдущую версию. Новые правки остались в черновике.'); return; } await privateMutation(() => removeDraft(savingProjectId)); adoptProject(saved, { preserveSelection: true }); toast('Проект сохранён на сервере.'); }
  catch (error) { if (!sessionActive || project?.id !== savingProjectId) return; remoteFailed = true; updateRemoteState(); if (error.code === 'conflict') toast('На сервере есть более новая версия. Черновик оставлен; откройте проект заново или сохраните после сверки.'); else toast(error.message); }
}
async function openProject(id, { cached = false } = {}) {
  if (cached && localStorage.getItem('lyrics-v2-pending-logout')) return toast('Сначала завершите очистку данных выхода: откройте приложение заново.');
  if (remoteDirty && !confirm('Есть несохранённые изменения. Открыть другой проект без сохранения?')) return;
  editorTab = 'lrclib';
  const fromDisplay = !els.event.hidden;
  if (fromDisplay) playback.stop();
  cancelRecognition(); const workspaceRun = workspaceGeneration; const sessionAtStart = sessionActive; clearAudioPreview();
  try { const next = cached ? await openCachedProject(id) : await remote.getProject(id); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; if (!next) throw new Error('Подготовленный снимок не найден.'); offlineProjectOpen = cached; adoptProject(next); if (!cached) { const draft = await getDraft(id); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; if (draft && confirm('Для этого проекта есть несохранённый черновик на этом устройстве. Открыть его?')) { project = draft.project; projectEntries = new Map(draft.payload.songs.map(entry => [entry.song.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId, backingAudioId: entry.backingAudioId ?? null }])); set = { ...set, name: draft.payload.name, songs: draft.payload.songs.map(entry => entry.song) }; selectedId = null; remoteDirty = true; updateRemoteState(); render(); } } $('#projects-dialog').close(); toast(cached ? 'Открыт подготовленный автономный снимок.' : 'Проект открыт.'); }
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
async function refreshProjects() {
  const workspaceRun = workspaceGeneration; const sessionAtStart = sessionActive;
  const list = $('#project-list'); list.replaceChildren(node('p', { className: 'hint', text: 'Загрузка…' }));
  try {
    const [result, cached] = await Promise.all([sessionActive ? remote.listProjects().catch(error => ({ projects: [], error })) : Promise.resolve({ projects: [] }), localStorage.getItem('lyrics-v2-pending-logout') ? Promise.resolve([]) : preparedProjects()]);
    if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return;
    $('#new-project-field').hidden = !sessionActive;
    $('.migration-choice').hidden = !sessionActive;
    $('#migrate-legacy').hidden = !sessionActive;
    $('#create-project').hidden = !sessionActive;
    list.replaceChildren();
    if (result.error) list.append(node('p', { className: 'hint', text: result.error.message }));
    for (const item of result.projects || []) { const actions = node('span', { className: 'action-row' }, [button('Открыть', 'button quiet', () => openProject(item.id)), button('×', 'button danger', async () => { if (!confirm(`Удалить проект «${item.name}»? Песни останутся в библиотеке.`)) return; try { await remote.deleteProject(item.id, item.revision); if (project?.id === item.id) { project = null; projectEntries.clear(); remoteDirty = false; offlineProjectOpen = false; set = legacySet; selectedId = null; updateRemoteState(); } await refreshProjects(); render(); } catch (error) { toast(error.code === 'conflict' ? 'Проект изменился на сервере. Обновите список и повторите.' : error.message); } })]); list.append(node('div', { className: 'project-row' }, [node('span', { text: `${item.name} · ${item.songCount} ${plural(item.songCount, 'песня', 'песни', 'песен')}` }), actions])); }
    for (const item of cached) list.append(node('div', { className: 'project-row cached' }, [node('span', { text: `${item.name} · подготовлен для показа` }), button('Открыть без сети', 'button quiet', () => openProject(item.id, { cached: true }))]));
    list.querySelectorAll('button').forEach(control => { if (control.textContent.trim() === '×') { control.classList.add('has-tooltip'); control.setAttribute('aria-label', 'Удалить проект'); control.setAttribute('data-tooltip', 'Удалить проект'); } });
    if (!list.children.length) list.append(node('p', { className: 'hint', text: sessionActive ? 'Проектов пока нет.' : 'Войдите, чтобы открыть проекты, или подготовьте проект на этом устройстве.' }));
  } catch (error) { list.replaceChildren(node('p', { className: 'hint', text: error.message })); }
}
async function prepareOfflineProject() {
  if (!project || remoteDirty) { toast('Сначала сохраните проект, затем подготовьте снимок для показа.'); return; }
  if (!set.songs.length || set.songs.some(song => validateSong(song).length)) { toast('Сначала проверьте и подтвердите все песни проекта.'); return; }
  const workspaceRun = workspaceGeneration; const projectId = project.id; const sessionAtStart = sessionActive;
  const snapshot = structuredClone(project);
  const current = () => workspaceGeneration === workspaceRun && project?.id === projectId && sessionActive === sessionAtStart && project.revision === snapshot.revision && !remoteDirty;
  try {
    await verifyOfflineShell(); if (!current()) return;
    const backingAudio = [];
    for (const entry of snapshot.songs || []) {
      if (!entry.backingAudioId) {
        if (entry.song.backing?.fileName) throw new Error(`Для «${entry.song.title}» нужно заново выбрать минусовку.`);
        continue;
      }
      const blob = await loadBacking(entry.song, snapshot, entry, false); if (!current()) return;
      if (!blob) throw new Error(`Минусовка «${entry.song.title}» недоступна.`);
      backingAudio.push({ id: backingKey(entry.backingAudioId), blob });
    }
    await privateMutation(() => { if (current()) return cacheProject(snapshot, backingAudio); });
    if (!current()) return;
    refreshOfflineProjectEntry();
    toast('Снимок проекта и минусовки подготовлены для автономного показа.');
  }
  catch (error) { toast(`Не удалось подготовить снимок: ${error.message}`); }
}
async function refreshOfflineProjectEntry() {
  const buttons = [$('#offline-projects'), $('#event-offline-projects')];
  try { const hidden = Boolean(localStorage.getItem('lyrics-v2-pending-logout')) || !(await preparedProjects()).length; buttons.forEach(button => { if (button) button.hidden = hidden; }); }
  catch { buttons.forEach(button => { if (button) button.hidden = true; }); }
}
async function verifyOfflineShell() {
  if (!navigator.serviceWorker?.ready) throw new Error('Автономный режим браузера недоступен.');
  const registration = await navigator.serviceWorker.ready; const worker = registration.active;
  if (!worker) throw new Error('Автономная оболочка ещё не готова.');
  const ready = await new Promise(resolve => { const timer = setTimeout(() => resolve(false), 2500); const listener = event => { if (event.data?.type === 'OFFLINE_READY') { navigator.serviceWorker.removeEventListener('message', listener); clearTimeout(timer); resolve(Boolean(event.data.ready)); } }; navigator.serviceWorker.addEventListener('message', listener); worker.postMessage({ type: 'CHECK_OFFLINE' }); });
  if (!ready) throw new Error('Файлы показа ещё не сохранены для автономной работы.');
}
async function showLibrary() {
  if (!project || !sessionActive) { toast('Сначала войдите и откройте проект.'); return; }
  const dialog = $('#library-dialog'); dialog.showModal(); await searchLibrary();
}
async function searchLibrary() {
  const list = $('#library-list'); list.replaceChildren(node('p', { className: 'hint', text: 'Поиск…' }));
  try { const result = await remote.listLibrary($('#library-search').value.trim()); list.replaceChildren(...(result.songs || []).map(item => node('div', { className: 'project-row' }, [node('span', { text: `${item.title || 'Без названия'}${item.artist ? ` — ${item.artist}` : ''}` }), button('Добавить', 'button quiet', async () => { const entry = await remote.getSong(item.id); if (set.songs.some(song => song.id === entry.song.id)) return toast('Эта версия уже есть в проекте.'); set = { ...set, songs: [...set.songs, entry.song] }; projectEntries.set(entry.song.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId, backingAudioId: entry.backingAudioId ?? null }); selectedId = entry.song.id; markRemoteDirty(); render(); $('#library-dialog').close(); })]))); if (!list.children.length) list.append(node('p', { className: 'hint', text: 'Ничего не найдено.' })); }
  catch (error) { list.replaceChildren(node('p', { className: 'hint', text: error.message })); }
}
async function adoptLatest(song) {
  const current = entryFor(song); if (!current.songId || !sessionActive || offlineProjectOpen) return;
  if (!confirm('Применить последнюю версию из библиотеки к этому проекту? Текущий закреплённый таймлайн сменится только здесь.')) return;
  try { const latest = await remote.getSong(current.songId); set = { ...set, songs: set.songs.map(item => item.id === song.id ? latest.song : item) }; projectEntries.delete(song.id); projectEntries.set(latest.song.id, { songId: latest.songId, revisionId: latest.revisionId, audioId: latest.audioId, backingAudioId: latest.backingAudioId ?? null }); selectedId = latest.song.id; markRemoteDirty(); render(); } catch (error) { toast(error.message); }
}
function setAudioPreview(song) {
  if (audioSongId === song.id) return;
  clearAudioPreview(); audioSongId = song.id;
  const generation = audioGeneration;
  (async () => project ? ((await getPrivateAudio(`${project.id}:${song.id}`)) || (entryFor(song).audioId ? remote.downloadAudio(entryFor(song).audioId) : null)) : getAudio(song.id))().then((blob) => {
    if (generation !== audioGeneration || currentSong()?.id !== song.id || !blob) return;
    audioUrl = URL.createObjectURL(blob); previewPlayer.src = audioUrl;
  }).catch((error) => toast(`Не удалось открыть запись: ${error.message}`));
}

function renderList() {
  els.list.replaceChildren(); els.count.textContent = `${set.songs.length} ${plural(set.songs.length, 'песня', 'песни', 'песен')}`;
  set.songs.forEach((song, index) => {
    const ready = song.reviewed && !validateSong(song).length;
    const select = node('button', { type: 'button', className: 'song-select', onclick: () => { selectedId = song.id; editorTab = 'lrclib'; render(); } }, [
      node('span', { className: `song-dot${ready ? ' ready' : ''}`, 'aria-hidden': true }),
      node('span', { className: 'song-item-copy' }, [node('span', { className: 'song-item-title', text: song.title || 'Без названия' }), node('span', { className: 'song-item-status', text: status(song) })])
    ]);
    const move = (direction) => { const target = index + direction; if (target < 0 || target >= set.songs.length) return; const songs = [...set.songs]; [songs[index], songs[target]] = [songs[target], songs[index]]; set = { ...set, songs }; if (project) markRemoteDirty(); else persist(); render(); };
    const up = iconTextButton('↑', 'Переместить песню выше', 'song-reorder', () => move(-1)); up.disabled = index === 0;
    const down = iconTextButton('↓', 'Переместить песню ниже', 'song-reorder', () => move(1)); down.disabled = index === set.songs.length - 1;
    els.list.append(node('div', { className: `song-item${song.id === selectedId ? ' active' : ''}` }, [select, node('div', { className: 'song-reorder-wrap' }, [up, down])]));
  });
}
function plural(value, one, few, many) { const n = Math.abs(value) % 100, m = n % 10; return n > 10 && n < 20 ? many : m > 1 && m < 5 ? few : m === 1 ? one : many; }
function field(labelText, control) { return node('div', { className: 'field' }, [node('label', { text: labelText }, [control])]); }
function input(value, type = 'text', attrs = {}) { const el = node('input', { type, ...attrs }); el.value = value ?? ''; return el; }

function renderEditor() {
  if (lrclibState && lrclibState.context !== lrclibContext()) cancelLrclib();
  const song = currentSong(); els.editor.replaceChildren();
  if (!song) { clearAudioPreview(); const template = $('#empty-state'); const copy = template.content.cloneNode(true); const title = $('[data-empty-title]', copy), copyText = $('[data-empty-copy]', copy); const add = $('[data-add-song]', copy); if (set.songs.length) { title.textContent = 'Выберите песню для редактирования'; copyText.textContent = 'Нажмите на песню в левом меню.'; } else if (project) { title.textContent = 'Добавьте песню в проект'; copyText.textContent = 'Песня будет сохранена в проекте после нажатия «Сохранить». '; add.hidden = false; add.addEventListener('click', addSong); } else if (legacySet.songs.length) { title.textContent = 'Локальный набор'; copyText.textContent = 'Этот набор остался на устройстве. Перенесите его в серверный проект, когда будете готовы.'; $('[data-empty-project]', copy).hidden = false; $('[data-empty-project]', copy).addEventListener('click', () => $('#projects').click()); } else { title.textContent = 'Создайте общий проект'; copyText.textContent = 'Войдите организатором, создайте проект и добавляйте песни, доступные с других устройств.'; $('[data-empty-login]', copy).hidden = false; $('[data-empty-login]', copy).addEventListener('click', () => $('#login').click()); } els.editor.append(copy); return; }
  const validation = validateSong(song);
  const title = input(song.title, 'text', { required: true, autocomplete: 'off' });
  title.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { title: title.value })); render(); });
  const artist = input(song.artist, 'text', { autocomplete: 'off' }); artist.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { artist: artist.value })); render(); });
  const version = input(song.version, 'text', { placeholder: 'Например, студийная версия' }); version.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { version: version.value })); render(); });
  const duration = input(formatDurationInput(song.duration), 'text', { inputmode: 'numeric', placeholder: 'ММ:СС', pattern: '[0-9]+:[0-5][0-9]', 'aria-label': 'Длительность, ММ:СС' });
  duration.addEventListener('change', () => {
    const parsed = parseDurationInput(duration.value);
    if (parsed == null) { toast('Введите длительность в формате ММ:СС; секунды должны быть от 00 до 59.'); render(); return; }
    if (duration.value !== formatDurationInput(song.duration)) { changeSong(song.id, s => invalidateChanged(s, { duration: parsed })); render(); }
  });
  const header = node('div', { className: 'editor-header' }, [node('div', {}, [node('h1', { className: 'editor-title', text: song.title || 'Новая песня' }), node('p', { className: 'editor-subtitle', text: 'Текст, таймлайн и музыка для выступления' })]), node('span', { className: `status-pill${song.reviewed && !validation.length ? ' ready' : ''}`, text: status(song) })]);
  const details = node('section', { className: 'section-card' }, [node('h2', { text: 'О песне' }), node('div', { className: 'field-grid' }, [field('Название', title), field('Исполнитель', artist), field('Версия записи', version), field('Длительность, ММ:СС', duration)])]);
  if (editorTabSongId !== song.id) { editorTabSongId = song.id; editorTab = 'lrclib'; }
  const drafts = importDrafts.get(song.id) || { lrc: '', plain: '' }; importDrafts.set(song.id, drafts);
  const panels = {
    lrclib: node('div', { id: 'lrclib-panel', role: 'tabpanel', 'aria-labelledby': 'lrclib-tab', className: 'editor-tab-panel' }, [renderLrclibCard(song)]),
    lrc: node('div', { id: 'lrc-panel', role: 'tabpanel', 'aria-labelledby': 'lrc-tab', className: 'editor-tab-panel' }, [renderImportCard(song, 'lrc', drafts)]),
    plain: node('div', { id: 'plain-panel', role: 'tabpanel', 'aria-labelledby': 'plain-tab', className: 'editor-tab-panel' }, [renderImportCard(song, 'plain', drafts)])
  };
  const timeline = node('div', { className: 'editor-tab-panel' }, [renderCues(song, validation)]);
  const tabs = node('div', { className: 'editor-tabs', role: 'tablist', 'aria-label': 'Подготовка песни' });
  const selectTab = (name, focus = false) => {
    editorTab = name;
    Object.entries(panels).forEach(([key, panel]) => { panel.hidden = name !== key; });
    [...tabs.children].forEach(tab => { const selected = tab.id === `${name}-tab`; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; if (selected && focus) tab.focus(); });
  };
  for (const [name, label] of [['lrclib', 'LRCLIB'], ['lrc', 'Свой LRC'], ['plain', 'Свой текст']]) {
    const tab = button(label, 'button quiet', () => selectTab(name));
    tab.id = `${name}-tab`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `${name}-panel`);
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const names = ['lrclib', 'lrc', 'plain']; const index = names.indexOf(name); selectTab(event.key === 'Home' ? names[0] : event.key === 'End' ? names.at(-1) : names[(index + (event.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length], true);
    });
    tabs.append(tab);
  }
  selectTab(editorTab);
  // Keep the original player available while tapping in the text tab.
  const listen = node('div', { className: 'audio-preview text-reference', hidden: !song.source?.fileName }, [node('p', { className: 'hint', text: 'Оригинал для разметки' }), previewPlayer]);
  els.editor.append(header, details, tabs, ...Object.values(panels), timeline, listen, renderBackingCard(song), renderReview(song), renderSongActions(song));
  setAudioPreview(song); setBackingPreview(song);
}
function formatDurationInput(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function parseDurationInput(value) {
  const match = /^(\d+):([0-5]\d)$/.exec(value.trim());
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  return Number.isFinite(seconds) ? seconds : null;
}

function renderBackingCard(song) {
  const file = node('input', { id: 'backing-file', type: 'file', accept: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav', hidden: true });
  const choose = button(song.backing?.fileName ? 'Заменить минусовку' : 'Добавить минусовку', 'button quiet', () => file.click());
  const remove = button('Удалить минусовку', 'button quiet', async () => {
    backingGeneration.set(song.id, (backingGeneration.get(song.id) || 0) + 1);
    if (project) projectEntries.set(song.id, { ...entryFor(song), backingAudioId: null });
    else await deleteBacking(song.id);
    clearBackingPreview();
    changeSong(song.id, s => invalidateChanged(s, { backing: { fileName: '' } })); render();
  });
  remove.hidden = !song.backing?.fileName;
  file.addEventListener('change', async () => {
    const selected = file.files?.[0]; if (!selected) return;
    const run = (backingGeneration.get(song.id) || 0) + 1; backingGeneration.set(song.id, run);
    const owner = project?.id || null, workspace = workspaceGeneration, session = sessionActive;
    const current = () => workspaceGeneration === workspace && (project?.id || null) === owner && sessionActive === session && backingGeneration.get(song.id) === run && set.songs.some(item => item.id === song.id);
    choose.disabled = true; choose.textContent = 'Загрузка минусовки…';
    try {
      await checkBackingFile(selected);
      if (!current()) return;
      if (owner) {
        if (!sessionActive) throw new Error('Для загрузки минусовки нужна связь с сервером.');
        const uploaded = await remote.uploadAudio(selected);
        if (!current()) return;
        await privateMutation(() => { if (current()) return putPrivateAudio(backingKey(uploaded.id), selected); });
        if (!current()) return;
        projectEntries.set(song.id, { ...entryFor(song), backingAudioId: uploaded.id });
      } else {
        persistChain = persistChain.then(() => { if (current()) return putBacking(song.id, selected); });
        await persistChain;
        if (!current()) return;
      }
      clearBackingPreview(); changeSong(song.id, s => invalidateChanged(s, { backing: { fileName: selected.name } })); render();
    } catch (error) { if (current()) { toast(`Не удалось сохранить минусовку: ${error.message}`); render(); } }
  });
  return node('section', { className: 'section-card backing-card' }, [node('h2', { text: 'Минусовка' }), node('p', { className: 'hint', text: 'Необязательно. Запускается вместе с текстом; проверьте, что версия и начало совпадают с таймлайном. MP3/WAV до 150 МиБ и 20 минут. ZIP-экспорт включает минусовки; оригинальная запись исключена.' }), node('div', { className: 'action-row' }, [choose, node('span', { className: 'file-name', text: song.backing?.fileName || 'Без минусовки' }), remove]), file, ...(song.backing?.fileName ? [backingPreview] : [])]);
}

async function checkBackingFile(file) {
  if (file.size > 150 * 1024 * 1024) throw new Error('Файл больше 150 МиБ.');
  if (!/\.(mp3|wav)$/i.test(file.name)) throw new Error('Выберите файл MP3 или WAV.');
  const player = new Audio(); const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Не удалось прочитать аудиофайл.')), 15000);
      player.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(player.duration) && player.duration > 0 && player.duration <= 1200 ? resolve() : reject(new Error('Минусовка должна быть не длиннее 20 минут.')); };
      player.onerror = () => { clearTimeout(timer); reject(new Error('Не удалось прочитать MP3 или WAV.')); };
      player.src = url;
    });
  } finally { player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url); }
}

function renderAudioCard(song) {
  const file = node('input', { id: 'original-file', type: 'file', accept: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav', hidden: true });
  const choose = button('Выбрать MP3 или WAV', 'button quiet', () => file.click());
  file.addEventListener('change', async () => { const selected = file.files?.[0]; if (!selected) return; const sourceRun = (sourceGeneration.get(song.id) || 0) + 1; sourceGeneration.set(song.id, sourceRun); const projectId = project?.id || null; const sessionAtStart = sessionActive; const workspaceRun = workspaceGeneration; try { recognition.get(song.id)?.controller?.abort(); if (projectId) { if (!sessionAtStart) throw new Error('Для загрузки записи нужна связь с сервером.'); const uploaded = await remote.uploadAudio(selected); if (workspaceGeneration !== workspaceRun || !sessionActive || (project?.id || null) !== projectId || (sourceGeneration.get(song.id) || 0) !== sourceRun) return; projectEntries.set(song.id, { ...entryFor(song), audioId: uploaded.id }); const audioKey = `${projectId}:${song.id}`; await privateMutation(() => putPrivateAudio(audioKey, selected)); if (workspaceGeneration !== workspaceRun || !sessionActive || (project?.id || null) !== projectId || (sourceGeneration.get(song.id) || 0) !== sourceRun) { await privateMutation(() => removePrivateAudio(audioKey)); return; } } else { await putAudio(song.id, selected); if (project || (sourceGeneration.get(song.id) || 0) !== sourceRun) return; } if (audioSongId === song.id) clearAudioPreview(); changeSong(song.id, s => invalidateChanged(s, { source: { kind: 'audio', fileName: selected.name } })); render(); } catch (error) { if (workspaceGeneration === workspaceRun && (sourceGeneration.get(song.id) || 0) === sourceRun && (project?.id || null) === projectId && sessionActive === sessionAtStart) toast(`Не удалось сохранить запись: ${error.message}`); } });
  const card = node('section', { className: 'section-card' }, [node('h2', { text: 'Оригинальная запись' }), node('p', { className: 'hint', text: 'Запись нужна для распознавания, прослушивания и разметки. На выступлении она не проигрывается из приложения.' }), node('div', { className: 'action-row' }, [choose, node('span', { className: 'file-name', text: song.source?.fileName || 'Файл не выбран' })]), file]);
  if (song.source?.fileName) card.append(node('div', { className: 'audio-preview' }, [previewPlayer, renderRecognition(song)]));
  return card;
}
function renderRecognition(song) {
  const job = recognition.get(song.id); const wrap = node('div', {}); const profile = node('select', { 'aria-label': 'Профиль распознавания' }); profile.append(node('option', { value: 'quality', text: 'Качество — крупнее модель' }), node('option', { value: 'fast', text: 'Быстрее — меньше модель' })); profile.value = recognitionProfiles.get(song.id) || 'quality'; profile.addEventListener('change', () => { recognitionProfiles.set(song.id, profile.value); recognition.get(song.id)?.controller?.abort(); renderEditor(); }); wrap.append(node('p', { className: 'hint', text: 'Первый запуск скачает модель. Профиль «Качество» требует больше времени и памяти на ноутбуке; при ошибке выберите «Быстрее» или подготовьте текст вручную/LRC.' }), profile);
  if (job) { wrap.append(node('p', { className: `recognition-progress${job.error ? ' error' : ''}`, text: job.message || 'Подготовка…' })); wrap.append(button(job.controller ? 'Отменить' : 'Повторить', 'button quiet', () => job.controller ? job.controller.abort() : startRecognition(song))); return wrap; }
  wrap.append(button(song.cues.length ? 'Рассчитать время по тексту' : 'Распознать MP3', 'button primary', () => startRecognition(song))); return wrap;
}
async function startRecognition(song) {
  if (recognition.get(song.id)?.controller) return;
  const controller = new AbortController(); const projectId = project?.id || null; const sessionAtStart = sessionActive; const sourceRun = sourceGeneration.get(song.id) || 0; const workspaceRun = workspaceGeneration; const profile = recognitionProfiles.get(song.id) || 'quality'; recognition.set(song.id, { controller, message: 'Подготовка распознавания…' }); renderEditor();
  try { const blob = project ? ((await getPrivateAudio(`${project.id}:${song.id}`)) || (entryFor(song).audioId ? await remote.downloadAudio(entryFor(song).audioId) : null)) : await getAudio(song.id); if (!blob) throw new Error('Сначала выберите запись.'); if (controller.signal.aborted) throw new DOMException('Распознавание отменено', 'AbortError'); const inputVersion = JSON.stringify({ source: song.source, cues: song.cues }); const lyrics = song.cues.length ? structuredClone(song.cues) : undefined; const result = await recognizeFile(new File([blob], song.source?.fileName || 'recording.mp3', { type: blob.type }), { language: song.language || 'ru', profile, lyrics, signal: controller.signal, onProgress: (progress) => { if (workspaceGeneration !== workspaceRun || (project?.id || null) !== projectId || sessionActive !== sessionAtStart || (sourceGeneration.get(song.id) || 0) !== sourceRun) return; const message = progress.message || 'Распознаём…'; recognition.set(song.id, { controller, message }); if (currentSong()?.id === song.id) { const label = $('.recognition-progress'); if (label) label.textContent = message; } } });
    if (!result?.cues?.length || !result.cues.some((cue) => String(cue.text || '').trim())) throw new Error('Не удалось получить текст из записи. Добавьте текст вручную и расставьте строки.');
    const latest = set.songs.find((item) => item.id === song.id);
    if (workspaceGeneration !== workspaceRun || (project?.id || null) !== projectId || sessionActive !== sessionAtStart || (sourceGeneration.get(song.id) || 0) !== sourceRun) return;
    if (!latest || JSON.stringify({ source: latest.source, cues: latest.cues }) !== inputVersion) throw new Error('Текст или запись изменились во время расчёта. Результат не был применён.');
    const question = lyrics ? `Будут применены только предложенные времена; без уверенного совпадения останется: ${result.alignment?.unresolved ?? 0}.` : 'Результат распознавания заменит текущий текст и таймлайн.';
    await replaceCues(latest, result.cues, { duration: result.duration || latest.duration, source: result.source || { kind: 'recognition', fileName: latest.source?.fileName || '' } }, question, () => !controller.signal.aborted && JSON.stringify({ source: currentSong()?.source, cues: currentSong()?.cues }) === inputVersion); recognition.delete(song.id); render();
  } catch (error) { if (workspaceGeneration !== workspaceRun || (project?.id || null) !== projectId || sessionActive !== sessionAtStart || (sourceGeneration.get(song.id) || 0) !== sourceRun) return; recognition.set(song.id, { error: true, message: error.name === 'AbortError' ? 'Распознавание отменено. Данные песни не изменены.' : error.message }); renderEditor(); }
}
function renderLrclibCard(song) {
  const state = lrclibState ||= { context: lrclibContext(), title: song.title || '', artist: song.artist || '', token: 0, results: [], selected: null, loading: false, message: '', snapshot: null };
  const title = input(state.title, 'text', { id: 'lrclib-title', required: true, maxlength: 300, autocomplete: 'off' });
  const artist = input(state.artist, 'text', { id: 'lrclib-artist', maxlength: 300, autocomplete: 'off' });
  const search = node('button', { type: 'submit', className: 'button quiet', text: 'Найти LRC' });
  const cancel = button('Отменить поиск', 'button quiet', () => {
    state.controller?.abort(); state.token += 1; state.loading = false;
    state.message = 'Поиск отменён. Данные песни не изменены.'; state.paint();
  });
  cancel.id = 'lrclib-cancel';
  const status = node('p', { id: 'lrclib-status', className: 'hint', role: 'status', 'aria-live': 'polite' });
  const results = node('div', { className: 'lrclib-results' });
  const preview = node('div', { className: 'lrclib-preview-wrap' });
  const active = () => lrclibState === state && state.context === lrclibContext() && !offlineProjectOpen;
  const unchanged = () => active() && JSON.stringify(currentSong()) === state.snapshot;
  const importRecord = async (record, plain = false) => {
    if (!unchanged()) { state.message = 'Песня изменилась. Повторите поиск перед импортом.'; state.paint(); return; }
    const token = state.token;
    try {
      const latest = currentSong();
      const prepared = plain ? preparePlainImport(latest, record) : prepareLrcImport(latest, record);
      const isCurrent = () => unchanged() && state.token === token && state.results.includes(record) && (plain || state.selected === record);
      const applied = await replaceCues(latest, prepared.cues, prepared.details, 'Импорт из LRCLIB заменит текущий текст и таймлайн.', isCurrent);
      if (!active()) return;
      if (state.token !== token || !state.results.includes(record) || (!plain && state.selected !== record)) return;
      if (applied) {
        state.snapshot = JSON.stringify(currentSong());
        const duration = currentSong().duration;
        const mismatch = record.duration > 0 && duration > 0 && record.duration !== duration
          ? ` Длительность LRCLIB: ${record.duration} сек.; ваша песня: ${duration} сек. Проверьте совпадение версии.` : '';
        state.message = plain
          ? `Текст импортирован с пустыми таймкодами. Проверьте строки и включите «игнорировать таймкоды» или разметьте время.${record.duration > 0 ? '' : ' Длительность LRCLIB отсутствует: укажите её вручную.'}`
          : `LRC импортирован. Проверьте текст и таймкоды по своей записи перед подтверждением готовности.${mismatch}`;
      } else if (!unchanged()) state.message = 'Песня изменилась. Повторите поиск перед импортом.';
      state.paint();
    } catch (error) { if (active()) { state.message = error.message; state.paint(); } }
  };
  state.paint = () => {
    status.textContent = offlineProjectOpen
      ? 'Поиск LRCLIB недоступен в автономном снимке. Для редактирования откройте проект с сервера.'
      : !navigator.onLine ? 'Поиск LRCLIB доступен при подключении к интернету. Можно вставить LRC вручную.' : state.message;
    status.hidden = !status.textContent;
    search.disabled = state.loading || !state.title.trim() || offlineProjectOpen;
    search.textContent = state.loading ? 'Поиск…' : 'Найти LRC';
    cancel.hidden = !state.loading;
    results.replaceChildren(...state.results.map(record => {
      const available = hasSynchronizedLyrics(record);
      const select = button(available ? 'Просмотреть LRC' : 'LRC недоступен', 'button quiet', () => { state.selected = record; state.paint(); });
      select.disabled = !available;
      const plainImport = !available && button('Вставить чистый текст', 'button quiet', () => importRecord(record, true));
      if (plainImport) { plainImport.disabled = !hasPlainLyrics(record); plainImport.title = plainImport.disabled ? 'У записи нет обычного текста.' : 'Вставить текст без таймкодов и длительность выбранной записи'; }
      const duration = Number.isFinite(record.duration) ? displayTime(record.duration) : 'длительность неизвестна';
      return node('div', { className: `lrclib-result${state.selected === record ? ' selected' : ''}` }, [
        node('div', { className: 'lrclib-record' }, [node('strong', { text: record.trackName }), node('span', { text: record.artistName || 'Исполнитель не указан' }), node('span', { className: 'hint', text: `${record.albumName || 'Альбом не указан'} · ${duration} · ${available ? 'Есть LRC' : record.instrumental ? 'Инструментальная запись' : 'Без таймкодов'}` })]), node('div', { className: 'action-row' }, [select, plainImport]),
      ]);
    }));
    preview.replaceChildren();
    if (state.selected && hasSynchronizedLyrics(state.selected)) {
      const lrc = node('textarea', { id: 'lrclib-preview', readonly: true, 'aria-label': 'Предпросмотр LRC' });
      lrc.value = state.selected.syncedLyrics;
      const apply = button('Импортировать LRC', 'button primary', () => importRecord(state.selected)); apply.id = 'lrclib-import';
      preview.append(node('p', { className: 'hint', text: 'Проверьте, что версия и длительность совпадают с вашей оригинальной записью или минусовкой.' }), field('LRC выбранной записи', lrc), apply);
    }
  };
  for (const [control, key] of [[title, 'title'], [artist, 'artist']]) {
    control.addEventListener('input', () => {
      state[key] = control.value; state.controller?.abort(); state.token += 1;
      state.loading = false; state.results = []; state.selected = null; state.message = ''; state.paint();
    });
  }
  const form = node('form', { id: 'lrclib-search-form' }, [node('div', { className: 'field-grid' }, [field('Название для поиска', title), field('Исполнитель для поиска (необязательно)', artist)]), node('div', { className: 'action-row' }, [search, cancel])]);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!active() || state.loading || !state.title.trim()) return;
    state.results = []; state.selected = null;
    if (!navigator.onLine) { state.message = 'Поиск LRCLIB доступен при подключении к интернету. Можно вставить LRC вручную.'; state.paint(); return; }
    state.controller = new AbortController(); const token = ++state.token;
    state.snapshot = JSON.stringify(currentSong()); state.loading = true; state.message = 'Ищем LRC…'; state.paint();
    try {
      const found = await lrclibClient.search({ title: state.title, artist: state.artist, signal: state.controller.signal });
      if (!active() || token !== state.token) return;
      if (!unchanged()) { state.message = 'Песня изменилась. Повторите поиск перед импортом.'; return; }
      state.results = found; state.message = found.length ? `Найдено записей: ${found.length}. Выберите подходящую версию.` : 'Ничего не найдено. Уточните название или исполнителя и повторите поиск.';
    } catch (error) { if (active() && token === state.token) state.message = error.message; }
    finally { if (active() && token === state.token) { state.loading = false; state.paint(); } }
  });
  state.paint();
  return node('section', { className: 'section-card lrclib-card' }, [node('h2', { text: 'Найти LRC в LRCLIB' }), form, status, results, preview]);
}

function renderImportCard(song, mode, drafts) {
  const lrc = mode === 'lrc' ? node('textarea', { placeholder: '[00:12.50] Первая строка\n[00:18.10] Вторая строка' }) : null;
  const plain = mode === 'plain' ? node('textarea', { placeholder: 'Первая строка\nВторая строка\nПрипев' }) : null;
  const control = lrc || plain; control.value = drafts[mode]; control.addEventListener('input', () => { drafts[mode] = control.value; });
  const loadLrc = lrc && button('Заменить из LRC', 'button quiet', async () => { try { const parsed = parseLrc(lrc.value); if (!parsed.cues.length) throw new Error('В LRC не найдено строк с таймкодами.'); await replaceCues(song, parsed.cues, {}, 'Импорт LRC заменит текущий текст и таймлайн.'); } catch (error) { toast(error.message); } });
  const loadPlain = plain && button('Вставить строки', 'button quiet', () => { const cues = plain.value.split(/\r?\n/).filter(Boolean).map((text, i) => ({ id: `paste-${Date.now()}-${i}`, start: null, text, type: 'lyric' })); if (cues.length) replaceCues(song, cues, {}, 'Вставка текста заменит текущие строки.'); else toast('Добавьте хотя бы одну строку.'); });
  return node('section', { className: 'section-card' }, [node('h2', { text: mode === 'lrc' ? 'Свой LRC' : 'Свой текст' }), node('p', { className: 'hint', text: 'Вставьте готовый LRC или обычный текст. Все повторения припева добавляйте отдельными строками.' }), field(mode === 'lrc' ? 'LRC с таймкодами' : 'Обычный текст', control), loadLrc || loadPlain]);
}
async function replaceCues(song, cues, details, question, isCurrent = () => true) {
  if (song.cues.length && !(await confirmReplace(question))) return false;
  if (!isCurrent()) return false;
  tapHistory.delete(song.id);
  changeSong(song.id, s => invalidateChanged(s, { ...details, cues: cues.map((cue, i) => ({ id: cue.id || `cue-${Date.now()}-${i}`, start: Number.isFinite(cue.start) ? cue.start : null, text: String(cue.text || ''), type: cue.type === 'rest' ? 'rest' : 'lyric' })) })); render(); return true;
}
function confirmReplace(message) { const dialog = $('#confirm-dialog'); $('#confirm-text').textContent = message; return new Promise((resolve) => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); }); }
function renderCues(song, validation) {
  const card = node('section', { className: 'section-card' }); const table = node('div', { className: 'cue-table' });
  const addCue = (cue = { id: `cue-${crypto.randomUUID()}`, start: null, text: '', type: 'lyric' }) => { changeSong(song.id, s => invalidateChanged(s, { cues: [...s.cues, cue] })); render(); };
  const tapCue = (index) => { const player = previewPlayer; if (!player.src) { toast('Для отметки включите оригинальную запись.'); return; } const before = currentSong()?.cues[index]?.start ?? null; changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.map((cue, i) => i === index ? { ...cue, start: player.currentTime } : cue) })); const history = tapHistory.get(song.id) || []; history.push({ cueId: song.cues[index].id, before }); tapHistory.set(song.id, history); render(); };
  const tapNext = () => { const index = currentSong()?.cues.findIndex((cue) => cue.start == null) ?? -1; if (index < 0) { toast('Нет неотмеченных строк. Для повторной отметки используйте кнопку часов у строки.'); return; } tapCue(index); };
  const undoTap = () => { const history = tapHistory.get(song.id) || []; const last = history.pop(); if (!last) { toast('Нет последней отметки для отмены.'); return; } tapHistory.set(song.id, history); changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.map((cue) => cue.id === last.cueId ? { ...cue, start: last.before } : cue) })); render(); };
  card.append(node('div', { className: 'cue-toolbar' }, [node('div', {}, [node('h2', { text: 'Строки таймлайна' }), node('p', { className: 'hint', text: 'Время — начало строки. Кнопка «Отметить следующую» или пробел отмечает начало. Отмечайте строки по очереди или переотмечайте конкретную строку кнопкой часов.' })]), node('div', { className: 'action-row' }, [button('+ Строка', 'button quiet', () => addCue()), button('Отметить следующую', 'button quiet', tapNext), button('Отменить отметку', 'button quiet', undoTap)])]));
  const ignore = input('', 'checkbox', { id: 'ignore-timecodes' });
  ignore.checked = song.ignoreTimecodes === true;
  ignore.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { ignoreTimecodes: ignore.checked })); render(); });
  const autoScroll = input('', 'checkbox', { id: 'auto-scroll-enabled' });
  autoScroll.checked = song.autoScrollEnabled !== false;
  autoScroll.addEventListener('change', () => {
    changeSong(song.id, current => ({ ...current, autoScrollEnabled: autoScroll.checked }));
    updateAutoScrollVisibility();
  });
  const autoScrollLabel = node('label', { className: 'ignore-timecodes auto-scroll-label' }, [autoScroll, node('span', { text: 'начинать автоскролл через, сек' })]);
  const autoScrollStart = input(song.autoScrollStartSeconds ?? 10, 'number', { min: '0', step: '1', className: 'auto-scroll-delay', 'aria-label': 'начинать автоскролл через, сек' });
  autoScrollStart.addEventListener('change', () => {
    const value = Number(autoScrollStart.value);
    if (!Number.isSafeInteger(value) || value < 0) { autoScrollStart.value = String(song.autoScrollStartSeconds ?? 10); return; }
    if (value === (song.autoScrollStartSeconds ?? 10)) return;
    changeSong(song.id, current => ({ ...current, autoScrollStartSeconds: value }));
    render();
  });
  const scrollStart = song.autoScrollStartSeconds ?? 10;
  const scrollStartHint = node('p', { className: 'hint', text: `Без таймкодов текст прокручивается равномерно: с ${scrollStart}-й секунды до конца песни.` });
  const manualScrollHint = node('p', { className: 'hint', text: 'Автоскролл выключен — в режиме показа текст прокручивается только вручную.' });
  const autoScrollSettings = node('div', { className: 'auto-scroll-settings' }, [autoScrollLabel, autoScrollStart]);
  const updateAutoScrollVisibility = () => {
    autoScrollSettings.hidden = !ignore.checked;
    autoScrollStart.hidden = !ignore.checked || !autoScroll.checked;
    scrollStartHint.hidden = !ignore.checked || !autoScroll.checked;
    manualScrollHint.hidden = !ignore.checked || autoScroll.checked;
  };
  updateAutoScrollVisibility();
  card.append(node('label', { className: 'ignore-timecodes' }, [ignore, node('span', { text: 'игнорировать таймкоды' })]), autoScrollSettings, scrollStartHint, manualScrollHint);
  song.cues.forEach((cue, index) => { const time = input(cue.start == null ? '' : formatTime(cue.start), 'text', { 'aria-label': `Время строки ${index + 1}` }); const text = input(cue.text, 'text', { 'aria-label': `Текст строки ${index + 1}` }); const type = node('select', { 'aria-label': `Тип строки ${index + 1}` }); type.append(node('option', { value: 'lyric', text: 'Текст' }), node('option', { value: 'rest', text: 'Пауза' })); type.value = cue.type;
    const update = () => { const start = parseTime(time.value); changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.map((item, i) => i === index ? { ...item, start, text: text.value, type: type.value } : item) })); render(); }; time.addEventListener('change', update); text.addEventListener('change', update); type.addEventListener('change', update);
    const retapLabel = `Отметить строку ${index + 1} по текущему времени записи`;
    const retap = button('◷', 'button quiet has-tooltip', () => tapCue(index)); retap.setAttribute('aria-label', retapLabel); retap.setAttribute('data-tooltip', retapLabel);
    const removeLabel = `Удалить строку ${index + 1}`;
    const remove = button('×', 'button quiet has-tooltip', () => { changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.filter((_, i) => i !== index) })); render(); }); remove.setAttribute('aria-label', removeLabel); remove.setAttribute('data-tooltip', removeLabel); table.append(node('div', { className: `cue-row${cue.type === 'rest' ? ' rest' : ''}` }, [time, text, type, retap, remove]));
  }); card.append(table);
  if (validation.length) card.append(node('ul', { className: 'validation' }, validation.map((message) => node('li', { text: message })))); return card;
}
function renderReview(song) {
  const card = node('section', { className: 'review-row' });
  card.append(node('p', { text: song.reviewed ? 'Таймлайн был подтверждён, но последующие изменения отменяют подтверждение.' : 'Прослушайте запись, проверьте каждую строку и только затем отметьте песню готовой.' }));
  const confirm = button('Подтвердить готовность', 'button primary', () => {
    // Commit the focused edit before validating; its change handler can rebuild the editor.
    const focused = document.activeElement;
    if (els.editor.contains(focused) && focused.matches('input,textarea,select')) focused.dispatchEvent(new Event('change', { bubbles: true }));
    const latest = currentSong();
    if (!latest || latest.id !== song.id) return;
    const trial = { ...latest, reviewed: true };
    if (validateSong(trial).length) { toast('Сначала исправьте ошибки в таймлайне.'); return; }
    changeSong(song.id, () => trial); render();
  });
  // Keep focus until click so a blur-triggered render cannot remove the click target.
  confirm.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
  card.append(confirm); return card;
}

function renderSongActions(song) {
  const del = button(project ? 'Убрать из проекта' : 'Удалить песню', 'button danger', async () => { if (!confirm(project ? 'Убрать песню только из этого проекта?' : 'Удалить песню и локальную запись?')) return; recognition.get(song.id)?.controller?.abort(); if (!project) await Promise.all([deleteAudio(song.id), deleteBacking(song.id)]).catch(() => {}); projectEntries.delete(song.id); set = { ...set, songs: set.songs.filter((s) => s.id !== song.id) }; selectedId = null; if (project) markRemoteDirty(); else persist(); render(); });
  const controls = [del];
  let versionHint;
  if (project) {
    const explanation = 'Применит последнюю версию песни из библиотеки только в этом проекте: заменит текст, таймкоды и ссылки на аудио. Остальные проекты сохранят свои версии. После обновления нажмите «Сохранить».';
    const versionButton = button('Обновить из библиотеки', 'button quiet has-tooltip', () => adoptLatest(song));
    versionButton.disabled = !entryFor(song).songId || !sessionActive || offlineProjectOpen;
    versionButton.setAttribute('aria-describedby', 'version-action-hint');
    versionButton.setAttribute('data-tooltip', explanation);
    controls.push(versionButton);
    versionHint = node('span', { id: 'version-action-hint', className: 'visually-hidden', text: explanation });
  }
  return node('div', { className: 'song-actions' }, [node('div', { className: 'action-row' }, controls), ...(versionHint ? [versionHint] : [])]);
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
function render() { renderList(); els.setName.value = set.name || 'Мой набор'; els.setName.disabled = offlineProjectOpen; updateSetNameMarquee(); $('#add-song').disabled = offlineProjectOpen; $('#show-mode').disabled = !set.songs.length; renderEditor(); updateRemoteState(); if (offlineProjectOpen) { [...els.editor.querySelectorAll('input,textarea,select,button')].forEach(control => { control.disabled = true; }); [...els.list.querySelectorAll('.song-reorder')].forEach(control => control.disabled = true); } }
function addSong() { editorTab = 'lrclib'; const song = createSong({ language: 'ru' }); set = { ...set, songs: [...set.songs, song] }; selectedId = song.id; if (project) markRemoteDirty(); else persist(); render(); }

$('#show-mode').addEventListener('click', () => {
  const song = currentSong() || set.songs.find(song => !validateSong(song).length) || set.songs[0];
  if (song) launchEvent(song);
});

function launchEvent(song) {
  if (validateSong(song).length) { toast('Для показа песня должна быть подготовлена и подтверждена.'); return; }
  playback.dispose(); previewPlayer.pause(); backingPreview.pause(); document.querySelectorAll('.toast').forEach(item => item.remove());
  $('.topbar').hidden = true; els.prep.hidden = true; els.event.hidden = false; els.eventName.textContent = song.title;
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
function showProjects() {
  if (!sessionActive) return;
  const dialog = $('#projects-dialog');
  if (!els.event.hidden) els.event.append(dialog);
  dialog.showModal(); return refreshProjects();
}
async function showOfflineProjects() {
  const dialog = $('#projects-dialog');
  if (!els.event.hidden) els.event.append(dialog); else document.body.append(dialog);
  dialog.showModal(); return refreshProjects();
}
function transferUi(busy) {
  importing = busy;
  els.prep.inert = busy;
  $('.topbar').inert = busy;
  $('#import-set').disabled = busy;
  $('#export-set').disabled = busy;
  $('#set-file').disabled = busy;
}
async function downloadSet() {
  if (importing) return toast('Дождитесь завершения переноса файлов.');
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
  if (importing) return toast('Дождитесь завершения переноса файлов.');
  if (project && !confirm('Импорт заменит только локальный набор. Текущий серверный проект останется без изменений и будет закрыт. Продолжить?')) return;
  const workspace = workspaceGeneration, session = sessionActive;
  transferUi(true);
  try {
    const { set: imported, backingAudio } = await importPortableSet(file);
    if (workspaceGeneration !== workspace || sessionActive !== session) throw new Error('Рабочая область изменилась. Повторите импорт.');
    // Invalidate pending audio replacements before the storage transaction, so a
    // decoded old file cannot enqueue a write after the imported backing tracks.
    cancelRecognition({ preserveDrafts: true });
    const importWorkspace = workspaceGeneration;
    await persistChain;
    if (workspaceGeneration !== importWorkspace || sessionActive !== session) throw new Error('Рабочая область изменилась. Повторите импорт.');
    await replaceStoredSet(imported, backingAudio);
    tapHistory.clear(); importDrafts.clear(); clearAudioPreview();
    legacySet = imported; set = imported; project = null; projectEntries.clear();
    remoteDirty = false; remoteFailed = false; offlineProjectOpen = false;
    selectedId = null; editorTabSongId = null;
    updateRemoteState(); render();
    toast(backingAudio.size ? 'Набор и минусовки импортированы.' : 'Набор импортирован.');
  } catch (error) { toast(error.message); }
  finally { transferUi(false); }
}
function initOffline() { if (!('serviceWorker' in navigator)) { els.offline.textContent = 'Автономный режим недоступен'; return; } navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}); navigator.serviceWorker.addEventListener('message', ({ data }) => { if (data?.type === 'OFFLINE_READY') els.offline.textContent = data.ready ? 'Готово для автономной работы' : 'Автономный режим ещё готовится'; }); navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: 'CHECK_OFFLINE' })).catch(() => { els.offline.textContent = 'Автономный режим ещё готовится'; }); }
function updateSessionUi() {
  els.login.hidden = sessionActive; els.logout.hidden = !sessionActive;
  $('#projects').disabled = !sessionActive; $('#projects').hidden = !sessionActive; $('#event-projects').disabled = !sessionActive; $('#event-projects').hidden = !sessionActive;
  updateRemoteState(); refreshOfflineProjectEntry();
}
async function signIn() {
  const password = $('#login-password').value; const error = $('#login-error'); error.hidden = true;
  try { if (localStorage.getItem('lyrics-v2-pending-logout')) { await privateMutation(() => clearPrivateProjectCache()); try { await remote.session(); await remote.logout(); } catch (problem) { if (problem.status !== 401) throw problem; } localStorage.removeItem('lyrics-v2-pending-logout'); } await remote.login(password); sessionActive = true; $('#login-dialog').close(); $('#login-password').value = ''; cancelLrclib(); updateSessionUi(); render(); toast('Вход выполнен.'); }
  catch (problem) { error.textContent = problem.message; error.hidden = false; }
}
async function signOut() {
  cancelRecognition(); clearAudioPreview();
  localStorage.setItem('lyrics-v2-pending-logout', '1');
  sessionActive = false; project = null; offlineProjectOpen = false; projectEntries.clear(); remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = null; updateSessionUi(); render(); els.login.disabled = true;
  let cleared = true; await privateMutation(() => clearPrivateProjectCache()).catch(() => { cleared = false; });
  let revoked = true; try { await remote.logout(); if (cleared) localStorage.removeItem('lyrics-v2-pending-logout'); } catch { revoked = false; }
  els.login.disabled = false;
  toast(!cleared ? 'Очистка локальных данных не завершилась. Откройте приложение заново, чтобы повторить её.' : revoked ? 'Вы вышли. Локальный набор и его записи не изменены.' : 'Данные на этом устройстве очищены, но сервер пока не подтвердил выход. Подключитесь к сети и откройте приложение ещё раз.');
}
async function clearDownloadedProjectData() {
  if (!offlineProjectOpen || !confirm('Очистить загруженный проект и его черновики с этого устройства?')) return;
  cancelRecognition(); clearAudioPreview(); await privateMutation(() => clearPrivateProjectCache()).catch(error => toast(error.message)); project = null; offlineProjectOpen = false; projectEntries.clear(); remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = null; updateRemoteState(); render(); refreshOfflineProjectEntry(); toast('Загруженный проект очищен с этого устройства.');
}
async function createRemoteProject() {
  const name = $('#new-project-name').value.trim(); if (!name) return toast('Введите название проекта.');
  try { const created = await remote.createProject(name); $('#new-project-name').value = ''; await openProject(created.id); await refreshProjects(); }
  catch (error) { toast(error.message); }
}
async function migrateLegacy() {
  if (!sessionActive) return toast('Сначала войдите.');
  const old = await loadSet(); if (!old?.songs?.length) return toast('В локальном наборе пока нет песен для переноса.');
  if (!confirm(`Перенести ${old.songs.length} песен в новый серверный проект? Локальные оригиналы останутся на устройстве.`)) return;
  cancelRecognition(); const workspaceRun = workspaceGeneration; const sessionAtStart = sessionActive;
  try {
    const uploadOriginals = $('#migration-audio').checked; migrationKey ||= `v1-${old.id}`; const existing = await remote.findMigration(migrationKey); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; if (existing?.id) { adoptProject(existing); $('#projects-dialog').close(); toast('Этот локальный набор уже перенесён.'); return; } const songs = [];
    for (const song of old.songs) { let audioId; if (uploadOriginals) { const file = await getAudio(song.id); if (file) { const uploaded = await remote.uploadAudio(new File([file], song.source?.fileName || 'recording.mp3', { type: file.type })); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; audioId = uploaded.id; } } let backingAudioId;
      if (uploadOriginals && song.backing?.fileName) {
        const backing = await getBacking(song.id);
        if (backing) {
          const uploaded = await remote.uploadAudio(new File([backing], song.backing.fileName, { type: backing.type }));
          if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return;
          backingAudioId = uploaded.id;
        }
      }
      songs.push({ song, audioId, backingAudioId }); }
    const imported = await remote.importLegacy({ migrationKey, name: old.name || 'Перенесённый набор', songs }); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; adoptProject(imported); $('#projects-dialog').close(); toast('Локальный набор перенесён. Он сохранён на устройстве без изменений.');
  } catch (error) { if (workspaceGeneration === workspaceRun && sessionActive === sessionAtStart) toast(error.message); }
}

$('#add-song').addEventListener('click', addSong); $('#add-library-song').addEventListener('click', showLibrary); $('#prepare-offline').addEventListener('click', prepareOfflineProject); $('#offline-projects').addEventListener('click', showOfflineProjects); $('#event-offline-projects').addEventListener('click', () => { $('#event-menu').close(); showOfflineProjects(); }); $('#export-set').addEventListener('click', downloadSet); $('#import-set').addEventListener('click', () => $('#set-file').click()); $('#set-file').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ''; }); els.setName.addEventListener('change', () => { set = { ...set, name: els.setName.value.trim() || 'Мой набор' }; if (project) markRemoteDirty(); else persist(); }); $('#exit-event').addEventListener('click', exitEvent); $('#event-start').addEventListener('click', startEvent); $('#event-reset').addEventListener('click', resetEvent); $('#fullscreen').addEventListener('click', toggleFullscreen); $('#font-up').addEventListener('click', () => changeAudienceFont(4)); $('#font-down').addEventListener('click', () => changeAudienceFont(-4));
$('#projects').addEventListener('click', showProjects);
$('#event-menu-toggle').addEventListener('click', showEventMenu);
$('#event-menu-close').addEventListener('click', () => $('#event-menu').close());
$('#event-menu').addEventListener('close', () => { $('#event-menu-toggle').setAttribute('aria-expanded', 'false'); if (!els.event.hidden) $('#event-menu-toggle').focus(); });
document.addEventListener('pointerdown', event => {
  const menu = $('#event-menu');
  if (menu.open && !menu.contains(event.target) && !$('#event-menu-toggle').contains(event.target)) menu.close();
});
$('#event-projects').addEventListener('click', () => { if (!sessionActive) return; $('#event-menu').close(); showProjects(); });
$('#projects-dialog').addEventListener('close', () => document.body.append($('#projects-dialog')));
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
els.save.addEventListener('click', saveRemoteProject); els.login.addEventListener('click', () => $('#login-dialog').showModal()); els.logout.addEventListener('click', signOut); $('#login-form').addEventListener('submit', event => { event.preventDefault(); signIn(); }); $('#create-project').addEventListener('click', createRemoteProject); $('#migrate-legacy').addEventListener('click', migrateLegacy); $('#library-search').addEventListener('input', () => searchLibrary());
els.clearDownloaded.addEventListener('click', clearDownloadedProjectData);

try { const stored = await loadSet(); if (stored) { set = stored; legacySet = stored; selectedId = null; } } catch (error) { toast(`Не удалось открыть сохранённый набор: ${error.message}`); }
updateSessionUi(); render(); initOffline();
try { if (localStorage.getItem('lyrics-v2-pending-logout')) { await privateMutation(() => clearPrivateProjectCache()); try { await remote.session(); await remote.logout(); localStorage.removeItem('lyrics-v2-pending-logout'); } catch (error) { if (error.status === 401) localStorage.removeItem('lyrics-v2-pending-logout'); } } else { await remote.session(); sessionActive = true; } } catch {} updateSessionUi(); render(); refreshOfflineProjectEntry();

window.addEventListener('resize', () => { if (!els.event.hidden) { centerAudience(eventState.lastIndex ?? -1); positionEventMenu(); } });
els.setName.addEventListener('input', updateSetNameMarquee);
window.addEventListener('resize', updateSetNameMarquee);
window.addEventListener('online', () => lrclibState?.paint());
window.addEventListener('offline', () => lrclibState?.paint());

document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || els.prep.hidden || $('#confirm-dialog').open) return;
  if (event.target.closest('input,textarea,select,button,[contenteditable]')) return;
  const tap = [...els.editor.querySelectorAll('button')].find(button => button.textContent === 'Отметить следующую');
  if (tap) { event.preventDefault(); tap.click(); }
});
