"""F1.1 가입 QA 검증 — 상담사/내담자 가입"""

VALID_PASSWORD = "Passw0rd!"


def _consents(tos=True, privacy=True, sensitive=True):
    return {"tos": tos, "privacy": privacy, "sensitive": sensitive}


def _payload(email, **overrides):
    from app.services import email_verify_service
    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "홍길동",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    payload.update(overrides)
    return payload


def test_register_counselor_성공(client):
    res = client.post("/api/v1/auth/register/counselor", json=_payload("counselor@test.com"))
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["user"]["role"] == "counselor"
    assert body["tokens"]["access_token"]


def test_register_client_성공(client):
    res = client.post("/api/v1/auth/register/client", json=_payload("client@test.com"))
    assert res.status_code == 201, res.text
    assert res.json()["user"]["role"] == "client"


def test_register_이메일_중복_409(client):
    client.post("/api/v1/auth/register/client", json=_payload("dup@test.com"))
    res = client.post("/api/v1/auth/register/client", json=_payload("dup@test.com"))
    assert res.status_code == 409


def test_register_민감정보_동의_누락_422(client):
    payload = _payload("nosense@test.com", consents=_consents(sensitive=False))
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 422


def test_register_약관_동의_누락_422(client):
    payload = _payload("notos@test.com", consents=_consents(tos=False))
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 422


def test_register_비밀번호_정책_위반_422(client):
    payload = _payload("weak@test.com", password="abc123")
    res = client.post("/api/v1/auth/register/client", json=payload)
    assert res.status_code == 422


def test_register_email_verify_token_없음_401(client):
    payload = _payload("noverify@test.com")
    payload["email_verify_token"] = ""
    res = client.post("/api/v1/auth/register/client", json=payload)
    # Pydantic validator로 빈 문자열도 통과 후 라우터에서 401
    assert res.status_code in (401, 422)
