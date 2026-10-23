import { audioEnergy } from './recognition-utils.js';

let activeJob = false;
let reusableWorker = null;
let reusableProfile = null;

function abortError() { return new DOMException('Распознавание отменено', 'AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }

export async function decodeAudio(file, signal) {
  checkAbort(signal);
  if (!file || file.size === 0) throw new Error('Выберите непустой MP3 или WAV.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Запись слишком большая. Максимальный размер — 15 МБ.');
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Этот браузер не поддерживает чтение аудио. Откройте раздел в современном браузере на компьютере.');
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    checkAbort(signal);
    if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || buffer.duration > 1200) {
      throw new Error('Длительность записи должна быть от 1 секунды до 20 минут.');
    }
    const sampleCount = Math.ceil(buffer.duration * 16000);
    const offline = new OfflineAudioContext(1, sampleCount, 16000);
    const input = offline.createBufferSource();
    input.buffer = buffer;
    input.connect(offline.destination);
    input.start();
    const mono = await offline.startRendering();
    checkAbort(signal);
    const samples = mono.getChannelData(0).slice();
    if (audioEnergy(samples) < 0.0001) throw new Error('В записи не слышно звука. Выберите запись с вокалом.');
    return { samples, duration: buffer.duration };
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('Не удалось прочитать запись. Проверьте файл MP3 или WAV.');
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

export async function recognizeFile(file, { language = 'ru', profile = 'quality', lyrics, onProgress = () => {}, signal } = {}) {
  if (activeJob) throw new Error('Дождитесь обработки предыдущей записи.');
  if (profile !== 'quality' && profile !== 'fast') throw new Error('Неизвестный профиль распознавания.');
  activeJob = true;
  try {
    onProgress({ stage: 'decoding', progress: 0, message: 'Читаем запись…' });
    const { samples, duration } = await decodeAudio(file, signal);
    checkAbort(signal);
    if (reusableWorker && reusableProfile !== profile) { reusableWorker.terminate(); reusableWorker = null; reusableProfile = null; }
    if (!reusableWorker) { reusableWorker = new Worker(new URL('./recognition-worker.js', import.meta.url), { type: 'module' }); reusableProfile = profile; }
    const worker = reusableWorker;
    return await new Promise((resolve, reject) => {
      let finished = false;
      const clean = () => {
        worker.removeEventListener('message', message);
        worker.removeEventListener('error', failed);
        signal?.removeEventListener('abort', cancel);
      };
      const finish = (callback, value) => { if (finished) return; finished = true; clean(); callback(value); };
      const discard = () => { worker.terminate(); if (reusableWorker === worker) { reusableWorker = null; reusableProfile = null; } };
      const cancel = () => { discard(); finish(reject, abortError()); };
      const failed = () => { discard(); finish(reject, new Error('Не удалось запустить распознавание. Проверьте соединение и попробуйте ещё раз.')); };
      const message = ({ data }) => {
        if (data.type === 'progress') onProgress(data);
        if (data.type === 'result') finish(resolve, { ...data.result, duration, source: { kind: 'recognition', fileName: file.name } });
        if (data.type === 'error') { discard(); finish(reject, new Error(data.message)); }
      };
      worker.addEventListener('message', message);
      worker.addEventListener('error', failed);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) { cancel(); return; }
      worker.postMessage({ type: 'recognize', samples, duration, language, profile, lyrics }, [samples.buffer]);
    });
  } finally {
    activeJob = false;
  }
}
