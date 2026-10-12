"""Offline backup and restore for the private metadata and audio store."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sqlite3
import tarfile
import tempfile
from pathlib import Path


def sha256(path: Path) -> str:
    digest=hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""): digest.update(block)
    return digest.hexdigest()


def backup(data_dir: Path, archive: Path) -> None:
    db=data_dir/"lyrics.sqlite3"; audio=data_dir/"audio"
    if not db.is_file(): raise ValueError("metadata database does not exist")
    with tempfile.TemporaryDirectory(dir=data_dir) as temporary:
        snapshot=Path(temporary)/"lyrics.sqlite3"
        source=sqlite3.connect(db); target=sqlite3.connect(snapshot)
        try: source.backup(target)
        finally: target.close(); source.close()
        files=[snapshot]+sorted(p for p in audio.iterdir() if p.is_file())
        manifest={"format":1,"files":{("metadata.sqlite3" if f==snapshot else "audio/"+f.name): {"sha256":sha256(f),"bytes":f.stat().st_size} for f in files}}
        with tarfile.open(archive,"w:gz") as output:
            output.add(snapshot,arcname="metadata.sqlite3")
            for file in files[1:]: output.add(file,arcname="audio/"+file.name)
            payload=json.dumps(manifest,sort_keys=True).encode(); info=tarfile.TarInfo("manifest.json"); info.size=len(payload); output.addfile(info,io.BytesIO(payload))


def restore(archive: Path, data_dir: Path) -> None:
    with tempfile.TemporaryDirectory(dir=data_dir.parent) as temporary:
        staged=Path(temporary); root=staged/"set"; root.mkdir()
        with tarfile.open(archive,"r:gz") as input:
            members=input.getmembers()
            if any(m.name.startswith("/") or ".." in Path(m.name).parts or not m.isfile() for m in members): raise ValueError("unsafe backup archive")
            member_names={m.name for m in members}
            if len(member_names) != len(members): raise ValueError("duplicate backup members")
            input.extractall(root, members)
        (root / "audio").mkdir(exist_ok=True)
        manifest=json.loads((root/"manifest.json").read_text())
        if manifest.get("format") != 1: raise ValueError("unsupported backup format")
        expected_files=manifest.get("files")
        if not isinstance(expected_files,dict) or "metadata.sqlite3" not in expected_files or member_names != set(expected_files) | {"manifest.json"}:
            raise ValueError("backup manifest does not cover exactly the restored files")
        for name, expected in manifest["files"].items():
            parts=Path(name).parts
            if name != "metadata.sqlite3" and not (len(parts)==2 and parts[0]=="audio" and parts[1] not in {"", ".", ".."}):
                raise ValueError("unsafe backup manifest")
            path=root/name
            if not path.is_file() or sha256(path)!=expected["sha256"] or path.stat().st_size!=expected["bytes"]: raise ValueError("backup integrity check failed")
        database=sqlite3.connect(root/"metadata.sqlite3")
        try:
            if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok": raise ValueError("backup database integrity check failed")
            referenced=[row[0] for row in database.execute("SELECT DISTINCT audio_id FROM song_revisions WHERE audio_id IS NOT NULL")]
        except sqlite3.DatabaseError as exc:
            raise ValueError("backup database is invalid") from exc
        finally:
            database.close()
        if any(not (root / "audio" / audio_id).is_file() for audio_id in referenced): raise ValueError("backup misses referenced audio")
        replacement=staged/"replacement"; replacement.mkdir(); shutil.copy2(root/"metadata.sqlite3",replacement/"lyrics.sqlite3"); shutil.copytree(root/"audio",replacement/"audio")
        credential=data_dir/"credentials.json"
        if credential.exists():
            if credential.is_symlink() or not credential.is_file(): raise ValueError("existing credentials file is unsafe")
            shutil.copy2(credential,replacement/"credentials.json")
        prior=data_dir.with_name(data_dir.name+".previous")
        if prior.exists(): shutil.rmtree(prior)
        if data_dir.exists(): data_dir.rename(prior)
        replacement.rename(data_dir)
        if prior.exists(): shutil.rmtree(prior)


def main() -> None:
    parser=argparse.ArgumentParser(description="Back up or restore the private timed-lyrics store.")
    sub=parser.add_subparsers(required=True,dest="command"); create=sub.add_parser("create"); create.add_argument("data_dir",type=Path); create.add_argument("archive",type=Path)
    recover=sub.add_parser("restore"); recover.add_argument("archive",type=Path); recover.add_argument("data_dir",type=Path)
    args=parser.parse_args(); backup(args.data_dir,args.archive) if args.command=="create" else restore(args.archive,args.data_dir)


if __name__=="__main__": main()
