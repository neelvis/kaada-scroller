// Text-guided alignment is deliberately conservative: it proposes only a
// model-reported start for the supplied line's own first word.
function normalizedWords(text) {
  return String(text ?? '')
    .toLocaleLowerCase()
    .replace(/[’']/g, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function validStart(value, duration) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < duration;
}

export function timestampedWords(result, duration) {
  const words = [];
  for (const chunk of result?.chunks ?? []) {
    const text = String(chunk?.text ?? '').trim();
    const tokens = normalizedWords(text);
    if (tokens.length !== 1) continue;
    const start = chunk?.timestamp?.[0];
    words.push({ text: tokens[0], start: validStart(start, duration) ? Math.round(start * 1000) / 1000 : null });
  }
  return words;
}

function candidateFor(lineWords, words, index) {
  if (words[index]?.text !== lineWords[0] || words[index].start == null) return null;
  const maximumSpan = words[index].start + 8;
  let matched = 1;
  let cursor = index + 1;
  // Permit an omitted or substituted later word, but use only the supplied
  // first word's timestamp as the proposed cue start.
  for (let expected = 1; expected < lineWords.length && cursor < words.length; expected += 1) {
    const limit = Math.min(words.length, cursor + 4);
    let found = -1;
    for (let actual = cursor; actual < limit; actual += 1) {
      if (words[actual].start != null && words[actual].start > maximumSpan) break;
      if (words[actual].text === lineWords[expected]) { found = actual; break; }
    }
    if (found < 0) continue;
    matched += 1;
    cursor = found + 1;
  }
  const requiredMatches = lineWords.length === 1 ? 1 : Math.max(2, Math.ceil(lineWords.length * 0.6));
  return matched >= requiredMatches ? { index, end: Math.max(index + 1, cursor), matched, start: words[index].start } : null;
}

function strongestCandidate(lineWords, words, from, requiredOccurrences) {
  const candidates = [];
  for (let index = from; index < words.length; index += 1) {
    const candidate = candidateFor(lineWords, words, index);
    if (candidate) candidates.push(candidate);
  }
  if (!candidates.length) return null;
  const bestScore = Math.max(...candidates.map(candidate => candidate.matched));
  const best = candidates.filter(candidate => candidate.matched === bestScore);
  // A repeated phrase with equally good acoustic evidence cannot safely be
  // assigned to one occurrence. Leave it for manual tapping.
  if (best.length === 1) return best[0];
  // Identical supplied occurrences can be matched safely when the remaining
  // acoustic occurrences account for all of them, in order.
  return best.length === requiredOccurrences ? best[0] : null;
}

export function alignLyrics(lyrics, result, duration) {
  const words = timestampedWords(result, duration);
  let nextWord = 0;
  let proposed = 0;
  let unresolved = 0;
  const supplied = lyrics ?? [];
  const cues = supplied.map((cue, cueIndex) => {
    // Rest rows carry organizer-entered text and timing; ASR never changes them.
    if (cue?.type === 'rest') return { ...cue };
    const lineWords = normalizedWords(cue?.text);
    const requiredOccurrences = supplied.slice(cueIndex).filter((later) => later?.type !== 'rest' && normalizedWords(later?.text).join('\u0000') === lineWords.join('\u0000')).length;
    const candidate = lineWords.length ? strongestCandidate(lineWords, words, nextWord, requiredOccurrences) : null;
    if (!candidate) {
      unresolved += 1;
      return { ...cue, start: null };
    }
    nextWord = candidate.end;
    proposed += 1;
    return { ...cue, start: candidate.start };
  });
  return {
    cues,
    alignment: { total: cues.filter(cue => cue.type !== 'rest').length, proposed, unresolved, wordCount: words.length },
  };
}
