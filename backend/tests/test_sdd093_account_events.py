"""SDD-093 검증·계정·프로필 알림 계약."""
import pytest

from app.models.credential import Credential
from app.models.notification import Notification
from app.schemas.counselor_info import CounselorInfoUpdate, PrimaryAdminProfilePatch
from app.services import admin_service, counselor_info_service, credential_service
from tests.test_sdd074_admin_org_detail import org_data


@pytest.fixture(autouse=True)
def mute_email(monkeypatch):
    monkeypatch.setattr("app.services.notification_service.send_email_notification", lambda *args: None)


@pytest.mark.parametrize("route", ["credential", "admin"])
def test_verification_final_changes_have_standard_extra(org_data, route):
    db, _, _, users = org_data
    owner = users[4]
    cred = Credential(user_id=owner.id, type="license", s3_key="test", status="pending")
    db.add(cred)
    db.commit()
    def review(result):
        if route == "credential":
            credential_service.admin_verify(cred.id, result, None, db)
        else:
            admin_service.process_review("credential", cred.id, {"approved": "approve", "rejected": "reject"}[result], None, users[0].id, db)
    review("approved")
    review("approved")
    review("rejected")
    notifications = db.query(Notification).filter_by(user_id=owner.id).all()
    assert len(notifications) == 2
    assert [n.extra["params"]["result"] for n in notifications] == ["approved", "rejected"]
    for n in notifications:
        assert n.type == "verification"
        assert n.extra["target_type"] == "credentials" and n.extra["target_id"] is None
        assert n.extra["params"]["credential_id"] == str(cred.id)


def test_account_events_only_on_changes_and_exclude_actor(org_data):
    db, _, _, users = org_data
    owner = users[4]
    admin_service.suspend_user(owner.id, "민감한 사유", users[0].id, db)
    admin_service.suspend_user(owner.id, "민감한 사유", users[0].id, db)
    admin_service.unsuspend_user(owner.id, users[0].id, db)
    admin_service.unsuspend_user(owner.id, users[0].id, db)
    notifications = db.query(Notification).filter_by(user_id=owner.id).all()
    assert [n.extra["event_type"] for n in notifications] == ["account_suspended", "account_reactivated"]
    assert all(n.extra["target_type"] == "notice" and n.extra["target_id"] is None for n in notifications)
    assert all("민감한 사유" not in n.body for n in notifications)
    admin_service.suspend_user(owner.id, "사유", owner.id, db)
    assert db.query(Notification).count() == 2


@pytest.mark.parametrize("primary", [False, True])
def test_profile_events_respect_preferences_and_standard_extra(org_data, primary):
    db, org, _, users = org_data
    owner = users[1] if primary else users[4]
    event = "primary_admin_profile_updated" if primary else "counselor_profile_updated"
    def change(name, actor):
        if primary:
            counselor_info_service.update_primary_admin_profile(org.id, PrimaryAdminProfilePatch(name=name, reason="정정"), db, actor_id=actor)
        else:
            counselor_info_service.update_profile(owner, CounselorInfoUpdate(name=name, reason="정정"), db, actor_id=actor, actor_kind="platform_admin")
    change("첫 변경", users[0].id)
    n = db.query(Notification).filter_by(user_id=owner.id).one()
    assert n.extra["event_type"] == event
    assert n.extra["target_type"] == "self_profile" and n.extra["target_id"] is None
    assert n.extra["changed_fields"] == ["name"]
    owner.notification_preferences = {"in_app": {event: False}, "email": {event: False}}
    db.commit()
    change("두 번째 변경", users[0].id)
    assert db.query(Notification).count() == 1
    owner.notification_preferences = {"in_app": {event: True}}
    db.commit()
    change("본인 변경", owner.id)
    assert db.query(Notification).count() == 1


@pytest.mark.parametrize("route", ["credential", "admin"])
def test_verification_does_not_notify_reviewer_of_own_credential(org_data, route):
    db, _, _, users = org_data
    owner = users[0]
    cred = Credential(user_id=owner.id, type="license", s3_key="test", status="pending")
    db.add(cred)
    db.commit()
    if route == "credential":
        credential_service.admin_verify(cred.id, "approved", None, db, admin_id=owner.id)
    else:
        admin_service.process_review("credential", cred.id, "approve", None, owner.id, db)
    assert db.query(Notification).count() == 0


@pytest.mark.parametrize("actor", [None, 0, 4])
def test_legacy_credential_api_excludes_authenticated_owner(client, org_data, actor):
    from tests.test_sdd074_admin_org_detail import headers

    db, _, _, users = org_data
    owner = users[4]
    cred = Credential(user_id=owner.id, type="license", s3_key="test", status="pending")
    db.add(cred)
    db.commit()
    response = client.put(
        f"/api/v1/credentials/admin/{cred.id}",
        json={"status": "approved"},
        headers=headers(users[actor]) if actor is not None else {},
    )
    # SDD-136: 증빙 승인은 플랫폼 관리자 전용 — 무인증 401, 비관리자 403.
    if actor is None:
        assert response.status_code == 401
    elif actor != 0:
        assert response.status_code == 403
    else:
        assert response.status_code == 200
        assert response.json()["status"] == "approved"
