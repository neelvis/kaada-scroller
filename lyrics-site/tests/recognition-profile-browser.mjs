// Real browser pipeline check with a supplied synthetic speech recording.
// This verifies integration; it is not a singing-accuracy benchmark.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const port = 8108;
const origin = `http://127.0.0.1:${port}`;
const output = process.env.LYRICS_TEST_OUTPUT || 'test-results/recognition';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe' });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(origin)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage(); await page.goto(origin + '/lyrics/');
  const bytes = [...await readFile('../work/timed-lyrics-20261012/fixtures/russian.mp3')];
  const lyrics = ['Добро пожаловать в музыкальную школу,', 'Сегодня мы поём вместе!', 'Следите за словами на экране.'].map((text, i) => ({ id: `line-${i}`, text, start: null, type: 'lyric' }));
  for (const profile of ['quality', 'fast']) {
    const started = Date.now();
    const result = await page.evaluate(async ({ bytes, lyrics, profile }) => {
      const { recognizeFile } = await import('./recognition.js');
      return recognizeFile(new File([new Uint8Array(bytes)], 'synthetic-russian.mp3', { type: 'audio/mpeg' }), { profile, language: 'ru', lyrics, signal: AbortSignal.timeout(240000) });
    }, { bytes, lyrics, profile });
    assert.deepEqual(result.cues.map(cue => cue.text), lyrics.map(cue => cue.text));
    assert.equal(result.cues.length, 3); assert.ok(result.cues.some(cue => Number.isFinite(cue.start)));
    await writeFile(`${output}/${profile}.json`, JSON.stringify({ elapsedMs: Date.now() - started, result }, null, 2));
    console.log(`PASS ${profile}: ${result.alignment?.matched ?? '?'} matched, ${result.alignment?.unresolved ?? '?'} unresolved, ${Date.now() - started} ms; supplied text preserved.`);
  }
} finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
