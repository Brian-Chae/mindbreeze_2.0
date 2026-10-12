"""MIND BREEZE 2.0 기능상 오류(하) 7차 13건 회귀 테스트.

검증 대상:
  [1]  CEL-OUTBOX-03  WS outbox 폴러 원자 선점(FOR UPDATE SKIP LOCKED)
  [2]  CEL-RETRY-02   stt/summary 태스크 soft_time_limit/time_limit 설정
  [3]  STG-10         presigned PUT 기본/상한 축소
  [4]  STG-11         stream_id 허용 문자 검증(S3 key 삽입 전)
  [5]  STG-13         리포트 content 내부 S3 key 미노출
  [6]  STG-14         S3 클라이언트 설정 지문 캐시(자격증명 회전 반영)
  [7]  MB-ERR-004     채팅방 초대/내보내기 알림 실패 로깅
  [8]  MB-ERR-005     리포트 승인 알림 실패 로깅
  [9]  MB-ERR-007     export 큐 게시 실패 로깅
  [10] MB-ERR-010     증빙 로컬 파일 삭제 실패 로깅
  [11] MB-ERR-011     stale open 세션 취소 개별 실패 로깅
  [12] MB-ERR-014     get_db 예외 시 명시적 rollback
"""

import asyncio
import json
import logging
import os
import sys
import tempfile
import types
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.core.database import get_db
from app.main import app


def _db():
    return next(app.dependency_overrides[get_db]())


# ---------------------------------------------------------------------------
# [1] CEL-OUTBOX-03 — WS outbox 원자 선점
# ---------------------------------------------------------------------------


def test_cel_outbox_03_ws_poller_uses_skip_locked(monkeypatch):
    from app.core import database
    from app.services import outbox_worker

    events: list = []

    class _Query:
        def filter(self, *a, **k):
            return self

        def with_for_update(self, **k):
            events.append(("for_update", k))
            return self

        def order_by(self, *a, **k):
            return self

        def limit(self, *a, **k):
            return self

        def all(self):
            return []

    class _Dialect:
        name = "postgresql"

    class _Bind:
        dialect = _Dialect()

    class _Session:
        def query(self, *a, **k):
            return _Query()

        def get_bind(self):
            return _Bind()

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr(database, "SessionLocal", lambda: _Session())

    delivered = asyncio.run(outbox_worker.poll_and_deliver_ws())

    assert delivered == 0
    assert ("for_update", {"skip_locked": True}) in events, (
        "다중 웹 프로세스 중복 전달 방지를 위해 FOR UPDATE SKIP LOCKED 로 선점해야 한다"
    )


# ---------------------------------------------------------------------------
# [2] CEL-RETRY-02 — stt/summary 시간 상한
# ---------------------------------------------------------------------------


def test_cel_retry_02_stt_and_summary_have_time_limits():
    from app.tasks import stt_task as stt_mod
    from app.tasks import summary_task as sum_mod

    stt = stt_mod.stt_task
    assert stt.soft_time_limit == stt_mod.STT_SOFT_TIME_LIMIT
    assert stt.time_limit == stt_mod.STT_TIME_LIMIT
    assert 0 < stt.soft_time_limit < stt.time_limit

    summary = sum_mod.summary_task
    assert summary.soft_time_limit == sum_mod.SUMMARY_SOFT_TIME_LIMIT
    assert summary.time_limit == sum_mod.SUMMARY_TIME_LIMIT
    assert 0 < summary.soft_time_limit < summary.time_limit


# ---------------------------------------------------------------------------
# [3] STG-10 — presigned PUT 기본/상한
# ---------------------------------------------------------------------------


def test_stg10_presigned_put_default_and_cap(monkeypatch):
    from app.config import settings
    from app.services import storage_service

    monkeypatch.setattr(settings, "aws_access_key_id", "AKIAREALSTG10")
    monkeypatch.setattr(settings, "aws_secret_access_key", "real-secret-stg10")
    monkeypatch.setattr(settings, "s3_endpoint_url", "")

    captured: dict = {}
    fake = types.ModuleType("boto3")

    class _Client:
        def generate_presigned_url(self, _op, Params, ExpiresIn):  # noqa: N803
            captured["expires"] = ExpiresIn
            return "https://s3.example/x?sig=1"

    fake.client = lambda *a, **k: _Client()
    monkeypatch.setitem(sys.modules, "boto3", fake)

    storage_service.generate_presigned_put("eeg-raw/a/b/0.bin")
    assert captured["expires"] == storage_service.PRESIGNED_PUT_DEFAULT_EXPIRES_IN
    assert captured["expires"] <= storage_service.PRESIGNED_PUT_MAX_EXPIRES_IN
    assert captured["expires"] < 3600, "기본 유효기간을 축소해야 한다"

    # 호출측이 거대한 값을 넘겨도 상한을 넘지 못한다.
    storage_service.generate_presigned_put("eeg-raw/a/b/0.bin", expires_in=10**9)
    assert captured["expires"] == storage_service.PRESIGNED_PUT_MAX_EXPIRES_IN


# ---------------------------------------------------------------------------
# [4] STG-11 — stream_id 검증
# ---------------------------------------------------------------------------


def test_stg11_stream_id_rejects_key_escaping_chars():
    from fastapi import HTTPException

    from app.services.eeg_raw_service import _build_object_key

    for bad in ("../evil", "a/b", "s0 s1", "세그먼트", ""):
        with pytest.raises(HTTPException) as exc:
            _build_object_key("eeg-raw/x/y", bad, 0)
        assert exc.value.status_code == 422

    key = _build_object_key("eeg-raw/x/y", "s0-1_2", 3)
    assert key == "eeg-raw/x/y/s0-1_2/00000003.bin"


# ---------------------------------------------------------------------------
# [5] STG-13 — 리포트 content 내부 S3 key 미노출
# ---------------------------------------------------------------------------


def test_stg13_report_content_hides_internal_s3_key():
    from app.tasks import report_task

    record = SimpleNamespace(
        video_s3_key="video/abc-123/merged.webm",
        video_status="completed",
        markers=None,
        counselor_notes=None,
        ai_summary={},
        transcript="전사문",
        status="completed",
    )
    session = SimpleNamespace(title="세션", type="clinical", scheduled_at=None)

    block = report_task._counselor_content(session, record, {"status": "not_measured"})

    assert "s3_key" not in block["video"]
    assert block["video"]["available"] is True
    assert block["video"]["status"] == "completed"
    assert "video/abc-123/merged.webm" not in json.dumps(block, ensure_ascii=False, default=str)


# ---------------------------------------------------------------------------
# [6] STG-14 — S3 클라이언트 자격증명 회전 반영
# ---------------------------------------------------------------------------


def test_stg14_s3_client_rebuilds_on_credential_rotation(monkeypatch):
    import boto3

    from app.config import settings
    from app.services import storage_service

    built: list = []

    class _Client:
        pass

    def _fake_client(service, **kwargs):
        built.append(kwargs["aws_access_key_id"])
        return _Client()

    monkeypatch.setattr(boto3, "client", _fake_client)
    monkeypatch.setattr(settings, "s3_endpoint_url", "")
    monkeypatch.setattr(storage_service, "_s3_client_state", None)

    monkeypatch.setattr(settings, "aws_access_key_id", "key-A")
    monkeypatch.setattr(settings, "aws_secret_access_key", "secret-A")
    c1 = storage_service._s3_client()

    # 같은 설정으로 재호출 → 캐시 재사용(재생성 없음)
    assert storage_service._s3_client() is c1
    assert built == ["key-A"]

    # 자격증명 회전 → 지문 변화 → 새 클라이언트 생성
    monkeypatch.setattr(settings, "aws_access_key_id", "key-B")
    monkeypatch.setattr(settings, "aws_secret_access_key", "secret-B")
    c2 = storage_service._s3_client()

    assert built == ["key-A", "key-B"]
    assert c1 is not c2


# ---------------------------------------------------------------------------
# [7] MB-ERR-004 — 채팅방 내보내기 알림 실패 로깅
# ---------------------------------------------------------------------------


def test_mb_err_004_remove_notification_failure_logged(monkeypatch, caplog):
    from app.services import chat_service, notification_service

    room = SimpleNamespace(id=uuid.uuid4(), name="그룹방")
    monkeypatch.setattr(
        chat_service, "_ensure_group_host", lambda rid, uid, db: (room, uuid.uuid4())
    )

    class _Query:
        def filter(self, *a, **k):
            return self

        def first(self):
            return SimpleNamespace(user_id=uuid.uuid4())

    class _DB:
        def query(self, *a, **k):
            return _Query()

        def delete(self, obj):
            pass

        def commit(self):
            pass

    def _boom(*a, **k):
        raise RuntimeError("notify down")

    monkeypatch.setattr(notification_service, "notify_event", _boom)

    with caplog.at_level(logging.ERROR):
        chat_service.remove_room_participant(
            str(room.id), str(uuid.uuid4()), str(uuid.uuid4()), _DB()
        )

    assert any("내보내기 알림 발화 실패" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# [8] MB-ERR-005 — 리포트 승인 알림 실패 로깅
# ---------------------------------------------------------------------------


def test_mb_err_005_approve_notification_failure_logged(monkeypatch, caplog):
    from app.models.record import Report
    from app.services import notification_service, report_service

    report_id = uuid.uuid4()
    host_id = uuid.uuid4()
    session_id = uuid.uuid4()
    report = SimpleNamespace(
        id=report_id,
        session_id=session_id,
        status="pending_review",
        user_id=uuid.uuid4(),
        content={},
        sent_at=None,
        participant_id=None,
        type="counselor",
    )
    session = SimpleNamespace(id=session_id, host_id=host_id, title="세션")

    class _Query:
        def __init__(self, target):
            self._target = target

        def filter(self, *a, **k):
            return self

        def first(self):
            return self._target

    class _DB:
        def query(self, model):
            return _Query(report if model is Report else session)

        def commit(self):
            pass

        def refresh(self, obj):
            pass

    monkeypatch.setattr(report_service, "_serialize", lambda *a, **k: {})
    monkeypatch.setattr(report_service, "_subjective_for_report", lambda r, d: None)

    def _boom(*a, **k):
        raise RuntimeError("notify down")

    monkeypatch.setattr(notification_service, "notify_event", _boom)

    with caplog.at_level(logging.ERROR):
        report_service.approve_report(str(report_id), str(host_id), _DB())

    assert any("승인 알림 발화 실패" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# [9] MB-ERR-007 — export 큐 게시 실패 로깅
# ---------------------------------------------------------------------------


def test_mb_err_007_export_enqueue_failure_logged(client, monkeypatch, caplog):
    from app.models.session import Session as SessionModel
    from app.models.session import SessionParticipant
    from app.models.user import User
    from app.schemas.data_export import DataExportCreate
    from app.services import export_service
    from app.tasks import export_task

    db = _db()
    try:
        user = User(
            email="mberr007@test.com", password_hash="x", name="상담사",
            role="counselor", status="active",
        )
        db.add(user)
        db.flush()
        session = SessionModel(
            host_id=user.id, type="clinical", duration_min=30, status="completed"
        )
        db.add(session)
        db.flush()
        participant = SessionParticipant(session_id=session.id, user_id=None, guest_name="게스트")
        db.add(participant)
        db.commit()
        uid, sid, pid = user.id, session.id, participant.id
    finally:
        db.close()

    monkeypatch.setattr(
        export_service,
        "authorize",
        lambda *a, **k: (
            SimpleNamespace(role="counselor"),
            None,
            SimpleNamespace(consent_eeg=False),
        ),
    )

    class _Boom:
        def apply_async(self, *a, **k):
            raise RuntimeError("broker down")

    monkeypatch.setattr(export_task, "generate_data_export", _Boom())

    db = _db()
    try:
        with caplog.at_level(logging.ERROR):
            job = export_service.create_export(
                db, uid, sid, pid, DataExportCreate(purpose="테스트 목적"), None
            )
        assert job.status == "failed"
        assert job.error_code == "queue_unavailable"
    finally:
        db.close()

    assert any("큐 게시 실패" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# [10] MB-ERR-010 — 증빙 로컬 파일 삭제 실패 로깅
# ---------------------------------------------------------------------------


def test_mb_err_010_credential_delete_file_failure_logged(monkeypatch, caplog):
    from app.services import credential_service

    fd, path = tempfile.mkstemp(prefix="mb-cred-")
    os.close(fd)
    cred = SimpleNamespace(id=uuid.uuid4(), s3_key=path, status="pending")

    class _Query:
        def filter(self, *a, **k):
            return self

        def first(self):
            return cred

    class _DB:
        def query(self, *a, **k):
            return _Query()

        def delete(self, obj):
            pass

        def commit(self):
            pass

    def _boom(p):
        raise OSError("permission denied")

    monkeypatch.setattr(credential_service.os, "remove", _boom)

    with caplog.at_level(logging.WARNING):
        credential_service.delete_credential(cred.id, uuid.uuid4(), _DB())

    assert any("증빙 로컬 파일 삭제 실패" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# [11] MB-ERR-011 — stale open 세션 취소 개별 실패 로깅
# ---------------------------------------------------------------------------


def test_mb_err_011_sweep_individual_failure_logged(client, monkeypatch, caplog):
    from app.models.session import Session as SessionModel
    from app.models.user import User
    from app.services import session_service

    db = _db()
    try:
        host = User(
            email="mberr011@test.com", password_hash="x", name="상담사",
            role="counselor", status="active",
        )
        db.add(host)
        db.flush()
        stale = SessionModel(
            host_id=host.id, type="meditation", duration_min=40,
            status="open", is_template=False,
            opened_at=datetime.now(timezone.utc) - timedelta(hours=25),
        )
        db.add(stale)
        db.commit()
        sid = stale.id
    finally:
        db.close()

    def _boom(*a, **k):
        raise RuntimeError("host missing")

    monkeypatch.setattr(session_service, "transition_status", _boom)

    db = _db()
    try:
        with caplog.at_level(logging.WARNING):
            cancelled = session_service.sweep_stale_open_sessions(db)
    finally:
        db.close()

    assert str(sid) not in cancelled
    assert any("세션 취소 실패" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# [12] MB-ERR-014 — get_db 예외 시 rollback
# ---------------------------------------------------------------------------


def test_mb_err_014_get_db_rolls_back_on_exception(monkeypatch):
    from app.core import database

    calls: dict = {}

    class _FakeDB:
        def rollback(self):
            calls["rollback"] = True

        def close(self):
            calls["close"] = True

    monkeypatch.setattr(database, "SessionLocal", lambda: _FakeDB())

    gen = database.get_db()
    next(gen)
    with pytest.raises(RuntimeError):
        gen.throw(RuntimeError("boom"))

    assert calls.get("rollback") is True, "예외 경로에서 명시적 rollback 이 필요하다"
    assert calls.get("close") is True
