"""SDD-052: 이메일 토큰 기반 서사형 리포트 JSON 열람 검증."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import Mock

from jose import jwt

from app.config import settings
from app.core.database import get_db
from app.main import app
from app.models.record import Report
from app.models.session import Session, SessionParticipant
from app.services import report_email_service


def _view_report(client):
    provider = app.dependency_overrides[get_db]()
    db = next(provider)
    session = Session(
        host_id=uuid4(),
        title="마음 돌봄 세션",
        type="meditation",
        status="completed",
        duration_min=10,
    )
    db.add(session)
    db.flush()
    participant = SessionParticipant(
        session_id=session.id,
        guest_name="게스트",
        report_email="guest@example.com",
    )
    db.add(participant)
    db.flush()
    report = Report(
        session_id=session.id,
        participant_id=participant.id,
        type="client",
        status="completed",
        content={
            "summary": "오늘의 요약",
            "eeg": {
                "status": "valid",
                "metrics": {"relaxation_score": 72},
                "timeline": [{"timestamp_sec": 0, "relaxation_index": 0.72}],
                "narrative": {"journey": "차분해지는 흐름"},
            },
        },
    )
    db.add(report)
    db.commit()
    return db, provider, session, participant, report


def test_report_view_returns_serialized_narrative_content(client):
    db, provider, session, participant, report = _view_report(client)
    try:
        token = report_email_service._token(
            "report_view", str(report.id), str(session.id), email=participant.report_email
        )
        response = client.get("/api/v1/reports/view", params={"token": token})

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["id"] == str(report.id)
        assert body["session_title"] == "마음 돌봄 세션"
        assert body["report_email"] == "guest@example.com"
        assert body["content"]["eeg"]["narrative"] == {"journey": "차분해지는 흐름"}
        assert body["content"]["eeg"]["timeline"] == [
            {"timestamp_sec": 0, "relaxation_index": 0.72}
        ]
        assert body["content"]["eeg"]["metrics"]["stress_score"] is None
    finally:
        provider.close()


def test_report_view_rejects_invalid_expired_and_unauthorized_tokens(client):
    db, provider, session, participant, report = _view_report(client)
    try:
        expired = jwt.encode(
            {
                "type": "report_view",
                "sub": str(report.id),
                "session_id": str(session.id),
                "email": participant.report_email,
                "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
            },
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        wrong_email = report_email_service._token(
            "report_view", str(report.id), str(session.id), email="other@example.com"
        )

        assert client.get("/api/v1/reports/view", params={"token": "invalid"}).status_code == 401
        assert client.get("/api/v1/reports/view", params={"token": expired}).status_code == 401
        assert client.get("/api/v1/reports/view", params={"token": wrong_email}).status_code == 403

        report.status = "pending_review"
        db.commit()
        valid = report_email_service._token(
            "report_view", str(report.id), str(session.id), email=participant.report_email
        )
        assert client.get("/api/v1/reports/view", params={"token": valid}).status_code == 403
    finally:
        provider.close()


def test_report_email_links_open_frontend_report_view(client, monkeypatch):
    db, provider, session, participant, report = _view_report(client)
    sender = Mock(return_value=True)
    monkeypatch.setattr(report_email_service, "send_report_email", sender)
    try:
        assert report_email_service.deliver_report_email(str(report.id), db) == "sent"
        assert sender.call_args.args[1].startswith(
            "https://dev.mindbreeze.looxidlabs.com/report-view?token="
        )

        participant.report_email_sent_at = None
        db.commit()
        assert report_email_service.resend_report_email(
            str(report.id), "new@example.com", db
        ) is True
        assert sender.call_args.args[1].startswith(
            "https://dev.mindbreeze.looxidlabs.com/report-view?token="
        )
    finally:
        provider.close()
