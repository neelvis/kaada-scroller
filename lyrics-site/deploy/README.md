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
