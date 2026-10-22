"""SDD-228 — STT 전용 스위치(stt_enabled) QA.

AI 전체(ai_features_enabled)는 켜 두고 STT 만 끈 상태에서:
 - STT/Whisper/요약 외부 호출 0건, 종료 체인에서 STT·요약만 빠지고 영상병합·리포트는 유지
 - 녹음 청크 보존, record completed 마감, 리포트는 전사 없이 생성(사유 stt_disabled, ready)
 - 워치독이 오탐하지 않음. on 이면 기존 동작.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.config import settings
from app.core import ai_features
from tests import agent_helpers as H
from tests.test_audio_record import _create_session, _register, _upload_chunk
from tests.test_sdd220_ai_features import _record_for, _set_record_status, transport_spy  # noqa: F401


@pytest.fixture
def stt_off(monkeypatch):
    monkeypatch.setattr(settings, "ai_features_enabled", True)
    monkeypatch.setattr(settings, "stt_enabled", False)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-gemini-key")
    monkeypatch.setattr(settings, "openai_api_key", "fake-openai-key")


@pytest.fixture
def stt_on(monkeypatch):
    monkeypatch.setattr(settings, "ai_features_enabled", True)
    monkeypatch.setattr(settings, "stt_enabled", True)
    monkeypatch.setattr(settings, "gemini_api_key", "fake-gemini-key")
    monkeypatch.setattr(settings, "openai_api_key", "fake-openai-key")


def test_기본값은_off(monkeypatch):
    assert type(settings).model_fields["stt_enabled"].default is False
    monkeypatch.setattr(settings, "ai_features_enabled", True)
    monkeypatch.setattr(settings, "stt_enabled", False)
    assert ai_features.is_stt_enabled() is False
    monkeypatch.setattr(settings, "stt_enabled", True)
    assert ai_features.is_stt_enabled() is True
    monkeypatch.setattr(settings, "ai_features_enabled", False)  # AI 전체 off 면 STT 도 off(AND)
    assert ai_features.is_stt_enabled() is False


def test_off_STT_transport_0_이고_AI_다른_기능은_유지(stt_off, transport_spy):  # noqa: F811
    from app.tasks import stt_task

    with pytest.raises(ai_features.AiFeaturesDisabled):
        stt_task._gemini_request_once("http://x", {}, {}, 1)
    with pytest.raises(ai_features.AiFeaturesDisabled):
        stt_task._call_whisper(["/nonexistent.webm"])
    assert transport_spy.call_count == 0
    ai_features.require_ai_enabled()  # 리포트 AI 초안 등 다른 AI 경로는 막히지 않는다


def test_off_종료_체인은_STT_요약만_빠진다(stt_off):
    from app.services import audio_service

    names = [t.task for t in audio_service._build_pipeline_tasks(str(uuid.uuid4()), True, True, True)]
    assert "tasks.stt" not in names and "tasks.summary" not in names
    assert len(names) == 2  # video merge + report


def test_on_종료_체인은_기존_순서(stt_on):
    from app.services import audio_service

    names = [t.task for t in audio_service._build_pipeline_tasks(str(uuid.uuid4()), True, True, True)]
    assert names.index("tasks.stt") + 1 == names.index("tasks.summary")
    assert len(names) == 4


def test_off_종료시_녹음_보존_completed_마감_STT_호출_0(client, stt_off, transport_spy, monkeypatch):  # noqa: F811
    from app.models.record import AudioChunk
    from app.services import audio_service

    published = MagicMock(return_value=True)
    monkeypatch.setattr(audio_service, "publish_pipeline", published)

    host = _register(client, "stt228-rec@test.com")
    sid = _create_session(client, host)
    assert client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"]).status_code == 200
    _upload_chunk(client, sid, host)
    assert client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"]).status_code == 200
    assert client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"]).status_code == 200

    assert _record_for(sid) == "completed"
    conn = H.db()
    try:
        assert conn.query(AudioChunk).filter(AudioChunk.session_id == uuid.UUID(sid)).count() == 1
    finally:
        conn.close()
    assert published.call_count == 1 and published.call_args.args[1] is True
    assert transport_spy.call_count == 0


def test_off_큐에_남은_STT_요약_작업은_skip_retry_0(client, stt_off, transport_spy):  # noqa: F811
    from app.tasks import stt_task, summary_task

    host = _register(client, "stt228-stale@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])
    assert _record_for(sid) == "processing"
    conn = H.db()
    try:
        stt_task.run_stt_inline(sid, conn)
        assert _record_for(sid) == "completed"
        _set_record_status(sid, "processing", None)
        summary_task.run_summary_inline(sid, conn)
        assert _record_for(sid) == "completed"
    finally:
        conn.close()
    assert transport_spy.call_count == 0


def test_off_리포트_사유는_stt_disabled_이고_마이크오프와_구분(stt_off):
    from app.models.record import SessionRecord
    from app.tasks.report_task import _ai_record_block

    rec = SessionRecord(session_id=uuid.uuid4(), status="completed", markers=[], edit_history=[], ai_summary={})
    assert _ai_record_block(rec) == {"status": "not_available", "reason": "stt_disabled"}
    rec.status = "manual"
    assert _ai_record_block(rec)["reason"] == "mic_off"


def test_on_리포트_사유는_기존_no_transcript(stt_on):
    from app.models.record import SessionRecord
    from app.tasks.report_task import _ai_record_block

    rec = SessionRecord(session_id=uuid.uuid4(), status="completed", markers=[], edit_history=[], ai_summary={})
    assert _ai_record_block(rec) == {"status": "not_available", "reason": "no_transcript"}


def test_off_진행스텝_STT_요약_건너뜀_사유_stt_disabled_ready(stt_off):
    from app.models.record import SessionRecord
    from app.services import report_progress_service as rps

    rec = SessionRecord(session_id=uuid.uuid4(), status="completed", markers=[], edit_history=[], ai_summary={})
    steps, _ = rps._build_steps(rec, [])
    states = {s["key"]: s["state"] for s in steps}
    assert states["save"] == "done" and states["stt"] == "skipped" and states["summary"] == "skipped"
    assert rps._derive_reason(rec, []) == "stt_disabled"
    content = {"ai_record": {"status": "not_available", "reason": "stt_disabled"}}
    assert rps.generation_status_for_content(content, rec) == rps.GENERATION_READY
    manual = {"ai_record": {"status": "not_available", "reason": "mic_off"}}
    assert rps.generation_status_for_content(manual, rec) == rps.GENERATION_PARTIAL


def test_on_진행스텝_기존_동작(stt_on):
    from app.models.record import SessionRecord
    from app.services import report_progress_service as rps

    rec = SessionRecord(session_id=uuid.uuid4(), status="processing", markers=[], edit_history=[], ai_summary={})
    steps, _ = rps._build_steps(rec, [])
    assert {s["key"]: s["state"] for s in steps}["stt"] == "active"
    assert rps._derive_reason(rec, []) is None


def test_off_워치독은_completed_기록을_건드리지_않는다(client, stt_off):
    from app.models.record import SessionRecord
    from app.services import report_progress_service as rps

    host = _register(client, "stt228-wd@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    client.post(f"/api/v1/sessions/{sid}/audio/stop", headers=host["auth"])
    conn = H.db()
    try:
        rec = conn.query(SessionRecord).filter(SessionRecord.session_id == uuid.UUID(sid)).first()
        rec.status = "completed"  # STT off 종료 경로가 마감하는 상태
        rec.recording_ended_at = datetime.now(timezone.utc) - timedelta(hours=3)
        conn.commit()
        assert sid not in rps.sweep_stale_reports(conn)
        conn.refresh(rec)
        assert rec.status == "completed"
    finally:
        conn.close()
