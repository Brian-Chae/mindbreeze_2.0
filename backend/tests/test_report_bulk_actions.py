"""리포트 일괄 승인 · 전체 읽음 API 테스트"""

import io
from datetime import datetime, timedelta, timezone
from uuid import UUID

VALID_PASSWORD = "Passw0rd!"


def _register(client, email: str, role: str = "counselor") -> dict:
    from app.services import email_verify_service
    from tests.conftest import create_test_org, post_register

    payload = {
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    }
    res = post_register(client, role, payload)
    assert res.status_code == 201, res.text
    body = res.json()
    token = body.get("access_token") or body.get("tokens", {}).get("access_token")
    return {"id": body["user"]["id"], "access_token": token, "auth": {"Authorization": f"Bearer {token}"}}


def _future(minutes: int = 60) -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _create_session(client, host: dict, minutes: int = 60) -> str:
    res = client.post(
        "/api/v1/sessions",
        json={"type": "clinical", "scheduled_at": _future(minutes), "duration_min": 50, "title": "리포트 테스트"},
        headers=host["auth"],
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]
    client.post(f"/api/v1/sessions/{sid}/start", headers=host["auth"])
    return sid


def _add_member_participant(client, sid: str, user_id: str) -> str:
    """회원 내담자를 세션 참가자로 연결 (게스트가 아닌 user_id 보유 participant)."""
    from app.core.database import get_db
    from app.main import app
    from app.models.session import SessionParticipant

    db = next(app.dependency_overrides[get_db]())
    try:
        participant = SessionParticipant(session_id=UUID(sid), user_id=UUID(user_id))
        db.add(participant)
        db.commit()
        return str(participant.id)
    finally:
        db.close()


def test_bulk_approve_all(client):
    host = _register(client, "bulk-approve@test.com")
    sids = []
    for minutes in (60, 120):
        sid = _create_session(client, host, minutes)
        sids.append(sid)
        res = client.post(
            f"/api/v1/reports/generate/{sid}", json={"type": "counselor"}, headers=host["auth"]
        )
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "pending_review"

    res = client.post("/api/v1/reports/approve-all", headers=host["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["approved"] == 2

    listing = client.get("/api/v1/reports", headers=host["auth"]).json()
    for report in listing["reports"]:
        if report["session_id"] in sids:
            assert report["status"] == "completed"


def test_bulk_approve_all_non_counselor_403(client):
    participant = _register(client, "bulk-approve-client@test.com", role="client")
    res = client.post("/api/v1/reports/approve-all", headers=participant["auth"])
    assert res.status_code == 403


def test_mark_all_read(client):
    host = _register(client, "readall-host@test.com")
    member = _register(client, "readall-member@test.com", role="client")
    sid = _create_session(client, host)
    pid = _add_member_participant(client, sid, member["id"])
    gen = client.post(
        f"/api/v1/reports/generate/{sid}",
        json={"type": "client", "participant_id": pid},
        headers=host["auth"],
    )
    assert gen.status_code == 200, gen.text
    assert gen.json()["is_read"] is False

    res = client.put("/api/v1/reports/read-all", headers=member["auth"])
    assert res.status_code == 200, res.text
    assert res.json()["count"] >= 1

    listing = client.get("/api/v1/reports", headers=member["auth"]).json()
    assert listing["total"] >= 1
    assert all(r["is_read"] for r in listing["reports"])
