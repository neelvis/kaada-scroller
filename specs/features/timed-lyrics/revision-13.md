# Timed lyrics revision 13: manual scrolling in display mode

Feature ID: TL (extension)
Status: Implemented — build and syntax checked; browser verification pending
Revision: 13, 2026-10-15
Baseline: [display keyboard and optional uniform scrolling](revision-12.md)

## Purpose and scope

Let the organizer move lyrics manually during a show when uniform auto-scroll is
disabled for a song that ignores timecodes. Manual lyric navigation must not
control or interrupt backing-track playback or the show timeline.

## Requirements

- **TL-R70 — Manual lyric scrolling:** When a song is in ignore-timecodes mode
  and its `начинать автоскролл через, сек` checkbox is unchecked, do not move
  the lyrics automatically. In display mode, ArrowDown advances the lyric
  position by five lines, a downward mouse-wheel gesture over the lyric display
  advances it by five lines, and an upward gesture moves it back by five lines.
  Keep the lyric position at the selected manual position until another manual
  scroll action or the existing song end state.
  ArrowDown while the progress control has focus retains its existing five-second
  timeline-seek behavior. In all other modes, preserve existing display
  navigation behavior.
- **TL-R71 — Playback independence:** Manual lyric scrolling changes only the
  visible lyric position. It must not seek, pause, resume, stop, mute or otherwise
  change the backing track or show timeline; backing audio continues from its
  current playback position.
- **TL-R72 — Preparation notice:** When ignore-timecodes mode and the unchecked
  auto-scroll setting are both selected during preparation, show a notice below
  the related checkboxes explaining that scrolling in display mode is manual
  only. Hide this notice when auto-scroll is checked or ignore-timecodes mode is
  off. The notice does not change readiness or persistence behavior.

## Acceptance criteria

- **TL-AC56 (R70):** With ignore-timecodes selected and auto-scroll unchecked,
  preparation shows the manual-only notice below its checkboxes. In display
  mode, lyrics remain still until input; ArrowDown and a wheel gesture over the
  lyric display each move it by exactly five lines: ArrowDown and wheel-down
  advance, while wheel-up moves back, including near the beginning and end of
  the lyric list. Repeated input advances in five-line steps. The progress
  control's ArrowDown still seeks forward five seconds. With
  auto-scroll enabled or ignore-timecodes off, existing scrolling and keyboard
  behavior remains intact.
- **TL-AC57 (R71):** While backing audio is playing, use ArrowDown and the mouse
  wheel to move lyrics. Confirm that audio playback and show elapsed time
  continue from their prior positions without seeking, pausing or restarting.
- **TL-AC58 (R72):** The notice appears only for ignore-timecodes plus
  auto-scroll disabled. It is hidden for timed mode and when auto-scroll is
  enabled. The setting and existing auto-scroll delay retain their current
  persistence behavior.

## Evidence and approval

Requested by the user on 2026-10-15. Revision 12 specifies that disabling
auto-scroll leaves ignored-timecode lyrics stationary. Before this revision,
the display keyboard handler in `lyrics-site/public/app.js` mapped ArrowDown to
a five-second seek; the display lyrics were rendered as a uniform-scroll list.
Revision 13 uses ArrowDown for five-line lyric navigation in manual mode while
keeping ArrowDown on the progress control as a five-second seek.

The user approved this reviewed draft with `ага` on 2026-10-15. This approval
covers the requirements and acceptance criteria in this revision, including the
five-second ArrowDown seek when the progress control has focus.
