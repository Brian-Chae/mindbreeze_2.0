"""SDD-095 — 리포트 생성 진행 표시(Report.generation_status + report:progress)

검증 대상
  1. 상태 전이 파생: pending → processing → ready / partial
  2. '/sessions/{id}/report-status' 엔드포인트(권한·계약)
  3. Celery 파이프라인(STT→요약→리포트) 실주행 후 최종 상태
  4. Socket.IO `report:progress` 이벤트 계약(이벤트명/네임스페이스/룸/직렬화)
"""

import asyncio
import io
from datetime import datetime, timezone
from uuid import uuid4

from app.services import report_progress_service as rps


VALID_PASSWORD = "Passw0rd!"


# ── 헬퍼 ────────────────────────────────────────────────────────────────
def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org, post_register

    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {"id": body["user"]["id"], "auth": {"Authorization": f"Bearer {token}"}}


def _create_session(client, host: dict, *, start: bool = True) -> str:
    res = client.post(
        "/api/v1/sessions",
        json={"type": "clinical", "duration_min": 50, "title": "진행표시테스트"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    if start:
        r = client.post(f"/api/v1/sessions/{sid}/start", headers=host["auth"])
        assert r.status_code == 200, r.text
    return sid


def _db():
    """테스트 인메모리 DB 세션(fixture 와 동일 엔진)."""
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _mk_record(db, sid: str, **fields):
    from app.models.record import SessionRecord

    record = SessionRecord(
        session_id=sid,
        status=fields.pop("status", "processing"),
        markers=[],
        edit_history=[],
        ai_summary=fields.pop("ai_summary", {}),
        **fields,
    )
    db.add(record)
    db.flush()
    return record


def _mk_report(db, sid: str, *, generation_status: str, status: str = "pending_analysis", rtype: str = "counselor"):
    from app.models.record import Report

    report = Report(
        session_id=sid,
        type=rtype,
        status=status,
        generation_status=generation_status,
        content={},
    )
    db.add(report)
    db.flush()
    return report


def _progress(db, sid):
    return rps.compute_report_progress(sid, db)


def _step(result, key: str) -> str:
    return next(s["state"] for s in result["steps"] if s["key"] == key)


def _mock_ai_pipeline(monkeypatch, confidence: str = "high") -> None:
    """STT·요약 외부 API 모킹 (테스트 환경엔 API 키가 없다)."""
    from app.tasks import stt_task, summary_task

    if confidence == "low":
        segs = [
            {"speaker": "speaker_0", "text": "[잡음]", "start": 0.0, "end": 1.0},
            {"speaker": "speaker_0", "text": "[무음]", "start": 1.0, "end": 3.0},
            {"speaker": "speaker_0", "text": "[잡음]", "start": 3.0, "end": 5.0},
        ]
    else:
        segs = [
            {"speaker": "counselor", "text": "안녕하세요, 오늘 어떤 이야기를 해볼까요?", "start": 0.0, "end": 3.0},
            {"speaker": "client", "text": "요즘 스트레스가 많아서 힘들어요.", "start": 3.5, "end": 6.5},
        ]

    monkeypatch.setattr(
        stt_task,
        "_call_gemini_transcribe",
        lambda chunk_paths, session_type: {
            "segments": segs,
            "raw_text": "\n".join(f"[{s['speaker']}] {s['text']}" for s in segs),
        },
    )
    monkeypatch.setattr(
        summary_task,
        "_call_gemini_summary",
        lambda session_type, transcript: {
            "headline": "테스트 AI 요약",
            "sections": {"요약": "요약 내용"},
            "keywords": ["키워드1"],
            "risk_flags": [],
            "transcript_present": True,
        },
    )


def _upload_chunk(client, sid: str, host: dict) -> None:
    res = client.post(
        f"/api/v1/sessions/{sid}/audio/chunk",
        data={"chunk_index": "0"},
        files={"file": ("c0.webm", io.BytesIO(b"fake-audio" * 50), "audio/webm")},
        headers=host["auth"],
    )
    assert res.status_code == 200, res.text


# ── 1. 상태 전이 파생 ───────────────────────────────────────────────────
def test_01_세션_미시작_pending(client):
    host = _register(client, "rp01@test.com")
    sid = _create_session(client, host, start=False)

    db = _db()
    try:
        result = _progress(db, sid)
    finally:
        db.close()

    assert result["generation_status"] == "pending"
    assert result["progress"] == 0
    assert [s["state"] for s in result["steps"]] == ["pending"] * 4
    assert result["reason"] is None


def test_02_녹음중_processing_save_active(client):
    host = _register(client, "rp02@test.com")
    sid = _create_session(client, host)

    db = _db()
    try:
        _mk_record(db, sid, status="recording", recording_started_at=datetime.now(timezone.utc))
        db.commit()
        result = _progress(db, sid)
    finally:
        db.close()

    assert result["generation_status"] == "processing"
    assert _step(result, rps.STEP_SAVE) == rps.STEP_ACTIVE
    assert result["stage"] == rps.STEP_SAVE


def test_03_전사_저장후_요약_진행중(client):
    host = _register(client, "rp03@test.com")
    sid = _create_session(client, host)

    db = _db()
    try:
        _mk_record(
            db,
            sid,
            status="processing",
            transcript="[counselor] 안녕하세요",
            ai_summary={"segments": [{"speaker": "counselor", "text": "안녕하세요"}], "transcript_confidence": "high"},
        )
        db.commit()
        result = _progress(db, sid)
    finally:
        db.close()

    assert result["generation_status"] == "processing"
    assert _step(result, rps.STEP_SAVE) == rps.STEP_DONE
    assert _step(result, rps.STEP_STT) == rps.STEP_DONE
    assert _step(result, rps.STEP_SUMMARY) == rps.STEP_ACTIVE
    assert result["stage"] == rps.STEP_SUMMARY


def test_04_요약완료_리포트_생성중(client):
    host = _register(client, "rp04@test.com")
    sid = _create_session(client, host)

    db = _db()
    try:
        _mk_record(
            db,
            sid,
            status="completed",
            transcript="[counselor] 안녕하세요",
            ai_summary={"headline": "요약", "transcript_confidence": "high"},
        )
        db.commit()
        result = _progress(db, sid)
    finally:
        db.close()

    assert result["generation_status"] == "processing"
    assert _step(result, rps.STEP_SUMMARY) == rps.STEP_DONE
    assert _step(result, rps.STEP_READY) == rps.STEP_ACTIVE
    assert result["stage"] == rps.STEP_READY


def test_05_리포트_ready_시_전체완료(client):
    host = _register(client, "rp05@test.com")
    sid = _create_session(client, host)

    db = _db()
    try:
        _mk_record(
            db,
            sid,
            status="completed",
            transcript="[counselor] 안녕하세요",
            ai_summary={"headline": "요약", "transcript_confidence": "high"},
        )
        _mk_report(db, sid, generation_status="ready", status="pending_review")
        db.commit()
        result = _progress(db, sid)
    finally:
        db.close()

    assert result["generation_status"] == "ready"
    assert result["progress"] == 100
    assert [s["state"] for s in result["steps"]] == ["done"] * 4
    assert result["report_status"] == "pending_review"


def test_06_저신뢰_전사는_partial(client):
    host = _register(client, "rp06@test.com")
    sid = _create_session(client, host)

    db = _db()
    try:
        _mk_record(
            db,
            sid,
            status="completed",
            transcript="[speaker_0] [잡음]",
            ai_summary={"transcript_confidence": "low"},
        )
        _mk_report(db, sid, generation_status="partial")
        db.commit()
        result = _progress(db, sid)
    finally:
        db.close()

    assert result["generation_status"] == "partial"
    assert result["reason"] == rps.REASON_LOW_CONFIDENCE
    # 요약은 제공하지 않으므로 skipped — 더 진행할 것이 없다.
    assert _step(result, rps.STEP_SUMMARY) == rps.STEP_SKIPPED
    assert _step(result, rps.STEP_READY) == rps.STEP_DONE
    assert result["progress"] == 100


def test_07_마이크오프_manual_partial(client):
    host = _register(client, "rp07@test.com")
    sid = _create_session(client, host)

    db = _db()
    try:
        _mk_record(db, sid, status="manual")
        db.commit()
        result = _progress(db, sid)
    finally:
        db.close()

    assert result["generation_status"] == "partial"
    assert result["reason"] == rps.REASON_MIC_OFF
    assert _step(result, rps.STEP_SAVE) == rps.STEP_SKIPPED
    assert _step(result, rps.STEP_STT) == rps.STEP_SKIPPED


def test_08_STT_실패는_partial(client):
    host = _register(client, "rp08@test.com")
    sid = _create_session(client, host)

    db = _db()
    try:
        _mk_record(db, sid, status="failed")
        db.commit()
        result = _progress(db, sid)
    finally:
        db.close()

    assert result["generation_status"] == "partial"
    assert result["reason"] == rps.REASON_STT_FAILED
    assert _step(result, rps.STEP_STT) == rps.STEP_FAILED


def test_09_리포트_상태_갱신_헬퍼_검증(client):
    host = _register(client, "rp09@test.com")
    sid = _create_session(client, host)

    db = _db()
    try:
        _mk_report(db, sid, generation_status="pending")
        db.commit()
        assert rps.mark_reports_generation(sid, "processing", db) == 1
        # 멱등 — 같은 값 재적용은 갱신 0건
        assert rps.mark_reports_generation(sid, "processing", db) == 0
        assert rps.mark_reports_generation(sid, "ready", db) == 1
        try:
            rps.mark_reports_generation(sid, "unknown", db)
            raise AssertionError("알 수 없는 상태는 ValueError 여야 한다")
        except ValueError:
            pass
    finally:
        db.close()


# ── 2. 엔드포인트 ───────────────────────────────────────────────────────
def test_10_report_status_엔드포인트_pending(client):
    host = _register(client, "rp10@test.com")
    sid = _create_session(client, host, start=False)

    res = client.get(f"/api/v1/sessions/{sid}/report-status", headers=host["auth"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["generation_status"] == "pending"
    assert body["session_id"] == sid
    assert len(body["steps"]) == 4
    assert [s["key"] for s in body["steps"]] == ["save", "stt", "summary", "ready"]
    assert body["steps"][0]["label"] == "녹음 저장"


def test_11_report_status_비로그인_401(client):
    host = _register(client, "rp11@test.com")
    sid = _create_session(client, host)
    res = client.get(f"/api/v1/sessions/{sid}/report-status")
    assert res.status_code == 401


def test_12_report_status_비참여자_403(client):
    host = _register(client, "rp12a@test.com")
    other = _register(client, "rp12b@test.com")
    sid = _create_session(client, host)
    res = client.get(f"/api/v1/sessions/{sid}/report-status", headers=other["auth"])
    assert res.status_code == 403


def test_13_report_status_없는세션_404(client):
    host = _register(client, "rp13@test.com")
    res = client.get(f"/api/v1/sessions/{uuid4()}/report-status", headers=host["auth"])
    assert res.status_code == 404


# ── 3. 파이프라인 실주행 ────────────────────────────────────────────────
def test_14_세션종료_파이프라인_후_ready(client, monkeypatch):
    _mock_ai_pipeline(monkeypatch)
    host = _register(client, "rp14@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    res = client.get(f"/api/v1/sessions/{sid}/report-status", headers=host["auth"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["generation_status"] == "ready"
    assert [s["state"] for s in body["steps"]] == ["done"] * 4
    assert body["report_status"] == "pending_review"

    # 리포트 행에도 생성 상태가 영속된다(승인 상태와 독립)
    reports = client.get("/api/v1/reports", headers=host["auth"]).json()["reports"]
    mine = [x for x in reports if x["session_id"] == sid]
    assert mine and all(x["generation_status"] == "ready" for x in mine)


def test_15_저신뢰_파이프라인은_partial(client, monkeypatch):
    _mock_ai_pipeline(monkeypatch, confidence="low")
    host = _register(client, "rp15@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    body = client.get(f"/api/v1/sessions/{sid}/report-status", headers=host["auth"]).json()
    assert body["generation_status"] == "partial"
    assert body["reason"] == rps.REASON_LOW_CONFIDENCE

    reports = client.get("/api/v1/reports", headers=host["auth"]).json()["reports"]
    mine = [x for x in reports if x["session_id"] == sid]
    assert mine and all(x["generation_status"] == "partial" for x in mine)


def test_16_마이크오프_파이프라인은_partial(client):
    host = _register(client, "rp16@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": False}, headers=host["auth"])
    r = client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"])
    assert r.status_code == 200, r.text

    body = client.get(f"/api/v1/sessions/{sid}/report-status", headers=host["auth"]).json()
    assert body["generation_status"] == "partial"
    assert body["reason"] == rps.REASON_MIC_OFF


# ── 4. Socket.IO `report:progress` 계약 ─────────────────────────────────
def test_17_report_progress_이벤트_계약(monkeypatch):
    from app.ws import record_namespace

    captured: dict = {}

    class _FakeSio:
        async def emit(self, event, data, room=None, namespace=None):  # noqa: D401
            captured.update({"event": event, "data": data, "room": room, "namespace": namespace})

    monkeypatch.setattr(record_namespace, "_get_sio", lambda: _FakeSio())

    payload = {
        "session_id": "ignored",
        "generation_status": "processing",
        "stage": "summary",
        "progress": 70,
        "steps": [{"key": "save", "label": "녹음 저장", "state": "done"}],
        "updated_at": datetime.now(timezone.utc),
    }
    asyncio.run(record_namespace.broadcast_report_progress("sid-1", payload))

    assert captured["event"] == "report:progress"
    assert captured["room"] == "session:sid-1"
    assert captured["namespace"] == "/record"
    assert captured["data"]["session_id"] == "sid-1"
    assert captured["data"]["progress"] == 70
    # datetime 은 ISO 문자열로 직렬화되어야 한다(socket.io JSON 인코더)
    assert isinstance(captured["data"]["updated_at"], str)


def test_18_emit_report_progress_가_브로드캐스트를_호출한다(client, monkeypatch):
    from app.ws import record_namespace

    host = _register(client, "rp18@test.com")
    sid = _create_session(client, host, start=False)

    seen: list[dict] = []

    async def _fake_broadcast(session_id, payload):
        seen.append({"session_id": session_id, "payload": payload})

    monkeypatch.setattr(record_namespace, "broadcast_report_progress", _fake_broadcast)

    db = _db()
    try:
        payload = rps.emit_report_progress(sid, db)
    finally:
        db.close()

    assert len(seen) == 1
    assert seen[0]["session_id"] == sid
    assert seen[0]["payload"]["generation_status"] == "pending"
    assert payload["session_id"] == sid
