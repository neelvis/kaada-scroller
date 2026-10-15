# Timed lyrics revision 6: preparation redesign and portable backing tracks

Feature ID: TL (extension)
Status: Implemented, verified and deployed
Revision: 6, 2026-10-13
Baseline: [specification](spec.md), [revision 3](revision-3.md),
[revision 4](revision-4.md), and [revision 5](revision-5.md)

## Purpose and scope

Simplify song preparation, make navigation clearer, and transfer backing audio
together with a portable set. Correct misleading LRCLIB search feedback.
This scope excludes deployment and changes to recognition quality, live playback,
server authentication, or other projects' pinned song versions.

## Changes to existing requirements

TL-R46–R48 supersede affected preparation presentation rules in
TL-R1, TL-R6, TL-R19, TL-R39–R41, and the visible notice in TL-R45.
TL-R49 supersedes the audio-excluding portable export rule in TL-R34 and TL-AC26.
Existing privacy, readiness, exact lyric, offline playback and persistence rules
continue to apply. Hidden language and delay values must survive unchanged.

## Requirements

- **TL-R46 — Navigation:** Disable the Projects button without an authenticated
  session. Preserve existing access to locally prepared offline projects through
  their offline entry points. In the preparation sidebar, place `+ Новая песня`
  immediately after the song list, then `+ Из библиотеки`. Library addition
  requires an authenticated online project; make it unavailable otherwise.
  Move `Подготовить показ` to the sidebar and rename it `Сохранить локально`.
  It retains the existing project download and offline readiness semantics,
  including required backing tracks; it is not a substitute for server Save.
- **TL-R47 — Song fields:** Remove visible Language and Global delay fields.
  Preserve their stored values and playback effects. Present and accept duration
  as minutes and seconds (`MM:SS`), with seconds from 00 to 59. Reject invalid
  edits without silently zeroing the duration. Merely opening or rendering a song
  must not round or change existing fractional duration data.
- **TL-R48 — Preparation tabs:** Use one upper preparation tab row containing
  LRCLIB search, `Свой LRC`, and `Чистый текст`; select LRCLIB search initially
  when opening a song. Replace the nested Text and timestamps import section
  with the two separate import tabs. Keep the editable cue timeline available
  regardless of import tab. Hide the Original recording tab and its recognition
  controls for now; retain existing original audio data and compatible preview
  and manual timing behavior. Switching tabs preserves edits. Remove the LRCLIB
  title/artist privacy paragraph without changing what is transmitted. Retain
  the supplied import helper wording, which is identical to the existing text.
  A result without usable synchronized LRC has a disabled preview button labelled
  `LRC недоступен`; usable results retain explicit preview and import.
- **TL-R49 — Portable audio export/import:** Export one ZIP containing the set
  JSON and every linked backing track. Each exported song has a `backingTrack`
  field containing a relative archive path or `null` when no track is linked.
  Paths uniquely identify files even when filenames repeat. Include audio from
  local sets and accessible online/offline projects. If a linked file cannot be
  read, fail visibly rather than reporting a complete export with missing audio.
  Exclude original vocal audio and private server identifiers/URLs. Import the
  archive into the local set and restore backing playback without relinking.
  Continue accepting older JSON-only exports. Missing, corrupt or unsafe archive
  references and storage failures must not replace the previous local set or its
  audio with a partially imported set. Importing does not silently update a
  server project. Relative paths are portable file references, not public URLs.
- **TL-R50 — Version explanation:** Explain that `Обновить версию` adopts the
  latest library revision for this project's selected song, replacing its text,
  timings and audio links. Other projects keep their pinned revisions. Retain
  confirmation and explicit project Save. Make the explanation available beside
  the control; disable it when no saved library song or online session exists.
- **TL-R51 — LRCLIB search feedback:** A valid empty search result displays
  `Ничего не найдено` without a rate-limit countdown. Genuine rate limiting must
  preserve service retry instructions. Do not infer an empty result from a
  transport failure or a genuine HTTP 429. Inspect actual responses before
  deciding the fix; preserve song data in every failure case.
  Explain available HTTP error codes with an appropriate next step; a retry
  interval alone does not establish rate limiting. If the browser hides the
  status, explain that the exact cause is unavailable rather than guessing it.

## Acceptance criteria

- **TL-AC36 (R46):** Check logged-out, authenticated and offline states. Sidebar
  controls appear in the specified order and remain reachable at desktop and
  narrow widths with empty, short and 25-song sets. Offline saving retains its
  existing completeness checks and the Projects button cannot open without login.
- **TL-AC37 (R47–R48):** Hidden fields and original upload/recognition controls
  are absent. Existing language, delay and original audio survive save and
  reopening. A duration of 125 seconds displays as `02:05`; invalid duration
  input leaves the prior value intact. Tab navigation is accessible, preserves
  drafts, and offers separate LRC and plain-text import. Unavailable LRC buttons
  have the required disabled label; usable preview still works.
- **TL-AC38 (R49):** Round-trip a mixed set with two same-named backing files
  and a song without backing. Preserve song order, cues, review state, metadata
  and exact audio bytes; playback needs no previous origin. Verify local, shared
  and prepared offline exports, old JSON imports, missing/corrupt files, unsafe
  paths and failed storage. Failed imports leave prior data intact.
- **TL-AC39 (R50–R51):** Version explanation matches actual adoption behavior.
  Test empty successful LRCLIB response, actual no-match response if different,
  genuine HTTP 429 with/without Retry-After, server failure and subsequent retry.
  Only real service restrictions produce rate-limit feedback.

## Sources, proposed choices and approval

The user requested this scope on 2026-10-13. ZIP packaging, `backingTrack` as the
portable path field, LRCLIB as the default tab and preservation of original-audio
preview were concrete reviewed choices approved with this revision.
The requested replacement helper text is identical to the current wording.
Evidence: `lyrics-site/public/app.js` (`renderEditor`, `renderImportCard`,
`renderSongActions`, `adoptLatest`, `downloadSet`, `importFile`) and
`lyrics-site/public/lrclib.js` (`LrclibClient.search`).
The user explicitly approved this linked draft with “го” on 2026-10-13.
Reviewed draft SHA-256: `95a331fa30904aaf0861a8c7e1d17c94ed0dec602bf9a11eaef0e3b79c003984`.
Approval covers the requirements and proposed choices above. Implementation and
local verification are complete. The user separately requested deployment with
“деплой” on 2026-10-13; paired release `20261013_193539` is live and production
checks passed. No commit was requested.
See [revision 6 verification](../../../docs/timed-lyrics-verification.md#revision-6-preparation-redesign-and-portable-backing-tracks).

## Small navigation follow-up — 2026-10-13

The user directly requested two bounded presentation corrections after revision 6:
place `Режим показа` in the preparation sidebar immediately above the songs, and
show `Выберите песню для редактирования` until a song is explicitly selected.
Opening/reloading a set or project, importing a set, and deleting the selected
song must not automatically select the first song. Saving preserves the explicit
selection. Adding a song continues to select the newly added song. The editor
shows only the highlighted song. Offline song selection remains available with
editing disabled. The display entry keeps readiness checks and can open the
first ready song when there is no editor selection.

The same follow-up requests hiding `Проекты` entirely without login (instead of
showing it disabled), and confirming the latest valid timeline on the first
activation of `Подтвердить готовность`, including an edit still focused. Invalid
timelines continue to require correction before confirmation.

The follow-up was verified locally and deployed on the user's explicit request
as paired release `20261014_132817` on 2026-10-14. Production checks cover the
sidebar position, placeholder, logged-out visibility, first-activation
confirmation, portable audio and offline playback.
