"""active 멤버 기준 리마인더 및 진행 불가 상태 제외."""

import pytest
from app.models.class_program import ClassMember
from app.models.session import SessionParticipant
from tests.pg.sdd216_helpers import user
from tests.pg.test_sdd216_review_regressions import setup_class

pytestmark = pytest.mark.pg


def test_missing_expected_member_receives_but_excused_does_not(pg_session):
    from app.services.reminder_service import reminder_recipients, run_reminder

    a, b, cls, rows = setup_class(pg_session)
    m1, m2 = user(pg_session, role="client"), user(pg_session, role="client")
    for member in (m1, m2):
        pg_session.add(
            ClassMember(
                class_id=cls.id,
                user_id=member.id,
                kind="member",
                status="active",
                joined_via="host_invite",
            )
        )
    pg_session.add(
        SessionParticipant(
            session_id=rows[0].id, user_id=m2.id, attendance_status="excused"
        )
    )
    pg_session.flush()
    result = reminder_recipients(rows[0], pg_session)
    assert [r["user_id"] for r in result] == [str(m1.id)]
    rows[0].host_state = "needs_reassign"
    pg_session.flush()
    assert run_reminder(rows[0].id, 1440, pg_session)["reason"] == "host_unavailable"
