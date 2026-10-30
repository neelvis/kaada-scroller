# Revision 32 — project song names and cover-only presentation standby

Feature ID: TL (extension)
Status: Implemented, verified and deployed
Date: 2026-10-30
Related requirements: [Project song artwork](revision-27.md),
[display pause and resume](revision-7.md), and
[display library navigation](revision-31.md).

## Purpose and scope

Let a presenter label the same library song differently in each project and
prepare the audience with artwork before starting the lyrics. Extend existing
project-specific song settings and display controls; preserve the song's library
title, readiness checks, playback timing and artwork fallback rules.

## Requirements

- **TL-R32.1 — Optional project name:** Alongside a song's artwork setting for
  each containing project, provide an optional field labelled `Имя в медиатеке`.
  Associate it with the project identity, independently of its artwork. Changing
  a name must not change the song's normal library title, artwork or another
  project's name. Only offer projects containing the song, preserving existing
  membership-loading error and retry behavior.
- **TL-R32.2 — Display menu naming:** In the display-mode Media library menu
  opened for a project, use the song's nonblank name for that project; otherwise
  use its normal library title. Treat whitespace-only input as empty. Preserve
  numbering, order, readiness indicators and current-song indication. Presentation
  launched directly from the online library uses normal library titles. This
  revision does not rename library cards, project-editor lists or song headings.
- **TL-R32.3 — Persistence and compatibility:** Preserve project names through
  cloud save/reload, local project copies, offline presentation and native portable
  export/import, including project-identity remapping. Project renaming must not
  lose song names. Existing records without names remain valid and use normal
  titles. Clearing a name restores the fallback. Preserve existing unsaved-change,
  failed-save and conflict protections.
- **TL-R32.4 — Cover-only standby:** Every successful launch of presentation,
  including a song change within presentation, starts with audience lyrics hidden
  until Play. Show the selected presentation artwork centered horizontally and
  vertically, as large as the available audience area permits, preserving the
  entire image and its proportions. Keep presentation controls usable. Use the
  existing artwork fallback chain. Without artwork, show the audience background
  without placeholder text or lyrics.
- **TL-R32.5 — Play, pause and reset:** Play reveals the normal lyric presentation
  when playback starts successfully and restores the existing artwork/text layout.
  Pause freezes playback and keeps lyrics visible; resume continues from the saved
  position. Stop and reset returns playback to zero and restores cover-only
  standby until Play is used again. Seeking or manual scrolling alone must not
  reveal lyrics before Play. A failed startup keeps standby and existing recovery
  controls available; starting through the lyrics-only fallback also reveals
  lyrics. Natural completion after Play retains the existing end presentation.
  Apply these rules to timed, automatic untimed and manually scrolled songs, with
  or without backing audio, in project and direct-library presentation.

## Acceptance criteria

- **TL-AC32.1 (R32.1–R32.3):** Put one song in projects A and B. Set distinct
  names beside their artwork settings. Each project's display menu shows its own
  name; direct-library presentation and normal library cards retain the original
  title. Clear A's name or enter only spaces and verify normal-title fallback.
  Reorder songs and verify numbering/current-song indication remain correct.
- **TL-AC32.2 (R32.3):** Save and reload the names, rename a project, reopen a
  local copy offline and round-trip a native portable project with remapped IDs.
  Verify each name still belongs to the correct project. Load a legacy record
  without names and verify normal-title fallback.
- **TL-AC32.3 (R32.4):** Launch and switch songs with portrait and landscape
  artwork, and without artwork. Before Play, no audience lyrics are visible;
  artwork is centered, uncropped and fits the available area. Repeat in project
  and direct-library presentation.
- **TL-AC32.4 (R32.5):** For timed and untimed songs, with and without backing
  audio, launch, seek before Play, Play, pause, seek while paused, resume and use
  Stop and reset. Verify lyrics stay hidden before Play, remain visible while
  paused and disappear on reset. In manual-scroll mode, scrolling before Play
  does not reveal text; after Play it works as before. Start again after reset
  and verify playback starts at zero and text returns.
- **TL-AC32.5 (R32.5):** Force backing startup failure. Verify standby remains,
  error/retry controls work and successful retry or lyrics-only startup reveals
  text. Allow playback to finish naturally and verify the existing end state.

## Sources and approval

Source: the user's two-feature request in Codex on 2026-10-30.
The project scope of the optional name follows the request to place it alongside
project-specific song artwork. Blank-background behavior when no artwork exists
and retaining the existing natural-end state are explicit draft choices for review.

Technical evidence: `lyrics-site/public/song-editor.js` already lists per-project
song artwork; `lyrics-site/public/app.js` builds the display Media library menu,
launches songs and implements Play/pause/reset. `public/core.js` sanitizes native
portable song metadata, so new metadata requires round-trip preservation.
`public/styles.css` currently positions artwork beside audience lyrics.

Approval: The user explicitly approved this draft in Codex on 2026-10-30 with
`отлично`. Reviewed draft SHA-256:
`15f44fa387ba2136502cad156e91beafef46a076ad82b02a32628bc9d040a178`.

## Validation and delivery

Implemented optional names in project song associations, preserving independent
artwork and name changes and existing project-ID remapping. Presentation now
tracks whether playback has successfully revealed lyrics; launch/reset clear
that state while pause and natural completion retain it. Independent reviews
accepted the display/state and data/persistence scopes with no material findings.

Validation passed:

- Frontend unit suite: `npm test`, 138/138.
- Backend suite: `backend/.venv/bin/python -m unittest discover -s backend/tests -q`,
  38/38. Includes saved names, name-only associations, invalid name rejection and
  imported project-ID remapping.
- `npm run build`, changed JavaScript syntax checks and `git diff --check`.
- `node tests/revision-32-browser.mjs` against a disposable real API: independent
  project menu names, blank fallback, unchanged direct-library titles, name edit
  and reload followed by project-menu propagation; portrait, landscape and absent
  artwork; timed/manual/automatic untimed presentation; pre-Play seek/scroll,
  Play/pause/resume/reset, failed backing startup with lyrics-only recovery,
  natural completion, and real WAV backing Play/pause/resume/reset.
- Desktop portrait and landscape screenshots inspected; artwork is centered,
  uncropped and fills the limiting available dimension.

Portable metadata and cloud/local ID remapping are covered by focused unit/API
tests. A fresh offline browser round trip with the new name field, native folder
permission prompts and projector rehearsal were not separately exercised.
The older `live-display-browser.mjs` could not reach its scenarios because its
startup selector waited for a hidden editor heading; the new revision-32 suite
provides the changed playback coverage above.

The user subsequently explicitly authorized deployment and commit with
`деплой и коммит по окончании работы`.

Published paired release `20261030_042855` on 2026-10-30. Its 61-entry staged
manifest SHA-256 is
`6ceacaf03ef9f7f84abad22f62e2cba3ff9e905bfc1d9deb5584c08afcc90eee`.
Both live links select this release; the API is active with zero automatic
restarts. The optional-name validation is the only backend source change; no
database migration or runtime dependency change was introduced. The previous
pair `20261029_213151` remains available.

Production checks matched changed public assets, generated service-worker/cache
files and backend source against the staged hashes. Health, anonymous private
resource rejection and runtime MIME checks passed. A fresh signed-out production
browser, using only synthetic OPFS data and intercepted API requests, verified
project-name menu labels, standby artwork, Play/pause/reset and zero reset position
without page errors or production API writes. Close and reopen existing tabs to
adopt the updated application shell.
