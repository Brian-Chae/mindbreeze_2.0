"""V-24: 실제 계정 서비스 경로의 명상 보존·재배정 연결."""

from datetime import datetime, timezone
import pytest
from app.models.session import Session
from app.models.class_program import Class
from tests.pg.sdd216_helpers import world, user

pytestmark = pytest.mark.pg


@pytest.mark.parametrize(
    "action", ["platform_suspend", "center_suspend", "delete", "leave"]
)
def test_account_path_marks_future_without_hiding_history(pg_session, action):
    org, a, b, parent = world(pg_session)
    admin = user(pg_session, org, role="org_admin")
    rows = []
    for i, state in enumerate(["scheduled", "open", "completed"]):
        row = Session(
            type="meditation",
            class_id=parent.id,
            host_id=a.id,
            seq=i + 1,
            status=state,
            host_state="assigned",
            duration_min=60,
        )
        pg_session.add(row)
        rows.append(row)
    pg_session.commit()
    if action == "platform_suspend":
        from app.services.admin_service import suspend_user

        suspend_user(a.id, "합성 정지", admin.id, pg_session)
    elif action == "center_suspend":
        from app.services.org_service import set_counselor_suspension

        set_counselor_suspension(
            str(org.id),
            str(a.id),
            "합성 정지",
            str(admin.id),
            suspend=True,
            db=pg_session,
        )
    elif action == "delete":
        from app.services.admin_service import delete_user

        delete_user(a.id, admin.id, pg_session)
    else:
        from app.services.membership_service import leave_membership

        leave_membership(pg_session, a, org.id)
    pg_session.flush()
    pg_session.expire_all()
    refreshed = (
        pg_session.query(Session)
        .filter(Session.class_id == parent.id)
        .order_by(Session.seq)
        .all()
    )
    assert len(refreshed) == 3
    assert [r.host_state for r in refreshed] == [
        "needs_reassign",
        "assigned",
        "assigned",
    ]
    assert all(r.host_id == a.id and r.hidden_at is None for r in refreshed)
    assert pg_session.query(Class).filter(Class.id == parent.id).one().hidden_at is None


def test_platform_membership_removal_reaches_reassignment(pg_session, monkeypatch):
    from app.services.org_management_service import change_counselor
    from app.services import personal_office_service

    org, a, b, parent = world(pg_session)
    admin = user(pg_session, role="platform_admin")
    row = Session(
        type="meditation",
        class_id=parent.id,
        organization_id=org.id,
        host_id=a.id,
        seq=1,
        status="scheduled",
        host_state="assigned",
        duration_min=60,
    )
    pg_session.add(row)
    pg_session.commit()
    monkeypatch.setattr(
        personal_office_service, "fallback_to_personal_office", lambda *args: None
    )
    change_counselor(org.id, a.id, admin.id, "합성 소속 해제", pg_session)
    assert row.host_state == "needs_reassign" and row.hidden_at is None
