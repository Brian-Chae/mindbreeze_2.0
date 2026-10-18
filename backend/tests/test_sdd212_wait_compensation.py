"""SDD-212 T4 — 대기 시간 보정 (verify W-01~W-06)

줄에서 오래 기다린 정상 건이 (1) 정체 스윕에 의해 실패 처리되거나 (2) 아웃박스 재드라이브로
사슬이 중복 발행되지 않아야 한다. 진짜 정체(유예까지 지난 건)는 여전히 마감·재발행된다.
"""
import uuid
from datetime import datetime, timedelta, timezone

import fakeredis
import pytest

from app.config import settings
from app.models.pipeline_outbox import PipelineOutbox
from app.services import report_progress_service as rps
from app.tasks.pipeline_outbox_task import MAX_ATTEMPTS, process_pipeline_outbox
from tests.test_audio_record import _create_session, _register
from tests.test_sdd095_report_progress import _db, _mk_record, _mk_report

TIMEOUT = rps.REPORT_GENERATION_TIMEOUT_SECONDS
GRACE = settings.pipeline_queue_grace_seconds
REDRIVE_DELAY = settings.pipeline_redrive_delay_seconds


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _ago(seconds: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=seconds)


def test_설정_기본값은_plan_TD4와_같다():
    assert GRACE == 60 * 60
    assert REDRIVE_DELAY == 90 * 60


# ── 정체 스윕: 기록 processing 마감 기준 ────────────────────────────────


def test_W01_녹음_종료_후_40분_대기_중인_기록은_실패_처리하지_않는다(client):
    host = _register(client, "t212w01@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rec = _mk_record(db, sid, status="processing")
        rec.recording_ended_at = _ago(40 * 60)
        report = _mk_report(db, sid, generation_status="pending")
        db.commit()

        assert rps.sweep_stale_reports(db) == []
        db.refresh(rec)
        db.refresh(report)
        assert rec.status == "processing"
        assert report.status == "pending_analysis"
        assert report.generation_status == "pending"
    finally:
        db.close()


def test_W02_대기_유예까지_지난_기록은_기존대로_실패_마감하고_리포트도_error(client):
    host = _register(client, "t212w02@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rec = _mk_record(db, sid, status="processing")
        rec.recording_ended_at = _ago(TIMEOUT + GRACE + 60)
        report = _mk_report(db, sid, generation_status="pending")
        db.commit()

        assert sid in rps.sweep_stale_reports(db)
        db.refresh(rec)
        db.refresh(report)
        assert rec.status == "failed"
        assert report.status == "error"
        assert report.generation_error == rps.REASON_TIMEOUT
    finally:
        db.close()


def test_W02_유예_경계_직전_기록은_아직_보존한다(client):
    host = _register(client, "t212w02b@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rec = _mk_record(db, sid, status="processing")
        rec.recording_ended_at = _ago(TIMEOUT + GRACE - 60)
        db.commit()

        assert rps.sweep_stale_reports(db) == []
        db.refresh(rec)
        assert rec.status == "processing"
    finally:
        db.close()


def test_W05_리포트_단계는_generation_started_at_기준_30분_마감이_불변이다(client):
    host = _register(client, "t212w05@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        report = _mk_report(db, sid, generation_status="processing")
        report.generation_started_at = _ago(TIMEOUT + 60)
        db.commit()

        assert sid in rps.sweep_stale_reports(db)
        db.refresh(report)
        assert report.generation_status == rps.GENERATION_PARTIAL
        assert report.status == "error"
    finally:
        db.close()


def test_W06_유예를_넘긴_기록이어도_이미_승인된_리포트는_보존한다(client):
    host = _register(client, "t212w06@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rec = _mk_record(db, sid, status="processing")
        rec.recording_ended_at = _ago(TIMEOUT + GRACE + 60)
        done = _mk_report(db, sid, generation_status="ready", status="completed")
        db.commit()

        rps.sweep_stale_reports(db)
        db.refresh(done)
        assert done.status == "completed"
        assert done.generation_status == "ready"
    finally:
        db.close()


# ── 아웃박스 재드라이브 ────────────────────────────────────────────────


@pytest.fixture()
def published(monkeypatch):
    calls: list = []
    monkeypatch.setattr(
        "app.services.audio_service.publish_pipeline", lambda *a, **k: calls.append(a) or True
    )
    return calls


@pytest.fixture()
def fake_redis(monkeypatch):
    server = fakeredis.FakeServer()
    redis_client = fakeredis.FakeStrictRedis(server=server)
    monkeypatch.setattr("app.services.pipeline_backlog_service.get_redis_client", lambda: redis_client)
    return redis_client


@pytest.fixture(params=[(True, "report"), (True, "stt"), (False, "celery")], ids=["분리-report", "분리-stt", "단일-celery"])
def busy_queue(request, monkeypatch, fake_redis):
    """줄 분리 on/off 두 구성에서 '파이프라인 줄에 작업이 쌓여 있는' 상태를 만든다."""
    split, queue = request.param
    monkeypatch.setattr(settings, "pipeline_queue_split_enabled", split)
    fake_redis.rpush(queue, b"pending-task")
    return queue


def _outbox(sid, *, available_at, attempts=0, status="published"):
    db = _db()
    try:
        db.add(PipelineOutbox(
            session_id=sid, has_recording=True, needs_video_merge=False, needs_report=True,
            status=status, attempts=attempts, available_at=available_at,
        ))
        db.commit()
    finally:
        db.close()


def _get(sid) -> PipelineOutbox:
    db = _db()
    try:
        return db.query(PipelineOutbox).filter(PipelineOutbox.session_id == sid).one()
    finally:
        db.close()


def _session(client, email):
    host = _register(client, email)
    return uuid.UUID(_create_session(client, host, started=True))


def test_W03_발행_40분_경과_건은_재발행_지연_전이라_재발행하지_않는다(client, published, fake_redis):
    sid = _session(client, "t212w03a@test.com")
    # 발행 시각 = 40분 전 → 재드라이브 판정 시각 = 발행 + 재드라이브 지연(미래)
    _outbox(sid, available_at=_ago(40 * 60) + timedelta(seconds=REDRIVE_DELAY))

    assert process_pipeline_outbox()["redriven"] == 0
    assert published == []


def test_W03_재발행_시각이_지났어도_줄이_밀려_있으면_이번_회차_재발행을_보류한다(client, published, busy_queue):
    sid = _session(client, "t212w03b@test.com")
    due = _ago(10 * 60)
    _outbox(sid, available_at=due, attempts=1)

    result = process_pipeline_outbox()

    assert result["redriven"] == 0
    assert published == []
    outbox = _get(sid)
    assert outbox.attempts == 1, "보류는 시도 횟수를 소모하지 않는다"
    assert outbox.status == "published"


def test_W03_보류에도_상한이_있어_한_지연_더_지나면_줄이_밀려도_재발행한다(client, published, busy_queue):
    sid = _session(client, "t212w03c@test.com")
    _outbox(sid, available_at=_ago(REDRIVE_DELAY + 60))

    assert process_pipeline_outbox()["redriven"] == 1
    assert len(published) == 1


def test_W03_보류_직전_경계는_상한_안쪽이라_계속_보류한다(client, published, busy_queue):
    sid = _session(client, "t212w03d@test.com")
    _outbox(sid, available_at=_ago(REDRIVE_DELAY - 60))

    assert process_pipeline_outbox()["redriven"] == 0
    assert published == []


def test_W04_줄이_비어_있고_체인이_미완료면_기존대로_재발행한다(client, published, fake_redis):
    sid = _session(client, "t212w04a@test.com")
    _outbox(sid, available_at=_ago(60), attempts=0)

    assert process_pipeline_outbox()["redriven"] == 1
    outbox = _get(sid)
    assert outbox.attempts == 1
    delta = (_aware(outbox.available_at) - datetime.now(timezone.utc)).total_seconds()
    assert REDRIVE_DELAY - 120 < delta <= REDRIVE_DELAY, "다음 판정 시각은 재드라이브 지연만큼 뒤"


def test_W04_재발행_시도_한도는_유지된다(client, published, fake_redis):
    sid = _session(client, "t212w04b@test.com")
    _outbox(sid, available_at=_ago(60), attempts=MAX_ATTEMPTS - 1)

    process_pipeline_outbox()

    assert _get(sid).status == "failed"


def test_W04_리포트_행이_이미_있으면_재발행하지_않는다(client, published, fake_redis):
    sid = _session(client, "t212w04c@test.com")
    db = _db()
    try:
        _mk_report(db, str(sid), generation_status="pending")
        db.commit()
    finally:
        db.close()
    _outbox(sid, available_at=_ago(60))

    assert process_pipeline_outbox()["redriven"] == 0


def test_브로커_조회가_실패해도_재드라이브는_계속된다(client, published, monkeypatch):
    def broken():
        raise ConnectionError("redis down")

    monkeypatch.setattr("app.services.pipeline_backlog_service.get_redis_client", broken)
    sid = _session(client, "t212w04d@test.com")
    _outbox(sid, available_at=_ago(60))

    assert process_pipeline_outbox()["redriven"] == 1


def test_종료_직후_아웃박스_재드라이브_지연은_설정값이다(client, monkeypatch):
    from tests.test_audio_record import _mock_ai_pipeline, _upload_chunk

    _mock_ai_pipeline(monkeypatch)
    host = _register(client, "t212w04e@test.com")
    sid = _create_session(client, host)
    client.post(f"/api/v1/sessions/{sid}/audio/start", json={"consent_audio": True}, headers=host["auth"])
    _upload_chunk(client, sid, host)
    assert client.post(f"/api/v1/sessions/{sid}/end", headers=host["auth"]).status_code == 200

    outbox = _get(uuid.UUID(sid))
    delta = (_aware(outbox.available_at) - datetime.now(timezone.utc)).total_seconds()
    assert REDRIVE_DELAY - 120 < delta <= REDRIVE_DELAY
