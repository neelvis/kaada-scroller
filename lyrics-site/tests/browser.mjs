import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { importPortableSet } from '../public/portable.js';

const port = Number(process.env.LYRICS_TEST_PORT || 8095);
const origin = `http://127.0.0.1:${port}`;
const output = process.env.LYRICS_TEST_OUTPUT || 'test-results';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['tools/serve.mjs'], { env: { ...process.env, LYRICS_PORT: String(port) }, stdio: 'pipe' });
let browser;
function portableManifest(archive) {
  assert.equal(archive.readUInt32LE(0), 0x04034b50, 'ZIP starts with a local file record');
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  const size = archive.readUInt32LE(18);
  const name = archive.toString('utf8', 30, 30 + nameLength);
  assert.equal(name, 'set.json');
  const start = 30 + nameLength + extraLength;
  return JSON.parse(archive.toString('utf8', start, start + size));
}
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(origin + '/lyrics/')).ok) break; } catch {}
    if (i === 39) throw new Error('Preview server did not start');
    await new Promise(r => setTimeout(r, 100));
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/lyrics/');
  await page.waitForSelector('#editor h1');
  assert.equal(await page.locator('#event-view').isVisible(), false, 'audience hidden during preparation');
  assert.equal(await page.locator('#add-song').isEnabled(), true, 'first local song can be added without signing in');
  await page.locator('#add-song').click();
  await page.getByLabel('Название', {exact:true}).waitFor();
  await page.evaluate(async () => {
    localStorage.setItem('nasty-piano-marker', 'keep');
    await new Promise((resolve, reject) => {
      const r = indexedDB.open('nasty-piano-test-marker', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('test');
      r.onsuccess = () => { const db = r.result; const tx = db.transaction('test', 'readwrite'); tx.objectStore('test').put('keep', 'marker'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; };
      r.onerror = reject;
    });
  });
  const songs = Array.from({length:25},(_,i)=>({schemaVersion:1,id:`test-${i}`,title:`Песня ${i+1}`,artist:'',version:'Проверочный оригинал',language:'ru',duration:5,delayMs:0,reviewed:true,source:{kind:'manual',fileName:''},cues:[
    {id:'a',start:0.15,text:'Первая строка',type:'lyric'},
    {id:'b',start:1.3,text:'Вторая строка',type:'lyric'},
    {id:'c',start:2.3,text:'Припев повторяется',type:'lyric'},
    {id:'d',start:3.3,text:'Проигрыш',type:'rest'},
    {id:'e',start:4.0,text:'Последняя строка',type:'lyric'}
  ]}));
  songs[0].backing = { fileName: 'shared.wav' };
  songs[1].backing = { fileName: 'shared.wav' };
  const set = {schemaVersion:1,id:'test-set',name:'Проверочный концерт',songs};
  const json = JSON.stringify(set);
  await page.locator('#set-file').setInputFiles({name:'concert.json',mimeType:'application/json',buffer:Buffer.from(json)});
  await page.waitForFunction(()=>document.querySelectorAll('.song-item').length===25);
  const backingBytes = [wave(2), wave(3)];
  await page.evaluate(async values => {
    const storage = await import('./storage.js');
    await storage.putBacking('test-0', new Blob([new Uint8Array(values[0])], { type: 'audio/wav' }));
    await storage.putBacking('test-1', new Blob([new Uint8Array(values[1])], { type: 'audio/wav' }));
  }, backingBytes.map(bytes => [...bytes]));
  await page.screenshot({path:output+'/preparation.png',fullPage:true});
  await page.getByRole('button',{name:'Режим показа',exact:true}).click();
  assert.equal(await page.locator('#preparation-view').isVisible(),false);
  await page.locator('#event-start').click();
  await page.waitForFunction(()=>document.querySelector('.audience-line.active')?.textContent==='Первая строка');
  await page.screenshot({path:output+'/audience.png'});
  await page.locator('#event-start').click();
  await page.waitForFunction(()=>document.querySelector('.audience-line.active')?.textContent==='Вторая строка');
  await page.evaluate(()=>{const until=performance.now()+450;while(performance.now()<until){};});
  await page.waitForFunction(()=>document.querySelector('.audience-line.active')?.textContent==='Припев повторяется');
  await page.waitForFunction(()=>document.querySelector('.audience-line.active')?.textContent.includes('Проигрыш'));
  await page.waitForFunction(()=>document.querySelector('#audience-lines').textContent.includes('Песня закончилась'));
  await page.locator('#event-reset').click();
  assert.equal(await page.locator('.audience-line.active').count(),0);
  await page.locator('#exit-event').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-set').click();
  const download = await downloadPromise;
  const exportedArchive = await readFile(await download.path());
  const { set: exported, backingAudio: exportedAudio } = await importPortableSet(new Blob([exportedArchive], { type: 'application/zip' }));
  const manifest = portableManifest(exportedArchive);
  assert.equal(exported.songs.length,25);
  assert.deepEqual(exported.songs[0].cues,songs[0].cues);
  assert.equal(exportedAudio.size, 2, 'portable archive contains both linked backing tracks');
  assert.ok(manifest.songs[0].backingTrack && manifest.songs[1].backingTrack);
  assert.notEqual(manifest.songs[0].backingTrack, manifest.songs[1].backingTrack, 'same-named tracks get unique archive paths');
  const archiveBytes = await Promise.all([...exportedAudio.values()].map(async blob => Buffer.from(await blob.arrayBuffer())));
  for (const expected of backingBytes) assert.ok(archiveBytes.some(actual => actual.equals(expected)), 'backing bytes survive portable round trip');
  assert.equal(manifest.songs[2].backingTrack, null, 'song without linked backing has a null path');
  await page.waitForFunction(()=>document.querySelector('#offline-state').textContent.includes('Готово'));
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.song-item').length===25);
  assert.equal(await page.locator('#event-view').isVisible(),false,'reload does not assume running song');

  // Exercise preparation on a generated recording without requiring model downloads.
  function wave(seconds) {
    const count = 16000 * seconds;
    const bytes = Buffer.alloc(44 + count * 2);
    bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
    for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i / 16000 * 440 * Math.PI * 2) * 5000), 44 + i * 2);
    return bytes;
  }
  await page.getByRole('button', {name:'+ Новая песня', exact:true}).click();
  await page.getByLabel('Название', {exact:true}).fill('Разметка вручную');
  await page.getByLabel('Название', {exact:true}).press('Tab');
  const audioPlayer = () => page.locator('.text-reference audio');
  await page.evaluate(async audio => {
    const storage = await import('./storage.js');
    const set = await storage.loadSet();
    const song = set.songs.at(-1);
    song.duration = 4;
    song.source = { kind: 'manual', fileName: 'first.wav' };
    await storage.putAudio(song.id, new Blob([new Uint8Array(audio)], { type: 'audio/wav' }));
    await storage.saveSet(set);
  }, [...wave(4)]);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 26);
  await page.locator('.song-select').last().click();
  await page.waitForFunction(() => document.querySelector('.text-reference audio')?.duration === 4);
  const duration = page.getByLabel('Длительность, ММ:СС', {exact:true});
  await duration.fill('02:05');
  await duration.press('Tab');
  assert.equal(await page.getByLabel('Длительность, ММ:СС', {exact:true}).inputValue(), '02:05');
  await page.getByLabel('Длительность, ММ:СС', {exact:true}).fill('02:60');
  await page.getByLabel('Название', {exact:true}).focus();
  assert.equal(await page.getByLabel('Длительность, ММ:СС', {exact:true}).inputValue(), '02:05', 'invalid duration leaves the prior value intact');
  await page.getByRole('tab', {name:'Чистый текст',exact:true}).click();
  await page.getByLabel('Обычный текст', {exact:true}).fill('Одна строка\nПовтор припева\nПовтор припева');
  await page.getByRole('button', {name:'Вставить строки', exact:true}).click();
  await page.getByRole('button', {name:'Режим показа', exact:true}).click();
  assert.equal(await page.locator('#event-view').isVisible(), false, 'untimed draft cannot be shown');
  for (const time of [.3, 1.4, 2.5]) {
    await page.evaluate(t => document.querySelector('.text-reference audio').currentTime = t, time);
    await page.getByRole('button', {name:'Отметить следующую', exact:true}).click();
    assert.ok(Math.abs(await audioPlayer().evaluate(p => p.currentTime) - time) < .1, 'audio position survives editor update');
  }
  await page.getByRole('button', {name:'Отменить отметку', exact:true}).click();
  assert.equal(await page.locator('.cue-row').nth(2).locator('input').first().inputValue(), '');
  await page.getByRole('button', {name:'Отметить следующую', exact:true}).click();
  await page.getByRole('button', {name:'Подтвердить готовность', exact:true}).click();
  assert.equal(await page.locator('.status-pill').textContent(), 'Готова');
  await page.evaluate(async audio => {
    const storage = await import('./storage.js');
    const set = await storage.loadSet();
    const song = set.songs.at(-1);
    song.source = { kind: 'manual', fileName: 'replacement.wav' };
    song.reviewed = false;
    await storage.putAudio(song.id, new Blob([new Uint8Array(audio)], { type: 'audio/wav' }));
    await storage.saveSet(set);
  }, [...wave(7)]);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.song-item').length === 26);
  await page.locator('.song-select').last().click();
  await page.waitForFunction(() => document.querySelector('.text-reference audio')?.duration === 7);
  assert.equal(await page.locator('.status-pill').textContent(), 'Нужно проверить', 'replacement fixture retains its unreviewed state');
  const editorDownload = page.waitForEvent('download'); await page.locator('#export-set').click();
  const editorArchive = await readFile(await (await editorDownload).path());
  const { set: editorExport, backingAudio: editorAudio } = await importPortableSet(new Blob([editorArchive], { type: 'application/zip' }));
  assert.deepEqual(editorExport.songs.at(-1).cues.map(c => c.start), [.3,1.4,2.5]);
  assert.equal(editorAudio.has(editorExport.songs.at(-1).id), false, 'original vocal recording is excluded from the portable archive');
  // Reimport the same IDs while original audio exists: importing a portable set clears private originals.
  await page.locator('#set-file').setInputFiles({name:'collision.zip',mimeType:'application/zip',buffer:editorArchive});
  await page.waitForFunction(()=>document.querySelectorAll('.song-item').length===26);
  await page.waitForFunction(() => !document.querySelector('#import-set').disabled);
  const relinked=await page.evaluate(async id=>(await import('./storage.js')).getAudio(id),editorExport.songs.at(-1).id);
  assert.equal(relinked,null,'original recordings are not restored from portable exports');
  console.log('Editor: sequential tapping, undo, repeated chorus, readiness gating and original preview passed.');

  await page.locator('.song-select').last().click();
  assert.equal(await page.getByRole('tab', {name:'LRCLIB',exact:true}).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#original-file').count(), 0, 'original audio upload is hidden');
  assert.equal(await page.getByRole('button', {name:/Распознать MP3|Рассчитать время по тексту/}).count(), 0, 'recognition controls are hidden');

  const lyricsOnlyJson = JSON.stringify({ ...set, songs: songs.map(song => ({ ...song, backing: { fileName: '' } })) });
  const rootPage = await context.newPage();
  await rootPage.goto(`http://localhost:${port}/`);
  await rootPage.waitForSelector('#editor h1');
  assert.equal(await rootPage.locator('.song-item').count(),0,'new origin has separate storage');
  await rootPage.locator('#set-file').setInputFiles({name:'concert.json',mimeType:'application/json',buffer:Buffer.from(lyricsOnlyJson)});
  await rootPage.waitForFunction(()=>document.querySelectorAll('.song-item').length===25);
  await rootPage.waitForFunction(()=>document.querySelector('#offline-state').textContent.includes('Готово'));
  const longSong = {...songs[0], id:'long-song', title:'Длинный таймлайн', duration:600, backing:{fileName:''},
    cues:Array.from({length:40}, (_, i) => ({id:`long-${i}`,start:i*15,text:`Строка ${i + 1}: длинный текст для проверки переноса слов в режиме показа на большом экране`,type:'lyric'}))};
  await rootPage.locator('#set-file').setInputFiles({name:'long.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...set,songs:[longSong]}))});
  await rootPage.waitForFunction(()=>document.querySelectorAll('.song-item').length===1);
  await rootPage.getByRole('button',{name:'Режим показа',exact:true}).click();
  await rootPage.evaluate(() => { const real=performance.now.bind(performance); let offset=0; performance.now=()=>real()+offset; window.advanceTimeline=seconds=>offset=seconds*1000; });
  await rootPage.locator('#event-start').click();
  await rootPage.evaluate(()=>window.advanceTimeline(450));
  await rootPage.waitForFunction(()=>document.querySelector('.audience-line.active')?.textContent.startsWith('Строка 31:'));
  await rootPage.waitForTimeout(450);
  const geometry=await rootPage.evaluate(()=>{const a=document.querySelector('#audience').getBoundingClientRect(),line=document.querySelector('.audience-line.active').getBoundingClientRect();return {a:{top:a.top,bottom:a.bottom},line:{top:line.top,bottom:line.bottom},gap:Math.abs((a.top+a.bottom-line.top-line.bottom)/2)};});
  assert.ok(geometry.gap<2,JSON.stringify(geometry));
  assert.ok(geometry.line.top>=geometry.a.top && geometry.line.bottom<=geometry.a.bottom,'multiline active cue is visible');
  await rootPage.screenshot({path:output+'/long-audience.png'});
  await rootPage.locator('#exit-event').click();
  await rootPage.locator('#set-file').setInputFiles({name:'concert.json',mimeType:'application/json',buffer:Buffer.from(lyricsOnlyJson)});
  await rootPage.waitForFunction(()=>document.querySelectorAll('.song-item').length===25);
  await rootPage.reload(); // Restore unmodified monotonic clock before the offline event check.
  await rootPage.waitForFunction(()=>document.querySelectorAll('.song-item').length===25);
  console.log('Long multiline timeline: late active cue centered and visible at 450 seconds.');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(()=>document.querySelectorAll('.song-item').length>=25);
  await rootPage.reload();
  await rootPage.waitForFunction(()=>document.querySelectorAll('.song-item').length===25);
  await rootPage.getByRole('button',{name:'Режим показа',exact:true}).click();
  await rootPage.locator('#event-start').click();
  await rootPage.waitForFunction(()=>document.querySelector('.audience-line.active')?.textContent==='Первая строка');
  const storageCheck=await page.evaluate(async()=>{
    const {resetLyrics}=await import('./storage.js');await resetLyrics();
    return {host:localStorage.getItem('nasty-piano-marker'), databases:(await indexedDB.databases()).map(d=>d.name)};
  });
  assert.equal(storageCheck.host,'keep');
  assert.ok(storageCheck.databases.includes('nasty-piano-test-marker'));
  assert.deepEqual(errors,[],'no page runtime errors');
  console.log('Browser: 25 songs, event timer, export/import across origins, root/subpath, offline reopening and isolated storage passed.');
} finally {
  if(browser) await browser.close();
  server.kill();
}
