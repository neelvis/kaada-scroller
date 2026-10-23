/** Pure data and timeline helpers for the portable lyrics application. */

const SCHEMA_VERSION = 1;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_SONGS = 100;
const MAX_CUES_PER_SONG = 5000;
const MAX_TEXT_LENGTH = 20_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function id(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function finiteNumber(value, fallback = null) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function importError(message) {
  return new Error(`Нельзя импортировать набор: ${message}`);
}

function assertSafeTree(value, depth = 0) {
  if (depth > 25) throw importError('слишком глубокая структура данных.');
  if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
    throw importError('слишком длинное текстовое поле.');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertSafeTree(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    if (!plainObject(value)) throw importError('ожидался обычный JSON-объект.');
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw importError('обнаружено недопустимое поле.');
      assertSafeTree(value[key], depth + 1);
    }
  }
}

function text(value, field, { optional = false, max = MAX_TEXT_LENGTH } = {}) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string') throw importError(`поле «${field}» должно быть строкой.`);
  if (value.length > max) throw importError(`поле «${field}» слишком длинное.`);
  return value;
}

function identifier(value, field) {
  const result = text(value, field, { max: 200 });
  if (!result.trim()) throw importError(`поле «${field}» не может быть пустым.`);
  return result;
}

function numberOrNull(value, field) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw importError(`поле «${field}» должно быть конечным числом или null.`);
  }
  return value;
}

function sanitizeCue(raw, songNumber, cueNumber) {
  if (!plainObject(raw)) throw importError(`песня ${songNumber}, строка ${cueNumber}: ожидался объект.`);
  const type = raw.type === undefined ? 'lyric' : raw.type;
  if (type !== 'lyric' && type !== 'rest') {
    throw importError(`песня ${songNumber}, строка ${cueNumber}: неизвестный тип строки.`);
  }
  return {
    id: identifier(raw.id, `id строки ${cueNumber}`),
    start: numberOrNull(raw.start, `время строки ${cueNumber}`),
    text: text(raw.text, `текст строки ${cueNumber}`),
    type,
  };
}

function sanitizeSong(raw, songNumber) {
  if (!plainObject(raw)) throw importError(`песня ${songNumber}: ожидался объект.`);
  if (raw.schemaVersion !== SCHEMA_VERSION) throw importError(`песня ${songNumber}: неподдерживаемая версия схемы.`);
  if (!Array.isArray(raw.cues) || raw.cues.length > MAX_CUES_PER_SONG) {
    throw importError(`песня ${songNumber}: некорректное или слишком большое число строк.`);
  }
  if (!plainObject(raw.source)) throw importError(`песня ${songNumber}: отсутствуют сведения об источнике.`);
  const sourceKind = text(raw.source.kind, `источник песни ${songNumber}`, { max: 100 });
  const sourceFileName = text(raw.source.fileName, `имя файла песни ${songNumber}`, { optional: true, max: 1000 });
  const duration = numberOrNull(raw.duration, `длительность песни ${songNumber}`);
  if (duration === null) throw importError(`песня ${songNumber}: длительность должна быть числом.`);
  if (typeof raw.delayMs !== 'number' || !Number.isFinite(raw.delayMs)) {
    throw importError(`песня ${songNumber}: задержка должна быть конечным числом.`);
  }
  if (typeof raw.reviewed !== 'boolean') throw importError(`песня ${songNumber}: reviewed должен быть true или false.`);
  if (raw.ignoreTimecodes !== undefined && typeof raw.ignoreTimecodes !== 'boolean') throw importError(`песня ${songNumber}: ignoreTimecodes должен быть true или false.`);
  if (raw.autoScrollEnabled !== undefined && typeof raw.autoScrollEnabled !== 'boolean') throw importError(`песня ${songNumber}: autoScrollEnabled должен быть true или false.`);
  if (raw.includeBackingInShow !== undefined && typeof raw.includeBackingInShow !== 'boolean') throw importError(`песня ${songNumber}: includeBackingInShow должен быть true или false.`);
  if (raw.autoScrollStartSeconds !== undefined && (!Number.isSafeInteger(raw.autoScrollStartSeconds) || raw.autoScrollStartSeconds < 0)) {
    throw importError(`песня ${songNumber}: время начала автоскролла должно быть неотрицательным целым числом.`);
  }
  if (raw.backing !== undefined && !plainObject(raw.backing)) throw importError(`песня ${songNumber}: некорректная минусовка.`);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: identifier(raw.id, `id песни ${songNumber}`),
    title: text(raw.title, `название песни ${songNumber}`, { max: 1000 }),
    artist: text(raw.artist, `исполнитель песни ${songNumber}`, { optional: true, max: 1000 }),
    version: text(raw.version, `версия песни ${songNumber}`, { optional: true, max: 1000 }),
    album: text(raw.album, `альбом песни ${songNumber}`, { optional: true, max: 1000 }),
    cover: typeof raw.cover === 'string' ? raw.cover : '',
    language: text(raw.language, `язык песни ${songNumber}`, { optional: true, max: 100 }),
    duration,
    delayMs: raw.delayMs,
    ignoreTimecodes: raw.ignoreTimecodes === true,
    autoScrollEnabled: raw.autoScrollEnabled !== false,
    includeBackingInShow: raw.includeBackingInShow !== false,
    autoScrollStartSeconds: raw.autoScrollStartSeconds === undefined ? 10 : raw.autoScrollStartSeconds,
    cues: raw.cues.map((cue, index) => sanitizeCue(cue, songNumber, index + 1)),
    reviewed: raw.reviewed,
    ...(raw.mediaRevision === undefined ? {} : { mediaRevision: text(raw.mediaRevision, 'версия аудиофайлов', { max: 200 }) }),
    source: { kind: sourceKind, fileName: sourceFileName },
    ...(raw.backing === undefined ? {} : { backing: { fileName: text(raw.backing.fileName, `имя минусовки песни ${songNumber}`, { optional: true, max: 1000 }) } }),
  };
}

function sanitizeSet(raw) {
  if (!plainObject(raw)) throw importError('корень должен быть объектом.');
  if (raw.schemaVersion !== SCHEMA_VERSION) throw importError('неподдерживаемая версия схемы.');
  if (!Array.isArray(raw.songs) || raw.songs.length > MAX_SONGS) {
    throw importError('некорректное или слишком большое число песен.');
  }
  const songs = raw.songs.map((song, index) => sanitizeSong(song, index + 1));
  const songIds = new Set();
  for (const song of songs) {
    if (songIds.has(song.id)) throw importError(`id песни «${song.id}» повторяется.`);
    songIds.add(song.id);
    const cueIds = new Set();
    for (const cue of song.cues) {
      if (cueIds.has(cue.id)) throw importError(`песня «${song.id}»: id строки «${cue.id}» повторяется.`);
      cueIds.add(cue.id);
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    id: text(raw.id, 'id набора', { max: 200 }),
    name: text(raw.name, 'название набора', { max: 1000 }),
    cover: typeof raw.cover === 'string' ? raw.cover : '',
    songs,
  };
}

export function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(-)?(\d+):(\d{1,2})(?:[.,](\d{1,3}))?$/);
  if (!match || Number(match[3]) >= 60) return null;
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  const seconds = Number(match[2]) * 60 + Number(match[3]) + fraction;
  return match[1] ? -seconds : seconds;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const sign = seconds < 0 ? '-' : '';
  const total = Math.round(Math.abs(seconds) * 100) / 100;
  const minutes = Math.floor(total / 60);
  const remainder = total - minutes * 60;
  const wholeSeconds = Math.floor(remainder);
  const hundredths = Math.round((remainder - wholeSeconds) * 100);
  const suffix = hundredths ? `.${String(hundredths).padStart(2, '0')}`.replace(/0$/, '') : '';
  return `${sign}${minutes}:${String(wholeSeconds).padStart(2, '0')}${suffix}`;
}

/** Parse line-timed LRC without changing occurrence order or text. */
export function parseLrc(input) {
  if (typeof input !== 'string') throw new Error('LRC должен быть текстом.');
  const metadata = Object.create(null);
  const staged = [];
  let offsetMs = 0;
  let sawOffset = false;
  let occurrence = 0;
  const lines = input.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const line = lines[lineNo];
    if (!line.trim()) continue;
    const offset = line.match(/^\[offset\s*:\s*([+-]?\d+)\]\s*$/i);
    if (offset) {
      if (sawOffset) throw new Error(`LRC: offset указан повторно (строка ${lineNo + 1}).`);
      offsetMs = Number(offset[1]);
      sawOffset = true;
      metadata.offset = offsetMs;
      continue;
    }
    if (/^\[offset\s*:/i.test(line)) {
      throw new Error(`LRC: неверный offset в строке ${lineNo + 1}.`);
    }
    const meta = line.match(/^\[([a-z][\w-]*)\s*:\s*(.*?)\]\s*$/i);
    if (meta) {
      metadata[meta[1].toLowerCase()] = meta[2];
      continue;
    }
    const tags = [];
    let rest = line;
    while (rest.startsWith('[')) {
      const token = rest.match(/^\[(\d+):(\d{1,2})(?:[.,](\d{1,3}))?\]/);
      if (!token) break;
      const seconds = Number(token[2]);
      if (seconds >= 60) throw new Error(`LRC: неверное время в строке ${lineNo + 1}.`);
      tags.push(Number(token[1]) * 60 + seconds + (token[3] ? Number(`0.${token[3]}`) : 0));
      rest = rest.slice(token[0].length);
    }
    if (!tags.length || !rest.length) {
      throw new Error(`LRC: строка ${lineNo + 1} не содержит корректной синхронизированной строки.`);
    }
    for (const start of tags) {
      staged.push({ id: `cue-${occurrence + 1}`, start, text: rest, type: 'lyric', _order: occurrence });
      occurrence += 1;
    }
  }
  const cues = staged
    .map((cue) => ({ ...cue, start: cue.start + offsetMs / 1000 }))
    .sort((a, b) => a.start - b.start || a._order - b._order)
    .map(({ _order, ...cue }) => cue);
  return { cues, metadata };
}

export function validateSong(song) {
  const errors = [];
  if (!plainObject(song)) return ['Песня имеет неверную структуру.'];
  if (!String(song.title || '').trim()) errors.push('Укажите название песни.');
  if (!Number.isFinite(song.duration) || song.duration <= 0) errors.push('Укажите длительность песни больше нуля.');
  if (!Number.isFinite(song.delayMs)) errors.push('Задержка должна быть конечным числом миллисекунд.');
  if (!Array.isArray(song.cues) || (!song.cues.length && !song.backing?.fileName)) errors.push('Добавьте текст или минусовку.');
  let previous = -Infinity;
  for (const [index, cue] of (song.cues || []).entries()) {
    const label = `Строка ${index + 1}`;
    if (!plainObject(cue)) { errors.push(`${label}: неверная структура.`); continue; }
    if (cue.type !== 'lyric' && cue.type !== 'rest') errors.push(`${label}: неизвестный тип.`);
    if (typeof cue.text !== 'string' || !cue.text.trim()) errors.push(`${label}: введите текст.`);
    if (song.ignoreTimecodes === true) continue;
    if (cue.start === null || cue.start === undefined) { errors.push(`${label}: не задано время начала.`); continue; }
    if (!Number.isFinite(cue.start)) { errors.push(`${label}: время должно быть конечным числом.`); continue; }
    if (cue.start < 0) errors.push(`${label}: время не может быть отрицательным.`);
    if (Number.isFinite(song.duration) && cue.start >= song.duration) errors.push(`${label}: время должно быть раньше конца песни.`);
    if (cue.start <= previous) errors.push(`${label}: время должно быть строго позже предыдущей строки.`);
    previous = cue.start;
  }
  if (song.reviewed !== true) errors.push('Подтвердите, что таймлайн проверен.');
  return errors;
}

export function cueAt(song, elapsedSeconds) {
  const elapsed = finiteNumber(elapsedSeconds, 0);
  const delay = finiteNumber(song?.delayMs, 0) / 1000;
  const effectiveTime = elapsed - delay;
  const duration = finiteNumber(song?.duration, Infinity);
  if (elapsed >= duration) return { index: -1, effectiveTime, ended: true };
  if (song?.ignoreTimecodes === true) return { index: -1, effectiveTime: elapsed, ended: false };
  let index = -1;
  for (let cueIndex = 0; cueIndex < (song?.cues?.length || 0); cueIndex += 1) {
    const start = song.cues[cueIndex]?.start;
    if (!Number.isFinite(start)) continue;
    if (start > effectiveTime) break;
    index = cueIndex;
  }
  return { index, effectiveTime, ended: false };
}

/** Spatial progress for the untimed display; independent of stored cues/delay. */
export function uniformScrollProgress(song, elapsedSeconds) {
  if (song?.autoScrollEnabled === false) return 0;
  const duration = finiteNumber(song?.duration, 0);
  const elapsed = finiteNumber(elapsedSeconds, 0);
  const start = Number.isSafeInteger(song?.autoScrollStartSeconds) && song.autoScrollStartSeconds >= 0
    ? song.autoScrollStartSeconds
    : 10;
  if (duration <= start) return 0;
  return Math.max(0, Math.min(1, (elapsed - start) / (duration - start)));
}

export function createSong(partial = {}) {
  const rawCues = Array.isArray(partial.cues) ? partial.cues : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    id: typeof partial.id === 'string' && partial.id ? partial.id : id('song'),
    title: typeof partial.title === 'string' ? partial.title : '',
    artist: typeof partial.artist === 'string' ? partial.artist : '',
    version: typeof partial.version === 'string' ? partial.version : '',
    album: typeof partial.album === 'string' ? partial.album : '',
    cover: typeof partial.cover === 'string' ? partial.cover : '',
    language: typeof partial.language === 'string' ? partial.language : '',
    duration: finiteNumber(partial.duration, 0),
    delayMs: finiteNumber(partial.delayMs, 0),
    ignoreTimecodes: partial.ignoreTimecodes === true,
    autoScrollEnabled: partial.autoScrollEnabled !== false,
    includeBackingInShow: partial.includeBackingInShow !== false,
    autoScrollStartSeconds: Number.isSafeInteger(partial.autoScrollStartSeconds) && partial.autoScrollStartSeconds >= 0
      ? partial.autoScrollStartSeconds
      : 10,
    cues: rawCues.map((cue, index) => ({
      id: typeof cue?.id === 'string' && cue.id ? cue.id : id(`cue-${index + 1}`),
      start: finiteNumber(cue?.start, null),
      text: typeof cue?.text === 'string' ? cue.text : '',
      type: cue?.type === 'rest' ? 'rest' : 'lyric',
    })),
    reviewed: false,
    ...(typeof partial.mediaRevision === 'string' ? { mediaRevision: partial.mediaRevision } : {}),
    source: {
      kind: typeof partial.source?.kind === 'string' ? partial.source.kind : 'manual',
      fileName: typeof partial.source?.fileName === 'string' ? partial.source.fileName : '',
    },
    ...(partial.backing ? { backing: { fileName: typeof partial.backing.fileName === 'string' ? partial.backing.fileName : '' } } : {}),
  };
}

export function invalidateReview(song) {
  return { ...song, reviewed: false, cues: Array.isArray(song?.cues) ? song.cues.map((cue) => ({ ...cue })) : [] };
}

export function importSet(jsonText) {
  if (typeof jsonText !== 'string') throw importError('ожидался текст JSON.');
  if (new TextEncoder().encode(jsonText).byteLength > MAX_IMPORT_BYTES) throw importError('файл больше 5 МБ.');
  let raw;
  try { raw = JSON.parse(jsonText); } catch { throw importError('файл содержит некорректный JSON.'); }
  assertSafeTree(raw);
  return sanitizeSet(raw);
}

export function exportSet(set) {
  return JSON.stringify(sanitizeSet(set), null, 2);
}

export const lyricsSchemaVersion = SCHEMA_VERSION;
