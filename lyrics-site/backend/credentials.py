from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path


def make_scrypt(password: str, *, salt: bytes | None = None) -> str:
    if len(password) < 12:
        raise ValueError("Use an organizer password of at least 12 characters.")
    salt = salt or os.urandom(16)
    n, r, p = 2**14, 8, 1
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=32)
    b64 = lambda data: base64.urlsafe_b64encode(data).decode("ascii")
    return f"scrypt${n}${r}${p}${b64(salt)}${b64(digest)}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a timed-lyrics password hash without echoing the password.")
    parser.add_argument("--output", type=Path, help="write private credentials JSON to this file")
    args = parser.parse_args()
    first = getpass.getpass("Organizer password: ")
    second = getpass.getpass("Repeat organizer password: ")
    if first != second:
        raise SystemExit("Passwords did not match.")
    if args.output:
        encoded = make_scrypt(first).split("$")
        payload = {"salt": base64.urlsafe_b64decode(encoded[4]).hex(), "hash": base64.urlsafe_b64decode(encoded[5]).hex()}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        os.chmod(args.output, 0o600)
    else:
        print("Use --output /private/path/credentials.json; credentials are not printed.")


if __name__ == "__main__":
    main()
