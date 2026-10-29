const API = './api';
const artworkRefPattern = /^\.\/api\/artwork\/([a-f0-9]{64})$/;
const artworkDataPattern = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/;
const artworkMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class RemoteError extends Error {
  constructor(message, { status = 0, code = '', committed = false, result, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'RemoteError'; this.status = status; this.code = code; this.committed = committed;
    if (committed) this.result = result;
  }
}

export const maxJsonBytes = 5 * 1024 * 1024;
function jsonBody(payload) {
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > maxJsonBytes) {
    throw new RemoteError('Данные для сохранения больше 5 МиБ. Уменьшите объём данных проекта.', { status: 413, code: 'too_large' });
  }
  return body;
}

let csrf = null;

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const write = !['GET', 'HEAD'].includes(method);
  const response = await fetch(`${API}${path}`, {
    method, signal, credentials: 'same-origin', body,
    headers: {
      ...(write ? { 'X-Lyrics-Request': '1' } : {}),
      ...(write && csrf ? { 'X-Lyrics-CSRF': csrf } : {}),
      ...headers,
    },
  }).catch(() => { throw new RemoteError('Нет связи с сервером. Черновик остаётся на этом устройстве.', { code: 'network', status: 0 }); });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : null;
  if (!response.ok) throw new RemoteError(data?.error || 'Сервер не смог выполнить действие.', { status: response.status, code: data?.code || (response.status === 409 ? 'conflict' : '') });
  if (data?.csrf) csrf = data.csrf;
  return data;
}

function cloneJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  const copy = {};
  for (const key of Object.keys(value)) Object.defineProperty(copy, key, { value: cloneJson(value[key]), writable: true, enumerable: true, configurable: true });
  return copy;
}

function setOwn(object, key, value) {
  Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
}

async function visitArtworkCoversAsync(value, visitor) {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) value[index] = await visitArtworkCoversAsync(value[index], visitor);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) setOwn(value, key, key === 'cover' ? await visitor(value[key]) : await visitArtworkCoversAsync(value[key], visitor));
  }
  return value;
}

function withoutArtwork(value) {
  if (Array.isArray(value)) return value.map(withoutArtwork);
  if (!value || typeof value !== 'object') return value;
  const copy = {};
  for (const key of Object.keys(value)) Object.defineProperty(copy, key, { value: key === 'cover' ? '' : withoutArtwork(value[key]), writable: true, enumerable: true, configurable: true });
  return copy;
}

function decodeDataUrl(value) {
  const match = artworkDataPattern.exec(value);
  if (!match || !artworkMimeTypes.has(match[1]) || match[2].length % 4 === 1) {
    throw new RemoteError('Не удалось подготовить обложку для сохранения.', { code: 'invalid_artwork' });
  }
  if (match[2].length > Math.ceil((8 * 1024 * 1024) / 3) * 4) {
    throw new RemoteError('Размер исходной обложки превышает 8 МиБ.', { code: 'invalid_artwork' });
  }
  let binary;
  try { binary = atob(match[2]); }
  catch { throw new RemoteError('Не удалось подготовить обложку для сохранения.', { code: 'invalid_artwork' }); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) {
    throw new RemoteError('Размер исходной обложки превышает 8 МиБ.', { code: 'invalid_artwork' });
  }
  return { mime: match[1], bytes };
}

async function uploadArtwork(value, uploads) {
  if (typeof value !== 'string' || value === '') return value;
  const ref = artworkRefPattern.exec(value);
  if (ref) return value;
  if (value.startsWith('./api/artwork/')) throw new RemoteError('Ссылка на обложку имеет неверный формат.', { code: 'invalid_artwork' });
  const decoded = decodeDataUrl(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', decoded.bytes));
  const id = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (uploads.has(id)) return uploads.get(id);
  const existing = await fetch(`${API}/artwork/${id}`, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) })
    .catch(() => { throw new RemoteError('Нет связи с сервером. Черновик остаётся на этом устройстве.', { code: 'network', status: 0 }); });
  if (existing.status === 200) {
    const cover = `./api/artwork/${id}`;
    uploads.set(id, cover);
    return cover;
  }
  if (existing.status !== 404) {
    const type = existing.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await existing.json().catch(() => ({})) : null;
    throw new RemoteError(data?.error || 'Не удалось проверить сохранённую обложку.', { status: existing.status, code: data?.code || '' });
  }
  const result = await request('/artwork', { method: 'POST', body: decoded.bytes, signal: AbortSignal.timeout(30000), headers: { 'Content-Type': decoded.mime } });
  if (!result || result.id !== id || result.cover !== `./api/artwork/${id}`) {
    throw new RemoteError('Сервер вернул неверную ссылку на обложку.', { code: 'invalid_artwork_response' });
  }
  uploads.set(id, result.cover);
  return result.cover;
}

async function prepareArtworkPayload(payload) {
  // Snapshot synchronously before the first await: later editor changes belong to the next save.
  const snapshot = cloneJson(payload);
  if (new TextEncoder().encode(JSON.stringify(withoutArtwork(snapshot))).byteLength > maxJsonBytes) {
    throw new RemoteError('Данные для сохранения больше 5 МиБ. Уменьшите объём данных проекта.', { status: 413, code: 'too_large' });
  }
  const uploads = new Map();
  const submittedArtwork = new Map();
  await visitArtworkCoversAsync(snapshot, async value => {
    const reference = await uploadArtwork(value, uploads);
    if (typeof value === 'string' && artworkDataPattern.test(value)) submittedArtwork.set(reference, value);
    return reference;
  });
  return { body: jsonBody(snapshot), submittedArtwork };
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function downloadArtwork(ref) {
  const match = artworkRefPattern.exec(ref);
  if (!match) throw new RemoteError('Ссылка на обложку имеет неверный формат.', { code: 'invalid_artwork' });
  const response = await fetch(`${API}/artwork/${match[1]}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) })
    .catch(() => { throw new RemoteError('Нет связи с сервером. Черновик остаётся на этом устройстве.', { code: 'network', status: 0 }); });
  if (!response.ok) {
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json().catch(() => ({})) : null;
    throw new RemoteError(data?.error || 'Не удалось открыть обложку на сервере.', { status: response.status, code: data?.code || '' });
  }
  const mime = (response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
  if (!artworkMimeTypes.has(mime)) throw new RemoteError('Сервер вернул неподдерживаемый формат обложки.', { code: 'invalid_artwork_response' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw new RemoteError('Размер обложки на сервере неверен.', { code: 'invalid_artwork_response' });
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

async function hydrateArtwork(value, submittedArtwork = new Map()) {
  const snapshot = cloneJson(value);
  const downloads = new Map();
  return visitArtworkCoversAsync(snapshot, async cover => {
    if (typeof cover !== 'string' || cover === '' || artworkDataPattern.test(cover)) return cover;
    if (!artworkRefPattern.test(cover)) {
      if (cover.startsWith('./api/artwork/')) throw new RemoteError('Ссылка на обложку имеет неверный формат.', { code: 'invalid_artwork' });
      return cover;
    }
    if (submittedArtwork.has(cover)) return submittedArtwork.get(cover);
    if (!downloads.has(cover)) downloads.set(cover, downloadArtwork(cover));
    return downloads.get(cover);
  });
}

async function read(path, options) { return hydrateArtwork(await request(path, options)); }
async function write(path, payload, options = {}) {
  const prepared = await prepareArtworkPayload(payload);
  const result = await request(path, { ...options, body: prepared.body, headers: { 'Content-Type': 'application/json', ...options.headers } });
  try { return await hydrateArtwork(result, prepared.submittedArtwork); }
  catch (error) {
    const committedError = new RemoteError('Изменения сохранены в облаке, но не удалось загрузить одну из обложек. Откройте данные заново при подключении к сети.', {
      status: error.status || 0, code: 'saved_artwork_unavailable', committed: true, result, cause: error,
    });
    committedError.wirePayload = JSON.parse(prepared.body);
    throw committedError;
  }
}

export async function session() { return request('/session', { signal: AbortSignal.timeout(5000) }); }
export async function login(password) { return request('/login', { method: 'POST', body: jsonBody({ password }), headers: { 'Content-Type': 'application/json' } }); }
export async function logout() { try { await request('/logout', { method: 'POST', signal: AbortSignal.timeout(10000) }); } finally { csrf = null; } }
export async function listProjects() { return read('/projects', { signal: AbortSignal.timeout(5000) }); }
export async function createProject(name) { return request('/projects', { method: 'POST', body: jsonBody({ name }), headers: { 'Content-Type': 'application/json' } }); }
export async function getProject(id) { return read(`/projects/${encodeURIComponent(id)}`); }
export async function saveProject(id, project) { return write(`/projects/${encodeURIComponent(id)}`, project, { method: 'PUT' }); }
export async function deleteProject(id, revision) { return request(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: jsonBody({ revision }), headers: { 'Content-Type': 'application/json' } }); }
export async function listLibrary(query = '') { return read(`/library?q=${encodeURIComponent(query)}`); }
export async function getSong(id) { return read(`/songs/${encodeURIComponent(id)}`); }
export async function listSongProjects(id) { return request(`/songs/${encodeURIComponent(id)}/projects`); }
export async function deleteSong(id) { return request(`/songs/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function uploadAudio(file, { signal } = {}) {
  const type = ({ 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav' })[file.type] || file.type || (/\.wav$/i.test(file.name || '') ? 'audio/wav' : 'audio/mpeg');
  return request('/audio', { method: 'POST', body: file, signal, headers: { 'Content-Type': type, 'X-Lyrics-Filename': encodeURIComponent(file.name || 'recording') } });
}
export async function downloadAudio(id) {
  const response = await fetch(`${API}/audio/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
  if (!response.ok) throw new RemoteError('Не удалось открыть запись на сервере.', { status: response.status });
  return response.blob();
}
export async function importLegacy(payload) { return write('/imports', payload, { method: 'POST' }); }
export async function findMigration(key) { try { return await read(`/imports/${encodeURIComponent(key)}`); } catch (error) { if (error.status === 404) return null; throw error; } }

export const createSong = payload => write('/songs', payload, { method: 'POST' });
export const saveSong = (id, payload) => write(`/songs/${encodeURIComponent(id)}`, payload, { method: 'PUT' });
