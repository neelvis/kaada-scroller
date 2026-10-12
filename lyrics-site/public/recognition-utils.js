// Keep only timestamps actually reported by the model; never invent missing starts.
export function recognitionCues(result, duration) {
  const nonEmptyChunks = (result?.chunks ?? []).filter((chunk) => String(chunk?.text ?? '').trim());
  const wordChunks = nonEmptyChunks.filter((chunk) => (String(chunk.text).trim().match(/[\p{L}\p{N}]+/gu) ?? []).length === 1);
  if (wordChunks.length && wordChunks.length === nonEmptyChunks.length) return groupedWordCues(wordChunks, duration);
  const cues = [];
  for (const [i, chunk] of (result?.chunks ?? []).entries()) {
    const text = String(chunk.text ?? '').trim();
    if (!text) continue;
    const start = chunk.timestamp?.[0];
    const valid = typeof start === 'number' && Number.isFinite(start) && start >= 0 && start < duration;
    cues.push({ id: `recognized-${i}`, start: valid ? Math.round(start * 1000) / 1000 : null, text, type: 'lyric' });
  }
  if (!cues.length && String(result?.text ?? '').trim()) {
    cues.push({ id: 'recognized-untimed', start: null, text: String(result.text).trim(), type: 'lyric' });
  }
  if (!cues.length) throw new Error('Не удалось распознать слова. Попробуйте запись с более отчётливым вокалом или загрузите текст.');
  return cues;
}

// MP3-only recognition remains a draft. Group model words into editable phrases
// while retaining a start only where the model actually reported one.
export function groupedWordCues(chunks, duration) {
  const cues = [];
  let group = [];
  const flush = () => {
    if (!group.length) return;
    const first = group[0];
    const start = first.timestamp?.[0];
    const valid = typeof start === 'number' && Number.isFinite(start) && start >= 0 && start < duration;
    cues.push({ id: `recognized-${cues.length}`, start: valid ? Math.round(start * 1000) / 1000 : null, text: group.map(chunk => String(chunk.text).trim()).join(' '), type: 'lyric' });
    group = [];
  };
  for (const chunk of chunks) {
    const start = chunk.timestamp?.[0];
    const previousEnd = group.at(-1)?.timestamp?.[1];
    const firstStart = group[0]?.timestamp?.[0];
    const gap = typeof start === 'number' && typeof previousEnd === 'number' ? start - previousEnd : 0;
    const span = typeof start === 'number' && typeof firstStart === 'number' ? start - firstStart : 0;
    if (group.length >= 7 || gap > 0.85 || span > 8) flush();
    group.push(chunk);
  }
  flush();
  return cues;
}

export function audioEnergy(samples) {
  if (!samples?.length) return 0;
  let squared = 0;
  for (let i = 0; i < samples.length; i++) squared += samples[i] * samples[i];
  return Math.sqrt(squared / samples.length);
}
