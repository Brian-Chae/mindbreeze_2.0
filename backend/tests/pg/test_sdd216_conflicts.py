"""V-13~15: 실제 PG의 범위 조회와 요청 내부 충돌."""

import importlib.util
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.models.class_program import Class, ClassInstructor
from app.models.session import Session
from app.models.user import User
from app.schemas.class_scheduling import ScheduleRow

pytestmark = pytest.mark.pg
T = datetime(2026, 11, 2, 10, tzinfo=timezone.utc)


def test_all_conflicts_boundaries_privacy_and_single_range_query(pg_session):
    assert importlib.util.find_spec(
        "app.services.class_conflict_service"
    ), "통합 충돌 검사가 필요합니다"
    from app.services.class_conflict_service import detect_conflicts_bulk

    user = User(
        email=f"{uuid4()}@example.com",
        password_hash="x",
        name="비공개 지도사",
        role="counselor",
    )
    pg_session.add(user)
    pg_session.flush()
    parent = Class(created_by=user.id, default_duration_min=60, title="비공개 제목")
    pg_session.add(parent)
    pg_session.flush()
    pg_session.add(ClassInstructor(class_id=parent.id, user_id=user.id))
    pg_session.flush()
    sessions = []
    for offset, duration, status in [
        (-180, 240, "scheduled"),
        (60, 60, "scheduled"),
        (0, 60, "cancelled"),
        (0, 60, "completed"),
    ]:
        row = Session(
            type="meditation",
            host_id=user.id,
            class_id=parent.id,
            seq=len(sessions) + 1,
            scheduled_at=T + timedelta(minutes=offset),
            duration_min=duration,
            status=status,
            host_state="assigned",
        )
        pg_session.add(row)
        sessions.append(row)
    pg_session.flush()
    candidates = [
        ScheduleRow(
            client_key="a", seq=1, scheduled_at=T, duration_min=60, host_id=user.id
        ),
        ScheduleRow(
            client_key="b",
            seq=2,
            scheduled_at=T + timedelta(minutes=30),
            duration_min=30,
            host_id=user.id,
        ),
    ]
    statements = []

    def capture(conn, cursor, statement, params, context, many):
        statements.append(statement)

    event.listen(pg_session.bind, "before_cursor_execute", capture)
    try:
        conflicts = detect_conflicts_bulk(
            pg_session, candidates, set(), {"id": str(uuid4()), "role": "counselor"}
        )
    finally:
        event.remove(pg_session.bind, "before_cursor_execute", capture)
    assert len([x for x in conflicts if x.kind == "host"]) == 3
    persisted = [x for x in conflicts if x.other_candidate_key is None]
    assert len(persisted) == 2
    assert all(
        not x.visible and x.other_session_id is None and x.parent_title is None
        for x in persisted
    )
    range_queries = [q for q in statements if "FROM sessions" in q]
    assert len(range_queries) == 1
    assert "scheduled_at <" in range_queries[0]
    own = detect_conflicts_bulk(
        pg_session,
        candidates,
        {sessions[0].id},
        {"id": str(user.id), "role": "counselor"},
    )
    assert len(own) == 1 and own[0].other_candidate_key == "b"


def test_place_and_member_warnings_only_within_visible_scope(pg_session):
    from tests.pg.test_sdd216_review_regressions import setup_class
    from tests.pg.sdd216_helpers import user
    from app.models.class_program import ClassMember
    from app.models.session import SessionParticipant
    from app.services.class_conflict_service import detect_conflicts_bulk

    a, b, cls, sessions = setup_class(pg_session)
    member = user(pg_session, role="client")
    pg_session.add(
        ClassMember(
            class_id=cls.id,
            user_id=member.id,
            kind="member",
            status="active",
            joined_via="host_invite",
        )
    )
    existing = sessions[0]
    existing.location_type = "offline"
    existing.location_address = "같은 센터 1실"
    pg_session.add(SessionParticipant(session_id=existing.id, user_id=member.id))
    pg_session.flush()
    row = ScheduleRow(
        client_key="new",
        seq=9,
        scheduled_at=existing.scheduled_at,
        duration_min=60,
        host_id=b.id,
        location_type="offline",
        location_address="같은 센터 1실",
    )
    conflicts = detect_conflicts_bulk(
        pg_session,
        [row],
        set(),
        {"id": str(a.id), "role": "counselor"},
        class_id=cls.id,
    )
    assert {c.kind for c in conflicts} == {"place", "member"}
    outsider = user(pg_session)
    conflicts = detect_conflicts_bulk(
        pg_session,
        [row],
        set(),
        {"id": str(outsider.id), "role": "counselor"},
        class_id=cls.id,
    )
    assert conflicts == []


def test_request_internal_place_and_member_conflicts(pg_session):
    from tests.pg.sdd216_helpers import world, user
    from app.schemas.class_scheduling import ScheduleRow
    from app.services.class_conflict_service import detect_conflicts_bulk
    from datetime import datetime, timezone

    org, a, b, cls = world(pg_session)
    member = user(pg_session, role="client")
    at = datetime(2026, 11, 2, 1, tzinfo=timezone.utc)
    rows = [
        ScheduleRow(
            client_key=str(i),
            seq=i + 1,
            scheduled_at=at,
            host_id=host.id,
            location_type="offline",
            location_address="같은 장소",
        )
        for i, host in enumerate((a, b))
    ]
    conflicts = detect_conflicts_bulk(
        pg_session,
        rows,
        set(),
        {"id": str(a.id)},
        class_id=cls.id,
        member_ids=[member.id],
    )
    assert {item.kind for item in conflicts} == {"place", "member"}
