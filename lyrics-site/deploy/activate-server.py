#!/usr/bin/env python3
"""Unprivileged paired API/frontend activation after the one-time installer."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

BASE = Path('/srv/nasty-edu-lyrics')
STAGE = Path(__file__).resolve().parent


def link(path, target):
    temporary = path.parent / ('.' + path.name + '-' + uuid.uuid4().hex)
    temporary.symlink_to(target)
    os.replace(temporary, path)


def restart():
    subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/systemctl', 'restart', 'kaada-lyrics-api.service'], check=True, timeout=60)


def healthy():
    # The first backing-track migration creates a protected, consistent backup
    # before touching the database. Large private libraries need time to snapshot.
    deadline = time.monotonic() + 180
    while True:
        if subprocess.run(['/usr/bin/curl', '-q', '--noproxy', '*', '--fail', '--silent', '--max-time', '3',
                           '-o', '/dev/null', 'http://127.0.0.1:8096/health'], timeout=4).returncode == 0:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError('API did not become healthy.')
        time.sleep(1)


def main():
    if os.geteuid() == 0:
        raise SystemExit('Activate as the deploy user, not root.')
    release_id = (STAGE / 'RELEASE_ID').read_text().strip()
    if not re.fullmatch(r'[0-9]{8}_[0-9]{6}', release_id):
        raise SystemExit('Invalid release ID.')
    for name in ('releases', 'backend-releases'):
        if (BASE / name).is_symlink() or not (BASE / name).is_dir():
            raise SystemExit('Unsafe release parent.')
    manifest = json.loads((STAGE / 'SERVER-SHA256.json').read_text())
    actual = {}
    for name, prefix in (('releases', 'release'), ('backend-releases', 'service')):
        directory = BASE / name / release_id
        if directory.is_symlink() or not directory.is_dir():
            raise SystemExit('Prepare real release directories first.')
        scanned = [directory] if name == 'releases' else [directory / 'backend', directory / 'runtime']
        for path in (path for source in scanned for path in source.rglob('*')):
            if path.is_symlink() or (not path.is_file() and not path.is_dir()):
                raise SystemExit('Release contains a symlink or special file.')
            if path.is_file():
                actual[prefix + '/' + path.relative_to(directory).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != manifest:
        raise SystemExit('Prepared release checksum mismatch.')
    with open(BASE / '.server-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        frontend, backend = BASE / 'current', BASE / 'backend-current'
        previous_front, previous_back = os.readlink(frontend), os.readlink(backend)
        if not re.fullmatch(r'releases/[0-9]{8}_[0-9]{6}', previous_front) or not re.fullmatch(r'backend-releases/[0-9]{8}_[0-9]{6}', previous_back):
            raise SystemExit('Unexpected active-release link.')
        try:
            link(backend, 'backend-releases/' + release_id)
            restart()
            healthy()
            link(frontend, 'releases/' + release_id)
            subprocess.run(['/usr/bin/curl', '-q', '--fail', '--silent', '--show-error', '--max-time', '10',
                            '-o', '/dev/null', 'https://nasty-edu.online/lyrics/'], check=True, timeout=15)
        except BaseException:
            link(frontend, previous_front)
            link(backend, previous_back)
            restart()
            healthy()
            raise
    print(f'Activated paired lyrics release {release_id}; prior frontend {previous_front}, API {previous_back}.')


if __name__ == '__main__':
    main()
