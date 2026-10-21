# Timed lyrics revision 17: cue ordering, interludes and library sorting

Feature ID: TL (extension)
Status: Implemented and locally verified — publication pending
Revision: 17, 2026-10-21
Baseline: [Specification](spec.md), [preparation refinements](revision-11.md),
[cue shifting](revision-15.md), and [cloud library](revision-16.md).

## Purpose and scope

Let organizers reorder lyric occurrences and instrumental passages in the song
editor, show animated notes during timed instrumental passages, and find library
songs using explicit date, artist and title sorting. Preserve cloud saving,
readiness confirmation, project membership and project song order.

This revision extends TL-R6–R8 and TL-R89. It does not add audio detection,
automatic retiming of surrounding lyrics, word-level karaoke, a new LRC dialect,
or sorting of songs inside projects.

## Requirements

- **TL-R94 — Reorder timeline rows:** Allow moving any lyric or rest row to
  another position by dragging a visible handle and by adjacent up/down buttons,
  following the existing project-song arrow controls. Indicate the drop position.
  Disable moves beyond the first/last row. Buttons work with keyboard input;
  controls remain usable at narrow widths. A move preserves each occurrence's
  identity, text, type and timestamp, and changes only the list order. Do not
  silently sort rows back by time or retime them. Existing validation identifies
  conflicting timestamps and prevents readiness until corrected. A real move
  invalidates readiness; cancellation or a move to the same position does not.
- **TL-R95 — Insert and edit interludes:** Put a `+ ♪` button in each cue row
  between the type dropdown and the clock/time-mark button. It inserts an
  interlude immediately after that row. Provide a compact `+ ♪` start action
  before the first row (also available for an empty timeline); keep drag/drop
  insertion boundaries between rows without duplicate inter-row buttons or a
  toolbar interlude button. A new interlude uses the existing rest-cue semantics and the
  default editable label `Проигрыш`. It can be moved with the same drag handle
  and arrows as lyrics, edited and deleted. It has an editable start time and
  lasts until the next cue, or the declared song end if it is last. Preserve
  existing rest labels. Insertion, removal, type, label and timing changes
  invalidate readiness and remain unsaved drafts until the existing save gate
  succeeds. Cloud/project saves, local copies and native portable import/export
  preserve rest cues and their order.
- **TL-R96 — Suggested interlude start:** At insertion, offer an approximate
  editable start based on the rows before the insertion position. With two
  immediately preceding rows having finite nonnegative increasing starts,
  suggest the latest start plus the interval between those starts. With only
  one usable immediately preceding start, suggest that start plus 5 seconds.
  With no usable immediately preceding start, including an empty timeline or
  insertion at the beginning, suggest zero. Mark the value as an estimate for
  review. Do not invent missing times for other rows, shift surrounding cues,
  or recalculate an existing interlude merely because it is moved. If the
  suggestion conflicts with the next cue or song duration, show the ordinary
  actionable timing error and require correction before readiness.
- **TL-R97 — Notes during instrumental playback:** While a rest cue is active
  in timed display mode, show three animated notes separated by spaces (`♪ ♪ ♪`)
  in its row using the current
  lyric's highlight color (`--accent`) and emphasis. Keep surrounding lyrics
  readable; do not highlight an adjacent lyric as though it were being sung.
  Nonactive rest rows retain a readable interlude label. Start/seek/resume into
  an interlude activates its notes immediately; pause freezes their animation;
  leaving the cue or reaching the song end ends that animation. Provide an
  accessible interlude label and static notes when reduced motion is requested.
  Preserve existing delay, seeking, pause and end behavior. Untimed scrolling
  keeps its existing behavior and shows rest labels without inventing timed
  instrumental intervals.
- **TL-R98 — Library sort selector:** Add a labeled dropdown in the song
  library with these options, in this order: `по дате (ранние)`,
  `по дате (поздние)`, `по исполнителю (А-Я)`, `по исполнителю (Я-А)`,
  `по названию (А-Я)`, `по названию (Я-А)`. Default to `по дате (поздние)`
  on a fresh application session. Retain the selection during search, refresh,
  editing and navigation within the session. Apply it to the full library and
  filtered results without changing project song order or song content/readiness.
- **TL-R99 — Stable library ordering:** Date means the original cloud-library
  creation date, including for existing songs, rather than last edit or project
  insertion. A saved copy has its own creation date. Use locale-aware text
  comparison suitable for Cyrillic and Latin metadata, ignoring case and outer
  whitespace for sorting only. Place songs without an artist after named artists
  in either artist direction. Break equal artists by ascending title, then equal
  sort keys by newest creation date and a stable song identity. Date ties also
  use stable identity. Editing a song does not reset its creation date.

## Acceptance criteria

- **TL-AC72 (R94):** Move first, middle and last rows using drag/drop and arrows,
  including repeated lyric text and rest rows. Verify exact occurrence identity,
  text, type and timestamps are preserved and order survives save/reopen.
  Check disabled boundary buttons, canceled/same-position drops, keyboard input,
  visible drop targeting and narrow layouts. A real reorder resets readiness;
  resulting nonincreasing times are reported instead of silently repaired.
- **TL-AC73 (R95–R96):** Insert an interlude into an empty song, before its first
  row, between rows and at the end. For preceding starts 10 and 14 seconds,
  verify an 18-second suggestion; for one preceding 10-second start, verify 15;
  without a usable predecessor, verify zero. Edit the estimate, move and delete
  the interlude. Check invalid/missing predecessors and suggestions at/beyond
  the next cue or duration. Preserve neighboring times and require valid timing
  plus renewed confirmation before saving. Reopen cloud data, a refreshed local
  project copy and a native portable round trip with interludes intact.
- **TL-AC74 (R97):** Play an intro rest, a middle interlude and a final rest.
  Verify notes use the active-line color, stop at cue/end boundaries, freeze on
  pause and follow seeking/resume. Check surrounding text, configured delay,
  highlight settings, reduced motion, accessible labels and unchanged untimed
  scrolling. Existing songs with rest cues work without migration by the user.
- **TL-AC75 (R98–R99):** Verify all six dropdown choices using older/newer songs,
  Cyrillic/Latin titles/artists, absent artists, case variants and equal keys.
  A fresh session defaults to newest first. Search and refresh retain the
  selection; edit/save does not change original creation dates; a new copy has
  its own date. Existing songs use their stored creation dates. Verify project
  order, song readiness and metadata remain unchanged.

## Evidence and proposed decisions

The user requested these additions on 2026-10-21. The current editor
(`lyrics-site/public/song-editor.js`, `renderCues`) supports rest types and
manual times but lacks row reordering and explicit interlude insertion.
`lyrics-site/public/app.js` has project-song arrows and renders rest cues as
text. `lyrics-site/public/core.js` enforces strictly increasing starts.
`lyrics-site/backend/store.py` already stores the original `songs.created_at`;
the library UI is in `lyrics-site/public/workspace-hub.js`.

Proposed decisions requiring approval with this draft: moving rows preserves
their timestamps; interlude estimates use the preceding interval, a 5-second
single-predecessor fallback, or zero; estimates never silently shift later
lyrics. Interludes use the existing rest cue with a start and next-cue/end
boundary. No material decision remains hidden in implementation.

Approval: the user explicitly replied `Подтверждаю` after reviewing this draft
on 2026-10-21. Reviewed draft SHA-256:
`97ee7f1e92c6a503b542c6b0817086107b0185b12c910f865fe33c530c4cbc07`.
Implementation of TL-R94–R99 and TL-AC72–AC75 is authorized. Commits, push and
deployment are not authorized by this approval.

Follow-up authorization: on 2026-10-22 the user explicitly requested completion,
commit, push and deployment, with the row-level `+ ♪` insertion button and three
space-separated display notes. TL-R95 and TL-R97 above incorporate those concrete
requested refinements. The other approved behavior is unchanged.

## Delivery evidence

Implemented and verified locally on 2026-10-22. All 110 frontend unit tests and
24 API tests pass. The real authenticated API/Chrome suite
`tests/cue-interludes-browser.mjs` covers TL-AC72–AC75, including focused edits
immediately followed by arrows, native drag or insertion; exact occurrence
preservation; no-op drops; cloud/local-copy saves; all six sort orders; original
creation dates; three-note display, pause/seek/end, delay, reduced motion and
untimed labels; and 320/375/1120/1360px layouts. Portable rest preservation is
covered by cue/core and existing portable round-trip tests. Independent source
review has no unresolved material findings. Publication and regressions are
recorded in the [verification report](../../../docs/timed-lyrics-verification.md).
Native OS folder selection and physical projector rehearsal remain manual checks.
