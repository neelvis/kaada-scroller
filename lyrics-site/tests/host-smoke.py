"""Isolated Linux host probe; never selects production links or uses real credentials."""
import hashlib
import json
import os
from pathlib import Path
import resource
import struct
import subprocess
import sys
import tempfile
import time

import httpx

release = Path(sys.argv[1]).resolve()
limit = 256 * 1024 * 1024
def constrain():
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))

with tempfile.TemporaryDirectory(prefix='lyrics-host-probe-') as temporary:
    root = Path(temporary)
    password = 'test-only organizer password'
    salt = bytes(range(16))
    credential = root / 'credentials.json'
    credential.write_text(json.dumps({'salt': salt.hex(), 'hash': hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32).hex()}))
    credential.chmod(0o600)
    env = {**os.environ, 'LYRICS_DATA_DIR': str(root / 'data'), 'LYRICS_PASSWORD_FILE': str(credential), 'LYRICS_ORIGIN': 'http://127.0.0.1:8099', 'LYRICS_COOKIE_PATH': '/', 'LYRICS_COOKIE_SECURE': 'false', 'PYTHONDONTWRITEBYTECODE': '1'}
    with (root / 'service.log').open('w+') as log:
        process = subprocess.Popen([str(release / '.venv/bin/python'), '-m', 'uvicorn', 'backend.app:app', '--host', '127.0.0.1', '--port', '8099', '--no-access-log'], cwd=release, env=env, stdout=log, stderr=log, preexec_fn=constrain)
        try:
            with httpx.Client(base_url='http://127.0.0.1:8099', timeout=120) as client:
                for _ in range(60):
                    try:
                        if client.get('/health').status_code == 200: break
                    except httpx.TransportError: pass
                    if process.poll() is not None:
                        log.seek(0); raise RuntimeError(log.read())
                    time.sleep(.25)
                else: raise RuntimeError('Probe API did not start.')
                assert client.get('/projects').status_code == 401
                headers = {'Origin': env['LYRICS_ORIGIN'], 'X-Lyrics-Request': '1'}
                response = client.post('/login', headers=headers, json={'password': password})
                assert response.status_code == 200, response.text
                headers['X-Lyrics-CSRF'] = response.json()['csrf']
                size = 150 * 1024 * 1024
                data_size = size - 44
                reference = root / 'large.wav'
                with reference.open('wb') as audio:
                    audio.write(struct.pack('<4sI4s4sIHHIIHH4sI', b'RIFF', size-8, b'WAVE', b'fmt ', 16, 1, 2, 44100, 176400, 4, 16, b'data', data_size))
                    audio.seek(size-1); audio.write(b'\0')
                def chunks():
                    with reference.open('rb') as audio:
                        for chunk in iter(lambda: audio.read(64 * 1024), b''): yield chunk
                began = time.monotonic()
                uploaded = client.post('/audio', headers={**headers, 'Content-Type': 'audio/wav', 'Content-Length': str(size), 'X-Lyrics-Filename': 'near-limit.wav'}, content=chunks())
                assert uploaded.status_code == 201, uploaded.text
                ident = uploaded.json()['id']
                ranged = client.get('/audio/' + ident, headers={'Range': 'bytes=0-43'})
                assert ranged.status_code == 206 and ranged.headers['content-type'] == 'audio/wav'
                assert len(ranged.content) == 44
                assert client.get('/health').status_code == 200
                status = Path(f'/proc/{process.pid}/status').read_text()
                rss = next(line for line in status.splitlines() if line.startswith('VmRSS:'))
                print(f'PASS Python {sys.version.split()[0]}: auth, 150 MiB streamed upload, WAV range; {rss}; {time.monotonic()-began:.1f}s; 256 MiB address-space cap.')
        finally:
            process.terminate()
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
