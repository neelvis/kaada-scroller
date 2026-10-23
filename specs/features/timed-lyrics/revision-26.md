# Revision 26 — card clarity, local copies and song presentation

Feature ID: TL (extension)
Status: Implemented, verified and deployed
Date: 2026-10-23
Related requirements: [cue shifting](revision-15.md),
[interludes](revision-17.md), [card actions](revision-21.md),
and [artwork and albums](revision-25.md).

## Purpose and scope

Make project and library cards consistent, make local saving usable without
interrupting editing, and refine song preparation and presentation. Preserve
existing cloud ownership, readiness checks, project membership and recovery
safety. This revision supersedes only the conflicting parts of earlier rules.

## Requirements

- **TL-R26.1 — Song metadata:** In project-editor song lists and library cards,
  show the artist in bold and the recording version smaller than the album.
  Library versions have no `Версия записи` prefix. Project-editor readiness
  status uses the existing theme's cyan for ready and red for needs preparation.
- **TL-R26.2 — Library media icon:** In the library card's upper-right corner,
  immediately left of its existing music-note icon, show a matching speaker icon
  when the song has an attached audio track, with tooltip `есть звуковая дорожка`.
  Otherwise show a text icon with tooltip `только текст`.
- **TL-R26.3 — Local-copy indication:** Remove `В облаке` labels from library
  and project cards. On a project's download button, indicate a successfully
  saved local copy with a small green check and tooltip `есть локальная копия`.
  Do not show additional successful-local-copy labels, including
  `Тексты и минусовки сохранены локально`. Preserve actionable failure messages.
  Library songs remain covered by project copies; no standalone song-download
  workflow is introduced. Project counts use `песен: X`.
- **TL-R26.4 — Responsive saving:** While saving a local project copy, show
  progress on that project's download button and keep navigation and unrelated
  controls usable. Prevent duplicate transfers and conflicting writes without
  making the entire interface inert. Mark success only after durable completion;
  a failed save preserves the previous valid copy and allows retry.
- **TL-R26.5 — Restore and launch local copies:** After reload, recover saved
  projects and their local-copy indication from the configured workspace when
  access is available. Launch a ready local project's first playable song from
  its card, including when it is not the first song in the project, without
  opening its editor first. Keep existing readiness and missing-media errors.
  Repeated saving of a valid project with supported artwork must not produce
  the generic text-field-length import error. Verify existing fixes before
  changing import limits or validation.
- **TL-R26.6 — Reuse configured folder:** Saving uses the workspace selected in
  settings. If browser permission expired, request access to that same folder
  through a user action. Offer folder selection only when no workspace is
  configured; denied access reports a recoverable error without silently
  switching folders. An explicit settings action can still replace the folder.
- **TL-R26.7 — Single tooltips:** Controls with custom tooltips do not also
  produce delayed native browser tooltips. Preserve accessible control names,
  keyboard access and tooltips for disabled actions.
- **TL-R26.8 — Empty interludes:** Permit an empty interlude label in the song
  editor and preserve it through saves and round trips. Render three notes
  (`♪ ♪ ♪`) for an empty interlude before, during and after its active interval;
  animate only while it is actively playing. Pause and reduced-motion settings
  keep notes static. Preserve editable nonempty labels and lyric validation.
- **TL-R26.9 — Nonnegative time shifts:** Applying `Подвинуть время` sets each
  finite cue start to the larger of zero and its shifted value. Preserve missing
  times, row order and text. If clamping creates equal timestamps, report the
  existing timing conflict and require correction before readiness. This replaces
  revision 15's requirement to preserve negative shifted results.
- **TL-R26.10 — End caption:** Provide optional end-caption fields for each song
  and project. At song end, show the nonblank song caption when present,
  otherwise the nonblank project caption, otherwise `Ваша песенка спета`.
  Whitespace-only captions count as absent. Use the active lyric line color
  and full opacity for the end caption. These refinements were requested by the
  user on 2026-10-23. Preserve captions through cloud and
  local saving and native portable import/export. Existing records without these
  fields remain compatible. Apply the same precedence in timed and untimed
  presentation; retain existing end-of-song playback behavior.
- **TL-R26.11 — Rectangular artwork:** Accept portrait and landscape song and
  project artwork. Preserve the entire image and its aspect ratio in previews,
  cards and presentation without stretching or forced square cropping. Retain
  supported formats, size protections and project-over-song artwork precedence.
- **TL-R26.12 — LRCLIB album:** When importing a selected LRCLIB result with a
  nonblank album name, populate the song's album field along with the imported
  metadata. An absent album must not erase an existing album. Preserve album
  through the existing save and local-copy paths.

## Acceptance criteria

- **TL-AC26.1 (R26.1–R26.3, R26.7):** Inspect ready/unready songs, with/without
  album, version and audio, and local/cloud project cards at desktop and narrow
  widths. Verify font hierarchy, theme colors, icon placement, exact tooltips,
  counts, lack of redundant labels and absence of delayed native tooltips.
- **TL-AC26.2 (R26.4–R26.6):** Save a project with audio and artwork, interact
  with unrelated UI during transfer, reload and verify the local check. Repeat
  saving without a folder picker or text-length failure. Test failed/retried
  saves, duplicate clicks, expired and denied folder permissions, and no
  configured folder. Launch a project whose first ready song is not first in
  its list directly from its local card, including without network access.
- **TL-AC26.3 (R26.8–R26.9):** Save/reopen a blank interlude and check three
  static/animated/static notes around its interval, pause, seek and reduced
  motion. Shift times `[1, 3, 8]` by `-4` and obtain `[0, 0, 4]`; flag the
  duplicate zero times without silently reordering or removing rows.
- **TL-AC26.4 (R26.10):** Check song caption precedence, project fallback,
  whitespace-only values and the exact default caption, in timed and untimed
  playback. Verify cloud/local/portable round trips and legacy records.
- **TL-AC26.5 (R26.11–R26.12):** Use portrait and landscape covers for songs
  and projects; verify full-image proportions on cards, previews and display.
  Import LRCLIB results with and without album names and verify persistence.

## Evidence and approval

Source: the user's requested corrections on 2026-10-23. Relevant implementation
surfaces include `workspace-hub.js`, `workspace-actions.js`, `local-workspace.js`,
`song-editor.js`, `app.js`, `core.js`, `lrclib.js`, and backend metadata validation.
Inspection found whole-interface transfer locking, duplicate `title` attributes
on custom-tooltip controls, and folder selection without retrying permission on
the remembered handle. A local launch callback also does not select the chosen
ready song before launch. Artwork-aware text-length validation already exists
and requires regression verification rather than an assumed new limit increase.

The user explicitly approved this draft with `подверждаю` in Codex on
2026-10-23. Approved draft SHA-256:
`64ea4f53ceb6bb612aa286e58f2af349d4fa064ac8494818d31c956aa3c7e8b3`.
The user subsequently authorized commit and push, then explicitly requested
deployment in Codex on 2026-10-23.


## Delivery evidence

Implemented and verified locally on 2026-10-23. The frontend unit suite passes
121 tests and the API suite passes 29 tests. `tests/revision-26-browser.mjs`
passes against an ephemeral authenticated API and actual serializable OPFS
handles, covering card metadata/media, rectangular covers, nonblocking transfer
navigation, delayed commit without a premature check, folder restoration and
repeat save after reload, direct offline local launch, caption precedence and
editing, timed/untimed blank interludes, pause/reduced motion, nonnegative time
shift conflicts, and native-tooltip suppression. Desktop and 375px screenshots
were inspected. `tests/artwork-browser.mjs` additionally passes the large
PNG/JPEG/WebP, cloud and fresh local reopening regressions.

Action tests cover permission renewal/denial without choosing another folder,
duplicate transfers, concurrent edits, target deletion and workspace replacement.
The final independent read-only reviews found no remaining actionable metadata
or local-copy lifecycle issues. Native OS folder permission prompts and projector
rehearsal remain manual checks. Publication evidence follows below.


## Production publication

Application commit `e456691bf6a89bf94f224e88158989af3a2a4daa` was pushed to
`main` and published as paired release `20261023_121724` on 2026-10-23.
Independent review verified all 61 staged payload hashes, unchanged pinned
runtime inputs and synthetic old/new/old database compatibility for the additive
`end_caption` column. Both frontend and API select the new release; the API is
active with zero automatic restarts. Previous pair `20261023_110500` is retained
for rollback.

Production checks passed: 35 public source hashes, eight health/access endpoints
and three JavaScript/MJS/WASM MIME checks. Isolated production Chrome verified
synthetic local project save/reload, direct launch, blank-interlude notes and
pause, the project end caption, and the 375px layout, with no API writes or
browser errors. Private school songs, projects and credentials were not read or
modified by smoke checks. Close and reopen existing tabs to adopt the new shell.
