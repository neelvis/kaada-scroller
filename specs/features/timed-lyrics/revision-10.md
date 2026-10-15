# Timed lyrics revision 10: compact display controls

Feature ID: TL (extension)
Status: Implemented, verified and deployed — event rehearsal pending
Revision: 10, 2026-10-15
Baseline: [live display controls](revision-4.md), [pause and resume](revision-7.md),
[plain lyrics and uniform scrolling](revision-8.md)

## Purpose and scope

Keep the audience display readable while making song navigation and playback
controls compact and readily available. This revision covers display mode only.
The separate draft [scrolling speed revision](revision-9.md) is not a dependency
and is not approved or implemented by this revision. Preparation, timing rules,
audio synchronization, and project persistence retain their approved behavior.

## Requirements

- **TL-R56 — Anchored media-library menu:** Replace the display hamburger with
  a media-library icon and an accessible Russian name/tooltip. Open the existing
  songs/projects popup beside the triggering button, normally immediately below
  it, rather than centered on screen. Keep the popup within the viewport on
  opening, resizing, and fullscreen changes; allow its contents to scroll.
  Preserve ready-song restrictions, current-song identification, song/project
  switching, uninterrupted playback when merely opening the popup, and dismissal
  with Escape, outside interaction, and the trigger/close button. Restore focus
  to the trigger on dismissal.
- **TL-R57 — Fullscreen preparation navigation:** Hide `К подготовке` while
  the audience display is fullscreen. Restore it on leaving fullscreen. The
  fullscreen control remains available to leave fullscreen, and browser Escape
  retains its usual behavior.
- **TL-R58 — Timeline and icon row:** Place the timeline, elapsed/total times,
  and all ordinary lower controls in one compact horizontal row, with the icon
  controls to the right of the timeline. Use icons for Start/Pause, Stop and
  Reset, Enter/Exit Fullscreen, Mute/Unmute, and current-line emphasis. Provide
  Russian tooltips on hover and keyboard focus, accessible action names, visible
  focus, and toggle state where applicable. Update action names/icons with
  playback, mute, and fullscreen state. Pending startup and unavailable actions
  retain their existing disabled behavior. Without a backing track, keep the sound
  button visible and disabled, with a crossed-speaker icon and the exact tooltip
  `для этой песни нет минусовки`. With a backing track, retain active mute/unmute
  controls and state-dependent tooltips. At narrow widths, compact the row without overlapping
  controls or causing horizontal page overflow; keep the icons after the
  timeline. Audio-error explanations and the explicit lyrics-only recovery
  action remain readable when needed.
- **TL-R59 — Emphasis icon:** Replace the visible emphasis checkbox with an
  accessible toggle button. When disabled, its icon shows three lines with equal
  width and equal visual treatment. When enabled, the three equally long lines
  represent past, current, and upcoming lyrics: subdued past, emphasized current,
  and ordinary upcoming. Preserve the existing initial preference, browser-local
  preference persistence, equal lyric styling when disabled, and immediate
  updates without seeking or interrupting playback.
- **TL-R60 — Fullscreen panel visibility:** Outside fullscreen, keep the bottom
  panel fully opaque. In fullscreen, show it fully opaque initially and reduce
  its opacity to exactly 30% after two seconds without pointer hover or keyboard
  focus anywhere in the panel. Always retain the panel's full dimensions,
  position, controls, and pointer interaction; do not minimize it or substitute
  miniature controls/a reveal strip. Hover anywhere in the full panel, keyboard
  focus, touch, and active timeline manipulation restore full opacity and cancel
  pending dimming. Leaving starts a fresh two-second delay. Opacity changes
  must not shift the lyrics or alter playback/seek state. Audio failure keeps
  its explanation and recovery controls fully opaque. Leaving fullscreen or
  display cancels pending dimming and restores full opacity on next entry.
- **TL-R61 — Display shortcuts:** Space toggles Start/Pause, M toggles backing
  mute, C toggles current-line emphasis, F toggles fullscreen, L opens the library
  popup, and +/− increase
  or decrease the audience font in display mode. Font shortcuts share the
  buttons' four-pixel step and 28–100 pixel limits; accept main-keyboard + or =,
  minus, and numeric-keypad Add/Subtract. They invoke the
  same actions and state restrictions as the buttons. Do not apply these
  shortcuts while editing text, inside an open menu/dialog, with Ctrl/Alt/Meta,
  or on auto-repeated keydown. Space takes precedence over focused display buttons:
  it toggles playback exactly once, including after the library menu closes and
  focus returns to its trigger. It must not reopen that menu or activate another
  focused display control. Enter retains normal focused-button activation. Existing
  ArrowUp/ArrowDown seeking and preparation-space tapping remain intact. Show
  the new shortcuts in the corresponding tooltips. Shortcut handling does not
  require the bottom panel to be fully opaque.
  While the library popup is open, suppress both Space keydown and keyup default
  activation: Space must not activate any focused song/control, close the popup,
  reset/seek/switch the selected song, or change running/paused state. L while
  already open leaves the popup open. Existing Enter/mouse selection and Escape
  dismissal remain available.

TL-R56 supersedes the hamburger presentation and centered popup in TL-R38.
TL-R59 supersedes the checkbox presentation in TL-R36. TL-R58 supersedes
text-button presentation in TL-R49, preserving its playback transitions.
All other applicable approved behavior remains in force.

## Acceptance criteria

- **TL-AC46 (R56):** At desktop and narrow viewports, open the library popup
  and verify that it is anchored near its trigger and remains inside the viewport,
  including fullscreen and resize. Verify outside/Escape/trigger dismissal,
  focus restoration, ready/draft song restrictions, and continued playback while
  the popup is open.
- **TL-AC47 (R57–R59):** Verify preparation navigation disappears only in
  fullscreen and returns after exit. Inspect the bottom row at 1920, 1440, 768,
  and 375 CSS pixels: icons follow the timeline, remain usable, and do not overlap
  or overflow. Verify icon-only presentation, hover/focus tooltips, accessible
  action names, startup/end restrictions, and updated play/pause, fullscreen,
  mute, and emphasis states. Verify both three-line icon treatments and emphasis
  preference persistence across song switching and reload. Switching to a song
  without backing audio keeps a disabled crossed-speaker button with the exact
  no-backing tooltip; switching back restores normal mute/unmute interaction.
- **TL-AC48 (R60):** Verify the panel reaches 30% opacity after two seconds
  outside pointer and keyboard focus, remains fully opaque while hovered/focused
  or dragging the timeline, and returns to full opacity from hover anywhere in
  the full panel, keyboard focus, or touch. Compare panel bounding boxes before
  and after dimming: size and position remain identical, all controls stay
  interactive, and no miniature/reveal strip remains.
  Check a fresh delay on departure, touch restoration, error/recovery opacity,
  fullscreen exit/reentry, and display exit. Compare lyric position and playback
  state before and after visibility changes; no jump, pause, reset, or seek occurs.
- **TL-AC49 (R61):** Exercise Space, M, C, F, L, +, and − with the panel fully opaque and dimmed,
  with and without backing audio, while running/paused, during startup, and at
  song end. Check that editable fields, open menus/dialogs, modifier combinations,
  repeated keydown, and Space on focused buttons cause no accidental or duplicate
  action. After library dismissal via Escape, close button, and outside interaction,
  leave focus on the trigger; Space starts/pauses playback without reopening the
  menu. On other focused display buttons, Space controls playback and Enter
  activates the button normally. Verify main/keypad font keys use the same
  four-pixel step and 28–100 bounds as buttons, preserve playback position, and
  respect input/menu/modifier/repeat guards. Repeat existing five-second seek and
  preparation-tapping scenarios.
  With nonzero playback position, open the library via L and physically press
  Space on current/other song and menu-control buttons. Keep the popup, selection,
  and running/paused state unchanged; running time continues and paused time stays
  fixed. Test L guards and repeated L while open, and retain Enter/mouse selection.

On 2026-10-15, after publication, the user requested F for fullscreen and full-size
30% panel opacity instead of minimization. This bounded local UI refinement
updates TL-R60/TL-R61 and their acceptance criteria; the user's explicit request
establishes the exact changed behavior. Retain the previous three-second delay
and interaction guards. It does not change playback or preparation workflows.

The user subsequently reported Space reopening the media menu after interaction
and requested +/− font shortcuts. This small explicit correction supersedes the
original focused-button Space exception in TL-R61. Menu dismissal still restores
accessible focus; the display shortcut now takes precedence on focused buttons.
The user then explicitly shortened the idle-opacity delay to two seconds.
The user also requested a visible, disabled crossed-speaker button with the exact
no-backing tooltip above, superseding the original hidden mute-button rule.
The user later requested L to open the popup and complete suppression of native
Space activation inside it. These small explicit corrections extend TL-R61;
simply ignoring playback shortcuts is insufficient because focused buttons have
their own native Space action.

## Sources, decisions, and handoff

Requested by the user on 2026-10-15. The user explicitly approved the linked
draft with `подтверждаю` on 2026-10-15. Approved draft SHA-256:
`5e29bd2be17d62782c324738181dde63623142b7115e366439f4db09766a3d8a`.
This includes the combined pointer/focus interpretation, keyboard/touch reveal,
native Space activation on focused buttons, and keeping audio errors visible.

Technical ownership: `lyrics-site/public/index.html` defines the display controls
and menu; `lyrics-site/public/app.js` manages playback icons, menu positioning,
emphasis preference, panel visibility, and shortcuts; `lyrics-site/public/styles.css`
provides icon states and the compact layout. Before this revision, the menu was
centered and controls were split from the progress row. Regression coverage is
in `lyrics-site/tests/live-display-browser.mjs` and
`lyrics-site/tests/plain-scroll-browser.mjs`.

## Verification

On 2026-10-15, the portable build, all 61 unit tests, base browser suite,
plain-scroll browser suite, and live-display browser suite passed locally in
desktop Chrome. The display scenarios cover TL-AC46–TL-AC49 with ready/draft song
navigation, anchored popup resizing and fullscreen bounds, accessible icon state,
1920/1440/768/375-pixel row geometry, native/global shortcuts, fullscreen timers,
pointer and keyboard recovery, stable lyric position, and playback regressions.
Desktop and narrow display screenshots were visually inspected. Independent
source review found no material production findings.

`lyrics-site/tests/display-controls-browser.mjs` additionally passed real keyboard
focus tooltips, editable/menu shortcut guards, Space at song end, fullscreen timer
cancellation/reentry, emulated touchscreen reveal without seeking, and fullscreen
audio-error visibility. Its touch scenario exposed sticky CSS hover overwriting
pointer state; the corrected handler uses actual pointer events. A focused
independent rereview found no material regression in that correction.

The user subsequently requested `коммит, пуш и деплой` on 2026-10-15.
Application commit `66e2bc3` was pushed to `main`; paired release
`20261015_082900` was activated on 2026-10-15. Independent package review accepted
all 51 staged hashes; all 22 backend/runtime files and deployment scripts match
the previous pair `20261014_142714`, retained for rollback. Live HTTPS hashes,
health, anonymous project/audio rejection, and JS/MJS/WASM MIME passed. The full display and supplemental controls
browser suites also passed against production with synthetic browser-local
lyrics/audio. No private school projects were modified. Close and reopen existing
tabs to adopt the new cached shell. Projector/event-device rehearsal remains an
organizer check.

## Fullscreen follow-up verification

The requested F shortcut and full-size 30% idle-opacity refinement passed syntax,
portable build, full live-display browser, and supplemental controls browser
checks on 2026-10-15. Verified F enter/exit and input/menu/modifier/repeat guards,
0.3 opacity with identical panel bounds and pointer interaction, hover/focus/touch
restoration, stable lyric position, and existing playback/error behavior.
Publication evidence for the refinement is recorded separately from the original
release above.

Follow-up application commit `1cd15cc` was pushed to `main`; paired release
`20261015_084025` was activated on 2026-10-15. Independent source/package review
accepted all 51 stage hashes with unchanged service/runtime and deployment
scripts. Prior pair `20261015_082900` is retained for rollback. Live HTTPS asset,
health, privacy and MIME checks passed. The supplemental controls suite passed
against the production origin, including F, 30% opacity, full-panel geometry,
hover/focus/touch restoration, and error visibility with synthetic local data.

## Keyboard and unavailable-audio refinement verification

On 2026-10-15, syntax, portable build, the full display browser suite, and the
supplemental controls suite passed for the subsequent refinements. Actual Space
presses after Escape, close-button, and outside menu dismissal keep the library
closed and toggle playback while retaining accessible trigger focus. Space on a
focused font button controls playback, while Enter changes the font. Font shortcut
steps, main/keypad keys, limits, and editing/menu/modifier/repeat guards passed.
The opacity test confirms no dimming before 1.7 seconds and dimming within the
next 0.9 seconds; the configured timer is exactly 2000 ms. No-backing songs show
the disabled crossed-speaker control and its exact hover tooltip; backed songs
retain enabled sound controls. Independent source/package review found no
material findings.

Application commit `ddae475` was pushed to `main` and published as paired release
`20261015_085345` on 2026-10-15. Final V3 package review accepted all 51 hashes;
only app/index/cache changed, with backend/runtime and deploy scripts unchanged.
Prior pair `20261015_084025` is retained for rollback. HTTPS asset hashes, health,
anonymous private-data rejection and MIME checks passed. An isolated production
browser verified actual Space after all menu-dismissal routes, focused buttons
and Enter, main/keypad font steps and bounds, preserved paused position, measured
two-second dimming, and the visible disabled crossed speaker with the exact
no-backing tooltip. No private school projects were modified.

## Library-key refinement verification

On 2026-10-15, syntax/build, 64 unit tests, full display, supplemental controls,
and LRCLIB browser checks passed. Physical L opens the popup and leaves an already
open popup intact. Physical Space on current/other ready-song buttons, close and
trigger buttons leaves the popup open and selection unchanged. Paused position
stays fixed; running audio/time continue without reset or pause. Closed-popup
Space, Enter/mouse selection, modifier/editing/dialog guards, and library access
without an armed song remain functional. Independent review found and verified
the correction of the no-armed-song guard ordering. The user explicitly requested
committing all working-tree changes; revision 9 is included as a draft only.

Commit `e9c659e` includes all requested tree changes and was pushed with the
previous local LRCLIB commit. Paired release `20261015_090722` was activated on
2026-10-15 after independent source/package acceptance; prior pair
`20261015_085345` is retained. HTTPS hashes, health, anonymous private-data
rejection and MIME passed. An isolated live browser verified L/idempotence and
physical Space suppression on current/other songs, close and trigger buttons,
plus closed-popup playback and font/timer/audio regressions. No private projects
were modified. The working tree was clean after the all-tree application commit.
