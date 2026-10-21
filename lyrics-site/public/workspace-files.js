const ROOT = 'kaada-workspace';
const FORMAT = 'kaada-lyrics-workspace';
const TOKEN = /^[0-9]{16}-[a-f0-9-]{36}$/;
const HASH = /^[a-f0-9]{64}$/;
const emptyState = () => ({ schemaVersion: 1, library: [], projects: [], links: {} });
const record = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const invalid = detail => new Error(`Рабочая папка повреждена: ${detail}`);
const missing = error => error?.name === 'NotFoundError';

export function supportsWorkspaceFiles() {
  return typeof globalThis.showDirectoryPicker === 'function' && globalThis.isSecureContext !== false && !!globalThis.crypto?.subtle;
}

function cloneState(value) {
  if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.library) || !Array.isArray(value.projects) || !record(value.links)) {
    throw invalid('неподдерживаемый формат данных.');
  }
  // Reject values JSON would silently omit or transform before any file is touched.
  const json = JSON.stringify(value, (_key, item) => {
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint' || (typeof item === 'number' && !Number.isFinite(item))) throw invalid('данные нельзя сохранить в JSON.');
    return item;
  });
  const copy = JSON.parse(json);
  if (!copy.library.every(record) || !copy.projects.every(record)) throw invalid('песни и проекты должны быть объектами.');
  return copy;
}

function audioEntries(audio) {
  if (audio === undefined) return [];
  if (!(audio instanceof Map) && !record(audio)) throw new Error('Аудиофайлы должны быть Map или объектом.');
  const entries = audio instanceof Map ? [...audio] : Object.entries(audio);
  for (const [id, blob] of entries) {
    if (typeof id !== 'string' || !id || id.length > 1024) throw new Error('Нужен корректный id аудиофайла.');
    if (!(blob instanceof Blob) || !blob.size) throw new Error('Аудиофайл должен быть непустым Blob.');
  }
  return entries;
}

async function digest(blob) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readFile(directory, name) {
  return (await directory.getFileHandle(name)).getFile();
}

async function writeFile(directory, name, blob) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try {
    await writer.write(blob);
    await writer.close();
  } catch (error) {
    try { await writer.abort(); } catch {}
    throw error;
  }
  // A successful close is required; read-back also catches incomplete implementations
  // and reports a failed save before a commit marker can expose the generation.
  const saved = await handle.getFile();
  if (saved.size !== blob.size || await digest(saved) !== await digest(blob)) throw invalid('записанный файл не прошёл проверку.');
}

function jsonBlob(value) { return new Blob([JSON.stringify(value)], { type: 'application/json' }); }

/** An append-only workspace. A commit marker is published only after every file
 * in its immutable snapshot has closed and passed read-back verification. */
export function createWorkspace(directoryHandle) {
  if (directoryHandle?.kind !== 'directory' || typeof directoryHandle.getDirectoryHandle !== 'function') throw new Error('Выберите рабочую папку.');
  let current = null;
  let queue = Promise.resolve();
  let sequence = 0;
  let recovered = false;
  const serial = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };

  async function directories(create = false) {
    const root = await directoryHandle.getDirectoryHandle(ROOT, { create });
    return {
      snapshots: await root.getDirectoryHandle('snapshots', { create }),
      audio: await root.getDirectoryHandle('audio', { create }),
    };
  }

  async function verifyAudio(directory, entry) {
    if (!record(entry) || typeof entry.file !== 'string' || !/^audio-[a-f0-9-]{36}\.bin$/.test(entry.file) || !Number.isSafeInteger(entry.size) || entry.size <= 0 || typeof entry.type !== 'string' || !HASH.test(entry.sha256)) throw invalid('неверная ссылка на аудиофайл.');
    const file = await readFile(directory, entry.file);
    if (file.size !== entry.size || await digest(file) !== entry.sha256) throw invalid('аудиофайл не прошёл проверку.');
    return file.slice(0, file.size, entry.type);
  }

  async function loadNow() {
    let dirs;
    try { dirs = await directories(); }
    catch (error) {
      if (!missing(error)) throw error;
      // A missing workspace is new; a missing subdirectory in an existing one
      // is corruption, not permission to replace its previous content.
      try { await directoryHandle.getDirectoryHandle(ROOT); }
      catch (rootError) { if (missing(rootError)) { current = { state: emptyState(), audio: {} }; return cloneState(current.state); } throw rootError; }
      throw invalid('отсутствует каталог снимков или аудиофайлов.');
    }
    const commits = [];
    for await (const [name, handle] of dirs.snapshots.entries()) {
      if (handle.kind === 'file' && name.endsWith('.commit.json') && TOKEN.test(name.slice(0, -12))) commits.push(name);
    }
    commits.sort().reverse();
    recovered = false;
    for (const name of commits) {
      try {
        const marker = JSON.parse(await (await readFile(dirs.snapshots, name)).text());
        const token = name.slice(0, -12);
        if (!record(marker) || marker.format !== FORMAT || marker.snapshot !== `${token}.json` || !HASH.test(marker.sha256)) throw invalid('неверная отметка сохранения.');
        const blob = await readFile(dirs.snapshots, marker.snapshot);
        if (await digest(blob) !== marker.sha256) throw invalid('снимок не прошёл проверку.');
        const snapshot = JSON.parse(await blob.text());
        if (!record(snapshot) || snapshot.format !== FORMAT || snapshot.schemaVersion !== 1 || !record(snapshot.audio)) throw invalid('неподдерживаемый снимок.');
        const state = cloneState(snapshot.state);
        for (const [id, entry] of Object.entries(snapshot.audio)) {
          if (!id || id.length > 1024) throw invalid('неверный id аудиофайла.');
          await verifyAudio(dirs.audio, entry);
        }
        current = { state, audio: snapshot.audio };
        sequence = Math.max(sequence, Number(token.slice(0, 16)));
        return cloneState(state);
      } catch (error) {
        if (!(error instanceof SyntaxError) && !missing(error) && !error.message?.startsWith('Рабочая папка повреждена:')) throw error;
        recovered = true;
      }
    }
    if (commits.length) throw invalid('нет полностью читаемого сохранения. Исходные файлы сохранены.');
    current = { state: emptyState(), audio: {} };
    return cloneState(current.state);
  }

  async function saveNow(state, audio) {
    if (!current) await loadNow();
    const dirs = await directories(true);
    const manifest = { ...current.audio };
    for (const [id, blob] of audio) {
      const file = `audio-${globalThis.crypto.randomUUID()}.bin`;
      await writeFile(dirs.audio, file, blob);
      Object.defineProperty(manifest, id, { value: { file, size: blob.size, type: blob.type, sha256: await digest(blob) }, enumerable: true, writable: true, configurable: true });
    }
    // Recheck retained files: a missing configured track must not receive a new
    // complete-save marker just because the current edit changes only lyrics.
    for (const entry of Object.values(manifest)) await verifyAudio(dirs.audio, entry);
    sequence = Math.max(sequence + 1, Date.now());
    const token = `${String(sequence).padStart(16, '0')}-${globalThis.crypto.randomUUID()}`;
    const snapshot = jsonBlob({ format: FORMAT, schemaVersion: 1, state, audio: manifest });
    await writeFile(dirs.snapshots, `${token}.json`, snapshot);
    await writeFile(dirs.snapshots, `${token}.commit.json`, jsonBlob({ format: FORMAT, snapshot: `${token}.json`, sha256: await digest(snapshot) }));
    current = { state, audio: manifest };
    recovered = false;
    return cloneState(state);
  }

  return {
    name: directoryHandle.name,
    get recovered() { return recovered; },
    load: () => serial(loadNow),
    save(state, { audio } = {}) {
      let copy, entries;
      try { copy = cloneState(state); entries = audioEntries(audio); }
      catch (error) { return Promise.reject(error); }
      return serial(() => saveNow(copy, entries));
    },
    readAudio(id) {
      return serial(async () => {
        if (!current) await loadNow();
        if (!Object.hasOwn(current.audio, id)) return null;
        return verifyAudio((await directories()).audio, current.audio[id]);
      });
    },
    writeAudio(id, blob) {
      let entries;
      try { entries = audioEntries(new Map([[id, blob]])); }
      catch (error) { return Promise.reject(error); }
      return serial(async () => { if (!current) await loadNow(); return saveNow(cloneState(current.state), entries); });
    },
  };
}
