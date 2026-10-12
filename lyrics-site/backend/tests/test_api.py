import io
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

from backend.config import Settings
from backend.credentials import make_scrypt
from backend.backup import backup, restore, main as backup_main

os.environ.setdefault("LYRICS_PASSWORD_SCRYPT", make_scrypt("test-only organizer password"))
os.environ.setdefault("LYRICS_DATA_DIR", str(Path(tempfile.gettempdir()) / "kaada-lyrics-import-test"))
from backend.app import create_app


def song(title="Song"):
    return {"schemaVersion":1,"id":"local-id","title":title,"artist":"Artist","version":"original","language":"ru","duration":2,"delayMs":0,"reviewed":False,"source":{"kind":"manual","fileName":""},"cues":[{"id":"c1","start":0,"text":"text","type":"lyric"}]}


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        # The browser sends the `/api/`-scoped cookie before the proxy strips that prefix;
        # TestClient calls the stripped service path directly.
        settings=Settings(Path(self.temp.name),make_scrypt("organizer password"),"http://testserver","lyrics_session","/",False,1024*1024)
        self.client=TestClient(create_app(settings))
        self.headers={"Origin":"http://testserver","X-Lyrics-Request":"1"}

    def tearDown(self): self.temp.cleanup()

    def login(self):
        response=self.client.post("/login",headers=self.headers,json={"password":"organizer password"})
        self.assertEqual(response.status_code,200); return {**self.headers,"X-Lyrics-CSRF":response.json()["csrf"]}

    def test_auth_csrf_and_project_conflict_and_pins(self):
        self.assertEqual(self.client.get("/projects").status_code,401)
        self.assertEqual(self.client.post("/login",json={"password":"wrong"}).status_code,403)
        headers=self.login()
        self.assertEqual(self.client.post("/projects",json={"name":"Class"}).status_code,403)
        project=self.client.post("/projects",headers=headers,json={"name":"Class"}).json()
        saved=self.client.put(f"/projects/{project['id']}",headers=headers,json={"revision":project["revision"],"name":"Class","songs":[{"song":song()}]}).json()
        first=saved["songs"][0]
        other=self.client.post("/projects",headers=headers,json={"name":"Concert"}).json()
        other=self.client.put(f"/projects/{other['id']}",headers=headers,json={"revision":other["revision"],"name":"Concert","songs":[first]}).json()
        changed=dict(first); changed["song"]=dict(first["song"],title="Changed")
        updated=self.client.put(f"/projects/{saved['id']}",headers=headers,json={"revision":saved["revision"],"name":"Class","songs":[changed]}).json()
        self.assertNotEqual(updated["songs"][0]["revisionId"],other["songs"][0]["revisionId"])
        self.assertEqual(self.client.get(f"/projects/{other['id']}").json()["songs"][0]["song"]["title"],"Song")
        stale=self.client.put(f"/projects/{updated['id']}",headers=headers,json={"revision":saved["revision"],"name":"x","songs":[]})
        self.assertEqual(stale.status_code,409)
        self.assertEqual(self.client.delete(f"/songs/{first['songId']}",headers=headers).status_code,409)

    def test_audio_bounds_sniff_quota_and_range(self):
        headers=self.login()
        self.assertEqual(self.client.post("/audio",headers={**headers,"Content-Type":"audio/mpeg","X-Lyrics-Filename":"bad.mp3"},content=b"not audio").status_code,415)
        payload=io.BytesIO()
        with wave.open(payload,"wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b"\0\0"*8000)
        response=self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":"a%20b.wav"},content=payload.getvalue())
        self.assertEqual(response.status_code,201)
        audio_id=response.json()["id"]
        retry=self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":"different.wav"},content=payload.getvalue())
        self.assertEqual(retry.status_code,200); self.assertEqual(retry.json()["id"],audio_id)
        ranged=self.client.get(f"/audio/{audio_id}",headers={"Range":"bytes=0-9"})
        self.assertEqual(ranged.status_code,206); self.assertEqual(len(ranged.content),10)
        self.assertEqual(ranged.headers["content-type"],"audio/wav")

    def test_upload_reservations_and_draft_aware_cleanup(self):
        headers=self.login(); store=self.client.app.state.store
        self.assertTrue(store.reserve_upload("first",700,1000))
        self.assertFalse(store.reserve_upload("second",400,1000))
        store.release_upload("first")
        payload=io.BytesIO()
        with wave.open(payload,"wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b"\0\0"*8000)
        audio=self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":"draft.wav"},content=payload.getvalue()).json()
        kept=self.client.post("/audio/cleanup",headers=headers,json={"keepAudioIds":[audio["id"]]})
        self.assertEqual(kept.json()["deleted"],0)
        self.assertEqual(self.client.get(f"/audio/{audio['id']}").status_code,200)
        removed=self.client.post("/audio/cleanup",headers=headers,json={"keepAudioIds":[]})
        self.assertEqual(removed.json()["deleted"],1)
        self.assertEqual(self.client.get(f"/audio/{audio['id']}").status_code,404)

    def test_publish_disk_error_leaves_no_metadata_file_or_reservation(self):
        headers=self.login(); payload=io.BytesIO()
        with wave.open(payload,"wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b"\0\0"*8000)
        with patch("backend.store.os.replace", side_effect=OSError("no space")):
            response=self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":"full.wav"},content=payload.getvalue())
        self.assertEqual(response.status_code,507)
        store=self.client.app.state.store
        with store.read() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audio").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM upload_reservations").fetchone()[0],0)
        self.assertEqual(list(store.audio_dir.iterdir()),[])

    def test_store_restart_recovers_upload_reservations_and_untracked_files(self):
        store=self.client.app.state.store
        tracked="11111111-1111-1111-1111-111111111111"; orphan="22222222-2222-2222-2222-222222222222"
        with store.tx() as db:
            db.execute("INSERT INTO audio(id,file_name,duration,bytes,mime_type,content_hash) VALUES(?,?,?,?,?,?)",(tracked,"draft.wav",1,10,"audio/wav","tracked"))
            db.execute("INSERT INTO upload_reservations(id,bytes) VALUES(?,?)",("crashed",999999))
        (store.audio_dir/tracked).write_bytes(b"preserved")
        (store.audio_dir/orphan).write_bytes(b"orphan")
        (store.data_dir/"upload-crashed").write_bytes(b"temporary")
        from backend.store import Store
        recovered=Store(store.data_dir)
        with recovered.read() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM upload_reservations").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM audio WHERE id=?",(tracked,)).fetchone()[0],1)
        self.assertEqual((recovered.audio_dir/tracked).read_bytes(),b"preserved")
        self.assertFalse((recovered.audio_dir/orphan).exists())
        self.assertFalse((recovered.data_dir/"upload-crashed").exists())
        self.assertTrue(recovered.reserve_upload("new",1024,self.client.app.state.settings.quota_bytes))

    def test_import_retry_is_idempotent_and_backup_restore(self):
        self.assertEqual(self.client.get("/imports/legacy-file-1").status_code,401)
        headers=self.login(); self.assertEqual(self.client.get("/imports/legacy-file-1").status_code,404)
        data={"migrationKey":"legacy-file-1","name":"Imported","songs":[{"song":song()}]}
        first=self.client.post("/imports",headers=headers,json=data); second=self.client.post("/imports",headers=headers,json=data)
        self.assertEqual(first.status_code,201); self.assertEqual(second.status_code,200); self.assertEqual(first.json()["id"],second.json()["id"])
        lookup=self.client.get("/imports/legacy-file-1")
        self.assertEqual(lookup.status_code,200); self.assertEqual(lookup.json()["id"],first.json()["id"])

    def test_backup_and_restore_preserve_project_snapshot(self):
        headers=self.login(); payload=io.BytesIO()
        with wave.open(payload,"wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b"\0\0"*8000)
        audio=self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":"archive.wav"},content=payload.getvalue()).json()
        project=self.client.post("/projects",headers=headers,json={"name":"Archive"}).json()
        saved=self.client.put(f"/projects/{project['id']}",headers=headers,json={"revision":project["revision"],"name":"Archive","songs":[{"song":song(),"audioId":audio["id"]}]}).json()
        archive=Path(self.temp.name)/"set.tar.gz"; backup(Path(self.temp.name),archive)
        restored=Path(self.temp.name).parent/"restored-lyrics-test"; restore(archive,restored)
        try:
            restored_settings=Settings(restored,make_scrypt("organizer password"),"http://testserver","s","/",False,1024*1024)
            client=TestClient(create_app(restored_settings)); client.post("/login",headers=self.headers,json={"password":"organizer password"})
            self.assertEqual(client.get(f"/projects/{saved['id']}").status_code,200)
            self.assertEqual(client.get(f"/audio/{audio['id']}").content, payload.getvalue())
        finally:
            import shutil; shutil.rmtree(restored,ignore_errors=True)

    def test_backup_cli_and_restore_retains_existing_credentials(self):
        headers=self.login(); self.client.post("/projects",headers=headers,json={"name":"Backup"})
        archive=Path(self.temp.name)/"cli.tar.gz"
        with patch("sys.argv",["backup","create",self.temp.name,str(archive)]): backup_main()
        restored=Path(self.temp.name).parent/"restored-credentials-test"; restored.mkdir(exist_ok=True)
        credential=restored/"credentials.json"; credential.write_text('{"salt":"private","hash":"private"}\n'); credential.chmod(0o600)
        try:
            restore(archive,restored)
            self.assertEqual(credential.read_text(),'{"salt":"private","hash":"private"}\n')
            self.assertEqual(credential.stat().st_mode & 0o777,0o600)
        finally:
            import shutil; shutil.rmtree(restored,ignore_errors=True)

    def test_restore_rejects_unmanifested_database_or_audio(self):
        import json, tarfile
        self.client.post('/projects', headers=self.login(), json={'name':'Verified'})
        original=Path(self.temp.name)/'original.tar.gz'; backup(Path(self.temp.name),original)
        with tarfile.open(original,'r:gz') as source:
            contents={member.name:source.extractfile(member).read() for member in source.getmembers()}
        for tamper in ('missing-metadata-hash','extra-audio'):
            changed=dict(contents)
            if tamper == 'missing-metadata-hash':
                manifest=json.loads(changed['manifest.json']); manifest['files'].pop('metadata.sqlite3'); changed['manifest.json']=json.dumps(manifest).encode()
            else: changed['audio/unknown']=b'unverified bytes'
            archive=Path(self.temp.name)/(tamper+'.tar.gz')
            with tarfile.open(archive,'w:gz') as target:
                for name,content in changed.items():
                    info=tarfile.TarInfo(name); info.size=len(content); target.addfile(info,io.BytesIO(content))
            destination=Path(self.temp.name)/'untouched'; destination.mkdir(exist_ok=True); (destination/'marker').write_text('keep')
            with self.assertRaises(ValueError): restore(archive,destination)
            self.assertEqual((destination/'marker').read_text(),'keep')
