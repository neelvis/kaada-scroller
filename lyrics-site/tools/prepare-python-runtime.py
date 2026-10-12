#!/usr/bin/env python3
"""Fetch only hash-locked portable Python wheels and a reviewed pip bootstrap."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent

def main():
    with tempfile.TemporaryDirectory(dir=ROOT / 'backend') as temporary:
        stage = Path(temporary)
        wheels = stage / 'wheels'
        wheels.mkdir()
        subprocess.run([sys.executable, '-m', 'pip', 'download', '--only-binary=:all:', '--no-deps', '--require-hashes',
                        '-r', str(ROOT / 'backend/requirements-lock.txt'), '-d', str(wheels)], check=True)
        bootstrap = stage / 'get-pip.py'
        subprocess.run(['curl', '-q', '--fail', '--silent', '--show-error', '--max-time', '60',
                        'https://bootstrap.pypa.io/get-pip.py', '-o', str(bootstrap)], check=True)
        expected = (ROOT / 'backend/bootstrap-sha256.txt').read_text().split()[0]
        if hashlib.sha256(bootstrap.read_bytes()).hexdigest() != expected:
            raise SystemExit('Bootstrap changed upstream. Review and update its pinned checksum before staging.')
        destination = ROOT / 'backend/runtime-artifacts'
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(stage, destination)
    print('Prepared hash-locked wheels/bootstrap; production installation needs no package network.')

if __name__ == '__main__':
    main()
