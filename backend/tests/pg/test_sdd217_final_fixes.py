"""최종 통합 리뷰 네 지적사항의 실제 PG·HTTP 회귀."""
from datetime import timedelta
from uuid import UUID, uuid4
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session as DBSession
from app.models.class_membership import ClassAttendanceEvent, ClassMakeupAssignment
from app.models.class_program import Class, ClassInstructor, ClassMember
from app.models.session import Session, SessionParticipant
from tests.pg.test_sdd217_membership import NOW, command
from tests.pg.test_sdd217_completion import instant, external_boundaries
from tests.pg.test_sdd217_makeup import scene, reserve
pytestmark = pytest.mark.pg

@pytest.mark.parametrize('guest', [False, True])
def test_completed_owner_entry_state_and_after_checkin(pg_session, guest):
    from app.api.v1 import session as session_api, records
    from app.api.deps import get_current_user, get_current_user_optional
    from app.core.database import get_db
    from app.services import session_service as service
    from app.services.entry_credential_service import issue
    host, cls, member, row, p = instant(pg_session)
    owner = str(member.user_id)
    if guest: member.kind='guest'; member.user_id=None; p.user_id=None
    p.attendance_status='attended'; p.entered_at=NOW; pg_session.commit()
    token,_=issue(p)
    app=FastAPI(); app.include_router(session_api.router,prefix='/api/v1'); app.include_router(records.router,prefix='/api/v1')
    app.dependency_overrides[get_current_user_optional]=lambda: {'id':owner} if not guest else None
    app.dependency_overrides[get_db]=lambda:pg_session
    app.dependency_overrides[get_current_user]=lambda:{'id':str(host.id)}
    headers={'X-Entry-Credential':token} if guest else {}
    body={'phase':'after','participant_id':str(p.id),'arousal':3,'valence':3}
    with TestClient(app) as c:
        ended=c.post(f'/api/v1/sessions/{row.id}/end')
        assert ended.status_code==200,ended.text
        assert member.status=='completed'
        r=c.get(f'/api/v1/sessions/{row.id}/entry-state',headers=headers)
        assert r.status_code==200,r.text
        assert r.json()['ended'] and r.json()['participant_id']==str(p.id)
        r=c.post(f'/api/v1/sessions/{row.id}/checkin',json=body,headers=headers)
        assert r.status_code==200,r.text
        assert r.json()['subjective_state']['after']['arousal']==3
        assert c.post(f'/api/v1/sessions/{row.id}/checkin',json={**body,'phase':'before'},headers=headers).status_code==403
        assert c.post(f'/api/v1/sessions/{row.id}/checkin',json={**body,'participant_id':str(uuid4())},headers=headers).status_code==403
        with pytest.raises(HTTPException): service.participant_livekit_token(str(row.id),pg_session,current_user_id=None if guest else owner,entry_credential=token if guest else None)
        for status in ('left','removed'):
            member.status=status;pg_session.commit()
            assert c.get(f'/api/v1/sessions/{row.id}/entry-state',headers=headers).status_code==403
            assert c.post(f'/api/v1/sessions/{row.id}/checkin',json=body,headers=headers).status_code==403

@pytest.mark.parametrize('action',['undo_excuse','enter','correct_attended','correct_completed'])
def test_makeup_source_invalidation_is_atomic_conflict(pg_session,action):
    from app.services import class_attendance_service as attendance, session_service
    db=pg_session;host,_,cls,clients,member,rows,source=scene(db,state='excused' if action in ('undo_excuse','enter') else 'absent')
    if action in ('undo_excuse','enter'): rows[0].status='scheduled';rows[0].scheduled_at=NOW+timedelta(days=1)
    db.commit();result=reserve(db,clients[0],cls,member,rows)
    assignment=db.get(ClassMakeupAssignment,UUID(result['assignment']['id']))
    if action=='correct_completed':
        target=db.get(SessionParticipant,assignment.target_participant_id);rows[1].status='open';db.commit()
        attendance.mark_entered(db,rows[1],target,NOW);db.commit();assert assignment.status=='completed'
    if action=='enter':rows[0].status='open';db.commit()
    before=(source.attendance_status,source.entered_at,rows[0].participation_version,assignment.status,assignment.completed_at)
    events=db.query(ClassAttendanceEvent).count()
    with pytest.raises(HTTPException) as exc:
        if action=='enter':session_service._enter_resolved(rows[0],db,user_id=str(clients[0].id),require_invite=True)
        else: attendance.change_attendance(db,clients[0].id if action=='undo_excuse' else host.id,cls.id,rows[0].id,member.id,command(cls,action='undo_excuse' if action=='undo_excuse' else 'correct_attended',expected_participation_version=rows[0].participation_version,reason='강사 확인'),now=NOW)
    assert exc.value.status_code==409 and exc.value.detail['code']=='makeup_source_in_use'
    db.rollback();db.expire_all()
    assert (source.attendance_status,source.entered_at,rows[0].participation_version,assignment.status,assignment.completed_at)==before
    assert db.query(ClassAttendanceEvent).count()==events

def test_cancel_makeup_then_undo_excuse_allowed(pg_session):
    from app.services import class_attendance_service as attendance,class_makeup_service as makeup
    db=pg_session;host,_,cls,clients,member,rows,source=scene(db,state='excused')
    rows[0].status='scheduled';rows[0].scheduled_at=NOW+timedelta(days=1);db.commit()
    result=reserve(db,clients[0],cls,member,rows)
    makeup.cancel_makeup(db,clients[0].id,cls.id,result['assignment']['id'],command(cls),now=NOW)
    attendance.change_attendance(db,clients[0].id,cls.id,rows[0].id,member.id,command(cls,action='undo_excuse',expected_participation_version=rows[0].participation_version),now=NOW)
    assert source.attendance_status=='expected'

@pytest.mark.parametrize('role',['lead','assistant','guest'])
def test_staff_correction_uses_sessions_version_without_full_participation(pg_session,monkeypatch,role):
    from app.api.v1 import classes,class_membership
    from app.api.deps import get_current_user,get_current_user_optional
    from app.core.database import get_db
    from app.config import settings
    from app.models.organization import Organization
    from tests.pg.sdd216_helpers import user
    db=pg_session;lead,other,cls,clients,member,rows,source=scene(db)
    cls.recurrence_rule={'version':1};db.add(ClassInstructor(class_id=cls.id,user_id=other.id,role='guest',scope_session_id=rows[0].id));rows[0].host_id=other.id
    assistant=user(db,db.get(Organization,cls.organization_id));db.add(ClassInstructor(class_id=cls.id,user_id=assistant.id,role='assistant'))
    rows[0].participation_version=7;db.commit();actor={'lead':lead,'assistant':assistant,'guest':other}[role]
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(classes.router,prefix='/api/v1');app.include_router(class_membership.router,prefix='/api/v1')
    app.dependency_overrides[get_db]=lambda:db;app.dependency_overrides[get_current_user]=lambda:{'id':str(actor.id)}
    app.dependency_overrides[get_current_user_optional]=app.dependency_overrides[get_current_user]
    with TestClient(app) as c:
        r=c.get(f'/api/v1/classes/{cls.id}/sessions');assert r.status_code==200,r.text
        item=next(s for s in r.json()['sessions'] if s['id']==str(rows[0].id))
        assert item['capabilities']['correct_attendance'] and item.get('participation_version')==7
        r=c.get(f'/api/v1/classes/{cls.id}/sessions/{rows[0].id}/participation');assert r.status_code==(200 if role=='guest' else 403),r.text
        body=command(cls,action='correct_attended',expected_participation_version=item['participation_version'],reason='정정 확인')
        path=f'/api/v1/classes/{cls.id}/sessions/{rows[0].id}/members/{member.id}/attendance'
        r=c.post(path,json=body);assert r.status_code==200,r.text;assert c.post(path,json=body).json()==r.json()

def test_upgrade_preserves_legacy_session_choices_on_default_change(scratch_db):
    from tests.pg.conftest import alembic_ok
    from tests.pg.test_sdd214_schema import mk_user,mk_class,mk_instructor,mk_session,mk_participant
    from app.services.class_member_consent_service import update_consents
    from app.models.research import ResearchConsent
    url=scratch_db('sdd217_legacy_consent');alembic_ok(url,'upgrade','e036a0000056');engine=create_engine(url);mid=str(uuid4())
    try:
        with engine.begin() as conn:
            host=mk_user(conn);owner=mk_user(conn);cid=mk_class(conn,host);mk_instructor(conn,cid,host)
            conn.execute(text("UPDATE classes SET status='active', revision=1 WHERE id=:id"),{'id':cid})
            conn.execute(text("INSERT INTO class_members (id,class_id,user_id,kind,status,joined_via,report_included_default,entry_ver) VALUES (:id,:cid,:uid,'member','active','code',false,0)"),{'id':mid,'cid':cid,'uid':owner})
            participant_ids=[]
            for seq in range(1,5):
                sid=mk_session(conn,host,class_id=cid,seq=seq,host_state='assigned')
                conn.execute(text("UPDATE sessions SET status='scheduled',scheduled_at=:at WHERE id=:id"),{'at':NOW+timedelta(days=seq),'id':sid})
                pid=mk_participant(conn,sid,user_id=owner);participant_ids.append(pid)
                conn.execute(text('UPDATE session_participants SET member_id=:mid,report_included=:choice WHERE id=:id'),{'mid':mid,'choice':seq==1,'id':pid})
                if seq in (1,2,3):
                    conn.execute(text("INSERT INTO research_consents (id,session_id,participant_id,consented,notice_version,consented_at,withdrawn_at,export_state) VALUES (:id,:sid,:pid,:choice,'legacy-v1',:selected,:withdrawn,:state)"),{'id':str(uuid4()),'sid':sid,'pid':pid,'choice':seq==1,'selected':NOW-timedelta(days=2) if seq in (1,3) else None,'withdrawn':NOW-timedelta(days=1) if seq==3 else None,'state':'withdrawn' if seq==3 else 'not_applicable'})
                if seq==2:conn.execute(text("INSERT INTO report_choice_events (id,session_id,participant_id,previous_included,new_included,actor_kind) VALUES (:id,:sid,:pid,true,false,'self')"),{'id':str(uuid4()),'sid':sid,'pid':pid})
        alembic_ok(url,'upgrade','head');alembic_ok(url,'upgrade','head')
        with DBSession(engine) as db:
            member=db.get(ClassMember,UUID(mid));cls=db.get(Class,UUID(cid));assert member.research_consented is False and member.research_origin_id is None
            original=[(p.id,p.report_included) for p in db.query(SessionParticipant).order_by(SessionParticipant.id)]
            evidence=[(r.id,r.consented,r.consented_at,r.withdrawn_at,r.notice_version,r.export_state) for r in db.query(ResearchConsent).order_by(ResearchConsent.id)]
            update_consents(db,cid,command(cls,report_included_default=True,notice_version='class-team-v1',research_consented=True,research_notice_version='research-v1'),user_id=owner,now=NOW);db.expire_all()
            assert [(p.id,p.report_included) for p in db.query(SessionParticipant).order_by(SessionParticipant.id)]==original
            assert [(r.id,r.consented,r.consented_at,r.withdrawn_at,r.notice_version,r.export_state) for r in db.query(ResearchConsent).order_by(ResearchConsent.id)]==evidence
            update_consents(db,cid,command(cls,report_included_default=False,research_consented=False),user_id=owner,now=NOW);db.expire_all()
            assert [(p.id,p.report_included) for p in db.query(SessionParticipant).order_by(SessionParticipant.id)]==original
            assert [(r.id,r.consented,r.consented_at,r.withdrawn_at,r.notice_version,r.export_state) for r in db.query(ResearchConsent).order_by(ResearchConsent.id)]==evidence
            assert all(p.report_consent_override and p.research_consent_override for p in db.query(SessionParticipant))
            assert db.query(ResearchConsent).filter_by(participant_id=UUID(participant_ids[3])).count()==0
            new=SessionParticipant(session_id=UUID(sid));db.add(new);db.flush();assert not new.report_consent_override and not new.research_consent_override
    finally:engine.dispose()

@pytest.mark.parametrize('action',['leave','remove'])
def test_departure_preserves_makeup_source_and_revokes_access(pg_session,action):
    from app.services import class_membership_service as membership, class_attendance_service as attendance
    db=pg_session;host,_,cls,clients,member,rows,source=scene(db,state='excused')
    rows[0].status='scheduled';rows[0].scheduled_at=NOW+timedelta(days=1);rows[1].session_kind='makeup';db.commit()
    result=reserve(db,clients[0],cls,member,rows);assignment=db.get(ClassMakeupAssignment,UUID(result['assignment']['id']))
    target=db.get(SessionParticipant,assignment.target_participant_id);old_version=source.entry_ver
    membership.transition_membership(db,clients[0].id if action=='leave' else host.id,cls.id,member.id,command(cls,action=action),now=NOW)
    assert member.status==('left' if action=='leave' else 'removed')
    assert source.attendance_status=='excused' and source.entry_ver>old_version
    assert target.attendance_status=='withdrawn' and assignment.status=='reserved'
    assert not attendance.eligible_participant(db,source) and not attendance.eligible_participant(db,target)
    assert membership._occupied_seats(db,cls,[source,target])==0
    membership.transition_membership(db,clients[0].id if action=='leave' else host.id,cls.id,member.id,command(cls,action='rejoin' if action=='leave' else 'restore'),now=NOW)
    assert member.status=='active' and source.attendance_status=='excused' and assignment.status=='reserved'
    assert target.attendance_status=='withdrawn'
    from app.services.class_read_service import get_my_attendance
    from app.services.class_makeup_service import cancel_makeup
    dto=get_my_attendance(db,cls.id,user_id=clients[0].id)
    target_item=next(item for item in dto['sessions'] if item['id']==str(rows[1].id))
    assert target_item['capabilities']['cancel_makeup'] is True
    cancel_makeup(db,clients[0].id,cls.id,assignment.id,command(cls),now=NOW)
    attendance.change_attendance(db,clients[0].id,cls.id,rows[0].id,member.id,command(cls,action='undo_excuse',expected_participation_version=rows[0].participation_version),now=NOW)
    assert source.attendance_status=='expected' and assignment.status=='cancelled'



def test_explicit_reinvite_cannot_erase_reserved_source(pg_session):
    from app.services import class_membership_service as membership
    db=pg_session;host,_,cls,clients,member,rows,source=scene(db,state='excused')
    rows[0].status='scheduled';rows[0].scheduled_at=NOW+timedelta(days=1);db.commit()
    result=reserve(db,clients[0],cls,member,rows)
    membership.transition_membership(db,host.id,cls.id,member.id,command(cls,action='remove'),now=NOW)
    with pytest.raises(HTTPException) as exc:
        membership.invite_members(db,cls,[clients[0].id],host.id,NOW,reactivate=True)
    assert exc.value.status_code==409 and exc.value.detail['code']=='makeup_source_in_use'
    db.rollback();db.expire_all()
    assert member.status=='removed' and source.attendance_status=='excused'
    assert db.get(ClassMakeupAssignment,UUID(result['assignment']['id'])).status=='reserved'
