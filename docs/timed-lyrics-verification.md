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
