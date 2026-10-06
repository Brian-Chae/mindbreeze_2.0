"""F1.1 가입 QA 검증 — 상담사/내담자 가입"""

VALID_PASSWORD = "Passw0rd!"


def _consents(tos=True, privacy=True, sensitive=True):
    return {"tos": tos, "privacy": privacy, "sensitive": sensitive}


def _payload(email, **overrides):
    from app.services import email_verify_service
    from tests.conftest import create_test_org
    payload = {
        # SDD-015: 상담사 가입에는 유효한 기관 코드가 필수 (client 가입에서는 무시됨)
        "org_code": create_test_org(),
        "email": email,
        "password": VALID_PASSWORD,
        "name": "홍길동",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    payload.update(overrides)
    return payload


def test_register_counselor_직접가입_차단_403(client):
    """SDD-073: org_code 직접 가입 경로는 우회로이므로 항상 403."""
    res = client.post("/api/v1/auth/register/counselor", json=_payload("counselor@test.com"))
    assert res.status_code == 403, res.text
    assert "초대" in res.json()["detail"]


def test_register_client_성공(client):
    res = client.post("/api/v1/auth/register/client", json=_payload("client@test.com"))
    assert res.status_code == 201, res.text
    assert res.json()["user"]["role"] == "client"


def test_register_이메일_중복_409(client):
    client.post("/api/v1/auth/register/client", json=_payload("dup@test.com"))
    res = client.post("/api/v1/auth/register/client", json=_payload("dup@test.com"))
    assert res.status_code == 409
    assert res.json()["detail"] == "이미 등록된 이메일입니다"


def test_register_민감정보_동의_누락_422(client):
    payload = _payload("nosense@test.com", consents=_consents(sensitive=False))
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 422
    assert res.json()["detail"] == "민감정보 처리에 동의해야 가입할 수 있습니다"


def test_register_약관_동의_누락_422(client):
    payload = _payload("notos@test.com", consents=_consents(tos=False))
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 422
    assert res.json()["detail"] == "서비스 이용약관/개인정보 처리방침 동의는 필수입니다"


def test_register_비밀번호_정책_위반_422(client):
    payload = _payload("weak@test.com", password="abc123")
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 422
    errors = res.json()["detail"]
    assert any(err["loc"][-1] == "password" for err in errors)
    assert "8자 이상" in errors[0]["msg"]


def test_register_email_verify_token_없음_401(client):
    payload = _payload("noverify@test.com")
    payload["email_verify_token"] = ""
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 401
    assert res.json()["detail"] == "이메일 검증 토큰이 필요합니다"
