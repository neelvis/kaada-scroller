# Independent frontend and private projects deployment

The lyrics application is independent of the NastyEdu JAR. Public browser files,
private API source/runtime and persistent data have separate paths:

- `/srv/nasty-edu-lyrics/releases/ID`, selected by `current`;
- `/srv/nasty-edu-lyrics/backend-releases/ID`, selected by `backend-current`;
- `/var/lib/kaada-lyrics`: private SQLite database, audio and credentials.

Neither release switching nor ordinary NastyEdu deployment removes project data.
The API listens only on `127.0.0.1:8096`; Nginx forwards `/lyrics/api/` before the
existing `/lyrics/` static mount. It runs as `kaada-lyrics`, with a 256 MiB memory
limit, a private environment file and a configurable 1 GiB audio allowance.

## Validate, build and stage

From `lyrics-site/`, run the documented frontend/backend/browser checks. Then:

```sh
pnpm build
backend/.venv/bin/python tools/prepare-python-runtime.py
node tools/stage-server.mjs 20261012_000000 /absolute/new/kaada-lyrics-20261012_000000
scp -P 2222 -r /absolute/new/kaada-lyrics-20261012_000000 elvis@153.51.112.84:/home/elvis/
ssh -p 2222 elvis@153.51.112.84 'python3 /home/elvis/kaada-lyrics-20261012_000000/prepare-service.py'
```

Use a fresh UTC `YYYYMMDD_HHMMSS` ID. Staging includes only public files, API
source, hash-locked pure-Python wheels and a checksum-pinned pip bootstrap; it
excludes recordings, credentials, local data, tests and development environments.
`SERVER-SHA256.json` covers all staged frontend/service source and runtime inputs.
Production dependency installation uses `--require-hashes --no-index` and the
staged wheelhouse. The preparer runs unprivileged and changes no live links.
When Ubuntu lacks ensurepip it bootstraps only the isolated venv from the staged,
verified get-pip script and pip wheel. It never installs packages into system Python.
Upstream bootstrap checksum changes require review rather than automatic acceptance.

The legacy `stage.mjs`/`activate-release.py` commands are for the original
local-only static release. Do not use them to deliver a server-project update.

## First private-service activation

The administrator reviews `install-api.py`, then runs it interactively:

```sh
ssh -t -p 2222 elvis@153.51.112.84 'sudo python3 /home/elvis/kaada-lyrics-20261012_000000/install-api.py'
```

It checks prepared checksums, creates the restricted service user/data directory,
and asks twice for a shared organizer password of at least 12 characters using
hidden terminal input. Do not send this password in chat. Only a private scrypt
hash is stored. It backs up Nginx, creates the dedicated systemd service and route,
validates/reloads Nginx, waits for localhost and HTTPS API health, then switches
the public release. On failure it restores the previous route/release selection
and removes its own service configuration; persistent data/credentials remain.

A narrowly scoped sudo rule allows `elvis` only the exact service restart command
without a password, supporting later paired deployment. It grants no generic
systemctl or shell command. This one-time administrator action does not deploy
any course, piano, Kotlin or JAR changes.

## Later paired updates and rollback

After staging, uploading and preparing a fresh release:

```sh
ssh -p 2222 elvis@153.51.112.84 'python3 /home/elvis/kaada-lyrics-RELEASE_ID/activate-server.py'
```

Activation locks the deploy operation, checks source/runtime hashes, selects the
new API, restarts only its service, waits for health, then selects the frontend.
Failure restores both previous links and restarts the previous API. To roll back,
use a retained prior paired package's activator. Do not select mismatched API and
frontend generations manually. Database upgrades must stay compatible with the
retained paired release; back up before a future incompatible migration.

Check `/lyrics/`, `/lyrics/api/health`, anonymous project/audio rejection, JS/MJS/
WASM MIME, main `/` and `/health`, authenticated save/reopen and offline Start.
Close/reopen existing lyrics tabs to adopt the new service-worker shell; do not
update during a performance.

## Data backup and restoration

Stop the API as an administrator before backing up/restoring so metadata and
reference files are consistent. Run the CLI as the service user (it owns the data):

```sh
sudo systemctl stop kaada-lyrics-api.service
cd /srv/nasty-edu-lyrics/backend-current
sudo -u kaada-lyrics /srv/nasty-edu-lyrics/backend-current/.venv/bin/python -m backend.backup create /var/lib/kaada-lyrics /PRIVATE_WRITABLE_BACKUP/lyrics.tar.gz
```

The CLI must run with working directory `/srv/nasty-edu-lyrics/backend-current`.
The archive contains a consistent SQLite snapshot and SHA-256-checked reference
files. Keep credentials.json separately in a protected backup. Restore validates
manifest paths, byte hashes, SQLite integrity and every referenced audio file
before replacing its target. Existing target credentials are preserved. A new
host requires the separately backed-up credential file and correct service-user
ownership before restart. Verify restoration in a fresh directory first; then
restore the stopped production data directory and restart the API.

## Dedicated-domain relocation

Serve the same public artifact at `/`, proxy `/api/` to this independent API,
and configure `LYRICS_ORIGIN` to the new HTTPS origin and
`LYRICS_COOKIE_PATH=/api/`. Move the private database/audio/credential directory
with the verified restore procedure. All browser URLs are relative; no NastyEdu
runtime is needed. Browser snapshots belong to each origin and must be prepared
again after moving domains. Keep private files outside the public document root.

## Revision 4 release check

Publish the frontend and API as a paired release. On startup the API adds a
nullable backing-track column without rewriting existing song revisions. The first startup against a revision-3 database creates a protected, consistent
archive under `/var/lib/kaada-lyrics/backups/` before changing its schema. The old
API has stopped during the service restart, so uploads and saves cannot race the
snapshot. Backup failure prevents the migration; activation restores the prior
paired links. The archive is private (directory 0700, file 0600); credentials stay
in their existing protected file. The service journal records only the completed
archive path and SHA-256. Activation allows up to 180 seconds for initial snapshot
and health. Later starts skip the snapshot once the nullable column exists.
Administrators can retrieve/verify the private archive; deploy-user access is not
expanded. Existing revision-3 archives remain readable;
new archives validate original and backing references. After activation, verify
backing upload/save/reopen, synchronized Start/seek/mute, and an explicitly prepared
project reopening offline with its backing audio. Repository validation does not
constitute production activation.

## Revision 5 release check

LRCLIB search was published as paired release `20261012_202705` on 2026-10-12.
Its backend source and locked runtime are unchanged from revision 4; no additional
database migration is needed. Use the same paired staging/preparation/activation
workflow. Verify the new `lrclib.js` is present in the offline-shell manifest,
client identification/CORS, live search and safe LRC import, local reopening
without internet and prepared-show independence from LRCLIB. Retain the preceding
pair for rollback and close/reopen old browser tabs after publication.


## Revision 6 release check

Preparation redesign and portable ZIP backing transfer were published as paired
release `20261013_193539` on 2026-10-13. Backend source and locked runtime match
revision 5; no additional schema change is introduced. Use the established paired
workflow and retain a previous pair for rollback. Verify `portable.js` is in the
cached shell; check login gating, MM:SS duration, the three import tabs, disabled
unavailable LRC, ZIP audio round trips, responsive layout and offline backing
playback. Close and reopen existing tabs to adopt the new shell. Production smoke
checks use synthetic local files in an isolated browser and do not mutate the
school's private projects.

## Navigation follow-up release

Paired release `20261014_132817` on 2026-10-14 publishes sidebar display entry,
explicit song selection, first-activation timeline confirmation and hidden
Projects before login. Backend/runtime hashes are unchanged from revision 6.
HTTPS and isolated production browser checks passed, including offline backing
playback. The prior paired release `20261013_193539` remains available for rollback.

## Display pause and layout follow-up

Paired release `20261014_141246` on 2026-10-14 publishes functional display
pause/resume, single-line LRCLIB artist labels and an aligned preparation action
row with the version explanation below the buttons. Backend/runtime hashes are
unchanged. HTTPS asset hashes, health, anonymous project/audio rejection and asset
MIME passed. The display browser suite passed against production with synthetic
browser-local fixtures, including backing and lyrics-only pause/resume. Private
school projects were not modified. The previous pair `20261014_132817` remains
available for rollback. Close and reopen existing tabs to adopt the new shell.


## Plain lyrics and uniform scrolling release

Paired release `20261014_142714` on 2026-10-14 publishes the Own text label,
LRCLIB ordinary-text/duration import and the per-song ignore-timecodes mode with
uniform scrolling after a 10-second intro. Backend/runtime hashes match the
previous pair `20261014_141246`, retained for rollback. Independent manifest
review, HTTPS asset/health/privacy/MIME checks and isolated production browser
scenarios passed. Synthetic browser-local songs/audio and mocked search results
were used; private school projects were not modified. Close and reopen existing
tabs to adopt the new cached shell.

## Compact display controls release

Paired release `20261015_082900` on 2026-10-15 publishes revision 10: anchored
media-library navigation, the icon row after the timeline, current-line emphasis
toggle, fullscreen preparation-button hiding and panel reveal, and Space/M/C
shortcuts. Application commit `66e2bc3` was pushed to `main`. Independent package
review, HTTPS asset/health/privacy/MIME checks, and isolated live display browser
scenarios passed. All 22 backend/runtime files and deployment scripts match the
previous pair `20261014_142714`, retained for rollback. Private school projects
were not modified. Close and reopen existing lyrics tabs to adopt the new shell.

### Fullscreen opacity follow-up

Paired release `20261015_084025` on 2026-10-15 (application commit `1cd15cc`)
adds F fullscreen toggling and replaces the miniature reveal strip with the
full-size, interactive panel at 30% opacity after three seconds of inactivity.
Hover, keyboard focus, or touch restores full opacity. Source/package review,
local display suites, HTTPS checks, and the live supplemental controls suite
passed. Backend/runtime and deployment scripts are unchanged; prior pair
`20261015_082900` remains available for rollback. Close and reopen existing tabs.

### Keyboard and unavailable-audio follow-up

Paired release `20261015_085345` on 2026-10-15 (application commit `ddae475`)
prioritizes Space playback over focused display-button activation, adds +/− font
shortcuts, shortens idle opacity to two seconds, and keeps a disabled crossed
speaker with the exact no-backing tooltip visible for songs without accompaniment.
Local display suites, independent source/package review, HTTPS checks and isolated
live keyboard/audio/timer smoke passed. Backend/runtime and deploy scripts are
unchanged; prior pair `20261015_084025` is retained for rollback. Intermediate
prepared candidates were not activated. Close and reopen existing lyrics tabs.

### Library L and inactive popup Space

Paired release `20261015_090722` on 2026-10-15 (application commit `e9c659e`)
adds L for library navigation and suppresses native Space down/up activation while
the popup is open. It also publishes the existing LRCLIB error-explanation commit.
The user requested all-tree commit, so the revision-9 specification is committed
as an unimplemented draft. Unit/display/LRCLIB checks, independent exact-package
review, HTTPS checks, and isolated live keyboard scenarios passed. API/runtime
and deploy scripts are unchanged; prior pair `20261015_085345` is retained.
Close and reopen existing lyrics tabs to adopt the new shell.

### Preparation refinements

Paired release `20261015_114534` on 2026-10-15 publishes revision 11: a marquee
for overflowing set names, a per-song uniform-scroll start time, streamlined
library actions, and icon-only global actions with tooltips. The API source,
runtime and deploy scripts are unchanged; no data migration was needed. HTTPS
checks from the server returned 200 for the site, API health and JavaScript
assets, and 401 for anonymous project and audio requests. The active frontend
and API both point to `20261015_114534`; prior pair `20261015_090722` remains
available for rollback. Automated and browser UI suites, authenticated
save/reopen and offline display checks were not run. Close and reopen existing
lyrics tabs to adopt the new shell.

### Optional uniform scrolling and Space behavior

Paired release `20261015_115537` on 2026-10-15 publishes revision 12. Display
mode captures Space before focused controls and uses it only for start/pause.
For songs that ignore timecodes, a checked-by-default option enables uniform
scrolling after the configured delay; unchecking it keeps lyrics stationary.
Legacy songs default to enabled with a 10-second delay. The API source, runtime
and deploy scripts are unchanged; no data migration was needed. HTTPS checks
from the server returned 200 for the site, API health and JavaScript assets,
and 401 for anonymous project and audio requests. The active frontend and API
both point to `20261015_115537`; prior pair `20261015_114534` remains available
for rollback. Automated and browser UI suites, authenticated save/reopen and
offline display checks were not run. Close and reopen existing lyrics tabs to
adopt the new shell.

### Manual lyric scrolling

Paired release `20261015_134546` on 2026-10-15 publishes revision 13. When
uniform auto-scroll is disabled for ignored-timecode lyrics, ArrowDown and
mouse-wheel input move the text by five lines without changing backing playback;
preparation displays a manual-scrolling notice. Backend source and locked
dependencies are unchanged, with no data migration. Production smoke checks
returned 200 for the page and API health, 401 for anonymous projects, and 200
with JavaScript MIME for the application bundle. Both live links point to
`20261015_134546`; previous pair `20261015_115537` remains available for
rollback. Browser UI and authenticated/offline workflows were not exercised.
Close and reopen existing lyrics tabs to adopt the new shell.

### Fractional cue-time shift

Paired release `20261021_151151` on 2026-10-21 adds a fractional-seconds
`Подвинуть время` control to song preparation and spacing below the
ignore-timecodes checkbox. The API source and locked runtime are unchanged; no
data migration was needed. All 92 frontend unit tests and the plain-scroll
browser scenario passed before release. Production checks returned 200 for the
lyrics page, API health, main site and main health endpoint; anonymous project
and audio requests returned 401. JavaScript, CSS, MJS and WASM assets returned
200 with their expected MIME types. An isolated production-browser smoke check
applied a fractional offset, confirmed persistence and readiness invalidation,
and measured 65 px between the ignore-timecodes checkbox and first cue row. Both
live links point to `20261021_151151`; the previous pair `20261021_145916`
remains available for rollback. Authenticated cloud save/reopen and offline
Start were not exercised. Close and reopen existing lyrics tabs to adopt the
new shell.


### Cloud library and local project copies

Paired release `20261021_161630` on 2026-10-21 publishes revision 16 from
application commit `0c6f5b5`. Projects now resolve current cloud library songs;
confirmed song edits update the library, project Save also refreshes existing
local copies, and library deletion removes all cloud project occurrences. The
UI provides the top-bar local-copy directory control, recording versions,
identity-checked song copies and per-card playback.

The backend adds only the `deleted_song_uploads` retry-key table. Independent
old/new/old store initialization confirmed additive-schema rollback compatibility;
existing songs/projects are not rewritten during startup. All 55 staged hashes
and locked runtime inputs were independently checked. Activation selected both
new links and the API remains active. The previous pair `20261021_151151` is
retained for rollback through its paired activator.

All 39 production HTTPS source/health/access/MIME checks passed. An isolated
production browser passed anonymous library gating, local directory-backed ZIP
import/backing playback, keyboard pause and narrow layout without production API
writes or browser errors. Authenticated cloud writes were verified against the
disposable local test API; private school songs/projects were not changed by
smoke checks. Close and reopen existing tabs to adopt the new shell. Native OS
folder-picker interaction remains a manual platform check.


### Cue ordering, interludes and library sorting

Paired release `20261021_235101` on 2026-10-22 publishes revision 17 from
application commit `bfd76a8`, pushed to `codex/local-cloud-workspace`. It adds
row drag/arrows, row-level `+ ♪` interlude insertion, three spaced animated notes
in timed display and six library sort orders with original creation dates.
Backend metadata changes introduce no schema migration; pinned runtime inputs
are unchanged. Independent review accepted all 58 staged manifest hashes and
committed/generated file inventories. The previous pair `20261021_161630`
remains available for rollback.

All 110 frontend unit tests, 24 API tests, the authenticated feature/cloud-library
browser suites and display-controls regression passed locally. Activation, paired
link/service checks, 42 production HTTPS source/health/access/MIME checks and an
isolated production browser passed. The live browser verified row insertion,
three notes, local-directory ZIP/backing playback, keyboard pause and narrow
layout without production API writes. Private school data was not changed by
smoke checks. Close and reopen existing tabs to adopt the new cached shell.

### Focused project and song editing release

Paired release `20261022_210520` on 2026-10-23 publishes revision 18 from
application commit `601a310`. It replaces the local-folder label with a
hard-drive icon, removes whole-project import/export, improves stale-project
cleanup, saves project edits and existing local copies together, supports song
drag ordering, limits readiness invalidation to timeline/music edits, records
timeline marks from backing playback, and creates song copies from library cards.

The API source and runtime are unchanged. The exact hash-pinned runtime from
`20261021_235101` was reused and its files matched the active server runtime. The
runtime refresh helper stopped because the upstream get-pip checksum differed;
the pinned checksum was not changed. The frontend build and paired preparation
passed. Production checks returned 200 for the lyrics page, API health, JavaScript
and CSS, and 401 for anonymous project/audio requests. Automated feature tests,
browser UI scenarios, authenticated cloud writes and native folder-picker
interaction were not run. The previous pair `20261021_235101` remains available
for rollback. Close and reopen existing lyrics tabs to adopt the new shell.

### Library and project recovery release

Paired release `20261022_213226` on 2026-10-23 publishes revision 19 from
application commit `72c4797`. It simplifies cloud-library song editing and copy
titles, keeps the current cloud project authoritative on entry, prompts before
leaving a project with unsaved changes, and refreshes linked local copies after
cloud changes and successful saves. It also adjusts readiness controls and the
local-folder tooltip. The API source/runtime match release `20261022_210520`; no
schema change was needed.

Build, staging checks and paired activation passed. Production HTTP checks
returned 200 for the lyrics page, API health, `app.js` and `hub.css`. Static
JavaScript syntax checks and `git diff --check` passed. Automated behavior suites
and manual browser scenarios were not run. The previous pair
`20261022_210520` remains available for rollback. Close and reopen existing
lyrics tabs to adopt the new shell.

### Direct card navigation and display library controls

Paired release `20261022_215117` on 2026-10-23 (Europe/Moscow) publishes
revision 20 from application commit `d199e7e`. Project/song cards open directly;
library-song editing shows the searchable, sorted online library; display mode
lists the full online library when launched from it and returns home to the
launching section. Start/mute shortcuts were removed, stop/reset requires a
double-click, and the display library no longer offers `Другой проект`.

The API source and locked runtime match release `20261022_213226`; no schema
change was needed. `pnpm build`, paired staging/preparation and activation passed.
The 58-entry release manifest SHA-256 is
`efd9d00d2d98595f843ecde55e43f42dabd46648f39542af4df88e47e0549574`. Production
checks returned 200 for `/lyrics/`, API health, updated JS/CSS, the main site and
health endpoint, and MJS/WASM assets. Anonymous project/audio API requests
returned 401. The published public assets match the locally staged hashes. The
previous pair `20261022_213226` remains available for rollback. Automated behavior
suites, authenticated save/reopen, offline Start and manual browser acceptance
were not run. Close and reopen existing lyrics tabs to adopt the new shell.

### Library editing and preparation toolbar release

Paired release `20261022_221927` on 2026-10-23 publishes revisions 21 and 22
from application commit `444f224`. It fixes readiness and project-song entries
in the display media menu, changes project and song card actions to icon
controls, removes the project-location filter, and adds dirty-state protection
and top-menu save/delete actions to online-song editing. The preparation toolbar
now groups status, tabs, song actions, and site settings; project Play and Add
are in the toolbar, and online-library song preparation has a gated Play action.

Backend source and locked runtime match `20261022_215117`; there is no schema
change. Frontend build, paired staging, checksum validation, API preparation,
and activation passed. Production returned 200 for `/lyrics/`, API health, the
main site and its health endpoint, app JavaScript and CSS; anonymous project
access returned 401. SHA-256 checks for the five changed public assets matched
the local build. The previous pair `20261022_215117` remains available for
rollback. Automated behavior suites and manual browser acceptance were not run.
Close and reopen existing lyrics tabs to adopt the new shell.

### Online library song playback toolbar follow-up

Paired release `20261022_222801` on 2026-10-23 publishes the online-library preparation
toolbar refinement. Its order is Save, Play, Delete. Play is enabled only for a ready,
saved library song; other statuses disable it and show the `сначала сохраните изменения`
tooltip. The copy-card action uses the standard copy icon with a tooltip. The frontend
SVG symbol definitions are placed in `<defs>` so icon references render. Backend source
and locked runtime match `20261022_221927`; no schema change was needed.

The frontend build, paired staging and checksum validation, API preparation, and
activation passed. Production returned 200 for `/lyrics/`, API health, app JavaScript and
CSS; anonymous project access returned 401. SHA-256 checks for `index.html`, `app.js`,
and `workspace-hub.js` matched the local build. Browser behavior suites and manual
browser acceptance were not run. The previous pair `20261022_221927` remains available
for rollback. Close and reopen existing tabs to adopt the new shell.

### Service worker cache refresh follow-up

Paired release `20261022_223209` on 2026-10-23 fixes stale frontend assets left by
older service workers. The build now embeds its content version in `sw.js`, and
service-worker registration bypasses the HTTP cache for the worker and its imported
manifest. This ensures a subsequent worker update installs a shell whose CSS matches
the HTML and JavaScript. The backend source and locked runtime match
`20261022_222801`; no schema change was needed.

The frontend build, paired staging and checksum validation, API preparation, and
activation passed. Production returned 200 for `/lyrics/`, API health, app JavaScript,
CSS, and the service worker; anonymous project access returned 401. SHA-256 checks for
`sw.js`, `styles.css`, and `app.js` matched the local build. In a fresh browser tab after
closing the prior client, SVG icon styles loaded at 22 by 22 pixels with the expected
stroke. The previous pair `20261022_222801` remains available for rollback. Close and
reopen existing tabs to adopt the new shell.
