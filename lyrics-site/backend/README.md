# Timed lyrics private API

This Python service owns the authoritative cloud song library, cloud projects and
private reference recordings. Cloud projects contain library song identities and
resolve their latest saved versions when read. The service is separate from
static files and must run with a private writable data directory.

Install the pinned dependencies and run from `lyrics-site`:

```sh
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
LYRICS_DATA_DIR=/var/lib/kaada-lyrics \
LYRICS_PASSWORD_FILE=/var/lib/kaada-lyrics/credentials.json \
LYRICS_ORIGIN=https://nasty-edu.online \
LYRICS_COOKIE_PATH=/lyrics/api/ \
LYRICS_COOKIE_SECURE=true \
backend/.venv/bin/uvicorn backend.app:app --host 127.0.0.1 --port 8096
```

Create the credentials file interactively without displaying the password:

```sh
backend/.venv/bin/python -m backend.credentials --output /var/lib/kaada-lyrics/credentials.json
```

`credentials.json` is mode 0600 JSON with fixed fields `salt` and `hash` (hex), created with `hashlib.scrypt(password, n=16384, r=8, p=1, dklen=32)`. `LYRICS_PASSWORD_SCRYPT` also supports the self-contained `scrypt$N$r$p$saltBase64$hashBase64` form for local tests. Other environment variables are `LYRICS_COOKIE_PREFIX` (default `lyrics`) and `LYRICS_QUOTA_BYTES` (default 1 GiB).

The process receives paths after proxy stripping: `/login`, `/projects`, and so on. It rejects cross-origin writes, requires `X-Lyrics-Request: 1`, then requires the session CSRF value in `X-Lyrics-CSRF` for each authenticated write. The session cookie is HttpOnly, SameSite Strict, Secure when configured, and path-scoped to the API mount.

Each MP3/WAV recording is limited to 15 MiB. Projects have no aggregate audio-byte cap in portable export/import or local storage. The configured server-wide library quota remains separate.

Audio uploads are streamed into private temporary files while SQLite reservations cap the combined completed and in-flight bytes at the configured quota. The SHA-256 content hash makes a lost-response retry return the original audio ID. WAV and MP3 MIME types are retained for playback. `POST /audio/cleanup` accepts `{"keepAudioIds":[...]}` and deletes only this session's uploads that are neither referenced by an immutable song revision nor listed by that browser's current draft.

Back up only while the service is stopped (or use a filesystem snapshot), then validate a restore in a fresh directory:

```sh
backend/.venv/bin/python -m backend.backup create /var/lib/kaada-lyrics /secure/lyrics-$(date +%F).tar.gz
backend/.venv/bin/python -m backend.backup restore /secure/lyrics-2026-10-12.tar.gz /tmp/lyrics-restore-check
```

The archive includes a SQLite consistent snapshot, private audio bytes and SHA-256 manifest. Restore validates every byte before replacing the target directory.

The normal archive deliberately excludes `credentials.json`. Keep that private password-hash file in a separate protected backup. When restoring onto an existing data directory, its regular `credentials.json` is retained with its file mode; restoring to a new directory requires placing the credential file there separately before starting the service.

Run the focused API checks from `lyrics-site` with:

```sh
backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

## Backing tracks (revision 4)

Project/song entries expose optional `backingAudioId` separately from the original
`audioId`. Backing files use the existing authenticated upload, streaming and quota
paths. A nullable SQLite migration adds the backing link to immutable song
revisions. Old project records remain valid. An older client omitting the field
preserves the backing from its selected revision; an explicit null unlinks it.
The server supplies the backing filename from audio metadata. Deletion and orphan
cleanup consider references in both roles, including older pinned revisions.

Backup/restore includes and validates both audio roles. Revision-3 archives remain
readable and receive the nullable migration when opened. Publish revision-4 viewer
and API together; data remains outside release directories as before.

## Cloud library and project writes

Authenticated `POST /songs` accepts `migrationKey`, `song`, and optional `audioId`
and `backingAudioId`. It creates a separate cloud library song, without creating a
project, and commits the song and retry key together: 201 for creation, 200 for a
replay of that key. A persistent mapping returns the original uploaded revision
after later edits. A retry key is tombstoned if its song is deleted, so retrying
that upload cannot recreate the deleted song.

`PUT /songs/{songId}` accepts the reviewed `revisionId`, `song`, and optional audio
links. It advances the same library song only from the reviewed revision. A
divergent stale update returns 409 without changing content; an exact replay
returns the existing head. Omitted audio links retain the prior links, while
explicit null clears them. New heads must pass readiness checks and cannot
duplicate another current library song's title, artist and recording version.
Identity fields are trimmed for the comparison; case and internal spaces remain
significant.

`DELETE /songs/{songId}` removes the song and every occurrence in cloud projects.
Each affected project revision increments, so a previously opened project save is
rejected as stale. A stale save that still names the deleted song receives a
missing-song response instead of restoring it. Song deletion removes audio files
only when no remaining song revision refers to them. Local project snapshots are
separate files and are not remotely deleted.

`GET /projects/{projectId}` returns each project's songs at their latest library
heads. `PUT /projects/{projectId}` checks the project revision, saves membership
and order atomically, and applies readiness validation to new or changed songs.
An unchanged older song entry resolves to its current head; a conflicting edit
based on an older song revision returns 409. A project-structure update may keep
an unchanged legacy song that is not ready, but any new or changed song must be
ready and valid. Duplicate identity checks are serialized with revision writes,
including concurrent requests.

`GET /library` returns current song metadata, including optional `version`,
`reviewed` and `valid` fields, plus `createdAt` as an ISO UTC timestamp from the
original cloud song creation. Subsequent revisions retain that date; copies have
their own. The frontend uses it for library date sorting. Its `q` filter matches
title, artist or version.
Duplicate identity is the trimmed tuple of title, artist and version; missing
artist or version is treated as empty. Existing duplicates are not merged
automatically.

All writes continue to require the existing Origin, CSRF and private-session
checks. These cloud-library and current-project rules are specified in
[timed lyrics revision 16](../../specs/features/timed-lyrics/revision-16.md).
