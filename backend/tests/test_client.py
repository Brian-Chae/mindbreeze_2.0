"""F4 내담자 관리 QA 검증"""


def _register_counselor(client, email="counselor@test.com"):
    from app.services import email_verify_service

    token = email_verify_service.generate_email_verify_token(email)
    res = client.post(
        "/api/v1/auth/register/counselor",
        json={
            "email": email,
            "password": "Test1234!",
            "name": "김상담",
            "email_verify_token": token,
            "consents": {"tos": True, "privacy": True, "sensitive": True},
        },
    )
    assert res.status_code == 201, res.text
    return res.json()["tokens"]["access_token"]


def test_초대_토큰_생성_및_조회(client):
    """상담사가 내담자 초대 토큰 생성 → 토큰으로 상담사 정보 조회"""
    at = _register_counselor(client, "counselor_inv@test.com")

    # 초대 생성
    res = client.post(
        "/api/v1/clients/invite",
        json={"email": "invited@test.com"},
        headers={"Authorization": f"Bearer {at}"},
    )
    assert res.status_code == 200
    token = res.json()["invite_token"]
    assert len(token) > 10

    # 초대 조회
    res = client.get(f"/api/v1/invite/{token}")
    assert res.status_code == 200
    assert res.json()["counselor_name"] == "김상담"


def test_내담자_목록_빈_상태(client):
    """내담자가 없는 상담사의 목록 조회"""
    at = _register_counselor(client, "empty_list@test.com")
    res = client.get(
        "/api/v1/clients",
        headers={"Authorization": f"Bearer {at}"},
    )
    assert res.status_code == 200
    assert res.json()["total"] == 0


def test_잘못된_초대_토큰_404(client):
    """존재하지 않는 초대 토큰 조회"""
    res = client.get("/api/v1/invite/invalid-token-12345")
    assert res.status_code == 404
