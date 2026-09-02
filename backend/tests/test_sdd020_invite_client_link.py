"""SDD-020 — 내담자 초대 가입 시 상담사 자동 연결

이메일 가입(register_client) / 구글 가입(google_auth) 양쪽에서 invite_token으로
초대한 상담사에 자동 연결되는지, 그리고 Claude 보안 리뷰가 지적한 결함
(이메일 미검증 / single-use 미처리 / 만료 미처리)이 보완됐는지 검증한다.
"""

from unittest.mock import AsyncMock, MagicMock, patch

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


def _register(client, role, email):
    from app.services import email_verify_service
    from tests.conftest import create_test_org

    payload = {
        "org_code": create_test_org(),  # client 가입에서는 무시됨
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    return res.json()


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


def _verified_counselor_with_invite(client, counselor_email, invite_email):
    """상담사 가입 + 온보딩 완료 → 초대 생성. (counselor_token, invite_token) 반환."""
    reg = _register(client, "counselor", counselor_email)
    token = reg["access_token"]
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


def _counselor_client_count(client, counselor_token):
    res = client.get("/api/v1/clients", headers=_headers(counselor_token))
    assert res.status_code == 200, res.text
    return res.json()["total"]


def _invite_status(token):
    from app.models.client_invite import ClientInvite

    db = _db()
    try:
        inv = db.query(ClientInvite).filter(ClientInvite.token == token).first()
        return inv.status if inv else None
    finally:
        db.close()


# ---------------------------------------------------------------------------
# register_client(invite_token)
# ---------------------------------------------------------------------------

def test_이메일가입_초대토큰_상담사_자동연결(client):
    """초대 이메일과 가입 이메일이 일치 → 링크 자동 생성 + 초대 accepted 전환."""
    counselor_token, invite = _verified_counselor_with_invite(
        client, "co_ok@test.com", "invitee@test.com"
    )

    res = _register_client_with_invite(client, "invitee@test.com", invite)
    assert res.status_code == 201, res.text

    # 상담사 목록에 자동 연결된 내담자가 보인다
    assert _counselor_client_count(client, counselor_token) == 1
    # single-use: 초대가 accepted로 전환됐다
    assert _invite_status(invite) == "accepted"


def test_이메일가입_이메일_불일치시_연결안됨(client):
    """초대 이메일 ≠ 가입 이메일 → 링크 미생성(제3자 도용 차단). 가입 자체는 성공."""
    counselor_token, invite = _verified_counselor_with_invite(
        client, "co_mm@test.com", "target@test.com"
    )

    # 초대 대상과 다른 이메일로 가입
    res = _register_client_with_invite(client, "attacker@test.com", invite)
    assert res.status_code == 201, res.text  # 가입은 성공

    # 링크는 만들어지지 않았고 초대도 여전히 pending
    assert _counselor_client_count(client, counselor_token) == 0
    assert _invite_status(invite) == "pending"


def test_이메일가입_만료된_초대_연결안됨(client):
    """status=expired 초대 → 이메일이 맞아도 연결하지 않는다."""
    counselor_token, invite = _verified_counselor_with_invite(
        client, "co_exp@test.com", "expired@test.com"
    )

    # 초대를 만료 상태로 강제
    from app.models.client_invite import ClientInvite

    db = _db()
    try:
        inv = db.query(ClientInvite).filter(ClientInvite.token == invite).first()
        inv.status = "expired"
        db.add(inv)
        db.commit()
    finally:
        db.close()

    res = _register_client_with_invite(client, "expired@test.com", invite)
    assert res.status_code == 201, res.text

    assert _counselor_client_count(client, counselor_token) == 0
    assert _invite_status(invite) == "expired"  # 여전히 만료


def test_이메일가입_무효_토큰이어도_가입_성공(client):
    """존재하지 않는 초대 토큰이어도 가입은 성공(폴백)."""
    res = _register_client_with_invite(client, "notoken@test.com", "does-not-exist-xyz")
    assert res.status_code == 201, res.text


def test_초대가입_후_온보딩_step4없이_완료_가능(client):
    """자동 연결 시 step4가 마킹되므로 상담사 코드 재입력 없이 온보딩 완료된다.

    이것이 원 버그('상담사 매칭 화면 재등장 + 완료 시 400')의 해소 검증이다.
    """
    _counselor_token, invite = _verified_counselor_with_invite(
        client, "co_gate@test.com", "gate@test.com"
    )

    reg = _register_client_with_invite(client, "gate@test.com", invite)
    assert reg.status_code == 201, reg.text
    h = _headers(reg.json()["access_token"])

    # 프로필 단계(step1~3)만 진행하고 step4-match(수동 코드 입력)는 호출하지 않는다
    client.put("/api/v1/onboarding/client/step1", json={"name": "내담자", "phone": None}, headers=h)
    client.put(
        "/api/v1/onboarding/client/step2",
        json={"gender": None, "birth_date": None, "concerns": [], "interests": []},
        headers=h,
    )
    client.put("/api/v1/onboarding/client/step3", json={"profile_image_url": None, "bio": None}, headers=h)

    # step4-match 없이 바로 완료 → 400이 아니라 200
    res = client.post("/api/v1/onboarding/client/complete", headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["completed"] is True


# ---------------------------------------------------------------------------
# google_auth(invite_token) — 회귀 + 개선
# ---------------------------------------------------------------------------

def _userinfo_mock(status_code, payload=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = payload or {}
    return AsyncMock(return_value=resp)


def test_구글가입_초대토큰_상담사_자동연결(client):
    """구글 신규 가입 + invite_token(이메일 일치) → 링크 자동 생성 + accepted."""
    counselor_token, invite = _verified_counselor_with_invite(
        client, "co_g1@test.com", "g-invitee@test.com"
    )

    mock = _userinfo_mock(200, {"email": "g-invitee@test.com", "name": "구글내담자"})
    with patch("httpx.AsyncClient.get", mock):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid", "invite_token": invite},
        )
    assert res.status_code == 200, res.text
    assert _counselor_client_count(client, counselor_token) == 1
    assert _invite_status(invite) == "accepted"


def test_구글가입_이메일_불일치시_연결안됨(client):
    """구글 계정 이메일이 초대 이메일과 다르면 연결하지 않는다(신규 보안 개선)."""
    counselor_token, invite = _verified_counselor_with_invite(
        client, "co_g2@test.com", "g-target@test.com"
    )

    mock = _userinfo_mock(200, {"email": "g-other@test.com", "name": "다른사람"})
    with patch("httpx.AsyncClient.get", mock):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid", "invite_token": invite},
        )
    assert res.status_code == 200, res.text  # 로그인은 성공
    assert _counselor_client_count(client, counselor_token) == 0
    assert _invite_status(invite) == "pending"


def test_구글_초대토큰_없는_기존흐름_회귀없음(client):
    """invite_token 없는 기존 구글 로그인은 그대로 동작한다."""
    mock = _userinfo_mock(200, {"email": "plain-google@test.com", "name": "일반"})
    with patch("httpx.AsyncClient.get", mock):
        res = client.post("/api/v1/auth/google", json={"access_token": "valid"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["user"]["email"] == "plain-google@test.com"
    assert data["user"]["role"] == "client"


def test_중복_수락_idempotent(client):
    """이미 연결된 상태에서 같은 초대를 다시 수락해도 링크는 1개, 에러 없음."""
    counselor_token, invite = _verified_counselor_with_invite(
        client, "co_dup@test.com", "dup@test.com"
    )

    # 1차: 이메일 가입으로 연결
    res = _register_client_with_invite(client, "dup@test.com", invite)
    assert res.status_code == 201, res.text
    assert _counselor_client_count(client, counselor_token) == 1

    # 2차: 같은 이메일/토큰으로 구글 로그인(기존 사용자) → idempotent
    mock = _userinfo_mock(200, {"email": "dup@test.com", "name": "중복"})
    with patch("httpx.AsyncClient.get", mock):
        res = client.post(
            "/api/v1/auth/google",
            json={"access_token": "valid", "invite_token": invite},
        )
    assert res.status_code == 200, res.text
    # 링크는 여전히 1개 (중복 생성 안 됨)
    assert _counselor_client_count(client, counselor_token) == 1
