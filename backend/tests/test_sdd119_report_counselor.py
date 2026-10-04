"""SDD-119 상담사별 리포트 목록의 이름 계약·배치 조회 검증."""

from uuid import uuid4

from sqlalchemy import event

from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.session import Session
from app.models.user import User
from app.schemas.report import ReportResponse
from app.services.report_service import _serialize, _synthesize_missing_report, list_reports


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
