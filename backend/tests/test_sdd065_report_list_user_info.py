"""SDD-065 리포트 목록 참가자 정보 계약 테스트."""

from datetime import date, datetime, timedelta, timezone

from app.core.database import get_db
from app.main import app
from app.models.client_profile import ClientProfile
from app.models.record import Report
from app.models.session import SessionParticipant
from app.models.user import User
from app.services import email_verify_service
from tests.conftest import create_test_org


def _register(client, email: str, name: str, role: str) -> dict:
    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": "Passw0rd!",
        "name": name,
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    response = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert response.status_code == 201, response.text
    body = response.json()
    token = body.get("access_token") or body["tokens"]["access_token"]
    return {
        "id": body["user"]["id"],
        "auth": {"Authorization": f"Bearer {token}"},
    }


def _create_session(client, host: dict, title: str, hours: int) -> str:
    response = client.post(
        "/api/v1/sessions",
        json={
            "type": "clinical",
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(),
            "duration_min": 50,
            "title": title,
        },
        headers=host["auth"],
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_report_list_returns_guest_and_member_information_with_nulls(client):
    host = _register(client, "sdd065-host@test.com", "상담사", "counselor")
    member = _register(client, "sdd065-member@test.com", "회원 이름", "client")
    guest_session_id = _create_session(client, host, "게스트 세션", 1)
    member_session_id = _create_session(client, host, "회원 세션", 3)

    db = next(app.dependency_overrides[get_db]())
    try:
        member_user = db.query(User).filter(User.id == member["id"]).one()
        db.add(
            ClientProfile(
                user_id=member_user.id,
                gender="female",
                birth_date=date(1992, 4, 3),
                concerns=[],
                interests=[],
            )
        )

        guest = SessionParticipant(
            session_id=guest_session_id,
            guest_name="게스트 이름",
            gender=None,
            birth_date=None,
        )
        registered = SessionParticipant(
            session_id=member_session_id,
            user_id=member_user.id,
            # 회원 정보는 참가자 행보다 User/ClientProfile 값을 우선한다.
            guest_name="사용하지 않을 이름",
            gender="male",
            birth_date=date(2000, 1, 1),
        )
        db.add_all([guest, registered])
        db.flush()
        db.add_all(
            [
                Report(
                    session_id=guest_session_id,
                    participant_id=guest.id,
                    type="client",
                    status="completed",
                    content={},
                ),
                Report(
                    session_id=member_session_id,
                    user_id=member_user.id,
                    participant_id=registered.id,
                    type="client",
                    status="completed",
                    content={},
                ),
            ]
        )
        db.commit()
    finally:
        db.close()

    response = client.get("/api/v1/reports", headers=host["auth"])
    assert response.status_code == 200, response.text
    reports = {item["session_title"]: item for item in response.json()["reports"]}

    assert reports["게스트 세션"] | {
        "participant_name": "게스트 이름",
        "gender": None,
        "birth_date": None,
        "is_guest": True,
    } == reports["게스트 세션"]
    assert reports["회원 세션"]["participant_name"] == "회원 이름"
    assert reports["회원 세션"]["gender"] == "female"
    assert reports["회원 세션"]["birth_date"] == "1992-04-03"
    assert reports["회원 세션"]["is_guest"] is False
