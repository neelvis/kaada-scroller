# Revision 28 — per-song live display emphasis

Feature ID: TL (extension)
Status: Implemented and deployed — behavior acceptance pending
Date: 2026-10-27
Related requirements: [audience display](spec.md#requirements), especially
TL-R12, and [project cards and song presentation](revision-26.md).

## Purpose and scope

Let an organizer choose whether each song in a project uses current-line
emphasis in audience display by default. This setting belongs to the song's
membership in that project; changing it must not affect the same song in another
project or its library record. Existing display controls remain available for a
temporary override during playback.

## Requirements

- **TL-R28.1 — Project song control:** Show a checkbox labeled `Live` on every
  song card in the project song list, at the upper-right corner above the
  reorder arrows. Its tooltip is `для live исполнения текущая строка песни не
  выделяется`. Keep the complete tooltip within the viewport, wrapping its text
  when needed. New and existing project entries default to unchecked. The
  checkbox can be changed without opening the song editor or activating the
  song card.
- **TL-R28.2 — Display default:** When a project song is launched in display
  mode, unchecked `Live` starts with current-line emphasis enabled. Checked
  `Live` starts with current-line emphasis disabled for lyric lines and active
  rest/interlude cues. Active rests must not use accent color or animated note
  emphasis; their existing text or notes remain visible in the neutral style.
  Apply the setting both when launching a song from preparation and when
  switching to another song in the display project's song menu. The existing
  display emphasis control can override this default for the active display
  session.
- **TL-R28.3 — Persistence and isolation:** Preserve the checkbox value through
  project saves, reloads and local project copies. Keep the setting specific to
  the project-song entry; it must not change another project's entry or the
  library song. Legacy project entries without this value behave as unchecked.

## Acceptance criteria

- **TL-AC28.1 (R28.1):** In a project with several songs, verify every song card
  has an unchecked `Live` checkbox initially. At narrow viewport widths, verify
  its complete tooltip remains on screen. Toggle it without opening the song,
  and verify the card remains otherwise usable.
- **TL-AC28.2 (R28.2):** Launch a song with the checkbox unchecked and verify
  current-line emphasis is enabled; launch one with it checked and verify
  emphasis is disabled for both lyric lines and active rest/interlude cues,
  including accent color and note animation. Switch between both songs using
  the display song menu and verify the corresponding default is applied.
  Toggle the existing display control and verify it overrides the active song's
  default.
- **TL-AC28.3 (R28.3):** Reload the project and reopen a saved local copy to
  verify each value persists. Put the same song in two projects and verify
  toggling one entry does not change the other project or the library record.
  Verify legacy entries with no value default to unchecked.

## Evidence and approval

Source: the user's request on 2026-10-27. Existing display emphasis is controlled
by `#highlight-current` and a saved global preference in `public/app.js`. Project
song records are assembled in `projectPayload()` and adopted through
`adoptProject()`; local project copies have their own save and restore paths.

The per-project membership scope and session-only manual override avoid changing
shared library metadata and retain the existing live display control.

Approval: The user approved this scope in Codex on 2026-10-27 with `ага давай`,
then specified the checkbox placement (upper-right, above the arrows) and exact
tooltip. This approval covers TL-R28.1–R28.3 and TL-AC28.1–AC28.3 as updated
above. The user subsequently requested commit, push and deployment, then clarified
that active rest/interlude cues in Live songs must also remain unhighlighted.
The user requested amending the commit, force-pushing and deploying that fix.

## Delivery evidence

Application commit `c078a4b` and reviewed bootstrap checksum pin commit
`c70c3e4` were pushed to `main`. Paired release `20261027_195041` was activated
on 2026-10-27; the previous paired release `20261024_204121` remains available
for rollback. The additive `project_entries.live` migration defaults existing
entries to false.

On 2026-10-27, the user clarified that active interludes in Live songs must also
remain neutral. The CSS now removes the accent style and animated notes when
current-line emphasis is disabled. This correction was included in source commit
`efb5101` and deployed in paired release `20261027_200033`; rollback pair
`20261027_195041` remains available. Production checks returned 200 for the
lyrics page and API health, 401 for anonymous project access, and 200 for the
main site and `/health`. The served stylesheet SHA-256 matches the build.

On 2026-10-28, the user reported that the `Live` tooltip was clipped at narrow
viewport widths. Its maximum width now leaves 24px side margins and wraps the
text as needed. The correction was amended into source commit `fac066d` and
deployed in paired release `20261028_075131`; rollback pair
`20261027_200033` remains available. Production checks returned 200 for the
lyrics page and API health and 401 for anonymous project access. The served
stylesheet SHA-256 matches the build. Automated tests and visual browser
acceptance were not run.

The frontend build and backend syntax check passed. Production checks returned
200 for `/lyrics/`, API health, the main site and `/health`; anonymous project
access returned 401. The served `app.js` SHA-256 matches the staged build, and
MJS/WASM assets return their expected MIME types. Automated behavior tests and
authenticated browser acceptance for the checkbox, save/reload and per-song
display switching were not run; TL-AC28.1–AC28.3 remain pending.
