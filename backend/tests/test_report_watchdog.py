"""SDD-095 후속 — 리포트 생성 타임아웃 워치독(sweep_stale_reports)

Celery 파이프라인이 워커에서 중단되면 generation_status 가 'processing'에 영구히 남는다.
beat 스윕이 generation_started_at(리포트) / recording_ended_at(세션 기록) 경과를 기준으로
먹통을 터미널 상태로 마감하는지 검증한다.
"""
from datetime import datetime, timedelta, timezone

from app.config import settings
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
        # SDD-212 TD4: 녹음 종료 기준은 줄 대기 유예(pipeline_queue_grace_seconds)만큼 더 기다린 뒤 마감한다.
        rec.recording_ended_at = _old() - timedelta(seconds=settings.pipeline_queue_grace_seconds)
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


# ── 종료 후 회원 리포트 누락 안전망(재큐잉 대상 탐지) ───────────────────────
def _mk_ended_session(db, host_id: str, minutes_ago: int):
    from app.models.session import Session

    s = db.query(Session).filter(Session.host_id == host_id).first()
    s.status = "completed"
    s.ended_at = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    db.commit()
    return s


def _mk_participant(db, sid: str, *, included: bool = True):
    from app.models.session import SessionParticipant

    p = SessionParticipant(session_id=sid, guest_name="테스트 회원", report_included=included)
    db.add(p)
    db.flush()
    return p


def test_06_종료후_리포트행_없는_회원은_재큐잉_대상(client):
    host = _register(client, "wd06c@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        _mk_ended_session(db, host["id"], 60)
        _mk_participant(db, sid)
        db.commit()
        assert sid in rps.find_sessions_needing_report_requeue(db)
    finally:
        db.close()


def test_07_종료직후_제외참가자는_대상_아님(client):
    host = _register(client, "wd07c@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        _mk_ended_session(db, host["id"], 10)  # 유예(45분) 전
        _mk_participant(db, sid)
        db.commit()
        assert sid not in rps.find_sessions_needing_report_requeue(db)

        _mk_ended_session(db, host["id"], 60)
        p = db.query(__import__("app.models.session", fromlist=["SessionParticipant"]).SessionParticipant).filter_by(session_id=sid).first()
        p.report_included = False  # 제외 참가자 → 대상 아님
        db.commit()
        assert sid not in rps.find_sessions_needing_report_requeue(db)
    finally:
        db.close()


def test_08_pending_analysis_멈춤은_대상_생성중은_보존(client):
    host = _register(client, "wd08c@test.com")
    sid = _create_session(client, host)
    db = _db()
    try:
        _mk_ended_session(db, host["id"], 60)
        p = _mk_participant(db, sid)
        rep = _mk_report(db, sid, generation_status="processing", rtype="client")
        rep.participant_id = p.id
        rep.generation_started_at = _recent()
        db.commit()
        assert sid not in rps.find_sessions_needing_report_requeue(db)  # 정상 생성 중

        rep.generation_started_at = _old()
        db.commit()
        assert sid in rps.find_sessions_needing_report_requeue(db)  # 30분 초과 정지

        rep.status = "completed"
        rep.generation_status = "ready"
        db.commit()
        assert sid not in rps.find_sessions_needing_report_requeue(db)  # 완료
    finally:
        db.close()
