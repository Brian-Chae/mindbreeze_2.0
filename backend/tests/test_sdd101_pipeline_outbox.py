"""SDD-101 Phase A4 — 종료 파이프라인 발행 Outbox QA

검증 시나리오:
- 세션 종료 시 파이프라인 발행 의도를 durable 기록(pending → published)한다.
- 발행 실패 시 pending 유지 → beat 스윕(process_pipeline_outbox)이 재발행한다.
- 스윕은 최대 재시도 초과 시 failed 로 마감한다.
"""

import uuid
from unittest.mock import patch

from app.models.pipeline_outbox import PipelineOutbox
from tests.test_audio_record import _create_session, _mock_ai_pipeline, _register, _upload_chunk


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


def _get_outbox(sid: str) -> PipelineOutbox | None:
    db = _db()
    try:
        return db.query(PipelineOutbox).filter(PipelineOutbox.session_id == uuid.UUID(sid)).first()
    finally:
        db.close()


def test_세션종료시_아웃박스_기록후_발행완료(client, monkeypatch):
    _mock_ai_pipeline(monkeypatch)
    host = _register(client, "outbox1@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)

    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    outbox = _get_outbox(sid)
    assert outbox is not None, "종료 시 발행 의도(아웃박스)가 기록되어야 함"
    assert outbox.status == "published"
    assert outbox.has_recording is True
    assert outbox.needs_report is True


def test_발행실패시_pending_유지후_스윕_재발행(client, monkeypatch):
    _mock_ai_pipeline(monkeypatch)
    host = _register(client, "outbox2@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)

    # 발행(apply_async) 실패 시뮬레이션 — 브로커 다운
    with patch("app.services.audio_service.publish_pipeline", side_effect=RuntimeError("broker down")):
        r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    outbox = _get_outbox(sid)
    assert outbox is not None
    assert outbox.status == "pending", "발행 실패 시 pending 으로 남아야 함"

    # beat 스윕이 재발행한다.
    from app.tasks.pipeline_outbox_task import process_pipeline_outbox

    result = process_pipeline_outbox()
    assert result["published"] == 1, f"스윕이 재발행해야 함: {result}"

    outbox = _get_outbox(sid)
    assert outbox.status == "published"


def test_스윕_최대재시도_초과시_failed(client, monkeypatch):
    _mock_ai_pipeline(monkeypatch)
    host = _register(client, "outbox3@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)

    with patch("app.services.audio_service.publish_pipeline", side_effect=RuntimeError("broker down")):
        client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])

    from datetime import datetime, timedelta, timezone

    from app.tasks.pipeline_outbox_task import MAX_ATTEMPTS, process_pipeline_outbox

    # 재시도 한도 직전 상태로 만들고 available_at 을 과거로 밀어 스윕이 즉시 집도록 한다(백오프 우회).
    db = _db()
    try:
        outbox = db.query(PipelineOutbox).filter(PipelineOutbox.session_id == uuid.UUID(sid)).first()
        assert outbox is not None
        outbox.attempts = MAX_ATTEMPTS - 1
        outbox.available_at = datetime.now(timezone.utc) - timedelta(seconds=10)
        db.commit()
    finally:
        db.close()

    with patch("app.services.audio_service.publish_pipeline", side_effect=RuntimeError("still down")):
        process_pipeline_outbox()

    outbox = _get_outbox(sid)
    assert outbox is not None
    assert outbox.status == "failed"
    assert outbox.attempts >= MAX_ATTEMPTS
