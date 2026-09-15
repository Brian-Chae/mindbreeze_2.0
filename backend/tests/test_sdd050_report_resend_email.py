"""SDD-050: 승인된 내담자 리포트의 이메일 재발송 검증."""

from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.session import SessionParticipant
from app.services import report_email_service
from tests.test_report import _create_session, _register


def _client_report(client, email: str = "before@example.com"):
    host = _register(client, "sdd050-host@example.com")
    session_id = _create_session(client, host)
    provider = app.dependency_overrides[get_db]()
    db = next(provider)
    participant = SessionParticipant(
        session_id=session_id,
        guest_name="재발송 내담자",
        report_email=email,
    )
    db.add(participant)
    db.flush()
    report = Report(
        session_id=session_id,
        participant_id=participant.id,
        type="client",
        status="completed",
        content={},
    )
    db.add(report)
    db.commit()
    return host, db, provider, report, participant


def test_report_detail_exposes_nullable_participant_email(client):
    host, db, provider, report, participant = _client_report(client)
    try:
        response = client.get(f"/api/v1/reports/{report.id}", headers=host["auth"])
        assert response.status_code == 200, response.text
        assert response.json()["report_email"] == participant.report_email

        participant.report_email = None
        db.commit()
        response = client.get(f"/api/v1/reports/{report.id}", headers=host["auth"])
        assert response.json()["report_email"] is None
    finally:
        provider.close()


def test_resend_service_uses_new_email_and_updates_default_only_on_success(client, monkeypatch):
    _, db, provider, report, participant = _client_report(client)
    sender = Mock(return_value=False)
    monkeypatch.setattr(report_email_service, "send_report_email", sender)
    try:
        assert report_email_service.resend_report_email(
            str(report.id), "new@example.com", db
        ) is False
        db.refresh(participant)
        assert participant.report_email == "before@example.com"

        sender.return_value = True
        assert report_email_service.resend_report_email(
            str(report.id), "new@example.com", db
        ) is True
        db.refresh(participant)
        assert participant.report_email == "new@example.com"
        sent_email, link = sender.call_args.args
        assert sent_email == "new@example.com"
        assert f"/api/v1/sessions/{report.session_id}/report-email/view?token=" in link
    finally:
        provider.close()


@pytest.mark.parametrize(
    ("report_type", "status"),
    [("counselor", "completed"), ("client", "pending_review")],
)
def test_resend_service_rejects_ineligible_report(client, report_type, status):
    _, db, provider, report, _ = _client_report(client)
    report.type = report_type
    report.status = status
    db.commit()
    try:
        with pytest.raises(HTTPException):
            report_email_service.resend_report_email(
                str(report.id), "new@example.com", db
            )
    finally:
        provider.close()


def test_resend_api_requires_host_and_valid_email(client, monkeypatch):
    host, db, provider, report, participant = _client_report(client)
    other = _register(client, "sdd050-other@example.com")
    monkeypatch.setattr(report_email_service, "send_report_email", Mock(return_value=True))
    try:
        denied = client.post(
            f"/api/v1/reports/{report.id}/resend-email",
            json={"email": "new@example.com"},
            headers=other["auth"],
        )
        assert denied.status_code == 403

        invalid = client.post(
            f"/api/v1/reports/{report.id}/resend-email",
            json={"email": "invalid"},
            headers=host["auth"],
        )
        assert invalid.status_code == 422

        sent = client.post(
            f"/api/v1/reports/{report.id}/resend-email",
            json={"email": "new@example.com"},
            headers=host["auth"],
        )
        assert sent.status_code == 200, sent.text
        assert sent.json() == {"success": True}
        db.refresh(participant)
        assert participant.report_email == "new@example.com"
    finally:
        provider.close()
