#!/usr/bin/env python3
"""Administrator-only first mount of the private shared-project service."""
import getpass
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import time
import uuid

STAGE = Path(__file__).resolve().parent
STAGING_ROOT = Path('/home/elvis/deploy-artifacts/kaada-lyrics')
BASE = Path('/srv/nasty-edu-lyrics')
DATA = Path('/var/lib/kaada-lyrics')
CONFIG = Path('/etc/nginx/sites-enabled/nasty-edu.online').resolve()
UNIT = Path('/etc/systemd/system/kaada-lyrics-api.service')
ENVIRONMENT = Path('/etc/kaada-lyrics-api.env')
SUDOERS = Path('/etc/sudoers.d/kaada-lyrics-api')
MARKER = '# BEGIN KAADA LYRICS API'
LOCATION = '''    # BEGIN KAADA LYRICS API
    location ^~ /lyrics/api/ {
        proxy_pass http://127.0.0.1:8096/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_request_buffering off;
        proxy_buffering off;
        client_max_body_size 151m;
        proxy_read_timeout 180s;
        add_header Cache-Control "no-store" always;
    }
    # END KAADA LYRICS API

'''
SERVICE = '''# Managed by the independent timed-lyrics deployment
[Unit]
Description=Private timed-lyrics projects API
After=network.target
[Service]
Type=simple
User=kaada-lyrics
Group=kaada-lyrics
WorkingDirectory=/srv/nasty-edu-lyrics/backend-current
EnvironmentFile=/etc/kaada-lyrics-api.env
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/srv/nasty-edu-lyrics/backend-current/.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8096 --proxy-headers --forwarded-allow-ips 127.0.0.1 --no-access-log
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/kaada-lyrics
MemoryMax=256M
TasksMax=64
[Install]
WantedBy=multi-user.target
'''
ENV = '''LYRICS_DATA_DIR=/var/lib/kaada-lyrics
LYRICS_PASSWORD_FILE=/var/lib/kaada-lyrics/credentials.json
LYRICS_ORIGIN=https://nasty-edu.online
LYRICS_COOKIE_PREFIX=kaada_lyrics
LYRICS_COOKIE_PATH=/lyrics/api/
LYRICS_COOKIE_SECURE=true
LYRICS_QUOTA_BYTES=1073741824
'''


def run(*args):
    subprocess.run(args, check=True, timeout=60)


def files(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise SystemExit('Release paths must be real directories.')
    result = {}
    for path in directory.rglob('*'):
        if path.is_symlink() or (not path.is_file() and not path.is_dir()):
            raise SystemExit('Release source contains a symlink or special file.')
        if path.is_file():
            result[path.relative_to(directory).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def atomic_link(path, target):
    temporary = path.parent / ('.' + path.name + '-' + uuid.uuid4().hex)
    temporary.symlink_to(target)
    try:
        os.replace(temporary, path)
    finally:
        if temporary.is_symlink():
            temporary.unlink()


def prior_link(path, expected):
    if path.is_symlink():
        value = os.readlink(path)
        if not re.fullmatch(expected + r'/[0-9]{8}_[0-9]{6}', value):
            raise SystemExit('Unexpected release link; inspect before proceeding.')
        return value
    if path.exists():
        raise SystemExit('Current must be a release symlink.')
    return None


def health(url, *, local=False):
    deadline = time.monotonic() + 30
    while True:
        args = ['/usr/bin/curl', '-q', '--noproxy', '*', '--fail', '--silent', '--show-error',
                '--max-time', '4', '-o', '/dev/null']
        if local:
            args += ['--resolve', 'nasty-edu.online:443:127.0.0.1']
        result = subprocess.run(args + [url], timeout=5)
        if result.returncode == 0:
            return
        if time.monotonic() >= deadline:
            raise RuntimeError('Service/host health did not become ready; restoring previous configuration.')
        time.sleep(1)


def private_write(path, content, *, mode=0o600, uid=0, gid=0):
    if path.is_symlink():
        raise SystemExit('Refusing a symlinked configuration path.')
    temporary = path.with_name('.' + path.name + '-' + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        os.write(descriptor, content.encode())
        os.fchown(descriptor, uid, gid)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.replace(temporary, path)


def remove_staged_artifact(release_id):
    """Remove only this project's uploaded artifact after a live release."""
    expected = STAGING_ROOT / release_id
    if STAGE != expected:
        raise RuntimeError(f'Unexpected staged artifact directory: {STAGE}')
    shutil.rmtree(STAGE)


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run this installer with sudo in an interactive terminal.')
    release_id = (STAGE / 'RELEASE_ID').read_text().strip()
    if not re.fullmatch(r'[0-9]{8}_[0-9]{6}', release_id):
        raise SystemExit('Invalid release ID.')
    for path in (BASE, BASE / 'releases', BASE / 'backend-releases', BASE / 'backend-releases' / release_id):
        if path.is_symlink() or not path.is_dir():
            raise SystemExit('Prepare real release directories before installation.')
    manifest = json.loads((STAGE / 'SERVER-SHA256.json').read_text())
    actual = {'release/' + key: value for key, value in files(BASE / 'releases' / release_id).items()}
    actual.update({'service/backend/' + key: value for key, value in files(BASE / 'backend-releases' / release_id / 'backend').items()})
    actual.update({'service/runtime/' + key: value for key, value in files(BASE / 'backend-releases' / release_id / 'runtime').items()})
    if actual != manifest or not {'release/index.html', 'release/remote.js', 'service/backend/app.py'}.issubset(actual):
        raise SystemExit('Prepared sources do not match staged checksums.')
    if not (BASE / 'backend-releases' / release_id / '.venv/bin/python').exists():
        raise SystemExit('Prepare the unprivileged API runtime first.')
    original = CONFIG.read_bytes()
    text = original.decode()
    if MARKER in text or text.count('    # BEGIN KAADA LYRICS\n') != 1:
        raise SystemExit('API already mounted or host configuration changed; use normal activation.')
    old_front = prior_link(BASE / 'current', 'releases')
    old_back = prior_link(BASE / 'backend-current', 'backend-releases')
    if old_front is None:
        raise SystemExit('Existing lyrics frontend mount is required.')
    for path in (DATA, UNIT, ENVIRONMENT, SUDOERS):
        if path.is_symlink():
            raise SystemExit('Refusing symlinked service configuration/data.')
    for path in (UNIT, ENVIRONMENT, SUDOERS):
        if path.exists():
            raise SystemExit('Service configuration already exists; inspect before initial installation.')
    try:
        identity = pwd.getpwnam('kaada-lyrics')
    except KeyError:
        run('/usr/sbin/useradd', '--system', '--home-dir', str(DATA), '--no-create-home', '--shell', '/usr/sbin/nologin', 'kaada-lyrics')
        identity = pwd.getpwnam('kaada-lyrics')
    DATA.mkdir(mode=0o750, exist_ok=True)
    os.chown(DATA, identity.pw_uid, identity.pw_gid)
    DATA.chmod(0o750)
    credential = DATA / 'credentials.json'
    if credential.is_symlink():
        raise SystemExit('Credential file must not be a symlink.')
    if not credential.exists():
        while True:
            password = getpass.getpass('Choose the shared organizer password (at least 12 characters): ')
            repeat = getpass.getpass('Repeat organizer password: ')
            if password == repeat and len(password) >= 12:
                break
            print('Passwords must match and contain at least 12 characters.')
        salt = os.urandom(16)
        digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)
        del password, repeat
        private_write(credential, json.dumps({'salt': salt.hex(), 'hash': digest.hex()}) + '\n', uid=identity.pw_uid, gid=identity.pw_gid)
    backup = CONFIG.with_name(CONFIG.name + f'.before-lyrics-api-{int(time.time())}')
    shutil.copy2(CONFIG, backup)
    try:
        private_write(ENVIRONMENT, ENV, mode=0o640, gid=identity.pw_gid)
        private_write(UNIT, SERVICE, mode=0o644)
        atomic_link(BASE / 'backend-current', 'backend-releases/' + release_id)
        run('/usr/bin/systemctl', 'daemon-reload')
        run('/usr/bin/systemctl', 'start', 'kaada-lyrics-api.service')
        health('http://127.0.0.1:8096/health')
        CONFIG.write_text(text.replace('    # BEGIN KAADA LYRICS\n', LOCATION + '    # BEGIN KAADA LYRICS\n', 1))
        run('/usr/sbin/nginx', '-t')
        run('/usr/bin/systemctl', 'reload', 'nginx')
        health('https://nasty-edu.online/lyrics/api/health', local=True)
        atomic_link(BASE / 'current', 'releases/' + release_id)
        health('https://nasty-edu.online/lyrics/', local=True)
        private_write(SUDOERS, 'elvis ALL=(root) NOPASSWD: /usr/bin/systemctl restart kaada-lyrics-api.service\n', mode=0o440)
        run('/usr/sbin/visudo', '-cf', str(SUDOERS))
        run('/usr/bin/systemctl', 'enable', 'kaada-lyrics-api.service')
    except BaseException:
        CONFIG.write_bytes(original)
        atomic_link(BASE / 'current', old_front)
        subprocess.run(['/usr/bin/systemctl', 'stop', 'kaada-lyrics-api.service'], timeout=30)
        if old_back:
            atomic_link(BASE / 'backend-current', old_back)
        elif (BASE / 'backend-current').is_symlink():
            (BASE / 'backend-current').unlink()
        for path in (UNIT, ENVIRONMENT, SUDOERS):
            if path.is_file() and not path.is_symlink():
                path.unlink()
        run('/usr/bin/systemctl', 'daemon-reload')
        run('/usr/sbin/nginx', '-t')
        run('/usr/bin/systemctl', 'reload', 'nginx')
        raise
    try:
        remove_staged_artifact(release_id)
    except (OSError, RuntimeError) as error:
        print(f'Shared projects published: https://nasty-edu.online/lyrics/; release {release_id}; staged artifact cleanup failed: {error}')
    else:
        print(f'Shared projects published: https://nasty-edu.online/lyrics/; release {release_id}; staged artifact removed.')
    print(f'Organizer password was set privately; Nginx backup: {backup}')


if __name__ == '__main__':
    main()
