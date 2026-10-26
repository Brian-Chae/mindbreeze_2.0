"""일괄 편집·역할 변경·롤링 조합의 회귀 검증."""

from datetime import timedelta
from uuid import uuid4
import pytest
from fastapi import HTTPException
from app.models.class_program import Class, ClassInstructor
from app.models.class_scheduling import SessionHostRequest
from app.models.session import Session
from app.models.record import Report
from tests.pg.sdd216_helpers import world
from tests.pg.test_sdd216_write import command, NOW, writer

pytestmark = pytest.mark.pg


def setup_class(db, rolling=False):
    org, a, b, _ = world(db)
    cmd = command(a)
    data = cmd.schedule.model_dump()
    data["instructors"] = [{"user_id": b.id, "role": "assistant"}]
    if rolling:
        data["schedule_mode"] = "rolling"
    from app.schemas.class_scheduling import ScheduleInput

    cmd = cmd.model_copy(update={"schedule": ScheduleInput.model_validate(data)})
    result = writer().create_class(db, a.id, cmd, now=NOW)
    cls = db.query(Class).filter(Class.id == result["class_id"]).one()
    rows = (
        db.query(Session).filter(Session.class_id == cls.id).order_by(Session.seq).all()
    )
    return a, b, cls, rows


def replace(db, actor, cls, rows, hosts, starts):
    return writer().bulk_update(
        db,
        actor.id,
        cls.id,
        {
            "operation_key": str(uuid4()),
            "expected_revision": cls.revision,
            "action": "replace",
            "session_ids": [str(s.id) for s in rows],
            "expected_state_versions": {str(s.id): s.state_version for s in rows},
            "rows": [
                dict(
                    client_key=str(s.id),
                    session_id=str(s.id),
                    seq=s.seq,
                    scheduled_at=start.isoformat(),
                    host_id=str(host.id),
                )
                for s, host, start in zip(rows, hosts, starts)
            ],
        },
        now=NOW,
    )


@pytest.mark.parametrize("move_time", [False, True])
def test_bulk_urgent_request_keeps_acceptable_version(pg_session, move_time):
    from app.services.class_instructor_service import resolve_host_request

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    if not move_time:
        row.scheduled_at = NOW + timedelta(minutes=30)
        pg_session.commit()
    replace(pg_session, a, cls, [row], [b], [NOW + timedelta(minutes=30)])
    request = pg_session.query(SessionHostRequest).filter_by(session_id=row.id).one()
    assert request.status == "pending_ack"
    assert row.host_id == a.id
    assert request.expected_state_version == row.state_version
    resolve_host_request(pg_session, cls, row, request, "accept", b, NOW)
    assert request.status == "accepted" and row.host_id == b.id


def test_bulk_host_swap_checks_final_schedule(pg_session):
    a, b, cls, rows = setup_class(pg_session)
    rows[1].host_id = b.id
    rows[1].scheduled_at = rows[0].scheduled_at
    pg_session.commit()
    replace(pg_session, a, cls, rows[:2], [b, a], [rows[0].scheduled_at] * 2)
    assert [s.host_id for s in rows[:2]] == [b.id, a.id]


def test_shifted_rolling_session_not_generated_twice(pg_session):
    from app.services.class_rolling_service import roll_forward

    a, b, cls, rows = setup_class(pg_session, rolling=True)
    last = rows[-1]
    writer().bulk_update(
        pg_session,
        a.id,
        cls.id,
        {
            "operation_key": str(uuid4()),
            "expected_revision": cls.revision,
            "action": "shift_week",
            "session_ids": [str(last.id)],
            "expected_state_versions": {str(last.id): last.state_version},
        },
        now=NOW,
    )
    result = roll_forward(pg_session, cls.id, now=NOW + timedelta(days=7))
    assert result["session_ids"] == []
    assert pg_session.query(Session).filter(Session.class_id == cls.id).count() == 4


def test_former_host_admin_cannot_approve(pg_session, monkeypatch):
    from app.services import report_service

    a, b, cls, rows = setup_class(pg_session)
    rows[0].status = "completed"
    report = Report(
        session_id=rows[0].id,
        user_id=a.id,
        type="counselor",
        status="pending_review",
        content={},
    )
    pg_session.add(report)
    a.role = "org_admin"
    pg_session.flush()
    # 발송 경계만 차단하고 실제 승인 권한·상태는 검증한다.
    monkeypatch.setattr(
        report_service, "_enqueue_client_email_on_approval", lambda *args: None
    )
    with pytest.raises(HTTPException) as raised:
        report_service.approve_report(str(report.id), str(a.id), pg_session)
    assert raised.value.status_code == 403
    assert report.status == "pending_review"


def test_guest_can_accept_own_scoped_request_over_http(pg_session, monkeypatch):
    from datetime import datetime, timezone
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.v1.classes import router
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.config import settings
    from app.services.class_instructor_service import apply_host_request

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    guest = (
        pg_session.query(ClassInstructor).filter_by(class_id=cls.id, user_id=b.id).one()
    )
    guest.role, guest.scope_session_id = "guest", row.id
    now = NOW

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW

    monkeypatch.setattr("app.api.v1.classes.datetime", FrozenDateTime)
    row.scheduled_at = now + timedelta(minutes=40)
    request = apply_host_request(
        pg_session,
        cls,
        row,
        {"candidate_host_id": b.id, "expected_state_version": row.state_version},
        a,
        now,
    )
    pg_session.commit()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db] = lambda: pg_session
    app.dependency_overrides[get_current_user] = lambda: {
        "id": str(b.id),
        "role": "counselor",
    }
    monkeypatch.setattr(settings, "class_scheduling_enabled", True)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/classes/{cls.id}/sessions/{row.id}/host-requests/{request.id}/resolve",
        json={
            "operation_key": str(uuid4()),
            "expected_revision": cls.revision,
            "action": "accept",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "accepted"
    assert row.host_id == b.id
    assert client.get(f"/api/v1/classes/{cls.id}/members").status_code == 404


def test_admin_can_download_approved_meditation_pdf(pg_session, monkeypatch):
    from app.api.v1 import reports
    from tests.pg.sdd216_helpers import user

    a, b, cls, rows = setup_class(pg_session)
    from app.models.organization import Organization

    admin = user(
        pg_session, pg_session.get(Organization, cls.organization_id), role="org_admin"
    )
    rows[0].status = "completed"
    report = Report(
        session_id=rows[0].id,
        user_id=a.id,
        type="counselor",
        status="completed",
        content={},
    )
    pg_session.add(report)
    pg_session.flush()
    monkeypatch.setattr(reports, "pdf_response", lambda data: data)
    result = reports.download_pdf(
        str(report.id), {"id": str(admin.id), "role": "org_admin"}, pg_session
    )
    assert result["status"] == "completed"


@pytest.mark.parametrize(
    "capacity,location,video", [(100, "online", False), (10, "offline", True)]
)
def test_manual_add_cannot_bypass_class_media_and_capacity(
    pg_session, capacity, location, video
):
    a, b, cls, rows = setup_class(pg_session)
    cls.capacity, cls.record_video = capacity, video
    pg_session.commit()
    with pytest.raises(HTTPException) as raised:
        writer().add_session(
            pg_session,
            a.id,
            cls.id,
            {
                "operation_key": str(uuid4()),
                "expected_revision": cls.revision,
                "row": {
                    "client_key": "manual",
                    "seq": 9,
                    "scheduled_at": "2027-01-04T10:00:00Z",
                    "host_id": str(a.id),
                    "location_type": location,
                    "location_address": "합성 주소",
                },
            },
            now=NOW,
        )
    assert raised.value.status_code == 422
    assert pg_session.query(Session).filter_by(class_id=cls.id).count() == 8


def test_bulk_cannot_invalidate_unresolved_request(pg_session):
    from app.services.class_instructor_service import apply_host_request

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.scheduled_at = NOW + timedelta(minutes=30)
    req = apply_host_request(
        pg_session,
        cls,
        row,
        {"candidate_host_id": b.id, "expected_state_version": row.state_version},
        a,
        NOW,
    )
    pg_session.commit()
    with pytest.raises(HTTPException) as raised:
        replace(pg_session, a, cls, [row], [a], [NOW + timedelta(hours=3)])
    assert raised.value.status_code == 409
    assert (
        req.status == "pending_ack" and req.expected_state_version == row.state_version
    )


def test_fixed_completion_preserves_future_makeup(pg_session):
    from app.services.class_rolling_service import finish_class_if_due

    a, b, cls, rows = setup_class(pg_session)
    for row in rows:
        row.status = "completed"
    makeup = Session(
        type="meditation",
        class_id=cls.id,
        host_id=a.id,
        seq=9,
        status="scheduled",
        host_state="assigned",
        duration_min=60,
        session_kind="makeup",
        scheduled_at=NOW + timedelta(days=1),
    )
    pg_session.add(makeup)
    pg_session.flush()
    assert finish_class_if_due(pg_session, cls, NOW)
    assert makeup.status == "scheduled"


def test_removed_guest_cannot_edit_old_report(pg_session):
    from app.services.report_service import require_report_host

    a, b, cls, rows = setup_class(pg_session)
    row = rows[0]
    row.host_id = b.id
    row.status = "completed"
    instructor = (
        pg_session.query(ClassInstructor).filter_by(class_id=cls.id, user_id=b.id).one()
    )
    instructor.role = "guest"
    instructor.scope_session_id = row.id
    instructor.status = "removed"
    report = Report(
        session_id=row.id,
        user_id=b.id,
        type="counselor",
        status="pending_review",
        content={},
    )
    pg_session.add(report)
    pg_session.flush()
    with pytest.raises(HTTPException) as exc:
        require_report_host(str(report.id), str(b.id), pg_session)
    assert exc.value.status_code == 403


def test_active_assignment_cannot_become_unassigned(pg_session):
    from tests.pg.test_sdd216_write import command

    a, b, cls, rows = setup_class(pg_session, rolling=True)
    schedule = command(a).schedule.model_dump(mode="json")
    schedule["schedule_mode"] = "rolling"
    schedule["assignment_rule"]["host_ids"] = []
    with pytest.raises(HTTPException) as exc:
        writer().update_class(
            pg_session,
            a.id,
            cls.id,
            {
                "operation_key": str(uuid4()),
                "expected_revision": cls.revision,
                "schedule": schedule,
            },
            now=NOW,
        )
    assert exc.value.status_code == 422


def test_place_only_conflict_is_informational(pg_session):
    from app.schemas.class_scheduling import ScheduleRow, WriteCommand

    a, b, cls, rows = setup_class(pg_session)
    rows[0].location_type = "offline"
    rows[0].location_address = "같은 방"
    pg_session.flush()
    row = ScheduleRow(
        client_key="new",
        seq=9,
        host_id=b.id,
        scheduled_at=rows[0].scheduled_at,
        location_type="offline",
        location_address="같은 방",
    )
    conflicts = writer().check_conflicts(
        pg_session, [row], a, WriteCommand(operation_key="preview"), class_id=cls.id
    )
    assert [c.kind for c in conflicts] == ["place"]
