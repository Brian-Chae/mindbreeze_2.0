"""7차 기능오류(에러/로깅) 수정 QA — MB-ERR-002/003/006/008/009/012/013

검증 대상:
  [1] MB-ERR-002  video finalize 예외 무음 삼킴 → 로그
  [2] MB-ERR-003  세션 best-effort 이벤트 발행 헬퍼 무음 삼킴 → 로그(+rollback)
  [3] MB-ERR-006  프로필 커밋 후 WS broadcast 무가드 await → 실패 격리/로그
  [4] MB-ERR-008  Google OAuth 모든 예외 401 → 서버측 장애 502/503 구분
  [5] MB-ERR-009  청크 업로드 상한 초과 → 로그(상한은 STG-01 유지)
  [6] MB-ERR-012  영상 병합 개별 청크 로드 실패 b'' 대체 → 로그/실패 마킹
  [7] MB-ERR-013  전역 예외 핸들러(422/500) 미등록 → 등록 + 구조화 봉투
"""

import asyncio
import io
import json
import logging
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from starlette.requests import Request

from app.models.record import SessionRecord, VideoChunk
from app.services import session_service, upload_service, video_service
from tests.test_video_record import _create_session, _register


def _make_request(method: str = "GET", path: str = "/x") -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [],
            "scheme": "http",
            "server": ("testserver", 80),
        }
    )


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


# ── [1] MB-ERR-002 — video finalize 실패 로깅 ─────────────────────────────


def test_mb_err_002_video_finalize_실패_로그(client, monkeypatch, caplog):
    host = _register(client, "err02@test.com")
    sid = _create_session(client, host)

    def _boom(*args, **kwargs):
        raise RuntimeError("finalize boom")

    monkeypatch.setattr(video_service, "finalize_on_session_end", _boom)

    with caplog.at_level(logging.ERROR):
        res = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    # best-effort — 영상 finalize 실패가 세션 종료 응답을 500 으로 만들지 않는다.
    assert res.status_code == 200, res.text
    assert any("video finalize failed" in r.getMessage() for r in caplog.records)


# ── [2] MB-ERR-003 — best-effort 이벤트 발행 헬퍼 로깅 ────────────────────


def test_mb_err_003_notify_participants_event_실패_로그(monkeypatch, caplog):
    from types import SimpleNamespace

    from app.services import notification_service

    db = MagicMock()
    monkeypatch.setattr(
        notification_service, "notify_event", MagicMock(side_effect=RuntimeError("db down"))
    )
    s = SimpleNamespace(id=uuid.uuid4(), host_id=uuid.uuid4(), participants=[], title="t")

    with caplog.at_level(logging.WARNING):
        session_service._notify_participants_event(
            s, "session_completed", db,
            recipient_ids=[uuid.uuid4()], title="t", body="b",
        )  # type: ignore[arg-type]

    assert any("session_completed" in r.getMessage() for r in caplog.records)
    # DB 를 만진 뒤 실패했으므로 실패 트랜잭션을 정리해야 한다.
    db.rollback.assert_called()


def test_mb_err_003_notify_session_state_실패_로그(monkeypatch, caplog):
    from types import SimpleNamespace

    from app.ws import session_live_namespace as live

    def _boom(*args, **kwargs):
        raise RuntimeError("ws down")

    monkeypatch.setattr(live, "notify_session_state_changed", _boom)
    s = SimpleNamespace(id=uuid.uuid4(), status="completed", state_version=1)

    with caplog.at_level(logging.WARNING):
        session_service._notify_session_state(s)  # type: ignore[arg-type]

    assert any("session_state_changed" in r.getMessage() for r in caplog.records)


# ── [3] MB-ERR-006 — 프로필 브로드캐스트 실패 격리 ────────────────────────


def test_mb_err_006_프로필_브로드캐스트_실패_격리(client, monkeypatch, caplog):
    host = _register(client, "err06@test.com")
    from app.ws import chat_namespace

    def _boom(*args, **kwargs):
        raise RuntimeError("ws down")

    monkeypatch.setattr(chat_namespace, "broadcast_profile_updated", _boom)

    with caplog.at_level(logging.WARNING):
        res = client.patch(
            "/api/v1/auth/counselors/me/profile",
            json={"name": "새상담사명"},
            headers=host["auth"],
        )

    # 이미 커밋된 프로필 저장이 WS 실패로 500 이 되면 안 된다.
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "새상담사명"
    assert any("broadcast_profile_updated failed" in r.getMessage() for r in caplog.records)


def test_mb_err_006_chat_namespace_내부_실패_격리(monkeypatch, caplog):
    from app.ws import chat_namespace

    monkeypatch.setattr(chat_namespace, "_user_chat_room_ids", lambda uid: ["room-1"])
    monkeypatch.setattr(
        chat_namespace, "sio", MagicMock(emit=AsyncMock(side_effect=RuntimeError("emit down")))
    )

    with caplog.at_level(logging.WARNING):
        # 예외를 밖으로 던지지 않아야 한다(엔드포인트 500 방지).
        asyncio.run(chat_namespace.broadcast_profile_updated("u1", "이름"))

    assert any("profile_updated broadcast failed" in r.getMessage() for r in caplog.records)


# ── [4] MB-ERR-008 — Google OAuth 서버측 장애 구분 ────────────────────────


def test_mb_err_008_google_타임아웃_503(client):
    import httpx

    with patch("httpx.AsyncClient.get", AsyncMock(side_effect=httpx.TimeoutException("t"))):
        res = client.post("/api/v1/auth/google", json={"access_token": "x"})
    assert res.status_code == 503, res.text


def test_mb_err_008_google_통신오류_502(client):
    import httpx

    with patch("httpx.AsyncClient.get", AsyncMock(side_effect=httpx.ConnectError("boom"))):
        res = client.post("/api/v1/auth/google", json={"access_token": "x"})
    assert res.status_code == 502, res.text


def test_mb_err_008_google_인증실패는_401_유지(client):
    """위조/비정상 응답(4xx)은 인증 실패로 그대로 401 을 반환한다."""
    mock_resp = MagicMock()
    mock_resp.status_code = 401
    with patch("httpx.AsyncClient.get", AsyncMock(return_value=mock_resp)):
        res = client.post("/api/v1/auth/google", json={"access_token": "forged"})
    assert res.status_code == 401, res.text


# ── [5] MB-ERR-009 — 청크 상한 초과 거부 로그 ─────────────────────────────


def test_mb_err_009_청크_상한초과_로그(client, monkeypatch, caplog):
    host = _register(client, "err09@test.com")
    sid = _create_session(client, host)
    client.post(
        f"/api/v1/sessions/{sid}/audio/start",
        json={"consent_audio": True},
        headers=host["auth"],
    )
    monkeypatch.setattr(upload_service, "MAX_AUDIO_CHUNK_BYTES", 32)

    with caplog.at_level(logging.WARNING):
        res = client.post(
            f"/api/v1/sessions/{sid}/audio/chunk",
            data={"chunk_index": "0"},
            files={"file": ("c0.webm", io.BytesIO(b"x" * 100), "audio/webm")},
            headers=host["auth"],
        )

    assert res.status_code == 413, res.text
    assert any("[upload]" in r.getMessage() for r in caplog.records)


# ── [6] MB-ERR-012 — 청크 로드 실패 로그/마킹 ─────────────────────────────


def test_mb_err_012_청크_로드실패_로그(client, caplog):
    host = _register(client, "err12@test.com")
    sid = _create_session(client, host, started=False)

    db = _db()
    try:
        db.add(SessionRecord(session_id=uuid.UUID(sid)))
        db.commit()
        # 존재하지 않는 로컬 경로 청크 2개 → 병합 시 개별 로드 실패
        for i in (0, 1):
            db.add(
                VideoChunk(
                    session_id=uuid.UUID(sid),
                    chunk_index=i,
                    file_path=f"/nonexistent/chunk_{i}.webm",
                    size_bytes=10,
                )
            )
        db.commit()

        with caplog.at_level(logging.WARNING):
            key = video_service.merge_video_chunks(uuid.UUID(sid), db)

        assert key is None  # 모든 청크 로드 실패 → 병합 보류
        assert any("청크 로드 실패" in r.getMessage() for r in caplog.records)
        # MB-ERR-012: b'' 대체로 성공 위장하지 않고 실패를 상태에 마킹한다.
        rec = db.query(SessionRecord).filter(SessionRecord.session_id == uuid.UUID(sid)).first()
        assert rec is not None
        assert rec.video_status == "merge_failed"
    finally:
        db.close()


# ── [7] MB-ERR-013 — 전역 예외 핸들러 ─────────────────────────────────────


def test_mb_err_013_전역_핸들러_등록():
    from fastapi.exceptions import RequestValidationError

    from app.main import app

    assert RequestValidationError in app.exception_handlers
    assert Exception in app.exception_handlers


def test_mb_err_013_검증오류_422_봉투(caplog):
    from fastapi.exceptions import RequestValidationError

    from app.main import _validation_exception_handler

    exc = RequestValidationError(
        errors=[{"loc": ("body", "name"), "msg": "field required", "type": "missing"}]
    )
    with caplog.at_level(logging.WARNING):
        resp = asyncio.run(_validation_exception_handler(_make_request("POST", "/api/v1/x"), exc))

    assert resp.status_code == 422
    body = json.loads(bytes(resp.body))
    assert body["detail"][0]["loc"] == ["body", "name"]
    assert any("[422]" in r.getMessage() for r in caplog.records)


def test_mb_err_013_미처리예외_500_봉투(caplog):
    from app.main import _unhandled_exception_handler

    with caplog.at_level(logging.ERROR):
        resp = asyncio.run(
            _unhandled_exception_handler(_make_request("GET", "/api/v1/boom"), RuntimeError("x"))
        )

    assert resp.status_code == 500
    assert json.loads(bytes(resp.body))["detail"] == "서버 내부 오류가 발생했습니다"
    assert any("[500]" in r.getMessage() for r in caplog.records)
