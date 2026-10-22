# Timed lyrics revision 23: backing player controls and cue assignment

Feature ID: TL (extension)
Status: Deployed — acceptance pending
Revision: 23, 2026-10-23
Baseline: [Specification](spec.md), [cue ordering and interludes](revision-17.md), and [preparation toolbar actions](revision-22.md).

## Purpose and scope

Make backing-music playback easier to control while preparing a song, and assign
the current music position to a chosen timeline row from the player. This
replaces the per-row clock action with a player-based flow. Existing audio
storage, song playback, cue ordering, readiness, and save behavior remain in
force.

## Requirements

- **TL-R136 — Styled full-width backing player:** The backing-music player fills
  the available width of its parent with comfortable internal spacing and uses
  the application's visual style. Show a progress bar with elapsed and total
  time. Place all player buttons below the progress bar, left-aligned, in this
  order: Play/Pause, Stop, seek backward, seek forward, the three playback
  speed choices, and clock. Use icons for every button and provide a tooltip and
  accessible name for each. Keep the controls usable at narrow widths.
- **TL-R137 — Player playback, seeking and speed:** Play/Pause toggles backing
  audio playback. Stop pauses playback and resets position to the beginning.
  Previous/next seek controls move the backing track by 0.5 seconds per
  activation. Clamp seeking at the beginning and end of the track and preserve
  whether playback is running or paused. Provide three mutually exclusive speed
  controls: `0.5×`, `1×`, and `2×`. Start at `1×`; selecting a speed applies it
  immediately to the backing track and visibly identifies the active choice.
- **TL-R138 — Assign current position to a cue:** Remove the clock action from
  every cue row. Add a clock action to the backing player with tooltip and
  accessible name `назначить текущее время строке`. Activating it opens a
  selection dialog listing every timeline row in its existing order, with row
  number, text, currently assigned time (or an explicit indication that it is
  unset), and type (`Текст` or `Проигрыш`). The player position at dialog opening
  is the proposed new time. Selecting one row and saving assigns that time to
  the selected row. Saving requires a selection; canceling or closing the
  dialog makes no changes. The action is unavailable when no backing track is
  present.
- **TL-R139 — Shift later assigned cues:** When the selected row already has an
  assigned time, show an unchecked checkbox at the end of the dialog. Its label
  identifies the signed time difference between the selected row's existing
  time and the proposed new time in seconds. If checked, add that same signed
  difference to every later row in timeline order that already has an assigned
  time, through the end of the song. Leave later unset rows unchanged. When the
  selected row has no assigned time, omit the checkbox and do not shift other
  rows. Apply the exact difference without clamping; existing timeline
  validation reports any resulting invalid time/order for correction. A saved
  assignment or shift invalidates readiness under the existing cue-editing rule.

## Acceptance criteria

- **TL-AC103 (R136):** Verify the backing player spans its parent content width,
  has a styled progress bar with elapsed/total time, and places icon buttons
  below it at the left in the required order. Verify each button has a tooltip
  and accessible name, and the player remains usable on narrow screens.
- **TL-AC104 (R137):** Verify Play/Pause toggles playback and Stop pauses and
  resets to the beginning. Verify each seek arrow changes position by exactly
  0.5 seconds, clamps at both track ends, and does not change the playing/paused
  state. Verify `0.5×`, `1×`, and `2×` each change playback rate immediately,
  only one appears selected, and `1×` is selected initially.
- **TL-AC105 (R138):** Verify the clock opens a dialog with every row's number,
  text, assigned/unset time and type; captures the player position when opened;
  saves that time to only the selected row; and makes no change on cancel, close,
  or save without a selection. Confirm there is no per-row clock control and the
  player action is unavailable without backing music.
- **TL-AC106 (R139):** For an assigned selected row, verify the unchecked
  checkbox displays the signed difference. When checked, verify all later
  assigned rows shift by that amount while unset rows and earlier rows remain
  unchanged. For an unset selected row, verify no checkbox appears and later
  rows do not shift. Verify invalid results use existing timeline validation,
  and any saved cue change invalidates readiness.

## Evidence and approval

The user requested this change on 2026-10-23. Existing backing playback and
player construction are in `lyrics-site/public/app.js` and
`lyrics-site/public/song-editor.js`; cue editing and validation are in
`lyrics-site/public/song-editor.js` and `lyrics-site/public/core.js`. The
existing timeline order and strict timestamp validation remain applicable under
TL-R94 and TL-R6–R8.

Approval: The user approved TL-R136–R139 on 2026-10-23 with `утверждаю`, then
specified the exact button placement/order and icon/tooltip treatment in the
same approval exchange. The reviewed interpretation captures player position
when the clock action opens the dialog, leaves the shift checkbox unchecked by
default, and applies an exact shift without clamping. The user subsequently
requested a commit and deployment after implementation, authorizing delivery of
this revision together with approved revision 24.

Implementation evidence: `lyrics-site/public/app.js` configures the backing
audio as a source for custom controls; `lyrics-site/public/index.html` defines
the player icons; `lyrics-site/public/song-editor.js` renders playback, seeking,
speed and cue assignment; `lyrics-site/public/styles.css` styles the player and
dialog; and `lyrics-site/public/cue-editor.css` removes the per-row clock
column. The existing browser assertion for row controls was updated in
`lyrics-site/tests/cue-interludes-browser.mjs`. Automated and manual acceptance
checks remain pending. The production build completed, syntax checks passed,
and the feature was published in paired release `20261022_225103`.
