"""V-07/08/35: 공개와 초안의 실제 트랜잭션·멱등 계약."""

import importlib.util
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import event, text

from app.models.class_program import Class
from app.models.session import Session
from app.schemas.class_scheduling import CreateClassCommand
from tests.pg.sdd216_helpers import world

pytestmark = pytest.mark.pg
NOW = datetime(2026, 11, 2, 1, tzinfo=timezone.utc)


def writer():
    assert importlib.util.find_spec(
        "app.services.class_write_service"
    ), "원자 편성 경로가 필요합니다"
    from app.services import class_write_service

    return class_write_service


def command(host, **overrides):
    data = dict(
        operation_key=str(uuid4()),
        schedule=dict(
            title="8회 명상",
            recurrence_rule=dict(start_date="2026-11-02", weekdays=[1], time="19:00"),
            assignment_rule=dict(mode="all_one", host_ids=[str(host.id)]),
        ),
    )
    data.update(overrides)
    return CreateClassCommand.model_validate(data)


def counts(db):
    return {
        name: db.execute(text(f"SELECT count(*) FROM {name}")).scalar()
        for name in (
            "classes",
            "class_instructors",
            "sessions",
            "class_members",
            "session_participants",
            "class_operations",
            "class_effects",
            "notifications",
            "notification_outbox",
        )
    }


def test_eight_sessions_commit_once_and_replay(pg_session):
    service = writer()
    org, a, b, parent = world(pg_session)
    cmd = command(a)
    result = service.create_class(pg_session, a.id, cmd, now=NOW)
    assert len(result["session_ids"]) == 8
    assert service.create_class(pg_session, a.id, cmd, now=NOW) == result
    rows = (
        pg_session.query(Session)
        .filter(Session.class_id == result["class_id"])
        .order_by(Session.seq)
        .all()
    )
    assert [r.seq for r in rows] == list(range(1, 9))
    assert all(r.host_id == a.id and r.access_code is None for r in rows)
    created = pg_session.query(Class).filter(Class.id == result["class_id"]).one()
    assert len(created.access_code) == 4 and created.participant_mode == "group"
    changed = cmd.model_copy(
        update={"schedule": cmd.schedule.model_copy(update={"title": "다른 본문"})}
    )
    with pytest.raises(HTTPException) as raised:
        service.create_class(pg_session, a.id, changed, now=NOW)
    assert raised.value.status_code == 409


def test_fifth_insert_failure_rolls_back_every_domain_row(pg_session):
    service = writer()
    org, a, b, parent = world(pg_session)
    pg_session.commit()
    before = counts(pg_session)
    attempts = []

    def fail_fifth(mapper, connection, target):
        attempts.append(target.id)
        if len(attempts) == 5:
            raise RuntimeError("합성 다섯 번째 실패")

    event.listen(Session, "before_insert", fail_fifth)
    try:
        with pytest.raises(RuntimeError, match="다섯 번째"):
            service.create_class(pg_session, a.id, command(a), now=NOW)
    finally:
        event.remove(Session, "before_insert", fail_fifth)
    assert len(attempts) == 5
    assert counts(pg_session) == before


def test_draft_has_no_sessions_code_members_or_effects(pg_session):
    service = writer()
    org, a, b, parent = world(pg_session)
    cmd = command(a, status="draft")
    cmd = cmd.model_copy(
        update={
            "schedule": cmd.schedule.model_copy(
                update={
                    "assignment_rule": cmd.schedule.assignment_rule.model_copy(
                        update={"host_ids": []}
                    )
                }
            )
        }
    )
    before = counts(pg_session)
    result = service.create_class(pg_session, a.id, cmd, now=NOW)
    assert result["session_ids"] == []
    row = pg_session.query(Class).filter(Class.id == result["class_id"]).one()
    assert row.status == "draft" and row.access_code is None and row.draft_schedule
    after = counts(pg_session)
    assert (
        after["sessions"] == before["sessions"]
        and after["class_effects"] == before["class_effects"]
    )


def test_create_members_atomic_and_invalid_member_rolls_back(pg_session):
    from tests.pg.sdd216_helpers import user
    from app.models.class_program import ClassMember
    from app.models.session import SessionParticipant

    service = writer()
    org, a, b, parent = world(pg_session)
    member = user(pg_session, role="client")
    pg_session.commit()
    cmd = command(a)
    cmd = cmd.model_copy(
        update={"schedule": cmd.schedule.model_copy(update={"member_ids": [member.id]})}
    )
    result = service.create_class(pg_session, a.id, cmd, now=NOW)
    assert (
        pg_session.query(ClassMember)
        .filter(ClassMember.class_id == result["class_id"])
        .count()
        == 1
    )
    assert (
        pg_session.query(SessionParticipant)
        .filter(SessionParticipant.user_id == member.id)
        .count()
        == 8
    )
    before = counts(pg_session)
    bad = command(a)
    bad = bad.model_copy(
        update={"schedule": bad.schedule.model_copy(update={"member_ids": [uuid4()]})}
    )
    with pytest.raises(HTTPException):
        service.create_class(pg_session, a.id, bad, now=NOW)
    assert counts(pg_session) == before


def test_publish_draft_then_shift_all_preserves_sequences(pg_session):
    from app.schemas.class_scheduling import WriteCommand
    from datetime import timedelta

    service = writer()
    org, a, b, parent = world(pg_session)
    assert hasattr(service, "publish_class"), "초안 공개가 필요합니다"
    result = service.create_class(pg_session, a.id, command(a, status="draft"), now=NOW)
    published = service.publish_class(
        pg_session,
        a.id,
        result["class_id"],
        WriteCommand(operation_key=str(uuid4()), expected_revision=1),
        now=NOW,
    )
    assert len(published["session_ids"]) == 8
    assert hasattr(service, "bulk_update"), "일괄 원자 변경이 필요합니다"
    rows = (
        pg_session.query(Session)
        .filter(Session.class_id == result["class_id"])
        .order_by(Session.seq)
        .all()
    )
    before = {str(s.id): s.scheduled_at for s in rows}
    cmd = {
        "operation_key": str(uuid4()),
        "expected_revision": published["revision"],
        "action": "shift_week",
        "session_ids": [str(r.id) for r in rows],
        "expected_state_versions": {str(r.id): r.state_version for r in rows},
    }
    service.bulk_update(pg_session, a.id, result["class_id"], cmd, now=NOW)
    pg_session.expire_all()
    shifted = (
        pg_session.query(Session)
        .filter(Session.class_id == result["class_id"])
        .order_by(Session.seq)
        .all()
    )
    assert [s.seq for s in shifted] == list(range(1, 9))
    assert all(s.scheduled_at == before[str(s.id)] + timedelta(days=7) for s in shifted)
    stale = {**cmd, "operation_key": str(uuid4())}
    with pytest.raises(HTTPException) as raised:
        service.bulk_update(pg_session, a.id, result["class_id"], stale, now=NOW)
    assert raised.value.status_code == 409


def test_rolling_only_adds_next_week_and_never_rewrites_overrides(pg_session):
    from datetime import timedelta

    service = writer()
    org, a, b, parent = world(pg_session)
    assert importlib.util.find_spec(
        "app.services.class_rolling_service"
    ), "정기 보충이 필요합니다"
    from app.services.class_rolling_service import roll_forward

    cmd = command(a)
    cmd = cmd.model_copy(
        update={
            "schedule": cmd.schedule.model_copy(update={"schedule_mode": "rolling"})
        }
    )
    result = service.create_class(pg_session, a.id, cmd, now=NOW)
    assert len(result["session_ids"]) == 4
    rolled = roll_forward(pg_session, result["class_id"], now=NOW + timedelta(days=7))
    assert len(rolled["session_ids"]) == 1
    assert (
        roll_forward(pg_session, result["class_id"], now=NOW + timedelta(days=7))[
            "session_ids"
        ]
        == []
    )
    assert (
        pg_session.query(Session).filter(Session.class_id == result["class_id"]).count()
        == 5
    )


def test_commit_failure_rolls_back_members_effects_and_operation(
    pg_session, monkeypatch
):
    from tests.pg.sdd216_helpers import user
    from app.tasks import reminder_task, email

    _, a, _, _ = world(pg_session)
    member = user(pg_session, role="client")
    pg_session.commit()
    before = counts(pg_session)
    calls = []
    monkeypatch.setattr(
        reminder_task.send_session_reminder_task,
        "apply_async",
        lambda *args, **kwargs: calls.append("broker"),
    )
    monkeypatch.setattr(
        email, "_send_email", lambda *args, **kwargs: calls.append("email")
    )
    cmd = command(a)
    cmd = cmd.model_copy(
        update={"schedule": cmd.schedule.model_copy(update={"member_ids": [member.id]})}
    )

    def fail_commit():
        pg_session.flush()
        assert counts(pg_session)["sessions"] == before["sessions"] + 8
        raise RuntimeError("합성 커밋 실패")

    with monkeypatch.context() as patch:
        patch.setattr(pg_session, "commit", fail_commit)
        with pytest.raises(RuntimeError, match="합성 커밋 실패"):
            writer().create_class(pg_session, a.id, cmd, now=NOW)
    assert counts(pg_session) == before
    assert calls == []
