# Timed lyrics revision 15: shift cue times in song preparation

Feature ID: TL (extension)
Status: Implemented — verification pending
Revision: 15, 2026-10-21
Baseline: [Timed lyrics specification](spec.md), [preparation refinements](revision-11.md), and accepted revisions 13–14.

## Purpose and scope

Let an organizer move a song's existing cue times together by a fractional number
of seconds while preparing the song. Keep the cue list readable when the
ignore-timecodes checkbox is off. This does not change the playback-wide delay
setting or how ignored-timecode songs are displayed.

## Requirements

- **TL-R82 — Shift cue times:** In the `Строки таймлайна` section, provide a
  `Подвинуть время` control with a fractional-seconds input and an `Применить`
  button. On apply, add the entered finite signed number of seconds to every cue
  whose current start is a finite number. Preserve cues with missing or
  non-finite starts. Apply the edit whether or not `игнорировать таймкоды` is
  selected. Keep cue order and text unchanged. Use the existing song edit and
  persistence path, and invalidate the song's ready confirmation when any cue
  time changes. Existing validation remains responsible for flagging results
  that are outside the song's valid timing range.
- **TL-R83 — Timeline spacing:** When `игнорировать таймкоды` is off, leave
  visible vertical space between its checkbox and the cue rows.

## Acceptance criteria

- **TL-AC64 (R82):** Apply a positive fractional offset to a song with multiple
  valid cue times and verify each finite cue start increases by exactly that
  offset; cue text, order and missing starts remain unchanged. Repeat with a
  negative offset and with `игнорировать таймкоды` both selected and cleared.
  Verify a changed timeline is no longer marked ready and persists through the
  existing save/reopen path. If a shifted result falls outside the valid range,
  verify existing validation reports it without silently clamping or dropping
  the cue.
- **TL-AC65 (R83):** With `игнорировать таймкоды` off, verify visible space
  separates the checkbox from the first cue row at desktop and narrow widths.

## Evidence and approval

The existing `TL-R6` global delay is applied to playback timing and does not
rewrite cue starts, so it does not cover this preparation edit. The current
editor is `lyrics-site/public/song-editor.js` (`renderCues`); timing validation
and display formatting are in `lyrics-site/public/core.js`. The current
`ignore-timecodes` style has top spacing but no bottom spacing before the cue
table.

Approval: the user explicitly approved TL-R82–R83 and TL-AC64–AC65 on
2026-10-21 after reviewing this draft. Reviewed draft SHA-256:
`471752035b6d12f4ffa3f5829f8bdda3fe86668e80c24ac3b43371dd1d8bd2c2`.
