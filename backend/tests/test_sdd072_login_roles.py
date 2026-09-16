"""SDD-072: 역할 검증이 토큰 발급과 계정 변경보다 먼저 일어난다."""
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from app.core.database import get_db
from app.main import app
from app.models.user import User
from tests.test_auth_login import _register, VALID_PASSWORD


def _db():
    return next(app.dependency_overrides[get_db]())


def _google(email):
    response = MagicMock(status_code=200)
    response.json.return_value = {"email": email, "name": "테스트"}
    return patch("httpx.AsyncClient.get", AsyncMock(return_value=response))


@pytest.mark.parametrize("role", ["counselor", "org_admin", "platform_admin"])
def test_email_role_mismatch_does_not_issue_tokens(client, role):
    _register(client)
    with patch("app.api.v1.auth.create_access_token", return_value="unexpected") as access, patch(
        "app.api.v1.auth.refresh_token_service.issue_refresh_token", return_value="unexpected"
    ) as refresh:
        response = client.post("/api/v1/auth/login", json={
            "email": "user@test.com", "password": VALID_PASSWORD, "role": role,
        })
        assert response.status_code == 403
        assert "선택한 로그인 유형" in response.json()["detail"]
        access.assert_not_called()
        refresh.assert_not_called()


@pytest.mark.parametrize("role", [None, "client", "counselor", "org_admin"])
def test_email_matching_role_and_legacy_request(client, role):
    _register(client)
    with _db() as db:
        user = db.query(User).filter_by(email="user@test.com").one()
        user.role = role or "client"
        db.commit()
    payload = {"email": "user@test.com", "password": VALID_PASSWORD}
    if role:
        payload["role"] = role
    response = client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 200
    assert response.json()["user"]["role"] == (role or "client")


@pytest.mark.parametrize("role", ["counselor", "org_admin"])
def test_new_google_staff_account_is_not_created(client, role):
    with _google("new@test.com"):
        response = client.post("/api/v1/auth/google", json={"access_token": "valid", "role": role})
    assert response.status_code == 403
    with _db() as db:
        assert db.query(User).filter_by(email="new@test.com").first() is None


@pytest.mark.parametrize("actual,requested", [("client", "counselor"), ("client", "org_admin"), ("counselor", "client"), ("platform_admin", "client")])
def test_google_mismatch_does_not_link_or_issue_tokens(client, actual, requested):
    _register(client)
    with _db() as db:
        user = db.query(User).filter_by(email="user@test.com").one()
        user.role = actual
        db.commit()
    with _google("user@test.com"), patch("app.api.v1.auth.create_access_token", return_value="unexpected") as access, patch(
        "app.api.v1.auth.refresh_token_service.issue_refresh_token", return_value="unexpected"
    ) as refresh:
        response = client.post("/api/v1/auth/google", json={"access_token": "valid", "role": requested})
        assert response.status_code == 403
        access.assert_not_called()
        refresh.assert_not_called()
    with _db() as db:
        user = db.query(User).filter_by(email="user@test.com").one()
        assert user.role == actual
        assert user.auth_provider == "email"


@pytest.mark.parametrize("role", ["client", "counselor", "org_admin"])
def test_existing_google_matching_role_preserves_permissions(client, role):
    _register(client, email="member@looxidlabs.com")
    with _db() as db:
        user = db.query(User).filter_by(email="member@looxidlabs.com").one()
        user.role = role
        db.commit()
    with _google("member@looxidlabs.com"):
        response = client.post("/api/v1/auth/google", json={"access_token": "valid", "role": role})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == role
    assert response.json()["access_token"]


def test_explicit_admin_request_preserves_domain_approval_policy(client):
    _register(client, email="member@looxidlabs.com")
    with _google("member@looxidlabs.com"):
        response = client.post("/api/v1/auth/google", json={"access_token": "valid", "role": "platform_admin"})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "platform_admin"
