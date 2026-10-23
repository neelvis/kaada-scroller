import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationArtwork } from '../public/artwork.js';

test('presentation chooses only the active project override, then project, primary and nothing', () => {
  const song = { cover: 'primary', projectCovers: [{ projectId: 'A', cover: 'song-A' }, { projectId: 'B', cover: 'song-B' }] };
  assert.equal(presentationArtwork(song, 'A', 'project-A'), 'song-A');
  assert.equal(presentationArtwork(song, 'B', 'project-B'), 'song-B');
  assert.equal(presentationArtwork(song, 'C', 'project-C'), 'project-C');
  assert.equal(presentationArtwork(song, 'C'), 'primary');
  assert.equal(presentationArtwork({ projectCovers: song.projectCovers }, 'C'), '');
  assert.equal(presentationArtwork({ ...song, projectCovers: [{ projectId: 'A', cover: '' }] }, 'A', 'project-A'), 'project-A');
});

test('standalone presentation ignores project artwork and legacy songs need no new metadata', () => {
  assert.equal(presentationArtwork({ cover: 'primary', projectCovers: [{ projectId: 'A', cover: 'song-A' }] }, null, 'project-A'), 'primary');
  assert.equal(presentationArtwork({}, null, 'project-A'), '');
  assert.equal(presentationArtwork({}, 'A', 'project-A'), 'project-A');
});
