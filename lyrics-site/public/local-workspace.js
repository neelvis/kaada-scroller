import { normalizeSet } from './core.js';
import { createWorkspace, supportsWorkspaceFiles } from './workspace-files.js';
import * as legacy from './storage.js';

let workspace = null;
let workspaceHandle = null;
let pending = new Map();
let active = { schemaVersion: 1, library: [], projects: [], links: {} };
let chain = Promise.resolve();
let changed = () => {};
let pendingSaves = 0;
let failedSave = null;
export const localState = () => active;
export const connectedWorkspace = () => workspace;
export const filesSupported = supportsWorkspaceFiles;
export function onWorkspaceStatus(callback) { changed = callback; }
export async function connectWorkspace(handle) {
  await chain;
  const same = workspaceHandle && (handle === workspaceHandle || (typeof handle.isSameEntry === 'function' && await handle.isSameEntry(workspaceHandle)));
  if (workspace && !same && (pending.size || failedSave)) throw new Error('Есть несохранённые данные. Подключите прежнюю папку и повторите сохранение перед сменой папки.');
  const retainedPending = pending, retainedFailure = failedSave;
  const next = createWorkspace(handle);
  const loaded = await next.load();
  const parsedLibrary = normalizeSet({ schemaVersion: 1, id: 'library', name: 'Library', songs: loaded.library });
  loaded.library = parsedLibrary.songs;
  loaded.projects = loaded.projects.map(project => normalizeSet(project));
  workspace = next; workspaceHandle = handle; active = loaded; pending = same ? retainedPending : new Map(); failedSave = same ? retainedFailure : null;
  changed(failedSave ? 'Не сохранено: доступ восстановлен. Повторите сохранение.' : next.recovered ? 'Восстановлена предыдущая целая версия' : 'Сохранено');
  return active;
}
export function saveWorkspace(next = active, audio = new Map()) {
  if (!workspace) return Promise.reject(new Error('Выберите рабочую папку для сохранения файлов.'));
  const target = workspace;
  const previous = active;
  const snapshot = structuredClone(next);
  const captured = new Map([...pending, ...audio]);
  active = snapshot; pendingSaves++; changed('Сохранение…');
  const run = async () => {
    try {
      await target.save(snapshot, { audio: captured });
      for (const [id, blob] of captured) if (pending.get(id) === blob) pending.delete(id);
      failedSave = null; pendingSaves--; changed(pendingSaves ? 'Сохранение…' : 'Сохранено');
    } catch (error) { failedSave = { snapshot, audio: captured }; pendingSaves--; if (active === snapshot) active = previous; changed(`Не сохранено: ${error.message}`); throw error; }
  };
  const result = chain.then(run, run); chain = result.catch(() => {}); return result;
}
export async function readLocalMedia(id, kind = 'backing') {
  const key = `${kind}:${id}`;
  if (pending.has(key)) return pending.get(key);
  if (workspace) return workspace.readAudio(key);
  return kind === 'backing' ? legacy.getBacking(id) : legacy.getAudio(id);
}
export async function stageLocalMedia(id, blob, kind = 'backing') {
  if (!workspace) throw new Error('Сначала выберите рабочую папку.');
  pending.set(`${kind}:${id}`, blob);
}
export const getBacking = id => readLocalMedia(id);
export const getAudio = id => readLocalMedia(id, 'original');
export const putBacking = (id, blob) => stageLocalMedia(id, blob);
export const putAudio = (id, blob) => stageLocalMedia(id, blob, 'original');
// Old audio remains in immutable snapshots so pinned project versions stay readable.
export const deleteAudio = async () => {};
export const deleteBacking = async () => {};
export async function duplicateSong(song) {
  const copy = structuredClone(song); copy.id = `song-${crypto.randomUUID()}`;
  for (const kind of ['backing', 'original']) {
    const blob = await readLocalMedia(song.id, kind);
    if (blob) await stageLocalMedia(copy.id, blob, kind);
  }
  return copy;
}

export async function rememberDirectory(handle) {
  const db = await directoryDatabase();
  try { await new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite'); tx.objectStore('handles').put(handle, 'workspace');
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function rememberedDirectory() {
  const db = await directoryDatabase();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('handles').objectStore('handles').get('workspace');
    request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
function directoryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('kaada-workspace-handles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

export async function retryWorkspaceSave() { if (!failedSave) return; const attempt = failedSave; return saveWorkspace(attempt.snapshot, attempt.audio); }
