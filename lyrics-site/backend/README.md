# Timed lyrics private API

This small Python service owns the shared organizer library, project pins and private reference recordings. It is separate from static files and must run with a private writable data directory.

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
