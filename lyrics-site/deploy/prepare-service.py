#!/usr/bin/env python3
"""Prepare immutable frontend/API source and a private unprivileged runtime."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

BASE = Path('/srv/nasty-edu-lyrics')
STAGE = Path(__file__).resolve().parent
REQUIRED = {'release/index.html', 'release/app.js', 'release/remote.js',
            'release/sw.js', 'release/cache-manifest.js',
            'service/backend/app.py', 'service/backend/requirements-lock.txt', 'service/runtime/get-pip.py'}


def source_manifest(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise SystemExit('Release source must be a directory.')
    result = {}
    for path in directory.rglob('*'):
        if path.is_symlink():
            raise SystemExit('Release cannot contain symlinks.')
        if path.is_file():
            result[path.relative_to(directory).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
        elif not path.is_dir():
            raise SystemExit('Release cannot contain special files.')
    return result


def main():
    if os.geteuid() == 0:
        raise SystemExit('Prepare as the deploy user, never as root.')
    release_id = (STAGE / 'RELEASE_ID').read_text().strip()
    if not re.fullmatch(r'[0-9]{8}_[0-9]{6}', release_id):
        raise SystemExit('Invalid release ID.')
    manifest = json.loads((STAGE / 'SERVER-SHA256.json').read_text())
    actual = {}
    for name in ('release', 'service'):
        actual.update({name + '/' + key: value for key, value in source_manifest(STAGE / name).items()})
    if actual != manifest or not REQUIRED.issubset(actual):
        raise SystemExit('Missing files or checksum mismatch.')
    for name in ('releases', 'backend-releases'):
        parent = BASE / name
        if parent.is_symlink():
            raise SystemExit('Release parent must not be a symlink.')
        parent.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name, parent in (('release', 'releases'), ('service', 'backend-releases')):
        destination = BASE / parent / release_id
        if destination.exists() or destination.is_symlink():
            raise SystemExit('A release already exists. Use a fresh release ID.')
        shutil.copytree(STAGE / name, destination)
        for path in (destination, *destination.rglob('*')):
            path.chmod(0o755 if path.is_dir() else 0o644)
    service = BASE / 'backend-releases' / release_id
    runtime = service / '.venv'
    created = subprocess.run(['/usr/bin/python3', '-m', 'venv', str(runtime)], capture_output=True)
    if created.returncode == 0:
        installer = [str(runtime / 'bin/python'), '-m', 'pip']
    else:
        # Minimal Ubuntu omits ensurepip. Bootstrap pip inside this isolated
        # unprivileged venv using the maintainers' supported get-pip method.
        subprocess.run(['/usr/bin/python3', '-m', 'venv', '--without-pip', str(runtime)], check=True)
        bootstrap = service / 'runtime/get-pip.py'
        subprocess.run([str(runtime / 'bin/python'), str(bootstrap), '--no-setuptools', '--no-wheel', '--disable-pip-version-check', '--no-cache-dir',
                        '--no-index', '--find-links', str(service / 'runtime/wheels'), 'pip==25.3'], check=True)
        installer = [str(runtime / 'bin/python'), '-m', 'pip']
    subprocess.run(installer + ['install', '--disable-pip-version-check', '--no-cache-dir', '--require-hashes',
                               '--no-index', '--find-links', str(service / 'runtime/wheels'),
                               '-r', str(service / 'backend/requirements-lock.txt')], check=True)
    print(f'Prepared frontend and API {release_id}; no live links were changed.')


if __name__ == '__main__':
    main()
