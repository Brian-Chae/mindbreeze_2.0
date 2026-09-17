"""SDD-078 — 관리자 비밀번호 재설정 (재설정 링크 방식) QA

spec.md §2~§4: 발급 권한/상태 검증, TTL 24h 일회용 토큰, 재발급 무효화,
소비 시 세션 무효화 + PasswordHistory + 감사 기록, 쿨다운.
"""

import uuid

from app.services import email_verify_service

VALID_PASSWORD = "Passw0rd!"
NEW_PASSWORD = "NewPassw0rd!"


def _consents() -> dict:
    return {"tos": True, "privacy": True, "sensitive": True}


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _register(client, email: str) -> dict:
    res = client.post(
        "/api/v1/auth/register/client",
        json={
            "email": email,
            "password": VALID_PASSWORD,
            "name": "테스트",
            "email_verify_token": email_verify_service.generate_email_verify_token(email),
            "consents": _consents(),
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return {"id": body["user"]["id"], "h": {"Authorization": f"Bearer {body['access_token']}"}}


def _promote(user_id: str, role: str) -> None:
    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        user.role = role
        db.commit()
    finally:
        db.close()


def _platform_admin(client, email: str) -> dict:
    admin = _register(client, email)
    _promote(admin["id"], "platform_admin")
    return admin


def _set_status(user_id: str, status: str) -> None:
    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
        user.status = status
        db.commit()
    finally:
        db.close()


def _create_org_with_admin(client, admin_headers, org_name: str, admin_email: str) -> dict:
    """기관 + 주 담당자(pending) 생성 → {org_id, admin_id} 반환."""
    res = client.post(
        "/api/v1/admin/orgs",
        json={
            "name": org_name,
            "admin_name": "박담당",
            "admin_email": admin_email,
        },
        headers=admin_headers,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return {"org_id": body["org"]["id"], "admin_id": body["admin"]["id"]}


def _add_counselor(org_id: str, email: str, name: str = "김상담", status: str = "active") -> str:
    """기관 소속 상담사를 DB 직접 생성 (SDD-073으로 직접 가입 차단됨)."""
    from app.core.security import hash_password
    from app.models.user import User

    db = _db()
    try:
        user = User(
            email=email,
            password_hash=hash_password(VALID_PASSWORD),
            name=name,
            role="counselor",
            status=status,
            verified_tier="email",
            org_id=uuid.UUID(org_id),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return str(user.id)
    finally:
        db.close()


def _org_admin_headers(user_id: str) -> dict:
    from app.core.security import create_access_token

    return {"Authorization": f"Bearer {create_access_token(subject=user_id)}"}


def _capture_reset_links(monkeypatch) -> list[str]:
    """재설정 링크 이메일에서 링크를 가로챈다 (실제 발송 없음)."""
    captured: list[str] = []

    def _fake_send(to_email, reset_link, **kwargs):
        captured.append(reset_link)
        return True

    monkeypatch.setattr(
        "app.services.admin_password_reset_service.send_admin_password_reset_email",
        _fake_send,
    )
    monkeypatch.setattr(
        "app.services.admin_password_reset_service.send_password_reset_completed_email",
        lambda *a, **k: True,
    )
    # 기관 생성 시 발송되는 초대 메일도 실발송을 막는다
    monkeypatch.setattr(
        "app.services.org_invite_service.send_org_invite_email",
        lambda *a, **k: True,
    )
    return captured


def _token_from_link(link: str) -> str:
    assert "/set-password?token=" in link and link.endswith("&type=reset")
    return link.split("token=", 1)[1].split("&", 1)[0]


def _audits(target_id: str, action: str) -> list:
    from app.models.credential import VerificationAudit

    db = _db()
    try:
        return (
            db.query(VerificationAudit)
            .filter(
                VerificationAudit.target_id == uuid.UUID(target_id),
                VerificationAudit.action == action,
            )
            .all()
        )
    finally:
        db.close()


def _bypass_cooldown(monkeypatch) -> None:
    """쿨다운 키를 호출마다 다른 이름으로 바꿔 재발급 테스트에서 쿨다운을 우회한다."""
    import itertools

    from app.services import admin_password_reset_service

    counter = itertools.count()
    monkeypatch.setattr(
        admin_password_reset_service,
        "_cooldown_key",
        lambda user_id: f"admin_pwd_reset_cooldown_test:{next(counter)}",
    )


# ---------------------------------------------------------------------------
# 1. 플랫폼 관리자 — 주 담당자 발급
# ---------------------------------------------------------------------------


def test_01_플랫폼관리자_주담당자_재설정링크_발급(client, monkeypatch):
    links = _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078a@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "재설정센터", "primary078a@test.com")
    _set_status(ctx["admin_id"], "active")

    res = client.post(
        f"/api/v1/admin/orgs/{ctx['org_id']}/primary-admin/password-reset",
        json={"reason": "담당자 요청 — 비밀번호 분실"},
        headers=admin["h"],
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["email_sent"] is True
    assert body["expires_at"]
    # 토큰 원문은 응답에 포함되지 않는다
    assert "token" not in body
    assert len(links) == 1
    # 발급 감사 기록
    issued = _audits(ctx["admin_id"], "password_reset_issued")
    assert len(issued) == 1
    assert issued[0].reason == "담당자 요청 — 비밀번호 분실"
    assert issued[0].extra["target_role"] == "org_admin"


def test_02_pending_주담당자는_409_초대재발송_안내(client, monkeypatch):
    _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078b@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "펜딩센터", "primary078b@test.com")

    res = client.post(
        f"/api/v1/admin/orgs/{ctx['org_id']}/primary-admin/password-reset",
        json={"reason": "사유"},
        headers=admin["h"],
    )
    assert res.status_code == 409
    assert "초대 재발송" in res.json()["detail"]


def test_03_suspended_상담사는_409_거부(client, monkeypatch):
    _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078c@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "정지센터", "primary078c@test.com")
    counselor_id = _add_counselor(ctx["org_id"], "cs078c@test.com", status="suspended")

    res = client.post(
        f"/api/v1/admin/orgs/{ctx['org_id']}/counselors/{counselor_id}/password-reset",
        json={"reason": "사유"},
        headers=admin["h"],
    )
    assert res.status_code == 409
    assert "정지" in res.json()["detail"]


def test_04_사유_누락_또는_공백은_422(client, monkeypatch):
    _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078d@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "사유센터", "primary078d@test.com")
    _set_status(ctx["admin_id"], "active")

    url = f"/api/v1/admin/orgs/{ctx['org_id']}/primary-admin/password-reset"
    assert client.post(url, json={}, headers=admin["h"]).status_code == 422
    assert client.post(url, json={"reason": "   "}, headers=admin["h"]).status_code == 422


def test_05_쿨다운_60초_두번째_발급은_429(client, monkeypatch):
    _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078e@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "쿨다운센터", "primary078e@test.com")
    _set_status(ctx["admin_id"], "active")

    url = f"/api/v1/admin/orgs/{ctx['org_id']}/primary-admin/password-reset"
    assert client.post(url, json={"reason": "1차"}, headers=admin["h"]).status_code == 200
    res = client.post(url, json={"reason": "2차"}, headers=admin["h"])
    assert res.status_code == 429


def test_06_재발급시_이전_토큰_무효화(client, monkeypatch):
    links = _capture_reset_links(monkeypatch)
    _bypass_cooldown(monkeypatch)
    admin = _platform_admin(client, "sys078f@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "재발급센터", "primary078f@test.com")
    _set_status(ctx["admin_id"], "active")

    url = f"/api/v1/admin/orgs/{ctx['org_id']}/primary-admin/password-reset"
    assert client.post(url, json={"reason": "1차"}, headers=admin["h"]).status_code == 200
    assert client.post(url, json={"reason": "2차"}, headers=admin["h"]).status_code == 200
    assert len(links) == 2

    token1, token2 = _token_from_link(links[0]), _token_from_link(links[1])
    # 이전 토큰은 무효 — 유효 링크는 항상 1개
    res1 = client.post(
        "/api/v1/auth/set-password", json={"token": token1, "new_password": NEW_PASSWORD}
    )
    assert res1.status_code == 401
    res2 = client.post(
        "/api/v1/auth/set-password", json={"token": token2, "new_password": NEW_PASSWORD}
    )
    assert res2.status_code == 200, res2.text


# ---------------------------------------------------------------------------
# 2. 소비 — 비밀번호 변경 + 세션 무효화 + 감사
# ---------------------------------------------------------------------------


def test_07_소비시_비밀번호변경_세션무효화_감사_기록(client, monkeypatch):
    links = _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078g@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "소비센터", "primary078g@test.com")
    _set_status(ctx["admin_id"], "active")

    # 대상자가 기존 비밀번호로 로그인해 세션(리프레시 토큰) 보유
    from app.core.security import hash_password
    from app.models.user import User

    db = _db()
    try:
        user = db.query(User).filter(User.id == uuid.UUID(ctx["admin_id"])).first()
        user.password_hash = hash_password(VALID_PASSWORD)
        db.commit()
    finally:
        db.close()
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "primary078g@test.com", "password": VALID_PASSWORD},
    )
    assert login.status_code == 200, login.text
    old_refresh = login.json()["refresh_token"]

    res = client.post(
        f"/api/v1/admin/orgs/{ctx['org_id']}/primary-admin/password-reset",
        json={"reason": "보안 우려"},
        headers=admin["h"],
    )
    assert res.status_code == 200, res.text

    token = _token_from_link(links[0])
    consume = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert consume.status_code == 200, consume.text
    body = consume.json()
    # 재설정은 자동 로그인 없음 — 성공 플래그만
    assert body == {"success": True, "flow": "password_reset"}

    # 일회용 — 재사용 시 401
    reuse = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert reuse.status_code == 401

    # 기존 세션 무효화 — 이전 리프레시 토큰으로 회전 불가
    refresh = client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert refresh.status_code == 401

    # 새 비밀번호로 로그인 성공 + status는 active 유지
    relogin = client.post(
        "/api/v1/auth/login",
        json={"email": "primary078g@test.com", "password": NEW_PASSWORD},
    )
    assert relogin.status_code == 200, relogin.text

    # status는 active 유지 (초대 수락과 달리 상태를 건드리지 않는다)
    from app.models.user import User

    db = _db()
    try:
        target = db.query(User).filter(User.id == uuid.UUID(ctx["admin_id"])).first()
        assert target.status == "active"
    finally:
        db.close()

    # 완료 감사 기록 — 발급 관리자 추적
    completed = _audits(ctx["admin_id"], "password_reset_completed")
    assert len(completed) == 1
    assert completed[0].extra["issued_by"] == admin["id"]

    # PasswordHistory 기록
    from app.models.password_history import PasswordHistory

    db = _db()
    try:
        history = (
            db.query(PasswordHistory)
            .filter(PasswordHistory.user_id == uuid.UUID(ctx["admin_id"]))
            .count()
        )
        assert history >= 1
    finally:
        db.close()


def test_08_소비시_비밀번호_정책_위반은_422(client, monkeypatch):
    links = _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078h@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "정책센터", "primary078h@test.com")
    _set_status(ctx["admin_id"], "active")

    res = client.post(
        f"/api/v1/admin/orgs/{ctx['org_id']}/primary-admin/password-reset",
        json={"reason": "사유"},
        headers=admin["h"],
    )
    assert res.status_code == 200, res.text
    token = _token_from_link(links[0])

    weak = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": "short"}
    )
    assert weak.status_code == 422
    # 정책 위반 시 토큰은 소모되지 않는다 — 재시도 가능
    ok = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert ok.status_code == 200, ok.text


# ---------------------------------------------------------------------------
# 3. 권한 — 플랫폼 상담사 / 기관 관리자 / 자기 자신
# ---------------------------------------------------------------------------


def test_09_플랫폼관리자_상담사_재설정_발급(client, monkeypatch):
    links = _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078i@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "상담사센터", "primary078i@test.com")
    counselor_id = _add_counselor(ctx["org_id"], "cs078i@test.com")

    res = client.post(
        f"/api/v1/admin/orgs/{ctx['org_id']}/counselors/{counselor_id}/password-reset",
        json={"reason": "상담사 요청"},
        headers=admin["h"],
    )
    assert res.status_code == 200, res.text
    assert len(links) == 1
    assert _audits(counselor_id, "password_reset_issued")


def test_10_기관관리자_소속상담사_재설정_발급(client, monkeypatch):
    links = _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078j@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "기관관리센터", "primary078j@test.com")
    _set_status(ctx["admin_id"], "active")
    counselor_id = _add_counselor(ctx["org_id"], "cs078j@test.com")

    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{counselor_id}/password-reset",
        json={"reason": "소속 상담사 요청"},
        headers=_org_admin_headers(ctx["admin_id"]),
    )
    assert res.status_code == 200, res.text
    assert len(links) == 1


def test_11_기관관리자_타기관_상담사는_403(client, monkeypatch):
    _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078k@test.com")
    ctx1 = _create_org_with_admin(client, admin["h"], "우리센터", "primary078k1@test.com")
    ctx2 = _create_org_with_admin(client, admin["h"], "남의센터", "primary078k2@test.com")
    _set_status(ctx1["admin_id"], "active")
    other_counselor = _add_counselor(ctx2["org_id"], "cs078k@test.com")

    # 타 기관 경로 → org_id 불일치로 403
    res = client.post(
        f"/api/v1/org/{ctx2['org_id']}/counselors/{other_counselor}/password-reset",
        json={"reason": "사유"},
        headers=_org_admin_headers(ctx1["admin_id"]),
    )
    assert res.status_code == 403
    # 본인 기관 경로 + 타 기관 상담사 → 소속 검증으로 404
    res2 = client.post(
        f"/api/v1/org/{ctx1['org_id']}/counselors/{other_counselor}/password-reset",
        json={"reason": "사유"},
        headers=_org_admin_headers(ctx1["admin_id"]),
    )
    assert res2.status_code == 404


def test_12_기관관리자_org_admin_대상과_자기자신은_403(client, monkeypatch):
    _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078l@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "자기금지센터", "primary078l@test.com")
    _set_status(ctx["admin_id"], "active")

    # 기관 관리자가 자기 자신(org_admin) 재설정 → 403 (org_admin 대상 금지가 먼저 걸린다)
    res = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{ctx['admin_id']}/password-reset",
        json={"reason": "사유"},
        headers=_org_admin_headers(ctx["admin_id"]),
    )
    assert res.status_code == 403


def test_13_플랫폼관리자_자기자신은_403(client, monkeypatch):
    _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078m@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "본인금지센터", "primary078m@test.com")
    # 주 담당자를 플랫폼 관리자 본인으로 교체
    from app.models.organization import Organization

    db = _db()
    try:
        org = db.query(Organization).filter(Organization.id == uuid.UUID(ctx["org_id"])).first()
        org.primary_admin_id = uuid.UUID(admin["id"])
        db.commit()
    finally:
        db.close()

    res = client.post(
        f"/api/v1/admin/orgs/{ctx['org_id']}/primary-admin/password-reset",
        json={"reason": "사유"},
        headers=admin["h"],
    )
    assert res.status_code == 403
    assert "비밀번호 찾기" in res.json()["detail"]


def test_14_일반_상담사는_발급_권한_없음(client, monkeypatch):
    _capture_reset_links(monkeypatch)
    admin = _platform_admin(client, "sys078n@test.com")
    ctx = _create_org_with_admin(client, admin["h"], "권한센터", "primary078n@test.com")
    counselor_id = _add_counselor(ctx["org_id"], "cs078n1@test.com")
    target_id = _add_counselor(ctx["org_id"], "cs078n2@test.com")

    # 상담사가 admin 경로 → 403 (플랫폼 관리자 아님)
    res = client.post(
        f"/api/v1/admin/orgs/{ctx['org_id']}/counselors/{target_id}/password-reset",
        json={"reason": "사유"},
        headers=_org_admin_headers(counselor_id),
    )
    assert res.status_code == 403
    # 상담사가 org 경로 → 403 (org_admin 아님)
    res2 = client.post(
        f"/api/v1/org/{ctx['org_id']}/counselors/{target_id}/password-reset",
        json={"reason": "사유"},
        headers=_org_admin_headers(counselor_id),
    )
    assert res2.status_code == 403


def test_15_초대_토큰_소비는_기존_동작_유지(client, monkeypatch):
    """SDD-078 통합 후에도 초대 토큰 소비(활성화 + 자동 로그인)는 그대로다."""
    captured: list[str] = []

    def _fake_send(to_email, invite_link, *, admin_name, org_name, expires_days):
        captured.append(invite_link)
        return True

    monkeypatch.setattr("app.services.org_invite_service.send_org_invite_email", _fake_send)
    admin = _platform_admin(client, "sys078o@test.com")
    _create_org_with_admin(client, admin["h"], "초대유지센터", "primary078o@test.com")
    assert len(captured) == 1
    token = captured[0].split("token=", 1)[1]

    res = client.post(
        "/api/v1/auth/set-password", json={"token": token, "new_password": NEW_PASSWORD}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    # 초대 소비는 자동 로그인 응답 유지 (재설정의 success 응답과 구분)
    assert body["access_token"]
    assert body["user"]["role"] == "org_admin"
