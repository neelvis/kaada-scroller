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
