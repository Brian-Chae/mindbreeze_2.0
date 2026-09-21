"""SDD-029: 게스트 메일 요청과 승인·발송·열람 경계 검증."""
from uuid import UUID, uuid4
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


def test_delivery_failure_logs_report_context(client, setup_email, monkeypatch, caplog):
    from app.services import report_email_service as service
    db, session, participant = setup_email
    client.post(f"/api/v1/sessions/{session.id}/report-email", json=request_body(participant))
    report = db.query(Report).one()
    report.status = "completed"
    db.commit()
    monkeypatch.setattr(service, "send_report_email", Mock(return_value=False))

    with caplog.at_level("WARNING", logger=service.__name__):
        assert service.deliver_report_email(str(report.id), db) == "failed"

    assert str(report.id) in caplog.text
    assert str(session.id) in caplog.text
    assert str(participant.id) in caplog.text


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


def test_approval_does_not_enqueue_email(client, setup_email, monkeypatch):
    from app.services import report_email_service, report_service
    db, session, participant = setup_email
    client.post(f"/api/v1/sessions/{session.id}/report-email", json=request_body(participant))
    report = db.query(Report).one()
    enqueue = Mock()
    monkeypatch.setattr(report_email_service, "enqueue_report_email", enqueue)
    report_service.approve_report(str(report.id), str(session.host_id), db)
    enqueue.assert_not_called()
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
    # SDD-088: 회원/게스트 입장은 오픈(open) 이후 허용
    session.status = "open"
    session.access_code = "912345"
    session.max_participants = 10
    db.commit()
    response = client.post("/api/v1/sessions/by-code/912345/join", json={"name": "새 게스트"})
    assert response.status_code == 200, response.text
    assert response.json()["participant_token"]
    assert "participant_token" not in response.json()["session"]["participants"][0]


def test_branded_email_preserves_link_and_text(monkeypatch):
    from html import escape
    from app.tasks import email
    sender = Mock(return_value=True)
    monkeypatch.setattr(email, "_send_email", sender)
    link = 'https://example.com/report?token=a&value="quoted"'
    assert email.send_report_email("guest@example.com", link)
    _, _, text, html = sender.call_args.args
    assert link in text and "7일" in text
    assert f'href="{escape(link, quote=True)}"' in html
    assert "<table" in html and "리포트 보기" in html
    assert "<style" not in html and "<script" not in html


def test_branded_view_preserves_private_content_and_missing_values(client, setup_email):
    from app.services import report_email_service as service
    db, session, participant = setup_email
    participant.report_email = "guest@example.com"
    unsafe = '<script>alert("private")</script>'
    report = Report(session_id=session.id, participant_id=participant.id,
                    type="client", status="completed", content={
                        "title": unsafe, "summary": unsafe, "insights": [unsafe],
                        "private_notes": "상담사 전용 비밀",
                        "eeg": {"metrics": {"focus_index_stability_score": 0,
                                             "stress_score": None,
                                             "relaxation_score": unsafe}},
                    })
    db.add(report)
    db.commit()
    token = service._token("report_view", str(report.id), str(session.id), email=participant.report_email)
    response = client.get(f"/api/v1/sessions/{session.id}/report-email/view", params={"token": token})
    assert response.status_code == 200
    html = response.text
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "상담사 전용 비밀" not in html
    assert '<details' in html and '<details open' not in html
    assert "측정값: 0" in html
    assert "측정 정보 없음" in html
    for label in ["집중 안정도", "신경 활동도", "인지 부하 안정도", "스트레스", "좌우 균형", "정서 안정도", "두뇌휴식도"]:
        assert label in html
    assert "style-src 'unsafe-inline'" in response.headers["content-security-policy"]
    assert "default-src 'none'" in response.headers["content-security-policy"]
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cache-control"] == "no-store"


def test_auto_approval_does_not_send_email(client, setup_email, monkeypatch):
    from app.models.user import User
    from app.services import report_email_service, report_service
    db, session, participant = setup_email
    participant.report_email = "guest@example.com"
    db.add(User(id=session.host_id, email="auto-approve@example.com",
                password_hash="unused", name="상담사", role="counselor",
                auto_approve_report=True))
    db.commit()
    enqueue = Mock()
    sender = Mock()
    monkeypatch.setattr(report_email_service, "enqueue_report_email", enqueue)
    monkeypatch.setattr(report_email_service, "send_report_email", sender)

    def generated(report_id, database):
        report = database.get(Report, UUID(report_id))
        report.status = "pending_review"
        return report

    monkeypatch.setattr(report_service, "generate_report_inline", generated)
    result = report_service.generate_report(str(session.id), str(session.host_id), "client", db)
    assert result["status"] == "completed"
    enqueue.assert_not_called()
    sender.assert_not_called()
    assert participant.report_email_sent_at is None
