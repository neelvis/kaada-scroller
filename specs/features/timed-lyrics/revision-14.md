# Timed lyrics revision 14: projects, library and durable local files

Feature ID: TL (extension)
Status: Implemented and locally verified — deployment pending
Revision: 14, 2026-10-17
Baseline: [Specification](spec.md), [shared projects](revision-3.md),
[preparation and portable audio](revision-6.md), revisions 8 and 10–13.

## Purpose and scope

Make assembling a project and playing backing audio and/or lyrics the primary
journey. Both projects and library songs can exist locally and in the cloud.
Local work must survive deletion of browser storage because ordinary files,
not browser databases, are its durable source of truth.

This revision supersedes restrictions requiring login to create projects or add
library songs to them, including the affected rules in TL-R46. Preserve existing
lyric preparation, timing, manual scrolling, playback controls, private cloud
access and project-pinned song versions unless explicitly changed below.
New authentication systems, collaborative automatic merging and native desktop
packaging are outside this revision.

## Requirements

- **TL-R73 — Navigation:** Provide Projects and Song library as persistent
  primary destinations. Open Projects initially. Both destinations are usable
  without login. Use the exact Russian label `На этом устройстве` for local
  storage and offer All, local and cloud filters. Account controls are secondary.
  Distinguish storage location from playback readiness.
- **TL-R74 — Project preparation:** Users can create multiple named local
  projects, add new or existing library songs, reorder and remove songs, edit
  preparation data and launch playback. Opening a library song only previews or
  edits it; adding it to a project is explicit and supports multiple selection.
  Removing a song from a project preserves the library song. Projects retain
  selected song versions; adopting a library update is explicit.
- **TL-R75 — Durable local workspace:** Let users select or reconnect a working
  directory containing library metadata, projects, lyrics and required audio as
  ordinary files. A browser database may cache directory handles or disposable
  data but must not be the sole copy of saved local content. Reopening the same
  directory in a fresh browser profile restores local projects and songs without
  cloud access. Show the connected directory name and connection state.
- **TL-R76 — Honest saving and recovery:** Automatically save local edits to the
  selected directory and show pending, saved or failed status accurately. Report
  saved only after required writes succeed. Serialize saves to avoid stale writes.
  Failed or interrupted writes must leave a recoverable previous complete version;
  partially written content must not become the active saved project. Cancellation,
  revoked permission, a missing directory, corrupt input or insufficient space
  must not silently discard prior saved work. Retain unsaved edits for retry in
  the active session and offer a portable export when possible. Never claim an
  unsaved in-memory draft will survive closing the browser.
- **TL-R77 — Browser support:** The first implementation targets desktop Chrome
  and Edge over HTTPS (localhost is allowed for development), with directory
  access feature detection. Unsupported browsers show a clear explanation and
  retain cloud access and explicit portable import/export where supported. They
  must not present browser-only storage as durable local saving. Permission
  renewal requires an explicit reconnect action when the browser requires it.
- **TL-R78 — Cloud transfers:** Login reveals accessible cloud songs and projects
  without uploading or replacing local work. Explicit upload of a local project
  includes its selected song versions and required backing files. Download for
  performance writes a complete local project to the selected directory. Retrying
  an interrupted operation must not silently duplicate successful transfers.
  Linked local/cloud objects appear as one item with location indicators. Preserve
  local files on logout; private online-only access still requires authentication.
- **TL-R79 — Explicit version exchange:** Do not silently synchronize content.
  Show locally changed and newer-cloud states and explicit upload/download update
  actions. If both copies changed since their last common version, preserve both
  and offer keeping separate copies; never silently overwrite either side.
  Copy creation is distinct from updating a linked object. Updating a library
  song must not silently change pinned versions in existing projects.
- **TL-R80 — Performance readiness:** Show ready for offline playback only after
  verifying locally readable project data and every required backing file. Show
  transfer progress and actionable failure messages. Support lyrics with backing,
  lyrics alone and backing alone. Missing optional content is not an error; a
  missing configured backing track requires an explicit lyrics-only choice or
  recovery before playback. Keep account and transfer prompts out of playback.
- **TL-R81 — Existing data:** Offer explicit migration of existing browser-local
  songs, sets and downloaded snapshots into the selected directory. Preserve
  source data until the destination is verified. Preserve existing cloud projects,
  library data and portable ZIP/legacy JSON compatibility. Merely opening the
  redesigned application must not overwrite or upload existing work.

## Acceptance criteria

- **TL-AC59 (R73–R74):** Logged out, create two projects, prepare library songs,
  add several to either project, reorder them and reopen each. Library browsing
  does not add songs accidentally. Removing a project item preserves its source.
  Verify empty and populated screens at desktop and narrow widths with keyboard.
- **TL-AC60 (R75–R77):** Save lyrics, projects and backing audio to a real test
  directory. Clear browser storage and reconnect that directory in a fresh
  profile; restore content and play without network. Exercise cancellation,
  permission loss, corrupt input, failed writes and rapid consecutive edits.
  Previous complete saves remain recoverable and status never reports false
  success. Unsupported browsers provide the stated explanation.
- **TL-AC61 (R78–R79):** Upload and download mixed projects, including backing
  files and lyrics-only songs. Retry interrupted transfers without unintended
  duplicates. Independently modify both copies and verify neither is silently
  overwritten. Logout retains deliberate local downloads and removes private
  online-only access. Verify project-pinned versions survive library updates.
- **TL-AC62 (R80):** Disconnect the network after downloading a complete project
  and launch each playback variant. Incomplete downloads are not marked ready.
  Existing timeline, keyboard, manual scrolling and audio behavior still pass.
- **TL-AC63 (R81):** Migrate representative existing browser data and round-trip
  portable archives with identical audio bytes. Simulate destination failure:
  source data and previously saved destination content remain intact.

## Delivery and source organization

After implementing the UX, inspect all relevant frontend/backend source files,
not only app.js. Split modules where responsibilities and test seams justify it;
line count alone is not a reason. Preserve behavior outside this revision. Record
the audit outcome, run focused regression and browser checks, review the stable
diff, update documentation, then commit, push and deploy using the existing
paired release procedure. Verify production health and retain rollback ability.
Commit, push and deployment are explicitly authorized by the user on 2026-10-17.

## Evidence, proposals and approval

The user requested the two-entity local/cloud UX, durable files outside browser
storage, exact local label, and a final source organization audit. Workspace
directory, desktop browser support, automatic local saves, explicit cloud version
exchange and conflict-copy behavior were included in the approved draft.
Pre-change evidence: public/index.html mixed library/project navigation and gated
projects behind login; public/app.js had 1,126 lines; storage.js and
offline-projects.js used browser storage. Delivery evidence is recorded in
[verification](../../../docs/timed-lyrics-verification.md). Native folder-dialog
interaction remains a manual platform check; automated browser tests use an
adapter that writes to real OS directories.

Technical support references:
- https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker

Approval: the user explicitly approved this draft with `да` on 2026-10-17,
after the linked revision-14 draft and browser/storage scope were presented.
The approved requirements are TL-R73–R81 and TL-AC59–AC63.
