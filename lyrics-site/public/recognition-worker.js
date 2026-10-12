import { pipeline, env } from './vendor/transformers.js';
import { recognitionCues } from './recognition-utils.js';
import { alignLyrics } from './alignment.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;

const PROFILES = {
  quality: { model: 'onnx-community/whisper-small_timestamped', revision: '65caa70f294b46e1c33ff820aae6b16d048ab818', dtype: 'q8', chunkLength: 20, strideLength: 3 },
  fast: { model: 'onnx-community/whisper-base_timestamped', revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e', dtype: 'q8', chunkLength: 30, strideLength: 5 },
};
let transcriber = null;
let loadedProfile = null;
let busy = false;
const sendProgress = (stage, progress, message) => self.postMessage({ type: 'progress', stage, progress, message });

self.addEventListener('message', async ({ data }) => {
  if (data.type !== 'recognize' || busy) return;
  busy = true;
  try {
    const profile = PROFILES[data.profile] || PROFILES.quality;
    if (!transcriber || loadedProfile !== data.profile) {
      transcriber = null;
      loadedProfile = null;
      sendProgress('loading', 0, 'Загружаем модель для распознавания. Это нужно только при первом запуске…');
      transcriber = await pipeline('automatic-speech-recognition', profile.model, {
        device: 'wasm', dtype: profile.dtype, revision: profile.revision,
        progress_callback: (event) => {
          if (event.status === 'progress') sendProgress('loading', event.progress / 100, `Загрузка модели: ${Math.round(event.progress)}%`);
        },
      });
      loadedProfile = data.profile;
    }
    sendProgress('recognizing', 0, 'Распознаём текст и время строк…');
    const result = await transcriber(data.samples, {
      language: data.language === 'auto' ? undefined : data.language === 'en' ? 'english' : 'russian',
      task: 'transcribe', return_timestamps: 'word', chunk_length_s: profile.chunkLength, stride_length_s: profile.strideLength,
      chunk_callback: (chunk) => {
        sendProgress('recognizing', null, 'Распознаём следующий фрагмент…');
      },
    });
    const aligned = Array.isArray(data.lyrics) ? alignLyrics(data.lyrics, result, data.duration) : null;
    const cues = aligned?.cues ?? recognitionCues(result, data.duration);
    self.postMessage({ type: 'result', result: { text: aligned ? data.lyrics.map(cue => cue.text).join('\n') : cues.map(cue => cue.text).join('\n'), cues, alignment: aligned?.alignment, model: profile.model, modelRevision: profile.revision, profile: data.profile } });
  } catch (error) {
    transcriber = null;
    loadedProfile = null;
    const detail = error?.message || '';
    const message = /fetch|network|download/i.test(detail)
      ? 'Не удалось загрузить модель. Для первого распознавания нужен интернет; запись остаётся на вашем устройстве.'
      : detail || 'Не удалось распознать запись. Попробуйте ещё раз или загрузите готовый текст.';
    self.postMessage({ type: 'error', message });
  } finally { busy = false; }
});
