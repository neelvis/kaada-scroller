# Timed lyrics revision 16: cloud library and local project copies

Feature ID: TL (extension)
Status: Implemented, verified and deployed
Revision: 16, 2026-10-21
Baseline: [Specification](spec.md), [shared projects](revision-3.md),
[projects and durable files](revision-14.md), and [cue shifting](revision-15.md).

## Purpose and scope

Make the cloud song library authoritative and let projects use its current songs.
Local project copies keep lyrics and backing tracks close to playback without
creating a second editable song library. Internet access remains required for
the normal application workflow; fully disconnected operation is not a guarantee
of this revision.

This revision supersedes the affected local-library, pinned-version, explicit
upload/update, migration-UI and offline-guarantee rules in TL-R13–R14 and
TL-R73–R81, and equivalent older shared-project rules. Preserve preparation,
cue shifting, readiness validation, playback controls, durable local project
files, private cloud access and portable import/export where compatible.
No new authentication system or collaborative automatic merging is included.

## Requirements

- **TL-R84 — Cloud-only library:** List, create and edit library songs in the
  cloud. Do not offer an independent local library or per-song local/cloud
  transfers. Authentication is required for private library access and cloud
  writes. Editing creates an unsaved working draft; changing a field alone must
  not publish it. Offer `Сохранить в облаке` after the user confirms readiness
  and existing validation passes. Failed saving preserves the working draft and
  must not report cloud success.
- **TL-R85 — Current songs in projects:** Cloud projects refer to library songs
  and resolve their latest saved versions automatically when loaded. Saving
  changes to a song updates that same library song, including when edited from a
  project; subsequent cloud project loads use it. Preserve project order and
  membership. Remove `Обновить из библиотеки` and project `Обновить в облаке`
  actions. Unsaved edits in an open editor must not be replaced by a refresh.
- **TL-R86 — Unified project save:** `Сохранить` saves project edits to the cloud,
  including projects that have a local copy. Song edits included in that save
  update the corresponding library songs. Apply the same readiness/validation
  gate to changed songs as for library saving. A locally copied project also
  updates its local files. Distinguish cloud success, local success and failures;
  retain pending work for retry, avoid duplicate objects on retry and never
  silently overwrite a conflicting newer cloud edit. Local copies represent
  cloud-linked projects, not a separate local-only creation mode.
- **TL-R87 — Local copy control:** Put a `Локальная копия` button in the top bar,
  with tooltip `папка для сохранения проектов для офлайн-работы`. If a directory
  is selected, show its name in small text below the label. Clicking offers a
  directory picker, including changing an existing selection. Remove the former
  directory section from the workspace, the `Рабочее пространство` label and
  the `Перенести прежние данные` action. Cancellation preserves the selection;
  changing directory does not delete files in the previous directory. Preserve
  existing files and cloud data without an automatic upload on application open.
- **TL-R88 — Local playback source:** Explicitly saving a project locally writes
  its lyrics, current song data and configured backing tracks to the selected
  directory. When that project is launched, read lyrics and backing tracks from
  its complete local copy without downloading those assets first. Projects
  without a local copy load those assets from the cloud. Local content is the
  last successfully saved local snapshot; refresh it through saving the project
  locally, not a blocking asset download on every launch. Report missing or
  unreadable configured local assets and offer recovery rather than claiming
  the local copy is complete. Preserve existing playback readiness rules.
- **TL-R89 — Library controls:** Place `Новая песня` above the song list, followed
  by a text filter matching title, artist or recording version. Replace a
  library-wide `Запустить` action with a play button on each song card. Enable
  it only for ready, valid songs. For other songs disable it and provide tooltip
  `подтвердите готовность песни`, available to pointer and keyboard users.
- **TL-R90 — Recording version:** Use the existing optional `Версия записи`
  field. Display it as a third metadata field on library and project song cards
  when nonempty; omit it when empty. It describes the recording, not a server
  revision number.
- **TL-R91 — Save a song copy:** Add `Сохранить копию` in song editing. A copy
  creates a separate cloud library song and leaves the original unchanged. It
  requires readiness and valid content. Reject creation if a library song has
  the same title AND artist AND recording version; changing any one permits a
  copy. Treat absent optional artist/version as empty. For this draft, compare
  values after trimming outer whitespace, preserving case and internal spacing.
  Enforce the rule in cloud writes as well as the interface, including concurrent
  attempts. Show an actionable notice such as `Песня с таким названием,
  исполнителем и версией записи уже есть. Измените одно из полей.` Do not
  reinterpret a duplicate as an update or automatically merge existing songs.
- **TL-R92 — Delete a library song:** Confirm that `Удалить песню` removes the
  song from the cloud library and every cloud project containing it. Remove
  all its project occurrences while preserving other songs, their order and
  the projects themselves. A subsequent save from a stale editor must not
  silently recreate the deleted song. Existing local snapshots are not remotely
  erased; their next successful refresh reflects the cloud deletion. Removing
  only a project entry still preserves its library song.
- **TL-R93 — Readiness wording:** Preserve the requested text `Таймлайн был
  подтверждён, но последующие изменения отменяют подтверждение.` for a confirmed
  timeline. Material preparation edits invalidate confirmation as before.

## Acceptance criteria

- **TL-AC66 (R84, R86, R93):** Create and edit a library song; cloud saving is
  unavailable until readiness is confirmed. Edit its text or cue times and
  verify readiness resets. Confirm again and save; reopening retains the edit.
  Simulated cloud failure retains pending edits and never claims success.
- **TL-AC67 (R85–R86):** Add one song to two cloud projects. Save a confirmed
  lyric/timing change from one project; reopen the library and the other project
  and observe the same saved song. Repeat from a locally copied project using
  `Сохранить`, without a separate cloud-update step. Exercise concurrent edits
  and partial cloud/local failures without false success or silent data loss.
- **TL-AC68 (R87–R88):** Select, cancel and change the top-bar directory; check
  tooltip, directory subtitle and removal of old controls at desktop and narrow
  widths. Save a project with lyrics and backing audio locally, reopen it and
  verify playback reads those assets from files without network asset requests.
  Launch a cloud-only project and verify cloud loading. Missing local backing
  files produce recovery feedback, not a false complete status.
- **TL-AC69 (R89–R90):** Search by title, artist and recording version; verify
  the creation button/filter order, optional version on both kinds of song card,
  and per-card play for ready songs. Verify disabled-play tooltips with keyboard
  and pointer and preserve existing playback behavior.
- **TL-AC70 (R90–R91):** Attempt an unchanged copy and one with only outer
  whitespace changed: both are rejected. Changing just title, artist or version
  permits a ready copy without changing the source. Verify empty version,
  duplicate submissions and concurrent creation, including server enforcement.
- **TL-AC71 (R85, R92):** Delete a song referenced multiple times across two
  projects. Verify its library entry and all cloud occurrences disappear while
  other entries retain order. A stale save does not restore it. A saved local
  snapshot remains on disk until explicitly refreshed; project-entry removal
  alone never deletes a library song.

## Evidence, approved interpretations and approval

The user requested this UX on 2026-10-21. Current evidence:
`public/workspace-hub.js` renders local/cloud libraries and transfer controls;
`public/workspace-actions.js` manages directory selection and explicit transfers;
`public/song-editor.js` already edits `version` and shows the requested readiness
sentence; `backend/store.py` stores project entries against song revisions.

The following interpretations were explicitly approved with this draft:

1. Changed songs saved from projects require renewed readiness confirmation,
   just like songs edited directly in the library. Project structure can still
   be saved when there are no changed unconfirmed songs.
2. Local playback uses the last complete local save. Cloud library changes are
   reflected when the local project is refreshed/saved, avoiding mandatory media
   downloads at launch. Internet remains needed for the normal workflow.
3. Identity comparison trims outer whitespace but is otherwise exact. No
   retrospective automatic merging or deletion of existing duplicate songs.
4. Saving a copy from a project adds it to the library without automatically
   replacing the project's current song; project membership remains explicit.

Approval: the user explicitly approved this draft with `подтверждаю` on
2026-10-21. Reviewed draft SHA-256:
`d8d52cab14590937090c10c769f30d4d83fa23f584af9badd4951c3440e65be0`.
Production implementation is authorized; commits, push and deployment are not
authorized by this approval. Preserve the pre-existing uncommitted revision-15
editor/style work and deployment documentation changes.


## Delivery evidence

Implemented in the local workspace on 2026-10-21. The frontend artifact builds,
97 Node tests and 23 API tests pass, and the real authenticated API/Chrome suite
covers TL-AC66–AC71 including ordinary creation before selecting a directory,
readiness invalidation, failed saves, copies, current library songs in projects,
local write recovery, local-asset playback and cascading deletion. Independent
backend and frontend reviews have no unresolved material findings. Supplemental
display-control regression also passes. See the
[verification report](../../../docs/timed-lyrics-verification.md#revision-16-cloud-library-and-local-project-copies-2026-10-21).
Native OS directory-dialog interaction remains a manual platform check; tests
use an adapter that writes real temporary directory files. Published as paired
release `20261021_161630` from application commit `0c6f5b5` on 2026-10-21.
Production source hashes, health/access/MIME checks and an isolated browser smoke
check passed. Private school songs/projects were not modified by smoke checks;
previous pair `20261021_151151` remains available for rollback.

Delivery authorization: on 2026-10-21 the user explicitly requested
`Коммит, деплой`, authorizing the commit and production release of this change.
