# Revision 27 — project-specific song artwork

Feature ID: TL (extension)
Status: Implemented and verified locally — publication in progress
Date: 2026-10-23
Related requirements: [Artwork and albums](revision-25.md) and
[rectangular artwork](revision-26.md#requirements).

## Purpose and scope

Allow one song to use different artwork in different projects while retaining
its primary artwork for the library. This revision replaces the conflicting
project-over-song precedence in TL-R25.3 and TL-R26.11.

The existing primary song artwork serves as the album-cover fallback. No
separate album artwork catalogue or album-level editor is introduced.

## Requirements

- **TL-R27.1 — Artwork editing:** The song editor supports one optional primary
  cover and one optional cover for each project containing that song. Identify
  project choices by their names and offer only projects containing the song.
  Each cover can be uploaded, replaced and removed independently. Two projects
  with the same name remain distinct targets; renaming a project does not lose
  its song artwork.
- **TL-R27.2 — Presentation precedence:** In presentation mode launched from a
  project, choose the song's cover for that
  project, otherwise the project's cover, otherwise the song's primary cover
  (album artwork), otherwise no artwork. Covers assigned to other projects
  never participate in this choice. Removing a cover exposes the next available
  fallback. In presentation without a project, use only the primary cover.
  This precedence does not change artwork in project-editor song lists.
- **TL-R27.3 — Library cards:** A song card in the library shows only its primary
  cover. If none exists, show no cover, even when project-specific or project
  artwork exists. Project cards continue to show the project's own cover.
- **TL-R27.4 — Persistence and isolation:** Preserve applicable artwork through
  cloud saves, reloads, local project copies, offline playback and native
  portable export/import. Preserve the association with the corresponding
  project when restoring a local copy. Changing one project's song cover must
  not replace primary artwork, project artwork or another project's song cover.
  Preserve existing unsaved-change, conflict and failed-save protections.
- **TL-R27.5 — Compatibility and uploads:** Existing records without project
  song covers remain valid and use the fallback chain. Preserve the existing
  JPG, PNG and WebP support, image size protections, full-image proportions and
  upload error handling. A failed upload preserves the previous cover. Do not
  offer unrelated projects or fabricate membership when project information
  cannot be loaded; report a recoverable loading failure where applicable.

## Acceptance criteria

- **TL-AC27.1 (R27.1, R27.4):** Place a song in projects A and B, with an
  unrelated project C. In the song editor, assign different covers to A and B
  and a primary cover; C is not selectable. Save and reopen from the library
  and each project; verify the independent assignments. Rename A and verify
  its assignment remains intact.
- **TL-AC27.2 (R27.2):** In presentation launched from project A, verify each fallback by successively
  removing A's song cover, A's project cover and the primary cover. Observe
  project-song artwork, then project artwork, then primary artwork, then no
  artwork. B's song cover never appears in A's presentation. Presentation
  launched without a project uses only the primary cover, or no artwork when
  it is absent. Project-editor song-list artwork remains unchanged.
- **TL-AC27.3 (R27.3):** With all cover types present, the library song card
  shows the primary cover and project cards show their own covers. Remove
  the primary cover: the library song card shows no artwork.
- **TL-AC27.4 (R27.4–R27.5):** Verify cloud reload, saved local project reopening
  without network access and native portable round trips retain the correct
  project-specific cover and fallbacks. Legacy records load unchanged. Check
  failed save, failed upload and unavailable project information without losing
  artwork or offering unrelated projects.
- **TL-AC27.5 (R27.5):** Upload portrait and landscape JPG, PNG and WebP covers;
  verify full-image proportions, replacement and independent removal. Invalid
  or oversized uploads show a recoverable error and retain previous artwork.

## Sources and approval

Source: the user's request in Codex on 2026-10-23 and follow-ups specifying that
library song cards show only primary artwork and that the fallback chain applies
in presentation mode, rather than project-editor song lists. The primary-cover/album-cover
equivalence follows the existing single song-cover field and is stated here
for review.

Technical evidence: `public/song-editor.js` currently edits one song cover;
`public/app.js` selects project artwork before the song cover;
`public/workspace-hub.js` uses the primary song cover on library cards.
`backend/store.py` resolves current shared song revisions for project members.
`public/core.js` explicitly sanitizes portable song fields, so new artwork
metadata must survive sanitization as well as persistence.

Approval: The user explicitly approved this revision with `подтверждаю` in Codex
on 2026-10-23 after clarifying that precedence applies in presentation mode.
Approved draft SHA-256:
`d675fd2d1fd221ed13a995c101f0dded4f27944900a4124e4c1c799fbf449210`.

## Validation and delivery

Implemented on 2026-10-23. Frontend unit tests pass 125/125 and API tests pass
32/32. The focused cloud-transfer/presentation gate passes 10/10 after the
lost-import-response project-cover remapping correction. Build, JavaScript
syntax checks and `git diff --check` pass. Independent Luna reviews accepted
the editor/presentation and data/transfer scopes after corrections.

`tests/revision-27-browser.mjs` passes against a disposable authenticated API:
membership failure/retry, unrelated-project exclusion, independent cover uploads,
invalid-image preservation, cloud reload, primary-only library cards, four display
fallbacks, native portable round trips, cloud/local ID remapping, repeated local
download with a stable project ID, and offline reload/direct playback using OPFS.
Desktop and 375px screenshots were inspected. `tests/artwork-browser.mjs` also
passes large JPG/PNG/WebP preparation, cloud persistence and fresh local reopening.
Native OS folder permission prompts and projector rehearsal remain manual checks.

The user explicitly requested commit, push and deployment in Codex on 2026-10-23.
