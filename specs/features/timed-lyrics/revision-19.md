# Timed lyrics revision 19: library editing and project recovery

Feature ID: TL (extension)
Status: Implemented — static syntax checks passed; manual acceptance pending
Revision: 19, 2026-10-23
Baseline: [Specification](spec.md), [revision 16 — cloud library and local project copies](revision-16.md), [revision 18 — focused project and song editing](revision-18.md).

## Purpose and scope

Refine cloud library song editing and copying, show clear local-folder status,
and make unsaved project handling predictable when another organizer changes a
project. This revision supersedes only the affected revision 18 behavior. It does
not introduce automatic merging of conflicting organizer edits.

## Requirements

- **TL-R112 — Library song editor layout:** When editing a song opened from the
  cloud library, hide the empty project-song sidebar. Keep a `← Библиотека`
  control at the upper-left of the editor so the user can return to the library.
- **TL-R113 — Copy names:** Create copies from the original title, removing a
  chain of trailing ` (копия N)` suffixes before generating another copy name.
  Consider all current cloud library title/artist/version identities and use the
  lowest positive N whose `title (копия N)` identity is unused. Never append a
  second copy suffix to an existing copy title.
- **TL-R114 — Library sorting:** Changing any library sort option immediately
  reorders all visible library cards by the selected field and direction. Keep
  the selected order through library re-renders during the current session.
- **TL-R115 — Folder tooltip:** The disk button tooltip and accessible name
  identify the purpose as `Локальная папка для сохранения проектов`. Include
  only the selected folder's name when one is selected; otherwise say
  `папка не выбрана`. Do not display an unavailable-path notice.
- **TL-R116 — Unsaved project exit:** Before leaving a cloud project with
  unsaved edits, including returning to the project/library list, ask whether to
  save, discard, or stay. Discarding resets the editor to its clean state and
  removes any persisted browser draft. Staying returns to the editor. Before
  closing or reloading the tab, use the browser's native unsaved-changes warning;
  if the user proceeds without saving, the unsaved edits are discarded. Do not
  restore those edits from browser storage on a later entry. Save attempts must
  preserve in-memory edits if they fail.
- **TL-R117 — Cloud version and local copy:** Opening a cloud project always
  displays the current server version and never overlays an older browser
  draft. If the cloud version has changed since the previous entry, refresh its
  linked working-folder copy too. Refresh the linked copy after a successful
  save. A working-folder copy with independent local edits must not be silently
  overwritten. If a save conflicts with another organizer's update, keep local
  edits marked unsaved and explain that the project needs attention; do not ask
  the user to manually download a version. A later entry loads the latest cloud
  version. This revision does not silently overwrite either organizer's work.
- **TL-R118 — Conditional readiness action:** Show `Подтвердить готовность`
  only while the song is unreviewed and needs confirmation. Make the status label
  at the top link to and focus that button while confirmation is required. Put
  the confirmation and delete controls on one row.

## Acceptance criteria

- **TL-AC80 (R112):** Open a cloud library song, confirm the left sidebar is
  hidden, and return to the library using the upper-left control.
- **TL-AC81 (R113):** Copy an original and an existing copy multiple times.
  Titles use one suffix each and select the lowest unused number across the
  library for that artist/version, leaving the source unchanged.
- **TL-AC82 (R114):** Exercise all six sort orders on a deterministic set with
  varied dates, Cyrillic/Latin titles and artists; verify the visible cards
  reorder immediately and retain the selected order after a hub refresh.
- **TL-AC83 (R115):** Check tooltip and accessible name before and after folder
  selection. The selected state includes the folder name only; the unselected
  state says `папка не выбрана`.
- **TL-AC84 (R116–R117):** Change a cloud project, attempt to leave, and verify
  save, discard and stay outcomes. Discard clears the draft. Verify tab close or
  reload triggers the browser warning and choosing to leave does not restore
  edits later. Reopen the project and verify the server version is shown. When
  cloud content changed since the previous entry, verify the linked working
  folder copy refreshes; verify a divergent local copy is preserved. Verify a
  successful save also refreshes the linked local copy. Cause a concurrent save
  conflict and verify local edits remain unsaved, no stale-version download
  instruction appears, and a later entry loads the latest cloud version.
- **TL-AC85 (R118):** Verify the confirmation control is present only when
  required, the top status control scrolls to and focuses it, and confirmation
  and delete controls share a row.

## Platform note

The browser exposes the selected folder's name, not its absolute operating
system path. The tooltip therefore uses the folder name as requested. This is
based on [MDN's FileSystemDirectoryHandle
reference](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryHandle)
and [the File System Access specification](https://wicg.github.io/file-system-access/).

## Evidence and approval

The approved requirements follow the user's request and screenshots received on
2026-10-23.
Implementation evidence is in `lyrics-site/public/app.js`,
`workspace-hub.js`, `library-sort.js`, `workspace-actions.js`,
`song-editor.js`, `styles.css` and `hub.css`. The current code restores a saved
Before implementation, `openProject()` restored a saved project draft over a
fresh cloud response, and the save path reported 409 conflicts without
refreshing the project. The library
sort control is wired to sort and re-render the visible cards; the provided
title-ascending screenshot also appears ordered for the visible first row, so
the reported sorting failure has not yet been reproduced. All six sort orders
are included in acceptance checks. An independent review of the implementation
found and then verified a fix for repeated trailing copy suffixes.

Static JavaScript syntax checks passed for the four changed JavaScript modules;
`git diff --check` passed. Automated and manual behavior checks were not run.
The acceptance criteria remain pending manual UI verification.

Approved by the user on 2026-10-23 in chat after review of revision 19 at
SHA-256 `0c865280de19ad7b6912a9ab72653a412ef90a16ce8270b9644a3bbb7572f918`.
The approval covers TL-R112–R118 and TL-AC80–AC85 as written above.
