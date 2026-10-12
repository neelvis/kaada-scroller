# Timed lyrics revision 4: backing tracks and live display controls

Feature ID: TL (extension)
Status: Implemented, verified and deployed — event rehearsal pending
Revision: 4, 2026-10-12
Baseline: [revision 2](spec.md) and [revision 3](revision-3.md)

## Purpose and scope

Add optional instrumental accompaniment, an unobtrusive display mode without
line emphasis, live timeline navigation, and access to songs/projects from the
display. Improve preparation navigation without changing lyric recognition.
The user requested six interface changes after publishing a separate Initial
commit in `neelvis/kaada-scroller`. Initial commit: `b59edd9`.

The following requirements are proposed for review. Their implementation will
use new commits after the Initial commit. Deployment is a separate action.

## Changes to existing requirements

- TL-R1, TL-R2 and TL-R11: Music may now be an optional linked backing track
  played by the application. The original vocal recording remains the timing
  reference. Backing tracks must follow the prepared arrangement and time origin;
  no automatic alignment or live tempo compensation is introduced.
- TL-R11 and TL-R12: Display-time seeking and optional current-line emphasis are
  now supported. These supersede the earlier exclusion of live timing correction
  and the requirement to always emphasize the current line.
- TL-R14, TL-R21, TL-R23, TL-R25, TL-R27 and TL-R31: Backing tracks participate
  in private storage, song revision pinning, quota handling, offline preparation
  and backup/restore just as required below. Older songs remain valid without one.

All other approved requirements remain applicable, including exact lyrics,
readiness, conflicts, privacy, independent hosting and manual event Start.

## Requirements

- **TL-R33 — Separate backing track:** Allow selecting, replacing and removing
  an optional MP3/WAV backing track for each song, separately from its original
  vocal recording. Provide a filename and preview in preparation. Reuse existing
  recording size/duration limits and the aggregate private library quota. Failed
  uploads/replacements preserve the previous saved version. Backing selection
  does not change original-reference recognition inputs, lyrics or cue times.
  Selecting/replacing/removing backing audio requires renewed song review because
  the organizer must check the chosen arrangement against the timeline.
- **TL-R34 — Shared and offline backing persistence:** Preserve a linked track
  through server save/reopen, library reuse and project version pinning. Local
  sets retain it on the current browser. Portable JSON exports retain its label
  but exclude audio bytes and private server identities; importing requires
  explicit relinking. Preparing an offline project includes every linked backing
  track and reports success only when all required audio and viewer data are
  available. Songs without backing audio remain playable offline. Missing audio
  produces a clear message and allows an explicit lyrics-only launch. Private
  audio participates in logout cleanup and server backup/restore.
- **TL-R35 — Synchronized event playback:** Start launches the selected track and
  lyric timeline from the armed position. Mute/unmute affects only audible output;
  it does not pause, restart or shift audio/text. Without a track, Start runs the
  lyric timeline as before. Reset, exiting display and switching songs/projects
  stop old audio and cancel its pending start. Seeking moves the audio and lyrics
  together and preserves running/armed state. Declared song end stops playback.
  A shorter track does not end the lyric timeline early; a longer track stops at
  the declared end. Rejecting playback or decoding audio must show an actionable
  error and offer retry or explicit lyrics-only playback, never a silent assumed
  synchronized start. Duplicate Start does not create overlapping playback.
- **TL-R36 — Optional line emphasis:** Add a compact checkbox labelled
  `Выделять текущую строку` in display controls, enabled initially. Retain the
  preference on this browser across song switches and reopening. When unchecked,
  lyrics continue moving according to the timeline, with equal ordinary emphasis
  for past, current and upcoming lyric lines: no highlighted current line and no
  fading of past lines. Toggling immediately preserves the current position and
  playback. Rest and end semantics remain intact. No live performance recognition
  or automatic tempo adaptation is implied.
- **TL-R37 — Interactive progress:** Keep an accessible progress/seek bar at the
  bottom of the display, showing current elapsed time and total duration. Clicking,
  dragging and keyboard manipulation select a position clamped to the song range
  and update lyrics immediately. ArrowUp moves five seconds backward; ArrowDown
  moves five seconds forward, including when the progress bar has focus. Repeated
  presses work while running or armed. Shortcuts do not interfere with editable
  controls or open menus/dialogs. After reaching the end, seeking backward restores
  the selected lyrics; Start resumes from the armed position. Reset returns to zero.
  Lyric delay changes cue display only, not the audio origin or progress duration.
- **TL-R38 — Display navigation menu:** Add a hamburger button opening a compact
  menu with the current project's ordered songs and project navigation. Identify
  the current song and songs requiring preparation; only ready songs can be
  armed. Selecting another song stops old playback, selects the new song at zero,
  and retains display mode without automatic Start. Project navigation supports
  authenticated online projects and prepared offline snapshots. Selecting a
  project stops the old song and leaves a ready song armed if available; otherwise
  explain that no ready song is available. Preserve existing safeguards for
  unsaved drafts. Menu opening alone does not interrupt playback. Support closing
  via the button, Escape and outside interaction, with accessible focus handling.
- **TL-R39 — Preparation tabs:** Present `Текст и таймкоды` and
  `Оригинальная запись` as accessible tabs; select text/timestamps by default
  whenever a song is opened. Changing tabs preserves edits, recognition jobs,
  preview position and manual tapping functionality. The backing-track section
  remains separately identifiable in preparation; it is not the original input.
- **TL-R40 — Add-song placement:** Position `+ Добавить песню` directly below
  the last song in the preparation sidebar, including short and empty lists.
  Do not push it to the panel bottom through a stretching list. Keep it reachable
  when long lists scroll and at narrow viewport sizes.

## Acceptance criteria

- **TL-AC25 (R33–R35):** Save a song with distinct original and backing files;
  reopen it in another authenticated browser and verify both correct files.
  Replace/remove the backing track without changing lyrics or the original.
  Verify stale saves, upload failure/quota and project pinning preserve prior data.
- **TL-AC26 (R34):** Prepare a project with and without backing tracks, disable
  networking and reopen it. Required backing audio plays without network access.
  A failed audio download prevents a false successful preparation. JSON round
  trips retain lyrics and backing labels while requiring audio relinking. Existing
  revision-3 projects and backups remain readable; new backups restore both roles.
- **TL-AC27 (R35, R37):** Exercise Start, duplicate Start, mute/unmute, seeking in
  both directions, Reset, end, exit and song switching using audible fixtures.
  Audio and progress agree within 250 ms under ordinary foreground playback;
  mute preserves position. Verify rejected playback and missing/short/long tracks.
  No late load or cancelled play can sound after leaving or switching a song.
- **TL-AC28 (R36):** Disable emphasis during playback. Text keeps advancing and
  all lyric lines have equal ordinary emphasis. Reenable without a jump/restart;
  preference survives song navigation and reload.
- **TL-AC29 (R37):** Click/drag the bar and use ArrowUp/ArrowDown in running,
  armed and ended states. Verify five-second steps, bounds, delayed cues and
  restoration from end. Typing or navigating an open menu does not seek the show.
- **TL-AC30 (R38):** Switch ready songs and online/offline projects from display.
  Old playback stops, selection stays in display and awaits Start. Unready songs
  cannot launch. Exercise empty projects, network failure, retained drafts and
  Escape/focus behavior; opening/closing a menu preserves current playback.
- **TL-AC31 (R39–R40):** Opening a song shows text/timestamps. Tab switching loses
  no edits, original-preview position or recognition state. In short, empty and
  25-song sidebars, the add button directly follows the list and remains reachable.
  Inspect desktop and narrow layouts for overlap and readable controls.

## Approval and implementation handoff

No unresolved decision requires a separate question: the proposed five-second
arrow step, checkbox default and switching semantics are explicit above for review.
The user explicitly approved the reviewed draft with “Да” on 2026-10-12.
Reviewed draft SHA-256: `8b8555fcab8d3b777ce8ab3786bad4bc7a0fc789864fef12373bca6613e0de45`. Preserve this approved scope during implementation. Implementation should cover audio persistence and lifecycle first, then
display controls and preparation layout, with focused unit/API/browser checks.

## Delivery evidence

[Revision 4 verification](../../../docs/timed-lyrics-verification.md#revision-4-standalone-repository-validation)
records automated, API, browser and independent-review coverage for TL-AC25–AC31.
The approved scope is implemented. The user authorized deployment on 2026-10-12;
paired release `20261012_080618` is live at NastyEdu. Event rehearsal remains an
organizer check.
