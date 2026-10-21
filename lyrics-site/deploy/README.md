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
