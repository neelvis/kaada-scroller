# Timed lyrics

A portable browser application for preparing small music-school set lists and
showing lyrics after a manual Start, with optional synchronized backing audio. Initial
mount: `https://nasty-edu.online/lyrics/`. The same public artifact also runs at a
separate origin's root. Revision 3 is live as paired release `20261012_025323`, with a
private server API and projects. Publication evidence is recorded in the
[verification report](../docs/timed-lyrics-verification.md). Representative sung
recordings and a projector rehearsal remain organizer checks.
Revision 4 added backing audio and live display controls, published as paired
release `20261012_080618`. Revision 5 added LRCLIB search in paired release `20261012_202705`. Revision 6
adds the preparation redesign and portable backing archives; paired release
`20261013_193539` is now live after local and production checks.

## Prepare and save songs

1. Open the site in desktop Chrome or Edge with internet. Choose **Log in** with
   the shared organizer password, then **Projects → Create project**.
2. Choose **+ New song** in the sidebar; enter a title, optional artist,
   recording version and duration in `MM:SS`. Language and global delay fields
   are hidden; previously saved values remain intact. Projects require login.
3. Choose one of the upper preparation tabs: **LRCLIB** (initially selected),
   **Own LRC**, or **Own text** (`Свой текст`). Import line-timed LRC or paste lyrics, including
   every performed chorus occurrence as a separate line. Tab changes preserve
   import drafts; the editable timeline remains available below every tab.
   The original recording and recognition controls are temporarily hidden.
   Previously linked originals remain available for listening and manual tapping
   with **Mark next** (Space outside an input). Stored original audio is preserved
   by ordinary local/server saves, but is excluded from portable exports.
4. Optionally select/preview a separate **Backing track** MP3/WAV. Bounds are
   150 MiB and 20 minutes per file, with a configurable 1 GiB private library quota.
   Check the arrangement and start against the timeline; replacing or removing
   backing audio requires renewed readiness confirmation.
5. Confirm duration and every cue, or enable **ignore timecodes** above the
   timeline rows for uniform scrolling without line timing. This keeps stored
   times but bypasses their validation. Changing the mode requires renewed
   readiness confirmation. Choose **Confirm readiness**, then **Save**.
   Server saving remains explicit. Failed saves retain drafts; conflicts preserve
   the other organizer's saved version.
6. Repeat for up to 25 songs. **+ From library** is below **+ New song** and requires
   an authenticated online project. **Update version** replaces the selected song
   with the latest library text, timings and audio links in this project only;
   other projects keep their pinned versions. Confirm the replacement and Save.
   Removing a song or deleting a project retains the shared library.
7. Export a portable ZIP containing `set.json` and every linked backing track.
   Each JSON song has a `backingTrack` relative archive path or `null`. Original
   vocal audio and private server references are excluded. Unavailable linked
   backing audio fails export visibly. Import restores the local set and backing
   audio together without relinking; invalid archives or storage failures preserve
   the previous set. Legacy JSON-only imports remain supported and require audio
   relinking. Imported sets do not silently update a server project. Use
   **Projects → Transfer local set** for explicit transfer, with optional audio
   upload; successful transfers can be retried without duplication.

Recognition quality remains unproven on representative singing and its controls
are hidden in this redesign. Manual review remains necessary for imported timelines.
Revision 6 is verified locally and deployed as paired release `20261013_193539`.

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
L opens the library popup. While that popup is open, Space does nothing: it cannot
select/restart a song or pause/resume playback. Use Enter or the mouse to select
a song, or Escape to close the popup.
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

For local regression checks, `pnpm test:display` covers display/playback navigation
and layout; `pnpm test:display-controls` covers tooltip, shortcut, touch restoration,
fullscreen timer, and audio-error visibility edge cases after `pnpm build`.

For a server project, save and confirm all songs, then choose **Save locally** in the sidebar.
This stores an immutable timeline snapshot, every linked backing track and viewer
files. A failed download cannot report successful preparation. Reopen through
**Local projects → Open offline** on the same laptop and verify Start without internet.
Snapshots are read-only and require neither original references nor a model.
Session/project discovery times out after five seconds on a stalled connection
so prepared projects remain accessible. Recognition downloads are outside this
event guarantee. Keep the laptop awake and the audience tab in front. Reload
returns to preparation.

**Log out** clears private v2 drafts, downloaded references and prepared projects
on that browser. It preserves old local sets. An offline snapshot also offers
**Clear downloaded project**. Browser storage can be removed by the browser/user;
server copies and exported backups remain separate.

## Development and validation

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm test:browser
pnpm test:redesign
pnpm test:display
pnpm test:server
pnpm test:lrclib
pnpm test:lrclib:server
backend/.venv/bin/python -m unittest discover -s backend/tests -v
node tests/server-browser.mjs
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
