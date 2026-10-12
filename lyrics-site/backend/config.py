from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    password_scrypt: str
    origin: str
    cookie_name: str
    cookie_path: str
    cookie_secure: bool
    quota_bytes: int

    @classmethod
    def from_env(cls) -> "Settings":
        raw_hash = os.environ.get("LYRICS_PASSWORD_SCRYPT", "")
        credential_file = os.environ.get("LYRICS_PASSWORD_FILE", "")
        if credential_file:
            raw_hash = password_file_to_scrypt(Path(credential_file))
        if not raw_hash:
            raise RuntimeError("Set LYRICS_PASSWORD_SCRYPT using python -m backend.credentials.")
        data_dir = Path(os.environ.get("LYRICS_DATA_DIR", "./lyrics-data")).expanduser()
        prefix = os.environ.get("LYRICS_COOKIE_PREFIX", "lyrics")
        return cls(
            data_dir=data_dir,
            password_scrypt=raw_hash,
            origin=os.environ.get("LYRICS_ORIGIN", "http://127.0.0.1:8094").rstrip("/"),
            cookie_name=f"{prefix}_session",
            cookie_path=os.environ.get("LYRICS_COOKIE_PATH", "/api/"),
            cookie_secure=os.environ.get("LYRICS_COOKIE_SECURE", "true").lower() in {"1", "true", "yes"},
            quota_bytes=int(os.environ.get("LYRICS_QUOTA_BYTES", str(1024 * 1024 * 1024))),
        )


def decode_scrypt(value: str) -> tuple[int, int, int, bytes, bytes]:
    """Read the stable `scrypt$N$r$p$salt$hash` configuration format."""
    parts = value.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        raise ValueError("invalid scrypt credential configuration")
    try:
        return int(parts[1]), int(parts[2]), int(parts[3]), base64.urlsafe_b64decode(parts[4]), base64.urlsafe_b64decode(parts[5])
    except (ValueError, TypeError) as exc:
        raise ValueError("invalid scrypt credential configuration") from exc


def password_file_to_scrypt(path: Path) -> str:
    """Read the deployer's non-public credentials JSON without exposing a password."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        salt = bytes.fromhex(raw["salt"])
        digest = bytes.fromhex(raw["hash"])
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise RuntimeError("LYRICS_PASSWORD_FILE is unreadable or invalid.") from exc
    if len(salt) < 16 or len(digest) != 32:
        raise RuntimeError("LYRICS_PASSWORD_FILE is unreadable or invalid.")
    return "scrypt$16384$8$1$%s$%s" % (
        base64.urlsafe_b64encode(salt).decode("ascii"), base64.urlsafe_b64encode(digest).decode("ascii"),
    )
