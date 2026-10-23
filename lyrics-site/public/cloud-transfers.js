import * as remote from './remote.js';
import { sameEntryContent } from './save-reconciliation.js';
import { getAudio, getBacking } from './local-workspace.js';

export function contentFingerprint(value) { return JSON.stringify(value); }
export function transferState(local, link, cloudRevision) {
  if (!link) return 'local';
  const edited = contentFingerprint(local) !== link.fingerprint;
  const newer = cloudRevision != null && cloudRevision !== link.revision;
  return edited && newer ? 'conflict' : edited ? 'local-changes' : newer ? 'cloud-changes' : 'current';
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
      if (found.name !== retryBaseline.name || found.songs.length !== retryBaseline.songs.length || found.songs.some((entry, index) => !sameEntryContent(entry, { ...entry, song: retryBaseline.songs[index] }))) {
        throw new remote.RemoteError('Проект уже создан, но его песни изменились в облаке. Черновик сохранён; откройте облачный проект для сверки.', { code: 'conflict' });
      }
      if (contentFingerprint(local) === contentFingerprint(retryBaseline)) return found;
      link = projectLink(retryBaseline, found);
    }
  }
  const songs = [];
  for (const [index, song] of local.songs.entries()) {
    progress(`Загрузка файлов: ${index + 1} из ${local.songs.length}`);
    const entry = await uploadEntry(song);
    const prior = link?.entries?.find(entry => entry.localId === song.id);
    if (prior && prior.localId === song.id) Object.assign(entry, { songId: prior.songId, revisionId: prior.revisionId });
    songs.push(entry);
  }
  return link ? remote.saveProject(link.id, { revision: link.revision, name: local.name, cover: local.cover || '', songs }) : remote.importLegacy({ migrationKey: local.id, name: local.name, cover: local.cover || '', songs });
}
export async function uploadLocalSong(song, link) {
  if (link) {
    const current = await remote.getSong(link.id);
    if (current.revisionId !== link.revision) throw new remote.RemoteError('В облаке другая версия песни. Сохраните отдельную копию.', { code: 'conflict' });
  }
  const entry = await uploadEntry(song);
  return link ? remote.saveSong(link.id, { ...entry, revisionId: link.revision }) : remote.createSong({ ...entry, migrationKey: song.id });
}
export async function downloadProjectFiles(cloud, progress = () => {}) {
  const audio = new Map(), songs = [];
  for (const [index, entry] of cloud.songs.entries()) {
    progress(`Скачивание: ${index + 1} из ${cloud.songs.length}`);
    const song = structuredClone(entry.song); song.id = `song-${crypto.randomUUID()}`;
    if (entry.backingAudioId) audio.set(`backing:${song.id}`, await remote.downloadAudio(entry.backingAudioId));
    else if (song.backing?.fileName) throw new Error(`Минусовка «${song.title}» отсутствует в облаке.`);
    if (entry.audioId) audio.set(`original:${song.id}`, await remote.downloadAudio(entry.audioId));
    songs.push(song);
  }
  return { local: { schemaVersion: 1, id: `project-${crypto.randomUUID()}`, name: cloud.name, cover: cloud.cover || '', songs }, audio };
}
export function projectLink(local, cloud) {
  return { id: cloud.id, revision: cloud.revision, fingerprint: contentFingerprint(local), entries: cloud.songs.map((entry, index) => ({ localId: local.songs[index]?.id, songId: entry.songId, revisionId: entry.revisionId })) };
}
