# Revision 31 — loading feedback and song-list navigation

Feature ID: TL (extension)
Status: Implemented, verified and deployed
Date: 2026-10-30
Related requirements: [Direct card navigation and display library](revision-20.md)
and [card clarity and project editing](revision-26.md).

## Purpose and scope

Make asynchronous opening visible and help the presenter navigate song lists.
Cover home project cards, library song cards, project-editor song lists and the
display-mode Media library menu, including both project and online-library songs.
Preserve existing song order, readiness checks and independent card controls.

## Requirements

- **TL-R31.1 — Card loading feedback:** When opening a project from the home
  page or a song from the library, show a spinner on the activated card for the
  duration of its asynchronous loading. Cover local and cloud projects and both
  opening for editing and launching for display. Prevent repeated activation of
  the pending action. Clear loading on completion, cancellation or failure;
  preserve existing error reporting and allow retry after failure. Expose the
  loading state accessibly. Preserve unrelated card actions and navigation.
- **TL-R31.2 — Derived song numbers:** Show consecutive song numbers starting
  at 1 in project editing and in the display-mode Media library menu. Derive
  numbers from the currently displayed order on every render; never persist
  song numbers in song or project records. Reordering project songs by dragging
  or move controls immediately updates numbers. Library sorting determines the
  displayed numbering without changing song metadata.
- **TL-R31.3 — Display-menu scroll retention:** Closing and reopening the
  display-mode Media library menu preserves its scroll position for the same
  project or online-library context, including after selecting another song.
  Asynchronous loading and list replacement must not reset the retained position.
  Reset retention when switching to a different project or library context.
  Clamp to the available scroll range if the list becomes shorter. Browser-reload
  persistence is outside this revision.
- **TL-R31.4 — Current song indication:** Visually highlight the current song
  in the display-mode Media library menu and expose its current state to assistive
  technology. The indication follows successful song selection in both project
  and online-library display, and remains correct when reopening the menu.

## Acceptance criteria

- **TL-AC31.1 (R31.1):** Delay local/cloud project and library-song opening for
  editing and display. The activated card shows loading until completion;
  repeated activation does not duplicate its pending action. Force a failure and
  verify loading clears, the existing error appears and retry works.
- **TL-AC31.2 (R31.2):** Render multiple songs, reorder project songs using both
  supported methods, and reopen the display menu. Numbers are consecutive and
  match current order. Verify saved/exported records have no numbering field.
- **TL-AC31.3 (R31.3):** With enough songs to scroll, select a song near the
  bottom and reopen the menu. Preserve the prior scroll position in project and
  online-library display, including delayed library responses. Switching projects
  starts with a fresh position; a shorter list has a valid scroll position.
- **TL-AC31.4 (R31.4):** Open the menu before and after successfully changing
  songs in each display context. Exactly the current song has visible and
  accessible current-song indication; an unsuccessful load does not move it.

## Sources and approval

Source: the user's requests in Codex on 2026-10-30. Implementation evidence:
`lyrics-site/public/workspace-hub.js` currently activates cards without a loading
state; `lyrics-site/public/app.js` renders unnumbered project songs and rebuilds
the display menu on opening. The menu currently sets `aria-current` but needs a
visible current-song treatment and scroll restoration.

Approval: The user explicitly approved this draft in Codex on 2026-10-30 with
`утверждаю`. Reviewed draft SHA-256: `bcbe841733c19d6a779d03dba8391c98bb07d31c706414f79997f38027027da5`.
The user separately authorized deployment, commit and push after completion.

## Validation and delivery

Implemented the loading indicators with per-card navigation guards across hub
renders, derived numbering and display-menu current-song styling. Scroll capture
is suspended while the menu rebuilds and restores its position, preventing
queued reset events from replacing the retained offsets. Independent review found
that race during development and verified its correction; no material findings
remain in the reviewed production scope.

Validation passed:

- Frontend unit suite: `pnpm test`, 138/138 passing.
- Build: `npm run build`; JavaScript syntax and `git diff --check` pass.
- `node tests/hub-loading-browser.mjs`: all six local/cloud project and cloud-song
  edit/play paths, delayed actions, duplicate mouse/keyboard activation, busy state
  across renders, independent controls, rejection/false cleanup and real retry.
- `LYRICS_TEST_PYTHON=backend/.venv/bin/python node tests/revision-31-browser.mjs`:
  disposable real API, delayed failed project read/retry, numbered reorder using
  both move and drag, and project/online-library scroll retention and current-song
  indication, including delayed list responses and closing/reopening while an older request
  is still pending. Menu screenshot visually checked.
- Context-key reset and shortened-list scroll clamping were inspected in code;
  switching between two distinct projects and shortened-list scenarios were not
  separately automated. No new stored numbering fields were introduced.

Published paired release `20261029_213151` on 2026-10-30 (local date).
The 62-entry staged payload manifest SHA-256 is
`795ea9efd240349e32fe2d735105227e5a9fcd95af78f31215bb3d4d8494fb11`.
Backend sources, locked requirements and bootstrap match the preceding release;
no server behavior or schema changes were introduced. Preparation and paired
activation succeeded; the API is active with zero automatic restarts. Previous
pair `20261029_212929` remains available under the existing rollback procedure.

Production verification matched all four changed public files plus generated
service-worker/cache-manifest hashes, checked eight health/access endpoints,
and opened a fresh anonymous browser without page errors. Private production
songs, projects and credentials were not inspected or modified for testing.
Close and reopen existing application tabs to adopt the updated cached shell.
