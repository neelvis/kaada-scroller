# Revision 25 — song and project artwork, album metadata

Status: Accepted by explicit user approval in Codex on 2026-10-23.

This revision extends the current requirements in `spec.md` for song metadata,
project/library cards, presentation mode, cloud storage, and local copies.

## Requirements

- **TL-R25.1 — Album metadata:** A song may have an optional album field in its
  editor alongside title, artist, and recording version. Album is part of song
  identity when comparing otherwise duplicate songs. Show a nonempty album in
  library song cards below title and artist.
- **TL-R25.2 — Song artwork:** A song may have optional JPG, PNG, or WebP cover
  artwork. Keep it with the cloud song and its local copy. Show it as a small,
  rounded square in the lower-right area of a library song card. In presentation
  mode, reserve the right third for artwork and the other two thirds for lyrics.
- **TL-R25.3 — Project artwork:** A project may have optional JPG, PNG, or WebP
  cover artwork. Keep it with the cloud project and its local copy. Show it on
  the project card when present. In presentation mode project artwork takes
  precedence over song artwork; use song artwork when the project has none.
- **TL-R25.4 — Compatibility:** Existing songs and projects without album or
  artwork remain valid and retain their current behavior.

## Acceptance

Verify editor selection and persistence of each supported image type, cloud and
local round trips, card metadata/artwork, project-over-song display precedence,
and duplicate identity with differing albums. Existing records without new
fields must still load.
