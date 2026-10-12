/** One event timeline and its optional backing audio. No preparation audio is used. */
export class Playback {
  constructor({ now = () => performance.now(), createAudio = () => new Audio(), changed = () => {}, failed = () => {} } = {}) {
    Object.assign(this, { now, createAudio, changed, failed });
    this.generation = 0;
    this.duration = 0;
    this.position = 0;
    this.running = false;
    this.starting = false;
  }

  arm(duration, loadAudio = null) {
    this.dispose();
    this.duration = duration;
    this.position = 0;
    this.loadAudio = loadAudio;
    this.audioFinished = false;
    this.changed();
  }

  elapsed() {
    const position = this.running
      ? this.audio && !this.audioFinished ? this.audio.currentTime : this.position + (this.now() - this.startedAt) / 1000
      : this.position;
    return Math.max(0, Math.min(this.duration, position));
  }

  async start() {
    if (this.running || this.starting || this.position >= this.duration) return;
    const generation = this.generation;
    this.starting = true;
    this.changed();
    let audio = this.audio;
    try {
      if (this.loadAudio && !audio) {
        const blob = await this.loadAudio();
        if (generation !== this.generation) return;
        if (!blob) throw new Error('Минусовка недоступна. Выберите файл заново или продолжите без неё.');
        audio = this.createAudio();
        this.audio = audio;
        audio.muted = Boolean(this.muted);
        this.url = URL.createObjectURL(blob);
        this.abort = new AbortController();
        await new Promise((resolve, reject) => {
          const signal = this.abort.signal;
          const finish = (error) => {
            clearTimeout(timer);
            audio.removeEventListener('loadedmetadata', loaded);
            audio.removeEventListener('error', broken);
            signal.removeEventListener('abort', cancelled);
            error ? reject(error) : resolve();
          };
          const loaded = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? null : new Error('Не удалось определить длительность минусовки.'));
          const broken = () => finish(new Error('Не удалось воспроизвести минусовку. Проверьте MP3 или WAV.'));
          const cancelled = () => finish(new DOMException('Отменено', 'AbortError'));
          const timer = setTimeout(() => finish(new Error('Загрузка минусовки заняла слишком много времени. Повторите запуск.')), 15000);
          audio.addEventListener('loadedmetadata', loaded, { once: true });
          audio.addEventListener('error', broken, { once: true });
          signal.addEventListener('abort', cancelled, { once: true });
          audio.src = this.url;
          audio.load();
        });
        if (generation !== this.generation) return;
        audio.addEventListener('ended', () => {
          if (generation !== this.generation || !this.running) return;
          this.position = Math.min(this.duration, audio.currentTime);
          this.startedAt = this.now();
          this.audioFinished = true;
        });
        audio.addEventListener('error', () => {
          if (this.audio !== audio) return;
          this.stop();
          this.releaseAudio();
          this.failed(new Error('Воспроизведение минусовки прервано. Повторите запуск или продолжите без неё.'));
        });
      }
      if (audio) {
        this.audioFinished = this.position >= audio.duration;
        audio.currentTime = Math.min(this.position, audio.duration);
        if (!this.audioFinished) await audio.play();
      }
      if (generation !== this.generation) { audio?.pause(); return; }
      this.startedAt = this.now();
      this.running = true;
      this.starting = false;
      this.changed();
    } catch (error) {
      if (generation !== this.generation) { audio?.pause(); return; }
      this.starting = false;
      this.running = false;
      this.releaseAudio();
      this.changed();
      this.failed(error);
    }
  }

  stop() {
    this.position = this.elapsed();
    this.running = false;
    this.starting = false;
    this.generation += 1;
    this.abort?.abort();
    this.audio?.pause();
    // A cancelled play promise must never start this element in a later song.
    this.releaseAudio();
    this.changed();
  }

  seek(position) {
    const resume = this.running || this.starting;
    this.stop();
    this.position = Math.max(0, Math.min(this.duration, Number(position) || 0));
    this.changed();
    if (resume && this.position < this.duration) return this.start();
  }

  reset() { this.stop(); this.position = 0; this.changed(); }
  mute(value) { this.muted = value; if (this.audio) this.audio.muted = value; this.changed(); }
  lyricsOnly() { this.stop(); this.loadAudio = null; return this.start(); }

  releaseAudio() {
    this.abort?.abort();
    this.abort = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio.remove?.();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.audio = null;
    this.url = null;
  }

  dispose() { this.stop(); this.loadAudio = null; }
}
