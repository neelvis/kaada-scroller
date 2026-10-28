# Revision 29 — preparation interface navigation and scrolling

Feature ID: TL (extension)  
Status: Draft — awaiting explicit approval  
Date: 2026-10-28  
Related requirements: [focused project and song editing](revision-18.md),
[project cards and song presentation](revision-26.md).

## Purpose and scope

Make project and song preparation easier to navigate by keeping the header and
section navigation available, reducing timeline clutter, and softening scrollbars.

## Proposed requirements

- **TL-R29.1 — Fixed header:** The application header stays in place while page
  content scrolls.
- **TL-R29.2 — Collapsed timeline:** In the collapsed state, keep the timeline
  settings and time-shift controls visible, but hide all lyric rows, timestamps,
  and row separators. A quiet text control with down double chevron expands the
  full list; the expanded state offers a corresponding collapse control with up
  chevron.
- **TL-R29.3 — Empty project guidance:** On the open-project empty state, explain
  that a song can be opened from the left list or added using the existing add
  song action, which supports creating a song or adding one from the library.
  Do not show a separate prominent Add song button in the empty state.
- **TL-R29.4 — Song editor navigation:** Provide a compact, static vertical
  navigation of four icon buttons below the header, aligned to the upper right
  with padding and tooltips. The information icon targets “О песне”; image
  targets project covers; text targets LRC and timeline rows; music notes target
  music. Navigation remains visible during content scrolling.
- **TL-R29.5 — Scrollbar styling:** Make scrollbars less visually prominent
  while keeping them usable and consistent with the application theme.
- **TL-R29.6 — Exit icon direction:** The sign-out control uses an arrow that
  points outward from the box, indicating exit.

## Acceptance criteria

- **TL-AC29.1:** Scroll the application and verify the header stays fixed.
- **TL-AC29.2:** Verify the collapsed state shows timeline settings and time
  shift controls without lyric rows, timestamps, or separators. Expand and verify
  all rows and timestamps appear; collapse and verify they are hidden again.
- **TL-AC29.3:** Verify the project empty state contains the requested guidance
  and that its add-song action is available through the existing list control.
- **TL-AC29.4:** Verify each of the four editor controls has an explanatory
  tooltip, targets the intended section, and stays fixed below the header.
- **TL-AC29.5:** Verify scrollbars are visually subdued and scrolling remains
  functional.
- **TL-AC29.6:** Verify the sign-out icon arrow points outward from the box.

## Approval

Approved by the user on 2026-10-28 for TL-R29.1–TL-R29.5 and
TL-AC29.1–TL-AC29.5; the user added and approved TL-R29.6 and TL-AC29.6 on
the same date.
