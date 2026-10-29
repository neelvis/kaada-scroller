# Revision 30 — original-quality artwork and automatic file storage

Feature ID: TL (extension)
Status: Implemented, verified and deployed
Date: 2026-10-29
Related requirements: [Artwork and albums](revision-25.md),
[local copies](revision-26.md), and [project-specific artwork](revision-27.md).

## Purpose and scope

Preserve artwork quality for large-screen presentation and remove artwork bytes
from the shared 5 MiB JSON-write budget. Selecting an image and saving a song or
project must handle file storage automatically, including existing embedded
artwork, without asking the user to select old files again.

This revision changes artwork storage and preparation. It preserves the artwork
assignments, display precedence, full-image proportions and existing save/conflict
protections required by revisions 26 and 27. It does not change audio handling,
increase the JSON limit, or introduce a bulk library migration.

## Requirements

- **TL-R30.1 — Original quality:** For accepted JPG, PNG and WebP uploads, retain
  the original image bytes and pixel dimensions for storage and presentation.
  Do not resize, recompress or convert the uploaded original. Keep the existing
  admission limits: 8 MiB per source file, at most 40 megapixels and at most
  16000 pixels on either side. Invalid images preserve the previous artwork.
- **TL-R30.2 — Automatic file storage:** Store project, primary song and
  project-specific song artwork as separate assets; JSON saves carry references
  instead of embedded image bytes. Artwork's combined byte size must not cause
  the 5 MiB JSON-write error. Apply this behavior to song creation, song updates,
  project saves and local-to-cloud project transfers without extra user actions.
  Repeated saves of unchanged artwork must reuse the stored asset.
- **TL-R30.3 — Existing artwork:** Continue displaying existing embedded artwork.
  On saving the affected song or project, automatically transfer all embedded
  artwork included in that save into separate assets, preserving its available
  bytes and assignments. Never require reselecting originals to complete that
  transfer. Previously discarded image detail cannot be restored; selecting an
  original replacement retains its original quality under R30.1.
- **TL-R30.4 — Local copies and playback:** Saved local copies retain the image
  bytes needed for offline presentation. Cloud reload, local reopening and
  local-to-cloud transfers preserve artwork and its project associations. Local
  playback must not depend on authenticated cloud image requests being available.
- **TL-R30.5 — Failure safety:** Upload, access, storage-capacity and final-save
  failures remain retryable and preserve the editor's changes and prior saved
  artwork. Do not report a song or project saved merely because its images were
  uploaded. Preserve concurrent-edit protection and edits made during a save.
  Missing assets produce a recoverable error without silently removing artwork.
  Separate assets require the same authenticated access as project media; file
  uploads remain subject to server storage-capacity protection.

## Acceptance criteria

- **TL-AC30.1 (R30.1):** Upload supported portrait and landscape images, including
  an image around 2 MiB and one wider than 1600 pixels within admission limits.
  Verify identical original bytes and dimensions after cloud save and reload,
  and show the full image in presentation. Reject invalid and over-limit files
  while retaining previous artwork.
- **TL-AC30.2 (R30.2–R30.3):** Save a project whose legacy embedded artwork would
  exceed 5 MiB in aggregate. Saving succeeds without reselecting images, keeps
  every assignment and byte content, and sends image references in JSON. Repeat
  the save and verify unchanged images are not stored again. Exercise primary,
  project-specific and project artwork, standalone song saves and cloud transfer.
- **TL-AC30.3 (R30.4):** Save a local copy, disconnect the network and reopen it.
  Presentation retains the correct full-quality artwork and fallback precedence.
  Transfer a local project to the cloud and verify project-cover associations.
- **TL-AC30.4 (R30.5):** Exercise interrupted image upload, exhausted storage,
  interrupted final save, conflict, missing asset and edits during saving. Verify
  recoverability, preserved changes, no false success and successful retry without
  duplicating unchanged image assets. Unauthenticated asset access is rejected.

## Sources and approval

Source: the user's requests in Codex on 2026-10-29 for automatic recovery from
the 5 MiB save error and for artwork to remain uncompressed for large screens.
Separate asset storage and the migration/failure rules above form the reviewed scope.

Approval: The user explicitly approved this draft in Codex on 2026-10-29 and
confirmed that they would re-upload the originals. Reviewed draft SHA-256:
`9fabb81af4cd7a01dcb88a5671273a746afeb4d4a8d1af7e7850b3e5848ad8f5`.
The user subsequently authorized deployment, commit and push after completion.

## Validation and delivery

Published as paired frontend/API release `20261029_205240` on 2026-10-29.
Frontend unit tests pass 138/138 and backend tests pass 38/38. The original-artwork
browser gate passes PNG/JPEG/WebP byte identity, wide originals, aggregate artwork
above 5 MiB, all save paths, cloud/local transfers, repeated-save deduplication,
failed final-save retry, offline reopening and authenticated access. An additional
UI scenario injects an image-read failure after a committed structural project
save resolves a newer shared song: the status acknowledges the commit, and retry
uses the advanced revision successfully.

Focused unit/API tests cover rejected uploads, dimension/size limits, interrupted
upload failure, missing-file recovery at full quota, transaction-exception
cleanup, committed-response recovery, and edits made during a pending save.
Independent reviews found and verified corrections for backend cleanup/quota
and frontend cache/committed-save recovery. Existing conflict and local-file
integrity tests remain green. Build and diff checks pass.

Production checks match six changed/generated public files against the staged
manifest, verify public health and anonymous private-endpoint rejection, and
confirm exact original PNG bytes and 1800-pixel width in a fresh browser. The
API is active with zero automatic restarts. Authenticated writes were checked
against disposable local services; private production library data was not read
or changed for validation. Direct protected-backup inspection and physical
large-screen rehearsal were not performed by the deploy user.
