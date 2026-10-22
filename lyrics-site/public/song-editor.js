import { formatTime, invalidateReview, parseLrc, parseTime, validateSong } from './core.js';
import { getAudio, putAudio, putBacking, deleteAudio, deleteBacking } from './local-workspace.js';
import { $, node, button, field, input, toast } from './ui.js';
import { hasPlainLyrics, hasSynchronizedLyrics, LrclibClient, prepareLrcImport, preparePlainImport } from './lrclib.js';
import { recognizeFile } from './recognition.js';
import { getPrivateAudio, putPrivateAudio, removePrivateAudio } from './offline-projects.js';
import * as remote from './remote.js';
import { insertRestCue, moveCueToBoundary } from './cue-editing.js';

export function createSongEditor(context) {
  const { els, previewPlayer, backingPreview, backingPreviewId, recognition, sourceGeneration } = context.resources;
  const { currentSong, status, changeSong, render, showLibrary, addSong, clearAudioPreview, clearBackingPreview, setAudioPreview, setBackingPreview, entryFor, privateMutation, backingKey, markRemoteDirty, persist, displayTime } = context.actions;
  const recognitionProfiles = new Map();
  const backingGeneration = new Map();
  const importDrafts = new Map();
  const estimatedRestStarts = new Set();
  const lrclibClient = new LrclibClient();
  let editorTab = 'lrclib';
  let editorTabSongId = null;
  let lrclibState = null;
  let committingCueBeforeRender = false;
  function lrclibContext() { return JSON.stringify([context.state.workspaceGeneration, context.state.set.id, context.state.project?.id, context.state.selectedId, context.state.sessionActive, context.state.offlineProjectOpen]); }
  function cancelLrclib() { lrclibState?.controller?.abort(); if (lrclibState) lrclibState.token += 1; lrclibState = null; }
  function resetPreparation({ preserveDrafts = false } = {}) { cancelLrclib(); if (!preserveDrafts) importDrafts.clear(); editorTabSongId = null; }
  function resetEditorTab() { editorTab = 'lrclib'; }
  function invalidateChanged(song, changes) { return invalidateReview({ ...song, ...changes }); }
  function audioOwner() { return context.state.project?.id || (context.state.onlineSongOpen ? 'library' : null); }
  function remoteAudioMode() { return Boolean(context.state.project || context.state.onlineSongOpen); }

  function renderEditor() {
    if (committingCueBeforeRender) return;
    const focused = document.activeElement;
    if (els.editor.contains(focused) && focused.matches('.cue-time,.cue-text,.cue-type')) {
      // An async save refresh can arrive before a focused cue's native change.
      // Commit it before replacing the DOM; this outer render owns the rebuild.
      committingCueBeforeRender = true;
      try { focused.dispatchEvent(new Event('change', { bubbles: true })); }
      finally { committingCueBeforeRender = false; }
    }
    if (lrclibState && lrclibState.context !== lrclibContext()) cancelLrclib();
    const song = currentSong(); els.editor.replaceChildren();
    if (!song && context.state.localProjectId) { els.editor.append(node('div', { className: 'empty-state' }, [node('span', { className: 'empty-note', text: '♫' }), node('h1', { text: 'Соберите программу выступления' }), node('p', { className: 'hint', text: 'Добавьте песни из библиотеки или создайте новую.' }), button('Добавить из библиотеки', 'button primary', showLibrary), button('Создать песню', 'button quiet', addSong)])); return; }
    if (!song) {
      clearAudioPreview();
      els.editor.append(node('div', { className: 'empty-state' }, [
        node('span', { className: 'empty-note', text: '♪' }),
        node('h1', { text: context.state.set.songs.length ? 'Выберите песню' : context.state.project ? 'Добавьте песни в проект' : 'Подготовьте первую песню' }),
        node('p', { className: 'hint', text: context.state.set.songs.length ? 'Откройте песню в списке слева.' : 'Добавьте текст, музыку или оба компонента.' }),
        button('Добавить песню', 'button primary', addSong),
      ])); return;
    }
    const validation = validateSong(song);
    const title = input(song.title, 'text', { required: true, autocomplete: 'off' });
    title.addEventListener('change', () => { changeSong(song.id, s => ({ ...s, title: title.value })); render(); });
    const artist = input(song.artist, 'text', { autocomplete: 'off' }); artist.addEventListener('change', () => { changeSong(song.id, s => ({ ...s, artist: artist.value })); render(); });
    const version = input(song.version, 'text', { placeholder: 'Например, студийная версия' }); version.addEventListener('change', () => { changeSong(song.id, s => ({ ...s, version: version.value })); render(); });
    const duration = input(formatDurationInput(song.duration), 'text', { inputmode: 'numeric', placeholder: 'ММ:СС', pattern: '[0-9]+:[0-5][0-9]', 'aria-label': 'Длительность, ММ:СС' });
    duration.addEventListener('change', () => {
      const parsed = parseDurationInput(duration.value);
      if (parsed == null) { toast('Введите длительность в формате ММ:СС; секунды должны быть от 00 до 59.'); render(); return; }
      if (duration.value !== formatDurationInput(song.duration)) { changeSong(song.id, s => ({ ...s, duration: parsed })); render(); }
    });
    const needsConfirmation = !song.reviewed && song.cues.length > 0;
    const statusControl = needsConfirmation
      ? button(status(song), `status-pill is-action${song.reviewed && !validation.length ? ' ready' : ''}`, () => {
        const target = $('#review-confirm');
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' }); target?.focus();
      })
      : node('span', { className: `status-pill${song.reviewed && !validation.length ? ' ready' : ''}`, text: status(song) });
    const header = node('div', { className: 'editor-header' }, [node('div', {}, [node('h1', { className: 'editor-title', text: song.title || 'Новая песня' }), node('p', { className: 'editor-subtitle', text: 'Текст, таймлайн и музыка для выступления' })]), statusControl]);
    const details = node('section', { className: 'section-card' }, [node('h2', { text: 'О песне' }), node('div', { className: 'field-grid' }, [field('Название', title), field('Исполнитель', artist), field('Версия записи', version), field('Длительность, ММ:СС', duration)])]);
    if (editorTabSongId !== song.id) { editorTabSongId = song.id; editorTab = 'lrclib'; }
    const drafts = importDrafts.get(song.id) || { lrc: '', plain: '' }; importDrafts.set(song.id, drafts);
    const panels = {
      lrclib: node('div', { id: 'lrclib-panel', role: 'tabpanel', 'aria-labelledby': 'lrclib-tab', className: 'editor-tab-panel' }, [renderLrclibCard(song)]),
      lrc: node('div', { id: 'lrc-panel', role: 'tabpanel', 'aria-labelledby': 'lrc-tab', className: 'editor-tab-panel' }, [renderImportCard(song, 'lrc', drafts)]),
      plain: node('div', { id: 'plain-panel', role: 'tabpanel', 'aria-labelledby': 'plain-tab', className: 'editor-tab-panel' }, [renderImportCard(song, 'plain', drafts)])
    };
    const timeline = node('div', { className: 'editor-tab-panel' }, [renderCues(song, validation)]);
    const tabs = node('div', { className: 'editor-tabs', role: 'tablist', 'aria-label': 'Подготовка песни' });
    const selectTab = (name, focus = false) => {
      editorTab = name;
      Object.entries(panels).forEach(([key, panel]) => { panel.hidden = name !== key; });
      [...tabs.children].forEach(tab => { const selected = tab.id === `${name}-tab`; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; if (selected && focus) tab.focus(); });
    };
    for (const [name, label] of [['lrclib', 'LRCLIB'], ['lrc', 'Свой LRC'], ['plain', 'Свой текст']]) {
      const tab = button(label, 'button quiet', () => selectTab(name));
      tab.id = `${name}-tab`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', `${name}-panel`);
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const names = ['lrclib', 'lrc', 'plain']; const index = names.indexOf(name); selectTab(event.key === 'Home' ? names[0] : event.key === 'End' ? names.at(-1) : names[(index + (event.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length], true);
      });
      tabs.append(tab);
    }
    selectTab(editorTab);
    // Keep the original player available while tapping in the text tab.
    const listen = node('div', { className: 'audio-preview text-reference', hidden: !song.source?.fileName }, [node('p', { className: 'hint', text: 'Оригинал для разметки' }), previewPlayer]);
    els.editor.append(header, details, tabs, ...Object.values(panels), timeline, listen, renderBackingCard(song), renderReview(song), renderSongActions(song));
    setAudioPreview(song); setBackingPreview(song);
  }
  function formatDurationInput(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function parseDurationInput(value) {
    const match = /^(\d+):([0-5]\d)$/.exec(value.trim());
    const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
    return Number.isFinite(seconds) ? seconds : null;
  }

  function renderBackingCard(song) {
    const file = node('input', { id: 'backing-file', type: 'file', accept: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav', hidden: true });
    const choose = button(song.backing?.fileName ? 'Заменить музыку' : 'Добавить музыку', 'button quiet', () => file.click());
    const remove = button('Удалить музыку', 'button quiet', async () => {
      backingGeneration.set(song.id, (backingGeneration.get(song.id) || 0) + 1);
      if (remoteAudioMode()) context.state.projectEntries.set(song.id, { ...entryFor(song), backingAudioId: null });
      else await deleteBacking(song.id);
      clearBackingPreview();
      changeSong(song.id, s => invalidateChanged(s, { backing: { fileName: '' } })); render();
    });
    remove.hidden = !song.backing?.fileName;
    file.addEventListener('change', async () => {
      const selected = file.files?.[0]; if (!selected) return;
      const run = (backingGeneration.get(song.id) || 0) + 1; backingGeneration.set(song.id, run);
      const owner = audioOwner(), workspace = context.state.workspaceGeneration, session = context.state.sessionActive;
      const current = () => context.state.workspaceGeneration === workspace && audioOwner() === owner && context.state.sessionActive === session && backingGeneration.get(song.id) === run && context.state.set.songs.some(item => item.id === song.id);
      choose.disabled = true; choose.textContent = 'Загрузка музыки…';
      try {
        await checkBackingFile(selected);
        if (!current()) return;
        if (remoteAudioMode()) {
          if (!context.state.sessionActive) throw new Error('Для загрузки музыки нужна связь с сервером.');
          const uploaded = await remote.uploadAudio(selected);
          if (!current()) return;
          await privateMutation(() => { if (current()) return putPrivateAudio(backingKey(uploaded.id), selected); });
          if (!current()) return;
          context.state.projectEntries.set(song.id, { ...entryFor(song), backingAudioId: uploaded.id });
        } else {
          context.state.persistChain = context.state.persistChain.then(() => { if (current()) return putBacking(song.id, selected); });
          await context.state.persistChain;
          if (!current()) return;
        }
        clearBackingPreview(); changeSong(song.id, s => invalidateChanged(s, { backing: { fileName: selected.name }, mediaRevision: crypto.randomUUID() })); render();
      } catch (error) { if (current()) { toast(`Не удалось сохранить музыку: ${error.message}`); render(); } }
    });
    return node('section', { className: 'section-card backing-card' }, [node('h2', { text: 'Музыка' }), node('p', { className: 'hint', text: 'Необязательно. Запускается вместе с текстом; MP3/WAV до 150 МБ и 20 минут;' }), node('div', { className: 'action-row' }, [choose, node('span', { className: 'file-name', text: song.backing?.fileName || 'Без музыки' }), remove]), file, ...(song.backing?.fileName ? [backingPreview] : [])]);
  }

  async function checkBackingFile(file) {
    if (file.size > 150 * 1024 * 1024) throw new Error('Файл больше 150 МиБ.');
    if (!/\.(mp3|wav)$/i.test(file.name)) throw new Error('Выберите файл MP3 или WAV.');
    const player = new Audio(); const url = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Не удалось прочитать аудиофайл.')), 15000);
        player.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(player.duration) && player.duration > 0 && player.duration <= 1200 ? resolve() : reject(new Error('Музыка должна быть не длиннее 20 минут.')); };
        player.onerror = () => { clearTimeout(timer); reject(new Error('Не удалось прочитать MP3 или WAV.')); };
        player.src = url;
      });
    } finally { player.removeAttribute('src'); player.load(); URL.revokeObjectURL(url); }
  }

  function renderAudioCard(song) {
    const file = node('input', { id: 'original-file', type: 'file', accept: 'audio/mpeg,audio/mp3,audio/wav,audio/x-wav', hidden: true });
    const choose = button('Выбрать MP3 или WAV', 'button quiet', () => file.click());
    file.addEventListener('change', async () => { const selected = file.files?.[0]; if (!selected) return; const sourceRun = (sourceGeneration.get(song.id) || 0) + 1; sourceGeneration.set(song.id, sourceRun); const owner = audioOwner(); const sessionAtStart = context.state.sessionActive; const workspaceRun = context.state.workspaceGeneration; const current = () => context.state.workspaceGeneration === workspaceRun && audioOwner() === owner && context.state.sessionActive === sessionAtStart && (sourceGeneration.get(song.id) || 0) === sourceRun; try { recognition.get(song.id)?.controller?.abort(); if (remoteAudioMode()) { if (!sessionAtStart) throw new Error('Для загрузки записи нужна связь с сервером.'); const uploaded = await remote.uploadAudio(selected); if (!current()) return; context.state.projectEntries.set(song.id, { ...entryFor(song), audioId: uploaded.id }); const audioKey = `${owner}:${song.id}`; await privateMutation(() => putPrivateAudio(audioKey, selected)); if (!current()) { await privateMutation(() => removePrivateAudio(audioKey)); return; } } else { await putAudio(song.id, selected); if (!current()) return; } if (context.state.audioSongId === song.id) clearAudioPreview(); changeSong(song.id, s => invalidateChanged(s, { source: { kind: 'audio', fileName: selected.name }, mediaRevision: crypto.randomUUID() })); render(); } catch (error) { if (current()) toast(`Не удалось сохранить запись: ${error.message}`); } });
    const card = node('section', { className: 'section-card' }, [node('h2', { text: 'Оригинальная запись' }), node('p', { className: 'hint', text: 'Запись нужна для распознавания, прослушивания и разметки. На выступлении она не проигрывается из приложения.' }), node('div', { className: 'action-row' }, [choose, node('span', { className: 'file-name', text: song.source?.fileName || 'Файл не выбран' })]), file]);
    if (song.source?.fileName) card.append(node('div', { className: 'audio-preview' }, [previewPlayer, renderRecognition(song)]));
    return card;
  }
  function renderRecognition(song) {
    const job = recognition.get(song.id); const wrap = node('div', {}); const profile = node('select', { 'aria-label': 'Профиль распознавания' }); profile.append(node('option', { value: 'quality', text: 'Качество — крупнее модель' }), node('option', { value: 'fast', text: 'Быстрее — меньше модель' })); profile.value = recognitionProfiles.get(song.id) || 'quality'; profile.addEventListener('change', () => { recognitionProfiles.set(song.id, profile.value); recognition.get(song.id)?.controller?.abort(); renderEditor(); }); wrap.append(node('p', { className: 'hint', text: 'Первый запуск скачает модель. Профиль «Качество» требует больше времени и памяти на ноутбуке; при ошибке выберите «Быстрее» или подготовьте текст вручную/LRC.' }), profile);
    if (job) { wrap.append(node('p', { className: `recognition-progress${job.error ? ' error' : ''}`, text: job.message || 'Подготовка…' })); wrap.append(button(job.controller ? 'Отменить' : 'Повторить', 'button quiet', () => job.controller ? job.controller.abort() : startRecognition(song))); return wrap; }
    wrap.append(button(song.cues.length ? 'Рассчитать время по тексту' : 'Распознать MP3', 'button primary', () => startRecognition(song))); return wrap;
  }
  async function startRecognition(song) {
    if (recognition.get(song.id)?.controller) return;
    const controller = new AbortController(); const owner = audioOwner(); const sessionAtStart = context.state.sessionActive; const sourceRun = sourceGeneration.get(song.id) || 0; const workspaceRun = context.state.workspaceGeneration; const profile = recognitionProfiles.get(song.id) || 'quality'; const current = () => context.state.workspaceGeneration === workspaceRun && audioOwner() === owner && context.state.sessionActive === sessionAtStart && (sourceGeneration.get(song.id) || 0) === sourceRun; recognition.set(song.id, { controller, message: 'Подготовка распознавания…' }); renderEditor();
    try { const blob = remoteAudioMode() ? ((await getPrivateAudio(`${owner}:${song.id}`)) || (entryFor(song).audioId ? await remote.downloadAudio(entryFor(song).audioId) : null)) : await getAudio(song.id); if (!blob) throw new Error('Сначала выберите запись.'); if (controller.signal.aborted) throw new DOMException('Распознавание отменено', 'AbortError'); const inputVersion = JSON.stringify({ source: song.source, cues: song.cues }); const lyrics = song.cues.length ? structuredClone(song.cues) : undefined; const result = await recognizeFile(new File([blob], song.source?.fileName || 'recording.mp3', { type: blob.type }), { language: song.language || 'ru', profile, lyrics, signal: controller.signal, onProgress: (progress) => { if (!current()) return; const message = progress.message || 'Распознаём…'; recognition.set(song.id, { controller, message }); if (currentSong()?.id === song.id) { const label = $('.recognition-progress'); if (label) label.textContent = message; } } });
      if (!result?.cues?.length || !result.cues.some((cue) => String(cue.text || '').trim())) throw new Error('Не удалось получить текст из записи. Добавьте текст вручную и расставьте строки.');
      const latest = context.state.set.songs.find((item) => item.id === song.id);
      if (!current()) return;
      if (!latest || JSON.stringify({ source: latest.source, cues: latest.cues }) !== inputVersion) throw new Error('Текст или запись изменились во время расчёта. Результат не был применён.');
      const question = lyrics ? `Будут применены только предложенные времена; без уверенного совпадения останется: ${result.alignment?.unresolved ?? 0}.` : 'Результат распознавания заменит текущий текст и таймлайн.';
      await replaceCues(latest, result.cues, { duration: result.duration || latest.duration, source: result.source || { kind: 'recognition', fileName: latest.source?.fileName || '' } }, question, () => !controller.signal.aborted && JSON.stringify({ source: currentSong()?.source, cues: currentSong()?.cues }) === inputVersion); recognition.delete(song.id); render();
    } catch (error) { if (!current()) return; recognition.set(song.id, { error: true, message: error.name === 'AbortError' ? 'Распознавание отменено. Данные песни не изменены.' : error.message }); renderEditor(); }
  }
  function renderLrclibCard(song) {
    const state = lrclibState ||= { context: lrclibContext(), title: song.title || '', artist: song.artist || '', token: 0, results: [], selected: null, loading: false, message: '', snapshot: null };
    const title = input(state.title, 'text', { id: 'lrclib-title', required: true, maxlength: 300, autocomplete: 'off' });
    const artist = input(state.artist, 'text', { id: 'lrclib-artist', maxlength: 300, autocomplete: 'off' });
    const search = node('button', { type: 'submit', className: 'button quiet', text: 'Найти LRC' });
    const cancel = button('Отменить поиск', 'button quiet', () => {
      state.controller?.abort(); state.token += 1; state.loading = false;
      state.message = 'Поиск отменён. Данные песни не изменены.'; state.paint();
    });
    cancel.id = 'lrclib-cancel';
    const status = node('p', { id: 'lrclib-status', className: 'hint', role: 'status', 'aria-live': 'polite' });
    const results = node('div', { className: 'lrclib-results' });
    const preview = node('div', { className: 'lrclib-preview-wrap' });
    const active = () => lrclibState === state && state.context === lrclibContext() && !context.state.offlineProjectOpen;
    const unchanged = () => active() && JSON.stringify(currentSong()) === state.snapshot;
    const importRecord = async (record, plain = false) => {
      if (!unchanged()) { state.message = 'Песня изменилась. Повторите поиск перед импортом.'; state.paint(); return; }
      const token = state.token;
      try {
        const latest = currentSong();
        const prepared = plain ? preparePlainImport(latest, record) : prepareLrcImport(latest, record);
        const isCurrent = () => unchanged() && state.token === token && state.results.includes(record) && (plain || state.selected === record);
        const applied = await replaceCues(latest, prepared.cues, prepared.details, 'Импорт из LRCLIB заменит текущий текст и таймлайн.', isCurrent);
        if (!active()) return;
        if (state.token !== token || !state.results.includes(record) || (!plain && state.selected !== record)) return;
        if (applied) {
          state.snapshot = JSON.stringify(currentSong());
          const duration = currentSong().duration;
          const mismatch = record.duration > 0 && duration > 0 && record.duration !== duration
            ? ` Длительность LRCLIB: ${record.duration} сек.; ваша песня: ${duration} сек. Проверьте совпадение версии.` : '';
          state.message = plain
            ? `Текст импортирован с пустыми таймкодами. Проверьте строки и включите «игнорировать таймкоды» или разметьте время.${record.duration > 0 ? '' : ' Длительность LRCLIB отсутствует: укажите её вручную.'}`
            : `LRC импортирован. Проверьте текст и таймкоды по своей записи перед подтверждением готовности.${mismatch}`;
        } else if (!unchanged()) state.message = 'Песня изменилась. Повторите поиск перед импортом.';
        state.paint();
      } catch (error) { if (active()) { state.message = error.message; state.paint(); } }
    };
    state.paint = () => {
      status.textContent = context.state.offlineProjectOpen
        ? 'Поиск LRCLIB недоступен в автономном снимке. Для редактирования откройте проект с сервера.'
        : !navigator.onLine ? 'Поиск LRCLIB доступен при подключении к интернету. Можно вставить LRC вручную.' : state.message;
      status.hidden = !status.textContent;
      search.disabled = state.loading || !state.title.trim() || context.state.offlineProjectOpen;
      search.textContent = state.loading ? 'Поиск…' : 'Найти LRC';
      cancel.hidden = !state.loading;
      results.replaceChildren(...state.results.map(record => {
        const available = hasSynchronizedLyrics(record);
        const select = button(available ? 'Просмотреть LRC' : 'LRC недоступен', 'button quiet', () => { state.selected = record; state.paint(); });
        select.disabled = !available;
        const plainImport = !available && button('Вставить чистый текст', 'button quiet', () => importRecord(record, true));
        if (plainImport) { plainImport.disabled = !hasPlainLyrics(record); plainImport.title = plainImport.disabled ? 'У записи нет обычного текста.' : 'Вставить текст без таймкодов и длительность выбранной записи'; }
        const duration = Number.isFinite(record.duration) ? displayTime(record.duration) : 'длительность неизвестна';
        return node('div', { className: `lrclib-result${state.selected === record ? ' selected' : ''}` }, [
          node('div', { className: 'lrclib-record' }, [node('strong', { text: record.trackName }), node('span', { text: record.artistName || 'Исполнитель не указан' }), node('span', { className: 'hint', text: `${record.albumName || 'Альбом не указан'} · ${duration} · ${available ? 'Есть LRC' : record.instrumental ? 'Инструментальная запись' : 'Без таймкодов'}` })]), node('div', { className: 'action-row' }, [select, plainImport]),
        ]);
      }));
      preview.replaceChildren();
      if (state.selected && hasSynchronizedLyrics(state.selected)) {
        const lrc = node('textarea', { id: 'lrclib-preview', readonly: true, 'aria-label': 'Предпросмотр LRC' });
        lrc.value = state.selected.syncedLyrics;
        const apply = button('Импортировать LRC', 'button primary', () => importRecord(state.selected)); apply.id = 'lrclib-import';
        preview.append(node('p', { className: 'hint', text: 'Проверьте, что версия и длительность совпадают с вашей оригинальной записью или музыкой.' }), field('LRC выбранной записи', lrc), apply);
      }
    };
    for (const [control, key] of [[title, 'title'], [artist, 'artist']]) {
      control.addEventListener('input', () => {
        state[key] = control.value; state.controller?.abort(); state.token += 1;
        state.loading = false; state.results = []; state.selected = null; state.message = ''; state.paint();
      });
    }
    const form = node('form', { id: 'lrclib-search-form' }, [node('div', { className: 'field-grid' }, [field('Название для поиска', title), field('Исполнитель для поиска (необязательно)', artist)]), node('div', { className: 'action-row' }, [search, cancel])]);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!active() || state.loading || !state.title.trim()) return;
      state.results = []; state.selected = null;
      if (!navigator.onLine) { state.message = 'Поиск LRCLIB доступен при подключении к интернету. Можно вставить LRC вручную.'; state.paint(); return; }
      state.controller = new AbortController(); const token = ++state.token;
      state.snapshot = JSON.stringify(currentSong()); state.loading = true; state.message = 'Ищем LRC…'; state.paint();
      try {
        const found = await lrclibClient.search({ title: state.title, artist: state.artist, signal: state.controller.signal });
        if (!active() || token !== state.token) return;
        if (!unchanged()) { state.message = 'Песня изменилась. Повторите поиск перед импортом.'; return; }
        state.results = found; state.message = found.length ? `Найдено записей: ${found.length}. Выберите подходящую версию.` : 'Ничего не найдено. Уточните название или исполнителя и повторите поиск.';
      } catch (error) { if (active() && token === state.token) state.message = error.message; }
      finally { if (active() && token === state.token) { state.loading = false; state.paint(); } }
    });
    state.paint();
    return node('section', { className: 'section-card lrclib-card' }, [node('h2', { text: 'Найти LRC в LRCLIB' }), form, status, results, preview]);
  }

  function renderImportCard(song, mode, drafts) {
    const lrc = mode === 'lrc' ? node('textarea', { placeholder: '[00:12.50] Первая строка\n[00:18.10] Вторая строка' }) : null;
    const plain = mode === 'plain' ? node('textarea', { placeholder: 'Первая строка\nВторая строка\nПрипев' }) : null;
    const control = lrc || plain; control.value = drafts[mode]; control.addEventListener('input', () => { drafts[mode] = control.value; });
    const loadLrc = lrc && button('Заменить из LRC', 'button quiet', async () => { try { const parsed = parseLrc(lrc.value); if (!parsed.cues.length) throw new Error('В LRC не найдено строк с таймкодами.'); await replaceCues(song, parsed.cues, {}, 'Импорт LRC заменит текущий текст и таймлайн.'); } catch (error) { toast(error.message); } });
    const loadPlain = plain && button('Вставить строки', 'button quiet', () => { const cues = plain.value.split(/\r?\n/).filter(Boolean).map((text, i) => ({ id: `paste-${Date.now()}-${i}`, start: null, text, type: 'lyric' })); if (cues.length) replaceCues(song, cues, {}, 'Вставка текста заменит текущие строки.'); else toast('Добавьте хотя бы одну строку.'); });
    return node('section', { className: 'section-card' }, [node('h2', { text: mode === 'lrc' ? 'Свой LRC' : 'Свой текст' }), node('p', { className: 'hint', text: 'Вставьте готовый LRC или обычный текст. Все повторения припева добавляйте отдельными строками.' }), field(mode === 'lrc' ? 'LRC с таймкодами' : 'Обычный текст', control), loadLrc || loadPlain]);
  }
  async function replaceCues(song, cues, details, question, isCurrent = () => true) {
    if (song.cues.length && !(await confirmReplace(question))) return false;
    if (!isCurrent()) return false;
    changeSong(song.id, s => invalidateChanged(s, { ...details, cues: cues.map((cue, i) => ({ id: cue.id || `cue-${Date.now()}-${i}`, start: Number.isFinite(cue.start) ? cue.start : null, text: String(cue.text || ''), type: cue.type === 'rest' ? 'rest' : 'lyric' })) })); render(); return true;
  }
  function confirmReplace(message) { const dialog = $('#confirm-dialog'); $('#confirm-text').textContent = message; return new Promise((resolve) => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); }); }
  function renderCues(song, validation) {
    const card = node('section', { className: 'section-card' }); const table = node('div', { className: 'cue-table' });
    let deferCueRender = false;
    let pendingCueRender = false;
    let nativeDragActive = false;
    const estimateKey = cueId => `${song.id}/${cueId}`;
    const commitFocusedEdit = () => {
      const focused = document.activeElement;
      if (els.editor.contains(focused) && focused.matches('input,textarea,select')) focused.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const cueActionButton = (label, className, action) => {
      const control = button(label, className, action);
      // Preserve the click target until its handler commits any focused edit.
      control.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
      return control;
    };
    const resolveBoundary = (current, destination) => typeof destination === 'function' ? destination(current) : destination;
    const focusCue = (cueId, control) => {
      const row = [...els.editor.querySelectorAll('.cue-row')].find(item => item.dataset.cueId === cueId);
      const target = row?.querySelector(control);
      (target?.disabled ? row.querySelector('.cue-drag-handle') : target)?.focus();
    };
    const insertRest = destination => {
      commitFocusedEdit();
      const latest = currentSong();
      if (!latest || latest.id !== song.id) return;
      const boundary = resolveBoundary(latest, destination);
      if (!Number.isInteger(boundary) || boundary < 0 || boundary > latest.cues.length) return;
      const cueId = `cue-${crypto.randomUUID()}`;
      estimatedRestStarts.add(estimateKey(cueId));
      changeSong(song.id, () => insertRestCue(latest, boundary, cueId));
      render(); focusCue(cueId, '.cue-time');
    };
    const moveCue = (cueId, destination, focusControl = '.cue-drag-handle') => {
      commitFocusedEdit();
      const latest = currentSong();
      if (!latest || latest.id !== song.id) return;
      const moved = moveCueToBoundary(latest, cueId, resolveBoundary(latest, destination));
      if (moved === latest) return;
      changeSong(song.id, () => moved);
      pendingCueRender = false; render(); focusCue(cueId, focusControl);
    };
    const tapCue = index => {
      if (!song.backing?.fileName) return;
      if (!backingPreview.src || backingPreviewId !== `${project?.id || 'local'}:${song.id}:${entryFor(song).backingAudioId || song.backing.fileName}`) { toast('Сначала запустите музыку.'); return; }
      changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.map((cue, i) => i === index ? { ...cue, start: backingPreview.currentTime } : cue) })); render();
    };
    card.append(node('div', { className: 'cue-toolbar' }, [node('div', {}, [node('h2', { text: 'Строки таймлайна' }), node('p', { className: 'hint', text: 'Время — начало строки. Отмечайте начало кнопкой с часами у строки.' })])]));
    const ignore = input('', 'checkbox', { id: 'ignore-timecodes' });
    ignore.checked = song.ignoreTimecodes === true;
    ignore.addEventListener('change', () => { changeSong(song.id, s => ({ ...s, ignoreTimecodes: ignore.checked })); render(); });
    const autoScroll = input('', 'checkbox', { id: 'auto-scroll-enabled' });
    autoScroll.checked = song.autoScrollEnabled !== false;
    autoScroll.addEventListener('change', () => {
      changeSong(song.id, current => ({ ...current, autoScrollEnabled: autoScroll.checked }));
      updateAutoScrollVisibility();
    });
    const autoScrollLabel = node('label', { className: 'ignore-timecodes auto-scroll-label' }, [autoScroll, node('span', { text: 'начинать автоскролл через, сек' })]);
    const autoScrollStart = input(song.autoScrollStartSeconds ?? 10, 'number', { min: '0', step: '1', className: 'auto-scroll-delay', 'aria-label': 'начинать автоскролл через, сек' });
    autoScrollStart.addEventListener('change', () => {
      const value = Number(autoScrollStart.value);
      if (!Number.isSafeInteger(value) || value < 0) { autoScrollStart.value = String(song.autoScrollStartSeconds ?? 10); return; }
      if (value === (song.autoScrollStartSeconds ?? 10)) return;
      changeSong(song.id, current => ({ ...current, autoScrollStartSeconds: value }));
      render();
    });
    const scrollStart = song.autoScrollStartSeconds ?? 10;
    const scrollStartHint = node('p', { className: 'hint', text: `Без таймкодов текст прокручивается равномерно: с ${scrollStart}-й секунды до конца песни.` });
    const manualScrollHint = node('p', { className: 'hint', text: 'Автоскролл выключен — в режиме показа текст прокручивается только вручную.' });
    const autoScrollSettings = node('div', { className: 'auto-scroll-settings' }, [autoScrollLabel, autoScrollStart]);
    const timeShift = input('', 'number', { id: 'cue-time-shift', step: 'any', inputmode: 'decimal', 'aria-label': 'Подвинуть время, секунды' });
    const applyTimeShift = button('Применить', 'button quiet', () => {
      if (timeShift.value.trim() === '' || !Number.isFinite(Number(timeShift.value))) {
        toast('Введите конечное число секунд для сдвига.');
        return;
      }
      const shift = Number(timeShift.value);
      const cueCount = song.cues.filter(cue => Number.isFinite(cue.start)).length;
      if (!cueCount || shift === 0) return;
      changeSong(song.id, current => invalidateChanged(current, {
        cues: current.cues.map(cue => Number.isFinite(cue.start) ? { ...cue, start: cue.start + shift } : cue),
      }));
      render();
    });
    const timeShiftControls = node('div', { className: 'time-shift-controls' }, [
      node('label', { htmlFor: 'cue-time-shift', text: 'Подвинуть время, сек' }),
      timeShift,
      applyTimeShift,
    ]);
    const updateAutoScrollVisibility = () => {
      autoScrollSettings.hidden = !ignore.checked;
      autoScrollStart.hidden = !ignore.checked || !autoScroll.checked;
      scrollStartHint.hidden = !ignore.checked || !autoScroll.checked;
      manualScrollHint.hidden = !ignore.checked || autoScroll.checked;
    };
    updateAutoScrollVisibility();
    const ignoreLabel = node('label', { className: 'ignore-timecodes cue-ignore-timecodes has-tooltip', 'data-tooltip': 'выберите если таймкоды недоступны', title: 'выберите если таймкоды недоступны' }, [ignore, node('span', { text: 'игнорировать таймкоды' })]);
    card.append(ignoreLabel, autoScrollSettings, scrollStartHint, manualScrollHint, timeShiftControls);
    let draggedCueId = null;
    const boundaries = [];
    const indicateBoundary = boundary => {
      boundaries.forEach((item, index) => item.classList.toggle('cue-drop-target', index === boundary));
    };
    const clearDrag = () => {
      draggedCueId = null; nativeDragActive = false; indicateBoundary(null);
      table.querySelectorAll('.cue-dragging').forEach(row => row.classList.remove('cue-dragging'));
    };
    const flushCueRender = () => { if (pendingCueRender) { pendingCueRender = false; render(); } };
    const allowDrop = (event, boundary) => {
      if (!draggedCueId) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; indicateBoundary(boundary);
    };
    const dropAt = (event, boundary) => {
      if (!draggedCueId) return;
      event.preventDefault();
      const cueId = draggedCueId; clearDrag(); moveCue(cueId, boundary);
    };
    for (let boundary = 0; boundary <= song.cues.length; boundary += 1) {
      const target = node('div', { className: 'cue-boundary', 'data-cue-boundary': boundary });
      if (boundary === 0) {
        const label = song.cues.length ? 'Вставить проигрыш перед первой строкой' : 'Вставить проигрыш в пустой таймлайн';
        const insert = cueActionButton('+ ♪', 'button quiet cue-insert-start', () => insertRest(0));
        insert.setAttribute('aria-label', label); insert.title = label; target.append(insert);
      }
      target.addEventListener('dragover', event => allowDrop(event, boundary));
      target.addEventListener('drop', event => dropAt(event, boundary));
      boundaries.push(target);
    }
    table.addEventListener('dragleave', event => { if (!table.contains(event.relatedTarget)) indicateBoundary(null); });
    table.addEventListener('keydown', event => { if (event.key === 'Escape') clearDrag(); });
    song.cues.forEach((cue, index) => { const time = input(cue.start == null ? '' : formatTime(cue.start), 'text', { className: 'cue-time', 'aria-label': `Время строки ${index + 1}` }); const text = input(cue.text, 'text', { className: 'cue-text', 'aria-label': `Текст строки ${index + 1}` }); const type = node('select', { className: 'cue-type', 'aria-label': `Тип строки ${index + 1}` }); type.append(node('option', { value: 'lyric', text: 'Текст' }), node('option', { value: 'rest', text: 'Проигрыш' })); type.value = cue.type;
      const initialValues = new Map([[time, time.value], [text, text.value], [type, type.value]]);
      const update = event => { if (event.target.value === initialValues.get(event.target)) return; initialValues.set(event.target, event.target.value); if (event.target === time || type.value !== 'rest') estimatedRestStarts.delete(estimateKey(cue.id)); changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.map(item => item.id === cue.id ? { ...item, start: event.target === time ? parseTime(time.value) : item.start, text: text.value, type: type.value } : item) })); if (deferCueRender) pendingCueRender = true; else render(); }; time.addEventListener('change', update); text.addEventListener('change', update); type.addEventListener('change', update);
      const retapLabel = song.backing?.fileName ? `Отметить строку ${index + 1} по текущему времени музыки` : 'загрузите музыку для разметки строк по мере воспроизведения';
      const retap = button('◷', 'button quiet has-tooltip cue-retap', () => { estimatedRestStarts.delete(estimateKey(cue.id)); tapCue(index); }); retap.setAttribute('aria-label', retapLabel); retap.setAttribute('data-tooltip', retapLabel); retap.title = retapLabel; retap.disabled = !song.backing?.fileName;
      const insertRestAfter = cueActionButton('+ ♪', 'button quiet cue-insert-rest', () => insertRest(current => {
        const currentIndex = current.cues.findIndex(item => item.id === cue.id);
        return currentIndex < 0 ? -1 : currentIndex + 1;
      }));
      const insertLabel = `Вставить проигрыш после строки ${index + 1}`;
      insertRestAfter.setAttribute('aria-label', insertLabel); insertRestAfter.title = insertLabel;
      const removeLabel = `Удалить строку ${index + 1}`;
      const remove = button('×', 'button quiet has-tooltip cue-remove', () => { estimatedRestStarts.delete(estimateKey(cue.id)); changeSong(song.id, s => invalidateChanged(s, { cues: s.cues.filter(item => item.id !== cue.id) })); render(); }); remove.setAttribute('aria-label', removeLabel); remove.setAttribute('data-tooltip', removeLabel);
      const handle = button('⠿', 'button quiet cue-drag-handle', () => {});
      handle.draggable = true; handle.setAttribute('aria-label', `Перетащить строку ${index + 1}`); handle.title = 'Перетащите строку или используйте стрелки рядом';
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !table.contains(document.activeElement) || !document.activeElement.matches('input,select')) return;
        // Keep the native drag target mounted while committing a pending row edit.
        // Unlike preventing pointerdown, this preserves the browser's drag gesture.
        deferCueRender = true;
        try { commitFocusedEdit(); } finally { deferCueRender = false; }
      });
      handle.addEventListener('pointerup', () => { if (!nativeDragActive) flushCueRender(); });
      handle.addEventListener('pointercancel', () => { if (!nativeDragActive) flushCueRender(); });
      const up = cueActionButton('↑', 'button quiet cue-move-up', () => moveCue(cue.id, current => current.cues.findIndex(item => item.id === cue.id) - 1, '.cue-move-up'));
      up.disabled = index === 0; up.setAttribute('aria-label', `Поднять строку ${index + 1}`);
      const down = cueActionButton('↓', 'button quiet cue-move-down', () => moveCue(cue.id, current => current.cues.findIndex(item => item.id === cue.id) + 2, '.cue-move-down'));
      down.disabled = index === song.cues.length - 1; down.setAttribute('aria-label', `Опустить строку ${index + 1}`);
      const row = node('div', { className: `cue-row${cue.type === 'rest' ? ' rest' : ''}`, 'data-cue-id': cue.id }, [node('div', { className: 'cue-reorder' }, [handle, up, down]), time, text, type, insertRestAfter, retap, remove]);
      if (cue.type === 'rest') {
        const estimated = estimatedRestStarts.has(estimateKey(cue.id));
        const end = song.cues[index + 1]?.start;
        const until = index + 1 < song.cues.length ? `До следующей строки${Number.isFinite(end) ? ` (${formatTime(end)})` : ' — задайте её время'}.` : `До конца песни (${formatTime(song.duration)}).`;
        const noteId = `cue-note-${index}`;
        row.append(node('p', { id: noteId, className: 'cue-note' }, [estimated && node('span', { className: 'cue-estimate', text: 'Примерное начало — проверьте. ' }), node('span', { text: until })]));
        time.setAttribute('aria-describedby', noteId);
      }
      handle.addEventListener('dragstart', event => {
        draggedCueId = cue.id; nativeDragActive = true; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', cue.id);
        event.dataTransfer.setDragImage(row, 20, 20); row.classList.add('cue-dragging');
      });
      handle.addEventListener('dragend', () => { clearDrag(); flushCueRender(); });
      const rowBoundary = event => event.clientY < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2 ? index : index + 1;
      row.addEventListener('dragover', event => allowDrop(event, rowBoundary(event)));
      row.addEventListener('drop', event => dropAt(event, rowBoundary(event)));
      table.append(boundaries[index], row);
    }); table.append(boundaries.at(-1)); card.append(table);
    if (validation.length) card.append(node('ul', { className: 'validation' }, validation.map((message) => node('li', { text: message })))); return card;
  }
  function renderReview(song) {
    const needsConfirmation = !song.reviewed && song.cues.length > 0;
    const card = node('section', { className: 'review-row' });
    if (needsConfirmation) card.append(node('p', { text: 'Прослушайте запись, проверьте каждую строку и только затем отметьте песню готовой.' }));
    const actions = node('div', { className: 'review-actions' });
    if (needsConfirmation) {
      const confirm = button('Подтвердить готовность', 'button primary', () => {
      // Commit the focused edit before validating; its change handler can rebuild the editor.
      const focused = document.activeElement;
      if (els.editor.contains(focused) && focused.matches('input,textarea,select')) focused.dispatchEvent(new Event('change', { bubbles: true }));
      const latest = currentSong();
      if (!latest || latest.id !== song.id) return;
      const trial = { ...latest, reviewed: true };
      if (validateSong(trial).length) { toast('Сначала исправьте ошибки в таймлайне.'); return; }
      changeSong(song.id, () => trial); render();
      });
      confirm.id = 'review-confirm';
      // Keep focus until click so a blur-triggered render cannot remove the click target.
      confirm.addEventListener('pointerdown', event => { if (event.button === 0) event.preventDefault(); });
      actions.append(confirm);
    }
    actions.append(createDeleteButton(song));
    card.append(actions); return card;
  }

  function createDeleteButton(song) {
    const projectMode = Boolean(context.state.project || context.state.localProjectId);
    const libraryMode = Boolean(context.state.onlineSongOpen);
    const libraryDelete = libraryMode;
    const del = button(projectMode ? 'Убрать из проекта' : 'Удалить песню', 'button danger', async () => {
      const question = projectMode ? 'Убрать песню только из этого проекта?' : libraryMode ? 'Удалить песню из облачной библиотеки и всех облачных проектов?' : 'Удалить песню и локальную запись?';
      if (!libraryDelete && !confirm(question)) return;
      recognition.get(song.id)?.controller?.abort();
      if (libraryDelete) {
        try { await context.actions.deleteLibrarySong(song); }
        catch (error) { toast(`Не удалось удалить песню: ${error.message}`); }
        return;
      }
      if (!context.state.project && !context.state.localProjectId) await Promise.all([deleteAudio(song.id), deleteBacking(song.id)]).catch(() => {});
      context.state.projectEntries.delete(song.id);
      context.state.set = { ...context.state.set, songs: context.state.set.songs.filter((s) => s.id !== song.id) };
      context.state.selectedId = null;
      if (context.state.project || context.state.localProjectId) markRemoteDirty(); else persist();
      render();
    });
    return del;
  }

  function renderSongActions(song) {
    const libraryMode = Boolean(context.state.onlineSongOpen);
    const controls = [];
    const validation = validateSong(song);
    const ready = song.reviewed && validation.length === 0;
    const saveHint = validation.length
      ? `Исправьте ошибки перед сохранением: ${validation.join(' ')}`
      : !song.reviewed ? 'Сначала подтвердите готовность песни.' : 'Песня готова к сохранению.';
    const saveButton = label => {
      const control = button(label, 'button primary', async () => {
        const latest = currentSong();
        const errors = latest ? validateSong(latest) : ['Песня больше не открыта.'];
        if (!latest || !latest.reviewed || errors.length) { toast(errors.length ? `Исправьте ошибки перед сохранением: ${errors.join(' ')}` : 'Сначала подтвердите готовность песни.'); return; }
        try { await context.actions.saveLibrarySong(); }
        catch (error) { toast(`Не удалось сохранить песню: ${error.message}`); }
      });
      control.disabled = !ready;
      control.title = ready ? label : saveHint;
      control.setAttribute('aria-label', ready ? label : `${label}. ${saveHint}`);
      control.setAttribute('data-tooltip', ready ? label : saveHint);
      return control;
    };
    if (libraryMode) controls.push(saveButton('Сохранить в облаке'));
    return node('div', { className: 'song-actions' }, [node('div', { className: 'action-row' }, controls)]);
  }

  return { renderEditor, cancelLrclib, resetPreparation, resetEditorTab, refreshConnectivity: () => lrclibState?.paint() };
}
