"""MB2 상(上) 기능 오류 4건 회귀 테스트.

[1] MB2-AUTH-RESET-LINK — 비밀번호 재설정 링크가 실제 프론트 라우트(/reset-password)를 가리킨다.
[2] MB2-ONB-GOOGLE-ESSENTIALS — Google 가입 내담자는 step1~4 없이도 온보딩 완료(이메일은 강제 유지).
[3] RPT-IDOR-001 — client 리포트는 본인 것만 열람 가능(같은 세션 타 참여자 403).
[4] LIVE-01 — 준비 리마인드 허용 참가자 집합을 호스트 스냅샷의 실제 키(metrics)에서 읽는다.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import app.ws.session_live_namespace as ns
from app.services import email_verify_service
from tests.conftest import create_test_counselor

VALID_PASSWORD = "Passw0rd!"


def _db():
    from app.core.database import get_db
    from app.main import app

    return next(app.dependency_overrides[get_db]())


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _register_client(client, email: str):
    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "내담자",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["user"]["id"], {"Authorization": f"Bearer {body['access_token']}"}


def _google(email: str):
    """userinfo + tokeninfo(aud) 를 URL 로 구분해 흉내내는 mock."""

    def _side_effect(url, **kwargs):
        resp = MagicMock(status_code=200)
        if "userinfo" in str(url):
            resp.json.return_value = {"email": email, "name": "구글내담자"}
        else:  # tokeninfo — audience 검증 통과
            resp.json.return_value = {"aud": "test-client-id"}
        return resp

    return patch("httpx.AsyncClient.get", AsyncMock(side_effect=_side_effect))


# ---------------------------------------------------------------------------
# [1] MB2-AUTH-RESET-LINK
# ---------------------------------------------------------------------------


def test_mb2_auth_reset_link_프론트_라우트(client, monkeypatch):
    from app.services import password_reset_service as prs

    links: list[str] = []
    monkeypatch.setattr(
        prs, "send_password_reset_email", lambda to, link: links.append(link)
    )

    email = "reset-link@test.com"
    _register_client(client, email)

    res = client.post("/api/v1/auth/password/forgot", json={"email": email})
    assert res.status_code == 204, res.text
    assert links, "재설정 링크가 발송되지 않았다"
    assert "/reset-password?token=" in links[-1], links[-1]
    # 존재하지 않는 백엔드 경로로 되돌아가지 않는다
    assert "/auth/password/reset?token=" not in links[-1], links[-1]


# ---------------------------------------------------------------------------
# [2] MB2-ONB-GOOGLE-ESSENTIALS
# ---------------------------------------------------------------------------


def test_mb2_onb_google_essentials_완료(client):
    """Google 가입 내담자는 step1~4 없이 essentials 만으로 온보딩을 완료한다."""
    with _google("g-essentials@test.com"):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid", "consents": _consents()},
        )
    assert res.status_code == 200, res.text
    token = res.json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}

    # essentials 저장 경로 — PATCH /auth/users/me 는 step 을 기록하지 않는다.
    patched = client.patch(
        "/api/v1/auth/users/me",
        json={"name": "구글내담자", "gender": "female", "birth_date": "1995-03-01"},
        headers=h,
    )
    assert patched.status_code == 200, patched.text

    done = client.post("/api/v1/onboarding/client/complete", headers=h)
    assert done.status_code == 200, done.text
    assert done.json()["completed"] is True


def test_mb2_onb_이메일_가입은_step_강제_유지(client):
    """이메일 가입 내담자는 기존대로 step1~4 미완료 시 400."""
    email = "email-gate@test.com"
    _register_client(client, email)
    res = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": VALID_PASSWORD},
    )
    assert res.status_code == 200, res.text
    h = {"Authorization": f"Bearer {res.json()['access_token']}"}

    # gender/birth 미입력 가입 → step1 만 저장 → step2 결손으로 400
    done = client.post("/api/v1/onboarding/client/complete", headers=h)
    assert done.status_code == 400, done.text


# ---------------------------------------------------------------------------
# [3] RPT-IDOR-001
# ---------------------------------------------------------------------------


def test_rpt_idor_client_리포트_타참여자_403(client):
    from app.models.record import Report
    from app.models.session import SessionParticipant

    host = create_test_counselor("idor-host@test.com")
    h = {"Authorization": f"Bearer {host['access_token']}"}
    res = client.post(
        "/api/v1/sessions",
        json={
            "type": "clinical",
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(minutes=60)).isoformat(),
            "duration_min": 50,
            "title": "IDOR 세션",
        },
        headers=h,
    )
    assert res.status_code == 201, res.text
    sid = res.json()["id"]

    client_a_id, a_h = _register_client(client, "idor-a@test.com")
    client_b_id, b_h = _register_client(client, "idor-b@test.com")

    db = _db()
    try:
        pa = SessionParticipant(session_id=UUID(sid), user_id=UUID(client_a_id))
        pb = SessionParticipant(session_id=UUID(sid), user_id=UUID(client_b_id))
        db.add_all([pa, pb])
        db.flush()
        ra = Report(
            session_id=UUID(sid), user_id=UUID(client_a_id), participant_id=pa.id,
            type="client", content={}, status="pending_review",
        )
        rb = Report(
            session_id=UUID(sid), user_id=UUID(client_b_id), participant_id=pb.id,
            type="client", content={}, status="pending_review",
        )
        db.add_all([ra, rb])
        db.commit()
        ra_id, rb_id = str(ra.id), str(rb.id)
    finally:
        db.close()

    # 본인 리포트 → 200
    assert client.get(f"/api/v1/reports/{ra_id}", headers=a_h).status_code == 200
    assert client.get(f"/api/v1/reports/{rb_id}", headers=b_h).status_code == 200

    # 같은 세션의 타 참여자 리포트 → 403 (수평 권한 상승 차단)
    assert client.get(f"/api/v1/reports/{ra_id}", headers=b_h).status_code == 403
    assert client.get(f"/api/v1/reports/{rb_id}", headers=a_h).status_code == 403


# ---------------------------------------------------------------------------
# [4] LIVE-01
# ---------------------------------------------------------------------------


def test_live01_reminder_허용참가자를_metrics에서_읽는다(monkeypatch):
    from tests.test_class_waiting_room_presence import _wire

    fake = _wire(
        monkeypatch,
        {"host": {"role": "host", "session_id": "sess-1", "user_id": "host-1"}},
    )
    monkeypatch.setattr(
        ns,
        "_resolve_join",
        lambda *args: {
            "role": "host",
            "snapshot": {
                "metrics": [
                    {"participant_id": "p-1"},
                    {"participant_id": "p-2"},
                ]
            },
        },
    )
    payload = {"session_id": "sess-1", "participant_ids": ["p-1", "p-2"]}
    assert fake.call("waiting_room_remind", "host", payload) == {"ok": True, "sent": 2}
    # 스냅샷(metrics)에 없는 대상은 거부
    assert (
        fake.call(
            "waiting_room_remind",
            "host",
            {"session_id": "sess-1", "participant_ids": ["p-3"]},
        )["ok"]
        is False
    )
