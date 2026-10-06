"""MIND BREEZE 2.0 — 기능상 오류(상) 8건 수정 회귀 테스트.

[1] CEL-OUTBOX-01  리마인더 이메일 이중 발송 → 단일 소비자 일원화
[2] CEL-CHAIN-01   리포트 생성 태스크 재시도 + 실패 마킹
[3] CEL-CHAIN-02   published 파이프라인 아웃박스 체인 미완료 재드라이브
[4] STG-01         청크 업로드 크기 상한 + 스트리밍 + 빈 파일 거부
[5] STG-03         audio/video 청크 보관·고아 정리 스윕
[6] STG-05         세션/사용자 삭제 시 S3 객체·로컬 파일 삭제
[7] MB-ERR-001     Celery 태스크 등록 예외 로깅
[8] TQ-08          OTP 발급·검증 + 로그아웃 HTTP 테스트
"""

import importlib.util
import io
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from tests.test_audio_record import _create_session, _register, _upload_chunk


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


# ── [2] CEL-CHAIN-01 ────────────────────────────────────────────────────


def test_cel_chain_01_리포트태스크_재시도_설정():
    from app.tasks.report_task import generate_reports_for_session

    assert Exception in generate_reports_for_session.autoretry_for
    assert generate_reports_for_session.retry_kwargs.get("max_retries") == 3
    assert generate_reports_for_session.retry_backoff is True


def test_cel_chain_01_실패시_리포트_기록_마킹(client):
    from app.models.record import Report, SessionRecord
    from app.models.session import Session as SessionModel
    from app.tasks.report_task import _mark_pipeline_failure

    host = _register(client, "chain01@test.com")
    sid = uuid.UUID(_create_session(client, host, started=True))

    db = _db()
    try:
        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid).first()
        if record is None:
            record = SessionRecord(session_id=sid, status="processing", markers=[], edit_history=[], ai_summary={})
            db.add(record)
        else:
            record.status = "processing"
        report = Report(
            session_id=sid, type="counselor", status="pending_analysis", content={},
            generation_status="processing",
        )
        db.add(report)
        db.commit()

        _mark_pipeline_failure(str(sid), db, RuntimeError("boom"))

        db.refresh(report)
        db.refresh(record)
        assert report.status == "error"
        assert report.generation_error
        assert record.status == "failed"
    finally:
        db.close()


# ── [3] CEL-CHAIN-02 ────────────────────────────────────────────────────


def _make_outbox(sid, *, status, available_at, needs_report=True):
    from app.models.pipeline_outbox import PipelineOutbox

    db = _db()
    try:
        outbox = PipelineOutbox(
            session_id=sid, has_recording=True, needs_video_merge=False,
            needs_report=needs_report, status=status, available_at=available_at,
        )
        db.add(outbox)
        db.commit()
    finally:
        db.close()


def test_cel_chain_02_published_미완료_재드라이브(client, monkeypatch):
    host = _register(client, "chain02@test.com")
    sid = uuid.UUID(_create_session(client, host, started=True))
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    _make_outbox(sid, status="published", available_at=past)

    calls: list = []
    monkeypatch.setattr(
        "app.services.audio_service.publish_pipeline",
        lambda *a, **k: calls.append(a) or True,
    )
    from app.tasks.pipeline_outbox_task import process_pipeline_outbox

    result = process_pipeline_outbox()
    assert result["redriven"] == 1, result
    assert len(calls) == 1


def test_cel_chain_02_체인완료면_재드라이브안함(client, monkeypatch):
    from app.models.record import Report

    host = _register(client, "chain02b@test.com")
    sid = uuid.UUID(_create_session(client, host, started=True))
    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    _make_outbox(sid, status="published", available_at=past)

    db = _db()
    try:
        db.add(Report(session_id=sid, type="counselor", status="pending_review", content={}))
        db.commit()
    finally:
        db.close()

    calls: list = []
    monkeypatch.setattr(
        "app.services.audio_service.publish_pipeline",
        lambda *a, **k: calls.append(a) or True,
    )
    from app.tasks.pipeline_outbox_task import process_pipeline_outbox

    result = process_pipeline_outbox()
    assert result["redriven"] == 0
    assert calls == []


def test_cel_chain_02_published_미래시각은_재드라이브안함(client, monkeypatch):
    host = _register(client, "chain02c@test.com")
    sid = uuid.UUID(_create_session(client, host, started=True))
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    _make_outbox(sid, status="published", available_at=future)

    calls: list = []
    monkeypatch.setattr(
        "app.services.audio_service.publish_pipeline",
        lambda *a, **k: calls.append(a) or True,
    )
    from app.tasks.pipeline_outbox_task import process_pipeline_outbox

    assert process_pipeline_outbox()["redriven"] == 0
    assert calls == []


# ── [4] STG-01 ──────────────────────────────────────────────────────────


def test_stg01_오디오_청크_크기상한_초과_413(client, monkeypatch):
    from app.services import upload_service

    host = _register(client, "stg01a@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    monkeypatch.setattr(upload_service, "MAX_AUDIO_CHUNK_BYTES", 32)

    res = client.post(
        f"/api/v1/sessions/{sid}/audio/chunk",
        data={"chunk_index": "0"},
        files={"file": ("c0.webm", io.BytesIO(b"x" * 100), "audio/webm")},
        headers=host["auth"],
    )
    assert res.status_code == 413, res.text


def test_stg01_오디오_빈청크_422(client):
    host = _register(client, "stg01b@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])

    res = client.post(
        f"/api/v1/sessions/{sid}/audio/chunk",
        data={"chunk_index": "0"},
        files={"file": ("empty.webm", io.BytesIO(b""), "audio/webm")},
        headers=host["auth"],
    )
    assert res.status_code == 422, res.text


def test_stg01_비디오_청크_크기상한_초과_413(client, monkeypatch):
    from app.services import upload_service

    host = _register(client, "stg01c@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/video/start", json={"consent_video": True}, headers=host["auth"])
    monkeypatch.setattr(upload_service, "MAX_VIDEO_CHUNK_BYTES", 32)

    res = client.post(
        f"/api/v1/sessions/{sid}/video/chunk",
        data={"chunk_index": "0"},
        files={"file": ("c0.webm", io.BytesIO(b"x" * 100), "video/webm")},
        headers=host["auth"],
    )
    assert res.status_code == 413, res.text


# ── [5] STG-03 ──────────────────────────────────────────────────────────


def test_stg03_보관기간_경과_청크_행과_파일_삭제(client):
    from app.models.record import AudioChunk, VideoChunk
    from app.services import media_cleanup_service

    host = _register(client, "stg03@test.com")
    sid = uuid.UUID(_create_session(client, host))
    now = datetime(2026, 1, 1, 12, 0, 0)  # naive UTC

    audio_file = os.path.join(os.environ["AUDIO_CHUNK_DIR"], f"old-{uuid.uuid4().hex}.bin")
    video_file = os.path.join(os.environ["VIDEO_CHUNK_DIR"], f"old-{uuid.uuid4().hex}.webm")
    for path in (audio_file, video_file):
        with open(path, "wb") as fh:
            fh.write(b"x")

    db = _db()
    try:
        db.add_all([
            AudioChunk(session_id=sid, chunk_index=0, file_path=audio_file, size_bytes=1,
                       created_at=now - timedelta(days=100)),
            VideoChunk(session_id=sid, chunk_index=0, file_path=video_file, size_bytes=1,
                       created_at=now - timedelta(days=100)),
            AudioChunk(session_id=sid, chunk_index=1, file_path="/tmp/keep.bin", size_bytes=1,
                       created_at=now - timedelta(days=1)),
        ])
        db.commit()

        result = media_cleanup_service.sweep_stale_media(db, now=now)
        assert result == {"audio_deleted": 1, "video_deleted": 1}, result
        remaining = {c.chunk_index for c in db.query(AudioChunk).filter(AudioChunk.session_id == sid).all()}
        assert remaining == {1}
    finally:
        db.close()

    assert not os.path.exists(audio_file)
    assert not os.path.exists(video_file)


def test_stg03_스윕_태스크_인라인(client):
    from app.tasks import media_cleanup_task

    db = _db()
    try:
        result = media_cleanup_task.run_sweep_stale_media(db)
        assert set(result) == {"audio_deleted", "video_deleted"}
    finally:
        db.close()


# ── [6] STG-05 ──────────────────────────────────────────────────────────


def test_stg05_세션삭제시_로컬파일과_S3객체_삭제(client, monkeypatch):
    from app.models.record import SessionRecord
    from app.services import session_service, storage_service

    host = _register(client, "stg05a@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)

    sid_uuid = uuid.UUID(sid)
    db = _db()
    try:
        from app.models.record import AudioChunk

        chunk = db.query(AudioChunk).filter(AudioChunk.session_id == sid_uuid).first()
        assert chunk is not None
        local_path = chunk.file_path
        assert os.path.exists(local_path)

        record = db.query(SessionRecord).filter(SessionRecord.session_id == sid_uuid).first()
        record.video_s3_key = f"video/{sid}/merged.webm"
        db.commit()
    finally:
        db.close()

    deleted_s3: list = []
    monkeypatch.setattr(storage_service, "delete_object", lambda key: deleted_s3.append(key) or True)

    db = _db()
    try:
        session_service.delete_session(sid, host["id"], db)
    finally:
        db.close()

    assert not os.path.exists(local_path), "세션 삭제 시 로컬 청크 파일이 삭제돼야 함"
    assert f"video/{sid}/merged.webm" in deleted_s3, "세션 삭제 시 S3 병합본 객체가 삭제돼야 함"


def test_stg05_사용자삭제시_미디어_삭제(client, monkeypatch):
    from app.models.record import AudioChunk
    from app.models.session import Session as SessionModel
    from app.models.user import User
    from app.core.security import hash_password
    from app.services import admin_service, storage_service

    db = _db()
    try:
        user = User(email="stg05user@test.com", password_hash=hash_password("Passw0rd!"),
                    name="삭제대상", role="counselor", status="active")
        db.add(user)
        db.flush()
        session = SessionModel(host_id=user.id, type="meditation", status="completed", duration_min=30)
        db.add(session)
        db.flush()
        local_file = os.path.join(os.environ["AUDIO_CHUNK_DIR"], f"userdel-{uuid.uuid4().hex}.bin")
        with open(local_file, "wb") as fh:
            fh.write(b"x")
        db.add(AudioChunk(session_id=session.id, chunk_index=0, file_path=local_file, size_bytes=1))
        db.commit()
        uid = user.id
    finally:
        db.close()

    deleted_s3: list = []
    monkeypatch.setattr(storage_service, "delete_object", lambda key: deleted_s3.append(key) or True)

    db = _db()
    try:
        admin_service.delete_user(uid, uuid.uuid4(), db)
    finally:
        db.close()

    assert not os.path.exists(local_file), "사용자 삭제 시 로컬 미디어가 삭제돼야 함"


# ── [7] MB-ERR-001 ──────────────────────────────────────────────────────


def _load_probe_module(path: str, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_mb_err_001_태스크등록실패_로그_남김(monkeypatch, caplog):
    from app.core.celery_app import celery_app

    def _boom(*args, **kwargs):
        raise RuntimeError("registration boom")

    monkeypatch.setattr(celery_app, "task", _boom)
    tasks_dir = os.path.join(os.path.dirname(__file__), "..", "app", "tasks")
    probes = ["eeg_raw_task.py", "media_cleanup_task.py", "report_task.py"]

    with caplog.at_level(logging.ERROR):
        for filename in probes:
            path = os.path.abspath(os.path.join(tasks_dir, filename))
            _load_probe_module(path, f"mb_err_probe_{filename}")

    messages = [r.getMessage() for r in caplog.records]
    failures = [m for m in messages if "Celery 태스크 등록 실패" in m]
    assert len(failures) >= len(probes), messages


# ── [8] TQ-08 — OTP 발급·검증 + 로그아웃 ────────────────────────────────


def _register_client(client, email: str):
    from app.services import email_verify_service
    from tests.conftest import post_register

    payload = {
        "email": email,
        "password": "Passw0rd!",
        "name": "OTP테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, "client", payload)
    assert res.status_code == 201, res.text


def test_tq08_otp_발급_검증_성공(client):
    with patch("app.api.v1.auth.send_otp_email") as send:
        res = client.post("/api/v1/auth/email/request-otp", json={"email": "otp-happy@test.com"})
    assert res.status_code == 204, res.text
    code = send.call_args.args[1]
    assert len(code) == 6 and code.isdigit()

    verified = client.post(
        "/api/v1/auth/email/verify-otp",
        json={"email": "otp-happy@test.com", "code": code},
    )
    assert verified.status_code == 200, verified.text
    assert verified.json()["email_verify_token"]


def test_tq08_otp_불일치_400(client):
    with patch("app.api.v1.auth.send_otp_email") as send:
        client.post("/api/v1/auth/email/request-otp", json={"email": "otp-wrong@test.com"})
    code = send.call_args.args[1]
    wrong = "000000" if code != "000000" else "111111"

    res = client.post(
        "/api/v1/auth/email/verify-otp",
        json={"email": "otp-wrong@test.com", "code": wrong},
    )
    assert res.status_code == 400, res.text


def test_tq08_otp_쿨다운_429(client):
    with patch("app.api.v1.auth.send_otp_email"):
        first = client.post("/api/v1/auth/email/request-otp", json={"email": "otp-cool@test.com"})
        second = client.post("/api/v1/auth/email/request-otp", json={"email": "otp-cool@test.com"})
    assert first.status_code == 204
    assert second.status_code == 429, second.text


def test_tq08_로그아웃시_리프레시토큰_폐기(client):
    _register_client(client, "logout-user@test.com")
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "logout-user@test.com", "password": "Passw0rd!"},
    )
    assert login.status_code == 200, login.text
    refresh = login.cookies.get("mb_refresh_token")
    assert refresh

    out = client.post("/api/v1/auth/logout", json={"refresh_token": refresh})
    assert out.status_code == 204, out.text

    # 폐기된 리프레시 토큰으로 갱신 시도 → 401
    again = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
    assert again.status_code == 401, again.text
