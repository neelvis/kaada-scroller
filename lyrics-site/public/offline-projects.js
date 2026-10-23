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
// Keep legacy stores available only to clear snapshots written by earlier versions.
export async function removePreparedProject(id) { return withDb(PREPARED, 'readwrite', store => store.delete(id)); }
export async function putPrivateAudio(id, blob) { return withDb(AUDIO, 'readwrite', store => store.put({ id, blob })); }
export async function removePrivateAudio(id) { return withDb(AUDIO, 'readwrite', store => store.delete(id)); }
export async function getPrivateAudio(id) { return (await withDb(AUDIO, 'readonly', store => store.get(id)))?.blob || null; }
export async function removeDraft(id) { return withDb(DRAFTS, 'readwrite', store => store.delete(id)); }
export async function clearPrivateProjectCache() {
  const db = await open();
  try { await Promise.all([PREPARED, AUDIO, DRAFTS].map(name => new Promise((resolve, reject) => { const tx = db.transaction(name, 'readwrite'); tx.objectStore(name).clear(); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }))); } finally { db.close(); }
}
