# Timed lyrics revision 9: adjustable untimed scrolling speed

Feature ID: TL (extension)
Status: Draft — awaiting explicit user approval
Revision: 9, 2026-10-14
Baseline: [uniform scrolling](revision-8.md), [display controls](revision-7.md)

## Requirement

- **TL-R55 — Untimed scroll speed:** In display mode, show a labeled scrolling
  speed control only for songs with `ignore timecodes` enabled. Allow multipliers
  from 0.5x to 2x, initially 1x for each newly opened song, with the current value
  visible. Changing speed affects subsequent text movement immediately without
  jumping its current position. Retain the 10-second introduction. At 1x with
  no intervening speed changes, preserve the existing uniform-scrolling schedule.
  Music, elapsed time and declared song end continue on their normal timeline.
  If text reaches the last line early, hold it until the usual end state; a slower
  speed may leave text short of the last line when the declared song end is reached.
  Pause freezes text; speed can be changed while paused and applies on resume.
  Seeking recalculates text position from the chosen timeline time using the
  current multiplier. Reset returns to the beginning while retaining the selected
  multiplier; switching songs or reopening display starts at 1x. The multiplier
  is a display-session setting and does not change stored timing, song readiness
  or saved project data. Timed songs retain their existing controls and behavior.

This extends TL-R53's constant-speed rule when the organizer changes the multiplier.
Existing short-song, single-line, resize, font and offline behavior still apply.

## Acceptance criteria

- **TL-AC45 (R55):** Verify the control appears only in ignore-timecodes mode,
  defaults to 1x, and accepts 0.5x and 2x. For equal elapsed intervals after the
  introduction, spatial travel at 2x is four times travel at 0.5x, before clamping.
  Changing speed mid-song or while paused causes no position jump. Verify resume,
  seek, reset, switching songs, early last-line arrival and the declared end at
  both range limits, with and without backing audio. Verify responsive layout and
  keyboard operation; the music timeline and timed-mode regression remain intact.

## Approval

Requested on 2026-10-14. This draft is not yet approved; implementation is pending.
