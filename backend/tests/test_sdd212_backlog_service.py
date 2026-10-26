"""SDD-212 T6 — 적체 지표 snapshot·경보 판정·관리자 조회 API (verify M-01~M-04, M-08)"""
import json
import re
import uuid
from datetime import datetime, timedelta, timezone

import fakeredis
import pytest

from app.config import settings
from app.models.pipeline_outbox import PipelineOutbox
from app.services import pipeline_backlog_service as backlog
from tests.test_admin import _make_admin, _register as _admin_register
from tests.test_audio_record import _create_session, _register
from tests.test_sdd095_report_progress import _db, _mk_record, _mk_report

NOW = datetime(2026, 10, 18, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture()
def redis_client(monkeypatch):
    client = fakeredis.FakeStrictRedis()
    monkeypatch.setattr("app.services.pipeline_backlog_service.get_redis_client", lambda: client)
    monkeypatch.setattr(settings, "pipeline_queue_split_enabled", True)
    return client


def _session(client, email) -> str:
    return _create_session(client, _register(client, email), started=True)


def _outbox(sid: str, *, created_ago_s: float, status="published", attempts=0, needs_report=True):
    db = _db()
    try:
        db.add(PipelineOutbox(
            session_id=uuid.UUID(sid), has_recording=True, needs_video_merge=False, needs_report=needs_report,
            status=status, attempts=attempts, available_at=NOW, created_at=NOW - timedelta(seconds=created_ago_s),
        ))
        db.commit()
    finally:
        db.close()


def test_M01_줄별_대기_건수가_정확히_반영된다(client, redis_client):
    for _ in range(3):
        redis_client.rpush("stt", b"x")
    for _ in range(2):
        redis_client.rpush("report", b"x")
    redis_client.rpush("exports", b"x")  # 파이프라인 줄이 아님
    redis_client.hset("unacked", "tag1", b"x")

    db = _db()
    try:
        snap = backlog.snapshot(db, redis_client, now=NOW)
    finally:
        db.close()

    assert snap["queues"] == {"stt": 3, "report": 2, "celery": 0}
    assert snap["unacked"] == 1
    assert snap["queue_split_enabled"] is True


def test_M02_M03_최장_대기는_리포트_미생성_발행_건의_경과시간이고_주입_시계로_결정적이다(client, redis_client):
    sid_old = _session(client, "t212m02a@test.com")
    sid_new = _session(client, "t212m02b@test.com")
    sid_done = _session(client, "t212m02c@test.com")
    sid_failed = _session(client, "t212m02d@test.com")
    _outbox(sid_old, created_ago_s=3000)
    _outbox(sid_new, created_ago_s=120)
    _outbox(sid_done, created_ago_s=9999)  # 리포트 행이 있어 대기 아님
    _outbox(sid_failed, created_ago_s=9999, status="failed")
    db = _db()
    try:
        _mk_report(db, sid_done, generation_status="ready", status="pending_review")
        db.commit()
        snap = backlog.snapshot(db, redis_client, now=NOW)
    finally:
        db.close()

    assert snap["oldest_wait_seconds"] == 3000
    assert snap["waiting_chains"] == 2


def test_M02_대기_건이_없으면_0(client, redis_client):
    db = _db()
    try:
        snap = backlog.snapshot(db, redis_client, now=NOW)
    finally:
        db.close()
    assert snap["oldest_wait_seconds"] == 0
    assert snap["waiting_chains"] == 0


def test_생성중_리포트_정체_기록_재발행_횟수를_집계한다(client, redis_client):
    sid = _session(client, "t212m05@test.com")
    sid2 = _session(client, "t212m05b@test.com")
    db = _db()
    try:
        _mk_report(db, sid, generation_status="processing")
        _mk_report(db, sid2, generation_status="pending")
        rec = _mk_record(db, sid, status="processing")
        rec.recording_ended_at = NOW - timedelta(seconds=1500)
        db.commit()
    finally:
        db.close()
    _outbox(sid, created_ago_s=100, attempts=2)

    db = _db()
    try:
        snap = backlog.snapshot(db, redis_client, now=NOW)
    finally:
        db.close()

    assert snap["generating_reports"] == 2
    assert snap["processing_records"] == 1
    assert snap["oldest_processing_record_seconds"] == 1500
    assert snap["redriven_chains"] == 1
    assert snap["max_redrive_attempts"] == 2


def test_브로커_조회_실패_시에도_DB_지표는_반환한다(client, monkeypatch):
    class Broken:
        def llen(self, *_):
            raise ConnectionError("down")

        def hlen(self, *_):
            raise ConnectionError("down")

    sid = _session(client, "t212m06@test.com")
    _outbox(sid, created_ago_s=600)
    db = _db()
    try:
        snap = backlog.snapshot(db, Broken(), now=NOW)
    finally:
        db.close()

    assert snap["queues"] is None and snap["unacked"] is None
    assert snap["broker_available"] is False
    assert snap["oldest_wait_seconds"] == 600


def test_M08_snapshot_은_DB와_Redis를_변경하지_않는다(client, redis_client):
    sid = _session(client, "t212m08@test.com")
    _outbox(sid, created_ago_s=600, attempts=1)
    redis_client.rpush("stt", b"x")
    before_keys = sorted(redis_client.keys("*"))
    before_len = redis_client.llen("stt")

    db = _db()
    try:
        backlog.snapshot(db, redis_client, now=NOW)
        assert not db.new and not db.dirty and not db.deleted
    finally:
        db.close()

    row = _get_outbox(sid)
    assert (row.status, row.attempts) == ("published", 1)
    assert sorted(redis_client.keys("*")) == before_keys
    assert redis_client.llen("stt") == before_len


def _get_outbox(sid: str) -> PipelineOutbox:
    db = _db()
    try:
        return db.query(PipelineOutbox).filter(PipelineOutbox.session_id == uuid.UUID(sid)).one()
    finally:
        db.close()


# ── 경보 판정 ─────────────────────────────────────────────────────────


def _snap(**over):
    base = {
        "queues": {"stt": 0, "report": 0, "celery": 0},
        "oldest_wait_seconds": 0,
        "consumers": None,
        "queue_split_enabled": True,
    }
    return {**base, **over}


def test_경보_임계_미만이면_경보_없음():
    assert backlog.evaluate_alerts(_snap(oldest_wait_seconds=settings.pipeline_alert_max_wait_seconds)) == []


def test_경보_최장_대기_초과():
    alerts = backlog.evaluate_alerts(_snap(oldest_wait_seconds=settings.pipeline_alert_max_wait_seconds + 1))
    assert alerts == ["oldest_wait_exceeded"]


def test_경보_줄_대기_건수_초과():
    over = settings.pipeline_alert_queue_len + 1
    alerts = backlog.evaluate_alerts(_snap(queues={"stt": over, "report": 0, "celery": 0}))
    assert alerts == ["queue_length_exceeded:stt"]


def test_경보_분리_구성에서_소비자가_없는_줄():
    alerts = backlog.evaluate_alerts(_snap(consumers={"stt": 2, "report": 0}))
    assert alerts == ["no_consumer:report"]


def test_경보_소비자_정보가_없으면_소비자_경보는_내지_않는다():
    assert backlog.evaluate_alerts(_snap(consumers=None)) == []


# ── 관리자 조회 API (M-04) ────────────────────────────────────────────


def test_M04_platform_admin_만_200_이고_건수와_시간만_담는다(client, redis_client):
    sid = _session(client, "t212m04owner@test.com")
    _outbox(sid, created_ago_s=600)
    redis_client.rpush("report", b"secret-looking-payload")
    admin = _make_admin(client)

    res = client.get("/api/v1/admin/pipeline/backlog", headers=admin["h"])

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["queues"]["report"] == 1
    assert body["waiting_chains"] == 1
    text = json.dumps(body)
    assert not re.search(r"[0-9a-f]{8}-[0-9a-f]{4}-", text), "세션·사용자 식별자 노출 금지"
    assert "secret-looking-payload" not in text and "t212m04owner" not in text


def test_M04_상담사는_403_비로그인은_401(client, redis_client):
    counselor = _admin_register(client, "t212m04c@test.com", "counselor")
    assert client.get("/api/v1/admin/pipeline/backlog", headers=counselor["h"]).status_code == 403
    assert client.get("/api/v1/admin/pipeline/backlog").status_code == 401


def test_M04_회원은_403(client, redis_client):
    member = _admin_register(client, "t212m04m@test.com", "client")
    assert client.get("/api/v1/admin/pipeline/backlog", headers=member["h"]).status_code == 403
