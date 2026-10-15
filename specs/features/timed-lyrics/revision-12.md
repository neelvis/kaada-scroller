# Timed lyrics revision 12: display keyboard and optional uniform scrolling

Feature ID: TL (extension)
Status: Implemented and deployed — UI verification pending
Revision: 12, 2026-10-15
Baseline: [plain lyrics and uniform scrolling](revision-8.md), [preparation refinements](revision-11.md)

## Purpose and scope

Clarify Space behavior in display mode and make uniform scrolling an explicit,
optional setting for songs that ignore cue times. This revision changes the
newly deployed revision 11 behavior for ignored-timecode songs.

## Requirements

- **TL-R67 — Space only controls playback in display mode:** Pressing Space
  while display mode is active performs only the existing start/pause action.
  It never moves focus to the last display control or activates any other
  control, regardless of which element currently has focus. Suppress native
  Space activation and page scrolling so one press cannot also trigger another
  action. Preserve other display shortcuts and playback behavior.
- **TL-R68 — Optional auto-scroll for ignored timecodes:** When
  `игнорировать таймкоды` is selected in preparation, show a checkbox labeled
  `начинать автоскролл через, сек`. Default it to checked to preserve the
  current 10-second auto-scroll behavior. When checked, show a compact numeric
  input about 4–5 characters wide, defaulting to 10 seconds; use the configured
  non-negative whole number as the scroll start. When unchecked, hide the input
  and do not auto-scroll; keep the lyrics at their initial position until the
  existing end state. Songs without a stored setting default to enabled with a
  10-second start. Persist both the enabled state and delay through the
  existing song persistence paths.
- **TL-R69 — Timed mode remains required:** When
  `игнорировать таймкоды` is not selected, hide the auto-scroll checkbox and
  input. Keep the existing requirement that all lyric lines have valid
  timecodes. Preserve existing timed playback behavior.

## Acceptance criteria

- **TL-AC54 (R67):** In display mode, pressing Space while focus is on the
  display controls, another element, or the document only starts or pauses the
  show; focus does not move and no last-focused control is activated. Repeated
  keydown and keyup do not cause extra actions or page scrolling.
- **TL-AC55 (R68–R69):** With ignore-timecodes enabled, its auto-scroll checkbox
  is visible and checked by default, with a compact 10-second input. Unchecking
  it hides the input and lyrics remain stationary for the full song. Rechecking
  it restores the input and uniform scrolling starts at the entered second.
  Zero, values at/beyond song duration, pause/resume and seek behave correctly.
  With ignore-timecodes disabled, both auto-scroll controls are hidden and
  untimed lines fail the existing required-timecode validation. Verify settings
  survive project save/reopen, library reuse/update, portable export/import and
  offline preparation. Legacy songs without the new setting retain the
  existing checked/10-second behavior.

## Evidence and approval

Requested by the user on 2026-10-15. The current display shortcut handler in
`lyrics-site/public/app.js` calls the start action for Space and prevents the
browser default, while a separate preparation handler uses Space to mark the
next cue. The current uniform-scroll setting in
`lyrics-site/public/app.js` and `lyrics-site/public/core.js` always scrolls
ignored-timecode songs after the configured start; it has no enable/disable
setting. The display behavior and preparation-only cue marking must remain
separate.

**Review assumption:** The auto-scroll checkbox starts checked for existing
and new songs so the current 10-second behavior remains the default. The user
approved this draft with `одобряю` on 2026-10-15.

Reviewed draft SHA-256: `4254052e84cc198c814086923c8503471b38cf51c2b0f213df6dd84b900bd69d`.
