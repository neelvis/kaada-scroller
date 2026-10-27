import * as remote from './remote.js';
import { sameEntryContent } from './save-reconciliation.js';
import { getAudio, getBacking } from './local-workspace.js';
import { normalizeSet } from './core.js';

const legacyFingerprint = value => JSON.stringify(value);
export function contentFingerprint(value) { return JSON.stringify(normalizeSet(value)); }
export function matchesContentFingerprint(value, fingerprint) {
  if (fingerprint === contentFingerprint(value) || fingerprint === legacyFingerprint(value)) return true;
  // Older links stored the unnormalized JSON string. Parse and canonicalize
  // that snapshot so property order and defaults added on reconnect do not
  // make an unchanged project appear edited.
  try { return contentFingerprint(JSON.parse(fingerprint)) === contentFingerprint(value); }
  catch { return false; }
}
async function uploadEntry(song) {
  let backingAudioId = null, audioId = null;
  if (song.backing?.fileName) {
    const blob = await getBacking(song.id);
    if (!blob) throw new Error(`Не найдена минусовка «${song.title}».`);
    backingAudioId = (await remote.uploadAudio(new File([blob], song.backing.fileName, { type: blob.type }))).id;
  }
  const original = await getAudio(song.id);
  if (original) audioId = (await remote.uploadAudio(new File([original], song.source?.fileName || 'recording.mp3', { type: original.type }))).id;
  return { song, backingAudioId, audioId };
}
export async function uploadLocalProject(local, link, progress = () => {}, retryBaseline = null) {
  if (link) {
    const current = await remote.getProject(link.id);
    if (current.revision !== link.revision) throw new remote.RemoteError('В облаке другая версия. Сохраните отдельную копию или скачайте её для сравнения.', { code: 'conflict' });
  } else {
    // The import key is persisted with the local project before any request.
    const found = await remote.findMigration(local.id);
    if (found) {
      if (!retryBaseline) return found;
      if (found.name !== retryBaseline.name || found.songs.length !== retryBaseline.songs.length || found.songs.some((entry, index) => {
        const song = retryBaseline.songs[index];
        // Import replaces the local project ID with the newly created cloud ID.
        // Compare that same association before deciding whether cloud content diverged.
        const baselineSong = Array.isArray(song.projectCovers) ? { ...song, projectCovers: song.projectCovers.map(item => ({ ...item, projectId: item.projectId === retryBaseline.id ? found.id : item.projectId })) } : song;
        return !sameEntryContent(entry, { ...entry, song: baselineSong });
      })) {
        throw new remote.RemoteError('Проект уже создан, но его песни изменились в облаке. Черновик сохранён; откройте облачный проект для сверки.', { code: 'conflict' });
      }
      if (contentFingerprint(local) === contentFingerprint(retryBaseline)) return found;
      link = projectLink(retryBaseline, found);
    }
  }
  const songs = [];
  for (const [index, song] of local.songs.entries()) {
    progress(`Загрузка файлов: ${index + 1} из ${local.songs.length}`);
    const entry = await uploadEntry({ ...song, projectCovers: (song.projectCovers || []).map(item => ({ ...item, projectId: item.projectId === local.id && link ? link.id : item.projectId })) });
    const prior = link?.entries?.find(entry => entry.localId === song.id);
    Object.assign(entry, { live: local.liveSongs?.[song.id] === true });
    if (prior && prior.localId === song.id) Object.assign(entry, { songId: prior.songId, revisionId: prior.revisionId });
    songs.push(entry);
  }
  return link ? remote.saveProject(link.id, { revision: link.revision, name: local.name, cover: local.cover || '', endCaption: local.endCaption || '', songs }) : remote.importLegacy({ migrationKey: local.id, name: local.name, cover: local.cover || '', endCaption: local.endCaption || '', songs });
}
export async function downloadProjectFiles(cloud, progress = () => {}) {
  const audio = new Map(), songs = [], localProjectId = `project-${crypto.randomUUID()}`;
  const total = cloud.songs.length;
  for (const [index, entry] of cloud.songs.entries()) {
    progress({ phase: 'downloading', completed: index, total, label: `Скачивание: ${index + 1} из ${total}` });
    const song = structuredClone(entry.song); song.id = `song-${crypto.randomUUID()}`;
    song.projectCovers = (song.projectCovers || []).map(item => ({ ...item, projectId: item.projectId === cloud.id ? localProjectId : item.projectId }));
    if (entry.backingAudioId) audio.set(`backing:${song.id}`, await remote.downloadAudio(entry.backingAudioId));
    else if (song.backing?.fileName) throw new Error(`Минусовка «${song.title}» отсутствует в облаке.`);
    if (entry.audioId) audio.set(`original:${song.id}`, await remote.downloadAudio(entry.audioId));
    songs.push(song);
    progress({ phase: 'downloading', completed: index + 1, total, label: `Скачивание: ${index + 1} из ${total}` });
  }
  const liveSongs = Object.fromEntries(cloud.songs.flatMap((entry, index) => entry.live === true ? [[songs[index].id, true]] : []));
  return { local: { schemaVersion: 1, id: localProjectId, name: cloud.name, cover: cloud.cover || '', endCaption: cloud.endCaption || '', liveSongs, songs }, audio };
}
export function projectLink(local, cloud) {
  return { id: cloud.id, revision: cloud.revision, fingerprint: contentFingerprint(local), entries: cloud.songs.map((entry, index) => ({ localId: local.songs[index]?.id, songId: entry.songId, revisionId: entry.revisionId })) };
}
