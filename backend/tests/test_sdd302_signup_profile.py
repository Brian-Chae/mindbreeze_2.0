"""SDD-302 실제 필수정보 판정 및 선택 프로필 보류 계약."""
from datetime import date

import pytest

from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.main import app
from app.models.client_profile import ClientProfile
from app.models.onboarding_progress import OnboardingProgress
from app.models.user import User
from tests.sdd220_helpers import email_register_payload, consents
from tests.test_sdd072_login_roles import _google

STRICT = {"X-Test-Strict-Signup": "1"}


def seed_user(*, provider="email", completed=False, missing=False, role="client", birth_source="user"):
    with next(app.dependency_overrides[get_db]()) as db:
        user = User(email="profile@example.com", password_hash=hash_password("Passw0rd!"),
                    name="  " if missing else "회원", role=role, auth_provider=provider,
                    verified_tier="email", birth_date=None if missing or birth_source == "profile" else date(1990, 5, 1))
        db.add(user)
        db.flush()
        if not missing and role == "client":
            db.add(ClientProfile(user_id=user.id, gender="female",
                                 birth_date=date(1990, 5, 1) if birth_source == "profile" else None))
        db.add(OnboardingProgress(user_id=user.id, current_step=2, completed=completed,
                                  steps={"step2": {"concerns": ["합성 항목"]}}))
        db.commit()
        return {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"}


@pytest.mark.parametrize("provider", ["email", "google", "apple"])
@pytest.mark.parametrize("completed", [False, True])
@pytest.mark.parametrize("missing", [False, True])
def test_본인조회는_공급자와_완료플래그보다_실제필수정보를_판정(client, provider, completed, missing):
    headers = seed_user(provider=provider, completed=completed, missing=missing)
    response = client.get("/api/v1/auth/users/me", headers=headers)
    assert response.status_code == 200
    user = response.json()
    assert user["client_required_fields"] == (["name", "gender", "birth_date"] if missing else [])
    assert user["phone"] is None
    assert user["profile_prompt_dismissed"] is False
    assert user["onboarding_completed"] is completed
    assert user["gender"] == (None if missing else "female")
    assert user["birth_date"] == (None if missing else "1990-05-01")


def test_과거프로필에만_있는_생일도_인정(client):
    headers = seed_user(birth_source="profile")
    response = client.get("/api/v1/auth/users/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["client_required_fields"] == []
    assert response.json()["birth_date"] == "1990-05-01"


@pytest.mark.parametrize("provider", ["email", "google", "apple"])
def test_필수충족시_전화번호와_옛단계없이_완료(client, provider):
    headers = seed_user(provider=provider)
    response = client.post("/api/v1/onboarding/client/complete", headers=headers)
    assert response.status_code == 200
    assert response.json()["completed"] is True


@pytest.mark.parametrize("provider", ["email", "google", "apple"])
def test_필수누락시_공급자무관_완료거부(client, provider):
    headers = seed_user(provider=provider, missing=True)
    response = client.post("/api/v1/onboarding/client/complete", headers=headers)
    assert response.status_code == 400
    assert response.json()["detail"]["required_fields"] == ["name", "gender", "birth_date"]


@pytest.mark.parametrize("role", ["counselor", "org_admin", "platform_admin"])
def test_다른역할_회원완료와_보류_금지(client, role):
    headers = seed_user(role=role)
    for endpoint in ("complete", "profile-dismiss"):
        response = client.post(f"/api/v1/onboarding/client/{endpoint}", headers=headers)
        assert response.status_code == 403
    assert client.get("/api/v1/auth/users/me", headers=headers).json()["client_required_fields"] == []


def test_보류는_멱등이며_단계와_필수누락과_완료상태_보존(client):
    headers = seed_user(missing=True)
    for _ in range(2):
        response = client.post("/api/v1/onboarding/client/profile-dismiss", headers=headers)
        assert response.status_code == 200
        assert response.json()["profile_prompt_dismissed"] is True
    with next(app.dependency_overrides[get_db]()) as db:
        progress = db.query(OnboardingProgress).one()
        assert progress.steps == {"step2": {"concerns": ["합성 항목"]}, "profile_prompt_dismissed": True}
        assert progress.current_step == 2
        assert progress.completed is False
    # 새 로그인 응답에서도 서버 보류/실제 누락 판정 유지
    response = client.post("/api/v1/auth/login", json={"email": "profile@example.com", "password": "Passw0rd!"})
    assert response.status_code == 200
    assert response.json()["user"]["profile_prompt_dismissed"] is True
    assert response.json()["user"]["client_required_fields"] == ["name", "gender", "birth_date"]


@pytest.mark.parametrize("path", ["/api/v1/auth/register/client", "/api/v1/auth/register"])
def test_신규이메일은_성별누락시_가입행없이_명시오류(client, path):
    response = client.post(path, json={k: v for k, v in email_register_payload("new@example.com", role="client").items() if k != "gender"}, headers=STRICT)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "GENDER_REQUIRED"
    with next(app.dependency_overrides[get_db]()) as db:
        assert db.query(User).count() == 0


def test_신규이메일_성별저장_전화없이_필수충족(client):
    response = client.post("/api/v1/auth/register/client", json=email_register_payload("new@example.com", gender="other"), headers=STRICT)
    assert response.status_code == 201
    assert response.json()["user"]["gender"] == "other"
    assert response.json()["user"]["client_required_fields"] == []


def test_구글_신규성별요구_재시도저장_기존로그인에는_요구안함(client):
    body = {"access_token": "valid", "consents": consents(), "birth_date": "1990-05-01"}
    with _google("new@example.com"):
        response = client.post("/api/v1/auth/google", json=body, headers=STRICT)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "GENDER_REQUIRED"
        response = client.post("/api/v1/auth/google", json={**body, "gender": "female"}, headers=STRICT)
        assert response.status_code == 200
        assert response.json()["user"]["client_required_fields"] == []
        response = client.post("/api/v1/auth/google", json={"access_token": "valid"}, headers=STRICT)
        assert response.status_code == 200
        assert response.json()["user"]["gender"] == "female"


def test_patch_후_응답과_재조회가_실제필수필드를_갱신(client):
    headers = seed_user(missing=True)
    response = client.patch("/api/v1/auth/users/me", headers=headers,
                            json={"name": "회원", "gender": "male", "birth_date": "1990-05-01"})
    assert response.status_code == 200
    assert response.json()["client_required_fields"] == []
    assert client.get("/api/v1/auth/users/me", headers=headers).json()["client_required_fields"] == []


def test_구글_신규확인이름_저장_재로그인에는_기존이름보존(client):
    with _google("new@example.com"):
        response = client.post("/api/v1/auth/google", headers=STRICT, json={
            "access_token": "valid", "consents": consents(), "birth_date": "1990-05-01",
            "gender": "female", "name": "  확인한 이름  ",
        })
        assert response.status_code == 200
        assert response.json()["user"]["name"] == "확인한 이름"
        response = client.post("/api/v1/auth/google", headers=STRICT,
                               json={"access_token": "valid", "name": "덮어쓰기 시도"})
        assert response.status_code == 200
        assert response.json()["user"]["name"] == "확인한 이름"


def test_과거_상세프로필에서_수정한_생일을_본인응답에_반영(client):
    headers = seed_user()
    with next(app.dependency_overrides[get_db]()) as db:
        db.query(ClientProfile).one().birth_date = date(1992, 7, 3)
        db.commit()
    response = client.get("/api/v1/auth/users/me", headers=headers)
    assert response.status_code == 200
    assert response.json()["birth_date"] == "1992-07-03"
