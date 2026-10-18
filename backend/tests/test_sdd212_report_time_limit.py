"""SDD-212 T3 — 리포트 생성 태스크 시간 상한·재시도 멱등 (verify T-01~T-03)

시간 상한 초과(SoftTimeLimitExceeded)는 중간 재시도에서 이미 만든 회원 리포트를 되돌리지 않고,
재시도 소진 시에만 실패 마킹한다.
"""
from uuid import UUID

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from app.models.record import Report, SessionRecord
from app.services import report_progress_service as rps
from app.tasks import report_task
from app.tasks.report_task import REPORT_TASK_MAX_RETRIES, generate_reports_for_session
from tests.test_audio_record import _create_session, _register
from tests.test_sdd086_auto_report import _add_participant, _db


def test_T01_시간_상한이_정체_스윕_기준_안쪽으로_적용된다():
    assert generate_reports_for_session.soft_time_limit == 25 * 60
    assert generate_reports_for_session.time_limit == 28 * 60
    assert generate_reports_for_session.time_limit < rps.REPORT_GENERATION_TIMEOUT_SECONDS


def _setup(client, email: str, guests: int):
    host = _register(client, email)
    sid = _create_session(client, host)
    db = _db()
    for i in range(guests):
        _add_participant(db, sid, guest_name=f"게스트{i}")
    # 전사가 있는 정상 세션 — 생성 상태가 ready 로 끝나야 "완료분 건너뛰기" 경로가 적용된다
    # (전사 없음/partial 리포트는 STT 복구 반영을 위해 의도적으로 재생성된다).
    db.add(SessionRecord(
        session_id=UUID(sid), status="completed", transcript="안녕하세요. 오늘 이야기를 시작할게요.",
        markers=[], edit_history=[], ai_summary={"headline": "요약"},
    ))
    db.commit()
    return sid, db


def _client_reports(db, sid: str) -> list[Report]:
    db.expire_all()
    return db.query(Report).filter(Report.session_id == UUID(sid), Report.type == "client").all()


def _timeout_on_nth_client(monkeypatch, nth_client: int):
    """nth_client 번째 회원 리포트 생성에서 시간 초과를 일으키고, 그 외에는 실제 생성 로직을 실행한다."""
    real = report_task.generate_report_inline
    state = {"clients_generated": 0, "client_calls": []}

    def fake(report_id, db):
        report = db.query(Report).filter(Report.id == UUID(str(report_id))).first()
        if report is not None and report.type == "client":
            state["clients_generated"] += 1
            state["client_calls"].append(str(report.id))
            if state["clients_generated"] == nth_client:
                raise SoftTimeLimitExceeded()
        return real(report_id, db)

    monkeypatch.setattr("app.tasks.report_task.generate_report_inline", fake)
    return state


def test_T02_시간_초과_후_재시도가_이미_만든_회원_리포트를_되돌리지_않는다(client, monkeypatch):
    sid, db = _setup(client, "t212t02@test.com", guests=3)
    state = _timeout_on_nth_client(monkeypatch, nth_client=2)

    with pytest.raises(SoftTimeLimitExceeded):
        generate_reports_for_session.run(sid)

    done = [r for r in _client_reports(db, sid) if r.status == "pending_review"]
    assert len(done) == 1, "시간 초과 전에 끝낸 회원 리포트는 승인 대기 상태로 보존돼야 함"
    finished_id = str(done[0].id)

    state["client_calls"].clear()
    generate_reports_for_session.run(sid)  # 재시도: 더 이상 시간 초과 없음 (nth_client 는 이미 지남)

    assert finished_id not in state["client_calls"], "완료분은 재생성하지 않고 건너뛰어야 함"
    assert len(state["client_calls"]) == 2
    assert all(r.status == "pending_review" for r in _client_reports(db, sid))
    assert len(_client_reports(db, sid)) == 3, "중복 생성 없음"


def test_T03_재시도_소진_시에는_기존대로_error_마킹한다(client, monkeypatch):
    sid, db = _setup(client, "t212t03@test.com", guests=2)
    _timeout_on_nth_client(monkeypatch, nth_client=2)
    generate_reports_for_session.push_request(retries=REPORT_TASK_MAX_RETRIES)
    try:
        with pytest.raises(SoftTimeLimitExceeded):
            generate_reports_for_session.run(sid)
    finally:
        generate_reports_for_session.pop_request()

    reports = _client_reports(db, sid)
    assert any(r.status == "error" and r.generation_error for r in reports)
    record = db.query(SessionRecord).filter(SessionRecord.session_id == UUID(sid)).first()
    assert record.status == "completed", "완료된 세션 기록은 마킹 대상이 아니다(기존 설계 유지)"


def test_T03_시간_초과가_아닌_예외는_즉시_마킹하는_기존_동작을_유지한다(client, monkeypatch):
    sid, db = _setup(client, "t212t03b@test.com", guests=1)

    def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.services.report_service.generate_client_reports_for_session", boom)
    with pytest.raises(RuntimeError):
        generate_reports_for_session.run(sid)

    counselor = db.query(Report).filter(Report.session_id == UUID(sid), Report.type == "counselor").first()
    db.refresh(counselor)
    assert counselor.status == "error"


def test_T04_참가자_30명도_시간_초과_재시도로_중복_없이_완료된다(client, monkeypatch):
    sid, db = _setup(client, "t212t04@test.com", guests=30)
    state = _timeout_on_nth_client(monkeypatch, nth_client=10)

    with pytest.raises(SoftTimeLimitExceeded):
        generate_reports_for_session.run(sid)
    assert len([r for r in _client_reports(db, sid) if r.status == "pending_review"]) == 9

    state["client_calls"].clear()
    generate_reports_for_session.run(sid)

    reports = _client_reports(db, sid)
    assert len(reports) == 30
    assert all(r.status == "pending_review" for r in reports)
    assert len(state["client_calls"]) == 21, "남은 21건만 이어서 생성(완료 9건 재생성 없음)"
