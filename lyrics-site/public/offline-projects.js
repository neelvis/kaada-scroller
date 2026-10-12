const DB_NAME = 'kaada-lyrics-v2';
const PREPARED = 'prepared-projects';
const AUDIO = 'private-audio';
const DRAFTS = 'remote-drafts';

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { for (const name of [PREPARED, AUDIO, DRAFTS]) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть автономные проекты.'));
  });
}
async function withDb(storeName, mode, operation) {
  const db = await open();
  try { return await new Promise((resolve, reject) => { const tx = db.transaction(storeName, mode); const request = operation(tx.objectStore(storeName)); let result; request.onsuccess = () => { result = request.result; }; request.onerror = () => reject(request.error || new Error('Не удалось сохранить автономные данные.')); tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error || new Error('Не удалось сохранить автономные данные.')); tx.onerror = () => reject(tx.error || new Error('Не удалось сохранить автономные данные.')); }); } finally { db.close(); }
}
export async function preparedProjects() { return (await withDb(PREPARED, 'readonly', store => store.getAll())) || []; }
export async function cacheProject(project, backingAudio = []) {
  const snapshot = structuredClone(project);
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([PREPARED, AUDIO], 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Не удалось сохранить минусовки для показа.'));
      for (const { id, blob } of backingAudio) tx.objectStore(AUDIO).put({ id, blob });
      tx.objectStore(PREPARED).put({ id: snapshot.id, name: snapshot.name, cachedAt: Date.now(), project: snapshot });
    });
  } finally { db.close(); }
}
export async function removePreparedProject(id) { return withDb(PREPARED, 'readwrite', store => store.delete(id)); }
export async function openCachedProject(id) { return (await withDb(PREPARED, 'readonly', store => store.get(id)))?.project || null; }
export async function putPrivateAudio(id, blob) { return withDb(AUDIO, 'readwrite', store => store.put({ id, blob })); }
export async function removePrivateAudio(id) { return withDb(AUDIO, 'readwrite', store => store.delete(id)); }
export async function getPrivateAudio(id) { return (await withDb(AUDIO, 'readonly', store => store.get(id)))?.blob || null; }
export async function saveDraft(project, payload) { return withDb(DRAFTS, 'readwrite', store => store.put({ id: project.id, project: structuredClone(project), payload: structuredClone(payload), savedAt: Date.now() })); }
export async function getDraft(id) { return withDb(DRAFTS, 'readonly', store => store.get(id)); }
export async function removeDraft(id) { return withDb(DRAFTS, 'readwrite', store => store.delete(id)); }
export async function clearPrivateProjectCache() {
  const db = await open();
  try { await Promise.all([PREPARED, AUDIO, DRAFTS].map(name => new Promise((resolve, reject) => { const tx = db.transaction(name, 'readwrite'); tx.objectStore(name).clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }))); } finally { db.close(); }
}
