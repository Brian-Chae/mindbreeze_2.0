"""SDD-073 — 회원가입 역할별 분리 QA

기관 가입 상담 접수 / 개인 상담사 신청·승인 / 회원 상담사 코드 가입 / 우회 경로 차단.
"""

import uuid
from unittest.mock import MagicMock

import pytest

from app.services import email_verify_service

VALID_PASSWORD = "Passw0rd!"


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


@pytest.fixture(autouse=True)
def _no_celery(monkeypatch):
    """알림 큐 적재를 모킹 — 테스트에서 실제 브로커에 접근하지 않는다."""
    from app.tasks import report_email_task

    mock = MagicMock()
    monkeypatch.setattr(report_email_task.signup_notice_task, "apply_async", mock)
    return mock


def _platform_admin(client) -> dict:
    """client 가입 후 DB에서 platform_admin 으로 승격."""
    from app.models.user import User

    email = f"admin-{uuid.uuid4().hex[:8]}@test.com"
    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "관리자",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(body["user"]["id"])).first()
        user.role = "platform_admin"
        db.commit()
    finally:
        db.close()
    return {"h": {"Authorization": f"Bearer {body['access_token']}"}}


def _org_application_payload(email="org-contact@test.com", **overrides):
    payload = {
        "organization_name": "테스트병원",
        "contact_name": "박담당",
        "email": email,
        "phone": "010-1234-5678",
        "inquiry": "도입 문의드립니다",
        "consents": {"privacy": True},
    }
    payload.update(overrides)
    return payload


def _counselor_application_payload(email="ind-counselor@test.com", **overrides):
    payload = {
        "name": "김개인",
        "email": email,
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "phone": "010-9999-8888",
        "display_name": "",
        "specialties": "불안, 우울",
        "consents": {"privacy": True},
    }
    payload.update(overrides)
    return payload


def _active_counselor_with_code(code: str = "AAA111") -> dict:
    """active 상담사 + counselor_code 를 DB에 직접 만든다."""
    from app.models.counselor_profile import CounselorProfile
    from app.models.user import User
    from tests.conftest import create_test_counselor, create_test_org

    org_code = create_test_org("코드센터")
    created = create_test_counselor(
        f"code-{uuid.uuid4().hex[:8]}@test.com", name="코드상담사", org_code=org_code
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
# T2: 기관 가입 상담 신청
# ---------------------------------------------------------------------------


def test_기관신청_접수_계정과_기관은_생성되지_않음(client, _no_celery):
    from app.models.organization import Organization
    from app.models.signup_application import SignupApplication
    from app.models.user import User

    res = client.post("/api/v1/signup-applications/organization", json=_org_application_payload())
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "submitted"

    db = _db()
    try:
        app_row = db.query(SignupApplication).filter(
            SignupApplication.id == uuid.UUID(body["application_id"])
        ).first()
        assert app_row is not None
        assert app_row.application_type == "organization"
        assert app_row.organization_id is None and app_row.user_id is None
        # 접수만으로 기관·계정을 만들지 않는다
        assert db.query(Organization).count() == 0
        assert db.query(User).filter(User.email == "org-contact@test.com").first() is None
        # 알림 큐 적재 시도 → queued
        assert app_row.notify_status == "queued"
    finally:
        db.close()
    assert _no_celery.called


def test_기관신청_개인정보_동의없으면_422(client):
    payload = _org_application_payload(consents={"privacy": False})
    res = client.post("/api/v1/signup-applications/organization", json=payload)
    assert res.status_code == 422


def test_기관신청_열린신청_중복이면_409(client, monkeypatch):
    from unittest.mock import AsyncMock

    from app.services import signup_application_service as svc

    monkeypatch.setattr(svc, "check_submit_cooldown", AsyncMock())
    first = client.post("/api/v1/signup-applications/organization", json=_org_application_payload())
    assert first.status_code == 201
    second = client.post("/api/v1/signup-applications/organization", json=_org_application_payload())
    assert second.status_code == 409


def test_기관신청_같은이메일_연속제출_쿨다운_429(client):
    first = client.post("/api/v1/signup-applications/organization", json=_org_application_payload())
    assert first.status_code == 201
    second = client.post("/api/v1/signup-applications/organization", json=_org_application_payload())
    assert second.status_code == 429


# ---------------------------------------------------------------------------
# T3: 개인 상담사 신청 — 즉시 생성 (원자적)
# ---------------------------------------------------------------------------


def test_개인상담사신청_개인기관_대기계정_프로필_생성(client):
    from app.models.counselor_profile import CounselorProfile
    from app.models.organization import Organization
    from app.models.signup_application import SignupApplication
    from app.models.user import User

    res = client.post(
        "/api/v1/signup-applications/individual-counselor",
        json=_counselor_application_payload(),
    )
    assert res.status_code == 201, res.text
    app_id = res.json()["application_id"]

    db = _db()
    try:
        app_row = db.query(SignupApplication).filter(
            SignupApplication.id == uuid.UUID(app_id)
        ).first()
        assert app_row.application_type == "individual_counselor"
        # 활동명 미입력 → "{이름} 개인 상담실" 자동 제안
        assert app_row.organization_name == "김개인 개인 상담실"

        user = db.query(User).filter(User.email == "ind-counselor@test.com").first()
        assert user is not None
        assert user.role == "counselor"
        assert user.status == "pending"  # 승인 전 로그인 불가

        org = db.query(Organization).filter(Organization.id == app_row.organization_id).first()
        assert org.kind == "individual"
        assert org.owner_user_id == user.id
        assert org.org_code is None  # 개인 기관에는 기관 코드를 발급하지 않는다
        assert org.verified is False

        profile = db.query(CounselorProfile).filter(CounselorProfile.user_id == user.id).first()
        assert profile is not None and len(profile.counselor_code) == 6
    finally:
        db.close()


def test_개인상담사신청_기존이메일이면_409_아무것도_안만듦(client):
    from app.models.organization import Organization

    email = "dup-ind@test.com"
    reg = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "기존회원",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
        },
    )
    assert reg.status_code == 201

    res = client.post(
        "/api/v1/signup-applications/individual-counselor",
        json=_counselor_application_payload(email=email),
    )
    assert res.status_code == 409

    db = _db()
    try:
        assert db.query(Organization).filter(Organization.kind == "individual").count() == 0
    finally:
        db.close()


def test_개인상담사_승인전_코드사용불가_승인후_사용가능(client, monkeypatch):
    from app.models.counselor_profile import CounselorProfile
    from app.models.user import User

    # 초대 메일 발송을 가로챈다 (실제 발송 방지 + 링크 검증)
    invite_links: list[str] = []

    def _fake_invite(to_email, invite_link, *, admin_name, org_name, expires_days):
        invite_links.append(invite_link)
        return True

    monkeypatch.setattr(
        "app.services.org_invite_service.send_counselor_invite_email", _fake_invite
    )

    res = client.post(
        "/api/v1/signup-applications/individual-counselor",
        json=_counselor_application_payload(email="flow-ind@test.com"),
    )
    assert res.status_code == 201
    app_id = res.json()["application_id"]

    db = _db()
    try:
        user = db.query(User).filter(User.email == "flow-ind@test.com").first()
        code = (
            db.query(CounselorProfile).filter(CounselorProfile.user_id == user.id).first()
        ).counselor_code
    finally:
        db.close()

    # 승인 전: pending 상담사 코드는 사용 불가 (403)
    check_email = "checker@test.com"
    check_payload = {
        "counselor_code": code,
        "email_verify_token": email_verify_service.generate_email_verify_token(check_email),
    }
    res = client.post("/api/v1/auth/counselor-code/check", json=check_payload)
    assert res.status_code == 403

    # 플랫폼 관리자 승인 → 바로 active + 초대 발송
    admin = _platform_admin(client)
    res = client.post(f"/api/v1/admin/signup-applications/{app_id}/approve", headers=admin["h"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["application"]["status"] == "approved"
    assert body["invite_sent"] is True
    assert len(invite_links) == 1 and "/set-password?token=" in invite_links[0]

    db = _db()
    try:
        user = db.query(User).filter(User.email == "flow-ind@test.com").first()
        assert user.status == "active"  # 승인 즉시 적용
    finally:
        db.close()

    # 승인 후: 코드 확인 통과 + 표시명·기관명 노출
    res = client.post("/api/v1/auth/counselor-code/check", json=check_payload)
    assert res.status_code == 200, res.text
    assert res.json()["counselor_name"] == "김개인"
    assert res.json()["organization_name"] == "김개인 개인 상담실"

    # 중복 승인 → 409
    res = client.post(f"/api/v1/admin/signup-applications/{app_id}/approve", headers=admin["h"])
    assert res.status_code == 409


def test_개인상담사_반려시_계정은_pending_유지(client):
    from app.models.user import User

    res = client.post(
        "/api/v1/signup-applications/individual-counselor",
        json=_counselor_application_payload(email="reject-ind@test.com"),
    )
    app_id = res.json()["application_id"]

    admin = _platform_admin(client)
    res = client.post(
        f"/api/v1/admin/signup-applications/{app_id}/reject",
        json={"reason": "증빙 미비"},
        headers=admin["h"],
    )
    assert res.status_code == 200, res.text
    assert res.json()["application"]["status"] == "rejected"

    db = _db()
    try:
        user = db.query(User).filter(User.email == "reject-ind@test.com").first()
        assert user.status == "pending"  # 반려 후에도 로그인·코드 연결 불가
    finally:
        db.close()

    # 반려 후 승인 시도 → 409
    res = client.post(f"/api/v1/admin/signup-applications/{app_id}/approve", headers=admin["h"])
    assert res.status_code == 409


# ---------------------------------------------------------------------------
# T4: 관리자 신청 관리 — 권한·목록·마스킹
# ---------------------------------------------------------------------------


def test_관리자목록_전화번호_마스킹_상세는_전체(client):
    client.post("/api/v1/signup-applications/organization", json=_org_application_payload())
    admin = _platform_admin(client)

    res = client.get("/api/v1/admin/signup-applications", headers=admin["h"])
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert len(items) == 1
    assert items[0]["phone"].endswith("5678")
    assert "010" not in items[0]["phone"]  # 목록은 마스킹

    detail = client.get(
        f"/api/v1/admin/signup-applications/{items[0]['id']}", headers=admin["h"]
    )
    assert detail.status_code == 200
    assert detail.json()["phone"] == "010-1234-5678"  # 관리자 상세만 전체


def test_일반사용자는_신청관리_403(client):
    email = "normal-user@test.com"
    reg = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "일반",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
        },
    )
    h = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    res = client.get("/api/v1/admin/signup-applications", headers=h)
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# T5: 회원 가입 — 상담사 코드 검증·연결 + 개인정보 저장
# ---------------------------------------------------------------------------


def test_회원가입_코드연결_프로필_전화저장(client):
    from app.models.client_counselor_link import ClientCounselorLink
    from app.models.client_profile import ClientProfile
    from app.models.user import User

    counselor = _active_counselor_with_code("BBB222")

    email = "member1@test.com"
    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "회원일",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
            "gender": "female",
            "birth_date": "1995-03-01",
            "phone": "010-5555-6666",
            "counselor_code": "bbb222",  # 소문자 입력도 정규화되어야 한다
        },
    )
    assert res.status_code == 201, res.text
    user_id = uuid.UUID(res.json()["user"]["id"])

    db = _db()
    try:
        user = db.query(User).filter(User.id == user_id).first()
        assert user.phone == "010-5555-6666"
        profile = db.query(ClientProfile).filter(ClientProfile.user_id == user_id).first()
        assert profile.gender == "female"
        assert str(profile.birth_date) == "1995-03-01"
        link = db.query(ClientCounselorLink).filter(
            ClientCounselorLink.client_id == user_id,
            ClientCounselorLink.counselor_id == uuid.UUID(counselor["id"]),
        ).first()
        assert link is not None and link.status == "active"
    finally:
        db.close()

    # 온보딩 중복 제거 — step1·2·4 는 가입에서 마킹되고 재개 지점은 step3(프로필)
    h = {"Authorization": f"Bearer {res.json()['access_token']}"}
    progress = client.get("/api/v1/onboarding/me", headers=h)
    assert progress.status_code == 200
    body = progress.json()
    assert body["current_step"] == 3
    for done_step in ("step1", "step2", "step4"):
        assert done_step in body["step_data"]

    # step3(프로필)만 저장하면 온보딩 완료 가능
    client.put(
        "/api/v1/onboarding/client/step3",
        json={"profile_image_url": None, "bio": None},
        headers=h,
    )
    done = client.post("/api/v1/onboarding/client/complete", headers=h)
    assert done.status_code == 200, done.text


def test_회원가입_전화번호_없어도_성공(client):
    email = "nophone@test.com"
    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "무전화",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
            "gender": "other",
            "birth_date": "2000-01-01",
        },
    )
    assert res.status_code == 201, res.text


def test_회원가입_잘못된코드면_사용자_미생성(client):
    from app.models.user import User

    email = "badcode@test.com"
    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "실패",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
            "counselor_code": "ZZZ999",
        },
    )
    assert res.status_code == 404

    db = _db()
    try:
        assert db.query(User).filter(User.email == email).first() is None
    finally:
        db.close()


def test_회원가입_미래생년월일_422(client):
    email = "future@test.com"
    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "미래인",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
            "birth_date": "2999-01-01",
        },
    )
    assert res.status_code == 422


def test_코드체크_OTP검증_없으면_401(client):
    _active_counselor_with_code("CCC333")
    res = client.post(
        "/api/v1/auth/counselor-code/check",
        json={"counselor_code": "CCC333", "email_verify_token": "invalid-token"},
    )
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# T6: 우회 경로 차단
# ---------------------------------------------------------------------------


def test_org_register_자가등록_차단_403(client):
    from tests.conftest import create_test_counselor

    counselor = create_test_counselor("orgreg@test.com")
    res = client.post(
        "/api/v1/org/register",
        json={
            "name": "우회센터",
            "ceo_name": "홍길동",
            "biz_number": "123-45-67890",
            "address": "서울",
            "phone": "02-123-4567",
        },
        headers={"Authorization": f"Bearer {counselor['access_token']}"},
    )
    assert res.status_code == 403
