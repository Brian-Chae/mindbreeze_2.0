"""SDD-059: 리포트 생성 실패 사유와 메일 실패 컨텍스트를 보존한다."""
from unittest.mock import Mock
from uuid import uuid4

import pytest

from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.session import Session, SessionParticipant


@pytest.fixture
def report_db(client):
    provider = app.dependency_overrides[get_db]()
    db = next(provider)
    yield db
    provider.close()


def test_generate_report_failure_saves_error_message(report_db, monkeypatch, caplog):
    from app.tasks import report_task

    db = report_db
    session = Session(host_id=uuid4(), type="meditation", status="completed", duration_min=10)
    db.add(session)
    db.flush()
    report = Report(session_id=session.id, type="counselor", content={}, status="pending_analysis")
    db.add(report)
    db.commit()
    monkeypatch.setattr(report_task, "_build_eeg_content", Mock(side_effect=RuntimeError("분석 서버 연결 실패")))

    with caplog.at_level("ERROR", logger=report_task.__name__):
        result = report_task.generate_report_inline(str(report.id), db)

    assert result.status == "error"
    assert result.content["error_message"] == "분석 서버 연결 실패"
    assert str(report.id) in caplog.text
    assert str(session.id) in caplog.text


def test_resend_failure_logs_report_context(report_db, monkeypatch, caplog):
    from app.services import report_email_service as service

    db = report_db
    session = Session(host_id=uuid4(), type="meditation", status="completed", duration_min=10)
    db.add(session)
    db.flush()
    participant = SessionParticipant(session_id=session.id, guest_name="게스트")
    db.add(participant)
    db.flush()
    report = Report(
        session_id=session.id,
        participant_id=participant.id,
        type="client",
        content={},
        status="completed",
    )
    db.add(report)
    db.commit()
    monkeypatch.setattr(service, "send_report_email", Mock(return_value=False))

    with caplog.at_level("WARNING", logger=service.__name__):
        assert service.resend_report_email(str(report.id), "guest@example.com", db) is False

    assert str(report.id) in caplog.text
    assert str(session.id) in caplog.text
    assert str(participant.id) in caplog.text
