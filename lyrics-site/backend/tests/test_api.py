import asyncio
import io
import httpx
import json
import os
import sqlite3
import tempfile
import unittest
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from starlette.testclient import TestClient

from backend.config import Settings
from backend.credentials import make_scrypt
from backend.backup import backup, restore, main as backup_main

os.environ.setdefault("LYRICS_PASSWORD_SCRYPT", make_scrypt("test-only organizer password"))
os.environ.setdefault("LYRICS_DATA_DIR", str(Path(tempfile.gettempdir()) / "kaada-lyrics-import-test"))
from backend.app import create_app


def song(title="Song"):
    return {"schemaVersion":1,"id":"local-id","title":title,"artist":"Artist","version":"original","language":"ru","duration":2,"delayMs":0,"reviewed":True,"source":{"kind":"manual","fileName":""},"cues":[{"id":"c1","start":0,"text":"text","type":"lyric"}]}


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

    def test_concurrent_login_bodies_cannot_bypass_attempt_limit(self):
        async def exercise():
            gate = asyncio.Event()
            entered = 0

            async def slow_body():
                nonlocal entered
                entered += 1
                if entered == 8:
                    gate.set()
                await gate.wait()
                yield b'{"password":"wrong"}'

            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.client.app), base_url="http://testserver") as client:
                with patch("backend.app.verify_password", return_value=False) as verify:
                    responses = await asyncio.gather(*(
                        client.post("/login", headers={**self.headers, "Content-Type":"application/json"}, content=slow_body())
                        for _ in range(32)
                    ))
                self.assertEqual(verify.call_count, 8)
                self.assertEqual(sum(response.status_code == 429 for response in responses), 24)
                self.assertEqual(sum(response.status_code == 401 for response in responses), 8)
        asyncio.run(exercise())

    def test_inflight_logins_still_count_after_failure_window_expires(self):
        async def exercise():
            gate, started = asyncio.Event(), asyncio.Event()
            entered = 0
            clock = [1000.0]
            async def slow_body():
                nonlocal entered
                entered += 1
                if entered == 8: started.set()
                await gate.wait()
                yield b'{"password":"wrong"}'
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.client.app), base_url="http://testserver") as client:
                with patch("backend.app.time", SimpleNamespace(time=lambda:1000, monotonic=lambda:clock[0])), patch("backend.app.verify_password", return_value=False) as verify:
                    pending = [asyncio.create_task(client.post("/login", headers={**self.headers, "Content-Type":"application/json"}, content=slow_body())) for _ in range(8)]
                    try:
                        await asyncio.wait_for(started.wait(), 2)
                        clock[0] += 301
                        extra = await client.post("/login", headers=self.headers, json={"password":"wrong"})
                        self.assertEqual(extra.status_code, 429)
                    finally:
                        gate.set()
                        await asyncio.gather(*pending)
                    self.assertEqual(verify.call_count, 8)
                    self.assertEqual((await client.post("/login", headers=self.headers, json={"password":"wrong"})).status_code, 429)
                    clock[0] += 301
                    self.assertEqual((await client.post("/login", headers=self.headers, json={"password":"wrong"})).status_code, 401)
        asyncio.run(exercise())

    def test_large_audio_ranges_stream_in_bounded_chunks(self):
        headers = self.login()
        payload = io.BytesIO()
        with wave.open(payload, "wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000)
            output.writeframes(b"\0\0" * 100000)
        uploaded = self.client.post("/audio", headers={**headers, "Content-Type":"audio/wav"}, content=payload.getvalue())
        self.assertEqual(uploaded.status_code, 201)
        path = f"/audio/{uploaded.json()['id']}"
        sizes = []

        async def inspect(scope, receive, send):
            async def record(message):
                if message["type"] == "http.response.body":
                    sizes.append(len(message.get("body", b"")))
                await send(message)
            await self.client.app(scope, receive, record)

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=inspect), base_url="http://testserver", cookies=self.client.cookies) as client:
                response = await client.get(path, headers={"Range":"bytes=0-"})
                self.assertEqual(response.status_code, 206)
                self.assertEqual(response.content, payload.getvalue())
        asyncio.run(exercise())
        self.assertGreater(len(sizes), 1)
        self.assertLessEqual(max(sizes), 64 * 1024)
        suffix = self.client.get(path, headers={"Range":"bytes=-10"})
        self.assertEqual(suffix.status_code, 206)
        self.assertEqual(suffix.content, payload.getvalue()[-10:])
        for value in ("bytes=999999-", "bytes=2-1", "bytes=-0", "bytes=-", "malformed"):
            invalid = self.client.get(path, headers={"Range":value})
            self.assertEqual(invalid.status_code, 416)
            self.assertEqual(invalid.headers["content-range"], f"bytes */{len(payload.getvalue())}")

    def test_oversize_json_has_explicit_size_error(self):
        headers = self.login()
        response = self.client.post("/songs", headers=headers, json={"song":song(), "cover":"x" * (5 * 1024 * 1024)})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["code"], "too_large")
        self.assertIn("5 МиБ", response.json()["error"])

    def test_auth_csrf_and_project_conflict_and_latest_heads(self):
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
        self.assertEqual(self.client.get(f"/projects/{other['id']}").json()["songs"][0]["song"]["title"],"Changed")
        stale=self.client.put(f"/projects/{updated['id']}",headers=headers,json={"revision":saved["revision"],"name":"x","songs":[]})
        self.assertEqual(stale.status_code,409)
        self.assertEqual(self.client.delete(f"/songs/{first['songId']}",headers=headers).status_code,204)

    def test_project_song_covers_persist_and_membership_lists_only_actual_projects(self):
        headers=self.login()
        first=self.client.post("/projects",headers=headers,json={"name":"Same name"}).json()
        artwork="data:image/png;base64,YQ=="
        entry={"song":{**song(),"projectCovers":[{"projectId":first["id"],"cover":artwork}]}}
        saved=self.client.put(f"/projects/{first['id']}",headers=headers,json={**first,"songs":[entry]})
        self.assertEqual(saved.status_code,200)
        saved_entry=saved.json()["songs"][0]
        self.assertEqual(saved_entry["song"]["projectCovers"],[{"projectId":first["id"],"cover":artwork}])
        second=self.client.post("/projects",headers=headers,json={"name":"Same name"}).json()
        second_saved=self.client.put(f"/projects/{second['id']}",headers=headers,json={**second,"songs":[saved_entry]})
        self.assertEqual(second_saved.status_code,200)
        projects=self.client.get(f"/songs/{saved_entry['songId']}/projects",headers=headers)
        self.assertEqual(projects.status_code,200)
        self.assertEqual(projects.json(),{"projects":sorted([{"id":first["id"],"name":"Same name"},{"id":second["id"],"name":"Same name"}],key=lambda item:item["id"])})
        self.client.cookies.clear()
        self.assertEqual(self.client.get(f"/songs/{saved_entry['songId']}/projects").status_code,401)

    def test_project_song_cover_api_rejects_duplicate_and_malformed_project_covers(self):
        headers=self.login(); project=self.client.post("/projects",headers=headers,json={"name":"Covers"}).json()
        base={**project,"songs":[{"song":{**song(),"projectCovers":[{"projectId":project["id"],"cover":"data:image/png;base64,YQ=="}]}}]}
        self.assertEqual(self.client.put(f"/projects/{project['id']}",headers=headers,json=base).status_code,200)
        invalids=[
            [{"projectId":project["id"],"cover":"data:image/png;base64,YQ=="},{"projectId":project["id"],"cover":""}],
            [{"projectId":" ","cover":""}],
            [{"projectId":project["id"],"cover":"javascript:bad"}],
            "bad",
        ]
        for covers in invalids:
            response=self.client.put(f"/projects/{project['id']}",headers=headers,json={**base,"songs":[{"song":{**song(),"projectCovers":covers}}]})
            self.assertEqual(response.status_code,400)

    def test_import_remaps_local_project_cover_key_to_created_cloud_project(self):
        headers=self.login(); local_id="portable-project"
        response=self.client.post("/imports",headers=headers,json={
            "migrationKey":local_id,"name":"Portable","cover":"",
            "songs":[{"song":{**song(),"projectCovers":[{"projectId":local_id,"cover":"data:image/png;base64,YQ=="}]}}],
        })
        self.assertEqual(response.status_code,201)
        created=response.json(); self.assertNotEqual(created["id"],local_id)
        self.assertEqual(created["songs"][0]["song"]["projectCovers"],[{"projectId":created["id"],"cover":"data:image/png;base64,YQ=="}])
        retry=self.client.post("/imports",headers=headers,json={
            "migrationKey":local_id,"name":"Portable","cover":"",
            "songs":[{"song":{**song(),"projectCovers":[{"projectId":local_id,"cover":"data:image/png;base64,YQ=="}]}}],
        })
        self.assertEqual(retry.status_code,200)
        self.assertEqual(retry.json(),created)

    def test_project_and_song_end_captions_and_blank_interludes_persist(self):
        headers=self.login()
        project=self.client.post("/projects",headers=headers,json={"name":"Captions"}).json()
        ready=song()
        ready["endCaption"]="Song ending"
        ready["cues"]=[{"id":"rest","start":0,"text":"","type":"rest"}]
        saved=self.client.put(f"/projects/{project['id']}",headers=headers,json={
            "revision":project["revision"], "name":"Captions", "endCaption":"Project ending", "songs":[{"song":ready}],
        })
        self.assertEqual(saved.status_code,200)
        self.assertEqual(saved.json()["endCaption"],"Project ending")
        self.assertEqual(saved.json()["songs"][0]["song"]["endCaption"],"Song ending")
        self.assertEqual(self.client.get(f"/projects/{project['id']}").json()["songs"][0]["song"]["cues"][0]["text"],"")
        self.assertEqual(self.client.get("/projects",headers=headers).json()["projects"][0]["endCaption"],"Project ending")
        too_long=self.client.put(f"/projects/{project['id']}",headers=headers,json={
            "revision":saved.json()["revision"], "name":"Captions", "endCaption":"x"*1001, "songs":saved.json()["songs"],
        })
        self.assertEqual(too_long.status_code,400)
        oversized_song=dict(ready, endCaption="x"*1001)
        too_long_song=self.client.put(f"/projects/{project['id']}",headers=headers,json={
            "revision":saved.json()["revision"], "name":"Captions", "songs":[{"song":oversized_song}],
        })
        self.assertEqual(too_long_song.status_code,400)

    def test_standalone_song_auth_and_validation(self):
        data={"migrationKey":"local-song", "song":song()}
        self.assertEqual(self.client.post("/songs",headers=self.headers,json=data).status_code,401)
        self.assertEqual(self.client.put("/songs/unknown",headers=self.headers,json=data).status_code,401)
        headers=self.login()
        self.assertEqual(self.client.post("/songs",json=data).status_code,403)
        self.assertEqual(self.client.put("/songs/unknown",json=data).status_code,403)
        for invalid in (None, [], {}, {**data,"migrationKey":" "}, {**data,"migrationKey":42}, {**data,"migrationKey":"k"*301}, {**data,"song":{}}, {**data,"audioId":[]}, {**data,"backingAudioId":1}):
            self.assertEqual(self.client.post("/songs",headers=headers,json=invalid).status_code,400)
        for invalid in ({"song":song()}, {"revisionId":None,"song":song()}, {"revisionId":"","song":song()}, {"revisionId":"x","song":{}}):
            self.assertEqual(self.client.put("/songs/unknown",headers=headers,json=invalid).status_code,400)
        self.assertEqual(self.client.get("/library").json()["songs"],[])

    def test_standalone_song_upload_retry_survives_restart_without_project(self):
        headers=self.login(); data={"migrationKey":"local-song", "song":song()}
        first=self.client.post("/songs",headers=headers,json=data)
        self.assertEqual(first.status_code,201); entry=first.json()
        self.assertNotEqual(entry["songId"],"local-id")
        self.assertEqual(entry["song"]["id"],entry["songId"])
        retry=self.client.post("/songs",headers=headers,json=data)
        self.assertEqual(retry.status_code,200); self.assertEqual(retry.json(),entry)
        store=self.client.app.state.store
        self.client.app.state.store=type(store)(store.data_dir)
        retry=self.client.post("/songs",headers=headers,json={**data,"song":song("Changed draft")})
        self.assertEqual(retry.status_code,200); self.assertEqual(retry.json(),entry)
        self.assertEqual(self.client.get("/projects").json()["projects"],[])
        self.assertEqual(len(self.client.get("/library").json()["songs"]),1)
        with store.read() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM song_revisions").fetchone()[0],1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM song_uploads").fetchone()[0],1)
        # Failure rolls back the retry key along with the song, allowing recovery.
        missing={"migrationKey":"missing-audio", "song":song("Recovered audio"), "audioId":"missing"}
        self.assertEqual(self.client.post("/songs",headers=headers,json=missing).status_code,404)
        self.assertEqual(self.client.post("/songs",headers=headers,json={**missing,"audioId":None}).status_code,201)

    def test_library_update_retries_conflicts_and_project_heads(self):
        headers=self.login()
        original=self.client.post("/songs",headers=headers,json={"migrationKey":"library", "song":song()}).json()
        project=self.client.post("/projects",headers=headers,json={"name":"Pinned"}).json()
        pinned=self.client.put(f"/projects/{project['id']}",headers=headers,json={"revision":project["revision"],"name":"Pinned","songs":[original]}).json()
        data={"revisionId":original["revisionId"],"song":song("Updated library")}
        path=f"/songs/{original['songId']}"
        update=self.client.put(path,headers=headers,json=data)
        self.assertEqual(update.status_code,200); updated=update.json()
        self.assertNotEqual(updated["revisionId"],original["revisionId"])
        self.assertEqual(updated["song"]["id"],original["songId"])
        self.assertEqual(self.client.put(path,headers=headers,json=data).json(),updated)
        conflict=self.client.put(path,headers=headers,json={**data,"song":song("Independent local edit")})
        self.assertEqual(conflict.status_code,409); self.assertEqual(conflict.json()["code"],"conflict")
        self.assertEqual(self.client.get(path).json(),updated)
        self.assertEqual(self.client.get(f"/projects/{pinned['id']}").json()["songs"],[updated])
        self.assertEqual(self.client.get("/library").json()["songs"][0]["revisionId"],updated["revisionId"])
        # A lost original upload response keeps its original baseline after an update.
        self.assertEqual(self.client.post("/songs",headers=headers,json={"migrationKey":"library","song":song()}).json(),original)
        copied=self.client.post("/songs",headers=headers,json={"migrationKey":"conflict-copy","song":song("Independent local edit")}).json()
        self.assertNotEqual(copied["songId"],original["songId"])
        self.assertEqual(self.client.get(path).json(),updated)
        self.assertEqual(self.client.put("/songs/unknown",headers=headers,json=data).status_code,404)
        self.assertEqual(self.client.put(path,headers=headers,json={**data,"revisionId":copied["revisionId"]}).status_code,404)
        with self.client.app.state.store.read() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM song_revisions WHERE song_id=?",(original["songId"],)).fetchone()[0],2)

    def test_library_includes_original_creation_date_across_edits_and_copies(self):
        headers=self.login()
        original=self.client.post("/songs",headers=headers,json={"migrationKey":"dated-original", "song":song()}).json()
        store=self.client.app.state.store
        with store.tx() as db:
            db.execute("UPDATE songs SET created_at=? WHERE id=?",("2020-01-02 03:04:05",original["songId"]))
        before=self.client.get("/library").json()["songs"][0]["createdAt"]
        self.assertEqual(before,"2020-01-02T03:04:05Z")
        edited=self.client.put(f"/songs/{original['songId']}",headers=headers,json={"revisionId":original["revisionId"],"song":song("Edited")}).json()
        after=next(item["createdAt"] for item in self.client.get("/library").json()["songs"] if item["id"]==original["songId"])
        self.assertEqual(after,before)
        copied=self.client.post("/songs",headers=headers,json={"migrationKey":"dated-copy", "song":song("Copied")}).json()
        copy_date=next(item["createdAt"] for item in self.client.get("/library").json()["songs"] if item["id"]==copied["songId"])
        self.assertNotEqual(copy_date,before)
        self.assertEqual(edited["song"]["title"],"Edited")

    def test_library_update_preserves_omitted_audio_and_can_clear_backing(self):
        headers=self.login(); payload=io.BytesIO()
        with wave.open(payload,"wb") as output:
            output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b"\0\0"*8000)
        audio=self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":"backing.wav"},content=payload.getvalue()).json()
        original=self.client.post("/songs",headers=headers,json={"migrationKey":"with-audio", "song":song(),"audioId":audio["id"],"backingAudioId":audio["id"]}).json()
        path=f"/songs/{original['songId']}"
        self.assertEqual(original["song"]["backing"],{"fileName":"backing.wav"})
        updated=self.client.put(path,headers=headers,json={"revisionId":original["revisionId"],"song":song("Retains audio")}).json()
        self.assertEqual(updated["audioId"],audio["id"]); self.assertEqual(updated["backingAudioId"],audio["id"])
        self.assertEqual(updated["song"]["backing"],{"fileName":"backing.wav"})
        cleared=self.client.put(path,headers=headers,json={"revisionId":updated["revisionId"],"song":updated["song"],"audioId":None,"backingAudioId":None}).json()
        self.assertIsNone(cleared["audioId"]); self.assertIsNone(cleared["backingAudioId"])
        self.assertNotIn("backing",cleared["song"])
        self.assertEqual(self.client.get(f"/audio/{audio['id']}").content,payload.getvalue())
        missing=self.client.put(path,headers=headers,json={"revisionId":cleared["revisionId"],"song":cleared["song"],"backingAudioId":"missing"})
        self.assertEqual(missing.status_code,404); self.assertEqual(self.client.get(path).json(),cleared)

    def test_project_save_uses_latest_heads_and_rejects_conflicting_song_edits_atomically(self):
        headers=self.login()
        original=self.client.post("/songs",headers=headers,json={"migrationKey":"shared", "song":song()}).json()
        def project(name):
            result=self.client.post("/projects",headers=headers,json={"name":name}).json()
            return self.client.put(f"/projects/{result['id']}",headers=headers,json={"revision":result["revision"],"name":name,"songs":[original]}).json()
        first=project("First"); second=project("Second")
        changed={**original, "song":{**original["song"], "cues":[{"id":"c1","start":1,"text":"new lyric","type":"lyric"}]}}
        saved=self.client.put(f"/projects/{first['id']}",headers=headers,json={**first,"songs":[changed]}).json()
        latest=saved["songs"][0]
        self.assertEqual(self.client.get(f"/songs/{original['songId']}").json(),latest)
        self.assertEqual(self.client.get(f"/projects/{second['id']}").json()["songs"],[latest])
        # The second editor has only reordered/renamed its old project. Its
        # unchanged song baseline must not revert the first editor's lyric.
        structural=self.client.put(f"/projects/{second['id']}",headers=headers,json={**second,"name":"Renamed","songs":[original,original]})
        self.assertEqual(structural.status_code,200)
        self.assertEqual(structural.json()["songs"],[latest,latest])
        stale_edit={**original,"song":{**original["song"],"title":"Conflicting edit"}}
        conflict=self.client.put(f"/projects/{second['id']}",headers=headers,json={**structural.json(),"name":"Must roll back","songs":[{"song":song("Must roll back")},stale_edit]})
        self.assertEqual(conflict.status_code,409)
        self.assertEqual(self.client.get(f"/projects/{second['id']}").json(),structural.json())
        self.assertEqual(len(self.client.get("/library").json()["songs"]),1)

    def test_cloud_writes_require_ready_valid_changed_songs(self):
        headers=self.login()
        for index,invalid in enumerate((
            {**song(),"reviewed":False}, {**song(),"title":" "}, {**song(),"duration":0},
            {**song(),"delayMs":None}, {**song(),"cues":[]},
            {**song(),"cues":[{"start":2,"text":"late","type":"lyric"}]},
            {**song(),"cues":[{"start":1,"text":"one","type":"lyric"},{"start":1,"text":"two","type":"rest"}]},
            {**song(),"cues":[{"start":0,"text":" ","type":"lyric"}]},
        )):
            response=self.client.post("/songs",headers=headers,json={"migrationKey":f"invalid-{index}","song":invalid})
            self.assertEqual(response.status_code,400); self.assertEqual(response.json()["code"],"not_ready")
        original=self.client.post("/songs",headers=headers,json={"migrationKey":"ready", "song":song()}).json()
        draft={**original,"song":{**original["song"],"reviewed":False,"title":"Pending"}}
        response=self.client.put(f"/songs/{original['songId']}",headers=headers,json=draft)
        self.assertEqual(response.status_code,400); self.assertEqual(response.json()["code"],"not_ready")
        project=self.client.post("/projects",headers=headers,json={"name":"Ready"}).json()
        response=self.client.put(f"/projects/{project['id']}",headers=headers,json={**project,"songs":[draft]})
        self.assertEqual(response.status_code,400)
        self.assertEqual(self.client.get(f"/projects/{project['id']}").json(),project)
        self.assertEqual(self.client.get(f"/songs/{original['songId']}").json(),original)
        # Existing unready legacy heads can still be included unchanged.
        store=self.client.app.state.store
        legacy={**original["song"],"reviewed":False}
        with store.tx() as db: db.execute("UPDATE song_revisions SET body=? WHERE id=?",(json.dumps(legacy,ensure_ascii=False,sort_keys=True,separators=(",",":")),original["revisionId"]))
        original["song"]=legacy
        response=self.client.put(f"/projects/{project['id']}",headers=headers,json={**project,"songs":[original]})
        self.assertEqual(response.status_code,200)
        listing=self.client.get("/library").json()["songs"][0]
        self.assertFalse(listing["reviewed"]); self.assertFalse(listing["valid"])

    def test_song_identity_uniqueness_is_trimmed_exact_and_serialized(self):
        headers=self.login()
        original=self.client.post("/songs",headers=headers,json={"migrationKey":"original", "song":song()}).json()
        duplicate={**song(),"title":" Song ","artist":" Artist ","version":" original "}
        response=self.client.post("/songs",headers=headers,json={"migrationKey":"duplicate", "song":duplicate})
        self.assertEqual(response.status_code,409); self.assertEqual(response.json()["code"],"duplicate_song")
        for field,value in (("title","song"),("artist","Other"),("version","Live")):
            response=self.client.post("/songs",headers=headers,json={"migrationKey":field, "song":{**song(),field:value}})
            self.assertEqual(response.status_code,201)
        changed={**original,"song":{**original["song"],"version":"Live"}}
        self.assertEqual(self.client.put(f"/songs/{original['songId']}",headers=headers,json=changed).status_code,409)
        # Empty and omitted optional values have identical semantic identities.
        empty={**song("Empty"),"artist":"", "version":""}
        self.assertEqual(self.client.post("/songs",headers=headers,json={"migrationKey":"empty", "song":empty}).status_code,201)
        empty.pop("artist"); empty.pop("version")
        self.assertEqual(self.client.post("/songs",headers=headers,json={"migrationKey":"absent", "song":empty}).status_code,409)
        # Separate connections compete for the same identity; the transaction
        # permits one create and rejects the other without leaving empty songs.
        store=self.client.app.state.store
        from backend.store import DuplicateSong
        def create(key):
            try: return store.create_song(key,{"song":song("Concurrent")})[1]
            except DuplicateSong: return False
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(create,["race-one","race-two"]))
        self.assertEqual(sorted(results),[False,True])
        self.assertEqual(len(self.client.get("/library?q=original").json()["songs"]),4)
        self.assertEqual(len(self.client.get("/library?q=Live").json()["songs"]),1)

    def test_delete_library_song_removes_all_cloud_occurrences_and_blocks_stale_retry(self):
        headers=self.login()
        def create(key): return self.client.post("/songs",headers=headers,json={"migrationKey":key,"song":song(key)}).json()
        removed=create("Removed"); one=create("One"); two=create("Two")
        projects=[]
        for name,entries in (("First",[removed,one,removed,two]),("Second",[two,removed,removed,one])):
            project=self.client.post("/projects",headers=headers,json={"name":name}).json()
            projects.append(self.client.put(f"/projects/{project['id']}",headers=headers,json={**project,"songs":entries}).json())
        self.assertEqual(self.client.delete(f"/songs/{removed['songId']}",headers=headers).status_code,204)
        self.assertEqual(self.client.get(f"/songs/{removed['songId']}").status_code,404)
        for stale,expected in zip(projects,([one,two],[two,one])):
            current=self.client.get(f"/projects/{stale['id']}").json()
            self.assertEqual(current["songs"],expected); self.assertEqual(current["revision"],stale["revision"]+1)
            self.assertEqual(self.client.put(f"/projects/{stale['id']}",headers=headers,json=stale).status_code,409)
            self.assertEqual(self.client.put(f"/projects/{stale['id']}",headers=headers,json={**current,"songs":[removed]}).status_code,404)
        self.assertEqual(self.client.put(f"/songs/{removed['songId']}",headers=headers,json=removed).status_code,404)
        self.assertEqual(self.client.post("/songs",headers=headers,json={"migrationKey":"Removed","song":song("Removed")}).status_code,404)
        # Removing a project entry alone keeps its library head.
        current=self.client.get(f"/projects/{projects[0]['id']}").json()
        self.assertEqual(self.client.put(f"/projects/{current['id']}",headers=headers,json={**current,"songs":[]}).status_code,200)
        self.assertEqual(self.client.get(f"/songs/{one['songId']}").status_code,200)

    def test_existing_semantic_duplicates_are_not_merged_on_restart(self):
        headers=self.login()
        first=self.client.post("/songs",headers=headers,json={"migrationKey":"first", "song":song("First")}).json()
        second=self.client.post("/songs",headers=headers,json={"migrationKey":"second", "song":song("Second")}).json()
        store=self.client.app.state.store
        # Reproduce a pre-revision-16 library whose separate heads already share
        # metadata. Initialization preserves both identities and their content.
        legacy={**second["song"],"title":"First"}
        with store.tx() as db: db.execute("UPDATE song_revisions SET body=? WHERE id=?",(json.dumps(legacy,ensure_ascii=False,sort_keys=True,separators=(",",":")),second["revisionId"]))
        self.client.app.state.store=type(store)(store.data_dir)
        self.assertEqual(len(self.client.get("/library").json()["songs"]),2)
        self.assertEqual(self.client.get(f"/songs/{first['songId']}").json(),first)
        self.assertEqual(self.client.get(f"/songs/{second['songId']}").json()["song"],legacy)
        edited={**first,"song":{**first["song"],"delayMs":50}}
        self.assertEqual(self.client.put(f"/songs/{first['songId']}",headers=headers,json=edited).status_code,409)

    def test_delete_referenced_song_cleans_only_unshared_audio(self):
        headers=self.login()
        def upload(frames):
            payload=io.BytesIO()
            with wave.open(payload,"wb") as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b"\0\0"*frames)
            return self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":"backing.wav"},content=payload.getvalue()).json()["id"]
        shared=upload(8000); unique=upload(16000)
        removed=self.client.post("/songs",headers=headers,json={"migrationKey":"removed", "song":song("Removed"),"audioId":unique,"backingAudioId":shared}).json()
        retained=self.client.post("/songs",headers=headers,json={"migrationKey":"retained", "song":{**song("Backing only"),"cues":[]},"backingAudioId":shared}).json()
        project=self.client.post("/projects",headers=headers,json={"name":"Audio"}).json()
        self.assertEqual(self.client.put(f"/projects/{project['id']}",headers=headers,json={**project,"songs":[removed,retained]}).status_code,200)
        self.assertEqual(self.client.delete(f"/songs/{removed['songId']}",headers=headers).status_code,204)
        self.assertEqual(self.client.get(f"/audio/{unique}").status_code,404)
        self.assertEqual(self.client.get(f"/audio/{shared}").status_code,200)
        self.assertEqual(self.client.delete(f"/songs/{retained['songId']}",headers=headers).status_code,204)
        self.assertEqual(self.client.get(f"/audio/{shared}").status_code,404)

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

    def test_backing_track_persists_latest_replaces_and_removes(self):
        headers=self.login()
        def upload(name, seconds):
            payload=io.BytesIO()
            with wave.open(payload,"wb") as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b"\0\0" * (8000 * seconds))
            result=self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":name},content=payload.getvalue())
            self.assertEqual(result.status_code,201)
            return result.json(), payload.getvalue()
        original,_=upload("original.wav",1); backing_one,backing_bytes=upload("backing-one.wav",2); backing_two,_=upload("backing-two.wav",3)
        project=self.client.post("/projects",headers=headers,json={"name":"Backing"}).json()
        first=self.client.put(f"/projects/{project['id']}",headers=headers,json={"revision":project["revision"],"name":"Backing","songs":[{"song":song(),"audioId":original["id"],"backingAudioId":backing_one["id"]}]}).json()
        entry=first["songs"][0]
        self.assertEqual(entry["backingAudioId"],backing_one["id"])
        self.assertEqual(entry["song"]["backing"],{"fileName":"backing-one.wav"})
        # A second project resolves the current library arrangement automatically.
        pinned_project=self.client.post("/projects",headers=headers,json={"name":"Pinned"}).json()
        pinned=self.client.put(f"/projects/{pinned_project['id']}",headers=headers,json={"revision":pinned_project["revision"],"name":"Pinned","songs":[entry]}).json()
        replacement=dict(entry); replacement["backingAudioId"]=backing_two["id"]
        changed=self.client.put(f"/projects/{first['id']}",headers=headers,json={"revision":first["revision"],"name":"Backing","songs":[replacement]}).json()
        self.assertEqual(changed["songs"][0]["song"]["backing"],{"fileName":"backing-two.wav"})
        self.assertEqual(self.client.get(f"/projects/{pinned['id']}").json()["songs"][0]["backingAudioId"],backing_two["id"])
        # A revision-3 client omits the new ID and metadata; its save retains both.
        old_client=dict(changed["songs"][0]); old_client.pop("backingAudioId"); old_client["song"]=dict(old_client["song"]); old_client["song"].pop("backing")
        old_saved=self.client.put(f"/projects/{changed['id']}",headers=headers,json={"revision":changed["revision"],"name":"Backing","songs":[old_client]}).json()
        self.assertEqual(old_saved["songs"][0]["backingAudioId"],backing_two["id"])
        self.assertEqual(old_saved["songs"][0]["song"]["backing"],{"fileName":"backing-two.wav"})
        removed=dict(old_saved["songs"][0]); removed["backingAudioId"]=None
        no_backing=self.client.put(f"/projects/{old_saved['id']}",headers=headers,json={"revision":old_saved["revision"],"name":"Backing","songs":[removed]}).json()
        self.assertIsNone(no_backing["songs"][0]["backingAudioId"])
        self.assertNotIn("backing",no_backing["songs"][0]["song"])
        # Historical library revisions still account for and serve replaced audio.
        self.assertEqual(self.client.get(f"/audio/{backing_one['id']}").content,backing_bytes)

    def test_backing_audio_cleanup_and_backup_restore(self):
        headers=self.login()
        def wav(name, frames):
            payload=io.BytesIO()
            with wave.open(payload,"wb") as output:
                output.setnchannels(1); output.setsampwidth(2); output.setframerate(8000); output.writeframes(b"\0\0" * frames)
            return self.client.post("/audio",headers={**headers,"Content-Type":"audio/wav","X-Lyrics-Filename":name},content=payload.getvalue()).json(),payload.getvalue()
        shared,shared_bytes=wav("shared.wav",8000)
        project=self.client.post("/projects",headers=headers,json={"name":"Archive backing"}).json()
        saved=self.client.put(f"/projects/{project['id']}",headers=headers,json={"revision":project["revision"],"name":"Archive backing","songs":[{"song":song(),"audioId":shared["id"],"backingAudioId":shared["id"]}]}).json()
        # Shared role references prevent cleanup from deleting the same upload.
        self.assertEqual(self.client.post("/audio/cleanup",headers=headers,json={"keepAudioIds":[]}).json()["deleted"],0)
        archive=Path(self.temp.name)/"backing.tar.gz"; backup(Path(self.temp.name),archive)
        restored=Path(self.temp.name).parent/"restored-backing-test"; restore(archive,restored)
        try:
            settings=Settings(restored,make_scrypt("organizer password"),"http://testserver","s","/",False,1024*1024)
            client=TestClient(create_app(settings)); client.post("/login",headers=self.headers,json={"password":"organizer password"})
            reopened=client.get(f"/projects/{saved['id']}").json()["songs"][0]
            self.assertEqual(reopened["audioId"],shared["id"]); self.assertEqual(reopened["backingAudioId"],shared["id"])
            self.assertEqual(client.get(f"/audio/{shared['id']}").content,shared_bytes)
        finally:
            import shutil; shutil.rmtree(restored,ignore_errors=True)

    def test_restore_revision_three_backup_without_backing_column(self):
        legacy=Path(self.temp.name)/"legacy"; legacy.mkdir(); (legacy/"audio").mkdir()
        audio_id="11111111-1111-1111-1111-111111111111"; song_id="22222222-2222-2222-2222-222222222222"; revision_id="33333333-3333-3333-3333-333333333333"; project_id="44444444-4444-4444-4444-444444444444"
        db=sqlite3.connect(legacy/"lyrics.sqlite3")
        try:
            db.executescript("""
                CREATE TABLE audio(id TEXT PRIMARY KEY, file_name TEXT NOT NULL, duration REAL NOT NULL, bytes INTEGER NOT NULL, mime_type TEXT NOT NULL, content_hash TEXT, owner_token_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE upload_reservations(id TEXT PRIMARY KEY, bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE songs(id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE song_revisions(id TEXT PRIMARY KEY, song_id TEXT NOT NULL, audio_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE projects(id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, migration_key TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
                CREATE TABLE project_entries(project_id TEXT NOT NULL, position INTEGER NOT NULL, song_id TEXT NOT NULL, revision_id TEXT NOT NULL, PRIMARY KEY(project_id,position));
                CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
            """)
            db.execute("INSERT INTO audio(id,file_name,duration,bytes,mime_type) VALUES(?,?,?,?,?)",(audio_id,"old.wav",1,3,"audio/wav"))
            db.execute("INSERT INTO songs(id) VALUES(?)",(song_id,))
            db.execute("INSERT INTO song_revisions(id,song_id,audio_id,body) VALUES(?,?,?,?)",(revision_id,song_id,audio_id,json.dumps(song("Old"))))
            db.execute("INSERT INTO projects(id,name,revision) VALUES(?,?,?)",(project_id,"Old",1))
            db.execute("INSERT INTO project_entries(project_id,position,song_id,revision_id) VALUES(?,?,?,?)",(project_id,0,song_id,revision_id)); db.commit()
        finally: db.close()
        (legacy/"audio"/audio_id).write_bytes(b"old")
        archive=Path(self.temp.name)/"legacy.tar.gz"; backup(legacy,archive)
        restored=Path(self.temp.name)/"restored-legacy"; restore(archive,restored)
        try:
            settings=Settings(restored,make_scrypt("organizer password"),"http://testserver","s","/",False,1024*1024)
            client=TestClient(create_app(settings)); client.post("/login",headers=self.headers,json={"password":"organizer password"})
            entry=client.get(f"/projects/{project_id}").json()["songs"][0]
            self.assertEqual(entry["audioId"],audio_id); self.assertIsNone(entry["backingAudioId"])
            with client.app.state.store.read() as migrated:
                self.assertIn("backing_audio_id",{row[1] for row in migrated.execute("PRAGMA table_info(song_revisions)")})
            migration_backups=list((restored/"backups").glob("pre-backing-migration-*.tar.gz"))
            self.assertEqual(len(migration_backups),1)
            self.assertEqual((restored/"backups").stat().st_mode & 0o777,0o700)
            self.assertEqual(migration_backups[0].stat().st_mode & 0o777,0o600)
            recovered=Path(self.temp.name)/"recovered-legacy"; restore(migration_backups[0],recovered)
            try:
                old_db=sqlite3.connect(recovered/"lyrics.sqlite3")
                try: self.assertNotIn("backing_audio_id",{row[1] for row in old_db.execute("PRAGMA table_info(song_revisions)")})
                finally: old_db.close()
                self.assertEqual((recovered/"audio"/audio_id).read_bytes(),b"old")
            finally:
                import shutil; shutil.rmtree(recovered,ignore_errors=True)
            # A later restart sees the migrated column and leaves the sole archive alone.
            create_app(settings)
            self.assertEqual(len(list((restored/"backups").glob("pre-backing-migration-*.tar.gz"))),1)
        finally:
            import shutil; shutil.rmtree(restored,ignore_errors=True)

    def test_pre_migration_backup_failure_leaves_old_schema_untouched(self):
        legacy=Path(self.temp.name)/"failed-migration"; legacy.mkdir(); (legacy/"audio").mkdir()
        db=sqlite3.connect(legacy/"lyrics.sqlite3")
        try:
            db.execute("CREATE TABLE song_revisions(id TEXT PRIMARY KEY, song_id TEXT NOT NULL, audio_id TEXT, body TEXT NOT NULL)"); db.commit()
        finally: db.close()
        from backend.store import Store
        with patch("backend.store.backup",side_effect=OSError("full")):
            with self.assertRaises(RuntimeError): Store(legacy)
        db=sqlite3.connect(legacy/"lyrics.sqlite3")
        try: self.assertNotIn("backing_audio_id",{row[1] for row in db.execute("PRAGMA table_info(song_revisions)")})
        finally: db.close()
        backups=legacy/"backups"
        self.assertFalse(backups.exists() and any(backups.iterdir()))

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
