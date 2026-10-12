#!/usr/bin/env python3
"""Unprivileged publication after the administrator has mounted /lyrics/."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import uuid

STAGE = Path(__file__).resolve().parent
BASE = Path('/srv/nasty-edu-lyrics')
REQUIRED = {'index.html', 'app.js', 'core.js', 'storage.js', 'styles.css',
            'recognition.js', 'recognition-worker.js', 'recognition-utils.js',
            'sw.js', 'cache-manifest.js', 'vendor/transformers.js',
            'vendor/ort-wasm-simd-threaded.jsep.mjs', 'vendor/ort-wasm-simd-threaded.jsep.wasm'}


def main():
    release_id = (STAGE / 'RELEASE_ID').read_text().strip()
    if not re.fullmatch(r'[0-9]{8}_[0-9]{6}', release_id):
        raise SystemExit('Invalid release ID.')
    source = STAGE / 'release'
    if any(p.is_symlink() for p in source.rglob('*')):
        raise SystemExit('Symlinks are not allowed in a public release.')
    actual = {p.relative_to(source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in source.rglob('*') if p.is_file()}
    if actual != json.loads((STAGE / 'SHA256.json').read_text()) or not REQUIRED.issubset(actual):
        raise SystemExit('Release checksums do not match.')
    current = BASE / 'current'
    previous = os.readlink(current)
    if not re.fullmatch(r'releases/[0-9]{8}_[0-9]{6}', previous):
        raise SystemExit('Unexpected current link; inspect before activation.')
    destination = BASE / 'releases' / release_id
    if destination.exists():
        raise SystemExit('Release already exists; no overwrite performed.')
    shutil.copytree(source, destination)
    temporary = BASE / ('.current-' + uuid.uuid4().hex)
    temporary.symlink_to('releases/' + release_id)
    try:
        os.replace(temporary, current)
        subprocess.run(['/usr/bin/curl', '-q', '--fail', '--silent', '--show-error', '--max-time','15',
                        '-o','/dev/null','https://nasty-edu.online/lyrics/artifact.json'],check=True,timeout=20)
    except BaseException:
        temporary.symlink_to(previous)
        os.replace(temporary,current)
        raise
    print(f'Activated lyrics {release_id}; previous {previous}.')


if __name__ == '__main__':
    main()
