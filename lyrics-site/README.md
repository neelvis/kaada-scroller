# Timed lyrics

A portable browser application for preparing small music-school set lists and
showing lyrics after a manual Start alongside separately played music. Initial
mount: `https://nasty-edu.online/lyrics/`. The same public artifact also runs at a
separate origin's root. Revision 3 is live as paired release `20261012_025323`, with a
private server API and projects. Publication evidence is recorded in the
[verification report](../docs/timed-lyrics-verification.md). Representative sung
recordings and a projector rehearsal remain organizer checks.

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

## Show the lyrics

Select a ready song, enter **Display mode**, then press **Start** at the same
moment the separate original-timeline music starts. The current phrase remains
centered while the lyrics move automatically. Use font controls and full screen
for projection. **Stop and reset** returns to the armed beginning. Live pause,
beat following and adjustments for improvised solos are outside this version.

For a server project, save and confirm all songs, then choose **Prepare show**.
This stores a selected immutable timeline snapshot plus viewer files. Reopen it
through **Projects → Open offline** on the same laptop and verify Start without
internet. Offline snapshots are read-only and require neither reference audio
nor a model. Recognition downloads are outside this event guarantee. Keep the
laptop awake and the audience tab in front. Reload returns to preparation.

**Log out** clears private v2 drafts, downloaded references and prepared projects
on that browser. It preserves old local sets. An offline snapshot also offers
**Clear downloaded project**. Browser storage can be removed by the browser/user;
server copies and exported backups remain separate.

## Development and validation

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm test:browser
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
[accepted revision 3](../specs/features/timed-lyrics/revision-3.md).
Research and evidence: [research](../docs/timed-lyrics-research.md).
Release instructions: [deployment](deploy/README.md).
