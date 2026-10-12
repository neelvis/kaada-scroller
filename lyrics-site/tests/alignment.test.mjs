import test from 'node:test';
import assert from 'node:assert/strict';
import { alignLyrics } from '../public/alignment.js';

function words(items) {
  return { chunks: items.map(([text, start]) => ({ text, timestamp: [start, start + 0.1] })) };
}

test('repeated chorus occurrences retain exact supplied cues and match in recording order', () => {
  const lyrics = [
    { id: 'one', text: 'Припев!', type: 'lyric' },
    { id: 'two', text: 'Припев!', type: 'lyric' },
  ];
  const aligned = alignLyrics(lyrics, words([['Припев', 1], ['Припев', 8]]), 12);
  assert.deepEqual(aligned.cues, [
    { id: 'one', text: 'Припев!', type: 'lyric', start: 1 },
    { id: 'two', text: 'Припев!', type: 'lyric', start: 8 },
  ]);
});

test('omitted or substituted later words still anchor only an evidenced first word', () => {
  const aligned = alignLyrics([{ id: 'line', text: 'Мы идём домой', type: 'lyric' }], words([['Мы', 2], ['домой', 2.5]]), 10);
  assert.equal(aligned.cues[0].start, 2);
  assert.equal(aligned.alignment.proposed, 1);
});

test('a common first word without corroborating words stays unresolved', () => {
  const aligned = alignLyrics([{ id: 'line', text: 'Мы идём домой', type: 'lyric' }], words([['Мы', 2], ['совсем', 2.2], ['другие', 2.4]]), 10);
  assert.equal(aligned.cues[0].start, null);
  assert.equal(aligned.alignment.unresolved, 1);
});

test('matching does not bridge a long instrumental gap', () => {
  const aligned = alignLyrics([{ id: 'line', text: 'Мы идём домой', type: 'lyric' }], words([['Мы', 2], ['идём', 14], ['домой', 14.2]]), 20);
  assert.equal(aligned.cues[0].start, null);
});

test('rests preserve their manual metadata and timing', () => {
  const rest = { id: 'rest', text: 'Инструментал', type: 'rest', start: 4, color: 'blue' };
  const aligned = alignLyrics([rest, { id: 'line', text: 'Дальше', type: 'lyric' }], words([['Дальше', 7]]), 10);
  assert.deepEqual(aligned.cues[0], rest);
  assert.equal(aligned.cues[1].start, 7);
});

test('ambiguous repeated acoustic evidence stays unresolved', () => {
  const aligned = alignLyrics([{ id: 'line', text: 'Эй', type: 'lyric' }], words([['Эй', 1], ['Эй', 8]]), 10);
  assert.equal(aligned.cues[0].start, null);
  assert.equal(aligned.alignment.unresolved, 1);
});

test('punctuation and Cyrillic are retained byte-for-byte while matching words', () => {
  const text = 'Привет, мир!';
  const aligned = alignLyrics([{ id: 'ru', text, type: 'lyric' }], words([['Привет,', 1.2], ['мир!', 1.5]]), 5);
  assert.equal(aligned.cues[0].text, text);
  assert.equal(aligned.cues[0].start, 1.2);
});

test('missing or untimed first word is unresolved instead of proportionally timed', () => {
  const aligned = alignLyrics([{ id: 'line', text: 'Слово дальше', type: 'lyric' }], { chunks: [{ text: 'Слово', timestamp: [null, 1] }, { text: 'дальше', timestamp: [2, 2.1] }] }, 5);
  assert.equal(aligned.cues[0].start, null);
});
