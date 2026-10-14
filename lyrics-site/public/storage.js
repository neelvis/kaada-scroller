import { exportSet, importSet } from './core.js';
import { portableLimits } from './portable.js';

const DB_NAME = 'kaada-lyrics-v1';
const DB_VERSION = 2;
const SET_STORE = 'sets';
const AUDIO_STORE = 'audio';
const BACKING_STORE = 'backing-audio';
const SET_KEY = 'active-set';

function unavailable() {
  return new Error('Локальное хранилище браузера недоступно.');
}

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    let request;
    try { request = globalThis.indexedDB.open(DB_NAME, DB_VERSION); } catch (error) { reject(error); return; }
    request.onerror = () => reject(request.error || new Error('Не удалось открыть локальное хранилище.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SET_STORE)) db.createObjectStore(SET_STORE);
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
      if (!db.objectStoreNames.contains(BACKING_STORE)) db.createObjectStore(BACKING_STORE);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function transaction(db, storeName, mode, run) {
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(storeName, mode); } catch (error) { reject(error); return; }
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Не удалось сохранить локальные данные.'));
    tx.onabort = () => reject(tx.error || new Error('Операция с локальными данными отменена.'));
    try { result = run(tx.objectStore(storeName)); } catch (error) { try { tx.abort(); } catch {} reject(error); }
  });
}

async function withDb(callback) {
  const db = await openDatabase();
  try { return await callback(db); } finally { db.close(); }
}

export async function loadSet() {
  return withDb(async (db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SET_STORE, 'readonly');
    const request = tx.objectStore(SET_STORE).get(SET_KEY);
    request.onsuccess = () => {
      try { resolve(request.result === undefined ? null : importSet(JSON.stringify(request.result))); }
      catch (error) { reject(error); }
    };
    request.onerror = () => reject(request.error || new Error('Не удалось прочитать набор песен.'));
  }));
}

export async function saveSet(set) {
  // Validate and clone before opening a write transaction: a bad write cannot alter prior data.
  const clean = importSet(exportSet(set));
  return withDb((db) => transaction(db, SET_STORE, 'readwrite', (store) => store.put(clean, SET_KEY)));
}

/** Replace the set and its backing audio together; originals are excluded from portable imports. */
export async function replaceStoredSet(set, backingAudio = new Map()) {
  const clean = importSet(exportSet(set));
  if (!(backingAudio instanceof Map)) throw new Error('Минусовки должны быть переданы как Map.');
  const audio = new Map(backingAudio);
  const songIds = new Set(clean.songs.map(song => song.id));
  let total = 0;
  for (const [songId, blob] of audio) {
    if (!songIds.has(songId)) throw new Error('Минусовка не принадлежит импортируемому набору.');
    if (!globalThis.Blob || !(blob instanceof globalThis.Blob) || !blob.size) throw new Error('Минусовка должна быть непустым Blob.');
    if (blob.size > portableLimits.track) throw new Error('Минусовка больше 150 МиБ.');
    total += blob.size;
    if (total > portableLimits.archive) throw new Error('Минусовки занимают больше 1 ГиБ.');
  }
  return withDb(db => new Promise((resolve, reject) => {
    const tx = db.transaction([SET_STORE, AUDIO_STORE, BACKING_STORE], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Не удалось импортировать набор.'));
    tx.onabort = () => reject(tx.error || new Error('Импорт отменён.'));
    try {
      tx.objectStore(SET_STORE).put(clean, SET_KEY);
      tx.objectStore(AUDIO_STORE).clear();
      const backing = tx.objectStore(BACKING_STORE);
      backing.clear();
      for (const [songId, blob] of audio) backing.put(blob, songId);
    } catch (error) {
      try { tx.abort(); } catch {}
      reject(error);
    }
  }));
}

export async function putAudio(songId, blob, storeName = AUDIO_STORE) {
  if (typeof songId !== 'string' || !songId) throw new Error('Нужен id песни для аудиофайла.');
  if (!globalThis.Blob || !(blob instanceof globalThis.Blob)) throw new Error('Аудиофайл должен быть Blob.');
  return withDb((db) => transaction(db, storeName, 'readwrite', (store) => store.put(blob, songId)));
}

export async function getAudio(songId, storeName = AUDIO_STORE) {
  if (typeof songId !== 'string' || !songId) throw new Error('Нужен id песни для аудиофайла.');
  return withDb(async (db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(songId);
    request.onsuccess = () => resolve(request.result === undefined ? null : request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось прочитать аудиофайл.'));
  }));
}

export async function deleteAudio(songId, storeName = AUDIO_STORE) {
  if (typeof songId !== 'string' || !songId) throw new Error('Нужен id песни для аудиофайла.');
  return withDb((db) => transaction(db, storeName, 'readwrite', (store) => store.delete(songId)));
}

export const putBacking = (songId, blob) => putAudio(songId, blob, BACKING_STORE);
export const getBacking = songId => getAudio(songId, BACKING_STORE);
export const deleteBacking = songId => deleteAudio(songId, BACKING_STORE);

export function resetLyrics() {
  if (!globalThis.indexedDB) return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Не удалось очистить данные текстов.'));
    request.onblocked = () => reject(new Error('Закройте другие вкладки с текстами и повторите очистку.'));
  });
}

export const lyricsStorageName = DB_NAME;
