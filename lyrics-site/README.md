# Timed lyrics

A portable browser application for preparing small music-school set lists and
showing lyrics after a manual Start, with optional synchronized backing audio. Initial
mount: `https://nasty-edu.online/lyrics/`. The same public artifact also runs at a
separate origin's root. Revision 3 is live as paired release `20261012_025323`, with a
private server API and projects. Publication evidence is recorded in the
[verification report](../docs/timed-lyrics-verification.md). Representative sung
recordings and a projector rehearsal remain organizer checks.
Revision 4 adds backing audio and live display controls in this repository; it
is live as paired release `20261012_080618` after local and production checks.

## Prepare and save songs

1. Open the site in desktop Chrome or Edge with internet. Choose **Log in** with
   the shared organizer password, then **Projects → Create project**.
2. Add a song; enter title, language and original recording version. Choose the
   original vocal MP3 or WAV. The private server stores the reference, while
   recognition runs in the organizer's browser. Bounds: 150 MiB and 20 minutes per
   reference, with a configurable 1 GiB total library allowance.
3. Paste the correct lyrics and choose **Insert lines**. Include every chorus
   occurrence in performance order. Choose **Calculate timing from text**.
   The default quality profile uses pinned Whisper small word timestamps; the
   alternative fast profile uses pinned Whisper base. The first run downloads
   model files; processing time and memory depend on the laptop.
4. Supplied words, spelling and punctuation remain exact. Proposed starts require
   acoustic word evidence; uncertain lines stay blank. Listen to the reference,
   correct starts or tap **Mark next** (Space outside an input). Use a rest cue for
   instrumental sections. LRC import and MP3-only draft recognition remain available.
   **Text and timestamps** is the default preparation tab; **Original recording**
   contains reference selection and recognition. Tab changes preserve entered
   text and preview position. The original listening control stays available for
   tapping from the text tab.
   Optionally use the separate **Backing track** section to select/preview an
   instrumental MP3/WAV. It uses the same limits and private library quota as the
   original. Check its arrangement and start against the timeline; replacing or
   removing it requires renewed readiness confirmation.
5. Confirm the full duration and each line, choose **Confirm readiness**, then
   **Save**. A server save is explicit. Failed saves retain the local draft;
   conflicts preserve the other organizer's saved version. Reopen the project to
   choose the server version or retained draft and compare before retrying.
6. Repeat for up to 25 songs. Use the library to reuse saved references; each
   project keeps its selected timeline version until **Update version** is chosen.
   Removing a song or deleting a project retains the shared song library.
7. Export JSON for a portable lyrics/timeline backup (audio is excluded). Import
   opens a separate local set and requires explicit server transfer. Existing
   browser sets are never uploaded automatically: **Projects → Transfer local
   set** with optional original-reference upload. Successful transfer can be
   retried without duplicate songs or audio; legacy originals remain untouched.

Recognition proposes a draft. Synthetic speech integration checks passed for both
profiles, but improved accuracy or 25-song throughput on actual singing has not
been measured. Manual review remains necessary.

## Find an existing LRC

In **Text and timestamps**, use **Find LRC in LRCLIB**. The separate search fields
start with the song title and artist; editing them does not rename the song.
Enter a title and optionally an artist, then submit the search. Only these search
terms are sent to LRCLIB; recordings, existing lyrics and organizer credentials
are excluded. Search requires internet and can be cancelled.

Compare each result's artist, album and duration with your original/backing
recording. Preview the literal LRC, then choose **Import LRC**. Unsynchronized and
instrumental results cannot be imported. Replacing existing rows requires
confirmation; invalid LRC leaves the song unchanged. The original/backing audio,
delay, recording-version description and existing metadata are preserved. Only
blank title/artist and missing duration are filled. A differing duration remains
visible after import. Check every line and confirm readiness again; shared
projects still require explicit **Save**. Prepared offline playback uses the
saved timeline and does not contact LRCLIB.

Network/service errors retain your work. After a rate limit, the client honors
the service's requested waiting interval; there are no automatic retry loops.
Manual LRC/text import remains available in editable local sets without internet.
Revision 5 is implemented locally; the production release described above still
contains revision 4.

## Show the lyrics

Select a ready song and enter **Display mode**. Press **Start** to launch its
lyrics and selected backing track together. Without a backing track, start the
external music at the same moment. The original vocal reference is never used as
show audio. **Mute/unmute** changes sound without pausing or shifting the timeline.
Audio errors offer retry or an explicit lyrics-only launch.

The bottom progress bar shows position and duration. Click/drag it to seek both
lyrics and backing audio; ArrowUp moves five seconds backward, ArrowDown five
seconds forward, also when the bar has focus. Dialogs and editable fields keep
ordinary keyboard behavior. Seeking preserves running/armed state; after the end,
seek back and press Start. **Stop and reset** returns to zero. A shorter backing
ends without truncating the lyric timeline; a longer backing stops at the declared
song end. Lyric delay affects cue display, not audio position or duration.

Clear **Highlight current line** for live performance: the text keeps advancing
with equal emphasis across lyric lines. The setting survives song switches and
browser reopening. Font controls and full screen remain available. The hamburger
menu selects ready songs and online/prepared offline projects without leaving the
display. Selection stops the old song and awaits a fresh Start. Live beat following
and automatic tempo compensation remain outside this version.

For a server project, save and confirm all songs, then choose **Prepare show**.
This stores an immutable timeline snapshot, every linked backing track and viewer
files. A failed download cannot report successful preparation. Reopen through
**Projects → Open offline** on the same laptop and verify Start without internet.
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
pnpm test:display
pnpm test:server
pnpm test:lrclib
pnpm test:lrclib:server
backend/.venv/bin/python -m unittest discover -s backend/tests -v
node tests/server-browser.mjs
node tests/recognition-profile-browser.mjs
pnpm serve
```

The preview serves identical artifacts at `/lyrics/` and `/` on port 8094.
Browser checks use installed Chrome by default (`PLAYWRIGHT_CHANNEL` can override).
Set `LYRICS_ASR_FIXTURE` to an actual MP3 path to include the recognition/download
failure/retry integration check. Browser screenshots go to ignored `test-results/`.
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
Research and evidence: [research](../docs/timed-lyrics-research.md).
Release instructions: [deployment](deploy/README.md).
