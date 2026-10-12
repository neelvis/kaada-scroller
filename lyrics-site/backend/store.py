from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator


class Conflict(Exception): pass
class Missing(Exception): pass
class Referenced(Exception): pass


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir = self.data_dir / "audio"
        self.audio_dir.mkdir(exist_ok=True)
        self.db_path = self.data_dir / "lyrics.sqlite3"
        self._init()
        self._recover_interrupted_uploads()

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.db_path, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        return db

    def _init(self) -> None:
        with self.read() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS audio(id TEXT PRIMARY KEY, file_name TEXT NOT NULL, duration REAL NOT NULL, bytes INTEGER NOT NULL, mime_type TEXT NOT NULL DEFAULT 'audio/mpeg', content_hash TEXT UNIQUE, owner_token_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS upload_reservations(id TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS songs(id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS song_revisions(id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE, audio_id TEXT REFERENCES audio(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, migration_key TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS project_entries(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, position INTEGER NOT NULL, song_id TEXT NOT NULL REFERENCES songs(id), revision_id TEXT NOT NULL REFERENCES song_revisions(id), PRIMARY KEY(project_id,position));
            CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS revision_song_idx ON song_revisions(song_id, created_at);
            CREATE INDEX IF NOT EXISTS entry_song_idx ON project_entries(song_id);
            """)
            columns={row[1] for row in db.execute("PRAGMA table_info(audio)")}
            if "mime_type" not in columns: db.execute("ALTER TABLE audio ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'audio/mpeg'")
            if "content_hash" not in columns: db.execute("ALTER TABLE audio ADD COLUMN content_hash TEXT")
            if "owner_token_hash" not in columns: db.execute("ALTER TABLE audio ADD COLUMN owner_token_hash TEXT")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS audio_content_hash_idx ON audio(content_hash) WHERE content_hash IS NOT NULL")

    def _recover_interrupted_uploads(self) -> None:
        """Release state left by a killed uploader without touching database-owned drafts."""
        with self.tx() as db:
            db.execute("DELETE FROM upload_reservations")
            tracked={row[0] for row in db.execute("SELECT id FROM audio")}
        for candidate in self.data_dir.iterdir():
            if candidate.is_file() and candidate.name.startswith("upload-"):
                candidate.unlink(missing_ok=True)
        for candidate in self.audio_dir.iterdir():
            if not candidate.is_file(): continue
            try: uuid.UUID(candidate.name)
            except ValueError: continue
            if candidate.name not in tracked: candidate.unlink(missing_ok=True)

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        db = self.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @contextmanager
    def read(self) -> Iterator[sqlite3.Connection]:
        db=self.connect()
        try: yield db
        finally: db.close()

    @staticmethod
    def project_row(db: sqlite3.Connection, project_id: str) -> sqlite3.Row:
        row = db.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if not row: raise Missing()
        return row

    @staticmethod
    def revision(db: sqlite3.Connection, revision_id: str, song_id: str | None = None) -> sqlite3.Row:
        sql, values = "SELECT * FROM song_revisions WHERE id=?", [revision_id]
        if song_id: sql += " AND song_id=?"; values.append(song_id)
        row = db.execute(sql, values).fetchone()
        if not row: raise Missing()
        return row

    @staticmethod
    def entry(revision: sqlite3.Row) -> dict[str, Any]:
        return {"songId": revision["song_id"], "revisionId": revision["id"], "audioId": revision["audio_id"], "song": json.loads(revision["body"])}

    def full_project(self, db: sqlite3.Connection, project_id: str) -> dict[str, Any]:
        project = self.project_row(db, project_id)
        rows = db.execute("SELECT r.* FROM project_entries e JOIN song_revisions r ON r.id=e.revision_id WHERE e.project_id=? ORDER BY e.position", (project_id,)).fetchall()
        return {"id": project["id"], "name": project["name"], "revision": project["revision"], "songs": [self.entry(row) for row in rows]}

    def create_project(self, name: str, migration_key: str | None = None) -> dict[str, Any]:
        project_id = str(uuid.uuid4())
        with self.tx() as db:
            db.execute("INSERT INTO projects(id,name,migration_key) VALUES(?,?,?)", (project_id, name, migration_key))
            return self.full_project(db, project_id)

    def list_projects(self) -> list[dict[str, Any]]:
        with self.read() as db:
            rows = db.execute("SELECT p.id,p.name,p.revision,COUNT(e.position) song_count FROM projects p LEFT JOIN project_entries e ON e.project_id=p.id GROUP BY p.id ORDER BY p.created_at,p.id").fetchall()
            return [{"id": r["id"], "name": r["name"], "revision": r["revision"], "songCount": r["song_count"]} for r in rows]

    def library(self, query: str) -> list[dict[str, Any]]:
        pattern = f"%{query.lower()}%"
        with self.read() as db:
            rows = db.execute("""SELECT r.* FROM song_revisions r JOIN (SELECT song_id, MAX(rowid) latest FROM song_revisions GROUP BY song_id) l ON l.song_id=r.song_id AND l.latest=r.rowid ORDER BY r.rowid DESC""").fetchall()
        result=[]
        for row in rows:
            song=json.loads(row["body"])
            if query and query.lower() not in (str(song.get("title", "")) + " " + str(song.get("artist", ""))).lower(): continue
            result.append({"id": row["song_id"], "title": song.get("title", ""), "artist": song.get("artist", ""), "version": song.get("version", ""), "revisionId": row["id"], "reviewed": bool(song.get("reviewed")), "hasAudio": bool(row["audio_id"])})
        return result

    def get_song(self, song_id: str) -> dict[str, Any]:
        with self.read() as db:
            row=db.execute("SELECT * FROM song_revisions WHERE song_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", (song_id,)).fetchone()
            if not row: raise Missing()
            return self.entry(row)

    def delete_project(self, project_id: str, revision: int) -> None:
        with self.tx() as db:
            p=self.project_row(db, project_id)
            if p["revision"] != revision: raise Conflict()
            db.execute("DELETE FROM projects WHERE id=?", (project_id,))

    def delete_song(self, song_id: str) -> list[str]:
        with self.tx() as db:
            if not db.execute("SELECT 1 FROM songs WHERE id=?", (song_id,)).fetchone(): raise Missing()
            if db.execute("SELECT 1 FROM project_entries WHERE song_id=?", (song_id,)).fetchone(): raise Referenced()
            audio_ids=[r[0] for r in db.execute("SELECT DISTINCT audio_id FROM song_revisions WHERE song_id=? AND audio_id IS NOT NULL", (song_id,))]
            db.execute("DELETE FROM songs WHERE id=?", (song_id,))
            unused=[a for a in audio_ids if not db.execute("SELECT 1 FROM song_revisions WHERE audio_id=?", (a,)).fetchone()]
            for audio_id in unused: db.execute("DELETE FROM audio WHERE id=?", (audio_id,))
            return unused

    def reserve_upload(self, reservation_id: str, delta: int, quota_bytes: int) -> bool:
        """Reserve staging bytes before they reach disk, across all live uploads."""
        with self.tx() as db:
            used=db.execute("SELECT COALESCE(SUM(bytes),0) FROM audio").fetchone()[0]
            pending=db.execute("SELECT COALESCE(SUM(bytes),0) FROM upload_reservations").fetchone()[0]
            if used + pending + delta > quota_bytes: return False
            db.execute("INSERT INTO upload_reservations(id,bytes) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET bytes=bytes+excluded.bytes", (reservation_id,delta))
            return True

    def release_upload(self, reservation_id: str) -> None:
        with self.tx() as db: db.execute("DELETE FROM upload_reservations WHERE id=?", (reservation_id,))

    def finish_upload(self, reservation_id: str, content_hash: str, file_name: str, duration: float, size: int, mime_type: str, owner_token_hash: str, temporary_file: Path) -> tuple[dict[str, Any], bool]:
        """Turn a reservation into an audio row, or return the original retry row."""
        destination: Path | None=None
        try:
            with self.tx() as db:
                prior=db.execute("SELECT id,file_name,duration,mime_type FROM audio WHERE content_hash=?", (content_hash,)).fetchone()
                db.execute("DELETE FROM upload_reservations WHERE id=?", (reservation_id,))
                if prior: return dict(prior), False
                audio_id=str(uuid.uuid4()); destination=self.audio_dir/audio_id
                # The file becomes visible only inside the same transaction that records it.
                # If INSERT/commit fails, the exception handler removes this moved file.
                os.replace(temporary_file,destination)
                directory_fd=os.open(self.audio_dir,os.O_RDONLY)
                try: os.fsync(directory_fd)
                finally: os.close(directory_fd)
                db.execute("INSERT INTO audio(id,file_name,duration,bytes,mime_type,content_hash,owner_token_hash) VALUES(?,?,?,?,?,?,?)", (audio_id,file_name,duration,size,mime_type,content_hash,owner_token_hash))
                return {"id":audio_id,"file_name":file_name,"duration":duration,"mime_type":mime_type}, True
        except Exception:
            if destination: destination.unlink(missing_ok=True)
            raise

    def cleanup_orphan_audio(self, owner_token_hash: str, keep_ids: set[str]) -> list[str]:
        """Delete only explicitly unreferenced uploads not named by the caller's live draft."""
        with self.tx() as db:
            rows=db.execute("SELECT id FROM audio WHERE owner_token_hash=? AND id NOT IN (SELECT DISTINCT audio_id FROM song_revisions WHERE audio_id IS NOT NULL)", (owner_token_hash,)).fetchall()
            deleted=[row["id"] for row in rows if row["id"] not in keep_ids]
            db.executemany("DELETE FROM audio WHERE id=?", [(audio_id,) for audio_id in deleted])
            return deleted

    def save_project(self, project_id: str, revision: int, name: str, entries: list[dict[str, Any]]) -> dict[str, Any]:
        with self.tx() as db:
            p=self.project_row(db, project_id)
            if p["revision"] != revision: raise Conflict()
            resolved=[self._resolve_entry(db, e) for e in entries]
            db.execute("UPDATE projects SET name=?,revision=revision+1 WHERE id=?", (name, project_id))
            db.execute("DELETE FROM project_entries WHERE project_id=?", (project_id,))
            db.executemany("INSERT INTO project_entries(project_id,position,song_id,revision_id) VALUES(?,?,?,?)", [(project_id, i, row["song_id"], row["id"]) for i,row in enumerate(resolved)])
            return self.full_project(db, project_id)

    def import_project(self, migration_key: str, name: str, entries: list[dict[str, Any]]) -> tuple[dict[str, Any], bool]:
        """Create the project and all revisions together, so a failed retry leaves no key behind."""
        with self.tx() as db:
            existing=db.execute("SELECT id FROM projects WHERE migration_key=?", (migration_key,)).fetchone()
            if existing: return self.full_project(db, existing["id"]), False
            project_id=str(uuid.uuid4())
            db.execute("INSERT INTO projects(id,name,migration_key) VALUES(?,?,?)", (project_id,name,migration_key))
            resolved=[self._resolve_entry(db, entry) for entry in entries]
            db.executemany("INSERT INTO project_entries(project_id,position,song_id,revision_id) VALUES(?,?,?,?)", [(project_id,index,row["song_id"],row["id"]) for index,row in enumerate(resolved)])
            return self.full_project(db, project_id), True

    def imported_project(self, migration_key: str) -> dict[str, Any]:
        with self.read() as db:
            row=db.execute("SELECT id FROM projects WHERE migration_key=?", (migration_key,)).fetchone()
            if not row: raise Missing()
            return self.full_project(db,row["id"])

    def _resolve_entry(self, db: sqlite3.Connection, raw: dict[str, Any]) -> sqlite3.Row:
        song=raw["song"]
        audio_id=raw.get("audioId")
        if audio_id and not db.execute("SELECT 1 FROM audio WHERE id=?", (audio_id,)).fetchone(): raise Missing()
        song_id, revision_id=raw.get("songId"),raw.get("revisionId")
        if song_id and revision_id:
            prior=self.revision(db, revision_id, song_id)
            canonical=json.dumps(song, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            if prior["body"] == canonical and prior["audio_id"] == audio_id: return prior
            return self._new_revision(db, song_id, audio_id, song)
        if song_id or revision_id: raise Missing()
        song_id=str(uuid.uuid4()); song=dict(song); song["id"]=song_id
        db.execute("INSERT INTO songs(id) VALUES(?)", (song_id,))
        return self._new_revision(db, song_id, audio_id, song)

    def _new_revision(self, db: sqlite3.Connection, song_id: str, audio_id: str | None, song: dict[str, Any]) -> sqlite3.Row:
        revision_id=str(uuid.uuid4()); body=json.dumps(song, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        db.execute("INSERT INTO song_revisions(id,song_id,audio_id,body) VALUES(?,?,?,?)", (revision_id,song_id,audio_id,body))
        return self.revision(db, revision_id)
