# Timed lyrics revision 20: direct card navigation and display library controls

Feature ID: TL (extension)
Status: Implemented — syntax and diff checks passed; UI acceptance pending
Revision: 20, 2026-10-23
Baseline: [Specification](spec.md), [revision 17 — cue ordering, interludes and library sorting](revision-17.md), [revision 18 — focused project and song editing](revision-18.md), and [revision 19 — library editing and project recovery](revision-19.md).

## Purpose and scope

Make project and song cards open their content directly, provide a complete searchable and sortable online-library list while editing a library song, and make display-mode navigation and safety controls consistent whether playback began from a project or the online library.

This revision changes card activation, online-library song editing, display-mode library contents and navigation, and display keyboard/reset behavior. It does not change song readiness, project membership, library sorting choices, playback timing, or full-screen audience presentation beyond hiding the new home-navigation control while full-screen.

## Requirements

- **TL-R119 — Direct card navigation:** Clicking a project card opens that project; clicking a song card opens that song. Do not require a separate `Открыть` button. Keep other card actions such as play, copy, save-local and delete independently usable without triggering card navigation. Interactive child controls must not cause accidental card activation.
- **TL-R120 — Full online-library list in library-song editing:** When editing a song opened from the online library, show the complete set of songs in the online library in the editor's song list, rather than only the currently opened song. Selecting a list item opens that library song in the editor. Provide filtering by song title and sorting by the same six options, labels, default and sorting behavior as the main library tab (TL-R98–R99). Search and sort must not change library contents or song metadata.
- **TL-R121 — Display library content:** The display-mode `Медиатека` menu shows all songs in the online library when the active song was launched from the online library, rather than showing only the currently active song. Selecting another song launches that song in display mode. Preserve the existing project-song list when display was launched from a project.
- **TL-R122 — Return to the prior home section:** Between `Медиатека` and `К подготовке`, provide a `На главную` control. It exits display mode and opens the main Projects section when display was launched from a project, or the main Song library section when it was launched from the online library. Hide this control in full-screen mode. Returning home must not alter the current song or its saved data.
- **TL-R123 — Display keyboard and reset safety:** Remove keyboard shortcuts for Start and mute; their on-screen controls remain available. Stop/reset takes effect only after a double-click. Its tooltip identifies the double-click requirement. A single click does not stop or reset playback. Do not alter other display shortcuts.
- **TL-R124 — No project switching inside display library menu:** Remove the `Другой проект` action from the display-mode library menu. Users choose another project through the main Projects section.

## Acceptance criteria

- **TL-AC86 (R119):** Click project and song cards and verify the matching content opens. Use every remaining card action and verify it does not open the card. Confirm keyboard focus and activation remain accessible.
- **TL-AC87 (R120, R98–R99):** Open a library song for editing and verify the complete online library appears in its song list. Open another song from that list. Filter by title and exercise each of the six sort orders; verify ordering matches the main library tab and selection persists through filtering and rerendering.
- **TL-AC88 (R121):** Launch a song from the online library and verify the display `Медиатека` menu lists all online library songs and can launch another. Launch from a project and verify the menu lists that project's songs. Verify unavailable or unready songs follow the existing disabled/actionable state behavior.
- **TL-AC89 (R122):** From project playback, activate `На главную` and verify Projects opens; from online-library playback, verify Song library opens. Verify the control is between `Медиатека` and `К подготовке` in normal display and absent in full-screen. Verify current song data is unchanged.
- **TL-AC90 (R123):** Verify keyboard input no longer starts playback or toggles mute. Verify one reset click has no effect and a double-click stops and resets. Confirm the tooltip explains double-click. Confirm all other display shortcuts still work.
- **TL-AC91 (R124):** Verify `Другой проект` is absent from the display menu and project selection is available from the main Projects section after leaving display mode.

## Evidence and approval

The user requested these changes on 2026-10-23. The attached screenshot shows the online-library song editor with a single-song left list; it is context for TL-R120. The current implementation evidence is in `lyrics-site/public/workspace-hub.js`, `lyrics-site/public/app.js`, `lyrics-site/public/index.html`, and `lyrics-site/public/styles.css`.

Approval: The user explicitly approved this revision in chat on 2026-10-23 with `го`, after review of TL-R119–R124 and TL-AC86–AC91 above. This approval authorizes implementation of this scope; it does not authorize commit or deployment.

Implementation evidence: `lyrics-site/public/workspace-hub.js` makes project and song cards open on click or keyboard activation, while keeping card actions independent. `lyrics-site/public/app.js` and `index.html` provide the complete online-library editor list with title filtering and shared sorting, load the complete online library in display mode, return home to the origin section, remove Start and mute shortcuts, and require a double-click for stop/reset. The display menu no longer offers `Другой проект`. `lyrics-site/public/styles.css` styles the new controls and hides `На главную` in full-screen mode.

Validation: Node syntax checks passed for `app.js` and `workspace-hub.js`; `git diff --check` passed. Automated behavior tests and manual browser acceptance checks were not run. TL-AC86–AC91 remain pending UI verification.
