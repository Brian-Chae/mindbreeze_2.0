"""MB2 관계·권한·정합 수정 검증 — 메모 저장, 비번 재사용, step4 재활성화, 기관 가입 역할.

대응 이슈:
  [1] MB2-CLIENT-01 상담사 비공개 메모 no-op
  [2] MB2-AUTH-03 본인 비밀번호 재설정 재사용 정책
  [3] MB2-ONB-01 내담자 step4 ended 링크 재활성화
  [7] MB2-ORG-04 기관 가입 신청 역할 제한 / 승인 시 counselor 고정
"""

import asyncio
import uuid

import pytest

from app.services import email_verify_service

VALID_PASSWORD = "Passw0rd!"
NEW_PASSWORD = "NewPassw0rd!"


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _register_client(client, email, counselor_code=None):
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "내담자",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    if counselor_code:
        payload["counselor_code"] = counselor_code
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 201, res.text
    return res.json()["user"]["id"], {"Authorization": f"Bearer {res.json()['access_token']}"}


def _active_counselor_with_code(code: str) -> dict:
    """active 상담사 + counselor_code 를 DB에 직접 만든다."""
    from app.models.counselor_profile import CounselorProfile
    from tests.conftest import create_test_counselor, create_test_org

    created = create_test_counselor(
        f"mb2-{uuid.uuid4().hex[:8]}@test.com", name="코드상담사", org_code=create_test_org("MB2센터")
    )
    db = _db()
    try:
        db.add(
            CounselorProfile(
                user_id=uuid.UUID(created["id"]), counselor_code=code, specialties=[]
            )
        )
        db.commit()
    finally:
        db.close()
    return created


# ---------------------------------------------------------------------------
# [1] MB2-CLIENT-01 — 비공개 메모 실제 저장
# ---------------------------------------------------------------------------


def test_mb2_client01_메모_저장_및_조회(client):
    from app.models.client_counselor_link import ClientCounselorLink
    from tests.conftest import create_test_counselor, create_test_org

    counselor = create_test_counselor(
        "memo-counselor@test.com", name="메모상담", org_code=create_test_org("메모센터")
    )
    client_id, _ = _register_client(client, "memo-client@test.com")

    db = _db()
    try:
        db.add(
            ClientCounselorLink(
                client_id=uuid.UUID(client_id),
                counselor_id=uuid.UUID(counselor["id"]),
                status="active",
            )
        )
        db.commit()
    finally:
        db.close()

    h = {"Authorization": f"Bearer {counselor['access_token']}"}
    res = client.put(
        f"/api/v1/clients/{client_id}/memo",
        json={"memo": "우울감 호소, 다음 회기 주의"},
        headers=h,
    )
    assert res.status_code == 200, res.text
    assert res.json()["detail"] == "메모가 저장되었습니다"

    # 저장이 실제로 반영되었는지 조회로 확인 + DB 확인
    got = client.get(f"/api/v1/clients/{client_id}", headers=h)
    assert got.status_code == 200, got.text
    assert got.json()["memo"] == "우울감 호소, 다음 회기 주의"

    db = _db()
    try:
        link = (
            db.query(ClientCounselorLink)
            .filter(
                ClientCounselorLink.client_id == uuid.UUID(client_id),
                ClientCounselorLink.counselor_id == uuid.UUID(counselor["id"]),
            )
            .first()
        )
        assert link.memo == "우울감 호소, 다음 회기 주의"
    finally:
        db.close()


def test_mb2_client01_연결없는_내담자_메모는_403(client):
    from tests.conftest import create_test_counselor

    counselor = create_test_counselor("memo2-counselor@test.com", name="메모상담2")
    client_id, _ = _register_client(client, "memo2-client@test.com")
    h = {"Authorization": f"Bearer {counselor['access_token']}"}
    res = client.put(
        f"/api/v1/clients/{client_id}/memo", json={"memo": "x"}, headers=h
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# [2] MB2-AUTH-03 — 본인 재설정도 직전 3개 재사용 차단
# ---------------------------------------------------------------------------


def test_mb2_auth03_본인재설정_직전비번_재사용_422(client, redis, monkeypatch):
    from app.services import password_reset_service as prs

    links: list[str] = []
    monkeypatch.setattr(
        prs, "send_password_reset_email", lambda to, link: links.append(link)
    )

    email = "self-reset@test.com"
    _register_client(client, email)

    # 1차: 현재 → NEW_PASSWORD (재사용 이력이 없으므로 허용)
    assert client.post("/api/v1/auth/password/forgot", json={"email": email}).status_code == 204
    token1 = links[-1].split("token=", 1)[1]
    first = client.post(
        "/api/v1/auth/password/reset",
        json={"token": token1, "new_password": NEW_PASSWORD},
    )
    assert first.status_code == 200, first.text

    # 2차: 다시 NEW_PASSWORD 로 재설정 시도 → 이력 재사용으로 422
    asyncio.run(redis.flushall())  # 이메일 쿨다운 해제
    assert client.post("/api/v1/auth/password/forgot", json={"email": email}).status_code == 204
    token2 = links[-1].split("token=", 1)[1]
    second = client.post(
        "/api/v1/auth/password/reset",
        json={"token": token2, "new_password": NEW_PASSWORD},
    )
    assert second.status_code == 422, second.text
    assert "재사용" in second.json()["detail"]


# ---------------------------------------------------------------------------
# [3] MB2-ONB-01 — step4 재매칭 시 ended 링크 재활성화 + 채팅방 보장
# ---------------------------------------------------------------------------


def test_mb2_onb01_step4_ended_링크_재활성화(client):
    from datetime import datetime, timezone

    from app.models.chat import ChatRoom
    from app.models.client_counselor_link import ClientCounselorLink

    counselor = _active_counselor_with_code("MB2ONB")
    client_id, h = _register_client(client, "step4-client@test.com")

    db = _db()
    try:
        db.add(
            ClientCounselorLink(
                client_id=uuid.UUID(client_id),
                counselor_id=uuid.UUID(counselor["id"]),
                status="ended",
                ended_at=datetime.now(timezone.utc),
            )
        )
        db.commit()
    finally:
        db.close()

    res = client.post(
        "/api/v1/onboarding/client/step4-match",
        json={"counselor_code": "MB2ONB"},
        headers=h,
    )
    assert res.status_code == 200, res.text

    db = _db()
    try:
        link = (
            db.query(ClientCounselorLink)
            .filter(
                ClientCounselorLink.client_id == uuid.UUID(client_id),
                ClientCounselorLink.counselor_id == uuid.UUID(counselor["id"]),
            )
            .first()
        )
        assert link.status == "active"
        assert link.ended_at is None

        room = (
            db.query(ChatRoom)
            .filter(
                ChatRoom.room_type == "direct",
                ChatRoom.host_id == uuid.UUID(counselor["id"]),
                ChatRoom.name == client_id,
            )
            .first()
        )
        assert room is not None  # ended 재활성화 경로에서도 1:1 채팅방 보장
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [7] MB2-ORG-04 — 가입 신청 역할 제한 + 승인 역할 counselor 고정
# ---------------------------------------------------------------------------


def test_mb2_org04_내담자는_소속신청_403(client):
    from app.models.organization import Organization
    from app.services import org_service

    org = None
    db = _db()
    try:
        org = org_service.admin_create_organization("역할제한센터", db)
        org_id = str(org.id)
    finally:
        db.close()

    _, h = _register_client(client, "join-role-client@test.com")
    res = client.post(f"/api/v1/org/{org_id}/join", headers=h)
    assert res.status_code == 403
    assert "상담사" in res.json()["detail"]


def test_mb2_org04_승인시_membership_역할_counselor_고정(client, monkeypatch):
    from app.models.organization import Organization
    from app.models.user import User
    from app.services import membership_service, notification_service, org_management_service, org_service

    # 알림 부수효과 차단
    monkeypatch.setattr(notification_service, "notify_event", lambda *a, **k: None)
    monkeypatch.setattr(org_management_service, "notify_org_members", lambda *a, **k: None)

    db = _db()
    try:
        org = Organization(name="역할고정센터", kind="institution", org_code="ROLE01", verified=True)
        admin = User(
            email="role-admin@test.com", password_hash="x", name="관리자",
            role="org_admin", status="active",
        )
        applicant = User(
            email="role-applicant@test.com", password_hash="x", name="신청상담사",
            role="counselor", status="active",
        )
        db.add_all([org, admin, applicant])
        db.flush()
        admin.org_id = org.id
        membership_service.add_membership(db, admin, org.id, status_="active", role="org_admin")
        db.commit()
        org_id, admin_id, applicant_id = str(org.id), str(admin.id), str(applicant.id)
    finally:
        db.close()

    db = _db()
    try:
        req = org_service.request_join(org_id, applicant_id, db)
        org_service.handle_join_request(str(req.id), org_id, admin_id, "approved", None, db)
        mem = membership_service.get_membership(db, applicant_id, org_id, statuses=("active",))
        assert mem is not None and mem.role == "counselor"
    finally:
        db.close()


def test_mb2_org03_admin_판정은_membership_기준(client, monkeypatch):
    """User.org_id 미러가 기관과 일치해도 membership 이 없으면 org_admin 판정 실패 (403)."""
    from fastapi import HTTPException

    from app.models.organization import Organization
    from app.models.user import User
    from app.services import notification_service, org_management_service, org_service

    monkeypatch.setattr(notification_service, "notify_event", lambda *a, **k: None)
    monkeypatch.setattr(org_management_service, "notify_org_members", lambda *a, **k: None)

    db = _db()
    try:
        org = Organization(name="미러불일치센터", kind="institution", org_code="MIR001", verified=True)
        # role=org_admin 이고 org_id 도 일치하지만 membership 이 없는 계정
        fake_admin = User(
            email="mirror-admin@test.com", password_hash="x", name="미러관리자",
            role="org_admin", status="active",
        )
        applicant = User(
            email="mirror-applicant@test.com", password_hash="x", name="신청자",
            role="counselor", status="active",
        )
        db.add_all([org, fake_admin, applicant])
        db.flush()
        fake_admin.org_id = org.id
        org_id, fake_admin_id, applicant_id = str(org.id), str(fake_admin.id), str(applicant.id)
        db.commit()
    finally:
        db.close()

    db = _db()
    try:
        req = org_service.request_join(org_id, applicant_id, db)
        with pytest.raises(HTTPException) as err:
            org_service.handle_join_request(str(req.id), org_id, fake_admin_id, "approved", None, db)
        assert err.value.status_code == 403
    finally:
        db.close()
