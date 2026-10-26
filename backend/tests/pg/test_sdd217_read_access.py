"""T09: 실제 PG canonical 이력과 본인 읽기 HTTP 경계."""
from datetime import datetime,timedelta,timezone
from uuid import uuid4
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.class_program import ClassMember,ClassInstructor
from app.models.class_membership import ClassMakeupAssignment,ClassAttendanceEvent
from app.models.record import Report
from app.models.session import Session,SessionParticipant
from tests.pg.sdd216_helpers import world,user
pytestmark=pytest.mark.pg
NOW=datetime.now(timezone.utc)

def scene(db):
    org,host,_,cls=world(db);cls.recurrence_rule={'version':1};cls.capacity=8
    owner=user(db,org,role='client')
    m=ClassMember(class_id=cls.id,user_id=owner.id,status='active',joined_via='code',joined_at=NOW-timedelta(days=2),activated_at=NOW-timedelta(days=2))
    db.add(m);db.flush();rows=[]
    for seq,days in enumerate((-4,-1,1,2),1):
        s=Session(type='meditation',class_id=cls.id,host_id=host.id,seq=seq,status='completed' if days<0 else 'scheduled',host_state='assigned',duration_min=60,scheduled_at=NOW+timedelta(days=days),max_participants=8)
        db.add(s);db.flush();rows.append(s)
    db.commit();return org,host,cls,owner,m,rows

def http(db,monkeypatch):
    from app.api.v1 import classes,reports
    from app.config import settings
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(classes.router,prefix='/api/v1');app.include_router(reports.router,prefix='/api/v1');app.dependency_overrides[get_db]=lambda:db
    return TestClient(app)

def bearer(owner):return {'Authorization':f'Bearer {create_access_token(str(owner.id))}'}
def participant(db,m,s,status='attended',**kw):
    p=SessionParticipant(session_id=s.id,member_id=m.id,user_id=m.user_id,attendance_status=status,report_included=True,**kw);db.add(p);db.flush();return p
def report(db,s,p,status='completed',type='client'):
    r=Report(session_id=s.id,participant_id=p.id,user_id=p.user_id,type=type,status=status,content={'title':'합성','audio_s3_key':'private/audio','download_url':'https://invalid.example/private'},pdf_url='https://invalid.example/private.pdf');db.add(r);db.flush();return r

def test_v25_before_join_only_metadata(pg_session,monkeypatch):
    db=pg_session;_,_,cls,o,m,ss=scene(db)
    r=report(db,ss[0],participant(db,m,ss[0]));participant(db,m,ss[1],'absent');db.commit();c=http(db,monkeypatch)
    res=c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=bearer(o));assert res.status_code==200,res.text
    a=res.json()['sessions'];assert len(a)==4 and a[0]['participation_scope']=='before_join' and a[0]['attendance'] is None and a[0]['approved_report_ids']==[] and str(r.id) not in str(a[0])
    assert a[1]['attendance']['attendance_status']=='absent' and a[2]['attendance'] is None
    assert 'score' not in res.text and 'trend' not in res.text
    assert c.get(f'/api/v1/reports/{r.id}',headers=bearer(o)).status_code==404

@pytest.mark.parametrize('state',['completed','left','removed'])
def test_v26_regular_departed_history_and_own_approved_only(pg_session,monkeypatch,state):
    db=pg_session;org,host,cls,o,m,ss=scene(db);p=participant(db,m,ss[1]);own=report(db,ss[1],p)
    other=user(db,org,role='client');om=ClassMember(class_id=cls.id,user_id=other.id,status='active',joined_via='code');db.add(om);db.flush();foreign=report(db,ss[1],participant(db,om,ss[1]))
    m.status=state;setattr(m,{'left':'left_at','removed':'removed_at','completed':'completed_at'}[state],NOW);db.commit();c=http(db,monkeypatch);h=bearer(o)
    res=c.get('/api/v1/classes',headers=h);assert res.status_code==200 and str(cls.id) in [x['id'] for x in res.json()['classes']]
    d=c.get(f'/api/v1/classes/{cls.id}',headers=h);assert d.status_code==200,d.text
    assert d.json()['membership']['status']==state and d.json()['host_view'] is None and d.json()['capabilities']['manage_members'] is False
    for rid,expected in [(own.id,200),(foreign.id,404),(uuid4(),404)]:
        r=c.get(f'/api/v1/reports/{rid}',headers=h);assert r.status_code==expected,r.text
        if expected==200:assert r.json()['pdf_url'] is None and '/private' not in r.text and 'private/audio' not in r.text
    assert c.get(f'/api/v1/classes/{cls.id}/members',headers=h).status_code in (403,404)

def test_v26_unapproved_and_group_never_personal(pg_session,monkeypatch):
    db=pg_session;_,_,cls,o,m,ss=scene(db);pending=report(db,ss[1],participant(db,m,ss[1]),'pending_review')
    group=Report(session_id=ss[1].id,type='counselor',status='completed',content={});db.add(group);db.commit();c=http(db,monkeypatch);h=bearer(o)
    for rid in (pending.id,group.id):assert c.get(f'/api/v1/reports/{rid}',headers=h).status_code==404
    res=c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=h);assert res.status_code==200,res.text
    assert all(not i['approved_report_ids'] for i in res.json()['sessions'])

def test_v27_distinct_counts_and_regular_denominator(pg_session,monkeypatch):
    db=pg_session;_,_,cls,o,m,ss=scene(db);source=participant(db,m,ss[1],'absent');ss[2].session_kind='makeup';ss[2].status='completed'
    target=participant(db,m,ss[2],'attended',attendance_kind='makeup',makeup_for_session_id=ss[1].id);ss[3].status='cancelled';participant(db,m,ss[3],'absent')
    for state in ('cancelled','completed'):db.add(ClassMakeupAssignment(class_id=cls.id,member_id=m.id,source_session_id=ss[1].id,source_participant_id=source.id,target_session_id=ss[2].id,target_participant_id=target.id,status=state))
    for _ in range(3):db.add(ClassAttendanceEvent(class_id=cls.id,session_id=ss[2].id,participant_id=target.id,member_id=m.id,new_status='attended',actor_kind='self',operation_key=str(uuid4())))
    db.commit();c=http(db,monkeypatch);r=c.get(f'/api/v1/classes/{cls.id}/me/membership',headers=bearer(o));assert r.status_code==200,r.text
    assert r.json()['attendance_summary']=={'attended':1,'absent':1,'excused':0,'makeup_reserved':0,'makeup_completed':1}
    assert c.get(f'/api/v1/classes/{cls.id}',headers=bearer(o)).json()['progress']['total']==2

def test_v27_capabilities_role_current_state_admin_no_clinical_permission(pg_session,monkeypatch):
    db=pg_session;org,host,cls,o,m,ss=scene(db);admin=user(db,org,role='org_admin');assistant=user(db,org);db.add(ClassInstructor(class_id=cls.id,user_id=assistant.id,role='assistant'));db.commit();c=http(db,monkeypatch)
    cap=c.get(f'/api/v1/classes/{cls.id}',headers=bearer(admin)).json()['capabilities'];assert cap['manage_members'] and cap['merge_guests'] and not cap['correct_attendance'] and not cap['assign_makeup']
    cap=c.get(f'/api/v1/classes/{cls.id}',headers=bearer(assistant)).json()['capabilities'];assert cap['correct_attendance'] and cap['assign_makeup']
    db.query(ClassInstructor).filter_by(class_id=cls.id,user_id=assistant.id).update({'status':'removed'});db.commit();assert c.get(f'/api/v1/classes/{cls.id}',headers=bearer(assistant)).status_code==404
    r=c.get(f'/api/v1/classes/{cls.id}/me/membership',headers=bearer(o));assert r.status_code==200,r.text
    cap=r.json()['capabilities'];assert all(type(v) is bool for v in cap.values()) and cap['leave'] and cap['edit_consents']
    cls.status='completed';m.status='completed';db.commit();cap=c.get(f'/api/v1/classes/{cls.id}/me/membership',headers=bearer(o)).json()['capabilities'];assert not cap['leave'] and not cap['edit_consents'] and cap['read_own_reports']

def test_v26_guest_alias_history_read_scrub_and_cross_class(pg_session,monkeypatch):
    from app.services.class_guest_service import issue_bundle
    db=pg_session;_,_,cls,_,_,ss=scene(db)
    m=ClassMember(class_id=cls.id,kind='guest',status='left',joined_via='code',joined_at=NOW-timedelta(days=3),left_at=NOW,pii_scrubbed_at=NOW,guest_name='노출금지');db.add(m);db.flush()
    alias=ClassMember(class_id=cls.id,kind='guest',status='removed',joined_via='code',canonical_member_id=m.id,joined_at=NOW-timedelta(days=3),guest_name='원본비밀');other=ClassMember(class_id=cls.id,kind='guest',status='active',joined_via='code');db.add_all([alias,other]);db.flush()
    ap=participant(db,alias,ss[1]);r=report(db,ss[1],ap);foreign=report(db,ss[1],participant(db,other,ss[1]));token=issue_bundle(db,cls,m,now=NOW)['read_credential'];db.commit();c=http(db,monkeypatch);h={'X-Class-Member-Credential':token}
    res=c.get(f'/api/v1/classes/{cls.id}/me/membership',headers=h);assert res.status_code==200,res.text
    assert res.json()['member']['name'] is None and '원본비밀' not in res.text and '노출금지' not in res.text
    res=c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=h);assert res.status_code==200,res.text
    assert res.json()['sessions'][1]['approved_report_ids']==[str(r.id)] and res.json()['sessions'][1]['attendance']['member_id']==str(alias.id)
    assert c.get(f'/api/v1/reports/{r.id}',headers=h).status_code==200
    assert c.get(f'/api/v1/reports/{foreign.id}',headers=h).status_code==404
    assert c.get(f'/api/v1/classes/{cls.id}/members',headers=h).status_code==401
    _,_,_,foreign_cls=world(db);db.commit();assert c.get(f'/api/v1/classes/{foreign_cls.id}/me/attendance',headers=h).status_code in (401,404)
    cls.hidden_at=NOW;db.commit();assert c.get(f'/api/v1/reports/{r.id}',headers=h).status_code in (401,404)

def test_v25_existing_sessions_dto_additive_and_session_capability(pg_session,monkeypatch):
    db=pg_session;_,_,cls,o,m,ss=scene(db);participant(db,m,ss[2],'expected');db.commit();c=http(db,monkeypatch)
    res=c.get(f'/api/v1/classes/{cls.id}/sessions',headers=bearer(o));assert res.status_code==200,res.text
    data=res.json();assert data['total']==4
    old={'id','seq','scheduled_at','status','session_kind','host','host_state','state_version','duration_min','location_type','location_address','assignment_override'}
    assert old.issubset(data['sessions'][0])
    assert data['sessions'][0]['participation_scope']=='before_join' and data['sessions'][0]['attendance'] is None
    assert data['sessions'][2]['attendance']['attendance_status']=='expected' and data['sessions'][2]['capabilities']['excuse'] is True
    assert not data['sessions'][1]['capabilities']['excuse']


def test_v26_counselor_enrolled_as_member_cannot_bypass_own_scope(pg_session,monkeypatch):
    db=pg_session;org,host,cls,o,m,ss=scene(db);o.role='counselor'
    from app.models.user_org_membership import UserOrgMembership
    db.query(UserOrgMembership).filter_by(user_id=o.id,org_id=org.id).update({'role':'counselor'})
    p=participant(db,m,ss[1]);r=report(db,ss[1],p);db.commit();c=http(db,monkeypatch)
    response=c.get(f'/api/v1/reports/{r.id}',headers=bearer(o));assert response.status_code==200,response.text
    pending=report(db,ss[2],participant(db,m,ss[2]),'pending_review');db.commit()
    assert c.get(f'/api/v1/reports/{pending.id}',headers=bearer(o)).status_code==404


def test_v26_different_org_unapproved_guest_and_logout(pg_session,monkeypatch):
    from app.services.class_guest_service import issue_bundle,logout_guest
    db=pg_session;_,_,cls,o,m,ss=scene(db);p=participant(db,m,ss[1]);r=report(db,ss[1],p)
    _,_,other,foreign=world(db);foreign.recurrence_rule={'version':1};db.commit();c=http(db,monkeypatch)
    assert c.get(f'/api/v1/reports/{r.id}',headers=bearer(other)).status_code==404
    guest=ClassMember(class_id=cls.id,kind='guest',status='completed',joined_via='code',joined_at=NOW-timedelta(days=3));db.add(guest);db.flush()
    gr=report(db,ss[1],participant(db,guest,ss[1]),'pending_review');token=issue_bundle(db,cls,guest,now=NOW)['read_credential'];db.commit();h={'X-Class-Member-Credential':token}
    assert c.get(f'/api/v1/reports/{gr.id}',headers=h).status_code==404
    logout_guest(db,cls.id,token,now=NOW)
    assert c.get(f'/api/v1/classes/{cls.id}/me/membership',headers=h).status_code==401

def test_v27_actual_merge_two_histories_distinct_attendance_and_original_fk(pg_session,monkeypatch):
    from app.services import class_guest_service as guests
    db=pg_session;_,host,cls,_,_,ss=scene(db);cls.access_code='0217';db.commit()
    def join():return guests.join_guest(db,cls.id,{'operation_key':str(uuid4()),'code':'0217','guest_name':'합성','gender':'other','birth_date':'2000-01-01','report_email':'synthetic@example.com','report_included':False},now=NOW-timedelta(days=10))
    a,b=join(),join();ma=db.get(ClassMember,__import__('uuid').UUID(a['member']['id']));mb=db.get(ClassMember,__import__('uuid').UUID(b['member']['id']))
    p=participant(db,ma,ss[0]);q=participant(db,mb,ss[1]);r=report(db,ss[0],p);t=report(db,ss[1],q);db.commit()
    original=(p.id,p.member_id,q.id,q.member_id,r.id,r.participant_id,t.id,t.participant_id)
    preview=guests.preview_merge(db,host.id,cls.id,ma.id,mb.id,reason='합성 본인 확인')
    assert not preview['conflicts']
    guests.merge_guests(db,host.id,cls.id,{'operation_key':str(uuid4()),'expected_revision':cls.revision,'source_member_id':str(ma.id),'target_member_id':str(mb.id),'confirmed_preview_fingerprint':preview['preview_fingerprint'],'identity_confirmed':True,'reason':'합성 본인 확인'},now=NOW)
    token=guests.issue_bundle(db,cls,mb,now=NOW)['read_credential'];db.commit();api=http(db,monkeypatch);h={'X-Class-Member-Credential':token}
    response=api.get(f'/api/v1/classes/{cls.id}/me/membership',headers=h);assert response.status_code==200,response.text
    assert response.json()['attendance_summary']['attended']==2
    response=api.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=h);assert response.status_code==200,response.text
    ids={rid for row in response.json()['sessions'] for rid in row['approved_report_ids']};assert ids=={str(r.id),str(t.id)}
    for rid in ids:assert api.get(f'/api/v1/reports/{rid}',headers=h).status_code==200
    assert original==(p.id,p.member_id,q.id,q.member_id,r.id,r.participant_id,t.id,t.participant_id)
    assert api.get(f'/api/v1/classes/{cls.id}/me/membership',headers={'X-Class-Member-Credential':a['credential_bundle']['read_credential']}).status_code==401

def test_v27_makeup_capability_needs_distinct_target_and_hidden_is_404(pg_session,monkeypatch):
    db=pg_session;_,_,cls,o,m,ss=scene(db);participant(db,m,ss[2],'excused');ss[3].status='cancelled'
    approved=report(db,ss[1],participant(db,m,ss[1]));db.commit();api=http(db,monkeypatch);h=bearer(o)
    res=api.get(f'/api/v1/classes/{cls.id}/me/membership',headers=h);assert res.status_code==200,res.text
    assert res.json()['capabilities']['request_makeup'] is False
    cls.hidden_at=NOW;db.commit()
    assert api.get(f'/api/v1/reports/{approved.id}',headers=h).status_code==404

@pytest.mark.parametrize('guest',[False,True])
@pytest.mark.parametrize('replacement',[False,True])
def test_review_fix1_completed_assigned_makeup_visible_but_unassigned_outside(pg_session,monkeypatch,guest,replacement):
    from app.services import class_guest_service as guests
    db=pg_session;_,_,cls,o,m,ss=scene(db)
    cls.status='completed';m.status='completed';m.completed_at=NOW-timedelta(minutes=2)
    if guest:m.user_id=None;m.kind='guest'
    ss[2].session_kind='makeup'
    source=participant(db,m,ss[1],'absent')
    target=participant(db,m,ss[2],'expected',attendance_kind='regular' if replacement else 'makeup',makeup_for_session_id=ss[1].id)
    unassigned=participant(db,m,ss[3],'expected')
    assignment=None
    if replacement:ss[1].status='cancelled'
    else:
        assignment=ClassMakeupAssignment(class_id=cls.id,member_id=m.id,source_session_id=ss[1].id,source_participant_id=source.id,target_session_id=ss[2].id,target_participant_id=target.id,status='reserved')
        db.add(assignment)
    db.flush()
    token=guests.issue_bundle(db,cls,m,now=NOW)['read_credential'] if guest else None
    db.commit();api=http(db,monkeypatch);headers={'X-Class-Member-Credential':token} if guest else bearer(o)
    result=api.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=headers)
    assert result.status_code==200,result.text
    rows={row['id']:row for row in result.json()['sessions']};visible=rows[str(ss[2].id)]
    assert visible['participation_scope']=='eligible' and visible['attendance']['id']==str(target.id)
    if assignment:assert visible['makeup']['id']==str(assignment.id)
    else:assert visible['attendance']['makeup_for_session_id']==str(ss[1].id)
    assert rows[str(ss[3].id)]['participation_scope']=='outside_membership' and rows[str(ss[3].id)]['attendance'] is None
    if guest:
        ss[2].status='open';ss[2].scheduled_at=NOW-timedelta(seconds=1);db.commit()
        result=guests.guest_entry(db,cls.id,ss[2].id,token,{'operation_key':str(uuid4()),'expected_revision':cls.revision},now=NOW)
        assert result['entry_credential'] and m.status==cls.status=='completed'


@pytest.mark.parametrize('blocker',['regular_expected','alias_expected','superseded','capacity'])
def test_review_fix1_makeup_capability_matches_actual_reservation_blockers(pg_session,monkeypatch,blocker):
    from fastapi import HTTPException
    from app.services.class_makeup_service import reserve_locked,lock_context
    db=pg_session;_,_,cls,o,m,ss=scene(db);participant(db,m,ss[1],'absent');ss[3].status='cancelled'
    if blocker in ('regular_expected','alias_expected','superseded'):
        if blocker=='alias_expected':
            m.user_id=None;m.kind='guest'
            alias=ClassMember(class_id=cls.id,kind='guest',status='removed',joined_via='code',canonical_member_id=m.id)
            db.add(alias);db.flush();p=participant(db,alias,ss[2],'expected')
        else:p=participant(db,m,ss[2],'expected')
        if blocker=='superseded':
            other=ClassMember(class_id=cls.id,kind='guest',status='active',joined_via='code');db.add(other);db.flush()
            successor=participant(db,other,ss[2],'withdrawn');p.superseded_by_participant_id=successor.id
    else:
        ss[2].max_participants=1
        other=ClassMember(class_id=cls.id,kind='guest',status='active',joined_via='code');db.add(other);db.flush();participant(db,other,ss[2],'expected')
    db.commit()
    from app.services.class_read_service import get_my_membership
    if blocker=='alias_expected':
        from app.services.class_guest_service import issue_bundle
        token=issue_bundle(db,cls,m,now=NOW)['activity_credential'];db.commit()
        actual=get_my_membership(db,cls.id,member_credential=token,now=NOW)
    else:actual=get_my_membership(db,cls.id,user_id=o.id,now=NOW)
    assert actual['capabilities']['request_makeup'] is False
    _,participants=lock_context(db,cls)
    with pytest.raises(HTTPException) as error:reserve_locked(db,cls,m,ss[1],ss[2],participants,NOW)
    assert error.value.detail['code']==('session_capacity' if blocker=='capacity' else 'target_participant_exists')


def test_review_fix1_reusable_withdrawn_makeup_capability_matches_reserve(pg_session,monkeypatch):
    from app.services.class_makeup_service import reserve_locked,lock_context
    from app.services.class_read_service import get_my_membership
    db=pg_session;_,_,cls,o,m,ss=scene(db);participant(db,m,ss[1],'absent');ss[3].status='cancelled'
    target=participant(db,m,ss[2],'withdrawn',attendance_kind='makeup');db.commit()
    before=(m.entry_ver,cls.revision,ss[2].participation_version,target.entry_ver,db.query(ClassMakeupAssignment).count())
    assert get_my_membership(db,cls.id,user_id=o.id,now=NOW)['capabilities']['request_makeup'] is True
    assert before==(m.entry_ver,cls.revision,ss[2].participation_version,target.entry_ver,db.query(ClassMakeupAssignment).count())
    _,participants=lock_context(db,cls);assignment,participant_row=reserve_locked(db,cls,m,ss[1],ss[2],participants,NOW)
    assert participant_row.id==target.id and assignment.status=='reserved'

# T10 화면은 상태 추측 대신 현재 서버 capability를 사용한다.
def test_t10_undo_excuse_capability_capacity_and_read_scope(pg_session,monkeypatch):
    from app.services.class_guest_service import issue_bundle
    db=pg_session;org,_,cls,o,m,ss=scene(db);participant(db,m,ss[2],'excused');db.commit();c=http(db,monkeypatch)
    def caps(h):
        result=c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=h);assert result.status_code==200,result.text
        return result.json()['sessions'][2]['capabilities']
    assert caps(bearer(o))['undo_excuse'] is True
    assert caps(bearer(o))['excuse'] is False
    other=user(db,org,role='client');om=ClassMember(class_id=cls.id,user_id=other.id,status='active',joined_via='code');db.add(om);db.flush();participant(db,om,ss[2],'expected');ss[2].max_participants=1;db.commit()
    assert caps(bearer(o))['undo_excuse'] is False
    ss[2].max_participants=8;m.kind='guest';m.user_id=None;bundle=issue_bundle(db,cls,m);db.commit()
    assert caps({'X-Class-Member-Credential':bundle['activity_credential']})['undo_excuse'] is True
    assert caps({'X-Class-Member-Credential':bundle['read_credential']})['undo_excuse'] is False


def test_t10_cancel_makeup_capability_does_not_require_another_reservation(pg_session,monkeypatch):
    db=pg_session;_,_,cls,o,m,ss=scene(db);source=participant(db,m,ss[1],'absent');target=participant(db,m,ss[2],'expected',attendance_kind='makeup',makeup_for_session_id=ss[1].id)
    ss[3].status='cancelled';a=ClassMakeupAssignment(class_id=cls.id,member_id=m.id,source_session_id=ss[1].id,source_participant_id=source.id,target_session_id=ss[2].id,target_participant_id=target.id,status='reserved');db.add(a);db.commit();c=http(db,monkeypatch)
    h=bearer(o);data=c.get(f'/api/v1/classes/{cls.id}/me/membership',headers=h).json();assert data['capabilities']['request_makeup'] is False
    assert data['capabilities']['cancel_makeup'] is True
    items=c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=h).json()['sessions'];assert items[2]['capabilities']['cancel_makeup'] is True
    target.entered_at=NOW;db.commit();assert c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=h).json()['sessions'][2]['capabilities']['cancel_makeup'] is False


def test_t10_guest_entry_capability_activity_read_and_completed_replacement(pg_session,monkeypatch):
    from app.services.class_guest_service import issue_bundle
    db=pg_session;_,_,cls,_,m,ss=scene(db);m.kind='guest';m.user_id=None;ss[2].status='open';p=participant(db,m,ss[2],'expected');bundle=issue_bundle(db,cls,m);db.commit();c=http(db,monkeypatch)
    def cap(token):return c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers={'X-Class-Member-Credential':token}).json()['sessions'][2]['capabilities']['guest_entry']
    assert cap(bundle['activity_credential']) is True
    assert cap(bundle['read_credential']) is False
    m.status='completed';m.completed_at=NOW;cls.status='completed';cls.schedule_mode='fixed';ss[1].status='cancelled';ss[2].session_kind='makeup';ss[2].makeup_for_session_id=ss[1].id;p.makeup_for_session_id=ss[1].id;bundle=issue_bundle(db,cls,m);db.commit()
    actual=cap(bundle['read_credential']);assert actual is True
    p.waitlist_cancelled_at=NOW;db.commit();assert cap(bundle['read_credential']) is False


def test_t10_resolve_code_exposes_only_additive_revision(pg_session):
    from app.services.class_code_service import resolve_class_code
    db=pg_session;_,_,cls,_,_,_=scene(db);cls.access_code='1234';cls.revision=9;db.commit()
    data=resolve_class_code(db,'1234');assert data['revision']==9
    assert set(data)=={'class_id','title','sessions','next_session','revision'}

def test_t10_cancelled_target_keeps_cancellable_reservation_without_counting_it(pg_session,monkeypatch):
    db=pg_session;_,_,cls,o,m,ss=scene(db);source=participant(db,m,ss[1],'absent');ss[2].status='cancelled';target=participant(db,m,ss[2],'expected',attendance_kind='makeup',makeup_for_session_id=ss[1].id)
    a=ClassMakeupAssignment(class_id=cls.id,member_id=m.id,source_session_id=ss[1].id,source_participant_id=source.id,target_session_id=ss[2].id,target_participant_id=target.id,status='reserved');db.add(a);db.commit();c=http(db,monkeypatch);h=bearer(o)
    data=c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=h).json()['sessions'][2]
    assert data['capabilities']['cancel_makeup'] is True
    assert data['makeup']['id']==str(a.id)
    summary=c.get(f'/api/v1/classes/{cls.id}/me/membership',headers=h).json()['attendance_summary'];assert summary['makeup_reserved']==0


def test_instant_joined_during_session_reads_own_report(pg_session,monkeypatch):
    """즉석 클래스: 회차 scheduled_at(생성 시각) 뒤에 가입해 진행 중 입장·출석한 회원은 본인 리포트를 연다."""
    db=pg_session;_,_,cls,o,m,ss=scene(db)
    s=ss[0];s.scheduled_at=NOW-timedelta(hours=1);s.started_at=NOW-timedelta(hours=1);s.ended_at=NOW-timedelta(minutes=10)
    m.joined_at=NOW-timedelta(minutes=50);m.activated_at=m.joined_at
    r=report(db,s,participant(db,m,s));db.commit();c=http(db,monkeypatch)
    res=c.get(f'/api/v1/reports/{r.id}',headers=bearer(o));assert res.status_code==200,res.text
    a=c.get(f'/api/v1/classes/{cls.id}/me/attendance',headers=bearer(o)).json()['sessions']
    assert a[0]['participation_scope']=='eligible'


def test_class_member_report_marks_read_on_open(pg_session,monkeypatch):
    """[MB261022][FIX] 클래스 회원 본인 리포트를 열면 is_read=true — 하단 탭 배지·NEW 가 남지 않는다."""
    db=pg_session;org,host,cls,o,m,ss=scene(db);p=participant(db,m,ss[1]);own=report(db,ss[1],p)
    other=user(db,org,role='client');om=ClassMember(class_id=cls.id,user_id=other.id,status='active',joined_via='code');db.add(om);db.flush();foreign=report(db,ss[1],participant(db,om,ss[1]))
    pending=report(db,ss[0],participant(db,m,ss[0]),status='pending_review');db.commit();c=http(db,monkeypatch);h=bearer(o)
    assert own.is_read is False
    r=c.get(f'/api/v1/reports/{own.id}',headers=h);assert r.status_code==200,r.text
    db.refresh(own);assert own.is_read is True
    lst=c.get('/api/v1/reports',headers=h);assert lst.status_code==200,lst.text
    row=[x for x in lst.json()['reports'] if x['id']==str(own.id)];assert row and row[0]['is_read'] is True
    # 남의 리포트·승인 전 리포트는 읽음 처리하지 않는다
    assert c.get(f'/api/v1/reports/{foreign.id}',headers=h).status_code==404
    assert c.get(f'/api/v1/reports/{pending.id}',headers=h).status_code==404
    db.refresh(foreign);db.refresh(pending);assert foreign.is_read is False and pending.is_read is False
