# Timed lyrics

A portable browser application for assembling performance projects and playing
backing tracks and/or timed lyrics. Local projects and the song library live in a
user-selected folder; the private API provides explicit cloud transfer. The same
public artifact runs at `/lyrics/` or an origin's root.

The current redesign follows [revision 14](../specs/features/timed-lyrics/revision-14.md).
Validation and publication evidence is recorded in the
[verification report](../docs/timed-lyrics-verification.md). Representative sung
recordings and a projector rehearsal remain organizer checks.

## Projects and durable local files

Open **Projects** to assemble a performance, or **Song library** to prepare reusable
songs. Both sections work without signing in. The local location label is
`На этом устройстве`; filters select all items, local items or cloud items.

For local work, use desktop Chrome or Edge over HTTPS (localhost is supported for
development). Choose a working folder with **Choose folder**. Local project JSON,
library data and audio are ordinary files under `kaada-workspace/` in that folder.
Browser storage only remembers the directory handle and retains legacy data for
explicit migration. If permission expires, reconnect the same folder; use
**Retry saving** to finish an interrupted save. Unsupported browsers explain the
restriction and retain cloud access and explicit portable transfer where available.

Local edits save automatically. Wait for **Saved** before closing the browser.
Pending and failed writes are visible; failed saves retain the draft and staged
media in the active session for retry. An unsaved draft is not guaranteed to
survive closing the browser. Immutable snapshots and last-written commit markers
preserve previous complete versions. Copy the whole `kaada-workspace` directory
for a backup; its snapshots and audio belong together. Old snapshots/audio are
retained for recovery, so storage usage grows over time.

1. Choose **Create project**, enter a name and select local or cloud storage.
   Local is the default; cloud creation requires login.
2. Choose **From library**, select several songs and add them together, or create
   a song in the project. Drag-free up/down controls change the performance order.
3. Prepare the song's text, optional backing track and timing. Existing LRCLIB,
   own LRC and plain-text tabs remain available. Durations use `MM:SS`.
4. Confirm readiness. A song can contain lyrics, backing audio, or both. Configured
   missing backing audio is a playback failure with an explicit lyrics-only option.
5. Choose **Launch** to open performance mode. Local readiness verifies the files;
   the offline-ready label additionally requires a cached application shell.

Projects keep selected song versions. Adding a library song copies its metadata
and audio identity into the project; editing or removing the library song does not
alter that pinned version. **Update from library** explicitly adopts the latest
local library version. **Save song to library** preserves a prepared project song
for reuse. Removing a project song does not delete library content.

## Cloud transfer and migration

Signing in reveals the shared cloud library and projects without uploading local
work. Choose **Upload to cloud** explicitly for a song or project; projects include
all required backing tracks. Standalone song uploads do not create a project.
Linked uploads update their existing cloud object; **Create separate copy** makes
an independent local object for a separate upload. Retry keys prevent duplicate
creation after interrupted responses. If an update response was lost, a subsequent
attempt may report a changed cloud revision; download that revision for comparison.

**Download for performance** saves project data and backing files into the selected
working folder. Downloading a newer cloud version preserves the existing local
version as a separate copy. Simultaneous local/cloud edits never silently overwrite
either side. Location and version badges describe local changes, a newer cloud
version or changes on both sides. Signing out preserves deliberate folder downloads,
while private online-only playback and browser-private drafts/caches are cleared.

Use **Migrate previous data** to copy legacy browser-local songs and downloaded
snapshots into the folder. Original browser data remains intact; repeated migration
skips completed sources. Missing backing files fail visibly and do not publish a
partially migrated snapshot. Existing cloud projects remain available.

**Import** accepts portable ZIP projects with backing files and older JSON sets;
JSON sets containing backing labels need their files relinked. Import creates a
new local project and independent library versions. **Export** creates one portable
ZIP with every linked backing file; original vocal recordings and private cloud
identifiers are excluded. Export fails rather than silently omitting a required
backing file.

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
delay, recording-version description and existing metadata are preserved. For synchronized LRC, only
blank title/artist and missing duration are filled. A differing duration remains
visible after import. Check every line and confirm readiness again; shared
projects still require explicit **Save**. Prepared offline playback uses the
saved timeline and does not contact LRCLIB.

Network/service errors retain your work. After a rate limit, the client honors
the service's requested waiting interval; there are no automatic retry loops.
When available, HTTP codes are shown with an explanation and a suggested next
step. A service-unavailable response keeps its own explanation even when it
requests a waiting interval. If a network or browser access failure hides the
response, the notice explains that the status and exact cause are unavailable.
Manual LRC/text import remains available in editable local sets without internet.
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
seek back and press Start. **Stop and reset** returns to zero. A shorter backing
ends without truncating the lyric timeline; a longer backing stops at the declared
song end. Lyric delay affects cue display, not audio position or duration.

The bottom row places playback, reset, fullscreen, mute, and line-emphasis icons
to the right of the timeline. Hover an icon or focus it with the keyboard for its
tooltip. Space starts/pauses, M toggles backing sound, C toggles current-line
emphasis, and F enters/exits fullscreen. + (or =) and − change font size in
four-pixel steps, within 28–100 pixels; numeric keypad +/− also work. Shortcuts
leave editable fields and open menus/dialogs alone. After closing the library,
Space starts/pauses even when focus remains on its trigger. Space also controls
playback on other focused display buttons; use Enter to activate that button.
L opens the song popup. Space only starts/pauses playback, regardless of focus;
it does not activate a focused control or select a song. Use Enter or the mouse
to select a song, or Escape to close the popup.
Arrow seeking remains available.

Toggle **Highlight current line** off for equal emphasis across lyric lines.
Its icon shows three equal lines when off and past/current/upcoming styles when
on. The setting survives song switches and browser reopening. Font controls and
full screen remain available. The media-library button opens an adjacent popup
for ready songs and online/prepared offline projects without leaving the display.
Selection stops the old song and awaits a fresh Start.

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

For a cloud project, save edits, then choose **Download for performance** and
select a working folder. Reopen the local project from **Projects** and rehearse
without internet. Local copies remain editable. Keep the laptop awake and the
performance tab in front. Reload returns to Projects.

## Development and validation

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm test:workspace
pnpm test:plain
pnpm test:display-controls
pnpm test:workspace:cloud
backend/.venv/bin/python -m unittest discover -s backend/tests -v
pnpm serve
```

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

Requirements: [TL baseline](../specs/features/timed-lyrics/spec.md) and
[revision 3](../specs/features/timed-lyrics/revision-3.md), extended by
[revision 4](../specs/features/timed-lyrics/revision-4.md).
LRCLIB search requirements: [revision 5](../specs/features/timed-lyrics/revision-5.md).
Plain lyrics and uniform scrolling: [revision 8](../specs/features/timed-lyrics/revision-8.md).
Research and evidence: [research](../docs/timed-lyrics-research.md).
Release instructions: [deployment](deploy/README.md).

## Source organization

- `app.js`: application state, navigation wiring and performance lifecycle.
- `song-editor.js`: preparation forms, lyric import/search and cue editing.
- `workspace-actions.js`: local/cloud user actions and migration.
- `workspace-hub.js` and `hub.css`: project/library destinations and responsive UI.
- `workspace-files.js`: ordinary-directory snapshots, audio integrity and recovery.
- `local-workspace.js`: active folder session, staged media, save status and retry.
- `cloud-transfers.js`: explicit transfers, revision baselines and project pins.
- `ui.js`: shared DOM controls. Existing playback, portable archive, recognition,
  LRCLIB and remote transport modules retain their domain responsibilities.

The HTTP service remains split into API, configuration, credentials, backup and
store modules; those boundaries remain useful at the current size. New local
persistence belongs to the frontend directory adapter, not the cloud database.

Workspace browser tests use an adapter that writes to real temporary OS folders;
they verify fresh-context recovery and real API transfers without automating the
native OS folder dialog. Permission and failure paths have focused adapter tests.
