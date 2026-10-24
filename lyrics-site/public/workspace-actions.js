import { validateSong } from './core.js';
import { getBacking, localState, durableLocalState, connectedWorkspace, connectWorkspace, saveWorkspace, filesSupported, rememberedDirectory, rememberDirectory, knownWorkspaceHandle, rememberWorkspaceHandle } from './local-workspace.js';
import { $, toast } from './ui.js';
import { downloadProjectFiles, contentFingerprint, matchesContentFingerprint, projectLink } from './cloud-transfers.js';
import * as remote from './remote.js';

export function createWorkspaceActions(context) {
  const { els } = context.resources;
  const { cancelRecognition, clearAudioPreview, render, openProject, createLibrarySong } = context.actions;
  function showPreparation() { $('#home-view').hidden = true; els.prep.hidden = false; }
  // Old library files remain intact for recovery; they are no longer a library destination.
  function syncLocalLibrary() { context.state.legacySet = { schemaVersion: 1, id: 'library-draft', name: 'Библиотека песен', songs: [] }; }
  function showWorkspaceFolder(name = '', status = '') {
    const button = $('#workspace-connect');
    const label = `Локальная папка для сохранения проектов: ${name || 'папка не выбрана'}`;
    button.setAttribute('aria-label', label); button.setAttribute('data-tooltip', label); button.title = label;
    $('#workspace-status').textContent = status;
  }
  async function connectRememberedDirectory({ request = false } = {}) {
    const handle = knownWorkspaceHandle() || await rememberedDirectory();
    if (!handle) return false;
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && request) permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') {
      rememberWorkspaceHandle(handle);
      showWorkspaceFolder(handle.name, 'Подключите папку');
      throw new Error('Не удалось получить доступ к выбранной папке. Разрешите доступ и повторите сохранение.');
    }
    await connectWorkspace(handle);
    rememberWorkspaceHandle(handle);
    showWorkspaceFolder(handle.name);
    return true;
  }
  async function ensureDirectory() {
    if (connectedWorkspace()) return true;
    if (knownWorkspaceHandle() || await rememberedDirectory()) return connectRememberedDirectory({ request: true });
    await chooseDirectory();
    return Boolean(connectedWorkspace());
  }
  async function chooseDirectory() {
    if (!filesSupported()) return toast('Для локальной копии откройте приложение в настольном Chrome или Edge по HTTPS.');
    try {
      await context.state.persistChain;
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'kaada-workspace' });
      await connectWorkspace(handle); rememberWorkspaceHandle(handle); await rememberDirectory(handle).catch(() => {});
      showWorkspaceFolder(handle.name);
      context.resources.hub.render(); render();
    } catch (error) { if (error.name !== 'AbortError') toast(error.message); }
  }
  async function restoreDirectory() {
    if (!filesSupported()) return;
    let handle = null;
    try {
      handle = await rememberedDirectory(); if (!handle) { showWorkspaceFolder(); return; }
      showWorkspaceFolder(handle.name);
      if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') { rememberWorkspaceHandle(handle); showWorkspaceFolder(handle.name, 'Подключите папку'); return; }
      await connectWorkspace(handle);
      rememberWorkspaceHandle(handle);
      context.resources.hub.render(); render();
    } catch (error) { showWorkspaceFolder(handle?.name || '', handle ? 'Подключите папку' : ''); }
  }
  async function openLocalProject(id, { playbackOnly = false } = {}) {
    await context.state.persistChain;
    const found = localState().projects.find(item => item.id === id); if (!found) return false;
    const link = localState().links[`project:${id}`];
    if (link && !playbackOnly && context.state.sessionActive) return openProject(link.id);
    if (!await context.actions.confirmProjectExit()) return false;
    cancelRecognition(); clearAudioPreview(); context.state.localProjectId = id; context.state.project = null; context.state.projectEntries.clear();
    context.state.onlineSongOpen = false; context.state.remoteDirty = false;
    context.state.set = structuredClone(found); context.state.selectedId = context.state.set.songs[0]?.id || null; showPreparation(); render(); return true;
  }
  async function createLocalProject() {
    if (!context.state.sessionActive) return toast('Войдите, чтобы создать проект в облаке.');
    $('#create-local-project-dialog').showModal(); $('#local-project-name').focus();
  }
  async function submitLocalProject(event) {
    event.preventDefault(); const name = $('#local-project-name').value.trim(); if (!name) return;
    try {
      const created = await remote.createProject(name); $('#create-local-project-dialog').close(); $('#local-project-name').value = '';
      await openProject(created.id); await refreshHubCloud();
    } catch (error) { toast(error.message); }
  }
  function createLocalSong() { return createLibrarySong(); }
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
    if (!connectedWorkspace()) return 'Подключите папку локальной копии';
    if (!item.songs.length) return 'Добавьте песни';
    if (item.songs.some(song => validateSong(song).length)) return 'Есть песни, требующие подготовки';
    for (const song of item.songs) if (song.backing?.fileName && !await getBacking(song.id)) return `Нет минусовки: ${song.title}`;
    return '';
  }
  function updateTransfer(id, progress) {
    const transfers = context.state.transfers ||= new Map();
    const previous = transfers.get(id);
    transfers.set(id, { ...progress, hadLocalCopy: previous?.hadLocalCopy ?? progress.hadLocalCopy ?? false });
    context.resources.hub.render();
  }
  function finishTransfer(id) {
    context.state.transfers?.delete(id);
    context.resources.hub.render();
  }
  async function downloadItem(kind, id, { cloud = null, quiet = false } = {}) {
    if (kind !== 'project') return false;
    if (context.state.transferBusy) return false;
    if (!context.state.sessionActive) { toast('Войдите для сохранения локальной копии.'); return false; }
    // Reserve synchronously before permission checks or a folder picker can
    // yield, so a second click cannot start a competing transfer.
    context.state.transferBusy = true;
    try {
      if (!await ensureDirectory()) return false;
      const targetWorkspace = connectedWorkspace();
      if (!targetWorkspace) return false;
      const startingState = localState();
      const initialOld = startingState.projects.find(item => startingState.links[`project:${item.id}`]?.id === id);
      const initialLink = initialOld && startingState.links[`project:${initialOld.id}`];
      if (initialOld && !matchesContentFingerprint(initialOld, initialLink.fingerprint)) throw new Error('В локальной копии есть изменения. Сначала откройте и сохраните их в облаке.');
      const hadLocalCopy = durableLocalState().projects.some(item => durableLocalState().links[`project:${item.id}`]?.id === id);
      updateTransfer(id, { phase: 'preparing', completed: 0, total: 1, label: 'Подготовка…', hadLocalCopy });
      cloud ||= await remote.getProject(id);
      const result = await downloadProjectFiles(cloud, progress => {
        updateTransfer(id, { ...progress, total: progress.total + 1 });
        $('#local-save-status').textContent = progress.label;
      });
      // Downloads can take a while. Merge into the latest workspace snapshot
      // so edits made while media was downloading are not discarded.
      const next = structuredClone(localState());
      const old = next.projects.find(item => next.links[`project:${item.id}`]?.id === id);
      if (connectedWorkspace() !== targetWorkspace) throw new Error('Рабочая папка изменилась во время скачивания. Повторите сохранение.');
      if (initialOld && !old) throw new Error('Локальная копия была удалена во время скачивания. Повторите сохранение.');
      if (old && (!initialOld || old.id !== initialOld.id || contentFingerprint(old) !== contentFingerprint(initialOld))) {
        throw new Error('Локальная копия изменилась во время скачивания. Повторите сохранение.');
      }
      if (old) {
        const generatedId = result.local.id;
        result.local.songs = result.local.songs.map(song => ({ ...song, projectCovers: (song.projectCovers || []).map(item => ({ ...item, projectId: item.projectId === generatedId ? old.id : item.projectId })) }));
        result.local.id = old.id; next.projects = next.projects.map(item => item.id === old.id ? result.local : item);
      }
      else next.projects.push(result.local);
      next.links[`project:${result.local.id}`] = projectLink(result.local, cloud);
      const total = (cloud.songs?.length || 0) + 1;
      updateTransfer(id, { phase: 'saving', completed: total - 1, total, label: 'Сохранение локальной копии…' });
      await saveWorkspace(next, result.audio);
      if (!quiet) toast('Локальная копия проекта сохранена.'); context.resources.hub.render(); return true;
    } catch (error) { toast(`Локальная копия не сохранена: ${error.message}`); return false; }
    finally { context.state.transferBusy = false; finishTransfer(id); }
  }
  async function removeLocalItem(kind, id) {
    if (kind !== 'project' || !confirm('Удалить локальную копию проекта? Облачный проект сохранится.')) return;
    const next = structuredClone(localState()); next.projects = next.projects.filter(item => item.id !== id); delete next.links[`project:${id}`];
    try { await saveWorkspace(next); context.resources.hub.render(); } catch (error) { toast(error.message); }
  }
  async function removeMissingCloudProject(id) {
    const current = localState();
    const local = current.projects.find(item => current.links[`project:${item.id}`]?.id === id);
    if (!local) return false;
    if (!connectedWorkspace()) throw new Error('Подключите рабочую папку, чтобы удалить из неё осиротевшую копию проекта.');
    const next = structuredClone(current);
    next.projects = next.projects.filter(item => item.id !== local.id);
    delete next.links[`project:${local.id}`]; delete next.links[`pending-project:${local.id}`];
    await saveWorkspace(next);
    context.resources.hub.render();
    return true;
  }
  return { showPreparation, syncLocalLibrary, restoreDirectory, openLocalProject, createLocalProject, submitLocalProject, createLocalSong, refreshHubCloud, readiness, downloadItem, removeLocalItem, removeMissingCloudProject, chooseDirectory, ensureDirectory };
}
