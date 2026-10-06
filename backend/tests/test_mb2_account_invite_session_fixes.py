"""MIND BREEZE 2.0 — 계정·초대·일정 정합 5건 회귀 테스트.

[1] MB2-AUTH-04 내담자 생년월일 미래 날짜 차단 (PATCH /users/me, /clients/me/profile)
[2] MB2-ONB-02 client step4-match 상담사 코드 정규화
[3] MB2-CLIENT-02 공개 초대 조회(get_invite) 만료·사용 검증
[4] MB2-CLIENT-03 초대 토큰 single-use (accepted 재사용 차단)
[5] FUNC-08 일정 수정(update_session) 시 과거 일시 차단
"""

from datetime import datetime, timedelta, timezone

VALID_PASSWORD = "Passw0rd!"


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _db():
    """dependency-override된 인메모리 세션 반환 (검증용 직접 조회)."""
    from app.core.database import get_db
    from app.main import app

    return next(app.dependency_overrides[get_db]())


def _register_client(client, email):
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "내담자",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 201, res.text
    return res.json()["access_token"]


def _register_counselor(client, email):
    """상담사 DB 직접 생성(SDD-073) + access_token 반환."""
    from tests.conftest import create_test_counselor, create_test_org

    created = create_test_counselor(email, name="테스트", org_code=create_test_org())
    return created["access_token"]


def _complete_counselor_onboarding(client, email):
    """상담사 온보딩 완료 → counselor_code 반환."""
    token = _register_counselor(client, email)
    h = _headers(token)
    client.put("/api/v1/onboarding/counselor/step1", json={"name": "상담사", "phone": None}, headers=h)
    client.put(
        "/api/v1/onboarding/counselor/step2",
        json={"gender": None, "birth_date": None, "years_of_experience": None, "specialties": []},
        headers=h,
    )
    client.put(
        "/api/v1/onboarding/counselor/step3",
        json={"affiliation_type": "private", "credential_files": []},
        headers=h,
    )
    client.put("/api/v1/onboarding/counselor/step4", json={"profile_image_url": None, "bio": None}, headers=h)
    res = client.post("/api/v1/onboarding/counselor/complete", headers=h)
    assert res.status_code == 200, res.text
    return res.json()["counselor_code"]


def _verified_counselor_with_invite(client, counselor_email, invite_email):
    """상담사 온보딩 완료 → 초대 생성. (counselor_token, invite_token) 반환."""
    token = _register_counselor(client, counselor_email)
    h = _headers(token)
    client.put("/api/v1/onboarding/counselor/step1", json={"name": "상담사", "phone": None}, headers=h)
    client.put(
        "/api/v1/onboarding/counselor/step2",
        json={"gender": None, "birth_date": None, "years_of_experience": None, "specialties": []},
        headers=h,
    )
    client.put(
        "/api/v1/onboarding/counselor/step3",
        json={"affiliation_type": "private", "credential_files": []},
        headers=h,
    )
    client.put("/api/v1/onboarding/counselor/step4", json={"profile_image_url": None, "bio": None}, headers=h)
    res = client.post("/api/v1/onboarding/counselor/complete", headers=h)
    assert res.status_code == 200, res.text

    res = client.post("/api/v1/clients/invite", json={"email": invite_email}, headers=h)
    assert res.status_code == 200, res.text
    return token, res.json()["invite_token"]


def _register_client_with_invite(client, email, invite_token):
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "내담자",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
        "invite_token": invite_token,
    }
    return client.post("/api/v1/auth/register/client", json=payload)


def _invite_status(token):
    from app.models.client_invite import ClientInvite

    db = _db()
    try:
        inv = db.query(ClientInvite).filter(ClientInvite.token == token).first()
        return inv.status if inv else None
    finally:
        db.close()


def _counselor_client_count(client, counselor_token):
    res = client.get("/api/v1/clients", headers=_headers(counselor_token))
    assert res.status_code == 200, res.text
    return res.json()["total"]


def _future(minutes=60):
    return (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()


def _past(minutes=60):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()


# ---------------------------------------------------------------------------
# [1] MB2-AUTH-04 — 생년월일 미래 날짜 차단
# ---------------------------------------------------------------------------


def test_users_me_미래_생년월일_차단(client):
    """내담자 본인 수정(PATCH /users/me)에서 미래 생년월일은 422."""
    at = _register_client(client, "bd_future_me@test.com")
    h = _headers(at)

    res = client.patch("/api/v1/auth/users/me", json={"birth_date": "2999-01-01"}, headers=h)
    assert res.status_code == 422, res.text

    # 정상(과거) 날짜는 통과
    res = client.patch("/api/v1/auth/users/me", json={"birth_date": "1990-01-01"}, headers=h)
    assert res.status_code == 200, res.text


def test_clients_me_profile_미래_생년월일_차단(client):
    """내담자 프로필 수정(PATCH /clients/me/profile)에서 미래 생년월일은 422."""
    at = _register_client(client, "bd_future_profile@test.com")
    h = _headers(at)

    res = client.patch("/api/v1/auth/clients/me/profile", json={"birth_date": "2999-01-01"}, headers=h)
    assert res.status_code == 422, res.text

    # 잘못된 형식도 여전히 422
    res = client.patch("/api/v1/auth/clients/me/profile", json={"birth_date": "1990-13-40"}, headers=h)
    assert res.status_code == 422, res.text

    # 정상(과거) 날짜는 통과
    res = client.patch("/api/v1/auth/clients/me/profile", json={"birth_date": "1990-01-01"}, headers=h)
    assert res.status_code == 200, res.text


# ---------------------------------------------------------------------------
# [2] MB2-ONB-02 — step4-match 코드 정규화
# ---------------------------------------------------------------------------


def test_step4_소문자_코드_정규화_매칭(client):
    """소문자 코드도 대문자 정규화되어 매칭되고 저장된다.

    (counselor_code 스키마가 6자로 제한되어 앞뒤 공백은 도달하지 못한다.)
    """
    code = _complete_counselor_onboarding(client, "co_norm@test.com")
    assert code == code.upper()

    at = _register_client(client, "cl_norm@test.com")
    h = _headers(at)

    res = client.post(
        "/api/v1/onboarding/client/step4-match",
        json={"counselor_code": code.lower()},
        headers=h,
    )
    assert res.status_code == 200, res.text
    assert res.json()["matched_counselor"]["counselor_code"] == code

    # 저장된 step4 코드도 정규화된 값이어야 한다
    from app.models.user import User
    from app.services import onboarding_service

    db = _db()
    try:
        user = db.query(User).filter(User.email == "cl_norm@test.com").first()
        progress = onboarding_service.get_progress(user.id, db)
        steps = progress.steps or {}
        assert steps["step4"]["counselor_code"] == code
    finally:
        db.close()


# ---------------------------------------------------------------------------
# [3] MB2-CLIENT-02 — 공개 초대 조회 만료·사용 검증
# ---------------------------------------------------------------------------


def test_get_invite_사용완료_404(client):
    """pending 초대는 조회되고, 수락(accepted)되면 404."""
    _token, invite = _verified_counselor_with_invite(client, "co_inv_used@test.com", "inv_used@test.com")

    assert client.get(f"/api/v1/invite/{invite}").status_code == 200

    reg = _register_client_with_invite(client, "inv_used@test.com", invite)
    assert reg.status_code == 201, reg.text
    assert _invite_status(invite) == "accepted"

    assert client.get(f"/api/v1/invite/{invite}").status_code == 404


def test_get_invite_만료_404(client):
    """status=expired 초대 조회는 404."""
    _token, invite = _verified_counselor_with_invite(client, "co_inv_exp@test.com", "inv_exp@test.com")

    from app.models.client_invite import ClientInvite

    db = _db()
    try:
        inv = db.query(ClientInvite).filter(ClientInvite.token == invite).first()
        inv.status = "expired"
        db.add(inv)
        db.commit()
    finally:
        db.close()

    assert client.get(f"/api/v1/invite/{invite}").status_code == 404


# ---------------------------------------------------------------------------
# [4] MB2-CLIENT-03 — 초대 토큰 single-use
# ---------------------------------------------------------------------------


def test_초대_accepted_재사용_차단(client):
    """수락된 초대는 다시 수락해도 링크가 추가되지 않고 None 을 반환한다."""
    counselor_token, invite = _verified_counselor_with_invite(client, "co_single@test.com", "single@test.com")

    reg = _register_client_with_invite(client, "single@test.com", invite)
    assert reg.status_code == 201, reg.text
    assert _invite_status(invite) == "accepted"
    assert _counselor_client_count(client, counselor_token) == 1

    # 같은 사용자로 서비스 재호출 → accepted 이므로 single-use 차단(None)
    from app.models.user import User
    from app.services import client_service

    db = _db()
    try:
        user = db.query(User).filter(User.email == "single@test.com").first()
        result = client_service.link_invited_client(invite, user, db, create_room=False)
        assert result is None
    finally:
        db.close()

    # 상태·링크 수 변화 없음
    assert _invite_status(invite) == "accepted"
    assert _counselor_client_count(client, counselor_token) == 1


# ---------------------------------------------------------------------------
# [5] FUNC-08 — 일정 수정 시 과거 일시 차단
# ---------------------------------------------------------------------------


def test_세션_수정_과거_일시_차단(client):
    """세션 수정(PUT /sessions/{id})에서 과거 일시는 400, 미래는 허용."""
    token = _register_counselor(client, "host_f08@test.com")
    h = _headers(token)

    s = client.post(
        "/api/v1/sessions",
        json={"type": "clinical", "scheduled_at": _future(60), "duration_min": 50, "title": "FUNC-08"},
        headers=h,
    ).json()

    res = client.put(f"/api/v1/sessions/{s['id']}", json={"scheduled_at": _past(120)}, headers=h)
    assert res.status_code == 400, res.text
    assert "과거" in res.json()["detail"]

    res = client.put(f"/api/v1/sessions/{s['id']}", json={"scheduled_at": _future(180)}, headers=h)
    assert res.status_code == 200, res.text
