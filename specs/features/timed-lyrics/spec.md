# Feature: Timed lyrics for small live events

Feature ID: TL
Status: Implemented, locally verified and deployed — event rehearsal evidence pending
Draft date: 2026-10-12
Draft revision: 2 — hosting, original-recording baseline, and school branding
Related requirements: KMP-R04 preserves existing NastyEdu storage and origin
Verification: [validation and manual gaps](../../../docs/timed-lyrics-verification.md)
Canonical path: `specs/features/timed-lyrics/spec.md`
Accepted and deployed extension: [revision 3 — shared projects and text-guided preparation](revision-3.md)
(implemented and deployed; supersedes the affected baseline requirements)
Accepted extension: [revision 4 — backing tracks and live display controls](revision-4.md).
Read the applicable extensions before using a superseded baseline rule.

## Purpose

Let an audience sing along at a music-school performance without someone
continuously scrolling lyrics. An organizer prepares and checks a set of 5–25
songs, then starts each song's lyric timeline manually during the event.

This is a portable, self-contained website initially hosted at NastyEdu's
`/lyrics/` path. It can later run at the root of a separate domain. Backing tracks
are played separately. The first version uses an identified original vocal
recording as its timing reference and assumes performers follow that recording's
tempo, structure and timeline. The tool does not listen to the live performance.

This specification was developed in the NastyEdu repository. The standalone
KaadaScroller repository now maintains the lyrics module and its canonical
requirements. Historical hosting evidence remains in the verification report;
the lyrics feature must not require a whole-site migration.
Lyrics implementation is authorized. The user subsequently authorized production
deployment; audio quality measurements and host activation remain separate evidence.

## Scope and non-goals

Include song preparation, timed-lyrics import, automatic timing proposals from
vocal recordings, preparation-time corrections, preview, ordered set lists,
local saving/export, and a readable audience display.

Defer live pause/resume for unexpected solos, live tempo adjustment, microphone
recognition, beat tracking, automatic song recognition, word/syllable karaoke,
accounts, public song sharing, streaming-service integration, and remote control.
Preparation preview may pause and seek; that does not introduce live controls.

## Requirements

- **TL-R1 — Inputs:** Accept a title, optional artist, and UTF-8 lyrics pasted or
  imported as plain text or line-timed LRC. For untimed lyrics, accept an optional
  local MP3/WAV of the selected original vocal recording. A reference is
  unnecessary when a complete, verified timeline already exists. Do not require
  a rehearsal recording or backing-track upload in this first workflow. Duration
  must be supplied or determined before a song is marked ready. When only an MP3 is provided, recognition may
  create the initial editable text and timing draft (TL-R19).
- **TL-R2 — Original-recording baseline:** A timeline belongs to the selected
  original recording version, including its intro, pauses, repeats and ending.
  Record the version description and its time origin; time zero is the beginning
  of that recording, including leading silence. Performers and externally played
  backing tracks are assumed to follow the same timeline, apart from a configured
  constant delay. The app does not verify or compensate for departure from this
  assumption. Album, radio-edit and live versions must not be treated as identical
  merely because their titles match.
- **TL-R3 — Exact lyrics:** Preserve the organizer's displayed wording and line
  breaks. Each performed repeat is a separate occurrence. Require shorthand such
  as “chorus x2” to be expanded before timing. Automatic analysis must not silently
  replace supplied words with a recognized transcript. Render imported text as
  literal text, never as executable HTML.
- **TL-R4 — Timing routes:** Support importing existing line timings, requesting
  automatic draft timings from a vocal reference, and recording line starts by
  tapping a key while listening during preparation. Automatic generation requires
  audible sung words; an instrumental-only input must lead to import/manual
  preparation rather than a fabricated successful alignment.
- **TL-R5 — Draft quality:** Imported and generated timelines initially need
  review. Missing, invalid, or uncertain timings must be visible. Failure must
  retain the supplied text and allow manual completion. Heuristics cannot
  guarantee detection of every plausible but incorrect timing.
- **TL-R6 — Corrections:** In preparation, allow editing individual line starts,
  replaying/seeking the reference, retapping a selected passage, and applying a
  single global delay. Positive delay means the text appears later. Changed
  wording, occurrence order, timings, reference version, or delay invalidates the
  previous ready confirmation for the affected song.
- **TL-R7 — Cue semantics:** A lyric line becomes active at its start time and
  remains active until the next cue. Explicit instrumental/rest cues may replace
  lyric highlighting during long gaps. Before the first lyric, show upcoming
  lines without an active lyric. At the declared song end, stop advancement and
  show a neutral end state. Do not infer lyric end times from basic LRC alone.
- **TL-R8 — Validation:** Ready songs have finite, nonnegative cue times in
  strictly increasing order, with all cues before the declared end. Multiple
  texts at one timestamp must be combined into one display cue or resolved by
  the organizer. Reject malformed input with an actionable message; never silently
  discard lyric occurrences. Expand valid repeated timestamps on an imported LRC
  line into distinct occurrences before validation.
- **TL-R9 — Set preparation:** Support at least 25 songs per set, editable order,
  independent per-song processing states, progress, and retry of failed songs.
  One failure must not prevent other songs from being prepared. Exact pairing of
  lyrics and reference files must be shown for confirmation rather than guessed
  silently when ambiguous.
- **TL-R10 — Readiness:** The organizer previews and explicitly marks each song
  ready. Show which songs still need work. Ready means user-checked for this
  version, not automatically certified by an alignment model.
- **TL-R11 — Event launch:** Select a ready song, arm its audience display, and
  press Start together with the separate music launch. Start advances a local
  timeline automatically from zero. Prevent accidental duplicate starts. An
  explicit end/reset action returns to the armed state; there is no live
  pause/resume or timing correction in this version.
- **TL-R12 — Audience display:** Offer full-screen, high-contrast text with an
  adjustable large font, a clearly emphasized current line, and at least two
  upcoming lines visible at the agreed test viewport. Reflow wrapped text without
  splitting a timed occurrence. Move smoothly to keep the active line near a
  stable reading position. Hide preparation controls and show no ads.
- **TL-R13 — Event independence:** After an initial online visit, verified local
  app caching and local set preparation/import, reopening the application and
  running the set requires no internet, lyric service, model or audio-analysis
  process. Show whether offline preparation has succeeded; do not promise offline
  reopening before it has. The audience view stays in the foreground; the event
  laptop must remain awake. After a reload, return to the armed state instead of
  assuming an ongoing song is synchronized. Device sleep is not a supported
  continuation condition. Online lookup is optional and unavailable offline.
- **TL-R14 — Persistence:** Save preparation locally and export/import a portable
  set containing text, timings, order, duration, delay, version metadata, and
  review state. Concert playback must not require reference recordings. If audio
  is excluded from an export, explain that preparation preview requires relinking
  it. Preserve manual corrections unless the organizer explicitly replaces them.
  Explain that browser data belongs to its current origin: moving to another
  domain requires exporting on the old origin and importing on the new one.
  Song data must not depend on the previous host's URLs or storage.
- **TL-R15 — Languages and privacy:** Support Cyrillic and Latin lyrics, initially
  Russian and English. Process supplied recordings locally in the proposed first
  implementation. Optional online lyric lookup must be separate from audio
  processing and must not upload the organizer's recordings. The browser can
  import results from the optional local preparation helper; a hosted Python or
  inference service is not required for the initial deployment.
- **TL-R16 — Portable hosting:** Ship an independently deployable static artifact
  that works both at NastyEdu's `/lyrics/` and at a dedicated domain's `/`, without
  source changes or NastyEdu runtime APIs, authentication, navigation, styles or
  course assets. Canonicalize `/lyrics` to `/lyrics/`. The host only mounts the
  artifact; relocation must not require migrating the host application.
- **TL-R17 — Coexistence and data boundaries:** Use lyrics-owned storage/cache
  namespaces. Offline caching, upgrades and reset actions must affect only this
  application, never NastyEdu's courses or piano history. Do not take control of
  host routes outside the mount path. User-imported lyrics and audio remain local
  and are not included in the public deployment artifact. This is functional
  isolation, not a security boundary against other scripts on the same origin.
- **TL-R18 — School branding:** Use `#23C0EB` as the principal accent and the
  monochrome logo color, with coordinated dark backgrounds and readable light
  text. Audience and preparation views belong to this theme independently of
  NastyEdu's visual shell. Convey the active line through emphasis/position as
  well as color. The official logo graphic has not been supplied; use a neutral
  text title until it is available rather than inventing a school logo.

- **TL-R19 — MP3 recognition in the baseline:** Accept an original vocal MP3
  without a separately supplied lyric text and generate editable text with timing
  proposals. Preserve any already supplied/manual text unless the organizer
  explicitly chooses replacement. Show loading/processing progress, allow
  cancellation and report decoding, model-loading or recognition failure without
  corrupting the set. Recognition runs locally in the browser; first model/runtime
  downloads need internet. Event display must not depend on recognition availability.
  Russian and English are initial language choices; output requires review because
  singing can be mistranscribed. Do not infer lyric success solely from instrumental
  audio: show empty/weak results as a failed/unreviewed draft, not a ready song.

## Acceptance criteria

- **TL-AC1 (R1–R3, R8):** Import a fixture containing Cyrillic, Latin text,
  repeated choruses, repeated LRC timestamp tags, and wrapped long lines; all
  performed occurrences and displayed words survive import/export unchanged.
- **TL-AC2 (R4–R6):** Complete an untimed song by tapping during one listening
  pass, undo/retap an incorrect passage, and adjust a line without redoing the
  whole song. Retain the text when automatic processing fails.
- **TL-AC3 (R5, R8–R10):** Invalid, missing, ambiguous, and out-of-range timings
  prevent readiness and point to affected cues. Automatic drafts need explicit
  organizer review even when no anomaly is detected.
- **TL-AC4 (R6, R11):** A positive 1-second delay moves every cue 1 second later.
  Repeated Start input does not restart the running timeline. Reset and a new
  explicit Start reproduce the same schedule.
- **TL-AC5 (R7, R12):** Preview an intro, a repeated chorus, a 30-second rest cue,
  and the declared end. The display follows the cue semantics and does not advance
  through lines at a constant scrolling speed.
- **TL-AC6 (R9, R14):** Prepare, reorder, save, export, and reimport a 25-song set.
  A failed processing job leaves completed songs and manual edits intact.
- **TL-AC7 (R11–R13):** On the selected event laptop and browser, run a 10-minute
  synthetic timeline with irregular cues and temporary rendering stalls. Each
  active-line change follows elapsed time within 250 ms, without accumulated
  scheduling drift. This excludes human launch error and musical tempo changes.
- **TL-AC8 (R12):** At 1920×1080, the agreed lyric fixtures show the current and
  two upcoming lines at the chosen concert font size. Check readability on the
  actual projector from audience seating before event use.
- **TL-AC9 (R13–R17):** After the initial online cache preparation, close the
  application, disable networking, reopen its bookmarked URL and import a ready
  set. Run all songs without an external service or missing reference audio.
  Verify this independently at `/lyrics/` and at a dedicated test origin's `/`.
- **TL-AC10 (R2, R10):** For the checked event set, compare displayed line starts
  against the selected original recording. Proposed preparation target:
  at least 95% of lyric starts within 0.7 seconds, all others reviewed and accepted
  explicitly. This is a target to validate, not a measured automatic-model result.
- **TL-AC11 (R14, R16):** Serve the same artifact at `/lyrics/` and a different
  test origin's root. Check entry pages, assets, imports, preparation, preview and
  Start. Export a 25-song set on the first origin and import on the second; preserve
  all timings, text, order, corrections and readiness. No previous-origin URL may
  be required for event operation.
- **TL-AC12 (R3, R17):** Creating/importing/resetting a lyrics set, updating its
  offline cache and changing deployment versions leaves existing course routes
  and piano storage untouched. Imported HTML-like lyric text displays literally.
- **TL-AC13 (R12, R18):** The principal accent and monochrome logo use `#23C0EB`.
  Normal-sized labels and controls meet a minimum calculated contrast of 4.5:1
  against their actual background. Active lyrics remain distinguishable without
  color alone; repeat the projection readability check with the school palette.

- **TL-AC14 (R5, R10, R15, R19):** Decode an actual MP3, run the shipped browser
  recognition path and obtain text with finite candidate cue starts. Preview it
  against the recording and manually confirm it before event launch. Verify cancel,
  failed model download and retry, and reject empty recognition. This verifies
  the integration, not accuracy on the organizer's as-yet-unsupplied songs.

## Decisions and remaining evidence

Established by the user's requests on 2026-10-12: 5–25 songs; external
backing-track playback; manual Start followed by automatic scrolling; no live
synchronization initially. Subsequent explicit decisions: host within adjacent
NastyEdu while retaining dedicated-domain portability; use original songs as the
timing baseline and assume performers stay on that timeline; use accent/logo
color `0x23C0EB` (CSS `#23C0EB`). These decisions
were recorded in revision 2, which was subsequently approved.

The proposed mount is `/lyrics/`. Remaining proposed defaults include line-level
timing, local processing, preparation editor, portable sets, verified offline
reopening, and acceptance thresholds. The automatic alignment engine is a
technical candidate, not a proven product guarantee. Its quality/runtime must be
measured on representative original recordings. Exact school name/logo assets and
the event laptop/browser are not supplied; these do not block drafting or the
neutral-title prototype. See [research and design](../../../docs/timed-lyrics-research.md).

Approval provenance: On 2026-10-12, after revision 2 was presented and linked, the
user explicitly instructed “Let's go” and required MP3 recognition and timed text
in the baseline. This approves revision 2 (SHA-256 `1448ca360d6266485fd6dcbd7df5de865196960454f119bac8bd6112504424ab`), with the
MP3-only input clarification above derived directly from that instruction.
TL-R19/TL-AC14 make that requested behavior explicit; browser-local inference is
an implementation choice preserving the approved privacy and portability boundaries.
On 2026-10-12 the user separately instructed deployment at the end and requested
MP3 upload instructions. Production activation is now authorized. No commit was
requested. The one-time Nginx mount requires an interactive administrator step
because the SSH deploy account cannot edit host configuration without a password.

Deployment evidence: Release `20261011_220243` is live at
`https://nasty-edu.online/lyrics/`. HTTPS entry/redirect, JS/MJS/WASM types and
artifact shell hashes were checked. The live browser decoded and recognized an
actual synthetic Russian speech MP3, ran manual Start and reopened/reran offline
without uploads or runtime errors. The main site and `/health` returned 200.
Representative songs and projector/long-duration timing acceptance remain pending.
