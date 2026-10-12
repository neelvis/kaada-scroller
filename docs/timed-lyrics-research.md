# Timed lyrics: research and proposed design

Date: 2026-10-12
Status: Baseline implemented, verified and deployed. No singing accuracy benchmark.
Requirements: [TL specification](../specs/features/timed-lyrics/spec.md)

## Delivered baseline and evidence

The approved baseline is implemented in [lyrics-site](../lyrics-site/README.md).
Browser-local Whisper base q8 (Transformers.js 3.8.1, WASM, one worker) decodes the
original MP3/WAV and proposes editable transcript segments with their model times.
It does not run the research-only forced-alignment pipeline below. Supplied text
is retained until the organizer explicitly confirms replacement. Exact text can
also be pasted and tapped without a model. Recognized segments may need manual
phrase splitting/correction.

Validation on 2026-10-12: 15 focused Node tests; Chrome integration at a subpath
and a separate root origin; 25-song import/export and offline reopening; sequential
tapping/undo, review gating, audio replacement, import while recognition is running,
and source relinking isolation. Actual Russian and English synthetic speech MP3s
passed decoding and local recognition. A 40-cue multiline fixture checked the
active line's center at a simulated 450 seconds; this is not a real 10-minute
hardware trial. Screenshots used desktop browser viewports. Independent code
review identified import/audio persistence defects which were corrected.

No user songs, actual event laptop or projector were supplied. Singing accuracy,
end-to-end preparation throughput for 25 songs, TL-AC7's real 10-minute latency
measurement and projection readability remain manual evidence gaps. Do not infer
musical alignment quality or a preparation-time guarantee from speech fixtures.

The public release is staged separately from the dirty NastyEdu app checkout.
Deployment was explicitly authorized. The user completed the reviewed one-time
[host installer](../lyrics-site/deploy/README.md), which required an administrator
password. The HTTPS route is live; an actual speech MP3 and offline event launch
passed on the published artifact. Subsequent static releases are unprivileged
and independent of the existing JAR deployer.

## Original research recommendation

Build a self-contained static browser application, initially mounted at
NastyEdu's `/lyrics/`, later portable to a dedicated domain root. Use original
vocal recordings as the baseline and assume performers follow their timeline.
Prefer matching existing LRC files, then optional local audio-to-timing processing,
then one-pass tapping/correction. Keep every result reviewable.

Do not require a rehearsal recording or an uploaded backing track for the first
workflow. Existing lyrics lookup matches an identified original recording version;
when found and verified, it avoids local model installation and audio analysis.
The concert still starts manually alongside external music playback.

The central difficulty is preparing timing for the exact arrangement, not scrolling
the display. A known title and lyric text do not determine when a student sings
each line. An instrumental recording alone has no sung words to align. Someone
who knows the song can still tap line starts while listening to the instrumental.

## Materials to collect

| Material | When required | Preparation |
| --- | --- | --- |
| Exact performed lyrics | Every song | One sung phrase per line; expand every repeat; omit website boilerplate and non-sung section labels |
| Title and original version | Every song | Identify the selected original recording, not just the title; performers are assumed to follow it |
| Original recording duration | Every ready song | Include intro, pauses and outro; obtain from the selected recording or enter manually |
| Existing timed LRC | Optional fastest route | Verify intro, repeats and ending against the selected original recording |
| Original MP3/WAV with vocals | Automatic generation or listening preview | Preserve the original recording time origin; no rehearsal recording required |
| Backing track | Optional compatibility check | Still played externally; the initial workflow assumes it follows the original timeline |

The user explicitly selected original recordings as the first baseline. We
therefore treat following that version as an input assumption rather than asking
for evidence from a rehearsal. A fixed start difference can use the global delay;
a different tempo, edit or extra repeat still falls outside this assumption.
The application does not compensate for those changes. No professional vocal stem
or school recording is required. The original recording may be omitted entirely
when a matching reviewed LRC already supplies the timings and duration is known.

## Three timing routes

### Existing synchronized lyrics

[LRCLIB](https://github.com/tranxuanthang/lrclib) provides a free service/API for
finding and contributing synchronized lyrics. It is a candidate lookup source,
not a guarantee of catalog coverage or timing for a school's custom arrangement.
Importing a matching LRC avoids audio analysis. Matching by title is insufficient;
the organizer reviews the selected original recording version.

[Liricle](https://github.com/mcanam/liricle) demonstrates parsing basic/enhanced
LRC and selecting a lyric from an externally supplied time value. Basic line LRC
is enough for the proposed display. It contains line-start times, so explicit
rest cues and song duration belong in the richer local project format.

Illustrative LRC with original placeholder wording:

```text
[00:12.40]First line of our song
[00:17.80]The next line begins here
```

### Automatic draft from a vocal reference

[WhisperX](https://github.com/m-bain/whisperX) supplies word-level forced alignment.
Its [alignment source](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py)
includes English and Russian default models and expects transcript segments with
text, start and end boundaries. Its documented CPU mode can run on macOS; CUDA
acceleration requires suitable hardware. These are documented speech capabilities,
not evidence of reliable singing alignment or throughput on this laptop.

Proposed pipeline, to test before adoption:

1. Normalize a working audio copy with FFmpeg; preserve original duration and
   time origin. Keep original display text separately from normalized matching
   text. Language, punctuation and Russian spelling normalization must not alter
   what the audience sees.
2. Generate rough vocal/transcript windows and candidate word positions.
3. Match recognized words to the supplied lyric occurrences in order. Repeated
   choruses must remain distinguishable; do not align the entire song as one
   unbounded text segment or assume recognized text is authoritative.
4. Align supplied text within bounded audio windows, then map timed words back
   to their original display lines. Use the first trustworthy word for each
   line-start proposal. Preserve unaligned lines as unresolved.
5. Flag missing words, implausible starts and mapping ambiguity; preview and
   correct. No confidence score can establish that an entire song is correct.

Sustained vowels, dense instruments, reverberation, backing vocals, omitted words
and repeated phrases are expected risks; their effect on this pipeline has not
been measured. WhisperX documents difficulties with overlap and characters
outside the alignment vocabulary. Its published speed claims must not be used
as end-to-end song-processing estimates.

Optional later experiment: compare the original mix with a vocal-separated copy.
[Demucs](https://github.com/adefossez/demucs) provides music source separation.
This adds setup and processing cost and may introduce artifacts. Test it only
if the direct pipeline fails frequently; it is unnecessary for concert playback.

### One-pass manual preparation

Play the preparation reference, tap at each lyric start, then replay and correct
mistakes. This requires human effort during preparation, but the concert display
still runs automatically. [SyncSong](https://github.com/joshooaj/SyncSong)
demonstrates a browser LRC preparation workflow with audio preview and timestamp
adjustments; this research did not validate its advertised automatic-sync quality.

For 25 four-minute songs, one complete listening pass alone takes 100 minutes.
A tentative planning allowance is 2–4 hours for tapping, corrections and export,
excluding material collection. This is arithmetic plus an estimate, not a measured
benchmark. Existing LRC or good automatic drafts may reduce work. Full listening
review of 25 songs still costs roughly their combined duration.

## Design choices and earlier alternatives

The persistence and cancellation boundaries use focused automated checks and a
distinct final review; the event laptop still requires a manual rehearsal.

- **Browser application:** A self-contained `lyrics-site/` directory in NastyEdu,
  with plain JavaScript modules, HTML/CSS, its own offline worker and no dependency
  on the Kotlin/JS course bridge. Prefer minimal tooling; keep the build output
  independently deployable. Separate preparation and audience views, use local
  persistence and portable JSON export, and bundle all concert assets locally.
- **Earlier preparation-worker alternative (not shipped):** An optional local Python command/process using FFmpeg
  and the pilot-selected alignment tool. Keep it under `lyrics-site/tools/` and
  out of the public artifact. It reads a confirmed manifest, writes per-song
  results for browser import, caches models and allows retry. It is unnecessary
  for existing LRC, manual preparation or concert operation. Installation/model
  downloads require a connection before offline processing. Do not pretend that
  visiting the website can invoke a local Python program automatically.
- **Project format:** Versioned JSON with stable occurrence IDs, title, artist,
  version description, language, duration, delay, typed cues, provenance,
  processing/review state and set order. Optional reference audio is linked or
  included separately. Store source cue times once; do not bake the same offset
  repeatedly during import/export. LRC is an interchange format, not the complete
  backup of readiness, rest cues and set metadata.
- **Clock and scrolling:** Derive elapsed time from a captured monotonic start,
  then select the cue for that absolute elapsed position. Do not add a fixed
  increment every callback or scroll at a constant pixel speed. Rendering may
  skip frames, then catch up to the correct line without accumulated timer error.
  [MDN's timing documentation](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now)
  documents monotonic timing and differences during device sleep; keep the event
  laptop awake and validate on its actual browser.
- **Example delay contract:** `effectiveTime = elapsedSeconds - delayMs / 1000`.
  A positive delay postpones every cue. Before a lyric is due, show its preview;
  do not make it active early. Always show future lines so people can prepare.

Because backing playback is external, manual launch error remains. A single
operator can coordinate both starts, or agree a start cue with the audio operator.
The program cannot detect a restarted, paused or time-stretched external track.

## NastyEdu hosting and portability

Repository evidence inspected on 2026-10-12:

- [Current nginx host](../nginx/nasty-edu.online.conf) proxies the catch-all route
  to the legacy application at port 8082. The [deployment guide](deployment.md#kmp-static-hosting-switch-not-activated)
  explicitly says the KMP static hosting switch has not been activated. Do not
  make lyrics adoption depend on activating that separate migration.
- [Static site generator](../site-generator/src/main/kotlin/online/nastyedu/site/StaticSiteGenerator.kt)
  clears its output before regenerating it and copies an approved asset list.
  A hand-copied directory in generated output would disappear on the next build.
- [Release guard](../deploy/release-guard.sh) and [deploy client](../deploy/deploy.sh)
  admit/stage only the application JAR and knowledge snapshot. Adding lyrics to
  that package requires changing a separate release contract; avoid that coupling.
- Existing runtime assets use root-bound course URLs and NastyEdu storage. Do not
  reuse its runtime navigation, scripts, styles or data stores inside lyrics.
  No existing service worker registration was found in the inspected project.

Proposed directory ownership:

```text
lyrics-site/
  public/        # only public application files; relative URLs
  tools/         # optional local alignment and artifact preparation
  tests/         # standalone timing/import/storage checks
  dist/          # generated deployable artifact; never hand-maintained
```

Serve a separately versioned artifact through a dedicated `/lyrics/` nginx mount,
with an explicit `/lyrics` to `/lyrics/` redirect before the existing application
proxy. A host directory/current symlink such as `/srv/nasty-edu-lyrics/current`
allows independent activation without changing the NastyEdu JAR release contract.
On the future dedicated domain, mount that same artifact as the document root.
All app assets resolve relative to its own entry directory; use no hard-coded
hostname, root `/assets/` dependency or navigation back to NastyEdu. Prefer a
single entry page with internal view state, so no special deep-route fallback is
needed. Missing JS/CSS files must remain 404 responses, not HTML fallbacks.

If the NastyEdu static migration is later activated, add an explicit source/build
copy step and task input for the lyrics artifact. Do not edit generated output by
hand. The independent artifact is published at `https://nasty-edu.online/lyrics/`;
see [verification](timed-lyrics-verification.md) for release evidence.

Register `./sw.js` with the app's own directory scope and cache only its shell
and required bundled assets. [Service-worker registration documentation](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
explains directory scope and secure-context requirements. Keep host routes outside
that scope; version and clean only lyrics-owned caches. Show an offline-ready
state only after verifying the required cache entries. An online first visit and
HTTPS hosting (or a supported localhost test context) precede offline reopening.

Use a namespaced IndexedDB database, for example `kaada-lyrics-v1`, with app-owned
reset/migration logic. Same-origin cohosting does not provide security isolation
from the host's scripts, so do not claim it does. On relocation, data must travel
through explicit export/import: [IndexedDB uses same-origin storage](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).
The new domain starts with a separate store; the app package itself remains
portable. Ordinary NastyEdu deployments should not replace the separately mounted
lyrics release.

## School visual direction

The user supplied `0x23C0EB`, represented in CSS as `#23C0EB`, for the principal
accent and logo. Use a dark blue/graphite theme shared by preparation and audience
views, independent of NastyEdu's layout.

| Token | Color | Use |
| --- | --- | --- |
| Accent | `#23C0EB` | Current lyric, primary actions, focus, monochrome logo |
| Accent hover | `#5BD3F1` | Hover/pressed feedback for primary actions |
| Background | `#071A24` | Main canvas and audience screen |
| Surface | `#102B38` | Preparation panels and dialogs |
| Primary text | `#F2FAFD` | Main text and labels |
| Upcoming text | `#C9DEE8` | Readable upcoming lyric lines |
| Muted text | `#A5BFCC` | Previous lines and secondary metadata |
| Decorative border | `#285062` | Panel separators; not a sole focus indicator |
| Error text | `#FFB4AB` | Error labels with an explicit icon/message |

Primary buttons have dark `#071A24` text on cyan, not white text. Locally
calculated contrast ratios: accent/background and dark-text/accent 8.30:1;
primary-text/background 16.81:1; upcoming/background 12.77:1; muted/surface 7.67:1.
These are color calculations, not rendered interface or projector verification.
Active lyrics also use weight and stable position. Keep future lines readable;
avoid ornamental animation, gradients behind lyrics and color-only state cues.

The school name and official logo asset have not been provided. The accent choice
is settled; a neutral title is sufficient for an initial prototype. Do not invent
an official school logo. A provided monochrome logo can adopt the accent color.

## Ordered delivery and evidence

1. **Representative pilot:** After approving scope, obtain five varied recordings:
   clear original Russian vocals, dense original Russian mix, repeated chorus,
   instrumental gap, and English vocals if relevant. In an isolated research folder, compare an
   automatic draft with manually marked line starts. Bound the first experiment
   to one working day. Record model/setup time separately, processing time per
   audio minute, lines within 0.7 seconds, unresolved lines and correction minutes.
   An illustrative go/no-go target is at least 80% usable automatic starts and
   median corrections under half the song duration. Revise engine/design if the
   pilot fails; retain import/tapping as a complete preparation route.
2. **Viewer and import:** Expected ownership under `lyrics-site/public/` modules
   for timeline, import and audience display. Implement cue selection, validation,
   delay and full-screen display (TL-R7–R8, R11–R13). Check malformed LRC,
   repeated timestamp expansion,
   rests, boundaries, delay sign and irregular cue schedules.
3. **Preparation and portable sets:** Expected preparation, library and storage
   modules under `lyrics-site/public/`. Implement tapping, corrections, readiness
   and 25-song persistence (TL-R1–R3, R5–R6, R9–R10, R14–R15). Verify round-trip preservation,
   readiness invalidation, ambiguous file pairing and recovery from one failure.
4. **Automatic preparation:** Expected `lyrics-site/tools/` and a versioned
   interchange contract. Integrate the pilot-selected pipeline (TL-R4–R5, R9).
   Check that supplied text survives, failures remain editable, jobs resume/retry,
   and no stage overwrites manual corrections implicitly.
5. **Portable hosting and event rehearsal:** Check the artifact at `/lyrics/`
   and at a separate test origin's root, storage/cache coexistence and export/import
   across origins (TL-R16–R18). Run the target set offline on the actual laptop and
   projector, checking timings against the selected original recordings. Measure
   timer behavior separately from musical sync and manual-start error. Document preparation, offline launch,
   backup import and input limitations in the user guide after verification.

The ordered delivery list records the original proposal; the delivered baseline
and validation above supersede its worker assumptions. Browser inference and the
portable artifact have been verified, while representative singing and event
hardware measurements remain open.
Timeline editing and the viewer can remain useful even if automatic processing
needs a different engine, but a changed product promise needs spec review.

## Later synchronization with live musicians

A drummer's count-in could provide a start cue and rough initial tempo. It cannot
identify which verse is being played, a skipped chorus, or a five-minute solo.
Beat tracking alone also cannot map lyric occurrences to changing song structure.
This is a design inference, not an evaluated synchronization feature.

The simplest future improvement is an operator's pause/resume or next-line cue,
possibly via a pedal. Following arbitrary live singing would require microphone
input, noise handling, online matching against expected lyrics, repeat disambiguation,
latency management and recovery when recognition is wrong. Keep that as a separate
feature specification after the fixed timeline has been used at a real event.
