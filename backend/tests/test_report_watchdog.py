"""SDD-095 후속 — 리포트 생성 타임아웃 워치독(sweep_stale_reports)

Celery 파이프라인이 워커에서 중단되면 generation_status 가 'processing'에 영구히 남는다.
beat 스윕이 generation_started_at(리포트) / recording_ended_at(세션 기록) 경과를 기준으로
먹통을 터미널 상태로 마감하는지 검증한다.
"""
from datetime import datetime, timedelta, timezone

from app.services import report_progress_service as rps
from tests.test_sdd095_report_progress import (
    _create_session,
    _db,
    _mk_record,
    _mk_report,
    _register,
)


def _old() -> datetime:
    """30분 초과(스윕 대상) 시각."""
    return datetime.now(timezone.utc) - timedelta(seconds=rps.REPORT_GENERATION_TIMEOUT_SECONDS + 60)


def _recent() -> datetime:
    """30분 이내(스윕 보존) 시각."""
    return datetime.now(timezone.utc) - timedelta(minutes=5)


def test_01_processing_리포트_타임아웃_마감(client):
    host = _register(client, "wd01c@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rep = _mk_report(db, sid, generation_status="processing")
        rep.generation_started_at = _old()
        db.commit()

        affected = rps.sweep_stale_reports(db)
        assert sid in affected
        db.refresh(rep)
        assert rep.generation_status == rps.GENERATION_PARTIAL
        assert rep.generation_error == rps.REASON_TIMEOUT
    finally:
        db.close()


def test_02_최근_processing_리포트는_보존(client):
    host = _register(client, "wd02c@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rep = _mk_report(db, sid, generation_status="processing")
        rep.generation_started_at = _recent()
        db.commit()

        assert rps.sweep_stale_reports(db) == []
        db.refresh(rep)
        assert rep.generation_status == "processing"
        assert rep.generation_error is None
    finally:
        db.close()


def test_03_processing_세션기록_타임아웃_마감(client):
    host = _register(client, "wd03c@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rec = _mk_record(db, sid, status="processing")
        rec.recording_ended_at = _old()
        db.commit()

        affected = rps.sweep_stale_reports(db)
        assert sid in affected
        db.refresh(rec)
        assert rec.status == "failed"
    finally:
        db.close()


def test_04_시작시각_미설정_processing은_보존(client):
    host = _register(client, "wd04c@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rep = _mk_report(db, sid, generation_status="processing")
        # generation_started_at 미설정(파이프라인 진입 전) → 보수적으로 스윕 대상 아님
        db.commit()

        assert rps.sweep_stale_reports(db) == []
        db.refresh(rep)
        assert rep.generation_status == "processing"
    finally:
        db.close()


def test_05_derive_reason_타임아웃_노출(client):
    host = _register(client, "wd05c@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        rep = _mk_report(db, sid, generation_status="partial")
        rep.generation_error = rps.REASON_TIMEOUT
        db.commit()

        result = rps.compute_report_progress(sid, db)
        assert result["generation_status"] == "partial"
        assert result["reason"] == rps.REASON_TIMEOUT
    finally:
        db.close()
