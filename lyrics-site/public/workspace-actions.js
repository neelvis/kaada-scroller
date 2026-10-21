import { validateSong } from './core.js';
import { loadSet, getAudio as legacyAudio, getBacking as legacyBacking } from './storage.js';
import { getBacking, localState, connectedWorkspace, connectWorkspace, saveWorkspace, filesSupported, rememberedDirectory, rememberDirectory, duplicateSong } from './local-workspace.js';
import { $, toast } from './ui.js';
import { uploadLocalProject, uploadLocalSong, downloadProjectFiles, contentFingerprint, projectLink } from './cloud-transfers.js';
import { preparedProjects, openCachedProject, getPrivateAudio } from './offline-projects.js';
import * as remote from './remote.js';

export function createWorkspaceActions(context) {
  const { els } = context.resources;
  const { cancelRecognition, clearAudioPreview, render, openProject, openLocalSong, addSong, backingKey } = context.actions;

  function showPreparation() { $('#home-view').hidden = true; els.prep.hidden = false; }
  function syncLocalLibrary() { context.state.legacySet = { schemaVersion: 1, id: 'local-library', name: 'Библиотека песен', songs: structuredClone(localState().library) }; }
  async function ensureDirectory() {
    if (connectedWorkspace()) return true;
    await chooseDirectory(); return Boolean(connectedWorkspace());
  }
  async function chooseDirectory() {
    if (!filesSupported()) return toast('Для работы с папкой откройте приложение в настольном Chrome или Edge по HTTPS. Доступны облако и ZIP-экспорт.');
    try {
      await context.state.persistChain;
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'kaada-workspace' });
      await connectWorkspace(handle); await rememberDirectory(handle).catch(() => {});
      context.state.localProjectId = null; syncLocalLibrary(); context.state.set = context.state.legacySet; context.state.selectedId = null;
      $('#workspace-status').textContent = `Папка: ${handle.name}`; $('#workspace-connect').textContent = 'Сменить папку';
      render(); context.resources.hub.render();
    } catch (error) { if (error.name !== 'AbortError') toast(error.message); }
  }
  async function restoreDirectory() {
    if (!filesSupported()) { $('#workspace-status').textContent = 'Файловое хранение: настольные Chrome и Edge'; return; }
    try {
      const handle = await rememberedDirectory(); if (!handle) return;
      if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') { $('#workspace-status').textContent = `Подключите папку «${handle.name}»`; $('#workspace-connect').textContent = 'Подключить папку'; return; }
      await connectWorkspace(handle); syncLocalLibrary(); context.state.set = context.state.legacySet;
      $('#workspace-status').textContent = `Папка: ${handle.name}`; $('#workspace-connect').textContent = 'Сменить папку';
    } catch (error) { $('#workspace-status').textContent = `Подключите папку: ${error.message}`; }
  }
  async function openLocalProject(id) {
    await context.state.persistChain;
    const found = localState().projects.find(item => item.id === id); if (!found) return false;
    if (context.state.remoteDirty && !confirm('Изменения облачного проекта останутся в черновике. Продолжить?')) return false;
    cancelRecognition(); clearAudioPreview(); context.state.localProjectId = id; context.state.project = null; context.state.projectEntries.clear();
    context.state.offlineProjectOpen = false; context.state.onlineSongOpen = false; context.state.remoteDirty = false;
    context.state.set = structuredClone(found); context.state.selectedId = context.state.set.songs[0]?.id || null; showPreparation(); render(); return true;
  }
  async function createLocalProject() {
    $('#new-project-location option[value="cloud"]').disabled = !context.state.sessionActive;
    $('#new-project-location').value = 'local'; $('#create-local-project-dialog').showModal(); $('#local-project-name').focus();
  }
  async function submitLocalProject(event) {
    event.preventDefault(); const name = $('#local-project-name').value.trim(); if (!name) return;
    try {
      if ($('#new-project-location').value === 'cloud') {
        const created = await remote.createProject(name); $('#create-local-project-dialog').close(); await openProject(created.id); await refreshHubCloud(); return;
      }
      if (!await ensureDirectory()) return;
      const next = structuredClone(localState()); const item = { schemaVersion: 1, id: `project-${crypto.randomUUID()}`, name, songs: [] };
      next.projects.push(item); await saveWorkspace(next); $('#create-local-project-dialog').close(); $('#local-project-name').value = ''; await openLocalProject(item.id);
    } catch (error) { toast(error.message); }
  }
  async function createLocalSong() { if (!await ensureDirectory()) return; syncLocalLibrary(); openLocalSong(null); addSong(); }
  async function refreshHubCloud() {
    if (!context.state.sessionActive) { context.state.cloudProjects = []; context.state.librarySongs = []; context.resources.hub.render(); return; }
    try {
      const [projects, songs] = await Promise.all([remote.listProjects(), remote.listLibrary()]);
      if (!context.state.sessionActive) return;
      context.state.cloudProjects = projects.projects || []; context.state.librarySongs = songs.songs || []; context.state.hubMessage = '';
    } catch (error) { context.state.hubMessage = error.message; }
    context.resources.hub.render();
  }
  async function readiness(item) {
    if (!connectedWorkspace()) return 'Подключите рабочую папку';
    if (!item.songs.length) return 'Добавьте песни';
    if (item.songs.some(song => validateSong(song).length)) return 'Есть песни, требующие подготовки';
    for (const song of item.songs) if (song.backing?.fileName && !await getBacking(song.id)) return `Нет минусовки: ${song.title}`;
    return context.state.offlineShellReady ? 'Готов к запуску без интернета ✓' : 'Файлы сохранены · автономная оболочка ещё не готова';
  }
  function lockTransfer(busy) {
    for (const selector of ['#home-view', '#preparation-view', '.topbar']) $(selector).inert = busy;
    $('#set-file').disabled = busy;
  }
  async function uploadItem(kind, id) {
    if (context.state.transferBusy) return;
    if (!context.state.sessionActive) return toast('Войдите для загрузки в облако.');
    await context.state.persistChain;
    if (context.state.savedStatus.startsWith('Не сохранено:')) return toast('Сначала повторите сохранение изменений в рабочую папку.');
    const state = localState(), item = (kind === 'project' ? state.projects : state.library).find(entry => entry.id === id);
    if (!item) return;
    context.state.transferBusy = true; lockTransfer(true);
    const progress = text => { $('#hub-message').textContent = text; $('#local-save-status').textContent = text; };
    const before = structuredClone(item), link = state.links[`${kind}:${id}`];
    try {
      progress('Загрузка в облако…');
      const cloud = kind === 'project' ? await uploadLocalProject(before, link, progress) : await uploadLocalSong(before, link);
      const next = structuredClone(localState());
      next.links[`${kind}:${id}`] = kind === 'project' ? projectLink(before, cloud) : { id: cloud.songId, revision: cloud.revisionId, fingerprint: contentFingerprint(before) };
      await saveWorkspace(next); toast('Загружено в облако.'); await refreshHubCloud();
    } catch (error) { toast(error.message); }
    finally { context.state.transferBusy = false; lockTransfer(false); render(); context.resources.hub.render(); }
  }
  async function downloadItem(kind, id) {
    if (context.state.transferBusy || !await ensureDirectory()) return;
    if (!context.state.sessionActive) return toast('Войдите для скачивания.');
    context.state.transferBusy = true; lockTransfer(true);
    try {
      const next = structuredClone(localState());
      const old = (kind === 'project' ? next.projects : next.library).find(item => next.links[`${kind}:${item.id}`]?.id === id);
      let cloud = kind === 'project' ? await remote.getProject(id) : await remote.getSong(id);
      const link = old && next.links[`${kind}:${old.id}`];
      const revision = kind === 'project' ? cloud.revision : cloud.revisionId;
      if (old && link.revision === revision) { toast('Эта версия уже скачана. Правки на этом устройстве сохранены.'); return; }
      // New cloud revisions always become separate local copies; conflicts preserve both.
      const result = await downloadProjectFiles(kind === 'project' ? cloud : { name: cloud.song.title, songs: [cloud] }, text => { $('#hub-message').textContent = text; });
      if (kind === 'project') {
        if (old) result.local.name += ' — версия из облака';
        next.projects.push(result.local); next.links[`project:${result.local.id}`] = projectLink(result.local, cloud);
        for (const song of result.local.songs) {
          const copy = structuredClone(song); copy.id = `song-${crypto.randomUUID()}`;
          for (const kind of ['backing', 'original']) { const blob = result.audio.get(`${kind}:${song.id}`); if (blob) result.audio.set(`${kind}:${copy.id}`, blob); }
          next.library.push(copy); next.links[`pin:${song.id}`] = copy.id;
        }
      } else {
        const song = result.local.songs[0]; next.library.push(song);
        next.links[`song:${song.id}`] = { id: cloud.songId, revision: cloud.revisionId, fingerprint: contentFingerprint(song) };
      }
      await saveWorkspace(next, result.audio); syncLocalLibrary(); toast(old ? 'Версия из облака сохранена отдельной копией.' : 'Все файлы сохранены в рабочую папку.'); context.resources.hub.render();
    } catch (error) { toast(`Не удалось скачать: ${error.message}`); }
    finally { context.state.transferBusy = false; lockTransfer(false); }
  }
  async function removeLocalItem(kind, id) {
    if (!confirm(kind === 'project' ? 'Удалить проект? Песни останутся в библиотеке.' : 'Удалить песню из библиотеки? Версии в проектах останутся.')) return;
    const next = structuredClone(localState());
    if (kind === 'project') next.projects = next.projects.filter(item => item.id !== id);
    else { next.library = next.library.filter(item => item.id !== id); for (const [key, sourceId] of Object.entries(next.links)) if (key.startsWith('pin:') && sourceId === id) delete next.links[key]; }
    delete next.links[`${kind}:${id}`];
    try { await saveWorkspace(next); syncLocalLibrary(); context.resources.hub.render(); } catch (error) { toast(error.message); }
  }
  async function copyLocalItem(kind, id) {
    const next = structuredClone(localState()); const items = kind === 'project' ? next.projects : next.library;
    const original = items.find(item => item.id === id); if (!original) return;
    try {
      let copy;
      if (kind === 'project') {
        copy = { ...structuredClone(original), id: `project-${crypto.randomUUID()}`, name: `${original.name} — копия`, songs: [] };
        for (const song of original.songs) {
          const duplicate = await duplicateSong(song);
          copy.songs.push(duplicate);
          const sourceId = next.links[`pin:${song.id}`];
          if (sourceId) next.links[`pin:${duplicate.id}`] = sourceId;
        }
      } else {
        copy = await duplicateSong(original);
        copy.title = `${original.title || 'Без названия'} — копия`;
      }
      items.push(copy); await saveWorkspace(next); context.resources.hub.render(); toast('Создана отдельная копия.');
    } catch (error) { toast(error.message); }
  }
  async function migrateBrowserData() {
    if (!await ensureDirectory()) return;
    if (!confirm('Скопировать прежние песни и скачанные проекты в выбранную папку? Исходные данные останутся в браузере.')) return;
    try {
      const old = await loadSet(), cached = await preparedProjects();
      const next = structuredClone(localState()), audio = new Map(); let count = 0;
      if (old && !next.links[`migration:${old.id}`]) {
        for (const song of old.songs) {
          const copy = structuredClone(song); copy.id = `song-${crypto.randomUUID()}`;
          for (const kind of ['backing', 'original']) {
            const blob = kind === 'backing' ? await legacyBacking(song.id) : await legacyAudio(song.id);
            if (blob) audio.set(`${kind}:${copy.id}`, blob);
            else if (kind === 'backing' && song.backing?.fileName) throw new Error(`Нет минусовки «${song.title}». Сначала восстановите файл.`);
          }
          next.library.push(copy); count++;
        }
        next.links[`migration:${old.id}`] = true;
      }
      for (const record of cached) {
        if (next.links[`migration:cache:${record.id}`]) continue;
        const cloud = await openCachedProject(record.id);
        const local = { schemaVersion: 1, id: `project-${crypto.randomUUID()}`, name: cloud.name, songs: [] };
        for (const entry of cloud.songs) {
          const copy = structuredClone(entry.song); copy.id = `song-${crypto.randomUUID()}`;
          if (entry.backingAudioId) {
            const blob = await getPrivateAudio(backingKey(entry.backingAudioId)); if (!blob) throw new Error(`Нет минусовки «${copy.title}».`);
            audio.set(`backing:${copy.id}`, blob);
          } else if (copy.backing?.fileName) throw new Error(`Нет минусовки «${copy.title}».`);
          const libraryCopy = structuredClone(copy); libraryCopy.id = `song-${crypto.randomUUID()}`;
          const backing = audio.get(`backing:${copy.id}`); if (backing) audio.set(`backing:${libraryCopy.id}`, backing);
          local.songs.push(copy); next.library.push(libraryCopy); next.links[`pin:${copy.id}`] = libraryCopy.id;
        }
        next.projects.push(local); next.links[`project:${local.id}`] = projectLink(local, cloud); next.links[`migration:cache:${record.id}`] = true; count++;
      }
      await saveWorkspace(next, audio); syncLocalLibrary(); context.resources.hub.render(); toast(`Перенос завершён: ${count}. Исходные данные сохранены.`);
    } catch (error) { toast(`Перенос не завершён: ${error.message}`); }
  }
  async function adoptLocalLibraryVersion(song) {
    const sourceId = localState().links[`pin:${song.id}`];
    const source = localState().library.find(item => item.id === sourceId);
    if (!source || !confirm('Заменить текст, тайминг и минусовку этой песни версией из библиотеки?')) return;
    try {
      const copy = await duplicateSong(source);
      context.state.set = { ...context.state.set, songs: context.state.set.songs.map(item => item.id === song.id ? copy : item) }; context.state.selectedId = copy.id;
      const next = structuredClone(localState()); next.links[`pin:${copy.id}`] = sourceId;
      next.projects = next.projects.map(item => item.id === context.state.localProjectId ? structuredClone(context.state.set) : item);
      await saveWorkspace(next); render();
    } catch (error) { toast(error.message); }
  }

  return { showPreparation, syncLocalLibrary, restoreDirectory, openLocalProject, createLocalProject, submitLocalProject, createLocalSong, refreshHubCloud, readiness, uploadItem, downloadItem, removeLocalItem, copyLocalItem, migrateBrowserData, adoptLocalLibraryVersion, chooseDirectory, ensureDirectory };
}
