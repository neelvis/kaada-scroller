const API = './api';

export class RemoteError extends Error {
  constructor(message, { status = 0, code = '' } = {}) { super(message); this.name = 'RemoteError'; this.status = status; this.code = code; }
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
  }).catch((error) => { throw new RemoteError('Нет связи с сервером. Черновик остаётся на этом устройстве.', { code: 'network', status: 0 }); });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json().catch(() => ({})) : null;
  if (!response.ok) throw new RemoteError(data?.error || 'Сервер не смог выполнить действие.', { status: response.status, code: data?.code || (response.status === 409 ? 'conflict' : '') });
  if (data?.csrf) csrf = data.csrf;
  return data;
}

export async function session() { return request('/session', { signal: AbortSignal.timeout(5000) }); }
export async function login(password) { return request('/login', { method: 'POST', body: JSON.stringify({ password }), headers: { 'Content-Type': 'application/json' } }); }
export async function logout() { try { await request('/logout', { method: 'POST', signal: AbortSignal.timeout(10000) }); } finally { csrf = null; } }
export async function listProjects() { return request('/projects', { signal: AbortSignal.timeout(5000) }); }
export async function createProject(name) { return request('/projects', { method: 'POST', body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/json' } }); }
export async function getProject(id) { return request(`/projects/${encodeURIComponent(id)}`); }
export async function saveProject(id, project) { return request(`/projects/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(project), headers: { 'Content-Type': 'application/json' } }); }
export async function deleteProject(id, revision) { return request(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ revision }), headers: { 'Content-Type': 'application/json' } }); }
export async function listLibrary(query = '') { return request(`/library?q=${encodeURIComponent(query)}`); }
export async function getSong(id) { return request(`/songs/${encodeURIComponent(id)}`); }
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
export async function importLegacy(payload) { return request('/imports', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } }); }
export async function findMigration(key) { try { return await request(`/imports/${encodeURIComponent(key)}`); } catch (error) { if (error.status === 404) return null; throw error; } }
