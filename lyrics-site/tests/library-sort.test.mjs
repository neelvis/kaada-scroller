import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LIBRARY_SORT, LIBRARY_SORTS, sortLibrarySongs } from '../public/library-sort.js';

const songs = [
  { id: 'old', title: 'ёЛКА', artist: 'ёж', createdAt: '2020-01-01T00:00:00Z' },
  { id: 'new', title: 'Alpha', artist: 'Zoo', createdAt: '2024-01-01T00:00:00Z' },
  { id: 'empty-artist', title: 'Zulu', artist: '   ', createdAt: '2023-01-01T00:00:00Z' },
  { id: 'case', title: ' alpha ', artist: 'zoo', createdAt: '2022-01-01T00:00:00Z' },
  { id: 'latin', title: 'Бета', artist: 'Alpha', createdAt: '2021-01-01T00:00:00Z' },
];

test('library sort choices have the requested labels and default to newest first', () => {
  assert.deepEqual(LIBRARY_SORTS.map(option => option.label), [
    'по дате (ранние)', 'по дате (поздние)', 'по исполнителю (А-Я)',
    'по исполнителю (Я-А)', 'по названию (А-Я)', 'по названию (Я-А)',
  ]);
  assert.equal(DEFAULT_LIBRARY_SORT, 'date-newest');
  assert.deepEqual(sortLibrarySongs(songs).map(song => song.id), ['new', 'empty-artist', 'case', 'latin', 'old']);
});

test('date sorting uses original creation dates and stable identity for ties', () => {
  const dated = [{ id: 'b', createdAt: '2024-01-01' }, { id: 'a', createdAt: '2024-01-01' }, { id: 'old', createdAt: '2020-01-01' }];
  assert.deepEqual(sortLibrarySongs(dated, 'date-newest').map(song => song.id), ['a', 'b', 'old']);
  assert.deepEqual(sortLibrarySongs(dated, 'date-oldest').map(song => song.id), ['old', 'a', 'b']);
});

test('artist sorting keeps unnamed artists last and title ties ascending in either direction', () => {
  const artists = [
    { id: 'empty', artist: '', title: 'A', createdAt: '2024-01-01' },
    { id: 'z-title-b', artist: 'Zoo', title: 'Beta', createdAt: '2021-01-01' },
    { id: 'z-title-a', artist: ' zoo ', title: 'alpha', createdAt: '2020-01-01' },
    { id: 'a', artist: 'Альфа', title: 'Gamma', createdAt: '2022-01-01' },
  ];
  assert.deepEqual(sortLibrarySongs(artists, 'artist-asc').map(song => song.id), ['a', 'z-title-a', 'z-title-b', 'empty']);
  assert.deepEqual(sortLibrarySongs(artists, 'artist-desc').map(song => song.id), ['z-title-a', 'z-title-b', 'a', 'empty']);
});

test('title sorting ignores case and outer whitespace', () => {
  const titled = [{ id: 'b', title: ' beta ' }, { id: 'a', title: 'ALPHA' }, { id: 'c', title: 'alpha' }];
  assert.deepEqual(sortLibrarySongs(titled, 'title-asc').map(song => song.id), ['a', 'c', 'b']);
  assert.deepEqual(sortLibrarySongs(titled, 'title-desc').map(song => song.id), ['b', 'a', 'c']);
});
