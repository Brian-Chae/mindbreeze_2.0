"""SDD-074 관리자 기관 조회의 권한·정보 최소화·소속 경계 검증."""
import uuid
from datetime import datetime, timezone

import pytest

from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.organization import Organization
from app.models.user import User
from app.models.user_org_membership import UserOrgMembership
from app.models.counselor_profile import CounselorProfile


@pytest.fixture
def org_data(client):
    db = next(app.dependency_overrides[get_db]())
    org = Organization(name="일반 센터", org_code="ORG001", address="서울", verified=True)
    other = Organization(name="개인 센터", org_code="ORG002", kind="individual")
    db.add_all([org, other])
    db.flush()
    users = []
    for i, (role, org_id, state) in enumerate([
        ("platform_admin", None, "active"), ("org_admin", org.id, "pending"),
        ("counselor", org.id, "suspended"), ("client", org.id, "active"),
        ("counselor", other.id, "active"),
    ]):
        user = User(name=f"사용자{i}", email=f"u{i}@test.com", password_hash="secret",
                    role=role, org_id=org_id, status=state, phone="010-1234-5678",
                    created_at=datetime(2026, 1, i + 1, tzinfo=timezone.utc))
        db.add(user)
        users.append(user)
    db.flush()
    # SDD-079: 프로덕션 백필 불변식과 동일하게 counselor/org_admin 소속은 membership 으로 존재
    for user in users:
        if user.org_id is not None and user.role in ("counselor", "org_admin"):
            db.add(UserOrgMembership(
                user_id=user.id, org_id=user.org_id, role=user.role,
                status="invited" if user.status == "pending" else "active",
                is_primary=user.status != "pending",
                joined_at=None if user.status == "pending" else user.created_at,
            ))
    db.flush()
    org.primary_admin_id = users[1].id
    other.owner_user_id = users[4].id
    db.add(CounselorProfile(user_id=users[2].id, counselor_code="ABC123"))
    db.commit()
    yield db, org, other, users
    db.close()


def headers(user):
    return {"Authorization": f"Bearer {create_access_token(subject=str(user.id))}"}


@pytest.mark.parametrize("suffix", ["", "/counselors"])
@pytest.mark.parametrize("actor", [None, 1, 2, 3])
def test_access_requires_platform_admin(client, org_data, suffix, actor):
    _, org, _, users = org_data
    response = client.get(f"/api/v1/admin/orgs/{org.id}{suffix}",
                          headers=headers(users[actor]) if actor is not None else {})
    assert response.status_code == (401 if actor is None else 403)


def test_detail_minimal_fields_and_nullable_references(client, org_data):
    _, org, other, users = org_data
    body = client.get(f"/api/v1/admin/orgs/{org.id}", headers=headers(users[0])).json()
    assert body["address"] == "서울"
    assert body["kind"] == "institution"
    assert body["version"] == 1
    assert body["owner"] is None
    assert set(body["primary_admin"]) == {"id", "name", "email", "phone", "role", "status"}
    assert body["primary_admin"]["id"] == str(users[1].id)
    assert set(body) == {"id", "name", "org_code", "phone", "address", "verified", "verified_at",
                         "kind", "created_at", "version", "primary_admin", "owner", "has_primary_admin", "deactivated_at"}
    body = client.get(f"/api/v1/admin/orgs/{other.id}", headers=headers(users[0])).json()
    assert body["primary_admin"] is None
    assert body["owner"]["id"] == str(users[4].id)


def test_membership_codes_and_sorting(client, org_data):
    _, org, other, users = org_data
    response = client.get(f"/api/v1/admin/orgs/{org.id}/counselors", headers=headers(users[0]))
    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [str(users[1].id), str(users[2].id)]
    assert body[0]["counselor_code"] is None
    assert body[0]["is_primary_admin"] is True
    assert body[1]["counselor_code"] == "ABC123"
    assert body[1]["status"] == "suspended"
    assert set(body[0]) == {"id", "name", "email", "counselor_code", "role", "status", "is_primary_admin", "is_owner"}
    owner = client.get(f"/api/v1/admin/orgs/{other.id}/counselors", headers=headers(users[0])).json()
    assert owner[0]["is_owner"] is True
    assert client.get(f"/api/v1/org/{org.id}/counselors", headers=headers(users[0])).status_code == 403


@pytest.mark.parametrize("suffix", ["", "/counselors"])
def test_missing_invalid_and_empty(client, org_data, suffix):
    db, org, _, users = org_data
    auth = headers(users[0])
    assert client.get(f"/api/v1/admin/orgs/{uuid.uuid4()}{suffix}", headers=auth).status_code == 404
    assert client.get(f"/api/v1/admin/orgs/bad-id{suffix}", headers=auth).status_code == 422
    if suffix:
        for user in users[1:]:
            user.org_id = None
        db.commit()
        assert client.get(f"/api/v1/admin/orgs/{org.id}{suffix}", headers=auth).json() == []


def test_list_remains_array_with_kind_and_admin_presence(client, org_data):
    _, org, other, users = org_data
    body = client.get("/api/v1/admin/orgs", headers=headers(users[0])).json()
    rows = {item["id"]: item for item in body}
    assert rows[str(org.id)]["has_primary_admin"] is True
    assert rows[str(org.id)]["kind"] == "institution"
    # SDD-081: 개인 상담소(kind=individual)는 기관 관리 목록에서 숨긴다
    assert str(other.id) not in rows
