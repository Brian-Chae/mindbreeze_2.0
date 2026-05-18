"""F1.4 내담자 온보딩 — 단계 진행 + 상담사 코드 매칭"""

VALID_PASSWORD = "Passw0rd!"


def _consents():
    return {"tos": True, "privacy": True, "sensitive": True}


def _register(client, role, email):
    from app.services import email_verify_service

    payload = {
        "email": email,
        "password": VALID_PASSWORD,
        "name": "테스트",
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": _consents(),
    }
    res = client.post(f"/api/v1/auth/register/{role}", json=payload)
    assert res.status_code == 201, res.text
    return res.json()["tokens"]["access_token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _complete_counselor_onboarding(client, email):
    """상담사 가입 → 온보딩 완료 → counselor_code 반환."""
    token = _register(client, "counselor", email)
    h = _headers(token)
    client.put("/api/v1/onboarding/counselor/step1", json={"name": "상담사", "phone": None}, headers=h)
    client.put(
        "/api/v1/onboarding/counselor/step2",
        json={"gender": None, "birth_date": None, "years_of_experience": None, "specialties": ["불안"]},
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
    assert res.status_code == 200, res.text
    return res.json()["counselor_code"]


def _register_unverified_counselor(client, email):
    """상담사 가입만 하고 온보딩 step1·2까지만 → verified_tier=email 유지.
    단 step2에서 CounselorProfile이 생성되며 counselor_code도 발급되지만,
    User.verified_tier는 'email'(unverified 아님)이므로 별도 처리 필요.
    여기서는 직접 DB를 건드리지 않고, 가입만 한 후 코드를 생성하기 위해 step1·2만 진행한 뒤
    User.verified_tier를 'unverified'로 강제한다.
    """
    from app.core.database import get_db
    from app.main import app
    from app.models.user import User

    token = _register(client, "counselor", email)
    h = _headers(token)
    client.put("/api/v1/onboarding/counselor/step1", json={"name": "미인증상담사", "phone": None}, headers=h)
    client.put(
        "/api/v1/onboarding/counselor/step2",
        json={"gender": None, "birth_date": None, "years_of_experience": None, "specialties": []},
        headers=h,
    )

    # verified_tier 를 'unverified'로 강제
    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        user = db.query(User).filter(User.email == email).first()
        user.verified_tier = "unverified"
        db.add(user)
        db.commit()
        from app.models.counselor_profile import CounselorProfile

        profile = db.query(CounselorProfile).filter(CounselorProfile.user_id == user.id).first()
        return profile.counselor_code
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def test_내담자_온보딩_플로우_및_매칭(client):
    counselor_code = _complete_counselor_onboarding(client, "co1@test.com")

    token = _register(client, "client", "cl1@test.com")
    h = _headers(token)

    client.put("/api/v1/onboarding/client/step1", json={"name": "내담자", "phone": None}, headers=h)
    client.put(
        "/api/v1/onboarding/client/step2",
        json={"gender": None, "birth_date": None, "concerns": ["우울"], "interests": ["명상"]},
        headers=h,
    )
    client.put(
        "/api/v1/onboarding/client/step3",
        json={"profile_image_url": None, "bio": None},
        headers=h,
    )

    res = client.post("/api/v1/onboarding/client/step4-match", json={"counselor_code": "ZZZZZZ"}, headers=h)
    assert res.status_code == 404

    res = client.post("/api/v1/onboarding/client/step4-match", json={"counselor_code": counselor_code}, headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["matched_counselor"]["counselor_code"] == counselor_code

    res = client.post("/api/v1/onboarding/client/complete", headers=h)
    assert res.status_code == 200, res.text
    assert res.json()["completed"] is True


def test_미인증_상담사_코드_매칭_시_403(client):
    code = _register_unverified_counselor(client, "co2@test.com")

    token = _register(client, "client", "cl2@test.com")
    h = _headers(token)
    client.put("/api/v1/onboarding/client/step1", json={"name": "내담자", "phone": None}, headers=h)

    res = client.post("/api/v1/onboarding/client/step4-match", json={"counselor_code": code}, headers=h)
    assert res.status_code == 403
