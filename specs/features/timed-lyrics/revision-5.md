# Timed lyrics revision 5: LRCLIB search

Feature ID: TL (extension)
Status: Implemented and locally verified — production publication pending
Revision: 5, 2026-10-12
Baseline: [specification](spec.md), [revision 3](revision-3.md) and
[revision 4](revision-4.md)

## Purpose and scope

Let an organizer find an existing line-timed LRC on LRCLIB and import it into the
song being prepared, without downloading a file or transcribing timestamps.
The user requested integration with <https://lrclib.net/docs>.

This extends preparation-time LRC import. It does not introduce automatic song
recognition, automatic best-match selection, lyric publishing, word-level karaoke
or bulk lookup. All existing readiness, private persistence, version-pinning and
offline event requirements remain applicable.

## Requirements

- **TL-R41 — Explicit search:** In the text/timestamps preparation tab, offer
  an LRCLIB search with editable song title and optional artist, initially filled
  from the selected song. Require a nonempty title and search only on explicit
  submission. Search fields do not edit the song itself. Show loading, empty,
  failure and retry states. The organizer may cancel a pending search.
- **TL-R42 — Version selection:** Show returned tracks with title, artist,
  album, duration and whether line-timed LRC is available. Allow reviewing
  the selected LRC as literal text before import. Records without synchronized
  lyrics, including instrumentals, cannot be imported as timed lyrics. Never
  silently select or apply a match; explain that the recording version must be
  checked against the organizer's original/backing track.
- **TL-R43 — Safe import:** Import the explicitly selected synchronized lyrics
  through the existing LRC parsing and validation rules. Preserve wording and
  repeated occurrences. Confirm replacement when the song already has cues;
  cancelling leaves the song unchanged. A malformed or empty LRC changes nothing
  and reports an actionable error. Imported timelines always require renewed
  review. Preserve existing song metadata, delay, original audio and backing
  audio and recording-version description; fill only missing title, artist and
  duration from the selected record when available. LRCLIB album metadata does
  not establish the recording version and must not populate that field.
  Missing text means trimmed-empty; missing duration means zero or absent.
  A duration mismatch must remain visible
  through the displayed result and existing timeline validation. Import enters
  the normal editable draft and uses existing local saving or explicit server
  Save; it never silently updates other projects' pinned versions.
- **TL-R44 — Request and workspace safety:** A late response or pending import
  must not alter a different song/project, a logged-out workspace or newer edits.
  Changing the search invalidates obsolete results. Keep existing song data on
  cancellation, timeout, network errors, invalid responses and service failures.
  Identify the client as required by LRCLIB, avoid overlapping/rapid requests,
  and respect a service-specified retry interval without automatic retry loops.
- **TL-R45 — Privacy and offline independence:** Search is optional and online.
  Explain that the entered title/artist are sent to LRCLIB. Send no song audio,
  private organizer credentials, complete project or existing lyric text.
  Offline search reports its unavailability; manual import and prepared event
  playback remain independent of LRCLIB. Imported lyrics and timings survive
  normal save/reopen, portable export/import and prepared offline snapshots.

## Acceptance criteria

- **TL-AC32 (R41–R42):** Search with Cyrillic and Latin titles, with and without
  an artist. Verify encoded parameters, explicit submission, no empty requests,
  loading/cancel/retry, distinct album/duration variants, LRC preview, no results,
  and disabled import for unsynchronized/instrumental records. Nothing is applied
  just by searching or selecting a result.
- **TL-AC33 (R43):** Import a fixture containing repeated timestamps, Cyrillic,
  Latin and HTML-like text. Confirm exact cue occurrences and literal rendering,
  review invalidation, preservation of existing metadata/audio/delay, and filling
  missing metadata only. Decline replacement and import malformed/empty LRC;
  verify the complete prior song remains unchanged in each failure path.
- **TL-AC34 (R44–R45):** Simulate a slow request, cancellation, timeout, offline
  network, malformed response, HTTP errors and rate limiting with a non-JSON
  response. Switch songs/projects, change query, edit cues and log out while a
  request/import is pending. Obsolete operations cannot apply, prior data remains
  intact, and retry does not bypass the service interval. Inspect requests for
  client identification and absence of private data/audio.
- **TL-AC35 (R43–R45):** Save/reopen an imported timeline locally and in a shared
  project, export/import it, and prepare/open it offline. Verify the text and
  timings survive, server Save remains explicit, another project's pinned
  timeline is unchanged, and offline Start makes no LRCLIB request. Check search
  layout and keyboard operation at desktop and narrow widths, at `/lyrics/` and
  `/`.

## Sources and approval

API source: [LRCLIB documentation](https://lrclib.net/docs), inspected on
2026-10-12. Use its search endpoint and synchronized LRC field; browser requests
are supported. Endpoint details belong to the implementation, not a new server
data model.

Repository evidence: `lyrics-site/public/app.js` currently provides
`renderImportCard`, `replaceCues` and `confirmReplace`;
`lyrics-site/public/core.js` provides `parseLrc` and timeline validation.
The existing song version/duration fields and revision-3 draft/save behavior are
the integration boundaries.

Approved by the user with “Ага, го” on 2026-10-12 after reviewing this draft.
Approved draft SHA-256: `c1675037ef29de6d3f0d9b842f3d32b5d910c7280374f631e5597cfc6854e0ec`.
The user separately authorized commit and deployment on 2026-10-12.

## Verification

TL-AC32–TL-AC35 are covered by focused helper tests and local/shared browser
scenarios. Live browser search, responsive layout and offline notices were also
checked. See [revision 5 verification](../../../docs/timed-lyrics-verification.md#revision-5-lrclib-search).
The organizer must still check that each chosen recording matches the timeline.
