# Timed lyrics verification

Date: 2026-10-12 (Europe/Moscow)
Scope: new `lyrics-site/`, TL spec and feature documentation only. Existing dirty
NastyEdu course, piano, KMP and deployment changes were preserved. No commit.

## Automated and browser evidence

- `pnpm build`: standalone public artifact with relative assets and bundled
  Transformers.js 3.8.1 runtime; the same output runs at `/lyrics/` and `/`.
- `pnpm test`: 15 passing focused tests for LRC occurrence expansion, offset and
  malformed input, timing/delay/end, 25-song round trips, literal-safe structure,
  unique IDs, local database boundaries, recognition result conversion and scoped
  app assets/cache behavior.
- `LYRICS_ASR_FIXTURE=.../russian.mp3 pnpm test:browser`: installed desktop Chrome,
  1920×1080. Checks import/export/reload of 25 songs; manual launch, duplicate
  start, render-stall recovery, rest/end/reset; original audio preview and source
  replacement; sequential tapping/undo/repeated choruses and readiness gating;
  audio-excluded set imports; cancellation by importing during recognition;
  actual MP3 recognition; no external
  recording uploads; root/subpath portability and offline reopening; preservation
  of unrelated localStorage and IndexedDB markers.
- A 40-cue multiline timeline at simulated 450 seconds verifies active-line
  centering/visibility. This is clock/geometry evidence, not a real 10-minute trial.
- Separate synthetic English and Russian speech MP3s passed the real Web Worker
  pipeline. Their words/timestamps are editable; these are not singing benchmarks.
- `python3 -m py_compile deploy/install-host.py deploy/activate-release.py`:
  syntax check passed. `node tools/stage.mjs`: default missing-parent creation,
  immutable staging and checksum-manifest layout passed. Privileged host activation
  has not been executed because the administrator password is unavailable.

Screenshots and synthetic fixtures are retained under ignored local work/test
folders. They are absent from the public artifact.

## Independent review

A distinct read-only reviewer examined the stable feature, persistence/import,
recognition guards, offline scope and deployment helpers. Corrected issues:

1. Import could reuse an old recording with a colliding portable song ID. Import
   now replaces set data and clears recording links in one database transaction.
2. Recognition could enqueue an old-set write during import. Import now aborts
   outstanding jobs before awaiting pending saves; result commits check cancellation.
3. Concurrent imports could race. A guarded import disables preparation and
   header controls until completion.
4. Default staging lacked parent creation. Paths are now script-relative and
   missing parents are created without overwriting an existing staged release.
5. Later activation could omit required inference files. Both activation paths
   validate the same explicit app/WASM runtime set.

Bounded rereview confirmed all findings resolved. No remaining material finding
was reported in the inspected scope. The installer was executed on the real host, including rollback/retry recovery.

## Acceptance coverage and manual gaps

| Criteria | Evidence / remaining work |
| --- | --- |
| TL-AC1, AC3–AC6 | Focused import/validation/timing tests and editor/set browser flows; organizer checks exact wording and arrangements |
| TL-AC2 | Sequential tapping, undo, retapping controls; one-pass workflow still needs an actual sung recording |
| TL-AC7 | Absolute monotonic clock and stall recovery exercised; real 10-minute target-laptop <=250 ms measurement pending |
| TL-AC8, AC13 | Desktop screenshots, long-line geometry and school palette; actual projector/font-size acceptance pending |
| TL-AC9, AC11 | Subpath/root origins, export/import and offline reload/start passed |
| TL-AC10 | No supplied songs; 95% within 0.7 s is a preparation target, not measured recognition accuracy |
| TL-AC12 | Literal DOM text, namespaced data/cache and unrelated storage markers preserved; production root and health routes returned 200 |
| TL-AC14 | Actual MP3, editable timestamps, failed download/retry and cancellation/import tested; representative singing quality remains open |

## Production publication and external-download evidence

User authorized activation and ran the one-time administrator command. Release
`20261011_220243` is live at `https://nasty-edu.online/lyrics/`.
Nginx backup: `/etc/nginx/sites-available/nasty-edu.online.before-lyrics-1791756528`.
The first immediate health request reached an old worker during graceful reload;
rollback restored the original host. The corrected installer retries health for
30 seconds and can safely reuse an identical verified release. User retry mounted
successfully. Symlinked existing release paths are refused. A distinct rereview
confirmed the installer correction.

Remote manifest matched 18 public files (22,610,871 bytes). HTTPS `/lyrics/` and
`/lyrics` redirect passed; JS/MJS and WASM use correct MIME. Live shell hashes
matched the reviewed artifact. Main `/` and `/health` both returned 200.
An isolated live Chrome context decoded and recognized the actual Russian speech
MP3 (2 editable segments), ran manual event Start, reopened/reran offline, and
reported no recording uploads or browser errors. Test data existed only in that
ephemeral browser context; no audio or set was written to the server.

A combined local browser model-failure/retry run exceeded its 180-second recognition
wait. An isolated failed-download/retry probe against the same application then
passed (2 segments), as did live recognition. Final browser verification without
external model downloads passed. Record this transient external-download check as
a timeout, rather than claiming every optional network-dependent run passed.
The actual event remains independent of model downloads once prepared.

## Revision 3 shared-project gate (2026-10-12)

The reviewed and explicitly approved extension is
[revision 3](../specs/features/timed-lyrics/revision-3.md). Revision 3 was subsequently activated as paired release `20261012_025323`;
see the publication evidence below. No commit was requested.

Validation on the final source:

- `node --test tests/*.test.mjs`: 25/25 passed. Exact repeated lyrics, unresolved
  anchors, no fabricated timing, cancellation and baseline portability remain covered.
- `backend/.venv/bin/python -m unittest discover -s backend/tests -v`: 9/9 passed.
  Includes auth/CSRF/origin, CAS conflicts/pins, referenced-delete guard, MIME/range,
  content deduplication, aggregate upload reservations, disk-error atomic cleanup,
  restart reconciliation, import lookup/idempotency, credential-preserving restore,
  and rejection of unmanifested database/audio archive members.
- `node tests/server-browser.mjs`: passed in independent Chrome contexts. Covers
  explicit 25-song/audio migration without repeated uploads, retained v1 originals,
  shared-device reference access, pinned versions, durable conflict draft, fresh
  project/WAV-alias upload/save, immutable read-only offline Start, private cache
  clearing, delayed save/open/logout races, stalled logout immediate local purge,
  failed logout reconnection/revocation and relative root/prefix API mounts.
- `node tests/browser.mjs`: legacy editor/tapping/undo/source replacement,
  25-song timing, root/subpath/export/import, late long-line geometry, offline
  reopening and unrelated storage preservation passed. Final auth-only corrections
  do not alter the tested legacy paths.
- `node tests/recognition-profile-browser.mjs`: actual browser decoding/inference
  on synthetic Russian MP3 passed both pinned profiles. All three exact supplied
  lines received candidate starts: small 0/2.42/4.26 s, base 0/2.38/4.26 s.
  Elapsed 22.6/7.4 s respectively included first model loading in that test context.
  This is speech pipeline evidence, not measured singing accuracy or batch throughput.
- JavaScript syntax, Python compilation and scoped whitespace checks passed.
  Browser preparation screenshot was inspected for the school palette and layout.
- A fresh venv without ensurepip installed the checksum-pinned bootstrap and all
  locked wheels offline locally. The real host's Python 3.12.3 completed the same
  fallback/locked installation without modifying system Python or live links.
- An isolated real-host probe ran the candidate API with a 256 MiB address-space
  cap and private temporary test data. Login/anonymous rejection and a 150 MiB WAV
  stream/range request passed in 17.5 s; reported RSS was 34,300 kB. Probe data and
  process were removed. The production baseline remained healthy.

Independent review found and drove corrections to orphan/quota/dedup/MIME behavior,
crash recovery and streamed sniffing, dependency artifact integrity, exact restore
membership, asynchronous project selection/cache writes and truthful immediate
logout handling. The final focused rereview result is recorded with activation.

| Revision 3 criteria | Evidence / limit |
| --- | --- |
| TL-AC15–AC19 | API suite and independent-browser auth/persistence/catalog/pin/migration/conflict checks passed |
| TL-AC20 | Explicit checked snapshot, offline reload/read-only/Start passed; reference audio is unnecessary for the show |
| TL-AC21 | Exact Cyrillic/repeats/rest and conservative missing-word tests; actual speech inference passed; organizer singing sample pending |
| TL-AC22 | Both profiles execute; comparative singing error/correction-effort benchmark remains pending representative originals and correct text |
| TL-AC23 | Backup/restore bytes/project/audio and credential tests passed; paired production activation passed; production rollback was not executed |
| TL-AC24 | Same artifact and independent API at root/prefix passed locally; HTTPS private-API mount and anonymous access checks passed |

Large vocal inference runs on the organizer laptop, not the small hosting server.
No paid processor or automatic vocal separation is configured. The chosen default
is a more capable candidate model; do not advertise measured singing improvement.

Final focused independent rereview reported no residual material finding in the
corrections. The complete legacy browser suite also passed with
`LYRICS_ASR_FIXTURE=.../fixtures/russian.mp3`: actual MP3 UI recognition, forced
first-download failure/retry, editable generated cues and cancellation all passed.
Pending-logout recovery was additionally exercised with seeded private snapshots,
drafts and audio while offline, and explicit new login/reload.

Final candidate paired package: `20261012_025323`, uploaded to
`/home/elvis/kaada-lyrics-20261012_025323`. The preparer checks every staged byte
and builds the host runtime before changing any live link. The user completed first administrative API activation, as recorded below.


## Revision 3 production publication

The user ran `install-api.py` interactively and privately set the shared organizer
password. Paired release `20261012_025323` is live. Nginx backup:
`/etc/nginx/sites-available/nasty-edu.online.before-lyrics-api-1791775927`.
The initial refused localhost connection and HTTPS 404 were transient startup/
graceful-reload checks; the installer retried until both succeeded.

Post-publication checks passed:

- Both active links select `20261012_025323`; the API service is active, enabled,
  running as `kaada-lyrics`, and reported zero restarts. Observed memory was
  approximately 20–37 MiB during verification.
- HTTPS `/`, `/health`, `/lyrics/` and `/lyrics/api/health` return 200.
- Anonymous projects, library, session, song and audio requests return 401.
  A public credential-path request returns 404; the deployment user cannot read
  the actual private credentials file.
- All 21 public artifact files match the reviewed SHA-256 manifest over HTTPS.
  JS/MJS/WASM MIME checks passed. The API sends `Cache-Control: no-store`.
- Isolated Chrome live smoke passed: organizer login UI, wrong-password rejection,
  offline viewer-shell reopening and exclusion of API requests from viewer caches.
  No browser page errors occurred. Evidence: `lyrics-site/test-results/live-v3/`.

The real organizer password was never requested or used by tools. Authenticated
save/library/audio/offline-project flows were validated with private test credentials
in independent local browsers and the isolated real-host API probe; an authenticated
production project was not created by tools. The organizer can now log in and create
real projects. Legacy browser sets require explicit migration and remain intact.
Representative sung recordings/projector rehearsal remain the earlier manual gaps.

## Revision 4 standalone repository validation

Date: 2026-10-12 (Europe/Moscow). Base: Initial commit `b59edd9` in
`neelvis/kaada-scroller`; approved requirements commit `06aea88`.
Scope: TL-R33–R40 / TL-AC25–AC31. Local verification; no production activation.

- `pnpm install --frozen-lockfile --ignore-scripts` and `node tools/build.mjs`:
  passed. The portable browser runtime needs no native dependency build scripts.
- `node --test tests/*.test.mjs`: 32 passed. New coverage includes portable
  backing labels/private-ID exclusion, declared end independent of lyric delay,
  audio-driven clocks, mute/duplicate Start, armed/running seeking, short backing,
  reset during loading, late play after switching and explicit lyrics-only recovery.
- `backend/.venv/bin/python -m unittest discover -s backend/tests -v`: 12 passed
  in an isolated test environment. Includes original/backing pins, replacement,
  removal, conflicts/ID validation, cross-role cleanup/delete, old database
  migration and revision-3/new backup restore, alongside existing API checks.
- `node tests/browser.mjs`: legacy preparation/tapping/undo, source replacement,
  cancellation, 25-song export/import, timing/geometry, root/subpath portability
  and offline reopening passed. Model inference code is unchanged; this run did
  not require external model downloads.
- `node tests/server-browser.mjs`: cross-device audio persistence, backing pins,
  failed offline download/retry, an indefinitely stalled session, offline backing,
  display project switches, conflicts, logout/cache races and root mounting passed.
- `node tests/live-display-browser.mjs`: synthetic WAV playback, progress/mute,
  seeking/arrows/end/reset, no-highlight preference and equal computed styles,
  menu/readiness/fullscreen/focus, tabs, missing backing recovery and desktop/mobile
  list geometry passed in Chrome. Audio/progress agree within 250 ms in foreground.
- JavaScript/Python syntax and scoped diff whitespace checks passed. Desktop and
  narrow screenshots were visually inspected. Logs/screenshots remain under
  ignored `lyrics-site/test-results/`.

Independent read-only review found a startup issue: an unbounded session request
could block cached projects. Session/project discovery now has a five-second
deadline and cached fallback. The stalled-session check passed; focused rereview
resolved the finding with no remaining material issue in the reviewed scope.

Actual audio output, song arrangements and projector readability still require
organizer rehearsal. Synthetic WAV checks do not measure singing recognition.
A paired frontend/backend release is required to publish revision 4; historical
NastyEdu activation evidence above describes the prior release.

## Revision 4 production publication

The user explicitly requested deployment on 2026-10-12. Paired release
`20261012_080618` is live at `https://nasty-edu.online/lyrics/`.
Application commit: `a3cc8a7`; migration-safety commit: `9ec45b9`.
Previous paired release `20261012_025323` is retained for rollback.

Deployment permissions allow the exact API restart but no private-data reads.
Before ALTER, first service startup now creates an atomic, fsynced private library
archive (0700 directory/0600 file). Failure aborts migration and activation restores
both previous links. Credentials stay in their existing protected file. The
snapshot uses SQLite backup plus the original audio manifest while the old API is
stopped. Restart after migration does not create repeated archives. A fresh legacy
fixture verifies restoration, permissions, idempotence and injected-failure refusal;
all 13 API tests passed. Independent deployment-safety review accepted the final
source. The deploy user did not read the production archive or credentials;
successful guarded startup establishes that the pre-migration step completed.

- Reused 12 checksum-locked wheels and the checksum-pinned bootstrap; all 44 staged
  frontend/API/runtime inputs verified. Preparation did not change live links.
- Activation selected both new links and restarted only `kaada-lyrics-api.service`.
  Post-publication status: enabled, active/running, zero restarts; observed memory
  about 31 MiB (peak about 33 MiB), within its 256 MiB limit.
- HTTPS hashes of all 22 public files matched the staged manifest. JS/MJS and WASM
  MIME checks passed. Main `/`, host `/health` and lyrics API health returned 200.
  Anonymous projects/library/session/song/audio returned 401; API is `no-store`.
- An isolated live Chrome context imported a synthetic local set and WAV backing,
  tested Start, mute, seeking, equal-emphasis lyrics, navigation/reset, then reopened
  and played offline. No page errors or API writes/uploads occurred. Real organizer
  credentials and server projects were not used or changed by the smoke test.
- Evidence is retained under ignored `.work/deploy-*.log` and
  `lyrics-site/test-results/live-v4.png`. Authenticated project/backing save and
  version-pinning paths were validated locally in independent browser contexts.

Close/reopen existing lyrics tabs to adopt the new service-worker shell. Actual
speaker/projector rehearsal and representative sung-recording quality remain the
organizer checks documented earlier.

## Revision 5: LRCLIB search

Approved on 2026-10-12 and implemented in the local KaadaScroller workspace.
No backend data model or dependencies changed. The user subsequently authorized
commit and deployment; paired release `20261012_202705` is live. Application
commit: `caa009e`. Previous pair `20261012_080618` is retained for rollback.

Validation used the bundled Node runtime and Chrome, with synthetic fixtures and
an isolated temporary backend. Commands ran from `lyrics-site`:

- `node tools/build.mjs`: passed; the new module is included in the portable
  artifact and generated offline-shell manifest.
- `node --test tests/*.test.mjs`: 39 passed, including encoded/private requests,
  cancellation during fetch/body reading, timeout, sequential request pacing,
  HTTP errors, non-JSON Retry-After responses, exact repeated LRC occurrences,
  missing-metadata rules and portable-storage limits before mutation.
- `node tests/lrclib-browser.mjs`: passed. Covers explicit search, no empty
  request, variants and disabled unsynchronized/instrumental records, literal
  preview, declined replacement, successful import, duration mismatch, edits
  during confirmation/request, invalid-LRC atomicity, obsolete queries, network
  and service failures, actual 15-second timeout, rate-limit cooldown, local
  reopen/export/import, offline notice, root mounting and narrow keyboard use.
- `node tests/lrclib-server-browser.mjs`: passed. Imported text/timings remain an
  unsaved shared draft until Save; save/reopen retains repeats; another project
  retains its pinned revision after a later import/save; prepared snapshots show
  imported lyrics offline with no LRCLIB request on Start. Project switching and
  logout invalidate pending searches.
- Existing `node tests/browser.mjs`, `node tests/live-display-browser.mjs` and
  `node tests/server-browser.mjs` passed, covering preparation, dual audio roles,
  event playback, persistence/conflicts, offline show and root/subpath mounts.
- JavaScript syntax and `git diff --check` passed. Desktop/mobile screenshots
  were visually inspected; no horizontal overflow at 375 pixels.

| Acceptance criterion | Evidence |
| --- | --- |
| TL-AC32 | Client tests, fixture browser selection/preview, live browser search |
| TL-AC33 | Exact repeated/literal text, preserved metadata, cancelled/invalid import, renewed review |
| TL-AC34 | Slow request/confirmation edits, abort/timeout, service/cooldown, project/logout races and private request checks |
| TL-AC35 | Local reopen/export/import, real shared save/pinning and offline snapshot, both mounts and narrow keyboard layout |

The [live LRCLIB API](https://lrclib.net/docs) accepted browser client identification
and exposed Retry-After through CORS. An unmocked Chrome search returned 20
records without page errors. Existing strict LRC parsing accepted 17 sample
records and rejected three without applying them; no normalization silently
changes imported wording.

Independent review found duration-mismatch visibility and offline-search notice
gaps; both were corrected and rereviewed with no remaining material finding.
Browser checks caught the native-method receiver issue; browser defaults now bind
their receiver, and subsequent browser runs passed. Final focused inspection also
added portable-data validation before mutation, with a passing regression test.
Logs are under ignored `.work/lrclib-*.log`; screenshots are under ignored
`lyrics-site/test-results/lrclib/`.

Matching a real recording/arrangement and checking its timing remain organizer
review steps. Search does not automatically confirm readiness or identify the
correct recording version.

## Revision 5 production publication

The feature commit `caa009e` was pushed to `origin/main`. The reviewed immutable
package contained 45 public/service payload files and five deployment/metadata
files. All service source and runtime hashes matched the previous paired release;
no new database migration or dependency change was introduced. Independent
preactivation review accepted the exact package with no material finding.
Unprivileged preparation verified hashes and installed the locked local wheels.
Activation selected both `20261012_202705` links and restarted only the lyrics API.

- Active/enabled service, running with zero restarts; previous release retained.
- HTTPS hashes of all 19 public top-level files matched the staged package.
  The new module, runtime MJS and WASM MIME checks passed.
- Main `/`, host `/health`, lyrics entry and API health returned 200. Anonymous
  session/projects/library/song/audio returned 401.
- An isolated Chrome context performed a real LRCLIB search (20 results),
  previewed/imported 72 exact LRC cues, retained the unreviewed draft and reopened
  it offline. Synthetic ready lyrics then passed offline Start without any new
  LRCLIB request. No page errors, production API writes or uploads occurred.
  Production organizer credentials, projects and audio were not read or modified
  by the smoke test.
- Evidence: ignored `.work/lrclib-deploy-*` and `.work/lrclib-production-*`;
  live screenshot: `lyrics-site/test-results/live-lrclib.png`.

Close/reopen existing lyrics tabs to adopt the new cached application shell.
Real recording/version selection and timing review remain organizer tasks.

## Revision 6: preparation redesign and portable backing tracks

Revision 6 was explicitly approved with “го” on 2026-10-13. The implementation
was locally verified and subsequently deployed at the user’s explicit request
“деплой”. It has not been committed. Canonical requirements:
[revision 6](../specs/features/timed-lyrics/revision-6.md), TL-R46–R51.

Validation used bundled Node v24.19.0, installed Chrome and an isolated temporary
Python environment with the project's hash-locked API requirements. No production
accounts, datasets, audio or server instances were changed.

- `node tools/build.mjs`: passed. The ZIP module is included in the cached shell.
- `node --test tests/*.test.mjs`: 55 passed. Includes stored/deflated ZIP parsing,
  integrity checks, unique paths, path safety, legacy JSON, limits, missing audio,
  malformed LRC availability and successful empty search with Retry-After.
- `node tests/redesign-browser.mjs`: passed. Covers hidden fields and recognition
  controls, fractional duration preservation, valid/invalid MM:SS edits, tab
  drafts, exact audio round trips, corrupt import, an aborted real IndexedDB
  transaction retaining previous metadata/audio, and a delayed backing replacement
  unable to overwrite an imported file. Desktop and 375px layouts were inspected.
- `node tests/browser.mjs`: passed. Covers 25 songs, manual timing using a previously
  linked original, ZIP backing export, independent origins, long multiline cues,
  offline reopening/playback and unrelated host-storage preservation.
- `node tests/live-display-browser.mjs`: passed. Covers original preview across
  tabs, backing playback, progress/mute/seeking, navigation and responsive layout.
- `node tests/lrclib-browser.mjs`: passed. Covers explicit private search, disabled
  missing/instrumental/malformed LRC, replacement safety, empty results with
  Retry-After, genuine rate limiting, races and narrow/root-route operation.
- `node tests/server-browser.mjs`: passed. Covers authentication, migration,
  library pinning, two-device persistence, failed offline downloads, prepared
  project access during stalled session discovery, private server backing export
  without a cached copy, offline backing export and playback, project switching,
  conflicts and logout races. `LYRICS_TEST_PYTHON` selected the isolated environment.
- `node tests/lrclib-server-browser.mjs`: passed. Covers imported shared drafts,
  pinned versions, offline snapshots and search/project/logout races.
- `git diff --check`: passed. Standard `unzip -t` accepted a generated archive.

An independent read-only review covered portable archive validation, atomic
storage, transfer lifecycle, UI/authentication/offline boundaries and hidden-field
preservation. Its malformed-LRC finding was corrected and rechecked; no material
findings remain. Early import workspace invalidation prevents delayed audio writes
from attaching an old backing file after replacement.

The initial live diagnostic fake-title search returned HTTP 200 and `[]`; the
reported rate limit was not reproduced. Successful responses no longer become
rate limits solely because of a Retry-After header. Genuine HTTP 429 still produces
retry guidance; this change does not disguise actual service restrictions.
Recognition-quality and event-rehearsal limitations from earlier revisions remain.


### Revision 6 production activation

On 2026-10-13 the user explicitly requested deployment. Paired release
`20261013_193539` is active at `https://nasty-edu.online/lyrics/`. It was built from
unchanged locally verified application fingerprints and prepared with the normal
paired deployment workflow. All 22 backend/source/locked-runtime inputs matched
prior pair `20261012_202705`; no new database migration was introduced. Both
prior release directories were retained for rollback.

After activation, live HTTPS hashes of the shell/editor/portable-storage/LRCLIB
and playback modules matched the staged artifact. Entry redirect, JS/MJS/WASM
MIME, API health, anonymous project/audio rejection, main site and host health
passed. An isolated fresh Chrome context exercised the shipped editor, disabled
Projects without login, MM:SS duration, hidden original controls, a simulated
successful empty LRCLIB response carrying Retry-After, synthetic local WAV upload,
exact ZIP audio export/import, desktop/mobile layout and offline reopening with
backing playback. No private server records were changed. Authenticated production
library edits were not attempted; their behavior was tested locally against the
unchanged API. Browser screenshots and the smoke script are in ignored
`lyrics-site/test-results/deploy-revision-6/`; concise logs are in
`/tmp/kaada-redesign-deploy-smoke.log`.

Existing tabs must close and reopen to adopt the new service-worker shell.

## Navigation and first-activation confirmation follow-up — 2026-10-13

Requested corrections are implemented locally: display entry immediately above
the sidebar songs, no automatic editor selection on load/import/open/delete,
selected-song-only editing, preserved selection on save, Projects hidden while
logged out, and first-activation confirmation after committing a focused edit.
Offline songs can be selected while editing and reordering remain disabled.

Validation: portable build, all 55 unit tests, redesign browser, general browser,
live display browser, LRCLIB browser and LRCLIB server browser passed. Redesign
regressions cover the initial placeholder, reload, deletion, show entry position,
logged-out visibility and confirming freshly edited lyric text with one click.
Diff whitespace checks passed. Backend browser checks use the existing isolated
Python environment at `/tmp/kaada-redesign-api-venv/bin/python` because the default
backend `.venv` link points to a missing temporary directory.
At the local verification checkpoint, these follow-up changes had not yet been deployed. Existing unrelated work was
preserved; no commit was requested.

Scheduled continuation completed on 2026-10-14 at 03:00 Moscow time. The full
server browser suite passed, including migration, saved selection, offline
project switching, conflicts and logout races. Tests now explicitly select a
song where editing is expected and retain the placeholder after logout.
A further readiness regression passed: invalid pending text is rejected and its
focused valid correction is confirmed on the first activation. Desktop visual
inspection confirms the sidebar entry position, placeholder and hidden Projects.
All requested local changes and validation were complete at that checkpoint.

## Navigation follow-up deployment — 2026-10-14

The user explicitly authorized ignoring `work/`, committing/pushing the completed
changes and deploying them. Paired release `20261014_132817` is active at
`https://nasty-edu.online/lyrics/`. The prior pair `20261013_193539` is retained
for rollback. All 22 backend and locked runtime inputs match the prior release;
no new database migration or server behavior change is introduced.

Preparation and activation succeeded. HTTPS checks verified live asset hashes,
redirects, JavaScript/WASM MIME, API/main-site health and anonymous private-data
rejection. Isolated production browser checks passed: hidden Projects without
login, display entry above songs, placeholder before selection, confirmation of
a focused lyric edit with one click, ZIP backing round trip, narrow layout and
offline backing playback after reopening. No private server projects were changed.
Close and reopen existing lyrics tabs to adopt the new cached shell.


## Revision 8: plain text and uniform scrolling

Locally verified on 2026-10-14. The user approved revision 8 with `подтверждаю`
after the draft was presented. The subsequent explicit `commit + push + deploy`
request authorized publication.

Passing checks in `lyrics-site/`:

- `node --test tests/*.test.mjs`: 61 tests passed.
- `node tools/build.mjs`: portable artifact built.
- `node tests/plain-scroll-browser.mjs`: imported ordinary text and duration, null
  timestamps, replacement cancellation/stale edits, label/checkbox/readiness, local
  persistence, fixed 10-second intro, continuous spatial positions, wrapping/font/
  viewport changes, pause/resume/seek/reset/end, short/single-line songs, backing
  and lyrics-only playback; root and `/lyrics/`; narrow import layout.
- `LYRICS_TEST_PYTHON=<isolated-test-runtime> node tests/plain-scroll-server-browser.mjs`:
  explicit shared Save/reopen, library reuse, portable archive round trip, offline
  reopening and Start without a lyric-service request. All data was synthetic in
  an isolated temporary server; no private organizer projects were modified.
- `node tests/lrclib-browser.mjs`, `node tests/live-display-browser.mjs`,
  `node tests/redesign-browser.mjs`, and `node tests/browser.mjs`: passed.
  The base browser fixture now accounts for revision 7's Pause button on a second
  activation instead of expecting the timeline to continue after that click.
- `git diff --check`: passed. Independent review found no material defects.

Mobile screenshots of ordinary-text import and wrapped uniform display were
inspected. Actual LRCLIB catalog responses and projector/event rehearsal remain
manual checks. Existing timed-mode validation and cue playback retain their rules.

Paired release `20261014_142714` was activated on 2026-10-14 from application
commit `7d57cea`, pushed to `main`. Independent deployment review accepted all 46
manifest entries; only five frontend files differ from the previous release and
all 22 service/runtime files are unchanged. The previous pair `20261014_141246`
is retained for rollback. HTTPS checks verified live asset hashes, health,
anonymous project/audio rejection and JS/MJS/WASM MIME. The plain-scroll browser
scenarios passed against production using mocked LRCLIB results and synthetic
browser-local songs/audio, including import, uniform timing, backing playback,
pause/resume/seek/reset, short songs and local persistence. No private school
projects were modified. Close and reopen existing tabs to adopt the new shell.

## Revision 10: compact display controls

On 2026-10-15, [revision 10](../specs/features/timed-lyrics/revision-10.md)
TL-R56–TL-R61 was implemented after explicit approval. The user subsequently
authorized commit, push, and deployment.

The portable build, 61 unit tests, base browser suite, plain-scroll browser suite,
and live-display browser suite passed. Display checks cover the anchored library
popup, ready-song navigation, responsive icon row, emphasis persistence,
fullscreen preparation-button hiding, three-second panel hiding, bottom-strip
and keyboard recovery, and playback/shortcut regressions. Desktop and mobile
screenshots were inspected.

The new `test:display-controls` suite passed tooltip hover and real keyboard focus,
editable/menu shortcut guards, Space at the declared end, pending fullscreen-timer
cancellation/reentry, emulated touch reveal without seeking, and visible audio
error/recovery controls. The touch scenario identified sticky CSS hover overriding
actual pointer state; the correction passed both the supplemental suite and the
full display suite. Independent source review and correction rereview found no
material production findings. Actual projector/event-device rehearsal remains
an organizer check.

Application commit `66e2bc3` was pushed to `main` and paired release
`20261015_082900` activated on 2026-10-15. Independent preactivation review verified
all 51 package hashes and 46 server-manifest entries. Only `app.js`, `index.html`,
`styles.css`, and the generated cache manifest differ from the prior pair
`20261014_142714`; all 22 service/runtime files and activation/preparation scripts
are unchanged. The previous pair remains available for rollback. HTTPS checks
passed live asset hashes, site/API health, anonymous private-data rejection, and
JS/MJS/WASM MIME. The full display and supplemental controls browser suites passed against the live origin
using synthetic browser-local songs/audio. Private school projects were not
modified. Close and reopen existing lyrics tabs to adopt the new shell.

## Revision 10 follow-up: fullscreen F and idle opacity

On 2026-10-15, the user replaced minimization with a full-size panel at 30%
opacity and requested F to enter/exit fullscreen. TL-R60/TL-R61 and AC48/AC49
record the bounded refinement. The original three-second delay remains.

Syntax, portable build, full live-display browser, and supplemental controls
browser checks passed. Tests verify F and its guards, 0.3 computed opacity,
unchanged panel bounds, active pointer interaction, restoration on full-panel
hover, keyboard focus and touch, stable lyric position, timer cancellation, and
visible audio-error recovery. Prior strip/miniature expectations were removed.

Follow-up commit `1cd15cc` was pushed to `main` and published as paired release
`20261015_084025` on 2026-10-15. Independent source/package review accepted all 51
stage hashes; all service/runtime files and deploy scripts match the preceding
pair `20261015_082900`, retained for rollback. HTTPS hashes, health, anonymous
project/audio rejection, and JS/MJS/WASM MIME passed. The supplemental controls
suite also passed against the live origin with isolated synthetic browser-local
data, covering F, exact 30% opacity, full-panel geometry, hover/focus/touch
restoration, and error visibility. Private school projects were not modified.

## Revision 10 follow-up: keyboard focus, font keys and unavailable audio

The user reported Space activating the focused library trigger and requested
+/− font shortcuts, a two-second idle-opacity delay, and a visible disabled
crossed-speaker control without backing audio. TL-R58/TL-R60/TL-R61 and their
acceptance criteria record these small explicit refinements.

Syntax, portable build, full display browser and supplemental controls browser
checks passed. Tests cover Space after all three menu-dismissal routes with focus
retained on the trigger, Space/Enter precedence on other buttons, font button/key
step and bounds, shortcut guards, measured two-second dimming, disabled crossed
speaker visibility and exact hover tooltip, backing/no-backing switching, and
existing playback, fullscreen, focus/touch and error behavior. No production data
was used in the local checks.

Application commit `ddae475` was pushed to `main` and deployed as paired release
`20261015_085345` on 2026-10-15. Final source/package review accepted all 51 exact
stage hashes and unchanged backend/runtime/deploy scripts. The intermediate
candidates were never activated; prior active pair `20261015_084025` is retained
for rollback. HTTPS asset hashes, health, anonymous private-data rejection and
JS/MJS/WASM MIME passed. The isolated live keyboard smoke verified Space after
Escape/close/outside menu dismissal, button focus/Enter behavior, main and numeric
font keys and limits, paused-position preservation, two-second opacity change,
and the visible disabled crossed-speaker state with the exact no-backing tooltip.
Only synthetic local browser data was used; no private project was modified.

## Revision 10 follow-up: L and inactive Space in the library

L opens the display library popup. Space keydown and keyup default actions are
suppressed while it is open, preventing native song/button activation as well as
playback changes. Closed-popup Space retains normal global playback behavior.

Syntax, portable build, 64 unit tests, full display browser, supplemental controls
browser, and LRCLIB browser passed. Physical keyboard checks cover current/other
ready songs at nonzero paused/running positions, close and trigger buttons,
L guards/idempotence, and access before a song is armed. Paused position remains
fixed and running time/audio continue without reset, switching, or pause.
Independent source/package review closed the empty-song guard ordering finding.
The package also includes existing commit `5e71324` explaining LRCLIB HTTP/browser
errors; its unit and browser checks passed. The user requested committing the
entire tree, including the separate unapproved revision-9 draft and its links;
that draft remains unimplemented.

All current tree changes were committed in `e9c659e` and pushed together with the
previous local LRCLIB commit. Paired release `20261015_090722` was activated on
2026-10-15 after corrected-source and exact-package acceptance. The prior pair
`20261015_085345` is retained; the initial candidate was not activated. All 51
package hashes were reviewed; backend/runtime and deployment scripts are unchanged.
HTTPS asset hashes, site/API health, anonymous private-data rejection and MIME
passed. Isolated live keyboard checks passed L opening/idempotence, physical Space
on current/other songs and close/trigger controls without selection/reset/pause,
and closed-popup playback/font/timer/unavailable-audio regressions. Synthetic local
browser fixtures only were used; no private school project was modified.


## Revision 14: local/cloud workspace redesign (2026-10-21)

Approved scope: [revision 14](../specs/features/timed-lyrics/revision-14.md),
TL-R73–R81 and TL-AC59–AC63. The user approved the concrete draft on 2026-10-17
and authorized commit, push and paired deployment. Publication is recorded below
when completed.

Local verification passed:

- `node --test tests/*.test.mjs`: 92 tests. Storage checks cover interrupted
  writes, corrupted snapshots/audio, path validation, permission failure,
  same-directory reconnect/retry, queued save status and media version baselines.
- `python -m unittest discover -s backend/tests -v`: 17 tests. Standalone cloud
  song creation/update includes authenticated writes, retry keys, revision
  conflicts and preservation of project-pinned versions.
- `node tests/workspace-browser.mjs`: projects-first logged-out navigation,
  multiple projects, library selection/reordering/removal, narrow layout,
  recovery in a fresh browser context after clearing browser storage, and
  legacy migration with independent pinned audio and retained source data.
- `node tests/workspace-cloud-browser.mjs`: real temporary API, byte-exact
  backing upload, lost-response creation retry, standalone song upload without
  a project, second-folder download, service-worker-ready offline playback
  after logout, conflicts preserved as separate versions, and cancelled
  project switches not starting playback.
- `node tests/plain-scroll-browser.mjs`: plain import and review, file-backed
  reopen, scrolling positions, narrow layout, backing playback and stale guards.
- `node tests/display-controls-browser.mjs`: tooltips, shortcut guards, global
  Space behavior from TL-R67, fullscreen dimming, touch and audio-error recovery.
- Production build, JavaScript syntax, Python compilation and `git diff --check`.

Browser directory tests write ordinary files to temporary OS directories through
an API adapter. Native OS picker interaction was not automated. Desktop Chrome
and Edge are the supported directory-access targets; an unsupported browser does
not silently substitute browser storage for durable files. Physical projector
and representative live-music rehearsal remain organizer checks.

Source audit extracted preparation, workspace actions, hub UI, cloud transfers,
file snapshots, active directory sessions and DOM helpers. Hub styles are separate
and the old inline stylesheet was removed. Existing backend API/store/config/
backup boundaries remain appropriate. New module assets are included in the
service-worker shell and deployment required-file checks.

Independent reviews found and resolved F1–F4 (audio pin isolation, reconnect
recovery, overlapping transfers and same-name audio change detection), plus
R14-1/R14-2 (cancelled launch and stale source pins). The correction reviews
reported no remaining material findings in the inspected scope. Older browser
suites tied to superseded navigation were not claimed as passing.


### Revision 14 publication

Paired release `20261021_145916` was activated on 2026-10-21 from source commit
`4492075db1a82af2ecafbdb89ce2f762e5ea7fa8`. All 54 staged file hashes were validated;
public sources matched the committed revision. The release manifest SHA-256 is
`cf025910615e51527082944f1e10611140d04c6236f16b5f3e00af86710842dc`.
The branch `codex/local-cloud-workspace` was pushed before activation.

Preparation installed the locked backend runtime without package-network access.
Activation selected matching frontend/backend generations; the API service is
active. Prior pair `20261017_093212` remains available for rollback.

Post-deploy verification passed 36 HTTPS checks: top-level public-file hashes,
JavaScript MIME types, lyrics/site health and unauthenticated rejection of private
project/song/audio reads and standalone-song writes. A fresh installed-Chrome
context passed Projects/Library navigation, anonymous local-work controls,
service-worker offline-shell readiness, 320px layout and absence of runtime
exceptions. Production private projects were not changed by these smoke checks.
Authenticated transfers and offline audio were exercised against the isolated
real test API, not against school data. Native picker and physical rehearsal gaps
remain as stated above.


## Revision 16: cloud library and local project copies (2026-10-21)

Approved with `подтверждаю` after the linked revision-16 draft. Implemented and
verified locally, then committed and deployed following the explicit user
instruction `Коммит, деплой`.
Pre-existing revision-15 cue shifting, styles and deployment-guide changes were
preserved. Earlier revision-14 transfer/pinning results above are historical;
revision 16 supersedes their affected business behavior.

Validation from `lyrics-site`:

- `node --test tests/*.test.mjs`: 97 tests pass, including directory integrity,
  permission/failure recovery, local-file switching, cloud-transfer retry and
  in-flight save reconciliation.
- `<API Python> -m unittest discover -s backend/tests -v`: 23 tests pass with
  the locked API requirements. Tests cover latest project heads, stale-song
  conflicts, atomic project writes, readiness, concurrent identity uniqueness,
  cascading deletion, upload-key tombstones and shared-audio retention.
- `node tools/build.mjs`: portable artifact builds successfully.
- `LYRICS_TEST_PYTHON=<API Python> node tests/cloud-library-browser.mjs`: actual
  temporary authenticated API, Chrome and a real-directory bridge pass. The
  `test:workspace`, `test:workspace:cloud` and `test:cloud-library` scripts select
  this canonical suite; older revision-14 browser files describe superseded UX.
- `node tests/display-controls-browser.mjs`: existing tooltip, keyboard guard,
  dimming, touch restoration and audio-error regression passes.
- JavaScript syntax and scoped whitespace checks pass. Desktop and 320px
  screenshots were visually inspected; no horizontal overflow at 1360/375/320px.

| Criteria | Evidence |
| --- | --- |
| TL-AC66 | Ordinary library creation before a folder is selected, LRC preparation, readiness reset after title/text/timing edits, failed cloud save with draft retained and successful retry |
| TL-AC67 | Project creation and explicit library selection reuse the cloud song identity; edits update the library and both projects; unchanged stale heads and conflicting edits have API/unit coverage |
| TL-AC68 | Top-bar folder/subtitle and cancellation, durable snapshots/audio, cloud success followed by injected local-write failure, retry without another cloud revision; both hub and editor playback use local lyrics/backing without audio GET requests |
| TL-AC69 | Title/artist/version filtering, optional version metadata, creation/filter order, ready play, disabled pointer/keyboard tooltip and responsive cards |
| TL-AC70 | Duplicate and whitespace-only copy rejection, version-only distinct copy preserving the original, empty/absent version equivalence and concurrent server uniqueness |
| TL-AC71 | Delete all occurrences across projects, retain other entries/order and local snapshots, reject stale song/project resurrection and preserve shared audio |

Independent read-only review found two frontend data-loss risks: local promotion
could adopt an earlier successful upload over a newer draft, and in-flight
revision rebasing could attach a newer cloud baseline to retained stale content.
Corrections preserve newer drafts, recover imported project bindings safely,
check recovered cloud names/content for conflicts, adopt untouched latest songs
and retain old baselines for divergent edits. Focused regression tests pass;
independent rereview accepted the corrections. Backend review found no material
issues. The final home-screen control-visibility delta was additionally checked
in the final browser run.

Native OS folder-picker interaction and selection between physical folders remain
manual platform checks. Adapter/unit tests cover switching handles, revoked
permission and missing/corrupt files; playback unit/display tests cover missing
backing failures and explicit lyrics-only recovery. Multi-client conflict rules
are exercised at API/unit level rather than through a simultaneous browser
session. Real organizer recordings and physical projector rehearsal remain
outside these synthetic fixtures. All test cloud writes used disposable local
API data, never production library/projects.


### Revision 16 production publication

Application commit `0c6f5b59aa6af92fbcb46a98bca279c35156773a` was pushed on
`codex/local-cloud-workspace`. Paired release `20261021_161630` was independently
reviewed: all 55 manifest entries match, committed public/backend sources and
deployment scripts match exactly, and 12 wheels plus the pip bootstrap match the
committed lock/pin. Manifest SHA-256:
`2d0378b793d4c1f0dbab53669da8b5b425f77c7949866ea097c00015f845a927`.
An isolated old/new/old store initialization verified additive-schema rollback
compatibility and SQLite integrity. The new table only retains deleted upload
retry keys; existing private songs/projects are not migrated or rewritten.

Remote preparation installed locked wheels without package-network access.
Activation selected matching frontend/API `20261021_161630`; the API service is
active and prior pair `20261021_151151` remains retained for rollback. All 39 HTTPS
checks passed: top-level public-file hashes, site/API health, anonymous private
project/library/song/audio rejection and MJS/WASM MIME types.

An isolated anonymous Chrome context using the production release passed the new
cloud-library navigation, removed legacy controls, creation gating, top-bar local
folder/subtitle, real temporary-directory ZIP import, local lyric/backing Start
without cloud audio requests, Space pause and 320px layout. There were no uncaught
browser errors and no production API write requests. Authenticated cloud writes
were exercised against the disposable local API, not private school data. Native
OS folder-dialog and physical rehearsal boundaries remain as stated above.


## Revision 17: cue ordering, interludes and library sorting (2026-10-22)

Scope: approved TL-R94–R99 / TL-AC72–AC75, including the user's final row-level
`+ ♪` placement and three space-separated notes. No database migration or runtime
dependency change is introduced. Library dates come from existing song creation
rows and are returned as ISO UTC `createdAt` metadata.

Local verification:

- `node tools/build.mjs`: portable artifact built successfully.
- `node --test tests/*.test.mjs`: all 110 tests passed, including cue identity,
  unchanged timestamps, no-op moves, before-first/empty insertion estimates, invalid timing/readiness,
  portable rest preservation and all six stable locale-aware sort orders.
- `/tmp/kaada-backend-revision16-venv/bin/python -m unittest discover -s backend/tests`:
  all 24 API tests passed, including original creation dates across edits/copies.
- `LYRICS_TEST_PYTHON=/tmp/kaada-backend-revision16-venv/bin/python node tests/cue-interludes-browser.mjs`:
  real authenticated temporary API and Chrome cover row arrows/native drag,
  focused edits immediately followed by move/insertion, repeated lyric identity,
  row `+ ♪` position, editable estimates,
  same-position drops, readiness, cloud save/reopen and directory-backed local
  project snapshots. Audience checks cover exactly `♪ ♪ ♪`, active color even
  with ordinary lyric highlighting disabled, intro/middle/final rest cues,
  pause/resume/seek/end, delay, reduced motion and unchanged untimed labels.
  Six dropdown orders, filtering, selection retention and unchanged creation
  dates pass. Layouts at 320, 375, 1120 and 1360px have no page overflow.
- `node tests/display-controls-browser.mjs`: existing supplemental display
  shortcuts, dimming, tooltips, touch restoration and audio-error checks passed.
- `LYRICS_TEST_PYTHON=/tmp/kaada-backend-revision16-venv/bin/python node tests/cloud-library-browser.mjs`:
  existing cloud creation/edit/copy, save failure/retry, readiness, shared-project
  updates, durable local copies/playback and cascading deletion passed. The
  regression exposed an unnecessary post-save editor rebuild that could remove
  a focused input before the next input event; unchanged same-song saves now keep
  those controls mounted. The check waits for both the edited text and readiness.
- Independent source review accepted the final scoped change with no unresolved
  material findings. Logs and review evidence are in the ignored directory
  `work/cue-interludes-sort-20261021/`; screenshots are under
  `lyrics-site/test-results/revision-17/`.

Browser tests use installed Chrome and a real-file directory adapter, not the
native OS folder chooser. Physical projector readability and event rehearsal
remain organizer checks. Production publication evidence follows after activation.
