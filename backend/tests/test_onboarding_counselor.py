"""F1.3 상담사 온보딩 — 단계 진행 + 완료"""

VALID_PASSWORD = "Passw0rd!"


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _register_counselor(client, email="counselor@test.com"):
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "상담사",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post("/api/v1/auth/register/counselor", json=payload)
    assert res.status_code == 201, res.text
    return res.json()["tokens"]["access_token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_상담사_온보딩_전체_플로우(client):
    token = _register_counselor(client, "c1@test.com")
    h = _headers(token)

    res = client.get("/api/v1/onboarding/me", headers=h)
    assert res.status_code == 200
    assert res.json()["current_step"] == 1
    assert res.json()["completed"] is False

    res = client.put("/api/v1/onboarding/counselor/step1", json={"name": "김상담", "phone": "01012345678"}, headers=h)
    assert res.status_code == 200, res.text

    res = client.put(
        "/api/v1/onboarding/counselor/step2",
        json={
            "gender": "male",
            "birth_date": "1980-01-01",
            "years_of_experience": 10,
            "specialties": ["임상", "최면"],
        },
        headers=h,
    )
    assert res.status_code == 200, res.text

    res = client.put(
        "/api/v1/onboarding/counselor/step3",
        json={"affiliation_type": "private", "credential_files": []},
        headers=h,
    )
    assert res.status_code == 200, res.text

    res = client.put(
        "/api/v1/onboarding/counselor/step4",
        json={"profile_image_url": None, "bio": "안녕하세요"},
        headers=h,
    )
    assert res.status_code == 200, res.text

    res = client.post("/api/v1/onboarding/counselor/complete", headers=h)
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["counselor_code"]) == 6
    assert body["counselor_code"].isalnum() and body["counselor_code"].isupper()
    assert body["verified_tier"] == "verified"


def test_상담사_step3_미완료_시_complete_400(client):
    token = _register_counselor(client, "c2@test.com")
    h = _headers(token)

    client.put("/api/v1/onboarding/counselor/step1", json={"name": "김상담", "phone": None}, headers=h)
    client.put(
        "/api/v1/onboarding/counselor/step2",
        json={"gender": None, "birth_date": None, "years_of_experience": None, "specialties": []},
        headers=h,
    )

    res = client.post("/api/v1/onboarding/counselor/complete", headers=h)
    assert res.status_code == 400


def test_상담사_코드_고유성(client):
    t1 = _register_counselor(client, "c3@test.com")
    t2 = _register_counselor(client, "c4@test.com")
    codes = []
    for token in (t1, t2):
        h = _headers(token)
        client.put("/api/v1/onboarding/counselor/step1", json={"name": "x", "phone": None}, headers=h)
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
        client.put(
            "/api/v1/onboarding/counselor/step4",
            json={"profile_image_url": None, "bio": None},
            headers=h,
        )
        res = client.post("/api/v1/onboarding/counselor/complete", headers=h)
        assert res.status_code == 200
        codes.append(res.json()["counselor_code"])
    assert codes[0] != codes[1]
