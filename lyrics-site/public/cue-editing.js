import { invalidateReview } from './core.js';

// Destinations are insertion boundaries in the original list, from 0 to length.
// Keeping the source ID separate from its position handles repeated lyric text.
export function moveCueToBoundary(song, cueId, boundary) {
  const from = song.cues.findIndex(cue => cue.id === cueId);
  if (from < 0 || !Number.isInteger(boundary) || boundary < 0 || boundary > song.cues.length) return song;
  const to = boundary > from ? boundary - 1 : boundary;
  if (from === to) return song;
  const cues = [...song.cues];
  const [cue] = cues.splice(from, 1);
  cues.splice(to, 0, cue);
  return invalidateReview({ ...song, cues });
}

export function suggestRestStart(cues, boundary) {
  const latest = cues[boundary - 1]?.start;
  if (!Number.isFinite(latest) || latest < 0) return 0;
  const previous = cues[boundary - 2]?.start;
  if (Number.isFinite(previous) && previous >= 0 && previous < latest) {
    const estimate = latest + (latest - previous);
    if (Number.isFinite(estimate)) return estimate;
  }
  const estimate = latest + 5;
  return Number.isFinite(estimate) ? estimate : latest;
}

export function insertRestCue(song, boundary, cueId) {
  if (!Number.isInteger(boundary) || boundary < 0 || boundary > song.cues.length) return song;
  const cue = { id: cueId, start: suggestRestStart(song.cues, boundary), text: '', type: 'rest' };
  const cues = [...song.cues];
  cues.splice(boundary, 0, cue);
  return invalidateReview({ ...song, cues });
}
