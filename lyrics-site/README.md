# Timed lyrics

A portable browser application for preparing songs and assembling performance
projects with backing tracks and/or timed lyrics. The cloud library is the source
of current songs; cloud projects use those songs and resolve their latest saved
versions when opened. A selected folder stores local project snapshots. The same
public artifact runs at `/lyrics/` or an origin's root.

Card, local-copy and presentation refinements follow
[revision 26](../specs/features/timed-lyrics/revision-26.md).
The current workflow follows [revision 20](../specs/features/timed-lyrics/revision-20.md),
[revision 19](../specs/features/timed-lyrics/revision-19.md),
[revision 18](../specs/features/timed-lyrics/revision-18.md),
[revision 16](../specs/features/timed-lyrics/revision-16.md)
with [revision 17](../specs/features/timed-lyrics/revision-17.md) timeline editing
and library sorting.
Validation and publication evidence is recorded in the
[verification report](../docs/timed-lyrics-verification.md). Representative sung
recordings and a projector rehearsal remain organizer checks.

## Cloud library, projects and local copies

Sign in to use **Song library** and cloud projects. Create and edit library songs
in the cloud. In the editor, **Сохранить в облаке** updates the current song.
Create a separate copy from a library card with **Создать копию**; it uses the
lowest available `(копия N)` suffix for that title, artist and recording version
and leaves the source unchanged. Copy creation requires a confirmed, valid song.
The optional **Recording version** field describes the audio take and appears on
cards when nonempty.

Signing out hides the cloud session, clears cached private audio and drafts from
the browser, and revokes the server session. If cleanup or revocation is
interrupted, the app retries that work at startup or before the next sign-in.

Library sorting defaults to newest additions first. The dropdown also offers
oldest first and ascending/descending artist or title order. Dates refer to
original library creation; editing a song does not move its creation date.
Click a project or song card to open it; the separate **Открыть** buttons are
not needed. Other card actions such as launch, copy and delete remain available.

In **Строки таймлайна**, drag a row by its handle or use its arrows to change
occurrence order. Timestamps stay with their rows; correct any resulting timing
conflicts before confirming readiness again. The **+ ♪** button between a row's
type dropdown and clock inserts an interlude after that row. The small start
button inserts an intro or adds an interlude to an empty timeline. Suggested
starts use the previous interval, 5 seconds after a single predecessor, or zero
without a predecessor. Review and edit the suggestion; later cues are not shifted.
An interlude lasts until the next cue or song end. During timed display its active
row shows **♪ ♪ ♪** in the current-line color; notes freeze on pause and remain
static with reduced motion enabled. Interlude labels may be empty: those rows
show three notes before, during and after playback, with animation only during
an active timed interval. Ignored-timecode mode keeps nonempty text labels and
shows static notes for empty labels. **Подвинуть время** clamps shifted starts at
zero; any resulting duplicate timestamps must be corrected before readiness.

Open **Projects** to assemble a performance from the current library songs. Use
the arrows or drag songs to change project order. Saving a song edit from a project
updates that same library song, so other projects use the saved version when next
opened. **Remove from project** removes only that occurrence. Deleting a song from
the cloud library removes every occurrence from cloud projects while preserving
their other songs and order. A song's readiness stays confirmed when only its
title, artist, recording version or duration changes; timeline or backing-music
changes require confirmation again.

The top bar has a hard-drive icon for the project folder; its tooltip shows the
selected folder name. Use desktop Chrome or Edge over
HTTPS (localhost is supported for development). Local project data and backing
audio are stored under `kaada-workspace/` in that folder; the library remains
cloud-based. The app does not provide a local-library migration control or
per-song upload/update actions.

**Сохранить проект** writes cloud project and song changes and, when that project
already has a local copy, updates its local snapshot as well. Use **Сохранить
локальную копию** on a project card to create its first copy in the selected
folder. Saving shows progress on the download button while navigation remains
usable. A small green check and the tooltip **есть локальная копия** identify a
completed local copy. The configured folder is reused after reload; if browser
permission expired, the app requests access to that same folder when saving.
Cloud and local results are reported separately; failed work remains
available for retry. A local snapshot contains
the last successfully saved project and backing files. When a saved local project
is opened, playback reads its lyrics and backing audio from that snapshot without
requesting cloud audio during launch or playback. Cloud library edits appear in a
local snapshot after the project is saved again. Internet access is needed for
the normal cloud workflow; fully disconnected operation is not guaranteed.

Local project data uses immutable snapshots and commit markers so interrupted
writes can be recovered. Copy the whole `kaada-workspace` directory for a backup;
its snapshots and audio belong together. Older snapshots and audio are retained
for recovery, so storage use grows over time.

1. Create or open a cloud project. Cloud access and writes require sign-in.
2. Add songs from the cloud library or create a song in the project. Up/down
   controls change performance order.
3. Prepare the song's text, optional backing track and timing. Existing LRCLIB,
   own LRC and plain-text tabs remain available. Durations use `MM:SS`.
4. Confirm readiness. A song can contain lyrics, backing audio, or both. Configured
   missing backing audio is a playback failure with an explicit lyrics-only option.
5. Choose **Launch** to open performance mode. A selected local copy is refreshed
   when the project is saved, not by downloading assets on every launch.

Whole-project ZIP/JSON import and export controls have been removed. Existing
archives are not imported through the application; LRCLIB, LRC and plain-text
imports remain available while preparing an individual song. If a project being
deleted is already absent from the server, its browser cache and active working
folder entry are removed when the selected folder is writable. Older immutable
folder snapshots remain for recovery.

## Artwork storage

Song and project artwork accepts JPG, PNG and WebP source files up to 8 MiB.
Images are limited to 40 megapixels and 16000 pixels on either side before
decoding.
Larger images are resized to at most 1600 pixels on the longest side and encoded
as WebP until their stored size is at most 192 KiB. Small images retain their
original bytes. Local snapshots preserve artwork when reopened. Cloud JSON writes
have a combined 5 MiB limit; an oversized project is rejected before sending with
an explanation to reduce its artwork or select old covers again for compression.
Run `node tests/artwork-browser.mjs` after building to verify all three image
formats, large-source preparation, cloud persistence and fresh local reopening.

## Find an existing LRC

In the **LRCLIB** tab, use **Find LRC in LRCLIB**. The separate search fields
start with the song title and artist; editing them does not rename the song.
Enter a title and optionally an artist, then submit the search. Only these search
terms are sent to LRCLIB; recordings, existing lyrics and organizer credentials
are excluded. Search requires internet and can be cancelled.

Compare each result's artist, album and duration with your original/backing
recording. Preview the literal LRC, then choose **Import LRC**. Unsynchronized and
instrumental or malformed results show a disabled **LRC unavailable** button.
When ordinary lyrics are available, the adjacent **Insert plain text**
(`Вставить чистый текст`) button imports editable lines with empty timecodes and
replaces duration with the selected record’s positive duration. Without a usable
duration, the current duration is retained and a manual-entry notice appears.
The button is disabled when ordinary lyrics are unavailable. Replacing existing rows requires
confirmation; invalid LRC leaves the song unchanged. The original/backing audio,
delay and recording-version description are preserved. A nonblank album name
from the selected result fills the album field; an absent album keeps the
existing value. For synchronized LRC, only
blank title/artist and missing duration are filled. A differing duration remains
visible after import. Check every line and confirm readiness again; save cloud
project changes with **Save**. Prepared playback uses the saved timeline and does
not contact LRCLIB.

Network/service errors retain your work. After a rate limit, the client honors
the service's requested waiting interval; there are no automatic retry loops.
When available, HTTP codes are shown with an explanation and a suggested next
step. A service-unavailable response keeps its own explanation even when it
requests a waiting interval. If a network or browser access failure hides the
response, the notice explains that the status and exact cause are unavailable.
Manual LRC/text import does not require an LRCLIB request; saving cloud changes
requires the cloud service.
Revision 5 is published in paired release `20261012_202705`.

## Show the lyrics

Select a ready song and enter **Display mode**. Press **Start** to launch its
lyrics and selected backing track together. Without a backing track, start the
external music at the same moment. The original vocal reference is never used as
show audio. **Mute/unmute** changes sound without pausing or shifting the timeline.
Audio errors offer retry or an explicit lyrics-only launch.
Without a backing track, the crossed-speaker button remains visible and disabled;
its tooltip reads `для этой песни нет минусовки`.
While playback is running, **Start** becomes **Pause**. Press it to pause lyrics
and backing audio at the current position; press **Start** again to resume there.
This also works without backing audio. See [display pause requirements](../specs/features/timed-lyrics/revision-7.md).

With **ignore timecodes** enabled, lyrics stay at their initial position for
10 seconds, then scroll at constant spatial speed until the declared song end.
Existing cue times and the stored global lyric delay do not affect this mode.
Pause, resume, seek and reset control the same timeline with or without backing
audio. Songs lasting at most 10 seconds and single-line songs stay stationary
until the usual end state. The setting belongs to each song and survives normal
saving and portable transfer.

The bottom progress bar shows position and duration. Click/drag it to seek both
lyrics and backing audio; ArrowUp moves five seconds backward, ArrowDown five
seconds forward, also when the bar has focus. Dialogs and editable fields keep
ordinary keyboard behavior. Seeking preserves running/armed state; after the end,
seek back and press Start. Double-click **Stop and reset** to return to zero; a
single click is ignored. A shorter backing ends without truncating the lyric
timeline; a longer backing stops at the declared song end. Lyric delay affects cue
display, not audio position or duration.

The bottom row places playback, reset, fullscreen, mute, and line-emphasis icons
to the right of the timeline. Hover an icon or focus it with the keyboard for its
tooltip. C toggles current-line emphasis, F enters/exits fullscreen, and L opens
the media library. + (or =) and − change font size in four-pixel steps, within
28–100 pixels; numeric keypad +/− also work. There are no keyboard shortcuts for
Start or mute. Use their on-screen buttons; use Enter or the mouse to select a
song, or Escape to close the library. Arrow seeking remains available.

Toggle **Highlight current line** off for equal emphasis across lyric lines.
Its icon shows three equal lines when off and past/current/upcoming styles when
on. The setting survives song switches and browser reopening. Font controls and
full screen remain available. The media-library button opens an adjacent popup
for the current project's songs or all songs in the online library, depending on
where display mode was launched. Selection arms the chosen song for a fresh
Start. **На
главную** returns to Projects or Song library according to the launch source and
is hidden in fullscreen. Choose another project from the main Projects section.

In fullscreen, preparation navigation is hidden. After two seconds without
pointer hover or keyboard focus, the bottom panel fades to 30% opacity while
retaining its full size, position, and working controls. Hover anywhere in the
panel, focus a control with the keyboard, or touch the panel to restore full
opacity. These changes preserve lyric position and playback. Use F, the
fullscreen icon, or Escape to leave fullscreen. See
[compact display requirements](../specs/features/timed-lyrics/revision-10.md).
Live beat following and automatic tempo compensation remain outside this version.

For local regression checks, `pnpm test:plain` covers lyric preparation, persistence,
scrolling and playback; `pnpm test:display-controls` covers tooltip, shortcut, touch restoration,
fullscreen timer, and audio-error visibility edge cases after `pnpm build`.

For a cloud project with a selected local copy folder, use **Save** to update both
the cloud project and local snapshot. Reopen the saved project to rehearse from its
local files. Keep the laptop awake and the performance tab in front. Reload returns
to Projects.

Songs and projects accept optional rectangular cover artwork with preserved
proportions. The optional **Подпись в конце песни** field supplies a song's end
message; the project's **Подпись в конце песни для проекта** overrides it for
that project. Blank or whitespace-only values fall through to the song caption,
then to **Ваша песенка спета**. Captions are retained in cloud saves and local
copies.

## Development and validation

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm test:workspace
pnpm test:plain
pnpm test:display-controls
pnpm test:cloud-library
pnpm test:cards
backend/.venv/bin/python -m unittest discover -s backend/tests -v
pnpm serve
```

`pnpm test:cards` runs `tests/revision-26-browser.mjs` against an ephemeral API
and native browser directory handles. It covers card metadata and media icons,
nonblocking download and durable-copy indication, reload/repeated saving, direct
offline local launch, captions, empty interludes, timing clamping and tooltips.

`pnpm test:workspace` and `pnpm test:workspace:cloud` are aliases for
`pnpm test:cloud-library`, which runs `tests/cloud-library-browser.mjs`.

The preview serves identical artifacts at `/lyrics/` and `/` on port 8094.
Browser checks use installed Chrome by default (`PLAYWRIGHT_CHANNEL` can override).
Browser screenshots go to ignored `test-results/`. Server browser checks accept
`LYRICS_TEST_PYTHON` to select a Python environment with the locked API dependencies.
Recognition UI checks are deferred while its controls are hidden.
Production build copies local runtime assets from the pinned Transformers.js
package. The recognition worker downloads the model from Hugging Face. Event
assets are cached only within the application's service-worker directory scope;
model/runtime assets are deliberately excluded from the offline event shell.
Legacy IndexedDB is `kaada-lyrics-v1`; private drafts/snapshots are isolated in
`kaada-lyrics-v2`. Use `LYRICS_API_PORT=8096 pnpm serve` to proxy a local API; imported HTML-like wording is rendered as text.

Requirements: [TL baseline](../specs/features/timed-lyrics/spec.md),
[revision 3](../specs/features/timed-lyrics/revision-3.md),
[revision 4](../specs/features/timed-lyrics/revision-4.md), and
[revision 16](../specs/features/timed-lyrics/revision-16.md).
LRCLIB search requirements: [revision 5](../specs/features/timed-lyrics/revision-5.md).
Plain lyrics and uniform scrolling: [revision 8](../specs/features/timed-lyrics/revision-8.md).
Research and evidence: [research](../docs/timed-lyrics-research.md).
Release instructions: [deployment](deploy/README.md).

## Source organization

- `app.js`: application state, navigation wiring and performance lifecycle.
- `session-lifecycle.js`: startup, sign-in and logout cleanup recovery.
- `song-editor.js`: preparation forms, lyric import/search and cue editing.
- `workspace-actions.js`: cloud project saves and local snapshot selection.
- `workspace-hub.js` and `hub.css`: project/library destinations and responsive UI.
- `workspace-files.js`: ordinary-directory snapshots, audio integrity and recovery.
- `local-workspace.js`: active folder session, staged media, save status and retry.
- `cloud-transfers.js`: local project download and revision-aware cloud transfer
  helpers.
- `ui.js`: shared DOM controls. Existing playback, recognition, LRCLIB and remote
  transport modules retain their domain responsibilities.

The HTTP service remains split into API, configuration, credentials, backup and
store modules; those boundaries remain useful at the current size. New local
persistence belongs to the frontend directory adapter, not the cloud database.

Workspace browser tests use an adapter that writes to real temporary OS folders;
they verify fresh-context recovery and real API transfers without automating the
native OS folder dialog. Permission and failure paths have focused adapter tests.
