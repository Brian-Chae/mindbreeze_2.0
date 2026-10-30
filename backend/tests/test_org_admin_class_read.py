"""기관관리자: 자기 기관 명상 클래스 회차 열람(기록지) 허용, 타 기관·쓰기 계열은 403"""

import pytest
from fastapi import HTTPException

from app.services.session_authz import SessionAction, get_session_authorized


def _db():
    from app.core.database import SessionLocal

    return SessionLocal()


@pytest.fixture
def world(client):
    from app.models.class_program import Class
    from app.models.organization import Organization
    from app.models.session import Session
    from app.models.user import User
    from app.services import membership_service

    db = _db()
    try:
        org_a = Organization(name="A 기관", org_code="OAR1")
        org_b = Organization(name="B 기관", org_code="OAR2")
        db.add_all([org_a, org_b])
        db.flush()

        def _user(email, role, org):
            u = User(
                email=email, password_hash="!", name=email.split("@")[0], role=role,
                status="active", verified_tier="email", org_id=org.id,
            )
            db.add(u)
            db.flush()
            membership_service.add_membership(db, u, org.id, status_="active", role=role)
            return u

        host = _user("oar-host@test.com", "counselor", org_a)
        admin_a = _user("oar-admin-a@test.com", "org_admin", org_a)
        admin_b = _user("oar-admin-b@test.com", "org_admin", org_b)
        cls = Class(
            organization_id=org_a.id, organization_attribution_known=True,
            created_by=host.id, title="명상", default_duration_min=30,
        )
        db.add(cls)
        db.flush()
        s = Session(
            type="meditation", status="in_progress", host_id=host.id, organization_id=org_a.id,
            class_id=cls.id, duration_min=30, title="회차", participant_mode="group",
            max_participants=5,
        )
        db.add(s)
        db.commit()
        return {"sid": str(s.id), "admin_a": str(admin_a.id), "admin_b": str(admin_b.id)}
    finally:
        db.close()


@pytest.mark.parametrize(
    "action",
    [
        SessionAction.RECORD_VIEW,
        SessionAction.SESSION_VIEW,
        SessionAction.TRANSCRIPT_VIEW,
        SessionAction.REPORT_STATUS_VIEW,
    ],
)
def test_자기기관_관리자는_열람_허용_타기관은_403(world, action):
    db = _db()
    try:
        assert get_session_authorized(db, world["sid"], world["admin_a"], action) is not None
        with pytest.raises(HTTPException) as e:
            get_session_authorized(db, world["sid"], world["admin_b"], action)
        assert e.value.status_code == 403
    finally:
        db.close()


@pytest.mark.parametrize(
    "action",
    [SessionAction.RECORD_UPDATE, SessionAction.LIVEKIT_TOKEN_ISSUE, SessionAction.SESSION_UPDATE],
)
def test_자기기관_관리자도_쓰기_호스트전용은_403(world, action):
    db = _db()
    try:
        with pytest.raises(HTTPException) as e:
            get_session_authorized(db, world["sid"], world["admin_a"], action)
        assert e.value.status_code == 403
    finally:
        db.close()


def test_기록지_API_관리자는_전사원문_없이_200(client, world):
    from app.core.security import create_access_token

    h = {"Authorization": f"Bearer {create_access_token(subject=world['admin_a'])}"}
    r = client.get(f"/api/v1/sessions/{world['sid']}/record", headers=h)
    assert r.status_code == 200, r.text
    assert r.json().get("transcript") in (None, "")
    hb = {"Authorization": f"Bearer {create_access_token(subject=world['admin_b'])}"}
    assert client.get(f"/api/v1/sessions/{world['sid']}/record", headers=hb).status_code == 403
