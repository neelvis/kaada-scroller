import { createSong, cueAt, exportSet, formatTime, importSet, invalidateReview, parseLrc, parseTime, validateSong } from './core.js';
import { deleteAudio, getAudio, loadSet, putAudio, replaceStoredSet, saveSet } from './storage.js';
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
let privateMutationChain = Promise.resolve();
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
  if (!project) { els.remote.textContent = legacySet.songs.length ? 'Локальный набор — перенесите на сервер' : 'Создайте серверный проект'; els.save.hidden = true; return; }
  els.save.hidden = false;
  els.remote.textContent = remoteFailed ? 'Сохранение не удалось — черновик сохранён' : remoteDirty ? 'Есть несохранённые изменения' : 'Сохранено на сервере';
  els.save.disabled = !remoteDirty || !sessionActive || offlineProjectOpen;
}
function persist() { const snapshot = JSON.parse(exportSet(set)); legacySet = snapshot; persistChain = persistChain.then(() => saveSet(snapshot)).catch((error) => toast(`Не удалось сохранить: ${error.message}`)); }
function invalidateChanged(song, changes) { return invalidateReview({ ...song, ...changes }); }
function clearAudioPreview() {
  audioGeneration += 1;
  previewPlayer.pause(); previewPlayer.removeAttribute('src'); previewPlayer.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null; audioSongId = null;
}
function cancelRecognition() { workspaceGeneration += 1; for (const job of recognition.values()) job.controller?.abort(); recognition.clear(); }
function entryFor(song) { return projectEntries.get(song.id) || {}; }
function projectPayload() {
  return {
    revision: project.revision, name: set.name || project.name,
    songs: set.songs.map(song => ({ ...entryFor(song), song: structuredClone(song) })),
  };
}
function adoptProject(next) {
  project = next;
  projectEntries = new Map((next.songs || []).map(entry => [entry.song.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId }]));
  set = { schemaVersion: 1, id: next.id, name: next.name, songs: (next.songs || []).map(entry => entry.song) };
  selectedId = set.songs[0]?.id || null;
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
    projectEntries.set(current.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId });
  });
}
async function saveRemoteProject() {
  if (!project || !sessionActive || !remoteDirty) return;
  const generation = editGeneration; const savingProjectId = project.id; const draft = projectPayload();
  try { const saved = await remote.saveProject(savingProjectId, draft); if (!sessionActive || project?.id !== savingProjectId) return; if (generation !== editGeneration) { rebaseSavedProjectMetadata(saved, draft); remoteDirty = true; await privateMutation(() => saveDraft(project, projectPayload())); updateRemoteState(); toast('Сервер сохранил предыдущую версию. Новые правки остались в черновике.'); return; } await privateMutation(() => removeDraft(savingProjectId)); adoptProject(saved); toast('Проект сохранён на сервере.'); }
  catch (error) { if (!sessionActive || project?.id !== savingProjectId) return; remoteFailed = true; updateRemoteState(); if (error.code === 'conflict') toast('На сервере есть более новая версия. Черновик оставлен; откройте проект заново или сохраните после сверки.'); else toast(error.message); }
}
async function openProject(id, { cached = false } = {}) {
  if (cached && localStorage.getItem('lyrics-v2-pending-logout')) return toast('Сначала завершите очистку данных выхода: откройте приложение заново.');
  if (remoteDirty && !confirm('Есть несохранённые изменения. Открыть другой проект без сохранения?')) return;
  cancelRecognition(); const workspaceRun = workspaceGeneration; const sessionAtStart = sessionActive; clearAudioPreview();
  try { const next = cached ? await openCachedProject(id) : await remote.getProject(id); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; if (!next) throw new Error('Подготовленный снимок не найден.'); offlineProjectOpen = cached; adoptProject(next); if (!cached) { const draft = await getDraft(id); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; if (draft && confirm('Для этого проекта есть несохранённый черновик на этом устройстве. Открыть его?')) { project = draft.project; projectEntries = new Map(draft.payload.songs.map(entry => [entry.song.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId }])); set = { ...set, name: draft.payload.name, songs: draft.payload.songs.map(entry => entry.song) }; selectedId = set.songs[0]?.id || null; remoteDirty = true; updateRemoteState(); render(); } } $('#projects-dialog').close(); toast(cached ? 'Открыт подготовленный автономный снимок.' : 'Проект открыт.'); }
  catch (error) { toast(error.message); }
}
async function refreshProjects() {
  const workspaceRun = workspaceGeneration; const sessionAtStart = sessionActive;
  const list = $('#project-list'); list.replaceChildren(node('p', { className: 'hint', text: 'Загрузка…' }));
  try {
    const [result, cached] = await Promise.all([sessionActive ? remote.listProjects() : Promise.resolve({ projects: [] }), localStorage.getItem('lyrics-v2-pending-logout') ? Promise.resolve([]) : preparedProjects()]);
    if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return;
    list.replaceChildren();
    for (const item of result.projects || []) { const actions = node('span', { className: 'action-row' }, [button('Открыть', 'button quiet', () => openProject(item.id)), button('×', 'button danger', async () => { if (!confirm(`Удалить проект «${item.name}»? Песни останутся в библиотеке.`)) return; try { await remote.deleteProject(item.id, item.revision); if (project?.id === item.id) { project = null; projectEntries.clear(); remoteDirty = false; offlineProjectOpen = false; set = legacySet; selectedId = set.songs[0]?.id || null; updateRemoteState(); } await refreshProjects(); render(); } catch (error) { toast(error.code === 'conflict' ? 'Проект изменился на сервере. Обновите список и повторите.' : error.message); } })]); list.append(node('div', { className: 'project-row' }, [node('span', { text: `${item.name} · ${item.songCount} ${plural(item.songCount, 'песня', 'песни', 'песен')}` }), actions])); }
    for (const item of cached) list.append(node('div', { className: 'project-row cached' }, [node('span', { text: `${item.name} · подготовлен для показа` }), button('Открыть без сети', 'button quiet', () => openProject(item.id, { cached: true }))]));
    if (!list.children.length) list.append(node('p', { className: 'hint', text: sessionActive ? 'Проектов пока нет.' : 'Войдите, чтобы открыть проекты, или подготовьте проект на этом устройстве.' }));
  } catch (error) { list.replaceChildren(node('p', { className: 'hint', text: error.message })); }
}
async function prepareOfflineProject() {
  if (!project || remoteDirty) { toast('Сначала сохраните проект, затем подготовьте снимок для показа.'); return; }
  if (!set.songs.length || set.songs.some(song => validateSong(song).length)) { toast('Сначала проверьте и подтвердите все песни проекта.'); return; }
  const workspaceRun = workspaceGeneration; const projectId = project.id; const sessionAtStart = sessionActive;
  try { await verifyOfflineShell(); if (workspaceGeneration !== workspaceRun || (project?.id || null) !== projectId || sessionActive !== sessionAtStart) return; await privateMutation(() => cacheProject(project)); if (workspaceGeneration !== workspaceRun || (project?.id || null) !== projectId || sessionActive !== sessionAtStart) { await privateMutation(() => removePreparedProject(projectId)); return; } toast('Снимок проекта подготовлен для автономного показа.'); }
  catch (error) { toast(`Не удалось подготовить снимок: ${error.message}`); }
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
  try { const result = await remote.listLibrary($('#library-search').value.trim()); list.replaceChildren(...(result.songs || []).map(item => node('div', { className: 'project-row' }, [node('span', { text: `${item.title || 'Без названия'}${item.artist ? ` — ${item.artist}` : ''}` }), button('Добавить', 'button quiet', async () => { const entry = await remote.getSong(item.id); if (set.songs.some(song => song.id === entry.song.id)) return toast('Эта версия уже есть в проекте.'); set = { ...set, songs: [...set.songs, entry.song] }; projectEntries.set(entry.song.id, { songId: entry.songId, revisionId: entry.revisionId, audioId: entry.audioId }); selectedId = entry.song.id; markRemoteDirty(); render(); $('#library-dialog').close(); })]))); if (!list.children.length) list.append(node('p', { className: 'hint', text: 'Ничего не найдено.' })); }
  catch (error) { list.replaceChildren(node('p', { className: 'hint', text: error.message })); }
}
async function adoptLatest(song) {
  const current = entryFor(song); if (!current.songId || !sessionActive || offlineProjectOpen) return;
  if (!confirm('Применить последнюю версию из библиотеки к этому проекту? Текущий закреплённый таймлайн сменится только здесь.')) return;
  try { const latest = await remote.getSong(current.songId); set = { ...set, songs: set.songs.map(item => item.id === song.id ? latest.song : item) }; projectEntries.delete(song.id); projectEntries.set(latest.song.id, { songId: latest.songId, revisionId: latest.revisionId, audioId: latest.audioId }); selectedId = latest.song.id; markRemoteDirty(); render(); } catch (error) { toast(error.message); }
}
async function deleteSharedSong(song) {
  const current = entryFor(song); if (!current.songId || !sessionActive) return;
  if (!confirm('Удалить эту песню из общей библиотеки? Сервер откажет, если она используется в проектах.')) return;
  try { await remote.deleteSong(current.songId); toast('Песня удалена из общей библиотеки.'); } catch (error) { toast(error.code === 'conflict' ? 'Нельзя удалить: песня ещё используется в проекте.' : error.message); }
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
    const select = node('button', { type: 'button', className: 'song-select', onclick: () => { selectedId = song.id; render(); } }, [
      node('span', { className: `song-dot${ready ? ' ready' : ''}`, 'aria-hidden': true }),
      node('span', { className: 'song-item-copy' }, [node('span', { className: 'song-item-title', text: song.title || 'Без названия' }), node('span', { className: 'song-item-status', text: status(song) })])
    ]);
    const move = (direction) => { const target = index + direction; if (target < 0 || target >= set.songs.length) return; const songs = [...set.songs]; [songs[index], songs[target]] = [songs[target], songs[index]]; set = { ...set, songs }; if (project) markRemoteDirty(); else persist(); render(); };
    const up = button('↑', 'song-reorder', () => move(-1)); up.disabled = index === 0; up.setAttribute('aria-label', 'Переместить песню выше');
    const down = button('↓', 'song-reorder', () => move(1)); down.disabled = index === set.songs.length - 1; down.setAttribute('aria-label', 'Переместить песню ниже');
    els.list.append(node('div', { className: `song-item${song.id === selectedId ? ' active' : ''}` }, [select, node('div', { className: 'song-reorder-wrap' }, [up, down])]));
  });
}
function plural(value, one, few, many) { const n = Math.abs(value) % 100, m = n % 10; return n > 10 && n < 20 ? many : m > 1 && m < 5 ? few : m === 1 ? one : many; }
function field(labelText, control) { return node('div', { className: 'field' }, [node('label', { text: labelText }, [control])]); }
function input(value, type = 'text', attrs = {}) { const el = node('input', { type, ...attrs }); el.value = value ?? ''; return el; }

function renderEditor() {
  const song = currentSong(); els.editor.replaceChildren();
  if (!song) { clearAudioPreview(); const template = $('#empty-state'); const copy = template.content.cloneNode(true); const title = $('[data-empty-title]', copy), copyText = $('[data-empty-copy]', copy); const add = $('[data-add-song]', copy); if (project) { title.textContent = 'Добавьте песню в проект'; copyText.textContent = 'Песня будет сохранена в проекте после нажатия «Сохранить». '; add.hidden = false; add.addEventListener('click', addSong); } else if (legacySet.songs.length) { title.textContent = 'Локальный набор'; copyText.textContent = 'Этот набор остался на устройстве. Перенесите его в серверный проект, когда будете готовы.'; $('[data-empty-project]', copy).hidden = false; $('[data-empty-project]', copy).addEventListener('click', () => $('#projects').click()); } else { title.textContent = 'Создайте общий проект'; copyText.textContent = 'Войдите организатором, создайте проект и добавляйте песни, доступные с других устройств.'; $('[data-empty-login]', copy).hidden = false; $('[data-empty-login]', copy).addEventListener('click', () => $('#login').click()); } els.editor.append(copy); return; }
  const validation = validateSong(song);
  const title = input(song.title, 'text', { required: true, autocomplete: 'off' });
  title.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { title: title.value })); render(); });
  const artist = input(song.artist, 'text', { autocomplete: 'off' }); artist.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { artist: artist.value })); render(); });
  const version = input(song.version, 'text', { placeholder: 'Например, студийная версия' }); version.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { version: version.value })); render(); });
  const language = node('select'); [['ru','Русский'],['en','English']].forEach(([value, text]) => language.append(node('option', { value, text }))); language.value = song.language || 'ru'; language.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { language: language.value })); render(); });
  const duration = input(song.duration || '', 'number', { min: 0, step: '.01', placeholder: 'сек.' }); duration.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { duration: Number(duration.value) || 0 })); render(); });
  const delay = input(song.delayMs || '', 'number', { step: 50, placeholder: 'мс' }); delay.addEventListener('change', () => { changeSong(song.id, s => invalidateChanged(s, { delayMs: Number(delay.value) || 0 })); render(); });
  const header = node('div', { className: 'editor-header' }, [node('div', {}, [node('h1', { className: 'editor-title', text: song.title || 'Новая песня' }), node('p', { className: 'editor-subtitle', text: 'Подготовка таймлайна для отдельного запуска минусовки' })]), node('span', { className: `status-pill${song.reviewed && !validation.length ? ' ready' : ''}`, text: status(song) })]);
  const details = node('section', { className: 'section-card' }, [node('h2', { text: 'О песне' }), node('div', { className: 'field-grid' }, [field('Название', title), field('Исполнитель', artist), field('Язык', language), field('Версия записи', version), field('Длительность, секунды', duration), field('Общая задержка, мс', delay)])]);
  els.editor.append(header, details, renderAudioCard(song), renderImportCard(song), renderCues(song, validation), renderReview(song, validation), renderSongActions(song)); setAudioPreview(song);
}

function renderAudioCard(song) {
  const file = node('input', { type: 'file', accept: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav', hidden: true });
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
function renderImportCard(song) {
  const lrc = node('textarea', { placeholder: '[00:12.50] Первая строка\n[00:18.10] Вторая строка' });
  const plain = node('textarea', { placeholder: 'Первая строка\nВторая строка\nПрипев' });
  const loadLrc = button('Заменить из LRC', 'button quiet', async () => { try { const parsed = parseLrc(lrc.value); if (!parsed.cues.length) throw new Error('В LRC не найдено строк с таймкодами.'); await replaceCues(song, parsed.cues, {}, 'Импорт LRC заменит текущий текст и таймлайн.'); } catch (error) { toast(error.message); } });
  const loadPlain = button('Вставить строки', 'button quiet', () => { const cues = plain.value.split(/\r?\n/).filter(Boolean).map((text, i) => ({ id: `paste-${Date.now()}-${i}`, start: null, text, type: 'lyric' })); if (cues.length) replaceCues(song, cues, {}, 'Вставка текста заменит текущие строки.'); else toast('Добавьте хотя бы одну строку.'); });
  return node('section', { className: 'section-card' }, [node('h2', { text: 'Текст и таймкоды' }), node('p', { className: 'hint', text: 'Вставьте готовый LRC или обычный текст. Все повторения припева добавляйте отдельными строками.' }), node('div', { className: 'import-grid' }, [node('div', {}, [field('LRC с таймкодами', lrc), loadLrc]), node('div', {}, [field('Обычный текст', plain), loadPlain])])]);
}
async function replaceCues(song, cues, details, question, isCurrent = () => true) {
  if (song.cues.length && !(await confirmReplace(question))) return;
  if (!isCurrent()) return;
  tapHistory.delete(song.id);
  changeSong(song.id, s => invalidateChanged(s, { ...details, cues: cues.map((cue, i) => ({ id: cue.id || `cue-${Date.now()}-${i}`, start: Number.isFinite(cue.start) ? cue.start : null, text: String(cue.text || ''), type: cue.type === 'rest' ? 'rest' : 'lyric' })) })); render();
}
function confirmReplace(message) { const dialog = $('#confirm-dialog'); $('#confirm-text').textContent = message; return new Promise((resolve) => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); }); }
function renderCues(song, validation) {
  const card = node('section', { className: 'section-card' }); const table = node('div', { className: 'cue-table' });
  const addCue = (cue = { id: `cue-${crypto.randomUUID()}`, start: null, text: '', type: 'lyric' }) => { changeSong(song.id, s => invalidateChanged(s, { cues: [...s.cues, cue] })); render(); };
  const tapCue = (index) => { const player = $('#audio-player'); if (!player) { toast('Для отметки включите оригинальную запись.'); return; } const before = currentSong()?.cues[index]?.start ?? null; changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.map((cue, i) => i === index ? { ...cue, start: player.currentTime } : cue) })); const history = tapHistory.get(song.id) || []; history.push({ cueId: song.cues[index].id, before }); tapHistory.set(song.id, history); render(); };
  const tapNext = () => { const index = currentSong()?.cues.findIndex((cue) => cue.start == null) ?? -1; if (index < 0) { toast('Нет неотмеченных строк. Для повторной отметки используйте кнопку часов у строки.'); return; } tapCue(index); };
  const undoTap = () => { const history = tapHistory.get(song.id) || []; const last = history.pop(); if (!last) { toast('Нет последней отметки для отмены.'); return; } tapHistory.set(song.id, history); changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.map((cue) => cue.id === last.cueId ? { ...cue, start: last.before } : cue) })); render(); };
  card.append(node('div', { className: 'cue-toolbar' }, [node('div', {}, [node('h2', { text: 'Строки таймлайна' }), node('p', { className: 'hint', text: 'Время — начало строки. Кнопка «Отметить следующую» или пробел отмечает начало. Отмечайте строки по очереди или переотмечайте конкретную строку кнопкой часов.' })]), node('div', { className: 'action-row' }, [button('+ Строка', 'button quiet', () => addCue()), button('Отметить следующую', 'button quiet', tapNext), button('Отменить отметку', 'button quiet', undoTap)])]));
  song.cues.forEach((cue, index) => { const time = input(cue.start == null ? '' : formatTime(cue.start), 'text', { 'aria-label': `Время строки ${index + 1}` }); const text = input(cue.text, 'text', { 'aria-label': `Текст строки ${index + 1}` }); const type = node('select', { 'aria-label': `Тип строки ${index + 1}` }); type.append(node('option', { value: 'lyric', text: 'Текст' }), node('option', { value: 'rest', text: 'Пауза' })); type.value = cue.type;
    const update = () => { const start = parseTime(time.value); changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.map((item, i) => i === index ? { ...item, start, text: text.value, type: type.value } : item) })); render(); }; time.addEventListener('change', update); text.addEventListener('change', update); type.addEventListener('change', update);
    const retap = button('◷', 'button quiet', () => tapCue(index)); retap.setAttribute('aria-label', `Отметить строку ${index + 1} по текущему времени записи`);
    const remove = button('×', 'button quiet', () => { changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.filter((_, i) => i !== index) })); render(); }); remove.setAttribute('aria-label', `Удалить строку ${index + 1}`); table.append(node('div', { className: `cue-row${cue.type === 'rest' ? ' rest' : ''}` }, [time, text, type, retap, remove]));
  }); card.append(table);
  if (validation.length) card.append(node('ul', { className: 'validation' }, validation.map((message) => node('li', { text: message })))); return card;
}
function renderReview(song, validation) { const card = node('section', { className: 'review-row' }); card.append(node('p', { text: song.reviewed ? 'Таймлайн был подтверждён, но последующие изменения отменяют подтверждение.' : 'Прослушайте запись, проверьте каждую строку и только затем отметьте песню готовой.' })); const confirm = button('Подтвердить готовность', 'button primary', () => { const trial = { ...song, reviewed: true }; const errors = validateSong(trial); if (errors.length) { toast('Сначала исправьте ошибки в таймлайне.'); return; } changeSong(song.id, () => trial); render(); }); confirm.disabled = validation.filter((e) => e !== 'Подтвердите, что таймлайн проверен.').length > 0; card.append(confirm); return card; }
function renderSongActions(song) { const del = button(project ? 'Убрать из проекта' : 'Удалить песню', 'button danger', async () => { if (!confirm(project ? 'Убрать песню только из этого проекта?' : 'Удалить песню и локальную запись?')) return; recognition.get(song.id)?.controller?.abort(); if (!project) await deleteAudio(song.id).catch(() => {}); projectEntries.delete(song.id); set = { ...set, songs: set.songs.filter((s) => s.id !== song.id) }; selectedId = set.songs[0]?.id || null; if (project) markRemoteDirty(); else persist(); render(); }); const controls = [button('Режим показа', 'button primary', () => launchEvent(song)), del]; if (project) { controls.push(button('Библиотека', 'button quiet', showLibrary), button('Обновить версию', 'button quiet', () => adoptLatest(song)), button('Подготовить показ', 'button quiet', prepareOfflineProject)); if (entryFor(song).songId) controls.push(button('Удалить из библиотеки', 'button danger', () => deleteSharedSong(song))); } return node('div', { className: 'action-row' }, controls); }
function render() { renderList(); els.setName.value = set.name || 'Мой набор'; els.setName.disabled = offlineProjectOpen; $('#add-song').disabled = offlineProjectOpen || (!project && !legacySet.songs.length); renderEditor(); if (offlineProjectOpen) { [...els.editor.querySelectorAll('input,textarea,select,button')].forEach(control => { if (control.textContent !== 'Режим показа') control.disabled = true; }); [...els.list.querySelectorAll('button')].forEach(control => control.disabled = true); } }
function addSong() { const song = createSong({ language: 'ru' }); set = { ...set, songs: [...set.songs, song] }; selectedId = song.id; if (project) markRemoteDirty(); else persist(); render(); }

function launchEvent(song) { const errors = validateSong(song); if (errors.length) { toast('Для показа песня должна быть подготовлена и подтверждена.'); return; } previewPlayer.pause(); document.querySelectorAll('.toast').forEach(item => item.remove()); $('.topbar').hidden = true; els.prep.hidden = true; els.event.hidden = false; els.eventName.textContent = song.title; eventState = { song, startedAt: 0, running: false, frame: 0, lastIndex: null }; buildAudience(); renderAudience(-1, false); }
function buildAudience() {
  els.audienceLines.replaceChildren(...eventState.song.cues.map(cue => node('div', {
    className: `audience-line${cue.type === 'rest' ? ' rest' : ''}`,
    text: cue.type === 'rest' ? `— ${cue.text} —` : cue.text,
  })));
}
function centerAudience(index) {
  const line = els.audienceLines.children[Math.max(0, index)];
  if (line) els.audienceLines.style.transform = `translateY(-${line.offsetTop + line.offsetHeight / 2}px)`;
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

function tick() { if (!eventState.running) return; const current = cueAt(eventState.song, (performance.now() - eventState.startedAt) / 1000); if (current.index !== eventState.lastIndex || current.ended) { eventState.lastIndex = current.index; renderAudience(current.index, current.ended); } if (!current.ended) eventState.frame = requestAnimationFrame(tick); else eventState.running = false; }
function startEvent() { if (eventState.running) return; eventState.running = true; eventState.startedAt = performance.now(); eventState.lastIndex = null; tick(); }
function resetEvent() { eventState.running = false; cancelAnimationFrame(eventState.frame); eventState.lastIndex = null; renderAudience(-1, false); }
function downloadSet() { const blob = new Blob([exportSet(set)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = node('a', { href: url, download: `${(set.name || 'lyrics-set').replace(/[^\wа-яё-]+/gi, '-').toLowerCase()}.json` }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }
async function importFile(file) { if (importing) { toast('Дождитесь завершения импорта.'); return; } if (project && !confirm('Импорт заменит только локальный набор. Текущий серверный проект останется без изменений и будет закрыт. Продолжить?')) return; importing = true; els.prep.inert = true; $('#import-set').disabled = true; $('#export-set').disabled = true; $('#set-file').disabled = true; try { const imported = importSet(await file.text()); cancelRecognition(); await persistChain; await replaceStoredSet(imported); tapHistory.clear(); clearAudioPreview(); legacySet = imported; set = imported; project = null; projectEntries.clear(); remoteDirty = false; selectedId = set.songs[0]?.id || null; updateRemoteState(); render(); toast('Набор импортирован. Аудиозаписи при необходимости выберите заново.'); } catch (error) { toast(error.message); } finally { importing = false; els.prep.inert = false; $('#import-set').disabled = false; $('#export-set').disabled = false; $('#set-file').disabled = false; } }
function initOffline() { if (!('serviceWorker' in navigator)) { els.offline.textContent = 'Автономный режим недоступен'; return; } navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}); navigator.serviceWorker.addEventListener('message', ({ data }) => { if (data?.type === 'OFFLINE_READY') els.offline.textContent = data.ready ? 'Готово для автономной работы' : 'Автономный режим ещё готовится'; }); navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: 'CHECK_OFFLINE' })).catch(() => { els.offline.textContent = 'Автономный режим ещё готовится'; }); }
function updateSessionUi() { els.login.hidden = sessionActive; els.logout.hidden = !sessionActive; updateRemoteState(); }
async function signIn() {
  const password = $('#login-password').value; const error = $('#login-error'); error.hidden = true;
  try { if (localStorage.getItem('lyrics-v2-pending-logout')) { await privateMutation(() => clearPrivateProjectCache()); try { await remote.session(); await remote.logout(); } catch (problem) { if (problem.status !== 401) throw problem; } localStorage.removeItem('lyrics-v2-pending-logout'); } await remote.login(password); sessionActive = true; $('#login-dialog').close(); $('#login-password').value = ''; updateSessionUi(); toast('Вход выполнен.'); }
  catch (problem) { error.textContent = problem.message; error.hidden = false; }
}
async function signOut() {
  cancelRecognition(); clearAudioPreview();
  localStorage.setItem('lyrics-v2-pending-logout', '1');
  sessionActive = false; project = null; offlineProjectOpen = false; projectEntries.clear(); remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = set.songs[0]?.id || null; updateSessionUi(); render(); els.login.disabled = true;
  let cleared = true; await privateMutation(() => clearPrivateProjectCache()).catch(() => { cleared = false; });
  let revoked = true; try { await remote.logout(); if (cleared) localStorage.removeItem('lyrics-v2-pending-logout'); } catch { revoked = false; }
  els.login.disabled = false;
  toast(!cleared ? 'Очистка локальных данных не завершилась. Откройте приложение заново, чтобы повторить её.' : revoked ? 'Вы вышли. Локальный набор и его записи не изменены.' : 'Данные на этом устройстве очищены, но сервер пока не подтвердил выход. Подключитесь к сети и откройте приложение ещё раз.');
}
async function clearDownloadedProjectData() {
  if (!offlineProjectOpen || !confirm('Очистить загруженный проект и его черновики с этого устройства?')) return;
  cancelRecognition(); clearAudioPreview(); await privateMutation(() => clearPrivateProjectCache()).catch(error => toast(error.message)); project = null; offlineProjectOpen = false; projectEntries.clear(); remoteDirty = false; remoteFailed = false; set = legacySet; selectedId = set.songs[0]?.id || null; updateRemoteState(); render(); toast('Загруженный проект очищен с этого устройства.');
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
    for (const song of old.songs) { let audioId; if (uploadOriginals) { const file = await getAudio(song.id); if (file) { const uploaded = await remote.uploadAudio(new File([file], song.source?.fileName || 'recording.mp3', { type: file.type })); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; audioId = uploaded.id; } } songs.push({ song, audioId }); }
    const imported = await remote.importLegacy({ migrationKey, name: old.name || 'Перенесённый набор', songs }); if (workspaceGeneration !== workspaceRun || sessionActive !== sessionAtStart) return; adoptProject(imported); $('#projects-dialog').close(); toast('Локальный набор перенесён. Он сохранён на устройстве без изменений.');
  } catch (error) { if (workspaceGeneration === workspaceRun && sessionActive === sessionAtStart) toast(error.message); }
}

$('#add-song').addEventListener('click', addSong); $('#export-set').addEventListener('click', downloadSet); $('#import-set').addEventListener('click', () => $('#set-file').click()); $('#set-file').addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ''; }); els.setName.addEventListener('change', () => { set = { ...set, name: els.setName.value.trim() || 'Мой набор' }; if (project) markRemoteDirty(); else persist(); }); $('#exit-event').addEventListener('click', () => { resetEvent(); els.event.hidden = true; els.prep.hidden = false; $('.topbar').hidden = false; }); $('#event-start').addEventListener('click', startEvent); $('#event-reset').addEventListener('click', resetEvent); $('#fullscreen').addEventListener('click', () => els.event.requestFullscreen?.()); $('#font-up').addEventListener('click', () => { fontSize = Math.min(100, fontSize + 4); els.audience.style.setProperty('--audience-size', `${fontSize}px`); centerAudience(eventState.lastIndex ?? -1); }); $('#font-down').addEventListener('click', () => { fontSize = Math.max(28, fontSize - 4); els.audience.style.setProperty('--audience-size', `${fontSize}px`); centerAudience(eventState.lastIndex ?? -1); });
$('#projects').addEventListener('click', async () => { $('#projects-dialog').showModal(); await refreshProjects(); });
els.save.addEventListener('click', saveRemoteProject); els.login.addEventListener('click', () => $('#login-dialog').showModal()); els.logout.addEventListener('click', signOut); $('#login-form').addEventListener('submit', event => { event.preventDefault(); signIn(); }); $('#create-project').addEventListener('click', createRemoteProject); $('#migrate-legacy').addEventListener('click', migrateLegacy); $('#library-search').addEventListener('input', () => searchLibrary());
els.clearDownloaded.addEventListener('click', clearDownloadedProjectData);

try { const stored = await loadSet(); if (stored) { set = stored; legacySet = stored; selectedId = set.songs[0]?.id || null; } } catch (error) { toast(`Не удалось открыть сохранённый набор: ${error.message}`); }
try { if (localStorage.getItem('lyrics-v2-pending-logout')) { await privateMutation(() => clearPrivateProjectCache()); try { await remote.session(); await remote.logout(); localStorage.removeItem('lyrics-v2-pending-logout'); } catch (error) { if (error.status === 401) localStorage.removeItem('lyrics-v2-pending-logout'); } } else { await remote.session(); sessionActive = true; } } catch {} updateSessionUi(); render(); initOffline();

window.addEventListener('resize', () => { if (!els.event.hidden) centerAudience(eventState.lastIndex ?? -1); });

document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || els.prep.hidden || $('#confirm-dialog').open) return;
  if (event.target.closest('input,textarea,select,button,[contenteditable]')) return;
  const tap = [...els.editor.querySelectorAll('button')].find(button => button.textContent === 'Отметить следующую');
  if (tap) { event.preventDefault(); tap.click(); }
});
