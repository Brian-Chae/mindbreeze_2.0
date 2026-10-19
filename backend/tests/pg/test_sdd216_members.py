"""최소 멤버십·미래 expected·정원은 실제 PG에서 검증한다."""

from datetime import datetime, timedelta, timezone
import importlib.util
import pytest
from fastapi import HTTPException
from app.models.session import Session, SessionParticipant
from app.models.class_program import ClassMember
from tests.pg.sdd216_helpers import world, user

pytestmark = pytest.mark.pg
NOW = datetime(2026, 11, 2, 1, tzinfo=timezone.utc)


def test_member_idempotency_future_only_and_capacity(pg_session):
    assert importlib.util.find_spec(
        "app.services.class_membership_service"
    ), "클래스 멤버십 경로가 필요합니다"
    from app.services.class_membership_service import invite_members

    org, a, b, parent = world(pg_session)
    parent.capacity = 2
    members = [user(pg_session, role="client") for _ in range(3)]
    for i, days in enumerate([-1, 1, 8]):
        pg_session.add(
            Session(
                type="meditation",
                class_id=parent.id,
                host_id=a.id,
                seq=i + 1,
                status="scheduled",
                host_state="assigned",
                duration_min=60,
                max_participants=2,
                scheduled_at=NOW + timedelta(days=days),
            )
        )
    pg_session.flush()
    invite_members(pg_session, parent, [members[0].id], a.id, NOW)
    invite_members(pg_session, parent, [members[0].id], a.id, NOW)
    assert (
        pg_session.query(ClassMember).filter(ClassMember.class_id == parent.id).count()
        == 1
    )
    expected = (
        pg_session.query(SessionParticipant)
        .filter(SessionParticipant.user_id == members[0].id)
        .all()
    )
    assert len(expected) == 2 and all(
        p.attendance_status == "expected"
        and not p.report_included
        and p.report_notice_ack_at is None
        for p in expected
    )
    invite_members(pg_session, parent, [members[1].id], a.id, NOW)
    with pytest.raises(HTTPException) as raised:
        invite_members(pg_session, parent, [members[2].id], a.id, NOW)
    assert raised.value.status_code == 409


def test_completed_member_requires_explicit_reinvite(pg_session):
    from app.services.class_membership_service import invite_members
    from tests.pg.test_sdd216_review_regressions import setup_class
    from tests.pg.test_sdd216_write import NOW
    from tests.pg.sdd216_helpers import user
    from app.models.class_program import ClassMemberEvent

    a, b, cls, rows = setup_class(pg_session)
    member = user(pg_session, role="client")
    membership = invite_members(pg_session, cls, [member.id], a.id, NOW)[0]
    membership.status = "completed"
    pg_session.flush()
    result = invite_members(pg_session, cls, [member.id], a.id, NOW, reactivate=True)
    assert result[0].id == membership.id and membership.status == "active"
    assert (
        pg_session.query(ClassMemberEvent).filter_by(member_id=membership.id).count()
        == 2
    )
