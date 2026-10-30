"""SDD-217: 마이그레이션된 실제 PG 스키마와 보존 제약."""
import importlib.util
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, DBAPIError

pytestmark = pytest.mark.pg
NEW_TABLES = {'class_attendance_events', 'class_makeup_assignments', 'class_guest_credentials',
    'class_guest_recoveries', 'class_guest_merges', 'class_member_operations',
    'class_guest_join_operations', 'class_member_consent_events', 'session_presence_leases'}


def test_contract_schema_and_preserved_constraints(pg_conn):
    schema = inspect(pg_conn)
    assert NEW_TABLES <= set(schema.get_table_names())
    for table, expected in {
        'class_members': {'canonical_member_id', 'research_consented', 'research_notice_version',
                          'research_selected_at', 'research_origin_id', 'reminder_opt_in'},
        'sessions': {'participation_version'},
        'session_participants': {'checkin_state', 'checkin_at', 'presence_seen_at',
            'report_consent_override', 'research_consent_override', 'research_origin_id',
            'superseded_by_participant_id'},
        'research_consents': {'origin_id'},
    }.items():
        assert expected <= {c['name'] for c in schema.get_columns(table)}
    for table, columns in [('class_members', ('class_id', 'user_id')),
            ('session_participants', ('session_id', 'member_id')),
            ('session_participants', ('session_id', 'user_id')),
            ('class_operations', ('actor_id', 'operation_key'))]:
        assert columns in {tuple(x['column_names']) for x in schema.get_unique_constraints(table)}
    assert {'fk_sessions_class_host', 'ck_sessions_one_parent'} <= {
        r[0] for r in pg_conn.execute(text("SELECT conname FROM pg_constraint WHERE conrelid='sessions'::regclass"))}


def _rows(db):
    from tests.pg.sdd216_helpers import world
    from app.models.class_program import ClassMember
    from app.models.session import Session, SessionParticipant
    _, host, _, cls = world(db)
    member = ClassMember(class_id=cls.id, kind='guest', status='active', joined_via='code')
    db.add(member)
    db.flush()
    sessions = [Session(type='meditation', class_id=cls.id, host_id=host.id, seq=i + 1,
                        duration_min=60, status='scheduled', host_state='assigned') for i in range(3)]
    db.add_all(sessions)
    db.flush()
    participants = [SessionParticipant(session_id=s.id, member_id=member.id,
                     attendance_status='absent' if i == 0 else 'expected') for i, s in enumerate(sessions)]
    db.add_all(participants)
    db.flush()
    return cls, host, member, sessions, participants


def test_canonical_rejects_self_other_class_and_registered_target(pg_session):
    from app.models.class_program import ClassMember
    assert hasattr(ClassMember, 'canonical_member_id'), 'canonical DB 방어선이 필요합니다'
    cls, _, source, _, _ = _rows(pg_session)
    _, _, other, _, _ = _rows(pg_session)
    for target_id in (source.id, other.id):
        with pytest.raises(IntegrityError), pg_session.begin_nested():
            pg_session.execute(text('UPDATE class_members SET canonical_member_id=:target WHERE id=:id'),
                               {'target': target_id, 'id': source.id})
    target = ClassMember(class_id=cls.id, kind='member', status='active', joined_via='code')
    pg_session.add(target)
    pg_session.flush()
    with pytest.raises(IntegrityError), pg_session.begin_nested():
        pg_session.execute(text('UPDATE class_members SET canonical_member_id=:target WHERE id=:id'),
                           {'target': target.id, 'id': source.id})
    target.kind = 'guest'
    pg_session.flush()
    source.canonical_member_id = target.id
    pg_session.flush()


def test_makeup_partial_unique_status_and_source_target(pg_session):
    assert importlib.util.find_spec('app.models.class_membership'), '보강 스키마가 필요합니다'
    from app.models.class_membership import ClassMakeupAssignment
    cls, _, member, sessions, participants = _rows(pg_session)
    def assignment(status='reserved', index=1):
        return ClassMakeupAssignment(class_id=cls.id, member_id=member.id,
            source_session_id=sessions[0].id, source_participant_id=participants[0].id,
            target_session_id=sessions[index].id, target_participant_id=participants[index].id, status=status)
    reserved = assignment()
    pg_session.add(reserved)
    pg_session.flush()
    for status in ('reserved', 'completed'):
        with pytest.raises(IntegrityError), pg_session.begin_nested():
            pg_session.add(assignment(status, 2))
            pg_session.flush()
    reserved.status = 'cancelled'
    pg_session.flush()
    pg_session.add(assignment('completed', 2))
    pg_session.flush()
    for row in (assignment('unknown'), assignment('cancelled', 0)):
        with pytest.raises(IntegrityError), pg_session.begin_nested():
            pg_session.add(row)
            pg_session.flush()


@pytest.mark.parametrize('model_name', ['ClassAttendanceEvent', 'ClassMemberConsentEvent', 'ClassGuestMerge'])
def test_append_only_database_and_orm(pg_session, model_name):
    assert importlib.util.find_spec('app.models.class_membership'), '감사 스키마가 필요합니다'
    from app.models import class_membership
    from app.models.class_program import ClassMember
    cls, host, member, sessions, participants = _rows(pg_session)
    alias = ClassMember(class_id=cls.id, kind='guest', status='removed', joined_via='code')
    pg_session.add(alias)
    pg_session.flush()
    args = dict(class_id=cls.id)
    if model_name == 'ClassAttendanceEvent':
        args.update(session_id=sessions[0].id, participant_id=participants[0].id,
                    member_id=member.id, new_status='absent', actor_kind='host', operation_key='audit')
    elif model_name == 'ClassMemberConsentEvent':
        args.update(member_id=member.id, choice='research', value=False,
                    selected_at=datetime.now(timezone.utc), origin_id=uuid4(), operation_key='audit')
    else:
        args.update(source_member_id=alias.id, target_member_id=member.id,
                    actor_user_id=host.id, reason='동일인 확인', preview_fingerprint='0' * 64)
    model = getattr(class_membership, model_name)
    row = model(**args)
    pg_session.add(row)
    pg_session.flush()
    row_id, table = row.id, model.__tablename__
    for sql in (f'UPDATE {table} SET id=id WHERE id=:id', f'DELETE FROM {table} WHERE id=:id'):
        with pytest.raises(DBAPIError, match='append-only'), pg_session.begin_nested():
            pg_session.execute(text(sql), {'id': row_id})
    with pytest.raises(ValueError, match='append-only'), pg_session.begin_nested():
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(row, 'class_id')
        pg_session.flush()
    with pytest.raises(ValueError, match='append-only'), pg_session.begin_nested():
        pg_session.delete(pg_session.get(model, row_id))
        pg_session.flush()


def test_guest_keys_and_recovery_hash_are_unique(pg_session):
    from app.models.class_membership import ClassMemberOperation, ClassGuestJoinOperation, ClassGuestRecovery
    cls, host, member, _, _ = _rows(pg_session)
    for model, values in [
        (ClassMemberOperation, dict(member_id=member.id, operation_key='once', request_hash='0' * 64, result={})),
        (ClassGuestJoinOperation, dict(class_id=cls.id, member_id=member.id, operation_key='once', request_hash='0' * 64)),
        (ClassGuestRecovery, dict(class_id=cls.id, member_id=member.id, token_hash='1' * 64,
            expires_at=datetime.now(timezone.utc), issued_by=host.id, reason='본인 확인')),
    ]:
        pg_session.add(model(**values))
        pg_session.flush()
        with pytest.raises(IntegrityError), pg_session.begin_nested():
            pg_session.add(model(**values))
            pg_session.flush()


def test_presence_superseded_and_new_state_constraints(pg_session):
    from app.models.class_membership import ClassGuestCredential, SessionPresenceLease
    cls, _, member, sessions, participants = _rows(pg_session)
    for target in (participants[0].id, participants[1].id):
        with pytest.raises(IntegrityError), pg_session.begin_nested():
            pg_session.execute(text('UPDATE session_participants SET superseded_by_participant_id=:target WHERE id=:id'),
                               {'target': target, 'id': participants[0].id})
    with pytest.raises(IntegrityError), pg_session.begin_nested():
        pg_session.add(SessionPresenceLease(id='invalid-socket', session_id=sessions[0].id,
            participant_id=participants[1].id, expires_at=datetime.now(timezone.utc)))
        pg_session.flush()
    with pytest.raises(IntegrityError), pg_session.begin_nested():
        pg_session.add(ClassGuestCredential(class_id=cls.id, member_id=member.id, scope='admin',
            entry_ver=0, expires_at=datetime.now(timezone.utc)))
        pg_session.flush()
    with pytest.raises(IntegrityError), pg_session.begin_nested():
        pg_session.execute(text("UPDATE session_participants SET checkin_state='online' WHERE id=:id"), {'id': participants[0].id})
    # superseded 행도 global ORM 보존 필터에 숨겨지지 않는다.
    from app.models.session import SessionParticipant
    from app.models.class_program import ClassMember
    alias = ClassMember(class_id=cls.id, kind='guest', status='removed', joined_via='code')
    pg_session.add(alias)
    pg_session.flush()
    other = SessionParticipant(session_id=sessions[0].id, member_id=alias.id, attendance_status='withdrawn')
    pg_session.add(other)
    pg_session.flush()
    other.superseded_by_participant_id = participants[0].id
    pg_session.flush()
    assert pg_session.query(SessionParticipant).filter_by(id=other.id).one().superseded_by_participant_id == participants[0].id


def test_active_makeup_unique_blocks_competing_connection(pg_engine):
    """두 실연결에서 미커밋 중복은 대기하고 커밋 뒤 UNIQUE로 거부된다."""
    from sqlalchemy.orm import Session as OrmSession
    from sqlalchemy.exc import OperationalError
    from app.models.class_membership import ClassMakeupAssignment
    from app.models.class_program import ClassInstructor, ClassMember, Class
    from app.models.session import SessionParticipant, Session
    from app.models.user_org_membership import UserOrgMembership
    from app.models.user import User
    from app.models.organization import Organization
    from sqlalchemy import delete
    with OrmSession(pg_engine) as setup:
        cls, host, member, sessions, participants = _rows(setup)
        ids = dict(class_id=cls.id, member_id=member.id, source_session_id=sessions[0].id,
            source_participant_id=participants[0].id, target_session_id=sessions[1].id,
            target_participant_id=participants[1].id)
        org_id = cls.organization_id
        user_ids = [u.id for u in setup.query(User).filter_by(org_id=org_id)]
        setup.commit()
    try:
        with pg_engine.connect() as first, pg_engine.connect() as second:
            first.begin()
            second.begin()
            first.execute(ClassMakeupAssignment.__table__.insert().values(id=uuid4(), status='reserved', **ids))
            second.execute(text("SET LOCAL lock_timeout = '100ms'"))
            with pytest.raises(OperationalError, match='lock timeout'):
                second.execute(ClassMakeupAssignment.__table__.insert().values(id=uuid4(), status='reserved', **ids))
            second.rollback()
            first.commit()
            with pytest.raises(IntegrityError, match='uq_class_makeup_assignments_active_source'):
                second.execute(ClassMakeupAssignment.__table__.insert().values(id=uuid4(), status='reserved', **ids))
            second.rollback()
    finally:
        # 실제 커밋을 사용한 합성 fixture만 정리한다. 감사 이력은 이 테스트가 만들지 않는다.
        with pg_engine.begin() as conn:
            conn.execute(delete(ClassMakeupAssignment).where(ClassMakeupAssignment.class_id == ids['class_id']))
            conn.execute(delete(SessionParticipant).where(SessionParticipant.member_id == ids['member_id']))
            conn.execute(delete(Session).where(Session.class_id == ids['class_id']))
            conn.execute(delete(ClassMember).where(ClassMember.class_id == ids['class_id']))
            conn.execute(delete(ClassInstructor).where(ClassInstructor.class_id == ids['class_id']))
            conn.execute(delete(Class).where(Class.id == ids['class_id']))
            conn.execute(delete(UserOrgMembership).where(UserOrgMembership.org_id == org_id))
            conn.execute(delete(User).where(User.id.in_(user_ids)))
            conn.execute(delete(Organization).where(Organization.id == org_id))


def test_upgrade_backfills_only_before_evidence_and_is_repeatable(scratch_db):
    import json
    from sqlalchemy import create_engine
    from tests.pg.conftest import alembic_ok
    from tests.pg.test_sdd214_schema import mk_user, mk_class, mk_instructor, mk_session, mk_participant
    url = scratch_db('sdd217_upgrade')
    alembic_ok(url, 'upgrade', 'e036a0000056')
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            host = mk_user(conn)
            cls = mk_class(conn, host)
            mk_instructor(conn, cls, host)
            sid = mk_session(conn, host, class_id=cls, seq=1, host_state='assigned')
            before = mk_participant(conn, sid)
            after_only = mk_participant(conn, sid)
            no_evidence = mk_participant(conn, sid)
            conn.execute(text('''INSERT INTO session_records
                (id,session_id,status,subjective_state,ai_summary,markers,edit_history,is_edited)
                VALUES (:id,:sid,'idle',CAST(:state AS jsonb),'{}','[]','[]',false)'''), dict(id=str(uuid4()), sid=sid,
                state=json.dumps({'participants': {before: {'before': {'arousal': 3}}, after_only: {'after': {'valence': 4}}}})))
        alembic_ok(url, 'upgrade', 'head')
        alembic_ok(url, 'upgrade', 'head')
        with engine.connect() as conn:
            states = {str(r.id): r.checkin_state for r in conn.execute(text('SELECT id,checkin_state FROM session_participants'))}
            assert states == {before: 'completed', after_only: None, no_evidence: None}
            assert conn.execute(text('SELECT participation_version FROM sessions WHERE id=:id'), {'id': sid}).scalar_one() == 0
            # head 는 새 SDD 마다 올라간다. revision id 는 사전순이 아니므로 057 이 적용 리비전의 조상 체인에 있는지만 본다.
            from alembic.config import Config
            from alembic.script import ScriptDirectory
            applied = conn.execute(text('SELECT version_num FROM alembic_version')).scalar_one()
            script = ScriptDirectory.from_config(Config('alembic.ini'))
            ancestors = {r.revision for r in script.walk_revisions(base='base', head=applied)}
            assert 'e036a0000057' in ancestors
    finally:
        engine.dispose()
