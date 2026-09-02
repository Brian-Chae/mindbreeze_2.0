"""SDD-019 — dev 전용 역할 시뮬레이션 로그인 테스트.

dev 라우터는 프로덕션 기본값에서는 app 에 include 되지 않으므로, 테스트에서는
동일 인메모리 DB(get_db override)를 쓰는 app 에 dev_auth.router 를 명시적으로
붙여 엔드포인트 동작을 검증한다.
"""

import pytest


def _ensure_dev_router():
    """app 에 dev_auth 라우터가 없으면 /api/v1 prefix 로 붙인다(중복 방지)."""
    from app.main import app
    from app.api.v1 import dev_auth

    paths = {getattr(r, "path", "") for r in app.router.routes}
    if "/api/v1/dev/auth/users" not in paths:
        app.include_router(dev_auth.router, prefix="/api/v1")


@pytest.fixture
def dev_client(client):
    _ensure_dev_router()
    return client


def _create(dev_client, **overrides):
    payload = {
        "name": "홍길동",
        "email": "sim1@dev.local",
        "role": "client",
    }
    payload.update(overrides)
    return dev_client.post("/api/v1/dev/auth/users", json=payload)


def test_prod_default_router_not_included():
    """기본(production/off) 설정에서는 dev 라우터가 v1 라우터에 포함되지 않는다."""
    import importlib

    from app.config import settings

    assert settings.environment == "production"
    assert settings.enable_dev_role_simulation is False

    v1 = importlib.import_module("app.api.v1")
    paths = {getattr(r, "path", "") for r in v1.router.routes}
    assert "/api/v1/dev/auth/users" not in paths


def test_create_platform_admin_forces_null_org(dev_client):
    r = _create(dev_client, email="pa@dev.local", role="platform_admin", org_id=None)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["role"] == "platform_admin"
    assert body["org_id"] is None
    assert body["auth_provider"] == "dev"
    assert body["onboarding_completed"] is True


def test_create_org_admin_autocreates_demo_org(dev_client):
    r = _create(dev_client, email="oa@dev.local", role="org_admin", org_id=None)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["role"] == "org_admin"
    assert body["org_id"] is not None
    assert body["org_name"] is not None


def test_create_counselor_autocreates_demo_org(dev_client):
    r = _create(dev_client, email="cs@dev.local", role="counselor", org_id=None)
    assert r.status_code == 201, r.text
    assert r.json()["org_id"] is not None


def test_create_client_null_org(dev_client):
    r = _create(dev_client, email="cl@dev.local", role="client")
    assert r.status_code == 201, r.text
    assert r.json()["org_id"] is None


def test_reject_admin_role(dev_client):
    r = _create(dev_client, email="x@dev.local", role="admin")
    assert r.status_code == 422


def test_duplicate_email_conflict(dev_client):
    assert _create(dev_client, email="dup@dev.local").status_code == 201
    r = _create(dev_client, email="dup@dev.local", name="다른사람")
    assert r.status_code == 409


def test_list_and_role_filter(dev_client):
    _create(dev_client, email="list-cl@dev.local", role="client")
    _create(dev_client, email="list-pa@dev.local", role="platform_admin")

    all_users = dev_client.get("/api/v1/dev/auth/users").json()["users"]
    assert len(all_users) >= 2

    only_pa = dev_client.get("/api/v1/dev/auth/users?role=platform_admin").json()["users"]
    assert all(u["role"] == "platform_admin" for u in only_pa)

    q = dev_client.get("/api/v1/dev/auth/users?q=list-cl").json()["users"]
    assert any(u["email"] == "list-cl@dev.local" for u in q)


def test_passwordless_login_returns_login_response(dev_client):
    created = _create(dev_client, email="login@dev.local", role="counselor").json()

    r = dev_client.post("/api/v1/dev/auth/login", json={"user_id": created["id"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"
    assert body["user"]["id"] == created["id"]
    assert body["user"]["role"] == "counselor"

    # 발급된 토큰이 기존 get_current_user 로 소비 가능한지 확인 (프로필 조회 성공)
    headers = {"Authorization": f"Bearer {body['access_token']}"}
    me = dev_client.get("/api/v1/auth/counselors/me/profile", headers=headers)
    assert me.status_code == 200


def test_login_unknown_user_404(dev_client):
    import uuid

    r = dev_client.post("/api/v1/dev/auth/login", json={"user_id": str(uuid.uuid4())})
    assert r.status_code == 404


def test_reset_fixtures_removes_only_dev_users(dev_client):
    _create(dev_client, email="reset1@dev.local", role="client")
    _create(dev_client, email="reset2@dev.local", role="org_admin")

    r = dev_client.post("/api/v1/dev/auth/reset-fixtures")
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] >= 2

    remaining = dev_client.get("/api/v1/dev/auth/users").json()["users"]
    assert remaining == []
