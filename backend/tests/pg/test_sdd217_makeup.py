"""SDD-217 보강 매칭: 실제 PG 제약·HTTP·동시 예약 검증."""
from app.api.deps import get_current_user_optional
from datetime import timedelta
from uuid import uuid4, UUID
import importlib.util
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session as DBSession

from app.models.class_program import Class, ClassMember
from app.models.class_membership import ClassMakeupAssignment
from app.models.session import Session, SessionParticipant
from tests.pg.test_sdd217_membership import setup, NOW, command

pytestmark = pytest.mark.pg


def service():
    assert importlib.util.find_spec('app.services.class_makeup_service'), '보강 매칭 서비스 구현 필요'
    from app.services import class_makeup_service
    return class_makeup_service


def scene(db, state='absent', cap=2):
    host, other, parent, clients, member = setup(db, capacity=5)
    parent.status = 'active'
    rows = []
    for seq, status, days in ((1, 'completed', -2), (2, 'scheduled', 2), (3, 'scheduled', 3)):
        row = Session(type='meditation', class_id=parent.id, host_id=host.id, seq=seq, status=status, host_state='assigned', duration_min=60, participant_mode='group', max_participants=cap, scheduled_at=NOW+timedelta(days=days))
        db.add(row); rows.append(row)
    db.flush()
    source = SessionParticipant(session_id=rows[0].id, user_id=member.user_id, member_id=member.id, attendance_status=state)
    db.add(source); db.commit()
    return host, other, parent, clients, member, rows, source


def reserve(db, actor, parent, member, rows, **extra):
    return service().assign_makeup(db, actor.id, parent.id, command(parent, member_id=str(member.id), source_session_id=str(rows[0].id), target_session_id=str(rows[1].id), **extra), now=NOW)


@pytest.mark.parametrize('invalid', ['expected', 'attended', 'other_class', 'other_member', 'same_session'])
def test_v11_rejects_invalid_source(pg_session, invalid):
    host, _, parent, clients, member, rows, source = scene(pg_session)
    if invalid in ('expected', 'attended'): source.attendance_status = invalid
    elif invalid == 'other_class':
        from tests.pg.sdd216_helpers import world
        _, foreign_host, _, foreign = world(pg_session)
        rows[0].class_id = foreign.id
        rows[0].host_id = foreign_host.id
    elif invalid == 'other_member':
        second = ClassMember(class_id=parent.id, user_id=clients[1].id, status='active', joined_via='code'); pg_session.add(second); pg_session.flush(); source.member_id=second.id; source.user_id=second.user_id
    else: rows[1] = rows[0]
    pg_session.commit()
    with pytest.raises(HTTPException) as exc: reserve(pg_session, host, parent, member, rows)
    assert exc.value.status_code in (404, 409)
    assert pg_session.query(ClassMakeupAssignment).count() == 0


def test_v13_regular_target_conflict_source_unchanged_and_completion(pg_session):
    host, _, parent, clients, member, rows, source = scene(pg_session)
    regular = SessionParticipant(session_id=rows[1].id, member_id=member.id, user_id=member.user_id, attendance_status='excused')
    pg_session.add(regular); pg_session.commit()
    with pytest.raises(HTTPException) as exc: reserve(pg_session, host, parent, member, rows)
    assert exc.value.detail['code'] == 'target_participant_exists'
    assert regular.attendance_kind == 'regular' and source.attendance_status == 'absent'
    rows[1] = rows[2]
    result = reserve(pg_session, clients[0], parent, member, rows)
    assignment = pg_session.get(ClassMakeupAssignment, UUID(result['assignment']['id']))
    target = pg_session.get(SessionParticipant, UUID(result['participant']['id']))
    assert assignment.status == 'reserved' and target.attendance_status == 'expected'
    assert target.entered_at is None and target.joined_at is None
    from app.services.class_attendance_service import mark_entered
    rows[1].status = 'open'; pg_session.commit()
    mark_entered(pg_session, rows[1], target, NOW); pg_session.commit()
    assert assignment.status == 'completed' and assignment.completed_at == NOW
    assert source.attendance_status == 'absent' and source.entered_at is None


def test_v14_cancel_rebook_preserves_history_and_completed_states(pg_session):
    host, _, parent, clients, member, rows, source = scene(pg_session)
    parent.status = 'completed'; parent.schedule_mode='fixed'; member.status='completed'; pg_session.commit()
    result = reserve(pg_session, host, parent, member, rows)
    first = pg_session.get(ClassMakeupAssignment, UUID(result['assignment']['id']))
    target_id = first.target_participant_id
    cancelled = service().cancel_makeup(pg_session, clients[0].id, parent.id, first.id, command(parent), now=NOW)
    assert cancelled['assignment']['status']=='cancelled'
    assert pg_session.get(SessionParticipant,target_id).attendance_status=='withdrawn'
    again = reserve(pg_session, host, parent, member, rows)
    assert again['participant']['id']==str(target_id) and again['assignment']['id']!=str(first.id)
    assert first.status=='cancelled' and first.cancelled_at==NOW
    assert pg_session.query(ClassMakeupAssignment).count()==2
    assert parent.status=='completed' and member.status=='completed'
    assert source.attendance_status=='absent'


def test_http_current_permissions_idempotency_and_hash(pg_session,monkeypatch):
    from app.api.v1 import class_membership
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.config import settings
    host, other, parent, clients, member, rows, source = scene(pg_session)
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI(); app.include_router(class_membership.router,prefix='/api/v1')
    identity={'id':str(other.id)}
    app.dependency_overrides[get_current_user]=lambda:identity
    app.dependency_overrides[get_current_user_optional] = app.dependency_overrides[get_current_user]
    app.dependency_overrides[get_db]=lambda:pg_session
    body=command(parent,member_id=str(member.id),source_session_id=str(rows[0].id),target_session_id=str(rows[1].id))
    path=f'/api/v1/classes/{parent.id}/makeup-assignments'
    with TestClient(app) as client:
        assert client.post(path,json=body).status_code==403
        identity['id']=str(clients[0].id)
        response=client.post(path,json=body); assert response.status_code==201,response.text
        assert client.post(path,json=body).json()==response.json()
        assert client.post(path,json={**body,'target_session_id':str(rows[2].id)}).status_code==409
        member.status='left';pg_session.commit()
        assert client.post(path,json=body).status_code==403
        identity['id']=str(host.id)
        extra=command(parent,member_id=str(member.id),source_session_id=str(rows[0].id),target_session_id=str(rows[2].id),guest_id=str(uuid4()))
        assert client.post(path,json=extra).status_code==422


def legacy_command(parent, host, source, **extra):
    return command(parent,makeup_for_session_id=str(source.id),row={'client_key':'makeup','seq':9,'session_kind':'makeup','scheduled_at':'2027-01-04T10:00:00Z','host_id':str(host.id)},**extra)


@pytest.mark.parametrize('kind',['expected','cancelled','guest','ambiguous','membership_as_user'])
def test_v35_legacy_create_validates_absence_and_identifiers(pg_session,kind):
    from app.services.class_write_service import add_session
    host, _, parent, clients, member, rows, source = scene(pg_session)
    extra={'member_ids':[str(clients[0].id)]}
    if kind=='expected': source.attendance_status='expected'
    elif kind=='cancelled': rows[0].status='cancelled';source.attendance_status='expected'
    elif kind=='guest':
        guest=ClassMember(class_id=parent.id,user_id=None,kind='guest',guest_name='합성 게스트',status='active',joined_via='code');pg_session.add(guest);pg_session.flush()
        source.member_id=guest.id;source.user_id=None; member=guest
        # 별개 NULL guest가 원결석 근거를 공유하지 않아야 한다.
        other=ClassMember(class_id=parent.id,user_id=None,kind='guest',guest_name='다른 게스트',status='active',joined_via='code');pg_session.add(other)
        extra={'class_member_ids':[str(guest.id)]}
    elif kind=='ambiguous': extra['class_member_ids']=[str(member.id)]
    else: extra={'member_ids':[str(member.id)]}
    pg_session.commit()
    cmd=legacy_command(parent,host,rows[0],**extra)
    if kind in ('expected','ambiguous','membership_as_user'):
        with pytest.raises(HTTPException) as exc:add_session(pg_session,host.id,parent.id,cmd,now=NOW)
        assert exc.value.status_code in (409,422)
        assert pg_session.query(Session).filter_by(class_id=parent.id).count()==3
    else:
        result=add_session(pg_session,host.id,parent.id,cmd,now=NOW)
        target=pg_session.query(SessionParticipant).filter_by(session_id=result['session_ids'][0]).one()
        assert target.member_id==member.id
        if kind=='cancelled':
            assert target.attendance_kind=='regular' and target.makeup_for_session_id==rows[0].id
            assert pg_session.query(ClassMakeupAssignment).count()==0
        else:
            assert target.user_id is None and target.attendance_kind=='makeup'
            assert pg_session.query(ClassMakeupAssignment).one().source_participant_id==source.id


@pytest.mark.parametrize('case', ['same_source', 'target_capacity'])
def test_v12_two_connections_http_reservations_serialized(scratch_db, monkeypatch, case):
    from tests.pg.conftest import alembic_ok
    from app.api.v1 import class_membership
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.config import settings
    url=scratch_db('makeup_race_'+case);alembic_ok(url,'upgrade','head');engine=create_engine(url)
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    try:
        with DBSession(engine) as seed:
            host, _, parent, clients, member, rows, source = scene(seed,cap=1)
            second=member
            if case=='target_capacity':
                second=ClassMember(class_id=parent.id,user_id=clients[1].id,status='active',joined_via='code');seed.add(second);seed.flush()
                seed.add(SessionParticipant(session_id=rows[0].id,member_id=second.id,user_id=second.user_id,attendance_status='absent'));seed.commit()
            ids=(parent.id,member.id,second.id,rows[0].id,rows[1].id,rows[2].id,clients[0].id,host.id if case=='same_source' else clients[1].id)
        first_locked=threading.Event();second_attempt=threading.Event()
        thread_kind=threading.local()
        def before(conn,cursor,statement,parameters,context,many):
            if getattr(thread_kind,'kind',None)=='second' and 'FROM classes' in statement and 'FOR UPDATE' in statement:
                second_attempt.set()
        def after(conn,cursor,statement,parameters,context,many):
            if getattr(thread_kind,'kind',None)=='first' and 'FROM classes' in statement and 'FOR UPDATE' in statement:
                first_locked.set()
                assert second_attempt.wait(5), '두 번째 연결이 클래스 잠금을 요청해야 한다'
        event.listen(engine,'before_cursor_execute',before);event.listen(engine,'after_cursor_execute',after)
        def request(which):
            thread_kind.kind=which
            if which=='second':assert first_locked.wait(5)
            with DBSession(engine) as db:
                actor=ids[6] if which=='first' else ids[7]
                target=ids[5] if case=='same_source' and which=='second' else ids[4]
                membership=ids[1] if which=='first' else ids[2]
                body={'operation_key':str(uuid4()),'expected_revision':0,'member_id':str(membership),'source_session_id':str(ids[3]),'target_session_id':str(target)}
                app=FastAPI();app.include_router(class_membership.router,prefix='/api/v1')
                app.dependency_overrides[get_current_user]=lambda:{'id':str(actor)}
                app.dependency_overrides[get_current_user_optional] = app.dependency_overrides[get_current_user]
                app.dependency_overrides[get_db]=lambda:db
                with TestClient(app) as client:
                    # TestClient 처리 스레드에서 별도 연결에 같은 표식을 붙인다.
                    def context_db():
                        thread_kind.kind=which
                        return db
                    app.dependency_overrides[get_db]=context_db
                    response=client.post(f'/api/v1/classes/{ids[0]}/makeup-assignments',json=body)
                    if response.status_code==409 and response.json()['detail']['code']=='stale_class':
                        body['expected_revision']=response.json()['detail']['revision']
                        response=client.post(f'/api/v1/classes/{ids[0]}/makeup-assignments',json=body)
                    return response.status_code,response.json()
        with ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(request,'first');second=pool.submit(request,'second')
            outcomes=[first.result(timeout=15),second.result(timeout=15)]
        assert sorted(x[0] for x in outcomes)==[201,409],outcomes
        failure=next(body for status,body in outcomes if status==409)
        assert failure['detail']['code']==('makeup_already_reserved' if case=='same_source' else 'session_capacity')
        with DBSession(engine) as check:
            assert check.query(ClassMakeupAssignment).filter_by(status='reserved').count()==1
            assert check.query(SessionParticipant).filter_by(session_id=ids[4],attendance_kind='makeup',attendance_status='expected').count()<=1
    finally:engine.dispose()


@pytest.mark.parametrize('invalid',['started','past','entered','org_admin','removed_instructor'])
def test_source_target_and_current_authority_limits(pg_session,invalid):
    host, _, parent, clients, member, rows, source=scene(pg_session)
    actor=host
    if invalid=='started':rows[1].started_at=NOW
    elif invalid=='past':rows[1].scheduled_at=NOW-timedelta(minutes=1)
    elif invalid=='entered':
        pg_session.add(SessionParticipant(session_id=rows[1].id,member_id=member.id,user_id=member.user_id,attendance_status='withdrawn',attendance_kind='makeup',entered_at=NOW))
    elif invalid=='org_admin':
        host.role='org_admin'
    else:
        from app.models.class_program import ClassInstructor
        pg_session.query(ClassInstructor).filter_by(class_id=parent.id,user_id=host.id).one().status='removed'
    pg_session.commit()
    with pytest.raises(HTTPException):reserve(pg_session,actor,parent,member,rows,reason='합성 사유')
    assert pg_session.query(ClassMakeupAssignment).count()==0


def test_failed_assignment_insert_rolls_back_versions_and_participant(pg_session):
    host, _, parent, clients, member, rows, source=scene(pg_session)
    def fail(mapper,connection,target):raise RuntimeError('합성 예약 저장 실패')
    event.listen(ClassMakeupAssignment,'before_insert',fail)
    try:
        with pytest.raises(RuntimeError):reserve(pg_session,host,parent,member,rows)
    finally:event.remove(ClassMakeupAssignment,'before_insert',fail)
    assert parent.revision==0 and rows[1].participation_version==0
    assert pg_session.query(SessionParticipant).filter_by(session_id=rows[1].id).count()==0
    assert pg_session.query(ClassMakeupAssignment).count()==0
    assert reserve(pg_session,host,parent,member,rows)['assignment']['status']=='reserved'


def test_removed_regular_target_still_conflicts_without_unique_500(pg_session):
    host, _, parent, clients, member, rows, source=scene(pg_session)
    target=SessionParticipant(session_id=rows[1].id,member_id=member.id,user_id=member.user_id,attendance_status='withdrawn',removed_at=NOW)
    pg_session.add(target);pg_session.commit()
    with pytest.raises(HTTPException) as exc:reserve(pg_session,host,parent,member,rows)
    assert exc.value.status_code==409 and exc.value.detail['code']=='target_participant_exists'


def test_cancel_makeup_http_and_reject_entered_cancellation(pg_session,monkeypatch):
    from app.api.v1 import class_membership
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.config import settings
    host, _, parent, clients, member, rows, source=scene(pg_session)
    result=reserve(pg_session,host,parent,member,rows)
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(class_membership.router,prefix='/api/v1')
    app.dependency_overrides[get_current_user]=lambda:{'id':str(clients[0].id)}
    app.dependency_overrides[get_current_user_optional] = app.dependency_overrides[get_current_user]
    app.dependency_overrides[get_db]=lambda:pg_session
    with TestClient(app) as client:
        path=f"/api/v1/classes/{parent.id}/makeup-assignments/{result['assignment']['id']}/cancel"
        body=command(parent)
        response=client.post(path,json=body);assert response.status_code==200,response.text
        assert client.post(path,json=body).json()==response.json()
    result=reserve(pg_session,host,parent,member,rows)
    target=pg_session.get(SessionParticipant,UUID(result['participant']['id']))
    from app.services.class_attendance_service import mark_entered
    rows[1].status='open';pg_session.commit()
    mark_entered(pg_session,rows[1],target,NOW);pg_session.commit()
    with pytest.raises(HTTPException) as exc:service().cancel_makeup(pg_session,host.id,parent.id,result['assignment']['id'],command(parent),now=NOW)
    assert exc.value.status_code==409 and source.attendance_status=='absent'


def test_v35_real_add_session_http_keeps_legacy_users_and_guest_members(pg_session,monkeypatch):
    from app.api.v1 import classes
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.config import settings
    host, _, parent, clients, member, rows, source=scene(pg_session)
    guest=ClassMember(class_id=parent.id,user_id=None,kind='guest',guest_name='합성 HTTP guest',status='active',joined_via='code');pg_session.add(guest);pg_session.flush()
    pg_session.add(SessionParticipant(session_id=rows[0].id,member_id=guest.id,attendance_status='excused'));pg_session.commit()
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(classes.router,prefix='/api/v1')
    app.dependency_overrides[get_current_user]=lambda:{'id':str(host.id)}
    app.dependency_overrides[get_current_user_optional] = app.dependency_overrides[get_current_user]
    app.dependency_overrides[get_db]=lambda:pg_session
    path=f'/api/v1/classes/{parent.id}/sessions'
    with TestClient(app) as client:
        body=legacy_command(parent,host,rows[0],member_ids=[str(clients[0].id)])
        bad=client.post(path,json={**body,'class_member_ids':[str(guest.id)]});assert bad.status_code==422
        response=client.post(path,json=body);assert response.status_code==201,response.text
        assert client.post(path,json=body).json()==response.json()
        guest_body=legacy_command(parent,host,rows[0],class_member_ids=[str(guest.id)])
        guest_body['row']['scheduled_at']='2027-01-05T10:00:00Z'
        response=client.post(path,json=guest_body);assert response.status_code==201,response.text
        target=pg_session.query(SessionParticipant).filter_by(session_id=response.json()['session_ids'][0]).one()
        assert target.member_id==guest.id and target.user_id is None
    assert pg_session.query(ClassMakeupAssignment).count()==2


def test_canonical_alias_source_duplicate_and_rebooking_other_target(pg_session):
    host, _, parent, clients, member, rows, source=scene(pg_session)
    member.kind='guest';member.user_id=None;pg_session.commit()
    alias=ClassMember(class_id=parent.id,user_id=None,kind='guest',guest_name='합성 alias',status='removed',joined_via='code',canonical_member_id=member.id)
    pg_session.add(alias);pg_session.flush();source.member_id=alias.id;source.user_id=None;pg_session.commit()
    result=reserve(pg_session,host,parent,member,rows)
    # 이후 병합으로 유효 참가행이 바뀌어도 과거 alias 원결석의 예약을 놓치지 않는다.
    replacement=SessionParticipant(session_id=rows[0].id,member_id=member.id,user_id=member.user_id,attendance_status='absent')
    pg_session.add(replacement);pg_session.flush();source.superseded_by_participant_id=replacement.id;pg_session.commit()
    with pytest.raises(HTTPException) as exc:reserve(pg_session,host,parent,member,[rows[0],rows[2]])
    assert exc.value.detail['code']=='makeup_already_reserved'
    service().cancel_makeup(pg_session,host.id,parent.id,result['assignment']['id'],command(parent),now=NOW)
    new=reserve(pg_session,host,parent,member,[rows[0],rows[2]])
    assert new['assignment']['source_participant_id']==str(replacement.id)
    assert new['assignment']['target_session_id']==str(rows[2].id)
    assert pg_session.get(ClassMakeupAssignment,UUID(result['assignment']['id'])).status=='cancelled'


def test_completed_makeup_reconnect_and_attendance_correction_derive_completion(pg_session):
    host, _, parent, clients, member, rows, source=scene(pg_session)
    parent.status='completed';parent.schedule_mode='fixed';member.status='completed';pg_session.commit()
    result=reserve(pg_session,host,parent,member,rows)
    target=pg_session.get(SessionParticipant,UUID(result['participant']['id']))
    from app.services.class_attendance_service import mark_entered, eligible_participant, change_attendance
    rows[1].status='open';pg_session.commit()
    mark_entered(pg_session,rows[1],target,NOW);pg_session.commit()
    entered=target.entered_at
    assert eligible_participant(pg_session,target)
    mark_entered(pg_session,rows[1],target,NOW+timedelta(minutes=1));pg_session.commit()
    assert target.entered_at==entered
    assignment=pg_session.get(ClassMakeupAssignment,UUID(result['assignment']['id']))
    assert assignment.status=='completed'
    rows[1].status='completed';pg_session.commit()
    change_attendance(pg_session,host.id,parent.id,rows[1].id,member.id,command(parent,expected_participation_version=rows[1].participation_version,action='correct_absent',reason='합성 정정'),now=NOW)
    assert assignment.status=='reserved' and assignment.completed_at is None
    assert source.attendance_status=='absent' and parent.status=='completed' and member.status=='completed'


@pytest.mark.parametrize('existing',['legacy_user','superseded'])
def test_preserved_target_rows_never_create_duplicate_user_or_member(pg_session,existing):
    host, _, parent, clients, member, rows, source=scene(pg_session)
    survivor=SessionParticipant(session_id=rows[1].id,attendance_status='withdrawn')
    pg_session.add(survivor);pg_session.flush()
    target=SessionParticipant(session_id=rows[1].id,user_id=member.user_id,member_id=None if existing=='legacy_user' else member.id,attendance_status='withdrawn',superseded_by_participant_id=survivor.id if existing=='superseded' else None)
    pg_session.add(target);pg_session.commit()
    with pytest.raises(HTTPException) as exc:reserve(pg_session,host,parent,member,rows)
    assert exc.value.status_code==409 and exc.value.detail['code']=='target_participant_exists'


def test_cancelled_target_reservation_can_cancel_and_rebook(pg_session):
    host, _, parent, clients, member, rows, source=scene(pg_session)
    result=reserve(pg_session,host,parent,member,rows)
    rows[1].status='cancelled';pg_session.commit()
    cancelled=service().cancel_makeup(pg_session,host.id,parent.id,result['assignment']['id'],command(parent),now=NOW)
    assert cancelled['assignment']['status']=='cancelled'
    assert reserve(pg_session,host,parent,member,[rows[0],rows[2]])['assignment']['status']=='reserved'


def test_instructor_retry_rechecks_current_org_membership(pg_session):
    from app.models.user_org_membership import UserOrgMembership
    host, _, parent, clients, member, rows, source=scene(pg_session)
    body=command(parent,member_id=str(member.id),source_session_id=str(rows[0].id),target_session_id=str(rows[1].id))
    service().assign_makeup(pg_session,host.id,parent.id,body,now=NOW)
    pg_session.query(UserOrgMembership).filter_by(user_id=host.id,org_id=parent.organization_id).one().status='inactive';pg_session.commit()
    with pytest.raises(HTTPException) as exc:service().assign_makeup(pg_session,host.id,parent.id,body,now=NOW)
    assert exc.value.status_code==403


def replacement_scene(db, *, two=False):
    """취소 원회차의 명시 대체를 기존 편성 API로 생성한다. 결석 근거는 만들지 않는다."""
    from app.services.class_write_service import add_session
    host, other, parent, clients, member, rows, source=scene(db,state='expected')
    parent.status='completed';parent.schedule_mode='fixed';parent.recurrence_rule={'start_now':True}
    member.status='completed';rows[0].status='cancelled'
    members=[member]
    if two:
        second=ClassMember(class_id=parent.id,user_id=clients[1].id,status='completed',joined_via='code')
        db.add(second);db.flush();members.append(second)
    db.commit()
    result=add_session(db,host.id,parent.id,legacy_command(parent,host,rows[0],member_ids=[str(m.user_id) for m in members]),now=NOW)
    target=db.get(Session,UUID(result['session_ids'][0]))
    participants=db.query(SessionParticipant).filter_by(session_id=target.id).order_by(SessionParticipant.user_id).all()
    return host,parent,members,rows[0],target,participants,source


def test_review_fix1_completed_cancelled_replacement_actual_entry(pg_session,monkeypatch):
    from app.services import session_service as sessions
    from app.services.class_attendance_service import eligible_participant
    host,parent,members,source,target,participants,original=replacement_scene(pg_session)
    target.status='open';pg_session.commit()
    monkeypatch.setattr(sessions,'_notify_participant_changed',lambda *a:None)
    monkeypatch.setattr(sessions,'_notify_promoted',lambda *a:None)
    result=sessions.enter_session_as_invited(str(target.id),str(members[0].user_id),pg_session)
    participant=participants[0]
    assert result['participant_id']==str(participant.id)
    assert participant.attendance_status=='attended' and participant.entered_at is not None
    assert participant.attendance_kind=='regular' and participant.makeup_for_session_id==source.id
    assert eligible_participant(pg_session,participant)
    assert parent.status=='completed' and members[0].status=='completed'
    assert original.attendance_status=='expected'
    assert pg_session.query(ClassMakeupAssignment).count()==0


def test_review_fix1_completed_replacement_reserves_creation_capacity(pg_session):
    from app.services.class_write_service import add_session
    host, _, parent, clients, member, rows, source=scene(pg_session,state='expected')
    parent.status='completed';parent.schedule_mode='fixed';parent.capacity=1
    member.status='completed';rows[0].status='cancelled'
    second=ClassMember(class_id=parent.id,user_id=clients[1].id,status='completed',joined_via='code')
    pg_session.add(second);pg_session.commit()
    with pytest.raises(HTTPException) as exc:
        add_session(pg_session,host.id,parent.id,legacy_command(parent,host,rows[0],member_ids=[str(member.user_id),str(second.user_id)]),now=NOW)
    assert exc.value.detail['code']=='session_capacity'
    assert pg_session.query(Session).filter_by(class_id=parent.id).count()==3
    assert pg_session.query(ClassMakeupAssignment).count()==0


def test_review_fix1_completed_replacement_two_connections_last_seat(scratch_db,monkeypatch):
    from tests.pg.conftest import alembic_ok
    from app.services import session_service as sessions
    from app.services.class_write_service import lock_class_session
    url=scratch_db('replacement_entry_race');alembic_ok(url,'upgrade','head');engine=create_engine(url)
    monkeypatch.setattr(sessions,'_notify_participant_changed',lambda *a:None)
    monkeypatch.setattr(sessions,'_notify_promoted',lambda *a:None)
    try:
        with DBSession(engine) as seed:
            host,parent,members,source,target,participants,original=replacement_scene(seed,two=True)
            target.status='open';target.max_participants=1
            for participant in participants:participant.attendance_status='excused'
            seed.commit()
            ids=(parent.id,target.id,[p.user_id for p in participants],[p.id for p in participants])
        waiting=threading.Event()
        def observed(conn,cursor,statement,parameters,context,many):
            if 'FOR ' in statement:waiting.set()
        with DBSession(engine) as first:
            parent,target=lock_class_session(first,first.get(Session,ids[1]),ids[2][0])
            event.listen(engine,'before_cursor_execute',observed)
            def second():
                with DBSession(engine) as db:
                    from sqlalchemy import text
                    db.execute(text("SET LOCAL lock_timeout='5s'"))
                    try:
                        sessions.enter_session_as_invited(str(ids[1]),str(ids[2][1]),db)
                        return 200
                    except HTTPException as exc:
                        db.rollback();return exc.status_code,exc.detail
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(second)
                assert waiting.wait(5),'다른 실제 연결이 선행 User→Class 잠금에 대기해야 한다'
                try:
                    sessions.enter_session_as_invited(str(ids[1]),str(ids[2][0]),first)
                    winner=200
                except HTTPException as exc:
                    first.rollback();winner=exc.status_code
                loser=future.result(timeout=10)
            assert winner==200 and loser==(409,{'code':'session_capacity'}),(winner,loser)
        with DBSession(engine) as check:
            target=check.get(Session,ids[1]);parent=check.get(Class,ids[0])
            actual=check.query(SessionParticipant).filter_by(session_id=target.id,attendance_status='attended').all()
            assert len(actual)==1
            assert all(check.get(ClassMember,p.member_id).status=='completed' for p in actual)
            assert parent.status=='completed' and check.query(ClassMakeupAssignment).count()==0
    finally:engine.dispose()


@pytest.mark.parametrize('invalid',['no_link','source_completed','foreign_source','source_makeup','regular_target','rolling','left','removed','archived'])
def test_review_fix1_completed_replacement_scope_stays_explicit(pg_session,invalid):
    from app.services.class_attendance_service import eligible_participant
    from app.services.class_membership_service import _occupied_seats
    host,parent,members,source,target,participants,original=replacement_scene(pg_session)
    participant=participants[0]
    if invalid=='no_link':participant.makeup_for_session_id=None
    elif invalid=='source_completed':source.status='completed'
    elif invalid=='foreign_source':
        from tests.pg.sdd216_helpers import world
        _,foreign_host,_,foreign=world(pg_session)
        source.class_id=foreign.id;source.host_id=foreign_host.id
    elif invalid=='source_makeup':source.session_kind='makeup'
    elif invalid=='regular_target':target.session_kind='regular'
    elif invalid=='rolling':parent.schedule_mode='rolling'
    elif invalid in ('left','removed'):members[0].status=invalid
    else:parent.status='archived'
    pg_session.commit()
    assert not eligible_participant(pg_session,participant)
    assert _occupied_seats(pg_session,parent,[participant])==0
    assert pg_session.query(ClassMakeupAssignment).count()==0
