import assert from 'node:assert/strict';
import test from 'node:test';
import { Playback } from '../public/playback.js';

class AudioFixture extends EventTarget {
  constructor(duration = 20) { super(); this.duration = duration; this.currentTime = 0; this.paused = true; this.plays = 0; }
  load() { if (this.src) queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata'))); }
  async play() { this.plays += 1; if (this.rejectPlay) throw new Error('Playback denied'); if (this.pendingPlay) await this.pendingPlay; this.paused = false; }
  pause() { this.paused = true; }
  removeAttribute() { this.src = ''; }
  remove() {}
}
const blob = () => new Blob(['audio'], { type: 'audio/wav' });
function fixture(duration = 20) {
  let now = 0;
  const audios = [];
  const errors = [];
  const playback = new Playback({ now: () => now, createAudio: () => { const audio = new AudioFixture(duration); audios.push(audio); return audio; }, failed: error => errors.push(error) });
  return { playback, audios, errors, advance: value => { now += value * 1000; } };
}

test('lyrics-only timeline clamps seeks, preserves armed state and resumes after end', async () => {
  const { playback: p, advance } = fixture();
  p.arm(30); p.seek(10); assert.equal(p.elapsed(), 10); assert.equal(p.running, false);
  await p.start(); advance(3); assert.equal(p.elapsed(), 13);
  await p.seek(29); advance(10); assert.equal(p.elapsed(), 30);
  p.stop(); p.seek(15); assert.equal(p.running, false); await p.start(); advance(2); assert.equal(p.elapsed(), 17);
  p.reset(); assert.equal(p.elapsed(), 0); assert.equal(p.running, false);
  p.seek(-100); assert.equal(p.elapsed(), 0); p.seek(100); assert.equal(p.elapsed(), 30);
});

test('audio drives the clock; mute and duplicate Start leave its position intact', async () => {
  const { playback: p, audios, advance } = fixture();
  p.arm(30, async () => blob()); await p.start();
  const audio = audios[0]; audio.currentTime = 4; advance(20);
  assert.equal(p.elapsed(), 4, 'wall time cannot outrun buffering audio');
  p.mute(true); assert.equal(audio.muted, true); assert.equal(p.elapsed(), 4);
  p.mute(false); await p.start(); assert.equal(audio.plays, 1); assert.equal(p.elapsed(), 4);
  await p.seek(10); assert.equal(p.elapsed(), 10); assert.equal(audio.paused, true); assert.equal(audios[1].currentTime, 10);
  p.dispose(); assert.ok(audios.every(item => item.paused));
});

test('a short backing track ends but lyrics continue; seeking back restarts audio', async () => {
  const { playback: p, audios, advance } = fixture(5);
  p.arm(20, async () => blob()); await p.start();
  audios[0].currentTime = 5; audios[0].dispatchEvent(new Event('ended'));
  advance(3); assert.equal(p.elapsed(), 8);
  await p.seek(2); assert.equal(p.elapsed(), 2); assert.equal(audios[1].paused, false);
  p.dispose();
});

test('reset while fetching prevents a late audio element or playback', async () => {
  const { playback: p, audios } = fixture();
  let finish;
  p.arm(30, () => new Promise(resolve => { finish = resolve; }));
  const pending = p.start(); p.reset(); finish(blob()); await pending;
  assert.equal(audios.length, 0); assert.equal(p.running, false); assert.equal(p.elapsed(), 0);
});

test('an old play promise resolving after song switch cannot sound or stop the new song', async () => {
  const { playback: p, audios } = fixture();
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const originalFactory = p.createAudio;
  p.createAudio = () => { const audio = originalFactory(); if (!audios.slice(0, -1).length) audio.pendingPlay = deferred; return audio; };
  p.arm(30, async () => blob()); const pending = p.start();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(audios[0].plays, 1);
  p.arm(30, async () => blob()); await p.start(); release(); await pending;
  assert.equal(audios[0].paused, true); assert.equal(audios[1].paused, false); assert.equal(p.running, true);
  p.dispose();
});

test('rejected playback stays armed and explicit lyrics-only launch recovers', async () => {
  const { playback: p, audios, errors, advance } = fixture();
  p.createAudio = () => { const audio = new AudioFixture(); audio.rejectPlay = true; audios.push(audio); return audio; };
  p.arm(30, async () => blob()); p.seek(5); await p.start();
  assert.equal(errors.length, 1); assert.equal(p.running, false); assert.equal(p.elapsed(), 5); assert.equal(audios[0].paused, true);
  await p.lyricsOnly(); advance(2); assert.equal(p.elapsed(), 7); assert.equal(p.loadAudio, null);
});
