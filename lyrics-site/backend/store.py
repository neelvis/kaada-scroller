from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .backup import backup, sha256


class Conflict(Exception): pass
class Missing(Exception): pass
class DuplicateSong(Exception): pass
class InvalidSong(Exception): pass


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.audio_dir = self.data_dir / "audio"
        self.db_path = self.data_dir / "lyrics.sqlite3"
        self._backup_before_backing_migration()
        self.audio_dir.mkdir(exist_ok=True)
        self._init()
        self._recover_interrupted_uploads()

    def _backup_before_backing_migration(self) -> None:
        """Fail closed before adding the backing column to an existing library."""
        if not self.db_path.exists(): return
        try:
            db=sqlite3.connect(f"{self.db_path.resolve().as_uri()}?mode=ro", uri=True)
            try:
                exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='song_revisions'").fetchone()
                if not exists: return
                columns={row[1] for row in db.execute("PRAGMA table_info(song_revisions)")}
            finally:
                db.close()
        except sqlite3.DatabaseError as exc:
            raise RuntimeError("cannot inspect existing lyrics database before migration") from exc
        if "backing_audio_id" in columns: return
        backup_dir=self.data_dir / "backups"
        if backup_dir.exists():
            if backup_dir.is_symlink() or not backup_dir.is_dir():
                raise RuntimeError("unsafe lyrics backup directory")
            os.chmod(backup_dir, 0o700)
        else:
            backup_dir.mkdir(mode=0o700)
            if backup_dir.is_symlink() or not backup_dir.is_dir():
                raise RuntimeError("unsafe lyrics backup directory")
        archive=backup_dir / f"pre-backing-migration-{uuid.uuid4()}.tar.gz"
        try:
            backup(self.data_dir, archive)
        except Exception as exc:
            raise RuntimeError("could not create pre-migration lyrics backup") from exc
        logging.getLogger("uvicorn.error").info("Created pre-migration lyrics backup: %s sha256=%s", archive, sha256(archive))

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
            CREATE TABLE IF NOT EXISTS song_revisions(id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE, audio_id TEXT REFERENCES audio(id), backing_audio_id TEXT REFERENCES audio(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS song_uploads(migration_key TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES song_revisions(id) ON DELETE CASCADE);
            CREATE TABLE IF NOT EXISTS deleted_song_uploads(migration_key TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, migration_key TEXT UNIQUE, cover TEXT NOT NULL DEFAULT '', end_caption TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE IF NOT EXISTS project_entries(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, position INTEGER NOT NULL, song_id TEXT NOT NULL REFERENCES songs(id), revision_id TEXT NOT NULL REFERENCES song_revisions(id), PRIMARY KEY(project_id,position));
            CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS revision_song_idx ON song_revisions(song_id, created_at);
            CREATE INDEX IF NOT EXISTS entry_song_idx ON project_entries(song_id);
            """)
            columns={row[1] for row in db.execute("PRAGMA table_info(audio)")}
            project_columns={row[1] for row in db.execute("PRAGMA table_info(projects)")}
            if "cover" not in project_columns: db.execute("ALTER TABLE projects ADD COLUMN cover TEXT NOT NULL DEFAULT ''")
            if "end_caption" not in project_columns: db.execute("ALTER TABLE projects ADD COLUMN end_caption TEXT NOT NULL DEFAULT ''")
            if "mime_type" not in columns: db.execute("ALTER TABLE audio ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'audio/mpeg'")
            if "content_hash" not in columns: db.execute("ALTER TABLE audio ADD COLUMN content_hash TEXT")
            if "owner_token_hash" not in columns: db.execute("ALTER TABLE audio ADD COLUMN owner_token_hash TEXT")
            revision_columns={row[1] for row in db.execute("PRAGMA table_info(song_revisions)")}
            if "backing_audio_id" not in revision_columns:
                db.execute("ALTER TABLE song_revisions ADD COLUMN backing_audio_id TEXT REFERENCES audio(id)")
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
        return {"songId": revision["song_id"], "revisionId": revision["id"], "audioId": revision["audio_id"], "backingAudioId": revision["backing_audio_id"], "song": json.loads(revision["body"])}

    def full_project(self, db: sqlite3.Connection, project_id: str) -> dict[str, Any]:
        project = self.project_row(db, project_id)
        rows = db.execute("""SELECT r.* FROM project_entries e JOIN song_revisions r ON r.song_id=e.song_id
            WHERE e.project_id=? AND r.rowid=(SELECT MAX(head.rowid) FROM song_revisions head WHERE head.song_id=e.song_id)
            ORDER BY e.position""", (project_id,)).fetchall()
        return {"id": project["id"], "name": project["name"], "cover": project["cover"] if "cover" in project.keys() else "", "endCaption": project["end_caption"] if "end_caption" in project.keys() else "", "revision": project["revision"], "songs": [self.entry(row) for row in rows]}

    def create_project(self, name: str, migration_key: str | None = None) -> dict[str, Any]:
        project_id = str(uuid.uuid4())
        with self.tx() as db:
            db.execute("INSERT INTO projects(id,name,migration_key) VALUES(?,?,?)", (project_id, name, migration_key))
            return self.full_project(db, project_id)

    def list_projects(self) -> list[dict[str, Any]]:
        with self.read() as db:
            rows = db.execute("SELECT p.id,p.name,p.cover,p.end_caption,p.revision,COUNT(e.position) song_count FROM projects p LEFT JOIN project_entries e ON e.project_id=p.id GROUP BY p.id ORDER BY p.created_at,p.id").fetchall()
            return [{"id": r["id"], "name": r["name"], "cover": r["cover"], "endCaption": r["end_caption"], "revision": r["revision"], "songCount": r["song_count"]} for r in rows]

    def library(self, query: str) -> list[dict[str, Any]]:
        with self.read() as db:
            rows = db.execute("""SELECT r.*,s.created_at song_created_at FROM song_revisions r JOIN (SELECT song_id, MAX(rowid) latest FROM song_revisions GROUP BY song_id) l ON l.song_id=r.song_id AND l.latest=r.rowid JOIN songs s ON s.id=r.song_id ORDER BY r.rowid DESC""").fetchall()
        result=[]
        for row in rows:
            song=json.loads(row["body"])
            if query and query.lower() not in " ".join(str(song.get(field, "")) for field in ("title", "artist", "album", "version")).lower(): continue
            try:
                self._validate_ready(song)
                valid=True
            except InvalidSong:
                valid=False
            created_at = row["song_created_at"]
            if "T" not in created_at:
                created_at = created_at.replace(" ", "T", 1)
            if not created_at.endswith("Z"):
                created_at += "Z"
            result.append({"id": row["song_id"], "title": song.get("title", ""), "artist": song.get("artist", ""), "album": song.get("album", ""), "cover": song.get("cover", ""), "version": song.get("version", ""), "revisionId": row["id"], "createdAt": created_at, "reviewed": song.get("reviewed") is True, "valid":valid, "hasAudio": bool(row["audio_id"]), "hasBackingAudio": bool(row["backing_audio_id"])})
        return result

    def get_song(self, song_id: str) -> dict[str, Any]:
        with self.read() as db:
            row=db.execute("SELECT * FROM song_revisions WHERE song_id=? ORDER BY rowid DESC LIMIT 1", (song_id,)).fetchone()
            if not row: raise Missing()
            return self.entry(row)

    def create_song(self, migration_key: str, raw: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Commit a standalone upload and its retry key together, without a project."""
        with self.tx() as db:
            if db.execute("SELECT 1 FROM deleted_song_uploads WHERE migration_key=?", (migration_key,)).fetchone(): raise Missing()
            existing=db.execute("SELECT revision_id FROM song_uploads WHERE migration_key=?", (migration_key,)).fetchone()
            if existing: return self.entry(self.revision(db, existing["revision_id"])), False
            # Uploading a separate copy must never resolve a caller-supplied cloud ID.
            entry={"song":raw["song"], "audioId":raw.get("audioId"), "backingAudioId":raw.get("backingAudioId")}
            row=self._resolve_entry(db, entry)
            db.execute("INSERT INTO song_uploads(migration_key,revision_id) VALUES(?,?)", (migration_key,row["id"]))
            return self.entry(row), True

    def save_song(self, song_id: str, revision_id: str, raw: dict[str, Any]) -> dict[str, Any]:
        """Advance the library head only from the version the caller reviewed."""
        with self.tx() as db:
            prior=self.revision(db, revision_id, song_id)
            entry={**raw, "songId":song_id, "revisionId":revision_id, "audioId":raw.get("audioId", prior["audio_id"])}
            return self.entry(self._resolve_entry(db, entry))

    def delete_project(self, project_id: str, revision: int) -> None:
        with self.tx() as db:
            p=self.project_row(db, project_id)
            if p["revision"] != revision: raise Conflict()
            db.execute("DELETE FROM projects WHERE id=?", (project_id,))

    def delete_song(self, song_id: str) -> list[str]:
        with self.tx() as db:
            if not db.execute("SELECT 1 FROM songs WHERE id=?", (song_id,)).fetchone(): raise Missing()
            affected=[r[0] for r in db.execute("SELECT DISTINCT project_id FROM project_entries WHERE song_id=?", (song_id,))]
            db.execute("DELETE FROM project_entries WHERE song_id=?", (song_id,))
            db.executemany("UPDATE projects SET revision=revision+1 WHERE id=?", [(project_id,) for project_id in affected])
            # Keep retry keys after deletion: a lost upload response must not
            # turn a stale retry into a fresh song with a new identity.
            db.execute("INSERT OR IGNORE INTO deleted_song_uploads SELECT u.migration_key FROM song_uploads u JOIN song_revisions r ON r.id=u.revision_id WHERE r.song_id=?", (song_id,))
            audio_ids=[r[0] for r in db.execute("""SELECT DISTINCT audio_id FROM song_revisions WHERE song_id=? AND audio_id IS NOT NULL
                UNION SELECT DISTINCT backing_audio_id FROM song_revisions WHERE song_id=? AND backing_audio_id IS NOT NULL""", (song_id, song_id))]
            db.execute("DELETE FROM songs WHERE id=?", (song_id,))
            unused=[a for a in audio_ids if not db.execute("SELECT 1 FROM song_revisions WHERE audio_id=? OR backing_audio_id=?", (a, a)).fetchone()]
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
            rows=db.execute("""SELECT id FROM audio WHERE owner_token_hash=? AND id NOT IN (
                SELECT DISTINCT audio_id FROM song_revisions WHERE audio_id IS NOT NULL
                UNION SELECT DISTINCT backing_audio_id FROM song_revisions WHERE backing_audio_id IS NOT NULL
            )""", (owner_token_hash,)).fetchall()
            deleted=[row["id"] for row in rows if row["id"] not in keep_ids]
            db.executemany("DELETE FROM audio WHERE id=?", [(audio_id,) for audio_id in deleted])
            return deleted

    def save_project(self, project_id: str, revision: int, name: str, entries: list[dict[str, Any]], cover: str = "", end_caption: str = "") -> dict[str, Any]:
        with self.tx() as db:
            p=self.project_row(db, project_id)
            if p["revision"] != revision: raise Conflict()
            resolved=[self._resolve_entry(db, e) for e in entries]
            db.execute("UPDATE projects SET name=?,cover=?,end_caption=?,revision=revision+1 WHERE id=?", (name, cover, end_caption, project_id))
            db.execute("DELETE FROM project_entries WHERE project_id=?", (project_id,))
            db.executemany("INSERT INTO project_entries(project_id,position,song_id,revision_id) VALUES(?,?,?,?)", [(project_id, i, row["song_id"], row["id"]) for i,row in enumerate(resolved)])
            return self.full_project(db, project_id)

    def import_project(self, migration_key: str, name: str, entries: list[dict[str, Any]], cover: str = "", end_caption: str = "") -> tuple[dict[str, Any], bool]:
        """Create the project and all revisions together, so a failed retry leaves no key behind."""
        with self.tx() as db:
            existing=db.execute("SELECT id FROM projects WHERE migration_key=?", (migration_key,)).fetchone()
            if existing: return self.full_project(db, existing["id"]), False
            project_id=str(uuid.uuid4())
            db.execute("INSERT INTO projects(id,name,migration_key,cover,end_caption) VALUES(?,?,?,?,?)", (project_id,name,migration_key,cover,end_caption))
            resolved=[self._resolve_entry(db, entry) for entry in entries]
            db.executemany("INSERT INTO project_entries(project_id,position,song_id,revision_id) VALUES(?,?,?,?)", [(project_id,index,row["song_id"],row["id"]) for index,row in enumerate(resolved)])
            return self.full_project(db, project_id), True

    def imported_project(self, migration_key: str) -> dict[str, Any]:
        with self.read() as db:
            row=db.execute("SELECT id FROM projects WHERE migration_key=?", (migration_key,)).fetchone()
            if not row: raise Missing()
            return self.full_project(db,row["id"])

    def _resolve_entry(self, db: sqlite3.Connection, raw: dict[str, Any]) -> sqlite3.Row:
        song=dict(raw["song"])
        audio_id=raw.get("audioId")
        if audio_id and not db.execute("SELECT 1 FROM audio WHERE id=?", (audio_id,)).fetchone(): raise Missing()
        song_id, revision_id=raw.get("songId"),raw.get("revisionId")
        if song_id and revision_id:
            prior=self.revision(db, revision_id, song_id)
            latest=db.execute("SELECT * FROM song_revisions WHERE song_id=? ORDER BY rowid DESC LIMIT 1", (song_id,)).fetchone()
            # Clients from revision 3 do not know this field.  Their saves must not
            # silently unlink a backing selected by a newer client.
            backing_audio_id=raw["backingAudioId"] if "backingAudioId" in raw else prior["backing_audio_id"]
            if backing_audio_id and not db.execute("SELECT 1 FROM audio WHERE id=?", (backing_audio_id,)).fetchone(): raise Missing()
            song=self._with_backing_metadata(db, {**song, "id":song_id}, backing_audio_id)
            canonical=json.dumps(song, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            # Structural project edits may carry an unchanged older song. Resolve
            # that to its current head without publishing the old content again.
            if prior["body"] == canonical and prior["audio_id"] == audio_id and prior["backing_audio_id"] == backing_audio_id: return latest
            if latest["body"] == canonical and latest["audio_id"] == audio_id and latest["backing_audio_id"] == backing_audio_id: return latest
            if latest["id"] != revision_id: raise Conflict()
            return self._new_revision(db, song_id, audio_id, backing_audio_id, song)
        if song_id or revision_id: raise Missing()
        backing_audio_id=raw.get("backingAudioId")
        if backing_audio_id and not db.execute("SELECT 1 FROM audio WHERE id=?", (backing_audio_id,)).fetchone(): raise Missing()
        song_id=str(uuid.uuid4()); song["id"]=song_id
        db.execute("INSERT INTO songs(id) VALUES(?)", (song_id,))
        return self._new_revision(db, song_id, audio_id, backing_audio_id, self._with_backing_metadata(db, song, backing_audio_id))

    @staticmethod
    def _with_backing_metadata(db: sqlite3.Connection, song: dict[str, Any], backing_audio_id: str | None) -> dict[str, Any]:
        """Keep portable song metadata aligned with the private backing link."""
        song=dict(song)
        if not backing_audio_id:
            song.pop("backing", None)
            return song
        row=db.execute("SELECT file_name FROM audio WHERE id=?", (backing_audio_id,)).fetchone()
        if not row: raise Missing()
        song["backing"]={"fileName": row["file_name"]}
        return song

    def _new_revision(self, db: sqlite3.Connection, song_id: str, audio_id: str | None, backing_audio_id: str | None, song: dict[str, Any]) -> sqlite3.Row:
        self._validate_ready(song)
        identity=tuple((song.get(field) or "").strip() for field in ("title", "artist", "version", "album"))
        # BEGIN IMMEDIATE serializes this check and insert across processes. Only
        # current heads participate; historical and pre-existing duplicates stay.
        for row in db.execute("SELECT r.song_id,r.body FROM song_revisions r WHERE r.rowid=(SELECT MAX(h.rowid) FROM song_revisions h WHERE h.song_id=r.song_id) AND r.song_id<>?", (song_id,)):
            other=json.loads(row["body"])
            if tuple(str(other.get(field) or "").strip() for field in ("title", "artist", "version", "album")) == identity: raise DuplicateSong()
        revision_id=str(uuid.uuid4()); body=json.dumps(song, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        db.execute("INSERT INTO song_revisions(id,song_id,audio_id,backing_audio_id,body) VALUES(?,?,?,?,?)", (revision_id,song_id,audio_id,backing_audio_id,body))
        return self.revision(db, revision_id)

    @staticmethod
    def _validate_ready(song: dict[str, Any]) -> None:
        def finite(value: Any) -> bool:
            return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        if not isinstance(song.get("title"), str) or not song["title"].strip(): raise InvalidSong()
        if any(song.get(field) is not None and not isinstance(song[field], str) for field in ("artist", "version")): raise InvalidSong()
        if song.get("reviewed") is not True or not finite(song.get("duration")) or song["duration"] <= 0 or not finite(song.get("delayMs")): raise InvalidSong()
        cues=song.get("cues")
        backing=song.get("backing")
        if not isinstance(cues, list) or (not cues and not (isinstance(backing, dict) and backing.get("fileName"))): raise InvalidSong()
        previous=-math.inf
        for cue in cues:
            if not isinstance(cue, dict) or cue.get("type") not in ("lyric", "rest") or not isinstance(cue.get("text"), str) or (cue.get("type") != "rest" and not cue["text"].strip()): raise InvalidSong()
            if song.get("ignoreTimecodes") is True: continue
            start=cue.get("start")
            if not finite(start) or start < 0 or start >= song["duration"] or start <= previous: raise InvalidSong()
            previous=start
