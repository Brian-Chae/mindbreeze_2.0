"""IN-Q01~09: 즉시 회차 PostgreSQL 초점 검증."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import event
from app.models.class_program import Class, ClassMember
from app.models.class_scheduling import ClassEffect
from app.models.session import Session, SessionParticipant
from app.models.notification import Notification
from app.schemas.class_scheduling import CreateClassCommand, ScheduleInput, WriteCommand
from app.services import class_write_service as writes
from app.services.class_schedule_service import expand_schedule
from tests.pg.sdd216_helpers import world, user
from tests.pg.test_sdd216_write import counts
NOW = datetime(2026, 11, 2, 15, 3, 27, 12345, tzinfo=timezone.utc)
HOST = UUID('00000000-0000-0000-0000-000000000001')

def payload(host=HOST, **updates):
    data = dict(title='바로 지금 명상', planned_session_count=1,
        recurrence_rule=dict(start_now=True, start_date='2026-01-01', weekdays=[1], time='19:00'),
        assignment_rule=dict(mode='all_one', host_ids=[str(host)]))
    return {**data, **updates}

def command(host, **updates):
    return CreateClassCommand(operation_key=str(uuid4()), schedule=payload(host), **updates)

def test_instant_uses_exact_server_time():
    rows = expand_schedule(ScheduleInput(**payload()), NOW)
    assert len(rows) == 1
    assert rows[0].scheduled_at == NOW and rows[0].host_id == HOST
    assert rows[0].seq == 1 and rows[0].client_key == 'instant:1'

@pytest.mark.parametrize('change', [
    {'schedule_mode': 'rolling'}, {'planned_session_count': 2}, {'ends_on': '2027-01-01'},
    {'assignment_rule': {'mode': 'rotate', 'host_ids': [str(HOST)]}},
    {'assignment_rule': {'host_ids': [str(HOST), str(uuid4())]}},
    {'assignment_rule': {'host_ids': [None]}},
    {'rows': [{'client_key': 'x', 'seq': 1, 'scheduled_at': '2026-12-01T10:00:00+09:00'}]},
])
def test_instant_rejects_invalid(change):
    with pytest.raises(ValidationError):
        ScheduleInput(**payload(**change))

def test_normal_single_stays_invalid():
    data = payload()
    data['recurrence_rule']['start_now'] = False
    with pytest.raises(ValidationError):
        ScheduleInput(**data)

def test_create_open_expected_idempotent(pg_session):
    org, host, _, _ = world(pg_session)
    member = user(pg_session, role='client')
    cmd = CreateClassCommand(operation_key=str(uuid4()), schedule=payload(host.id, member_ids=[member.id]))
    result = writes.create_class(pg_session, host.id, cmd, now=NOW)
    assert writes.create_class(pg_session, host.id, cmd, now=NOW + timedelta(seconds=5)) == result
    row = pg_session.query(Session).filter_by(class_id=UUID(result['class_id'])).one()
    assert row.status == 'open' and row.opened_at == NOW and row.scheduled_at == NOW
    assert row.started_at is None
    participant = pg_session.query(SessionParticipant).filter_by(session_id=row.id, user_id=member.id).one()
    assert participant.attendance_status == 'expected' and participant.joined_at is None
    assert pg_session.query(ClassEffect).filter_by(class_id=row.class_id, kind='session_prepare').count() == 1

def test_failure_after_participant_rolls_back_everything(pg_session):
    org, host, _, _ = world(pg_session)
    member = user(pg_session, role='client')
    host_id, member_id = host.id, member.id
    pg_session.commit()
    before = counts(pg_session)
    def fail(mapper, connection, target):
        raise RuntimeError('합성 참가자 저장 실패')
    event.listen(SessionParticipant, 'after_insert', fail)
    try:
        with pytest.raises(RuntimeError, match='합성 참가자'):
            writes.create_class(pg_session, host_id, CreateClassCommand(operation_key=str(uuid4()), schedule=payload(host_id, member_ids=[member_id])), now=NOW)
    finally:
        event.remove(SessionParticipant, 'after_insert', fail)
    assert counts(pg_session) == before

def test_draft_publish_now_duplicate_normal_two(pg_session):
    org, host, _, _ = world(pg_session)
    result = writes.create_class(pg_session, host.id, command(host.id, status='draft'), now=NOW)
    assert result['session_ids'] == []
    cid = UUID(result['class_id'])
    publish = WriteCommand(operation_key=str(uuid4()), expected_revision=1)
    later = NOW + timedelta(days=1)
    active = writes.publish_class(pg_session, host.id, cid, publish, now=later)
    assert writes.publish_class(pg_session, host.id, cid, publish, now=later) == active
    assert pg_session.query(Session).filter_by(class_id=cid).one().opened_at == later
    copied = writes.duplicate_class(pg_session, host.id, cid, {'operation_key': str(uuid4()), 'start_date': '2026-12-01'}, now=later)
    cloned = pg_session.get(Class, UUID(copied['class_id']))
    assert cloned.status == 'draft' and cloned.planned_session_count == 2
    assert cloned.recurrence_rule['start_now'] is False and copied['session_ids'] == []

def test_conflict_confirmation_clock_stable_new_conflict_rejected(pg_session):
    from app.services.class_conflict_service import detect_conflicts_bulk, conflict_fingerprint
    org, host, _, _ = world(pg_session)
    writes.create_class(pg_session, host.id, command(host.id), now=NOW)
    cmd = command(host.id)
    def fingerprint(seconds):
        rows = expand_schedule(cmd.schedule, NOW + timedelta(seconds=seconds))
        conflicts = detect_conflicts_bulk(pg_session, rows, set(), {'id': str(host.id), 'role': host.role})
        assert conflicts
        return conflict_fingerprint(conflicts)
    fp = fingerprint(1)
    assert fingerprint(10) == fp
    confirmed = cmd.model_copy(update={'force': True, 'confirmed_conflict_fingerprint': fp})
    writes.create_class(pg_session, host.id, confirmed, now=NOW + timedelta(seconds=10))
    stale = command(host.id).model_copy(update={'force': True, 'confirmed_conflict_fingerprint': fp})
    with pytest.raises(HTTPException) as raised:
        writes.create_class(pg_session, host.id, stale, now=NOW + timedelta(seconds=15))
    assert raised.value.detail['code'] == 'schedule_conflict'

def test_code_join_open_not_closed(pg_session):
    from app.services.class_code_service import join_class_code
    org, host, _, _ = world(pg_session)
    result = writes.create_class(pg_session, host.id, command(host.id), now=NOW)
    cls = pg_session.get(Class, UUID(result['class_id']))
    member = user(pg_session, role='client')
    join_class_code(pg_session, cls.id, member.id, cls.access_code, now=NOW + timedelta(seconds=1))
    row = pg_session.query(Session).filter_by(class_id=cls.id).one()
    assert pg_session.query(SessionParticipant).filter_by(session_id=row.id, user_id=member.id).count() == 1
    row.status = 'cancelled'
    pg_session.commit()
    other = user(pg_session, role='client')
    join_class_code(pg_session, cls.id, other.id, cls.access_code, now=NOW + timedelta(seconds=2))
    assert pg_session.query(SessionParticipant).filter_by(session_id=row.id, user_id=other.id).count() == 0

def test_scoped_effects_links_notification_retry(pg_session, monkeypatch):
    from app.config import settings
    from app.services.class_effect_service import process_effects
    from app.services.class_membership_service import invite_emails, retry_email
    org, host, _, unrelated = world(pg_session)
    member = user(pg_session, role='client')
    result = writes.create_class(pg_session, host.id, CreateClassCommand(operation_key=str(uuid4()), schedule=payload(host.id, member_ids=[member.id])), now=NOW)
    cls = pg_session.get(Class, UUID(result['class_id']))
    sid = result['session_ids'][0]
    invite = invite_emails(pg_session, cls, ['invite@example.com'], host.id)[0]
    other_intent = ClassEffect(class_id=unrelated.id, kind='class_invited', effect_key=str(uuid4()), payload={'recipient_id': str(member.id)})
    pg_session.add(other_intent)
    pg_session.commit()
    sent = []
    monkeypatch.setattr('app.tasks.email._send_email', lambda *args: sent.append(args) or False)
    delivery_time = datetime.now(timezone.utc) + timedelta(seconds=1)
    processed = process_effects(pg_session, now=delivery_time, class_id=cls.id)
    assert processed['failed'] == 1
    pg_session.refresh(other_intent)
    assert other_intent.status == 'pending'
    notes = pg_session.query(Notification).filter_by(user_id=member.id).all()
    note = next(n for n in notes if n.extra['event_type'] == 'class_invited')
    assert note.extra['target_type'] == 'class'
    assert note.extra['params']['start_now'] is True and note.extra['params']['session_id'] == sid
    body = sent[0][2]
    base = settings.frontend_base_url.rstrip('/')
    assert f'{base}/class/{sid}/enter' in body and f'{base}/join' in body and cls.access_code in body
    for word in body.split():
        if word.startswith('http'):
            assert cls.access_code not in word and 'invite@' not in word
    retry_email(pg_session, cls, invite.id)
    pg_session.commit()
    monkeypatch.setattr('app.tasks.email._send_email', lambda *args: sent.append(args) or True)
    process_effects(pg_session, now=delivery_time + timedelta(minutes=2), class_id=cls.id)
    process_effects(pg_session, now=delivery_time + timedelta(minutes=3), class_id=cls.id)
    assert len(sent) == 2
    assert pg_session.query(ClassMember).filter_by(class_id=cls.id).count() == 1

def test_direct_entry_requires_prior_invitation_without_mutation(pg_session):
    from app.services.session_service import enter_session_as_invited
    org, host, _, _ = world(pg_session)
    result = writes.create_class(pg_session, host.id, command(host.id), now=NOW)
    stranger = user(pg_session, role='client')
    pg_session.commit()
    with pytest.raises(HTTPException) as raised:
        enter_session_as_invited(result['session_ids'][0], str(stranger.id), pg_session)
    assert raised.value.status_code == 403
    assert pg_session.query(ClassMember).filter_by(user_id=stranger.id).count() == 0
    assert pg_session.query(SessionParticipant).filter_by(user_id=stranger.id).count() == 0

def test_api_dispatch_is_queued_after_successful_commit(pg_session):
    from fastapi import BackgroundTasks
    from app.api.v1.classes import create_class
    from app.services.class_effect_service import dispatch_class_effects
    org, host, _, _ = world(pg_session)
    committed = []
    event.listen(pg_session, 'after_commit', lambda db: committed.append(True))
    background = BackgroundTasks()
    result = create_class(command(host.id), background, {'id': str(host.id)}, pg_session)
    assert committed
    assert len(background.tasks) == 1
    assert background.tasks[0].func is dispatch_class_effects
    assert background.tasks[0].args == (result['class_id'],)


def test_api_failure_does_not_queue_dispatch(pg_session):
    from fastapi import BackgroundTasks
    from app.api.v1.classes import create_class
    org, host, _, _ = world(pg_session)
    background = BackgroundTasks()
    # 진행자 자격을 취소하면 생성 전체가 실패해야 한다.
    host.status = 'inactive'
    pg_session.commit()
    with pytest.raises(HTTPException):
        create_class(command(host.id), background, {'id': str(host.id)}, pg_session)
    assert not background.tasks

def test_normal_class_keeps_cron_dispatch(pg_session):
    from fastapi import BackgroundTasks
    from app.api.v1.classes import create_class
    from tests.pg.test_sdd216_write import command as normal_command
    org, host, _, _ = world(pg_session)
    background = BackgroundTasks()
    create_class(normal_command(host), background, {'id': str(host.id)}, pg_session)
    assert not background.tasks


def test_invited_member_can_enter_without_starting_session(pg_session):
    from app.services.session_service import enter_session_as_invited
    org, host, _, _ = world(pg_session)
    member = user(pg_session, role='client')
    result = writes.create_class(pg_session, host.id, CreateClassCommand(operation_key=str(uuid4()), schedule=payload(host.id, member_ids=[member.id])), now=NOW)
    entered = enter_session_as_invited(result['session_ids'][0], str(member.id), pg_session)
    assert entered['participant_id'] and entered['entry_credential']
    row = pg_session.get(Session, UUID(result['session_ids'][0]))
    assert row.status == 'open' and row.started_at is None


def test_invalid_host_and_capacity_roll_back(pg_session):
    org, host, _, _ = world(pg_session)
    clients = [user(pg_session, role='client') for _ in range(3)]
    host_id = host.id
    invalid_host = clients[0].id
    ids = [c.id for c in clients]
    pg_session.commit()
    before = counts(pg_session)
    for data, code in [(payload(invalid_host), 'instructor_unavailable'), (payload(host_id, capacity=2, member_ids=ids), 'class_capacity')]:
        with pytest.raises(HTTPException) as raised:
            writes.create_class(pg_session, host_id, CreateClassCommand(operation_key=str(uuid4()), schedule=data), now=NOW)
        assert raised.value.status_code in (409, 422)
        assert counts(pg_session) == before
