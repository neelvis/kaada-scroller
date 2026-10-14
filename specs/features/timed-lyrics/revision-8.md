# Timed lyrics revision 8: plain lyrics and uniform scrolling

Feature ID: TL (extension)
Status: Implemented and locally verified — not deployed; event rehearsal pending
Revision: 8, 2026-10-14
Baseline: [specification](spec.md), [LRCLIB import](revision-5.md),
[preparation](revision-6.md), [pause and resume](revision-7.md)

## Purpose and scope

Prepare songs without synchronized lyrics by importing ordinary LRCLIB text
and optionally showing it with uniform scrolling. This extends preparation,
readiness, playback, and persistence. Deployment is outside this request.

## Requirements

- **TL-R50 — Own-text label:** Rename the preparation tab and panel heading
  `Чистый текст` to `Свой текст`. Keep the existing manual plain-text workflow.
- **TL-R51 — LRCLIB plain-text import:** For results labeled `LRC недоступен`,
  show an adjacent `Вставить чистый текст` button. Enable it only when usable
  ordinary lyrics are present; otherwise keep it disabled with an explanation.
  Explicit activation imports the selected record's ordinary lyrics as editable
  lines with empty start times and applies its positive finite duration, including
  replacement of an existing duration. If the record has no usable duration,
  retain the current duration and explain that duration must be supplied manually.
  Preserve wording, line order and repeated occurrences; skip empty separators
  consistently with manual plain-text import. Preserve existing nonempty title,
  artist, version, audio and delay; fill missing title/artist from the record.
  Use the existing replacement confirmation when lines already exist. Cancellation,
  invalid input and obsolete operations leave the entire prior song unchanged.
  Import invalidates review and does not automatically enable ignoring timecodes.
- **TL-R52 — Ignore timecodes:** Above the timeline rows, show a per-song
  checkbox labeled `игнорировать таймкоды`, initially off for new and legacy songs.
  When enabled, stored line times are ignored for readiness and playback; do not
  report missing, negative, unordered or out-of-range cue-time errors. Keep title,
  duration, nonempty text, valid line types and explicit review requirements.
  Toggling the option invalidates review, retains all existing times, and allows
  returning to the usual timed mode with its original validation rules.
- **TL-R53 — Uniform scrolling:** In ignore-timecodes mode, display the start
  of the lyrics for the first 10 seconds of the song timeline. From second 10
  until the declared duration, scroll continuously at a constant spatial speed
  from the first to the last line's normal reading position. Calculate position
  from elapsed playback time, rather than successive frame increments. Stored
  cue times and the existing global timing delay do not affect this mode; retain
  their values for timed mode. At the declared end use the existing end state.
  For a duration of 10 seconds or less, keep the initial position until that end
  state. Single-line songs stay stationary. Wrapped text and viewport/font changes
  must still allow reaching the last line. Do not imply synchronized line timing.
  Pause freezes position, resume continues, seeking recalculates position, and
  reset returns to the beginning. Support playback with and without backing audio.
- **TL-R54 — Persistence:** Preserve the per-song option through local saving,
  explicit shared-project Save, library reuse, portable export/import and offline
  preparation. Existing songs without this option remain in timed mode. Prepared
  offline playback requires no LRCLIB request. Preserve existing project version
  isolation and explicit saving boundaries.

These requirements supersede the affected parts of TL-R5, TL-R7, TL-R8,
TL-AC3, TL-AC5, TL-R42, TL-R43 and TL-R48 only for the new routes/mode.
Existing exact-text, privacy, safe replacement and playback controls remain applicable.

## Acceptance criteria

- **TL-AC41 (R50–R51):** Verify both renamed labels. Import a result without
  usable LRC containing Cyrillic, Latin and repeated plain-text lines; verify exact
  editable text, null times, imported duration and invalidated review. Verify
  unavailable text, absent duration, cancelled replacement and stale import.
- **TL-AC42 (R52):** Untimed and irregularly timed lines produce no timing
  errors while the checkbox is on and can be explicitly marked ready when other
  fields are valid. Other validation still applies. Turning it off restores
  timing errors and preserves the original stored times.
- **TL-AC43 (R53):** With a 70-second song, position stays at the start through
  second 10, reaches half the spatial travel at second 40 and approaches the last
  line at the end. Verify wrapped lines, resized viewport, changed font, pause,
  resume, forward/backward seek, reset, short songs, single-line songs and playback
  with/without backing audio. Timed-mode regression checks must continue to pass.
- **TL-AC44 (R54):** Save/reopen locally and in a shared project, reuse from the
  library, export/import and reopen offline; verify the option and null times
  survive. Import a legacy song and verify timed behavior remains the default.

## Approval and evidence

Requested by the user on 2026-10-14. The user explicitly approved this reviewed draft with `подтверждаю`.
Implementation evidence: `lyrics-site/public/app.js` contains preparation tabs,
LRCLIB results, replacement guards, timeline rows and audience positioning;
`lyrics-site/public/lrclib.js` currently drops ordinary lyrics during normalization;
`lyrics-site/public/core.js` controls validation and portable song normalization.
Approved draft SHA-256: `18d2f9babdbd2a26ee647b6e423f9caa2ca57828ca69f48fc657853722163a81`.
Production implementation is complete locally; no deployment was requested.

## Verification

TL-AC41–TL-AC44 are covered by focused helper tests and
`lyrics-site/tests/plain-scroll-browser.mjs` plus
`lyrics-site/tests/plain-scroll-server-browser.mjs`. The browser scenarios verify
plain import/replacement cancellation/stale edits, readiness and mode restoration,
local reload, spatial positions, wrapped lines and resizing, font changes, pause,
resume, seeking/reset/end, short and single-line songs, backing and lyrics-only
playback, explicit shared Save/reopen, library reuse, portable archives and offline
Start without LRCLIB. Existing LRCLIB failure/race scenarios also pass.

All 61 unit tests, portable build, base browser, LRCLIB browser, display browser,
and redesign browser checks passed on 2026-10-14. Independent scoped review found
no material defects. Mobile import and uniform-display screenshots were inspected.
Actual LRCLIB catalog coverage and event/projector rehearsal remain manual checks.
See [verification report](../../../docs/timed-lyrics-verification.md#revision-8-plain-text-and-uniform-scrolling).
