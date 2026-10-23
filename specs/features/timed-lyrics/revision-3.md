# Timed lyrics revision 3: shared projects and text-guided preparation

Feature ID: TL (extension)
Status: Implemented and deployed — singing benchmark pending material
Revision: 3, 2026-10-12
Baseline: [deployed revision 2](spec.md)
Evidence: [existing verification](../../../docs/timed-lyrics-verification.md)

## Purpose and approval boundary

The organizer reports that MP3-only recognition produces incorrect sung words.
Provide a preparation route using the correct lyrics, plus a shared server library
and named projects available from different computers. Keep manual event Start,
external music playback, school styling and offline prepared-event operation.

The user explicitly selected one shared organizer password and confirmed that
correct lyric text is usually available. This draft includes concrete proposed
library, project, revision and offline semantics for review. The user explicitly approved this reviewed revision on 2026-10-12 with
“да, го”. The deployed baseline and its requirements remain valid
until this extension is approved and delivered. Existing deployment authorization
persists for the task; no commit is requested.

## Changes to baseline requirements

The following replace only the affected parts of revision 2:

- **TL-R14:** Server records become the primary shared library/project storage.
  Local copies support prepared event playback, backup and explicit migration.
  Export/import remains available; an exported portable set still excludes audio.
- **TL-R15, TL-R17:** Explicitly selecting/uploading a reference stores it privately
  on the school's server. Model inference may still run on the organizer's laptop.
  Explain upload/storage and local processing accurately; do not retain the old
  claim that recordings never reach the server. No paid external audio processor
  is introduced by this scope.
- **TL-R16:** Portability covers the independent lyrics frontend, its own backend
  and private library data. Move the module and its data to a new domain without
  needing NastyEdu's application, authentication or course storage. An interactive
  administrator step may be needed for initial API/service hosting.
- **TL-R19:** MP3-only recognition remains an editable fallback. Correct supplied
  text is the preferred timing input. A guessed transcript must not overwrite it.

All other baseline rules remain, particularly original-version identity, repeated
occurrences, literal text rendering, validation/review, manual Start and scoped
host coexistence. Account registration, per-person roles, public catalogs, live
synchronization, nested project folders and paid cloud inference remain deferred.

## Proposed requirements

- **TL-R20 — Organizer access:** One shared school password protects server
  projects, song records and reference recordings for both read and write. No
  individual accounts are required. Login/logout is explicit; anonymous requests
  cannot list records, edit data or download private audio. Deployment credentials
  do not appear in public app assets or exported projects. Log out clears cached
  server-private preparation material on that browser; preserve unmigrated legacy
  local drafts. An explicitly prepared event can run offline on its event laptop.
- **TL-R21 — Shared persistence:** Store song metadata, exact text, typed cues,
  duration, delay, original-version identity, review state and uploaded reference
  files on the server. On another authenticated computer the same saved data and
  reference are available without manual export/reselection. Distinguish pending,
  saved and failed changes; show saved only after server confirmation. A failed
  save/upload retains the previous saved material and the editable local draft.
- **TL-R22 — Projects:** Create, name, rename, open and delete independent projects
  such as concerts or classes. Each has its own ordered list of songs and may
  contain at least 25. Project deletion removes its list, not the shared library
  recordings. Removing a song from a project does not delete the song globally.
- **TL-R23 — Catalog and reuse:** Browse/search the library by title and artist,
  add an existing song to a project, and reorder/remove its entries. A song refers
  to a specific recording/arrangement, not merely a title. Reuse its reference
  without uploading duplicates for every project. Pin the timeline version chosen
  for each project: editing a song in one project must not silently replace the
  checked timeline in another. An organizer can explicitly adopt an updated
  version. A global deletion is refused while a project still references it.
- **TL-R24 — Migration and identity:** Offer an explicit transfer of the existing
  browser set into a named server project, with separately confirmed reference
  uploads. Preserve local originals until the complete transfer succeeds. Assign
  server identities; local/export IDs and filenames cannot silently identify or
  overwrite an existing library record. Repeating a successful transfer must not
  accidentally duplicate its records. Retain portable project export/import.
- **TL-R25 — Upload and storage failures:** Accept the current MP3/WAV bounds
  (15 MiB per recording, up to 20 minutes; size updated by the user on
  2026-10-23). Portable projects have no aggregate byte-size cap; retain per-file
  and structural validation. Use a configurable total library
  allowance; the proposed initial allowance is 1 GiB on the current small host.
  Show a clear space/size error instead of discarding existing songs or filling
  the host disk. Reference replacement preserves the previous version and never
  leaves a saved song pointing to a partial upload. Filenames are display labels.
- **TL-R26 — Concurrent organizers:** Updates use the version last read. A second
  organizer's newer save cannot be silently overwritten by stale editing,
  recognition completion or project reordering. Show a conflict, retain the
  unsaved draft and allow reloading the server version before explicitly retrying.
- **TL-R27 — Prepared offline project:** Explicitly prepare/cache a project for
  the event; report readiness only after its complete chosen timeline snapshot
  and viewer assets are locally available. Reopening and Start require neither
  internet, reference audio nor inference. The running show uses its selected
  snapshot and does not change because another organizer edits the server.
  In this revision server-project editing requires a connection; no invisible
  offline edit queue or automatic conflict merge is promised.
- **TL-R28 — Correct-text timing route:** Accept original vocal audio plus the
  organizer's exact displayed text. Generate candidate line starts while retaining
  every supplied line, punctuation, spelling and repeated occurrence. Match
  occurrences in recording order. Missing/ambiguous acoustic evidence remains
  unresolved for manual tapping; do not fabricate proportional times to present
  a complete-looking timeline. Results remain editable and unreviewed.
- **TL-R29 — Recognition quality route:** Retain MP3-only draft recognition when
  correct text is absent. Offer a more capable model/profile than the current
  lightweight default, subject to actual runtime and singing checks. State first
  download, processing and hardware limitations. If the selected model/device
  fails, offer manual/LRC preparation and an explicit alternative profile; do not
  silently replace supplied words or claim model output has been checked.
- **TL-R30 — Proposal lifecycle:** Report progress, support cancel/retry and
  preserve work on failure. A result belongs to the audio/text version used to
  start analysis. Changed input or cancellation prevents stale application. If
  manual work changed in the meantime, require an explicit reviewed application
  instead of overwriting it. Applying changed times invalidates readiness.
- **TL-R31 — Recovery and release independence:** Keep library data and reference
  files outside static/service releases. A lyrics release, rollback or ordinary
  NastyEdu deploy cannot clear them. Supply a consistent backup/restore procedure
  for metadata and referenced audio; verify it on a representative project.
  Existing host routes and course/piano browser data remain unaffected.
- **TL-R32 — Honest quality evidence:** Compare a small set of representative
  original recordings with their correct text and marked line starts. Record
  timing coverage, unresolved lines, correction effort and preparation time
  separately from transcript word errors. A speech-only fixture does not prove
  improvement on singing. Do not advertise guaranteed automatic accuracy or
  throughput for 25 songs before measuring it.

## Acceptance criteria

- **TL-AC15 (R20–R21):** Unauthorized project/song/audio read and write requests
  fail. Correct login succeeds; wrong password fails; logout revokes remote
  access. No shared password or privileged secret is present in the public bundle.
- **TL-AC16 (R21, R25):** Save an original MP3 with text and corrections on one
  computer; a fresh authenticated browser retrieves the same recording, text,
  times and review state. Interrupt an upload/save and verify prior saved material
  remains valid; quota/oversize failures retain the organizer's draft.
- **TL-AC17 (R22–R23):** Create two projects, reuse a song and prepare/reorder a
  25-song list. Remove/delete a project; its library references remain available.
  Update one project's timeline; the other retains its previously chosen version
  until explicit adoption. Global deletion of a referenced song is refused.
- **TL-AC18 (R24):** Transfer an existing revision-2 browser set and references,
  preserving literal lyrics, repeated occurrences, ordering, corrections and
  readiness. Interrupted/retried migration neither loses local originals nor
  duplicates a completed transfer. Colliding export IDs cannot overwrite records.
- **TL-AC19 (R26, R30):** Two editors save from the same base version. The second
  stale write reports conflict and retains its draft. Repeat with recognition
  completion, source replacement and project reorder; none clobbers newer data.
- **TL-AC20 (R27):** Cache a prepared project, disconnect/reopen and run manual
  Start through rests/end/reset. Server unavailability does not prevent the show;
  remote edits do not alter the running snapshot. Incomplete caching is not ready.
- **TL-AC21 (R28, R30):** Use correct Cyrillic/Latin text with repeated choruses,
  a skipped recognized word and a rest. Proposed timing preserves the exact input
  lines and occurrence order. Ambiguous/missing evidence stays unresolved. Cancel,
  changed inputs and failed analysis do not erase text or manual corrections.
- **TL-AC22 (R29, R32):** Before declaring quality improved, compare the candidate
  profile with the deployed base model on supplied original songs. Publish the
  observed word/timing errors and correction effort. The prior manual-review
  target TL-AC10 remains; it is not a promise of raw model accuracy.
- **TL-AC23 (R31):** Back up and restore two projects, their pinned timelines and
  shared reference into a fresh data directory; verify bytes and ordering. Repeat
  after release/rollback and verify host health and unrelated browser storage.
- **TL-AC24 (R16, R20, R31):** Run the frontend and its own API at NastyEdu's
  prefix and a test domain root. Login, projects, reference loading and prepared
  offline Start work without old-host URLs or NastyEdu-specific services.

## Confirmed choices and proposed defaults

Confirmed in this conversation: server song persistence and projects requested;
one shared organizer password; correct lyrics usually available. Existing manual
Start/external playback, original-timeline baseline and cyan branding stay fixed.

Proposed defaults requiring this draft's approval: a reusable library with project-
pinned timelines; audio included in private server persistence; online editing and
explicit offline event snapshots; explicit legacy migration; 1 GiB initial quota;
no paid external processor. Authentication method, database, inference engine and
API framework are implementation choices provided these requirements hold.

Host evidence: 2 CPUs, 1,966 MiB RAM with approximately 829 MiB available, no swap
and 3.5 GiB free disk at inspection. Keep the shared storage/API service small.
Large inference/source separation on that same host is not an approved assumption.
An isolated browser prototype with the pinned runtime and
`onnx-community/whisper-base_timestamped` produced 14 individual Russian word
chunks with finite nonnegative starts from the synthetic speech fixture, replacing
the baseline's two segment anchors. This verifies the technical timing capability,
not improvement on singing; measurements still require representative user songs. A failed candidate
leaves manual preparation available and is not permission to claim better quality.

Approval provenance: explicit user “да, го” on 2026-10-12; reviewed draft SHA-256 `2a9c262810e1e39de81233640bb4043e8bcf379e9d0a791ce47dc87ee6912e16`.
