# Timed lyrics revision 22: preparation toolbar actions and grouping

Feature ID: TL (extension)
Status: Implemented — build and syntax checks passed; UI acceptance pending
Revision: 22, 2026-10-23
Baseline: [Specification](spec.md), [revision 21 — library status, project media and song editing](revision-21.md).

## Purpose and scope

Move project preparation actions into the top menu, add direct playback while preparing an online-library song, and visually separate top-menu groups.

## Requirements

- **TL-R133 — Play an online-library song from preparation:** While preparing a song opened from the online library, show a Play icon in the top menu. Enable it only when the song is ready and has no unsaved changes. Its enabled tooltip is `Запустить`; when disabled, its tooltip is `Сначала сохраните изменения`. Activating it enters display mode and starts the current song. Do not show this control for projects or local songs unless already supported by an existing requirement.
- **TL-R134 — Separate toolbar groups:** In both project and online-song preparation, visually separate these top-menu groups with separators: (1) service/status indicators such as `В облаке`, (2) tab navigation, (3) song actions such as Play, Save, Delete, and Add songs, and (4) site settings such as local storage and sign-in. Preserve existing meanings and accessible names. Keep the groups usable at narrow viewport widths.
- **TL-R135 — Project preparation toolbar actions:** While editing a project, move the existing Play and Add songs controls to the top menu as icons. Play retains its current behavior and availability. The music-note-plus control opens a choice with the existing add-song destinations, then follows their current flows. Keep the add control unavailable where adding songs is currently unavailable.

## Acceptance criteria

- **TL-AC100 (R133):** While preparing a ready, saved online-library song, verify the Play icon is enabled, shows `Запустить`, and launches that song in display mode. Make an unsaved edit and verify Play is disabled with tooltip `Сначала сохраните изменения`.
- **TL-AC101 (R134):** Verify status indicators, tab navigation, song actions, and site settings occupy four distinct groups with separators at desktop and narrow viewport sizes. Confirm all controls remain operable and accessible.
- **TL-AC102 (R135):** While editing a project, verify Play and music-note-plus appear in the top menu, are independently accessible, and keep their current launch/add behavior. Verify the Add menu offers the existing new-song and library-song choices and those flows remain unchanged.

## Approval

The user approved TL-R133–R135 on 2026-10-23 and clarified that the separators apply in project preparation too. For Add songs, the user confirmed the existing choices `Новая песня` and `Из библиотеки`. This approval authorizes implementation of revision 22; it does not authorize commit or deployment.

Implementation evidence: `lyrics-site/public/index.html` places project playback, the music-note-plus menu, library-song actions, navigation, status, and site settings into grouped top-menu regions. `lyrics-site/public/app.js` retains the existing Play and Add flows and toggles project/song actions by mode. `lyrics-site/public/styles.css` separates toolbar groups and keeps them visible at narrow widths.

Validation: Node syntax checks passed for `app.js`, `workspace-hub.js`, and `song-editor.js`; `node tools/build.mjs` and `git diff --check` passed. Automated tests and browser UI acceptance checks were not run; TL-AC100–AC102 remain pending UI verification.
