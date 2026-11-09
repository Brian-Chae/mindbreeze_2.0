"""SDD-321 — 기관 GET 조회는 기관 행 잠금(lock_organization / FOR UPDATE)을 쓰지 않는다.

SQLite 는 FOR UPDATE 를 컴파일에서 제거하므로, 잠금 함수 호출 자체를 금지하는 방식으로 검증한다.
"""
from app.services import org_management_service as oms
from tests.test_sdd074_admin_org_detail import org_data, headers  # noqa: F401


def _activate_admin(db, admin):
    from app.models.user_org_membership import UserOrgMembership
    admin.status = "active"
    m = db.query(UserOrgMembership).filter_by(user_id=admin.id).first()
    m.status = "active"
    db.commit()


def _forbid_lock(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("GET 경로에서 lock_organization 호출 금지")
    monkeypatch.setattr(oms, "lock_organization", boom)


def test_get_counselors_no_lock(client, org_data, monkeypatch):
    db, org, _, users = org_data
    _activate_admin(db, users[1])
    _forbid_lock(monkeypatch)
    r = client.get(f"/api/v1/org/{org.id}/counselors", headers=headers(users[1]))
    assert r.status_code == 200, r.text


def test_get_join_requests_no_lock(client, org_data, monkeypatch):
    db, org, _, users = org_data
    _activate_admin(db, users[1])
    _forbid_lock(monkeypatch)
    r = client.get(f"/api/v1/org/{org.id}/requests", headers=headers(users[1]))
    assert r.status_code == 200, r.text


def test_readonly_active_check_404_409_400(org_data):
    import uuid
    import pytest
    from fastapi import HTTPException
    from datetime import datetime, timezone
    db, org, _, _ = org_data
    assert oms.get_active_org_readonly(org.id, db).id == org.id
    with pytest.raises(HTTPException) as e:
        oms.get_active_org_readonly(uuid.uuid4(), db)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        oms.get_active_org_readonly("bad", db)
    assert e.value.status_code == 400
    org.deactivated_at = datetime.now(timezone.utc)
    db.flush()
    with pytest.raises(HTTPException) as e:
        oms.get_active_org_readonly(org.id, db)
    assert e.value.status_code == 409
