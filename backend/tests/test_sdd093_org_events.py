"""SDD-093 기관 알림 수신자와 표준 딥링크 계약."""
import uuid

import pytest

from app.core.database import get_db
from app.main import app
from app.models.organization import Organization
from app.models.user import User
from app.services import membership_service, notification_service, org_service, org_management_service, personal_office_service
from app.schemas.org import OrganizationPatch, OrganizationDeactivate, OrganizationReactivate


@pytest.fixture
def event_data(client, monkeypatch):
    db = next(app.dependency_overrides[get_db]())
    captured = []
    monkeypatch.setattr(notification_service, "notify_event", lambda event, uid, data, session: captured.append((event, uid, data)))
    org = Organization(name="기관", kind="institution", org_code="ABC123")
    db.add(org)
    users = [User(id=uuid.uuid4(), email=f"event-{i}@example.com", name=f"회원{i}", role=role, status="active", password_hash="hash") for i, role in enumerate(["platform_admin", "org_admin", "counselor", "counselor", "org_admin"])]
    db.add_all(users)
    db.flush()
    for user in users[1:3]:
        membership_service.add_membership(db, user, org.id, status_="active", role=user.role)
    membership_service.add_membership(db, users[4], org.id, status_="invited", role="org_admin")
    db.commit()
    yield db, org, users, captured
    db.close()


def test_join_request_and_result(event_data):
    db, org, users, events = event_data
    req = org_service.request_join(str(org.id), str(users[3].id), db)
    assert [(e, uid) for e, uid, _ in events] == [("organization_join_requested", users[1].id)]
    assert events[0][2]["extra"]["target_id"] == str(org.id)
    org_service.handle_join_request(str(req.id), str(org.id), str(users[1].id), "rejected", "비공개 사유", db)
    assert events[-1][0:2] == ("organization_join_result", users[3].id)
    assert events[-1][2]["extra"]["target_type"] == "notice"
    assert "비공개 사유" not in str(events[-1])


def test_org_changes_only_notify_active_members(event_data):
    db, org, users, events = event_data
    org_management_service.patch_organization(org.id, OrganizationPatch(name="변경 기관"), "1", users[0].id, db)
    assert [(e, uid) for e, uid, _ in events] == [("organization_updated", users[1].id)]
    assert events[0][2]["extra"]["params"]["changed_fields"] == ["name"]
    org_management_service.patch_organization(org.id, OrganizationPatch(name="변경 기관"), "2", users[0].id, db)
    assert len(events) == 1
    org_management_service.deactivate(org.id, OrganizationDeactivate(reason="중단", confirmation_value="ABC123"), "3", users[0].id, db)
    assert {uid for e, uid, _ in events if e == "organization_deactivated"} == {users[1].id, users[2].id}
    org_management_service.reactivate(org.id, OrganizationReactivate(reason="재개"), None, users[0].id, db)
    assert {uid for e, uid, _ in events if e == "organization_reactivated"} == {users[1].id, users[2].id}
    assert all(data["extra"]["target_type"] == "notice" for e, _, data in events if e != "organization_updated")


def test_role_change_and_noop(event_data):
    db, org, users, events = event_data
    for _ in range(2):
        org_service.update_counselor_role(str(org.id), str(users[2].id), "org_admin", str(users[1].id), db)
    assert [(e, uid) for e, uid, _ in events] == [("organization_role_changed", users[2].id)]
    assert events[0][2]["extra"]["target_type"] == "self_profile"


def test_platform_role_change(event_data):
    db, org, users, events = event_data
    org_management_service.change_counselor(org.id, users[2].id, users[0].id, "변경", db, role="org_admin")
    assert [(e, uid) for e, uid, _ in events] == [("organization_role_changed", users[2].id)]


def test_personal_office_once_and_fallback_suppressed(event_data):
    db, org, users, events = event_data
    personal_office_service.ensure_personal_office(db, users[2])
    db.commit()
    personal_office_service.notify_personal_office_opened(db, users[2])
    personal_office_service.ensure_personal_office(db, users[2])
    db.commit()
    assert [(e, uid) for e, uid, _ in events] == [("personal_office_opened", users[2].id)]
    assert events[0][2]["extra"]["target_type"] == "self_profile"
    personal_office_service.fallback_to_personal_office(db, users[3])
    db.commit()
    assert len(events) == 1


def test_actor_and_inactive_accounts_are_excluded(event_data):
    db, org, users, events = event_data
    org_management_service.patch_organization(org.id, OrganizationPatch(name="새 기관"), "1", users[1].id, db)
    assert events == []
    users[2].status = "suspended"
    db.commit()
    org_management_service.deactivate(org.id, OrganizationDeactivate(reason="중단", confirmation_value="ABC123"), "2", users[1].id, db)
    assert events == []


def test_invite_acceptance_emits_personal_office_opened(client, monkeypatch, redis):
    from tests.test_sdd079_multi_org_membership import _setup_active_counselor
    from tests.test_sdd081_personal_office import _notifications

    _, _, user_id = _setup_active_counselor(client, monkeypatch, redis, "notify93")
    notices = _notifications(user_id, "organization")
    opened = [n for n in notices if n.extra.get("event_type") == "personal_office_opened"]
    assert len(opened) == 1
    assert opened[0].extra["target_type"] == "self_profile"
    assert opened[0].extra["target_id"] is None


def test_individual_approval_emits_once_before_invite_acceptance(client, monkeypatch):
    from app.services import email_verify_service
    from tests.test_sdd017_counselor_invite import _capture_invites, _platform_admin
    from app.models.notification import Notification

    _capture_invites(monkeypatch)
    email = "personal-notify93@example.com"
    response = client.post("/api/v1/signup-applications/individual-counselor", json={
        "name": "개인상담사", "email": email,
        "email_verify_token": email_verify_service.generate_email_verify_token(email),
        "consents": {"tos": True, "privacy": True, "sensitive": True},
    })
    assert response.status_code == 201, response.text
    application_id = response.json()["application_id"]
    admin = _platform_admin(client, "admin-notify93@example.com")
    path = f"/api/v1/admin/signup-applications/{application_id}/approve"
    assert client.post(path, headers=admin["h"]).status_code == 200
    assert client.post(path, headers=admin["h"]).status_code == 409
    db = next(app.dependency_overrides[get_db]())
    try:
        user = db.query(User).filter(User.email == email).one()
        notices = db.query(Notification).filter(Notification.user_id == user.id).all()
        assert len([n for n in notices if n.extra.get("event_type") == "personal_office_opened"]) == 1
    finally:
        db.close()
