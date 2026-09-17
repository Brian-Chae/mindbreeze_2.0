"""SDD-075 기관 변경 계약과 운영 중단 경계."""
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.models.credential import VerificationAudit
from app.models.session import Session
from app.models.client_counselor_link import ClientCounselorLink
from app.services import org_service, session_service
from app.schemas.session import SessionCreateRequest
from tests.test_sdd074_admin_org_detail import org_data, headers


def endpoint(org, suffix=""):
    return f"/api/v1/admin/orgs/{org.id}{suffix}"


def auth(users, version=1):
    return {**headers(users[0]), "If-Match": f'"{version}"'}


def test_patch_audit_and_conflict(client, org_data):
    db, org, _, users = org_data
    r = client.patch(endpoint(org), headers=auth(users), json={"name": " 새 이름 ", "phone": None})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "새 이름"
    assert r.json()["address"] == "서울"
    assert r.json()["phone"] is None
    assert r.json()["version"] == 2
    audit = db.query(VerificationAudit).one()
    assert audit.admin_id == users[0].id and audit.target_id == org.id
    assert audit.extra["before"]["name"] == "일반 센터"
    assert audit.extra["after"]["name"] == "새 이름"
    assert client.patch(endpoint(org), headers=auth(users), json={"name": "덮어쓰기"}).status_code == 412
    assert db.query(VerificationAudit).count() == 1


@pytest.mark.parametrize("body", [{"name": None}, {"name": "  "}, {"name": ""}, {"name": "a"*201}, {"phone": "1"*21}, {"address": "a"*301}, {"verified": None}, {"org_code": "OTHER1"}])
def test_patch_validation(client, org_data, body):
    _, org, _, users = org_data
    assert client.patch(endpoint(org), headers=auth(users), json=body).status_code == 422


def test_verification_reason_and_timestamp(client, org_data):
    db, org, _, users = org_data
    assert client.patch(endpoint(org), headers=auth(users), json={"verified": False}).status_code == 422
    r = client.patch(endpoint(org), headers=auth(users), json={"verified": False, "reason": "수동 확인"})
    assert r.status_code == 200
    assert r.json()["verified_at"] is None
    r = client.patch(endpoint(org), headers=auth(users, 2), json={"verified": True, "reason": "재확인"})
    assert r.status_code == 200
    verified_at = r.json()["verified_at"]
    assert verified_at
    r = client.patch(endpoint(org), headers=auth(users, 3), json={"verified": True})
    assert r.json()["verified_at"] == verified_at
    r = client.patch(endpoint(org), headers=auth(users, 4), json={"verified": False, "reason": "철회"})
    assert r.json()["verified_at"] is None
    audit = db.query(VerificationAudit).filter(VerificationAudit.reason == "철회").one()
    assert audit.extra["before"]["verified_at"] == verified_at


def test_preconditions_and_permissions(client, org_data):
    _, org, _, users = org_data
    assert client.patch(endpoint(org), headers=headers(users[0]), json={"name": "a"}).status_code == 428
    assert client.patch(endpoint(org), headers={**headers(users[0]), "If-Match": "*"}, json={"name": "a"}).status_code == 422
    for method, suffix, body in [("patch", "", {"name": "a"}), ("post", "/deactivate", {"reason": "종료", "confirmation_value": org.org_code}), ("post", "/reactivate", {"reason": "재개"})]:
        assert getattr(client, method)(endpoint(org, suffix), headers=headers(users[1]), json=body).status_code == 403
    assert client.get(endpoint(org, "/deactivation-impact"), headers=headers(users[1])).status_code == 403


def test_lifecycle_preserves_data_and_filters(client, org_data):
    db, org, _, users = org_data
    count = len(users)
    impact = client.get(endpoint(org, "/deactivation-impact"), headers=auth(users))
    assert impact.status_code == 200
    assert impact.json()["account_count"] == 3
    assert impact.json()["can_deactivate"] is True
    payload = {"reason": "운영 종료", "confirmation_value": org.org_code}
    assert client.post(endpoint(org, "/deactivate"), headers=auth(users), json={**payload, "confirmation_value": "wrong"}).status_code == 422
    r = client.post(endpoint(org, "/deactivate"), headers=auth(users), json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["deactivated_at"] and r.json()["version"] == 2
    assert client.post(endpoint(org, "/deactivate"), headers=auth(users, 2), json=payload).status_code == 200
    assert db.query(VerificationAudit).count() == 1
    active = client.get("/api/v1/admin/orgs", headers=auth(users)).json()
    assert str(org.id) not in {o["id"] for o in active}
    inactive = client.get("/api/v1/admin/orgs?status=inactive", headers=auth(users)).json()
    assert [o["id"] for o in inactive] == [str(org.id)]
    assert client.patch(endpoint(org), headers=auth(users, 2), json={"name": "x"}).status_code == 409
    db.expire_all()
    assert org_service.get_organization_by_code(org.org_code, db) is None
    assert org_service.search_organizations(org.name, None, db) == []
    assert len(db.query(type(users[0])).all()) == count
    assert users[1].org_id == org.id and users[1].status == "pending"
    r = client.post(endpoint(org, "/reactivate"), headers=auth(users, 2), json={"reason": "운영 재개"})
    assert r.status_code == 200 and r.json()["deactivated_at"] is None
    assert r.json()["version"] == 3
    assert db.query(VerificationAudit).count() == 2


@pytest.mark.parametrize("state", ["ready", "scheduled", "in_progress", "paused", "completed"])
def test_legacy_session_blocks_conservatively(client, org_data, state):
    db, org, _, users = org_data
    db.add(Session(host_id=users[2].id, type="clinical", duration_min=30, status=state))
    db.commit()
    body = client.get(endpoint(org, "/deactivation-impact"), headers=auth(users)).json()
    assert body["can_deactivate"] is False
    assert body["unknown_attribution_count"] == 1
    r = client.post(endpoint(org, "/deactivate"), headers=auth(users), json={"reason": "종료", "confirmation_value": org.org_code})
    assert r.status_code == 409
    assert db.query(Session).count() == 1


def test_individual_and_active_link_block(client, org_data):
    db, org, other, users = org_data
    assert client.get(endpoint(other, "/deactivation-impact"), headers=auth(users)).json()["can_deactivate"] is False
    db.add(ClientCounselorLink(client_id=users[3].id, counselor_id=users[2].id))
    db.commit()
    body = client.get(endpoint(org, "/deactivation-impact"), headers=auth(users)).json()
    assert body["active_link_count"] == 1 and not body["can_deactivate"]


def test_new_session_snapshot_and_inactive_guard(client, org_data):
    db, org, _, users = org_data
    created = session_service.create_session(str(users[2].id), SessionCreateRequest(type="clinical", duration_min=30), db)
    session = db.get(Session, uuid.UUID(created["id"]))
    assert session.organization_id == org.id
    session.status = "completed"
    db.commit()
    assert client.post(endpoint(org, "/deactivate"), headers=auth(users), json={"reason": "종료", "confirmation_value": org.org_code}).status_code == 200
    db.expire_all()
    with pytest.raises(HTTPException) as error:
        session_service.create_session(str(users[2].id), SessionCreateRequest(type="clinical", duration_min=30), db)
    assert error.value.status_code == 409
    assert db.query(Session).count() == 1


def test_inactive_entry_points(client, org_data, redis):
    import asyncio
    from app.services import org_invite_service, client_service
    db, org, _, users = org_data
    token = asyncio.run(org_invite_service._issue(users[1], redis, token_type="org_admin_invite")).split("token=", 1)[1]
    org.deactivated_at = datetime.now(timezone.utc)
    db.commit()
    assert client.post(endpoint(org, "/resend-invite"), headers=auth(users)).status_code == 409
    assert client.post(f"/api/v1/org/{org.id}/counselors/invite", headers=headers(users[1]), json={"name": "새 상담사", "email": "new@example.com"}).status_code == 409
    assert client.get(f"/api/v1/org/{org.id}/counselors", headers=headers(users[1])).status_code == 409
    with pytest.raises(HTTPException) as error:
        asyncio.run(org_invite_service.consume_invite(token, "ValidPass123!", db, redis))
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        client_service.assign_counselor(users[3].id, users[2].id, db)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        org_service.request_join(str(org.id), str(users[4].id), db)
    assert error.value.status_code == 409


def test_unattributed_session_scoped_to_org_members(client, org_data):
    db, org, other, users = org_data
    # 타 기관 소속자(users[4])의 미확정 세션은 이 기관 비활성화를 차단하지 않는다.
    db.add(Session(host_id=users[4].id, type="clinical", duration_min=30, status="completed"))
    db.commit()
    body = client.get(endpoint(org, "/deactivation-impact"), headers=auth(users)).json()
    assert body["can_deactivate"] is True
    assert body["unknown_attribution_count"] == 0

    # 이 기관 소속자(users[2])의 미확정 세션은 차단한다.
    db.add(Session(host_id=users[2].id, type="clinical", duration_min=30, status="completed"))
    db.commit()
    body = client.get(endpoint(org, "/deactivation-impact"), headers=auth(users)).json()
    assert not body["can_deactivate"]
    assert body["unknown_attribution_count"] == 1


def test_invite_rejected_before_password_change(client, org_data, redis):
    import asyncio
    from app.services import org_invite_service
    db, org, _, users = org_data
    token = asyncio.run(org_invite_service._issue(users[1], redis, token_type="org_admin_invite")).split("token=", 1)[1]
    org.deactivated_at = datetime.now(timezone.utc)
    db.commit()
    old_hash = users[1].password_hash
    with pytest.raises(HTTPException) as error:
        asyncio.run(org_invite_service.consume_invite(token, "ValidPass123!", db, redis))
    assert error.value.status_code == 409
    db.expire_all()
    assert users[1].password_hash == old_hash and users[1].status == "pending"


@pytest.mark.parametrize("state", ["ready", "scheduled", "in_progress", "paused"])
def test_known_session_snapshot_blocks_even_after_host_moves(client, org_data, state):
    db, org, other, users = org_data
    db.add(Session(host_id=users[2].id, type="clinical", duration_min=30, status=state,
                   organization_id=org.id, organization_attribution_known=True))
    users[2].org_id = other.id
    db.commit()
    body = client.get(endpoint(org, "/deactivation-impact"), headers=auth(users)).json()
    assert body["unknown_attribution_count"] == 0
    assert body["scheduled_session_count"] + body["ongoing_session_count"] == 1
    assert not body["can_deactivate"]
    assert client.post(endpoint(org, "/deactivate"), headers=auth(users), json={"reason": "종료", "confirmation_value": org.org_code}).status_code == 409


def test_impact_is_rechecked_and_reactivation_requires_reason(client, org_data):
    db, org, _, users = org_data
    assert client.get(endpoint(org, "/deactivation-impact"), headers=auth(users)).json()["can_deactivate"]
    db.add(ClientCounselorLink(client_id=users[3].id, counselor_id=users[2].id))
    db.commit()
    assert client.post(endpoint(org, "/deactivate"), headers=auth(users), json={"reason": "종료", "confirmation_value": org.org_code}).status_code == 409
    assert client.post(endpoint(org, "/reactivate"), headers=auth(users), json={"reason": "  "}).status_code == 422
    assert db.query(VerificationAudit).count() == 0
