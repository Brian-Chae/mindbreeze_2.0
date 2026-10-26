"""클래스 초대 시 회원에게는 초대 알림 1건만 가야 한다(변경 안내 중복 금지)."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
from app.models.class_scheduling import ClassEffect
from app.models.notification import Notification
from app.models.notification_outbox import NotificationOutbox
from app.schemas.class_scheduling import CreateClassCommand
from app.services import class_write_service as writes
from app.services.class_effect_service import process_effects
from tests.pg.sdd216_helpers import world, user

NOW = datetime(2026, 11, 2, 15, 3, 27, tzinfo=timezone.utc)


def _instant(host, member_ids):
    return CreateClassCommand(operation_key=str(uuid4()), schedule=dict(
        title='즉석', planned_session_count=1,
        recurrence_rule=dict(start_now=True, start_date='2026-01-01', weekdays=[1], time='19:00'),
        assignment_rule=dict(mode='all_one', host_ids=[str(host)]), member_ids=member_ids))


def _scheduled(host, member_ids):
    start = (NOW + timedelta(days=3)).date().isoformat()
    return CreateClassCommand(operation_key=str(uuid4()), schedule=dict(
        title='예약', planned_session_count=2,
        recurrence_rule=dict(start_date=start, weekdays=[(NOW + timedelta(days=3)).isoweekday() % 7, (NOW + timedelta(days=5)).isoweekday() % 7], time='19:00'),
        assignment_rule=dict(mode='all_one', host_ids=[str(host)]), member_ids=member_ids))


def _run(pg_session, make):
    org, host, _, _ = world(pg_session)
    member = user(pg_session, role='client')
    mid = member.id
    res = writes.create_class(pg_session, host.id, make(host.id, [mid]), now=NOW)
    cid = UUID(res['class_id'])
    effects = sorted(e.kind for e in pg_session.query(ClassEffect).filter_by(class_id=cid))
    process_effects(pg_session, now=NOW, class_id=cid)
    notes = pg_session.query(Notification).filter_by(user_id=mid).all()
    outbox = pg_session.query(NotificationOutbox).filter_by(user_id=mid).all()
    print('EFFECTS', effects)
    print('NOTES', [(n.type, n.title) for n in notes])
    print('OUTBOX', [(o.channel, (o.payload or {}).get('subject') or (o.payload or {}).get('title')) for o in outbox])
    return notes, outbox


def test_instant_invite_member_gets_only_invite(pg_session):
    notes, outbox = _run(pg_session, _instant)
    assert [n.title for n in notes] == ['클래스 초대']
    assert all('변경' not in str((o.payload or {})) for o in outbox)


def test_scheduled_invite_member_gets_only_invite(pg_session):
    notes, outbox = _run(pg_session, _scheduled)
    assert [n.title for n in notes] == ['클래스 초대']
    assert all('변경' not in str((o.payload or {})) for o in outbox)
