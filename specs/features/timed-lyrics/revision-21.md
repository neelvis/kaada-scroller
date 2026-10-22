# Timed lyrics revision 21: library status, project media and song editing

Feature ID: TL (extension)
Status: Implemented — build and syntax checks passed; UI acceptance pending
Revision: 21, 2026-10-23
Baseline: [Specification](spec.md), [revision 17 — cue ordering, interludes and library sorting](revision-17.md), [revision 19 — library editing and project recovery](revision-19.md), and [revision 20 — direct card navigation and display library controls](revision-20.md).

## Purpose and scope

Correct song readiness and project-song rendering in the display media menu, remove its horizontal overflow, simplify project and song card actions, and refine online-library song editing and save safety.

This revision affects display media menus, hub cards and filtering, and online-library song editing. It does not change song validation rules, timeline confirmation rules, or project membership.

## Requirements

- **TL-R125 — Display media readiness:** In the display `Медиатека` menu, show readiness for online-library songs from the readiness fields returned by the library (`reviewed` and `valid`). A ready song is selectable and has no `нужна подготовка` suffix. Preserve existing timeline validation for songs that are loaded as full song objects.
- **TL-R126 — Display project songs:** When display mode was launched from a project, the `Медиатека` menu lists every song in that project and can switch playback to the selected song. Opening the menu must not prevent the initial project list from rendering.
- **TL-R127 — Media dialog fits its content:** The display `Медиатека` dialog has no horizontal scrollbar at narrow viewport widths. Long song names wrap or truncate within the dialog; vertical scrolling remains available when the list exceeds the dialog height.
- **TL-R128 — Icon actions on cards:** Replace the visible text labels for play, download/save-local-copy, and delete actions on project and song cards with recognizable play, download, and trash icons. Each icon control has a localized tooltip and an accessible name. Keep each action independently operable without opening the containing card. Preserve current action availability and disabled states.
- **TL-R129 — No project-location filter:** Remove the `На этом устройстве / В облаке / Все` selector from the Projects view. Show all projects the signed-in user can access, subject to the existing search field. Keep local and cloud project actions and badges.
- **TL-R130 — Editor action alignment and spacing:** Place Delete and the floppy-disk cloud-save control together in the top menu's horizontal action row. Delete is a trash icon with an accessible name and tooltip. Retain comfortable padding and separation between the destructive and save controls.
- **TL-R131 — Online-song dirty state and safe exit:** Track unsaved edits while editing a song from the online library. When a ready song has edits not yet saved to the cloud, show `Изменена`; enable cloud save. When the timeline needs confirmation, keep the existing review-needed state and disable cloud save with tooltip `сначала подтвердите таймлайн`. When a ready song has no unsaved edits, show `Готова` and disable cloud save with tooltip `изменения сохранены`. Before leaving a dirty online-library song, show the unsaved-changes dialog with save, discard, and stay choices. Save persists before leaving; discard restores the saved online version before leaving; stay keeps the editor open. Apply this guard when navigating away, switching songs, or entering another mode.
- **TL-R132 — Cloud save in the top menu:** Show online-library cloud save in the top menu as a floppy-disk icon with a tooltip that reflects the current save state. Use the enablement and exact disabled-state tooltips defined in TL-R131. Remove the duplicate cloud-save button from the editor footer.

## Acceptance criteria

- **TL-AC92 (R125):** Open the display library with ready and unready online songs. Ready items have no preparation warning and can launch; unready items retain the warning and disabled state. Verify full song objects still use existing validation.
- **TL-AC93 (R126):** Launch display from a project with multiple songs, open `Медиатека`, and verify every project song appears and can be selected.
- **TL-AC94 (R127):** At narrow viewport widths, verify the dialog has no horizontal scrollbar, long names stay inside its bounds, and a long list scrolls vertically.
- **TL-AC95 (R128):** Verify card actions show play, download, and delete icons with tooltips and accessible names. Activate each action and ensure the parent card does not also open.
- **TL-AC96 (R129):** Verify the Projects view has no location selector and search returns matching local and cloud projects.
- **TL-AC97 (R130):** Verify song-editor destructive and save actions follow the selected placement and retain comfortable padding and spacing.
- **TL-AC98 (R131):** Verify dirty ready songs show `Изменена` and allow save; unconfirmed timelines disable save with the specified tooltip; saved ready songs show `Готова` and disable save with the specified tooltip. Attempt to leave, switch songs, and enter another mode with unsaved edits; verify save, discard, and stay behave as specified.
- **TL-AC99 (R132):** Verify cloud save is a floppy icon in the top menu, its tooltip tracks save state, and no duplicate cloud-save control remains in the editor footer.

## Evidence and approval

The user reported on 2026-10-23 that display library entries all claim preparation is needed, the project media list is empty, and a horizontal scrollbar appears in the media dialog. Screenshots also show text action buttons on cards and the stacked editor footer actions.

Source inspection found that `showEventMenu()` appends project songs before opening the dialog, while its append helper exits unless the dialog is already open. It also validates library metadata as if each item were a complete song object, although library list entries expose readiness as `reviewed` and `valid`. The dialog itself has `overflow:auto`, allowing horizontal overflow to appear as a scrollbar. The Projects view currently contains a location selector, and the editor currently renders the cloud-save control in its footer. `confirmProjectExit()` does not guard dirty online-library songs.

Approval: The user explicitly approved TL-R125–R132 and selected the first placement option on 2026-10-23: Delete and Save together in the top menu, with Delete as a tooltip-equipped icon and confirmation. This approval covers revision 21 only; additional toolbar actions and separators are proposed separately in [revision 22](revision-22.md).

Implementation evidence: `lyrics-site/public/app.js` uses library readiness metadata, opens the display menu before rendering project songs, and tracks dirty online-library songs through save and exit flows. `lyrics-site/public/workspace-hub.js` uses icon actions and no longer filters projects by location. `lyrics-site/public/song-editor.js`, `index.html`, and `styles.css` place song save/delete controls in the top menu and prevent horizontal overflow in the display media dialog.

Validation: Node syntax checks passed for `app.js`, `workspace-hub.js`, and `song-editor.js`; `node tools/build.mjs` and `git diff --check` passed. Automated tests and browser UI acceptance checks were not run; TL-AC92–AC99 remain pending UI verification.
