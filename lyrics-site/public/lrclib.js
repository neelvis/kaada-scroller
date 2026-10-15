import { createSong, exportSet, importSet, parseLrc } from './core.js';

const SEARCH_URL = 'https://lrclib.net/api/search';
const CLIENT_NAME = 'KaadaScroller v0.1.0 (https://github.com/neelvis/kaada-scroller)';
const MIN_REQUEST_INTERVAL_MS = 350;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_LIMIT_MS = 60_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_RESULTS = 100;
const MAX_LRC_LENGTH = 200_000;
const UNREADABLE_RESPONSE_MESSAGE = 'Не удалось получить ответ LRCLIB. Возможен сбой сети или блокировка ответа со стороны сервиса. Браузер не предоставил код ошибки, поэтому точную причину определить нельзя. Повторите поиск позже.';

function problem(message, name) {
  const error = new Error(message);
  if (name) error.name = name;
  return error;
}

function abortProblem(message) {
  return problem(message, 'AbortError');
}

function retryAfterMs(value, now) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function httpProblem(status, retryAt = null) {
  const messages = {
    400: ['LRCLIB отклонил параметры поиска', 'Проверьте название песни и исполнителя.'],
    401: ['LRCLIB требует авторизацию для этого запроса', 'Повторите поиск позже или вставьте текст вручную.'],
    403: ['LRCLIB запретил доступ к поиску', 'Повторите поиск позже или вставьте текст вручную.'],
    404: ['Адрес поиска LRCLIB недоступен', 'Повторите поиск позже или вставьте текст вручную.'],
    408: ['LRCLIB не успел обработать запрос', 'Повторите поиск позже.'],
    422: ['LRCLIB не смог обработать параметры поиска', 'Проверьте название песни и исполнителя.'],
    429: ['LRCLIB временно ограничил поиск: слишком много запросов', 'Подождите перед повторным поиском.'],
    500: ['Внутренняя ошибка сервера LRCLIB', 'Повторите поиск позже.'],
    502: ['Не удалось получить корректный ответ от сервера LRCLIB', 'Повторите поиск позже.'],
    503: ['Поиск LRCLIB временно недоступен на стороне сервиса', 'Повторите поиск позже.'],
    504: ['Сервер LRCLIB не ответил вовремя', 'Повторите поиск позже.'],
  };
  const [reason, action] = messages[status] ?? (status >= 500 && status <= 599
    ? ['Ошибка на стороне сервиса LRCLIB', 'Повторите поиск позже.']
    : ['LRCLIB не смог выполнить поиск', 'Повторите поиск позже или вставьте текст вручную.']);
  const retry = retryAt === null ? action : `Повторите поиск после ${new Date(retryAt).toLocaleTimeString()}.`;
  return problem(`${reason} (HTTP ${status}). ${retry}`);
}

function nonEmptyText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw problem(`LRCLIB вернул некорректное поле «${field}». Повторите поиск позже.`);
  return value;
}

function optionalText(value, field) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw problem(`LRCLIB вернул некорректное поле «${field}». Повторите поиск позже.`);
  return value;
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw problem('LRCLIB вернул некорректный результат. Повторите поиск позже.');
  }
  if ((typeof raw.id !== 'number' && typeof raw.id !== 'string') || String(raw.id).trim() === '') {
    throw problem('LRCLIB вернул результат без идентификатора. Повторите поиск позже.');
  }
  if (raw.duration !== null && (typeof raw.duration !== 'number' || !Number.isFinite(raw.duration) || raw.duration < 0)) {
    throw problem('LRCLIB вернул некорректную длительность. Повторите поиск позже.');
  }
  if (typeof raw.instrumental !== 'boolean') {
    throw problem('LRCLIB вернул некорректный признак инструментальной записи. Повторите поиск позже.');
  }
  if (raw.syncedLyrics !== null && raw.syncedLyrics !== undefined && typeof raw.syncedLyrics !== 'string') {
    throw problem('LRCLIB вернул некорректный синхронизированный текст. Повторите поиск позже.');
  }
  if (typeof raw.syncedLyrics === 'string' && raw.syncedLyrics.length > MAX_LRC_LENGTH) {
    throw problem('LRCLIB вернул слишком большой синхронизированный текст. Выберите другую запись.');
  }
  if (raw.plainLyrics !== null && raw.plainLyrics !== undefined && typeof raw.plainLyrics !== 'string') {
    throw problem('LRCLIB вернул некорректный обычный текст. Повторите поиск позже.');
  }
  if (typeof raw.plainLyrics === 'string' && raw.plainLyrics.length > MAX_LRC_LENGTH) {
    throw problem('LRCLIB вернул слишком большой обычный текст. Выберите другую запись.');
  }
  return {
    id: raw.id,
    trackName: nonEmptyText(raw.trackName, 'trackName'),
    artistName: optionalText(raw.artistName, 'artistName'),
    albumName: optionalText(raw.albumName, 'albumName'),
    duration: raw.duration ?? null,
    instrumental: raw.instrumental,
    syncedLyrics: raw.syncedLyrics || '',
    plainLyrics: raw.plainLyrics || '',
  };
}

/** Browser client for explicit, privacy-limited LRCLIB searches. */
export class LrclibClient {
  constructor({
    fetch: fetchImpl = globalThis.fetch.bind(globalThis),
    clock = () => Date.now(),
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    setTimeout: setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
    clearTimeout: clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    minRequestIntervalMs = MIN_REQUEST_INTERVAL_MS,
    fallbackRetryMs = DEFAULT_RATE_LIMIT_MS,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Для поиска LRCLIB требуется fetch.');
    this.fetch = fetchImpl;
    this.clock = clock;
    this.wait = wait;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.timeoutMs = timeoutMs;
    this.minRequestIntervalMs = minRequestIntervalMs;
    this.fallbackRetryMs = fallbackRetryMs;
    this.lastCompletedAt = -Infinity;
    this.pending = false;
    this.retryAt = 0;
    this.retryStatus = null;
  }

  async search({ title, artist, signal } = {}) {
    const trackName = typeof title === 'string' ? title.trim() : '';
    const artistName = typeof artist === 'string' ? artist.trim() : '';
    if (!trackName) throw problem('Введите название песни для поиска в LRCLIB.');
    if (this.pending) throw problem('Поиск LRCLIB уже выполняется. Дождитесь его завершения или отмените поиск.');
    if (signal?.aborted) throw abortProblem('Поиск LRCLIB отменён. Данные песни не изменены.');

    this.pending = true;
    let timeoutId;
    let timedOut = false;
    let requestStarted = false;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const now = this.clock();
      if (this.retryAt > now) {
        throw httpProblem(this.retryStatus, this.retryAt);
      }
      const pause = Math.max(0, this.lastCompletedAt + this.minRequestIntervalMs - now);
      if (pause) await this.waitFor(pause, signal);
      if (signal?.aborted) throw abortProblem('Поиск LRCLIB отменён. Данные песни не изменены.');

      const params = new URLSearchParams({ track_name: trackName });
      if (artistName) params.set('artist_name', artistName);
      requestStarted = true;
      timeoutId = this.setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
      let response;
      try {
        response = await this.fetch(`${SEARCH_URL}?${params}`, {
          method: 'GET', signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
          headers: { Accept: 'application/json', 'Lrclib-Client': CLIENT_NAME },
        });
      } catch (error) {
        if (timedOut) throw problem('LRCLIB не ответил за 15 секунд. Проверьте соединение и повторите поиск.');
        if (signal?.aborted || error?.name === 'AbortError') throw abortProblem('Поиск LRCLIB отменён. Данные песни не изменены.');
        throw problem(UNREADABLE_RESPONSE_MESSAGE);
      }
      if (response.status === 0) throw problem(UNREADABLE_RESPONSE_MESSAGE);
      const retryDelay = retryAfterMs(response.headers?.get?.('Retry-After'), this.clock());
      if (response.status === 429 || (!response.ok && retryDelay !== null)) {
        const delay = retryDelay ?? this.fallbackRetryMs;
        this.retryAt = Math.max(this.retryAt, this.clock() + delay);
        this.retryStatus = response.status;
        throw httpProblem(response.status, this.retryAt);
      }
      if (!response.ok) throw httpProblem(response.status);
      const declaredLength = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw problem('LRCLIB вернул слишком большой ответ. Уточните название песни и повторите поиск.');
      }
      let body;
      try {
        body = await response.text();
      } catch (error) {
        if (timedOut) throw problem('LRCLIB не ответил за 15 секунд. Проверьте соединение и повторите поиск.');
        if (signal?.aborted || error?.name === 'AbortError') throw abortProblem('Поиск LRCLIB отменён. Данные песни не изменены.');
        throw problem('Не удалось прочитать ответ LRCLIB. Повторите поиск позже.');
      }
      if (signal?.aborted) throw abortProblem('Поиск LRCLIB отменён. Данные песни не изменены.');
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw problem('LRCLIB вернул слишком большой ответ. Уточните название песни и повторите поиск.');
      let raw;
      try { raw = JSON.parse(body); } catch { throw problem('LRCLIB вернул некорректный ответ. Повторите поиск позже.'); }
      if (!Array.isArray(raw) || raw.length > MAX_RESULTS) {
        throw problem('LRCLIB вернул некорректный список результатов. Повторите поиск позже.');
      }
      return raw.map(normalizeRecord);
    } finally {
      if (timeoutId !== undefined) this.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      if (requestStarted) this.lastCompletedAt = this.clock();
      this.pending = false;
    }
  }

  async waitFor(milliseconds, signal) {
    if (!signal) return this.wait(milliseconds);
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(abortProblem('Поиск LRCLIB отменён. Данные песни не изменены.'));
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(this.wait(milliseconds)).then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, reject);
    });
  }
}

/** An available result must contain a usable line-timed LRC, not just text. */
export function hasSynchronizedLyrics(record) {
  if (record?.instrumental || typeof record?.syncedLyrics !== 'string' || !record.syncedLyrics.trim()) return false;
  try { return parseLrc(record.syncedLyrics).cues.length > 0; } catch { return false; }
}

/** An ordinary-text result must contain at least one nonblank line. */
export function hasPlainLyrics(record) {
  if (record?.instrumental || typeof record?.plainLyrics !== 'string') return false;
  return record.plainLyrics.split(/\r?\n/).some((line) => line.trim().length > 0);
}

/** Convert an explicitly selected LRCLIB record into a normal LRC replacement. */
export function prepareLrcImport(song, record) {
  if (!record || typeof record !== 'object') throw problem('Выберите запись LRCLIB перед импортом.');
  if (record.instrumental) throw problem('Инструментальную запись нельзя импортировать как синхронизированный текст.');
  if (typeof record.syncedLyrics !== 'string' || !record.syncedLyrics.trim()) {
    throw problem('У выбранной записи нет синхронизированного LRC. Выберите другую версию или импортируйте LRC вручную.');
  }
  let parsed;
  try { parsed = parseLrc(record.syncedLyrics); } catch (error) {
    throw problem(`Синхронизированный LRC выбранной записи некорректен: ${error.message}`);
  }
  if (!parsed.cues.length) throw problem('В синхронизированном LRC не найдено строк с таймкодами.');
  const details = {};
  if (!String(song?.title || '').trim() && typeof record.trackName === 'string' && record.trackName.trim()) details.title = record.trackName.trim();
  if (!String(song?.artist || '').trim() && typeof record.artistName === 'string' && record.artistName.trim()) details.artist = record.artistName.trim();
  if (!(typeof song?.duration === 'number' && Number.isFinite(song.duration) && song.duration > 0)
      && typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0) details.duration = record.duration;
  // Apply the same portable-data limits before changing the editable song.
  try {
    const candidate = createSong({ ...song, ...details, cues: parsed.cues });
    importSet(exportSet({ schemaVersion: 1, id: 'lrclib-import-check', name: '', songs: [candidate] }));
  } catch (error) { throw problem(`LRC нельзя сохранить в приложении: ${error.message}`); }
  return { cues: parsed.cues, details };
}

/** Convert an explicitly selected LRCLIB record into editable untimed lines. */
export function preparePlainImport(song, record) {
  if (!record || typeof record !== 'object') throw problem('Выберите запись LRCLIB перед импортом.');
  if (record.instrumental) throw problem('Инструментальную запись нельзя импортировать как текст.');
  if (typeof record.plainLyrics !== 'string' || !record.plainLyrics.trim()) {
    throw problem('У выбранной записи нет обычного текста. Выберите другую версию или вставьте текст вручную.');
  }
  if (record.plainLyrics.length > MAX_LRC_LENGTH) throw problem('LRCLIB вернул слишком большой обычный текст. Выберите другую запись.');
  const cues = record.plainLyrics.split(/\r?\n/).filter(Boolean).map((text, index) => ({
    id: `lrclib-plain-${Date.now()}-${index}`,
    start: null,
    text,
    type: 'lyric',
  }));
  if (!cues.length) throw problem('В обычном тексте не найдено строк.');
  const details = {};
  if (!String(song?.title || '').trim() && typeof record.trackName === 'string' && record.trackName.trim()) details.title = record.trackName.trim();
  if (!String(song?.artist || '').trim() && typeof record.artistName === 'string' && record.artistName.trim()) details.artist = record.artistName.trim();
  if (typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration > 0) details.duration = record.duration;
  try {
    const candidate = createSong({ ...song, ...details, cues });
    importSet(exportSet({ schemaVersion: 1, id: 'lrclib-import-check', name: '', songs: [candidate] }));
  } catch (error) { throw problem(`Текст нельзя сохранить в приложении: ${error.message}`); }
  return { cues, details };
}
