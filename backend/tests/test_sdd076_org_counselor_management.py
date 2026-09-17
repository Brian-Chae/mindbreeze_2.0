"""SDD-076 플랫폼 관리자 상담사 변경 계약."""
import pytest
from app.models.credential import VerificationAudit
from app.models.session import Session
from app.models.client_counselor_link import ClientCounselorLink
from app.models.counselor_profile import CounselorProfile
from tests.test_sdd074_admin_org_detail import org_data, headers


def change(client, org, user, admin, method="PATCH", **body):
    return client.request(method, f"/api/v1/admin/orgs/{org.id}/counselors/{user.id}",
                          headers=headers(admin) if admin else {}, json={"reason": " 운영 조정 ", **body})


def test_role_change_audit_and_existing_token_permissions(client, org_data):
    db, org, _, users = org_data
    target = users[2]
    r = change(client, org, target, users[0], role="org_admin")
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "org_admin"
    assert client.get(f"/api/v1/org/{org.id}/counselors", headers=headers(target)).status_code == 200
    r = change(client, org, target, users[0], role="counselor")
    assert r.status_code == 200
    assert client.get(f"/api/v1/org/{org.id}/counselors", headers=headers(target)).status_code == 403
    audits = db.query(VerificationAudit).all()
    assert len(audits) == 2
    audit = audits[0]
    assert audit.target_id == target.id and audit.admin_id == users[0].id
    assert audit.extra["org_id"] == str(org.id)
    assert audit.extra["before"] == {"org_id": str(org.id), "role": "counselor"}
    assert audit.extra["after"]["role"] == "org_admin"
    assert audit.reason == "운영 조정" and audit.created_at


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
@pytest.mark.parametrize("actor", [None, 1, 2, 3])
def test_permissions(client, org_data, method, actor):
    _, org, _, users = org_data
    r = change(client, org, users[2], users[actor] if actor is not None else None,
               method, **({"role": "org_admin"} if method == "PATCH" else {}))
    assert r.status_code == (401 if actor is None else 403)


@pytest.mark.parametrize("body", [{"role": "client"}, {"role": "platform_admin"}, {"role": "org_admin", "reason": " "}, {"role": "org_admin", "unknown": True}])
def test_invalid_input(client, org_data, body):
    _, org, _, users = org_data
    assert change(client, org, users[2], users[0], **body).status_code == 422


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
def test_membership_and_target_role(client, org_data, method):
    db, org, _, users = org_data
    body = {"role": "org_admin"} if method == "PATCH" else {}
    assert change(client, org, users[4], users[0], method, **body).status_code == 404
    assert change(client, org, users[3], users[0], method, **body).status_code == 422
    users[0].org_id = org.id
    db.commit()
    assert change(client, org, users[0], users[0], method, **body).status_code == 422
    assert db.query(VerificationAudit).count() == 0


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
def test_primary_and_owner_protected(client, org_data, method):
    db, org, other, users = org_data
    body = {"role": "counselor"} if method == "PATCH" else {}
    assert change(client, org, users[1], users[0], method, **body).status_code == 409
    body = {"role": "org_admin"} if method == "PATCH" else {}
    assert change(client, other, users[4], users[0], method, **body).status_code == 409
    assert db.query(VerificationAudit).count() == 0


@pytest.mark.parametrize("method", ["PATCH", "DELETE"])
@pytest.mark.parametrize("other_status", ["pending", "suspended", "active"])
def test_last_active_admin(client, org_data, method, other_status):
    db, org, _, users = org_data
    users[2].role, users[2].status = "org_admin", "active"
    users[1].status = other_status
    db.commit()
    body = {"role": "counselor"} if method == "PATCH" else {}
    r = change(client, org, users[2], users[0], method, **body)
    assert r.status_code == ((200 if method == "PATCH" else 204) if other_status == "active" else 409)


@pytest.mark.parametrize("state", ["ready", "scheduled", "in_progress", "paused"])
def test_active_sessions_block_removal(client, org_data, state):
    db, org, _, users = org_data
    db.add(Session(host_id=users[2].id, type="clinical", duration_min=30, status=state))
    db.commit()
    assert change(client, org, users[2], users[0], "DELETE").status_code == 409
    assert users[2].org_id == org.id and db.query(VerificationAudit).count() == 0


def test_active_link_blocks_removal(client, org_data):
    db, org, _, users = org_data
    db.add(ClientCounselorLink(client_id=users[3].id, counselor_id=users[2].id, status="active"))
    db.commit()
    assert change(client, org, users[2], users[0], "DELETE").status_code == 409


def test_removal_preserves_history_account_profile_and_demotes(client, org_data):
    db, org, _, users = org_data
    target = users[2]
    target.role = "org_admin"
    session = Session(host_id=target.id, type="clinical", duration_min=30, status="completed", organization_id=org.id, organization_attribution_known=True)
    link = ClientCounselorLink(client_id=users[3].id, counselor_id=target.id, status="ended")
    db.add_all([session, link]); db.commit()
    token = headers(target)
    assert change(client, org, target, users[0], "DELETE").status_code == 204
    db.refresh(target); db.refresh(session)
    assert target.org_id is None and target.role == "counselor" and target.status == "suspended"
    assert session.organization_id == org.id and session.organization_attribution_known
    assert db.query(CounselorProfile).filter_by(user_id=target.id).count() == 1
    assert db.query(ClientCounselorLink).count() == 1
    assert client.get(f"/api/v1/org/{org.id}/counselors", headers=token).status_code == 403
    audit = db.query(VerificationAudit).one()
    assert audit.extra["before"]["org_id"] == str(org.id)
    assert audit.extra["after"] == {"org_id": None, "role": "counselor"}
    assert change(client, org, target, users[0], "DELETE").status_code == 404


def test_session_rechecks_membership_after_waiting_for_org_lock(client, org_data, monkeypatch):
    from fastapi import HTTPException
    from app.services import org_management_service, session_service
    from app.schemas.session import SessionCreateRequest
    from app.models.user import User
    db, org, _, users = org_data
    original = org_management_service.require_active_org

    def detach_during_lock(org_id, session_db):
        locked = original(org_id, session_db)
        session_db.query(User).filter(User.id == users[2].id).update({User.org_id: None}, synchronize_session=False)
        return locked

    monkeypatch.setattr(org_management_service, "require_active_org", detach_during_lock)
    with pytest.raises(HTTPException) as error:
        session_service.create_session(str(users[2].id), SessionCreateRequest(type="clinical", duration_min=30), db)
    assert error.value.status_code == 409
    assert db.query(Session).count() == 0


def test_link_rechecks_membership_after_waiting_for_org_lock(client, org_data, monkeypatch):
    from fastapi import HTTPException
    from app.services import org_management_service, client_service
    from app.models.user import User
    db, org, _, users = org_data
    original = org_management_service.require_active_org

    def detach_during_lock(org_id, session_db):
        locked = original(org_id, session_db)
        session_db.query(User).filter(User.id == users[2].id).update({User.org_id: None}, synchronize_session=False)
        return locked

    monkeypatch.setattr(org_management_service, "require_active_org", detach_during_lock)
    with pytest.raises(HTTPException) as error:
        client_service.assign_counselor(users[3].id, users[2].id, db, create_room=False)
    assert error.value.status_code == 409
    assert db.query(ClientCounselorLink).count() == 0
