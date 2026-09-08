"""SDD-029: 게스트 메일 요청과 승인·발송·열람 경계 검증."""
from uuid import uuid4
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.core.database import get_db
from app.main import app
from app.models.session import Session, SessionParticipant
from app.models.record import Report
from app.services.email_verify_service import generate_email_verify_token


@pytest.fixture
def setup_email(client):
    provider = app.dependency_overrides[get_db]()
    db = next(provider)
    session = Session(host_id=uuid4(), type="meditation", status="completed", duration_min=10)
    db.add(session)
    db.flush()
    participant = SessionParticipant(session_id=session.id, guest_name="게스트")
    db.add(participant)
    db.commit()
    yield db, session, participant
    provider.close()


def request_body(participant):
    from app.services.report_email_service import participant_token
    return {"participant_id": str(participant.id), "participant_token": participant_token(participant),
            "email": "guest@example.com", "email_verify_token": generate_email_verify_token("guest@example.com")}


def test_request_waits_for_approval(client, setup_email):
    db, session, participant = setup_email
    response = client.post(f"/api/v1/sessions/{session.id}/report-email", json=request_body(participant))
    assert response.status_code == 202, response.text
    assert response.json()["status"] == "pending_review"
    db.expire_all()
    assert participant.report_email == "guest@example.com"
    report = db.query(Report).one()
    assert report.participant_id == participant.id
    assert report.status == "pending_review"
    assert report.content["eeg"] == {"status": "not_measured"}


@pytest.mark.parametrize("change,status", [
    ({"email": "bad"}, 422), ({"email_verify_token": None}, 401),
    ({"email": "other@example.com"}, 403), ({"participant_token": None}, 401),
    ({"participant_id": str(uuid4())}, 403),
])
def test_request_rejects_invalid(client, setup_email, change, status):
    _, session, participant = setup_email
    body = {**request_body(participant), **change}
    assert client.post(f"/api/v1/sessions/{session.id}/report-email", json=body).status_code == status


def test_requires_completed_session(client, setup_email):
    db, session, participant = setup_email
    session.status = "in_progress"
    db.commit()
    assert client.post(f"/api/v1/sessions/{session.id}/report-email", json=request_body(participant)).status_code == 409


def test_delivery_approval_and_failure(client, setup_email, monkeypatch):
    from app.services import report_email_service as service
    db, session, participant = setup_email
    client.post(f"/api/v1/sessions/{session.id}/report-email", json=request_body(participant))
    db.expire_all()
    report = db.query(Report).one()
    sender = Mock(return_value=True)
    monkeypatch.setattr(service, "send_report_email", sender)
    assert service.deliver_report_email(str(report.id), db) == "pending_review"
    sender.assert_not_called()
    report.status = "completed"
    db.commit()
    sender.return_value = False
    assert service.deliver_report_email(str(report.id), db) == "failed"
    assert participant.report_email_sent_at is None
    sender.return_value = True
    assert service.deliver_report_email(str(report.id), db) == "sent"
    assert service.deliver_report_email(str(report.id), db) == "sent"
    assert sender.call_count == 2
    link = sender.call_args.args[1]
    token = link.split("token=")[1]
    response = client.get(f"/api/v1/sessions/{session.id}/report-email/view", params={"token": token})
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert client.get(f"/api/v1/sessions/{uuid4()}/report-email/view", params={"token": token}).status_code == 403


def test_queue_failure_is_visible(client, setup_email, monkeypatch):
    from app.services import report_email_service as service
    db, session, participant = setup_email
    body = request_body(participant)
    client.post(f"/api/v1/sessions/{session.id}/report-email", json=body)
    report = db.query(Report).one()
    report.status = "completed"
    db.commit()
    monkeypatch.setattr(service, "enqueue_report_email", Mock(side_effect=RuntimeError("queue down")))
    response = client.post(f"/api/v1/sessions/{session.id}/report-email", json=body)
    assert response.status_code == 503


def test_group_report_excludes_others(client, setup_email):
    from app.models.record import SessionRecord
    from app.models.eeg_feature import EEGFeatureWindow
    db, session, participant = setup_email
    session.participant_mode = "group"
    other = SessionParticipant(session_id=session.id, guest_name="다른 참가자")
    db.add(other)
    db.flush()
    db.add(SessionRecord(session_id=session.id, ai_summary={"summary": "다른 참가자 비밀 상담"}))
    db.add(EEGFeatureWindow(session_id=session.id, participant_id=other.id, window_index=0, relaxation_index=0.7))
    db.commit()
    assert client.post(f"/api/v1/sessions/{session.id}/report-email", json=request_body(participant)).status_code == 202
    report = db.query(Report).one()
    assert report.content["summary"] is None
    assert report.content["eeg"] == {"status": "not_measured"}
    other_body = request_body(other)
    assert client.post(f"/api/v1/sessions/{session.id}/report-email", json=other_body).status_code == 202
    assert db.query(Report).count() == 2


def test_member_cannot_be_claimed_by_guest(client, setup_email):
    db, session, participant = setup_email
    participant.user_id = uuid4()
    db.commit()
    assert client.post(f"/api/v1/sessions/{session.id}/report-email", json=request_body(participant)).status_code == 403


def test_approval_enqueues_only_after_completion(client, setup_email, monkeypatch):
    from app.services import report_email_service, report_service
    db, session, participant = setup_email
    client.post(f"/api/v1/sessions/{session.id}/report-email", json=request_body(participant))
    report = db.query(Report).one()
    enqueue = Mock()
    monkeypatch.setattr(report_email_service, "enqueue_report_email", enqueue)
    report_service.approve_report(str(report.id), str(session.host_id), db)
    enqueue.assert_called_once_with(str(report.id))
    assert report.status == "completed"


def test_expired_link_rejected(client, setup_email):
    from datetime import datetime, timedelta, timezone
    from jose import jwt
    from app.config import settings
    _, session, _ = setup_email
    token = jwt.encode({"type": "report_view", "sub": str(uuid4()), "session_id": str(session.id),
                        "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
                       settings.jwt_secret_key, algorithm=settings.jwt_algorithm)
    assert client.get(f"/api/v1/sessions/{session.id}/report-email/view", params={"token": token}).status_code == 401


def test_join_issues_private_participant_token(client, setup_email):
    db, session, participant = setup_email
    session.status = "ready"
    session.access_code = "912345"
    session.max_participants = 10
    db.commit()
    response = client.post("/api/v1/sessions/by-code/912345/join", json={"name": "새 게스트"})
    assert response.status_code == 200, response.text
    assert response.json()["participant_token"]
    assert "participant_token" not in response.json()["session"]["participants"][0]
