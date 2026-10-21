#!/usr/bin/env python3
"""One-time, administrator-run mount of the separate public lyrics artifact."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import time

STAGE = Path(__file__).resolve().parent
BASE = Path('/srv/nasty-edu-lyrics')
CONFIG = Path('/etc/nginx/sites-enabled/nasty-edu.online').resolve()
MARKER = '# BEGIN KAADA LYRICS'
REQUIRED = {'index.html', 'app.js', 'core.js', 'storage.js', 'styles.css',
            'recognition.js', 'recognition-worker.js', 'recognition-utils.js',
            'workspace-files.js', 'local-workspace.js', 'workspace-hub.js', 'workspace-actions.js', 'song-editor.js', 'cloud-transfers.js', 'ui.js', 'hub.css',
            'sw.js', 'cache-manifest.js', 'vendor/transformers.js',
            'vendor/ort-wasm-simd-threaded.jsep.mjs', 'vendor/ort-wasm-simd-threaded.jsep.wasm'}
LOCATION = '''    # BEGIN KAADA LYRICS
    location = /lyrics { return 301 /lyrics/$is_args$args; }
    location ^~ /lyrics/ {
        alias /srv/nasty-edu-lyrics/current/;
        index index.html;
        autoindex off;
        include /etc/nginx/mime.types;
        types { application/javascript mjs; }
        add_header Cache-Control "no-cache";
    }
    # END KAADA LYRICS

'''


def run(*args):
    subprocess.run(args, check=True, timeout=30)


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run this once with sudo in an interactive terminal.')
    release_id = (STAGE / 'RELEASE_ID').read_text().strip()
    if not re.fullmatch(r'[0-9]{8}_[0-9]{6}', release_id):
        raise SystemExit('Invalid release identity.')
    source = STAGE / 'release'
    if source.is_symlink():
        raise SystemExit('Staged release must be a real directory.')
    manifest = json.loads((STAGE / 'SHA256.json').read_text())
    files = [p for p in source.rglob('*') if p.is_file()]
    if any(p.is_symlink() for p in source.rglob('*')):
        raise SystemExit('Release must not contain symlinks.')
    actual = {p.relative_to(source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
    if actual != manifest or not REQUIRED.issubset(actual):
        raise SystemExit('Incomplete or changed artifact. Checksums did not match.')
    original = CONFIG.read_bytes()
    text = original.decode()
    if MARKER in text or text.count('    location / {') != 1:
        raise SystemExit('Host configuration changed or lyrics already mounted. Inspect before proceeding.')
    identity = pwd.getpwnam('elvis')
    if BASE.is_symlink():
        raise SystemExit('Host base must not be a symlink.')
    BASE.mkdir(mode=0o755, exist_ok=True)
    releases = BASE / 'releases'
    if releases.is_symlink():
        raise SystemExit('Release parent must not be a symlink.')
    releases.mkdir(mode=0o755, exist_ok=True)
    for path in (BASE, releases):
        os.chown(path, identity.pw_uid, identity.pw_gid)
        path.chmod(0o755)
    destination = releases / release_id
    if destination.is_symlink():
        raise SystemExit('Release directory must not be a symlink.')
    already_present = destination.exists()
    if already_present:
        deployed = {p.relative_to(destination).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                    for p in destination.rglob('*') if p.is_file()}
        if deployed != manifest or any(p.is_symlink() for p in destination.rglob('*')):
            raise SystemExit('Existing release differs; no overwrite performed.')
    else:
        shutil.copytree(source, destination)
    if not already_present:
        for path in (destination, *destination.rglob('*')):
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fchown(descriptor, identity.pw_uid, identity.pw_gid)
                os.fchmod(descriptor, 0o755 if path.is_dir() else 0o644)
            finally:
                os.close(descriptor)
    current = BASE / 'current'
    previous = os.readlink(current) if current.is_symlink() else None
    if current.exists() and previous is None:
        raise SystemExit('Current is not a release symlink.')
    temporary = BASE / f'.current-{release_id}'
    temporary.symlink_to('releases/' + release_id)
    os.lchown(temporary, identity.pw_uid, identity.pw_gid)
    backup = CONFIG.with_name(CONFIG.name + f'.before-lyrics-{int(time.time())}')
    shutil.copy2(CONFIG, backup)
    try:
        os.replace(temporary, current)
        CONFIG.write_text(text.replace('    location / {', LOCATION + '    location / {', 1))
        run('/usr/sbin/nginx', '-t')
        run('/usr/bin/systemctl', 'reload', 'nginx')
        # Reload is graceful: a first request may still reach an old worker.
        deadline = time.monotonic() + 30
        while True:
            try:
                run('/usr/bin/curl', '-q', '--noproxy', '*', '--fail', '--silent', '--show-error', '--max-time', '5',
                    '--resolve', 'nasty-edu.online:443:127.0.0.1', '-o', '/dev/null',
                    'https://nasty-edu.online/lyrics/')
                break
            except subprocess.CalledProcessError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(1)
    except BaseException:
        CONFIG.write_bytes(original)
        if previous is not None:
            temporary.symlink_to(previous)
            os.replace(temporary, current)
        elif current.is_symlink():
            current.unlink()
        run('/usr/sbin/nginx', '-t')
        run('/usr/bin/systemctl', 'reload', 'nginx')
        raise
    print(f'Lyrics mounted: https://nasty-edu.online/lyrics/; release {release_id}.')
    print(f'Nginx configuration backup: {backup}')


if __name__ == '__main__':
    main()
