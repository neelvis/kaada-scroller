from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import time
import uuid
from urllib.parse import unquote
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

from mutagen import File as MediaFile
from starlette.exceptions import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route

from .config import Settings, decode_scrypt
from .store import Conflict, DuplicateSong, InvalidSong, Missing, Store

MAX_UPLOAD = 150 * 1024 * 1024
MAX_DURATION = 20 * 60
LOGIN_WINDOW, LOGIN_ATTEMPTS = 300, 8


def error(message: str, code: str, status: int) -> JSONResponse:
    return JSONResponse({"error": message, "code": code}, status_code=status)


def valid_song(song: Any) -> bool:
    return isinstance(song, dict) and isinstance(song.get("title"), str) and isinstance(song.get("cues"), list) and isinstance(song.get("duration"), (int, float))


def valid_entry(entry: Any) -> bool:
    if not isinstance(entry, dict) or not valid_song(entry.get("song")): return False
    return all(key not in entry or entry[key] is None or isinstance(entry[key], str) for key in ("audioId", "backingAudioId"))


def verify_password(settings: Settings, password: str) -> bool:
    n, r, p, salt, expected = decode_scrypt(settings.password_scrypt)
    actual = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(expected))
    return hmac.compare_digest(actual, expected)


async def body_json(request: Request) -> Any:
    if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
        raise ValueError()
    chunks=[]; size=0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 5 * 1024 * 1024: raise HTTPException(status_code=413)
        chunks.append(chunk)
    return json.loads(b"".join(chunks))


def remote_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def check_origin(request: Request, settings: Settings) -> bool:
    return request.headers.get("origin") == settings.origin and request.headers.get("x-lyrics-request") == "1"


def session(request: Request, store: Store) -> tuple[str, str] | None:
    token=request.cookies.get(request.app.state.settings.cookie_name)
    if not token: return None
    digest=hashlib.sha256(token.encode()).hexdigest()
    with store.read() as db:
        row=db.execute("SELECT csrf FROM sessions WHERE token_hash=? AND expires_at>?", (digest, int(time.time()))).fetchone()
    return (digest,row["csrf"]) if row else None


def require(request: Request, write: bool = False) -> tuple[str, str] | JSONResponse:
    settings: Settings=request.app.state.settings; store: Store=request.app.state.store
    found=session(request, store)
    if not found: return error("Войдите с паролем организатора.", "unauthorized", 401)
    if write and (not check_origin(request, settings) or request.headers.get("x-lyrics-csrf") != found[1]):
        return error("Проверьте защищённый запрос и перезагрузите страницу.", "csrf", 403)
    return found


async def health(request: Request) -> Response: return JSONResponse({"ok": True})

async def login(request: Request) -> Response:
    settings=request.app.state.settings; store=request.app.state.store; ip=remote_ip(request); now=time.time(); attempts=request.app.state.login_attempts[ip]
    while attempts and attempts[0] < now-LOGIN_WINDOW: attempts.popleft()
    if len(attempts) >= LOGIN_ATTEMPTS: return error("Слишком много попыток. Подождите несколько минут.", "rate_limited", 429)
    if not check_origin(request, settings): return error("Запрос разрешён только со страницы организатора.", "csrf", 403)
    # Reserve before the first await: delayed bodies count as in-flight attempts.
    attempts.append(now)
    try: data=await body_json(request); password=data["password"]
    except (ValueError, KeyError, TypeError, json.JSONDecodeError): return error("Введите пароль.", "invalid", 400)
    if not isinstance(password, str) or not await run_in_threadpool(verify_password, settings, password):
        return error("Неверный пароль.", "unauthorized", 401)
    # A successful login releases only its own reservation.
    if now in attempts: attempts.remove(now)
    token=secrets.token_urlsafe(32); csrf=secrets.token_urlsafe(32); digest=hashlib.sha256(token.encode()).hexdigest()
    with store.tx() as db:
        db.execute("DELETE FROM sessions WHERE expires_at<?", (int(now),))
        db.execute("INSERT INTO sessions(token_hash,csrf,expires_at) VALUES(?,?,?)", (digest,csrf,int(now)+12*3600))
    response=JSONResponse({"csrf": csrf})
    response.set_cookie(settings.cookie_name,token,max_age=12*3600,httponly=True,secure=settings.cookie_secure,samesite="strict",path=settings.cookie_path)
    return response

async def get_session(request: Request) -> Response:
    found=require(request)
    return found if isinstance(found, Response) else JSONResponse({"csrf": found[1]})

async def logout(request: Request) -> Response:
    found=require(request, True)
    if isinstance(found, Response): return found
    with request.app.state.store.tx() as db: db.execute("DELETE FROM sessions WHERE token_hash=?", (found[0],))
    response=Response(status_code=204); s=request.app.state.settings
    response.delete_cookie(s.cookie_name,path=s.cookie_path,secure=s.cookie_secure,httponly=True,samesite="strict")
    return response

async def projects(request: Request) -> Response:
    found=require(request, request.method == "POST")
    if isinstance(found, Response): return found
    store=request.app.state.store
    if request.method == "GET": return JSONResponse({"projects": store.list_projects()})
    try: data=await body_json(request); name=data["name"].strip()
    except (ValueError, KeyError, AttributeError, json.JSONDecodeError): return error("Укажите название проекта.", "invalid", 400)
    if not name or len(name)>300: return error("Укажите название проекта до 300 символов.", "invalid", 400)
    return JSONResponse(store.create_project(name),status_code=201)

async def project(request: Request) -> Response:
    found=require(request, request.method in {"PUT","DELETE"})
    if isinstance(found, Response): return found
    store=request.app.state.store; project_id=request.path_params["project_id"]
    try:
        if request.method == "GET":
            with store.read() as db: return JSONResponse(store.full_project(db,project_id))
        data=await body_json(request)
        if request.method == "DELETE":
            store.delete_project(project_id,data["revision"]); return Response(status_code=204)
        name=data["name"].strip(); entries=data["songs"]
        if not isinstance(data["revision"],int) or not isinstance(entries,list) or len(entries)>250 or not name: raise ValueError()
        if not all(valid_entry(e) for e in entries): raise ValueError()
        return JSONResponse(store.save_project(project_id,data["revision"],name,entries,data.get("cover", "")))
    except Conflict: return error("Проект уже изменён другим организатором. Загрузите новую версию перед повторной попыткой.","conflict",409)
    except DuplicateSong: return error("Песня с таким названием, исполнителем, альбомом и версией записи уже есть. Измените одно из полей.","duplicate_song",409)
    except InvalidSong: return error("Подтвердите готовность песни и проверьте её текст, длительность и таймлайн.","not_ready",400)
    except Missing: return error("Проект, песня, версия или запись не найдены.","not_found",404)
    except (ValueError,KeyError,AttributeError,TypeError,json.JSONDecodeError): return error("Проверьте название, версию и список песен.","invalid",400)

async def library(request: Request) -> Response:
    found=require(request)
    if isinstance(found, Response): return found
    return JSONResponse({"songs": request.app.state.store.library(request.query_params.get("q", "")[:300])})

async def songs(request: Request) -> Response:
    found=require(request, True)
    if isinstance(found, Response): return found
    try:
        data=await body_json(request); key=data["migrationKey"]
        if not isinstance(key,str) or not key.strip() or len(key)>300 or not valid_entry(data): raise ValueError()
        entry, created=request.app.state.store.create_song(key, data)
        return JSONResponse(entry,status_code=201 if created else 200)
    except Missing: return error("Указанная запись не найдена.","not_found",404)
    except DuplicateSong: return error("Песня с таким названием, исполнителем и версией записи уже есть. Измените одно из полей.","duplicate_song",409)
    except InvalidSong: return error("Подтвердите готовность песни и проверьте её текст, длительность и таймлайн.","not_ready",400)
    except (ValueError,KeyError,AttributeError,TypeError,json.JSONDecodeError): return error("Проверьте ключ переноса и песню.","invalid",400)

async def song(request: Request) -> Response:
    found=require(request, request.method in {"PUT","DELETE"})
    if isinstance(found, Response): return found
    store=request.app.state.store; song_id=request.path_params["song_id"]
    try:
        if request.method == "GET": return JSONResponse(store.get_song(song_id))
        if request.method == "PUT":
            data=await body_json(request); revision_id=data["revisionId"]
            if not isinstance(revision_id,str) or not revision_id or not valid_entry(data): raise ValueError()
            return JSONResponse(store.save_song(song_id,revision_id,data))
        audio_ids=store.delete_song(song_id)
        for audio_id in audio_ids: (store.audio_dir / audio_id).unlink(missing_ok=True)
        return Response(status_code=204)
    except DuplicateSong: return error("Песня с таким названием, исполнителем и версией записи уже есть. Измените одно из полей.","duplicate_song",409)
    except InvalidSong: return error("Подтвердите готовность песни и проверьте её текст, длительность и таймлайн.","not_ready",400)
    except Conflict: return error("Песня уже изменена. Загрузите новую версию или сохраните отдельную копию.","conflict",409)
    except Missing: return error("Песня не найдена.","not_found",404)
    except (ValueError,KeyError,AttributeError,TypeError,json.JSONDecodeError): return error("Проверьте версию и песню.","invalid",400)

def sniff(path: Path, content_type: str) -> bool:
    with path.open("rb") as stream: head=stream.read(12)
    if content_type == "audio/wav": return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    return head[:3] == b"ID3" or (len(head)>=2 and head[0] == 0xff and head[1]&0xe0 == 0xe0)

async def upload_audio(request: Request) -> Response:
    found=require(request, True)
    if isinstance(found, Response): return found
    store=request.app.state.store; content_type=request.headers.get("content-type", "").split(";",1)[0]
    if content_type not in {"audio/mpeg","audio/wav"}: return error("Загрузите MP3 или WAV.","invalid_media",415)
    label=request.headers.get("x-lyrics-filename", "recording")
    try: label=unquote(label)[:1000]
    except Exception: label="recording"
    fd, temp_name=tempfile.mkstemp(prefix="upload-",dir=store.data_dir); size=0; reservation_id=str(uuid.uuid4()); digest=hashlib.sha256(); reserved=False
    try:
        with os.fdopen(fd,"wb") as out:
            async for chunk in request.stream():
                if size + len(chunk) > MAX_UPLOAD: return error("Запись больше 150 МБ.","too_large",413)
                if not store.reserve_upload(reservation_id,len(chunk),request.app.state.settings.quota_bytes): return error("В библиотеке недостаточно места для этой записи.","quota",413)
                reserved=True; size += len(chunk); digest.update(chunk)
                out.write(chunk)
            out.flush(); os.fsync(out.fileno())
        temp=Path(temp_name)
        if not sniff(temp,content_type): return error("Файл не похож на заявленный MP3 или WAV.","invalid_media",415)
        media=MediaFile(temp)
        duration=getattr(getattr(media,"info",None),"length",None)
        if not isinstance(duration,(int,float)) or duration <= 0 or duration > MAX_DURATION: return error("Не удалось проверить длительность либо она больше 20 минут.","invalid_media",422)
        row, created=store.finish_upload(reservation_id,digest.hexdigest(),label,float(duration),size,content_type,found[0],temp); reserved=False
        if created:
            temp_name=""
        return JSONResponse({"id":row["id"],"fileName":row["file_name"],"duration":row["duration"]},status_code=201 if created else 200)
    except OSError:
        return error("На сервере недостаточно места для записи.","quota",507)
    except Exception as exc:
        if isinstance(exc, Response): return exc
        return error("Не удалось прочитать аудиозапись.","invalid_media",422)
    finally:
        if reserved: store.release_upload(reservation_id)
        if temp_name: Path(temp_name).unlink(missing_ok=True)

async def audio(request: Request) -> Response:
    found=require(request)
    if isinstance(found, Response): return found
    store=request.app.state.store; audio_id=request.path_params["audio_id"]
    with store.read() as db: row=db.execute("SELECT file_name,mime_type FROM audio WHERE id=?",(audio_id,)).fetchone()
    path=store.audio_dir/audio_id
    if not row or not path.is_file(): return error("Запись не найдена.","not_found",404)
    size=path.stat().st_size; headers={"Accept-Ranges":"bytes","Content-Disposition":"inline"}
    range_header=request.headers.get("range")
    if range_header:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header)
        start, end = match.groups() if match else ("", "")
        invalid = not match or not (start or end)
        if start:
            invalid = invalid or int(start) >= size or (bool(end) and int(end) < int(start))
        else:
            invalid = invalid or (bool(end) and int(end) == 0)
        if invalid:
            return Response(status_code=416, headers={"Content-Range":f"bytes */{size}"})
    # FileResponse handles ranges with bounded asynchronous reads (64 KiB),
    # including suffix ranges and If-Range, without buffering recordings.
    return FileResponse(path, media_type=row["mime_type"], headers=headers)


async def cleanup_audio(request: Request) -> Response:
    found=require(request, True)
    if isinstance(found, Response): return found
    try:
        data=await body_json(request); ids=data.get("keepAudioIds", [])
        if not isinstance(ids,list) or not all(isinstance(value,str) for value in ids): raise ValueError()
    except (ValueError, json.JSONDecodeError): return error("Проверьте список записей текущего черновика.","invalid",400)
    store=request.app.state.store; deleted=store.cleanup_orphan_audio(found[0],set(ids))
    for audio_id in deleted: (store.audio_dir/audio_id).unlink(missing_ok=True)
    return JSONResponse({"deleted":len(deleted)})

async def imports(request: Request) -> Response:
    found=require(request, True)
    if isinstance(found, Response): return found
    store=request.app.state.store
    try:
        data=await body_json(request); key=data["migrationKey"]; name=data["name"].strip(); songs=data["songs"]
        if not isinstance(key,str) or not key or not name or not isinstance(songs,list) or len(songs)>250 or not all(valid_entry(item) for item in songs): raise ValueError()
        entries=[{"song":item["song"],"audioId":item.get("audioId"),"backingAudioId":item.get("backingAudioId")} for item in songs]
        project, created=store.import_project(key,name,entries,data.get("cover", ""))
        return JSONResponse(project,status_code=201 if created else 200)
    except Conflict: return error("Импорт уже изменён.","conflict",409)
    except DuplicateSong: return error("Песня с таким названием, исполнителем и версией записи уже есть. Измените одно из полей.","duplicate_song",409)
    except InvalidSong: return error("Подтвердите готовность песни и проверьте её текст, длительность и таймлайн.","not_ready",400)
    except Missing: return error("Указанная запись не найдена.","not_found",404)
    except (ValueError,KeyError,AttributeError,TypeError,json.JSONDecodeError): return error("Проверьте ключ переноса и песни.","invalid",400)

async def imported_project(request: Request) -> Response:
    found=require(request)
    if isinstance(found, Response): return found
    try: return JSONResponse(request.app.state.store.imported_project(request.path_params["migration_key"]))
    except Missing: return error("Перенос с таким ключом ещё не завершён.","not_found",404)

def create_app(settings: Settings | None = None) -> Starlette:
    settings=settings or Settings.from_env(); store=Store(settings.data_dir)
    app=Starlette(exception_handlers={413: lambda request, exc: error("Данные для сохранения больше 5 МиБ. Уменьшите обложки проекта.", "too_large", 413)}, routes=[
        Route("/health",health), Route("/login",login,methods=["POST"]), Route("/session",get_session), Route("/logout",logout,methods=["POST"]),
        Route("/projects",projects,methods=["GET","POST"]), Route("/projects/{project_id}",project,methods=["GET","PUT","DELETE"]),
        Route("/library",library), Route("/songs",songs,methods=["POST"]), Route("/songs/{song_id}",song,methods=["GET","PUT","DELETE"]), Route("/audio",upload_audio,methods=["POST"]), Route("/audio/cleanup",cleanup_audio,methods=["POST"]), Route("/audio/{audio_id}",audio), Route("/imports",imports,methods=["POST"]), Route("/imports/{migration_key}",imported_project),
    ])
    app.state.settings=settings; app.state.store=store
    app.state.login_attempts=defaultdict(deque)
    return app

# A missing credential must prevent an accidentally public or half-configured service
# from starting. Tests use `create_app(Settings(...))` directly.
app=create_app()
