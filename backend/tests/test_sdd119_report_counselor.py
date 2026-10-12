"""SDD-119 상담사별 리포트 목록의 이름 계약·배치 조회 검증."""

from uuid import uuid4

from sqlalchemy import event

from app.core.database import get_db
from app.main import app
from app.models.pipeline_outbox import PipelineOutbox
from app.models.record import Report, SessionRecord
from app.models.session import Session
from app.models.user import User
from app.schemas.report import ReportResponse
from app.services.report_service import (
    _report_generation_in_flight,
    _serialize,
    _synthesize_missing_report,
    list_reports,
)


def test_serialized_and_synthetic_reports_include_host_name():
    host = User(id=uuid4(), name="김상담")
    session = Session(id=uuid4(), host=host, status="completed")
    report = Report(id=uuid4(), session_id=session.id, type="client", content={})

    assert ReportResponse(**_serialize(report, session)).counselor_name == "김상담"
    assert ReportResponse(**_synthesize_missing_report(session, "counselor")).counselor_name == "김상담"
    assert ReportResponse(**_serialize(report)).counselor_name is None
    session.host = None
    assert _serialize(report, session)["counselor_name"] is None


def test_client_list_batches_counselor_names(client):
    db = next(app.dependency_overrides[get_db]())
    statements = []

    def capture(connection, cursor, statement, parameters, context, executemany):
        if "FROM users" in statement:
            statements.append(statement)

    try:
        member = User(email="sdd119-member@test.com", password_hash="unused", name="회원", role="client")
        db.add(member)
        db.flush()
        member_id = str(member.id)
        for index, name in enumerate(("김상담", "이상담", "박상담")):
            host = User(email=f"sdd119-host{index}@test.com", password_hash="unused", name=name, role="counselor")
            db.add(host)
            db.flush()
            session = Session(host_id=host.id, type="clinical", title=name, duration_min=50)
            db.add(session)
            db.flush()
            db.add(Report(session_id=session.id, user_id=member.id, type="client", content={}))
        db.commit()
        db.expunge_all()
        event.listen(db.bind, "before_cursor_execute", capture)
        result = list_reports(member_id, db)
        assert {item["session_title"]: item.get("counselor_name") for item in result["reports"]} == {
            "김상담": "김상담", "이상담": "이상담", "박상담": "박상담",
        }
        # 본인 역할 조회 + 상담사 이름 배치 조회, 상담사 수에 비례한 추가 조회 없음.
        assert len(statements) == 2
    finally:
        if event.contains(db.bind, "before_cursor_execute", capture):
            event.remove(db.bind, "before_cursor_execute", capture)
        db.close()


def test_synthesize_missing_report_generating_vs_failed():
    """종료 세션의 미생성 리포트 — 생성 진행 중이면 '생성 중', 끝났으면 '생성 실패'."""
    completed = Session(id=uuid4(), status="completed")

    generating = _synthesize_missing_report(completed, "counselor", generating=True)
    assert generating["status"] is None
    assert generating["generation_status"] == "processing"
    assert generating["generation_error"] is None

    failed = _synthesize_missing_report(completed, "counselor", generating=False)
    assert failed["status"] == "error"
    assert failed["generation_error"] == "세션이 종료됐지만 리포트가 생성되지 않았습니다"

    in_progress = Session(id=uuid4(), status="in_progress")
    pending = _synthesize_missing_report(in_progress, "counselor")
    assert pending["status"] is None
    assert pending["generation_status"] == "pending"


def test_report_generation_in_flight():
    """미생성 세션의 '생성 진행 중' 판정 — 녹음/요약 진행·발행 pending 만 생성 중으로 본다."""
    processing = SessionRecord(status="processing")
    assert _report_generation_in_flight(processing, None) is True

    recording = SessionRecord(status="recording")
    assert _report_generation_in_flight(recording, None) is True

    pending_outbox = PipelineOutbox(needs_report=True, status="pending")
    assert _report_generation_in_flight(None, pending_outbox) is True

    # 발행 완료(published)는 체인 완료 후에도 남으므로 '생성 중' 신호가 아니다.
    published_outbox = PipelineOutbox(needs_report=True, status="published")
    assert _report_generation_in_flight(None, published_outbox) is False

    failed_record = SessionRecord(status="failed")
    assert _report_generation_in_flight(failed_record, None) is False

    completed_record = SessionRecord(status="completed")
    assert _report_generation_in_flight(completed_record, None) is False
