"""T07: guest 자격·복구·병합의 실제 PostgreSQL 검증."""
from datetime import datetime,timedelta,timezone
from uuid import UUID,uuid4
import pytest
from fastapi import HTTPException
from app.models.class_program import ClassMember
from app.models.class_membership import ClassGuestCredential,ClassGuestMerge,ClassGuestRecovery
from app.models.session import Session,SessionParticipant
from app.models.record import Report
from tests.pg.sdd216_helpers import world
pytestmark=pytest.mark.pg
NOW=datetime.now(timezone.utc)
def api():
    from app.services import class_guest_service
    return class_guest_service

def setup(db):
    _,host,other,cls=world(db)
    cls.capacity=8;cls.access_code='0217'
    row=Session(type='meditation',class_id=cls.id,host_id=host.id,seq=1,status='scheduled',host_state='assigned',duration_min=60,scheduled_at=NOW+timedelta(days=1),max_participants=8)
    db.add(row);db.commit()
    return host,other,cls,row

def join(db,cls,**kwargs):
    return api().join_guest(db,cls.id,{'operation_key':str(uuid4()),'code':'0217','guest_name':'합성 동명이인','gender':'other','birth_date':'2000-01-01','report_email':'synthetic@example.com','report_included':False,**kwargs},now=NOW)
def command(cls,**kwargs):
    return {'operation_key':str(uuid4()),'expected_revision':cls.revision,**kwargs}

def test_v15_distinct_null_guests_expected_and_reports(pg_session):
    db=pg_session;_,_,cls,s=setup(db)
    a,b=join(db,cls),join(db,cls)
    assert a['member']['id']!=b['member']['id']
    rows=db.query(SessionParticipant).filter_by(session_id=s.id).all()
    assert len(rows)==2 and len({p.member_id for p in rows})==2
    for p in rows:db.add(Report(session_id=s.id,participant_id=p.id,type='client',status='completed',content={'owner':str(p.member_id)}))
    db.commit();assert db.query(Report).filter_by(session_id=s.id).count()==2

def test_v16_scope_expiry_tamper_cross_class_logout(pg_session):
    db=pg_session;_,_,cls,_=setup(db);b=join(db,cls)['credential_bundle']
    m,g=api().authenticate_guest(db,cls.id,b['activity_credential'],scope='activity',now=NOW)
    assert g.expires_at==NOW+timedelta(days=90)
    for token,cid,scope,when in [(b['read_credential'],cls.id,'activity',NOW),(b['read_credential']+'x',cls.id,'read',NOW),(b['read_credential'],uuid4(),'read',NOW),(b['read_credential'],cls.id,'read',NOW+timedelta(days=91))]:
        with pytest.raises(HTTPException) as e:api().authenticate_guest(db,cid,token,scope=scope,now=when)
        assert e.value.status_code==401
    api().logout_guest(db,cls.id,b['read_credential'],now=NOW)
    with pytest.raises(HTTPException):api().authenticate_guest(db,cls.id,b['read_credential'],now=NOW)
    assert db.query(ClassGuestCredential).filter_by(member_id=m.id,revoked_at=None).count()==0

def test_public_join_retry_no_credentials(pg_session):
    db=pg_session;_,_,cls,_=setup(db);data={'operation_key':str(uuid4()),'code':'0217','guest_name':'합성','gender':'other','birth_date':'2000-01-01','report_email':'synthetic@example.com','report_included':False}
    a=api().join_guest(db,cls.id,data,now=NOW);b=api().join_guest(db,cls.id,data,now=NOW)
    assert b['member']['id']==a['member']['id'] and b['credential_bundle'] is None and b['recovery_required']
    with pytest.raises(HTTPException) as e:api().join_guest(db,cls.id,{**data,'guest_name':'다른'},now=NOW)
    assert e.value.detail['code']=='operation_key_reused'

def test_v17_v37_merge_preserves_fk_revokes_and_replays(pg_session):
    db=pg_session;host,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls);source,target=a['member']['id'],b['member']['id']
    old=Session(type='meditation',class_id=cls.id,host_id=host.id,seq=2,status='completed',host_state='assigned',duration_min=60,max_participants=8)
    db.add(old);db.flush();p=SessionParticipant(session_id=old.id,member_id=source,attendance_status='attended',entered_at=NOW)
    db.add(p);db.flush();r=Report(session_id=old.id,participant_id=p.id,type='client',status='completed',content={'summary':'과거 합성'})
    db.add(r);db.commit();original=(p.id,p.member_id,r.id,r.participant_id)
    preview=api().preview_merge(db,host.id,cls.id,source,target,reason='대면 확인')
    assert not preview['conflicts'] and len(preview['withdraw_participant_ids'])==1
    cmd=command(cls,source_member_id=source,target_member_id=target,confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='대면 확인')
    result=api().merge_guests(db,host.id,cls.id,cmd,now=NOW)
    assert result['canonical_member_id']==target and api().merge_guests(db,host.id,cls.id,cmd,now=NOW)==result
    assert (p.id,p.member_id,r.id,r.participant_id)==original and db.query(ClassGuestMerge).count()==1
    assert sum(not p.superseded_by_participant_id for p in db.query(SessionParticipant).filter_by(session_id=s.id).all())==1
    for joined in (a,b):
        with pytest.raises(HTTPException):api().authenticate_guest(db,cls.id,joined['credential_bundle']['read_credential'],now=NOW)

def test_v18_report_conflict_rolls_back(pg_session):
    db=pg_session;host,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls)
    for p in db.query(SessionParticipant).filter_by(session_id=s.id).all():db.add(Report(session_id=s.id,participant_id=p.id,type='client',status='completed',content={}))
    db.commit();preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='확인');assert preview['conflicts']
    with pytest.raises(HTTPException) as e:api().merge_guests(db,host.id,cls.id,command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='확인'),now=NOW)
    assert e.value.status_code==409 and db.query(ClassGuestMerge).count()==0
    assert db.query(ClassMember).filter(ClassMember.canonical_member_id.is_not(None)).count()==0
    api().authenticate_guest(db,cls.id,a['credential_bundle']['read_credential'],now=NOW)

def test_v19_non_manager_forbidden(pg_session):
    db=pg_session;_,other,cls,_=setup(db);a,b=join(db,cls),join(db,cls)
    with pytest.raises(HTTPException) as e:api().preview_merge(db,other.id,cls.id,a['member']['id'],b['member']['id'],reason='확인')
    assert e.value.status_code in (403,404)

def test_v38_recovery_hash_only_single_use_retry_no_secret(pg_session):
    db=pg_session;host,_,cls,_=setup(db);member_id=join(db,cls)['member']['id'];cmd=command(cls,identity_confirmed=True,reason='대면 확인')
    issued=api().issue_recovery(db,host.id,cls.id,member_id,cmd,now=NOW)
    assert issued['expires_at']==(NOW+timedelta(minutes=10)).isoformat()
    repeat=api().issue_recovery(db,host.id,cls.id,member_id,cmd,now=NOW)
    assert 'exchange_token' not in repeat and repeat['recovery_required']
    row=db.query(ClassGuestRecovery).one();assert len(row.token_hash)==64 and row.token_hash!=issued['exchange_token']
    assert api().exchange_recovery(db,cls.id,issued['exchange_token'],now=NOW)['member']['id']==member_id
    with pytest.raises(HTTPException):api().exchange_recovery(db,cls.id,issued['exchange_token'],now=NOW)

def test_guest_leave_read_only_rejoin_same_member_and_no_pii_operation(pg_session):
    from app.models.class_membership import ClassMemberOperation
    db=pg_session;_,_,cls,s=setup(db);joined=join(db,cls);mid=joined['member']['id'];token=joined['credential_bundle']['activity_credential']
    result=api().guest_transition(db,cls.id,mid,token,command(cls,action='leave'),now=NOW)
    assert result['member']['status']=='left' and result['credential_bundle']['activity_credential'] is None
    read=result['credential_bundle']['read_credential']
    api().authenticate_guest(db,cls.id,read,now=NOW)
    with pytest.raises(HTTPException):api().guest_transition(db,cls.id,mid,read,command(cls,action='rejoin'),now=NOW)
    rejoined=api().rejoin_guest(db,cls.id,read,command(cls,code='0217'),now=NOW)
    assert rejoined['member']['id']==mid and rejoined['member']['status']=='active'
    assert len(db.query(SessionParticipant).filter_by(session_id=s.id).all())==1
    for op in db.query(ClassMemberOperation).all():
        assert '合成' not in str(op.result) and '合成' not in op.request_hash
        assert 'credential' not in str(op.result) and '합성 동명이인' not in str(op.result)


def test_guest_attendance_makeup_current_auth_before_replay(pg_session):
    db=pg_session;_,_,cls,s=setup(db);joined=join(db,cls);mid=joined['member']['id'];token=joined['credential_bundle']['activity_credential']
    cmd=command(cls,action='excuse',expected_participation_version=s.participation_version)
    result=api().guest_attendance(db,cls.id,s.id,mid,token,cmd,now=NOW)
    assert result['participant']['attendance_status']=='excused'
    assert api().guest_attendance(db,cls.id,s.id,mid,token,cmd,now=NOW)==result
    second=Session(type='meditation',class_id=cls.id,host_id=s.host_id,seq=2,status='scheduled',host_state='assigned',duration_min=60,scheduled_at=NOW+timedelta(days=2),max_participants=8)
    db.add(second);db.commit()
    reservation=api().guest_makeup(db,cls.id,token,command(cls,member_id=mid,source_session_id=str(s.id),target_session_id=str(second.id)),now=NOW)
    assert reservation['assignment']['status']=='reserved'
    api().guest_cancel_makeup(db,cls.id,reservation['assignment']['id'],token,command(cls),now=NOW)
    api().logout_guest(db,cls.id,token,now=NOW)
    with pytest.raises(HTTPException) as e:api().guest_attendance(db,cls.id,s.id,mid,token,cmd,now=NOW)
    assert e.value.status_code==401


def test_guest_entry_active_and_completed_makeup_preserve_status(pg_session):
    from app.models.class_membership import ClassMakeupAssignment
    from app.services.entry_credential_service import resolve_participant
    db=pg_session;_,_,cls,s=setup(db);joined=join(db,cls);mid=joined['member']['id'];token=joined['credential_bundle']['activity_credential']
    s.status='open';s.scheduled_at=NOW-timedelta(seconds=1);db.commit()
    result=api().guest_entry(db,cls.id,s.id,token,command(cls),now=NOW)
    p=resolve_participant(db,result['entry_credential'],s.id)
    assert p.entered_at==NOW and p.attendance_status=='attended'
    assert db.query(SessionParticipant).filter_by(session_id=s.id).count()==1
    with pytest.raises(HTTPException):api().guest_entry(db,cls.id,s.id,joined['credential_bundle']['read_credential'],command(cls),now=NOW)
    s.status='completed';p.attendance_status='absent';p.entered_at=None
    cls.status='completed';member=db.get(ClassMember,UUID(mid));member.status='completed'
    target=Session(type='meditation',class_id=cls.id,host_id=s.host_id,seq=2,status='open',host_state='assigned',duration_min=60,session_kind='makeup',max_participants=8)
    db.add(target);db.flush();mp=SessionParticipant(session_id=target.id,member_id=member.id,attendance_status='expected',attendance_kind='makeup',makeup_for_session_id=s.id)
    db.add(mp);db.flush();assignment=ClassMakeupAssignment(class_id=cls.id,member_id=member.id,source_session_id=s.id,source_participant_id=p.id,target_session_id=target.id,target_participant_id=mp.id)
    db.add(assignment);db.commit()
    result=api().guest_entry(db,cls.id,target.id,joined['credential_bundle']['read_credential'],command(cls),now=NOW)
    assert resolve_participant(db,result['entry_credential'],target.id).id==mp.id
    assert cls.status==member.status=='completed' and assignment.status=='completed'


def test_http_guest_scope_and_credentials_not_bearer_login(pg_session,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.v1 import class_guests,class_membership
    from app.core.database import get_db
    from app.api.deps import get_current_user_optional
    from app.config import settings
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    db=pg_session;_,_,cls,_=setup(db);joined=join(db,cls)
    app=FastAPI();app.include_router(class_guests.router,prefix='/api/v1');app.include_router(class_membership.router,prefix='/api/v1')
    app.dependency_overrides[get_db]=lambda:db
    app.dependency_overrides[get_current_user_optional]=lambda:None
    with TestClient(app) as client:
        path=f'/api/v1/classes/{cls.id}/members/{joined["member"]["id"]}/transition'
        body=command(cls,action='leave')
        assert client.post(path,json=body).status_code==401
        assert client.post(path,json=body,headers={'X-Class-Member-Credential':joined['credential_bundle']['read_credential']}).status_code==401
        response=client.post(path,json=body,headers={'X-Class-Member-Credential':joined['credential_bundle']['activity_credential']})
        assert response.status_code==200,response.text
        assert response.json()['member']['status']=='left'

@pytest.mark.parametrize('evidence',['entered','checkin','eeg','media'])
def test_actual_record_kinds_block_merge_and_preserve_grants(pg_session,evidence):
    from app.models.record import EEGRecord,SessionRecord
    db=pg_session;host,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls)
    rows=db.query(SessionParticipant).filter_by(session_id=s.id).all()
    for p in rows:
        if evidence=='entered':p.entered_at=NOW
        elif evidence=='checkin':p.checkin_state='completed'
        elif evidence=='eeg':db.add(EEGRecord(session_id=s.id,participant_id=p.id,s3_key='synthetic/nonexistent'))
        else:p.webrtc_peer_id=str(uuid4())
    db.commit();preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='확인')
    assert preview['conflicts']
    with pytest.raises(HTTPException) as e:api().merge_guests(db,host.id,cls.id,command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='확인'),now=NOW)
    assert e.value.status_code==409
    api().authenticate_guest(db,cls.id,a['credential_bundle']['read_credential'],now=NOW)


def test_merge_flatten_stale_cross_class_and_current_authority(pg_session):
    from app.models.class_program import ClassInstructor
    db=pg_session;host,_,cls,s=setup(db);a,b,c=join(db,cls),join(db,cls),join(db,cls)
    def merge(source,target):
        preview=api().preview_merge(db,host.id,cls.id,source,target,reason='확인')
        body=command(cls,source_member_id=source,target_member_id=target,confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='확인')
        return api().merge_guests(db,host.id,cls.id,body,now=NOW),body
    merge(a['member']['id'],b['member']['id'])
    result,cmd=merge(b['member']['id'],c['member']['id'])
    aliases=db.query(ClassMember).filter(ClassMember.id.in_([UUID(a['member']['id']),UUID(b['member']['id'])])).all()
    assert all(str(m.canonical_member_id)==c['member']['id'] for m in aliases)
    with pytest.raises(HTTPException):api().preview_merge(db,host.id,cls.id,c['member']['id'],a['member']['id'],reason='확인')
    db.query(ClassInstructor).filter_by(class_id=cls.id,user_id=host.id).one().status='removed';db.commit()
    with pytest.raises(HTTPException):api().merge_guests(db,host.id,cls.id,cmd,now=NOW)


def test_recovery_expired_cross_class_and_readonly_refresh(pg_session):
    db=pg_session;host,_,cls,_=setup(db);joined=join(db,cls);mid=joined['member']['id']
    issued=api().issue_recovery(db,host.id,cls.id,mid,command(cls,identity_confirmed=True,reason='확인'),now=NOW)
    for cid,when in [(uuid4(),NOW),(cls.id,NOW+timedelta(minutes=10))]:
        with pytest.raises(HTTPException):api().exchange_recovery(db,cid,issued['exchange_token'],now=when)
    member=db.get(ClassMember,UUID(mid));member.status='removed';db.commit()
    refreshed=api().refresh_guest(db,cls.id,joined['credential_bundle']['read_credential'],now=NOW)
    assert refreshed['credential_bundle']['activity_credential'] is None
    with pytest.raises(HTTPException):api().authenticate_guest(db,cls.id,joined['credential_bundle']['activity_credential'],scope='activity',now=NOW)
    member.entry_ver+=1;db.commit()
    with pytest.raises(HTTPException):api().authenticate_guest(db,cls.id,refreshed['credential_bundle']['read_credential'],now=NOW)


def test_snapshot_activity_credential_own_only_read_denied(pg_session):
    from app.services.class_participation_service import snapshot
    db=pg_session;_,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls)
    result=snapshot(db,cls.id,s.id,None,member_credential=a['credential_bundle']['activity_credential'],now=NOW)
    assert len(result['participants'])==1 and result['participants'][0]['member_id']==a['member']['id']
    with pytest.raises(HTTPException):snapshot(db,cls.id,s.id,None,member_credential=a['credential_bundle']['read_credential'],now=NOW)


def test_real_bearer_login_guest_and_anonymous_http(pg_session,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.v1 import class_guests,class_membership
    from app.core.database import get_db
    from app.core.security import create_access_token
    from app.config import settings
    db=pg_session;host,other,cls,_=setup(db);joined=join(db,cls)
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(class_guests.router,prefix='/api/v1');app.include_router(class_membership.router,prefix='/api/v1');app.dependency_overrides[get_db]=lambda:db
    with TestClient(app) as client:
        path=f'/api/v1/classes/{cls.id}/members/{joined["member"]["id"]}/transition'
        assert client.post(path,json=command(cls,action='leave')).status_code==401
        assert client.post(path,json=command(cls,action='leave'),headers={'Authorization':f'Bearer {create_access_token(str(other.id))}'}).status_code==403
        token=joined['credential_bundle']['activity_credential']
        assert client.post(path,json=command(cls,action='remove'),headers={'Authorization':f'Bearer {token}'}).status_code==401
        assert client.post(path,json=command(cls,action='remove'),headers={'Authorization':f'Bearer {create_access_token(str(host.id))}'}).status_code==200
        assert client.post(f'/api/v1/classes/{cls.id}/guest-credentials/refresh',headers={'X-Class-Member-Credential':token}).status_code==401


@pytest.mark.parametrize('case',['exchange','merge_replay'])
def test_two_connections_exchange_and_merge_replay(scratch_db,case):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy import create_engine,event,text
    from sqlalchemy.orm import Session as DBSession
    from tests.pg.conftest import alembic_ok
    url=scratch_db('guest_'+case);alembic_ok(url,'upgrade','head');engine=create_engine(url)
    try:
        with DBSession(engine) as db:
            host,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls)
            cid,actor=cls.id,host.id
            if case=='exchange':
                issued=api().issue_recovery(db,actor,cid,a['member']['id'],command(cls,identity_confirmed=True,reason='확인'),now=NOW)
                token=issued['exchange_token']
            else:
                preview=api().preview_merge(db,actor,cid,a['member']['id'],b['member']['id'],reason='확인')
                body=command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='확인')
        first_locked=threading.Event();second_attempt=threading.Event();local=threading.local()
        def before(conn,cursor,statement,parameters,context,many):
            if getattr(local,'kind',None)=='second' and 'FOR ' in statement:second_attempt.set()
        def after(conn,cursor,statement,parameters,context,many):
            if getattr(local,'kind',None)=='first' and 'FROM classes' in statement and 'FOR UPDATE' in statement:
                first_locked.set();assert second_attempt.wait(5)
        event.listen(engine,'before_cursor_execute',before);event.listen(engine,'after_cursor_execute',after)
        def run(kind):
            local.kind=kind
            if kind=='second':assert first_locked.wait(5)
            with DBSession(engine) as db:
                db.execute(text("SET lock_timeout='5s'"))
                try:
                    result=api().exchange_recovery(db,cid,token,now=NOW) if case=='exchange' else api().merge_guests(db,actor,cid,body,now=NOW)
                    return 200,result
                except HTTPException as exc:return exc.status_code,exc.detail
        with ThreadPoolExecutor(max_workers=2) as pool:
            one=pool.submit(run,'first');two=pool.submit(run,'second');outcomes=[one.result(timeout=15),two.result(timeout=15)]
        assert sorted(status for status,_ in outcomes)==([200,401] if case=='exchange' else [200,200]),outcomes
        if case=='merge_replay':assert outcomes[0][1]==outcomes[1][1]
        with DBSession(engine) as db:
            assert db.query(ClassGuestMerge).count()==(1 if case=='merge_replay' else 0)
            assert db.query(ClassGuestCredential).filter_by(revoked_at=None).count()==(0 if case=='merge_replay' else 4)
    finally:engine.dispose()

@pytest.mark.parametrize('missing',['guest_name','gender','birth_date','report_email'])
def test_join_reuses_existing_guest_required_pii_policy(pg_session,missing):
    db=pg_session;_,_,cls,_=setup(db)
    data={'operation_key':str(uuid4()),'code':'0217','guest_name':'합성','gender':'other','birth_date':'2000-01-01','report_email':'synthetic@example.com','report_included':False}
    data.pop(missing)
    with pytest.raises(HTTPException) as exc:api().join_guest(db,cls.id,data,now=NOW)
    assert exc.value.status_code==422

def test_merge_stale_preview_and_storage_failure_are_atomic(pg_session):
    from sqlalchemy import event
    from app.models.class_membership import ClassGuestMerge
    db=pg_session;host,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls)
    preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='확인')
    body=command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='확인')
    db.query(SessionParticipant).filter_by(session_id=s.id).first().attendance_status='excused';db.commit()
    with pytest.raises(HTTPException) as exc:api().merge_guests(db,host.id,cls.id,body,now=NOW)
    assert exc.value.detail['code']=='guest_merge_preview_stale'
    preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='확인')
    body['confirmed_preview_fingerprint']=preview['preview_fingerprint']
    def fail(mapper,connection,target):raise RuntimeError('합성 병합 감사 저장 실패')
    event.listen(ClassGuestMerge,'before_insert',fail)
    try:
        with pytest.raises(RuntimeError):api().merge_guests(db,host.id,cls.id,body,now=NOW)
    finally:event.remove(ClassGuestMerge,'before_insert',fail)
    assert cls.revision==body['expected_revision'] and db.query(ClassGuestMerge).count()==0
    assert db.query(ClassMember).filter(ClassMember.canonical_member_id.is_not(None)).count()==0
    assert db.query(SessionParticipant).filter(SessionParticipant.superseded_by_participant_id.is_not(None)).count()==0
    api().authenticate_guest(db,cls.id,a['credential_bundle']['activity_credential'],scope='activity',now=NOW)
    assert api().merge_guests(db,host.id,cls.id,body,now=NOW)['recovery_required']


def test_cross_class_merge_and_recovery_scope_return_no_guest_token(pg_session):
    db=pg_session;host,_,cls,_=setup(db);joined=join(db,cls)
    _,_,_,foreign=world(db);foreign.access_code='0218';db.commit()
    guest=ClassMember(class_id=foreign.id,kind='guest',status='active',joined_via='code');db.add(guest);db.commit()
    with pytest.raises(HTTPException) as exc:api().preview_merge(db,host.id,cls.id,joined['member']['id'],guest.id,reason='확인')
    assert exc.value.status_code==404
    recovery=api().issue_recovery(db,host.id,cls.id,joined['member']['id'],command(cls,identity_confirmed=True,reason='확인'),now=NOW)
    with pytest.raises(HTTPException) as exc:api().exchange_recovery(db,foreign.id,recovery['exchange_token'],now=NOW)
    assert exc.value.status_code==401
    assert api().exchange_recovery(db,cls.id,recovery['exchange_token'],now=NOW)['credential_bundle']['read_credential']


def test_read_grant_cannot_enter_unassigned_completed_or_removed(pg_session):
    db=pg_session;_,_,cls,s=setup(db);joined=join(db,cls);member=db.get(ClassMember,UUID(joined['member']['id']))
    s.status='open';cls.status='completed';member.status='completed';db.commit()
    with pytest.raises(HTTPException) as exc:api().guest_entry(db,cls.id,s.id,joined['credential_bundle']['read_credential'],command(cls),now=NOW)
    assert exc.value.status_code==403
    member.status='removed';db.commit()
    with pytest.raises(HTTPException):api().guest_entry(db,cls.id,s.id,joined['credential_bundle']['read_credential'],command(cls),now=NOW)


def test_http_join_exchange_recovery_refresh_strict_payloads(pg_session,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.v1 import class_guests
    from app.core.database import get_db
    from app.core.redis import get_redis
    from app.core.security import create_access_token
    from app.config import settings
    class Redis:
        def __init__(self):self.values={}
        async def get(self,key):return self.values.get(key)
        async def incr(self,key):self.values[key]=self.values.get(key,0)+1;return self.values[key]
        async def expire(self,*args):return True
        async def setex(self,key,ttl,value):self.values[key]=value
    db=pg_session;host,_,cls,_=setup(db);monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(class_guests.router,prefix='/api/v1');app.dependency_overrides[get_db]=lambda:db;redis=Redis();app.dependency_overrides[get_redis]=lambda:redis
    body={'operation_key':str(uuid4()),'code':'0217','guest_name':'합성','gender':'other','birth_date':'2000-01-01','report_email':'synthetic@example.com'}
    prefix=f'/api/v1/classes/{cls.id}'
    with TestClient(app) as client:
        assert client.post(prefix+'/guest-memberships',json={**body,'member_id':str(uuid4())}).status_code==422
        first=client.post(prefix+'/guest-memberships',json=body);assert first.status_code==201,first.text
        joined=first.json();repeat=client.post(prefix+'/guest-memberships',json=body);assert repeat.status_code==201 and repeat.json()['credential_bundle'] is None
        recovery=client.post(prefix+f'/members/{joined["member"]["id"]}/recovery',json=command(cls,identity_confirmed=True,reason='대면 확인'),headers={'Authorization':f'Bearer {create_access_token(str(host.id))}'})
        assert recovery.status_code==200,recovery.text
        exchanged=client.post(prefix+'/guest-credentials/exchange',json={'exchange_token':recovery.json()['exchange_token']});assert exchanged.status_code==200,exchanged.text
        assert client.post(prefix+'/guest-credentials/exchange',json={'exchange_token':recovery.json()['exchange_token']}).status_code==401
        credential=exchanged.json()['credential_bundle']['read_credential']
        assert client.post(prefix+'/guest-credentials/refresh',headers={'X-Class-Member-Credential':credential}).status_code==200
        assert client.post(prefix+'/guest-credentials/refresh',headers={'X-Class-Member-Credential':credential}).status_code==401

def test_unknown_checkin_placeholder_is_not_actual_record_conflict(pg_session):
    from app.models.record import SessionRecord
    db=pg_session;host,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls)
    rows=db.query(SessionParticipant).filter_by(session_id=s.id).all()
    db.add(SessionRecord(session_id=s.id,subjective_state={'participants':{str(p.id):{'before':None,'after':None} for p in rows}}));db.commit()
    preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='확인')
    assert preview['conflicts']==[]


def test_completed_alias_makeup_entry_preserves_original_assignment_member_fk(pg_session):
    from app.models.class_membership import ClassMakeupAssignment
    db=pg_session;host,_,cls,s=setup(db);a,b=join(db,cls),join(db,cls)
    source=db.get(ClassMember,UUID(a['member']['id']));target=db.get(ClassMember,UUID(b['member']['id']))
    p=db.query(SessionParticipant).filter_by(session_id=s.id,member_id=source.id).one();p.attendance_status='absent'
    # survivor 행은 다른 과거 이력으로 분리하여 중복 원결석을 만들지 않는다.
    other=db.query(SessionParticipant).filter_by(session_id=s.id,member_id=target.id).one();other.attendance_status='withdrawn'
    ms=Session(type='meditation',class_id=cls.id,host_id=host.id,seq=2,status='open',host_state='assigned',duration_min=60,session_kind='makeup',max_participants=8)
    db.add(ms);db.flush();mp=SessionParticipant(session_id=ms.id,member_id=source.id,attendance_kind='makeup',attendance_status='expected',makeup_for_session_id=s.id)
    db.add(mp);db.flush();assignment=ClassMakeupAssignment(class_id=cls.id,member_id=source.id,source_session_id=s.id,source_participant_id=p.id,target_session_id=ms.id,target_participant_id=mp.id)
    db.add(assignment);db.commit()
    preview=api().preview_merge(db,host.id,cls.id,source.id,target.id,reason='확인')
    api().merge_guests(db,host.id,cls.id,command(cls,source_member_id=str(source.id),target_member_id=str(target.id),confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='확인'),now=NOW)
    cls.status='completed';target.status='completed';db.commit()
    recovery=api().issue_recovery(db,host.id,cls.id,target.id,command(cls,identity_confirmed=True,reason='확인'),now=NOW)
    read=api().exchange_recovery(db,cls.id,recovery['exchange_token'],now=NOW)['credential_bundle']['read_credential']
    result=api().guest_entry(db,cls.id,ms.id,read,command(cls),now=NOW)
    assert result['participant_id']==str(mp.id) and assignment.member_id==source.id and assignment.status=='completed'

def test_completed_cancelled_replacement_read_exchange_and_entry_retry(pg_session):
    db=pg_session;host,_,cls,s=setup(db);joined=join(db,cls);member=db.get(ClassMember,UUID(joined['member']['id']))
    s.status='cancelled';cls.status='completed';member.status='completed'
    target=Session(type='meditation',class_id=cls.id,host_id=host.id,seq=2,status='open',host_state='assigned',duration_min=60,session_kind='makeup',max_participants=8)
    db.add(target);db.flush();p=SessionParticipant(session_id=target.id,member_id=member.id,attendance_kind='regular',attendance_status='expected',makeup_for_session_id=s.id)
    db.add(p);db.commit();read=joined['credential_bundle']['read_credential'];cmd=command(cls)
    first=api().guest_entry(db,cls.id,target.id,read,cmd,now=NOW)
    second=api().guest_entry(db,cls.id,target.id,read,cmd,now=NOW)
    assert first['participant_id']==second['participant_id']==str(p.id) and first['revision']==second['revision']
    assert member.status==cls.status=='completed' and p.attendance_status=='attended'
    from app.models.class_membership import ClassMakeupAssignment,ClassMemberOperation
    assert db.query(ClassMakeupAssignment).count()==0
    assert all('entry_credential' not in op.result for op in db.query(ClassMemberOperation).all())
    api().logout_guest(db,cls.id,read,now=NOW)
    with pytest.raises(HTTPException):api().guest_entry(db,cls.id,target.id,read,cmd,now=NOW)

def test_v15_legacy_ensure_expected_uses_membership_id_for_null_users(pg_session):
    from app.services.class_membership_service import ensure_expected
    db=pg_session;_,_,cls,s=setup(db)
    guests=[ClassMember(class_id=cls.id,kind='guest',status='active',joined_via='code',guest_name='동명이인') for _ in range(2)]
    db.add_all(guests);db.flush();ensure_expected(db,cls,[s],guests);ensure_expected(db,cls,[s],guests)
    rows=db.query(SessionParticipant).filter_by(session_id=s.id).all()
    assert len(rows)==2 and {p.member_id for p in rows}=={m.id for m in guests}


def test_v37_two_distinct_past_sessions_reports_and_one_future_canonical_seat(pg_session):
    db=pg_session;host,_,cls,future=setup(db);a,b=join(db,cls),join(db,cls);original=[]
    for seq,joined in enumerate((a,b),start=2):
        s=Session(type='meditation',class_id=cls.id,host_id=host.id,seq=seq,status='completed',host_state='assigned',duration_min=60,max_participants=8)
        db.add(s);db.flush();p=SessionParticipant(session_id=s.id,member_id=UUID(joined['member']['id']),attendance_status='attended',entered_at=NOW-timedelta(days=seq))
        db.add(p);db.flush();r=Report(session_id=s.id,participant_id=p.id,type='client',status='completed',content={'summary':f'합성 과거 {seq}'})
        db.add(r);db.flush();original.append((p.id,p.member_id,r.id,r.participant_id,r.content))
    db.commit();preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='확인')
    api().merge_guests(db,host.id,cls.id,command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='확인'),now=NOW)
    for pid,mid,rid,report_pid,content in original:
        assert db.get(SessionParticipant,pid).member_id==mid
        assert db.get(Report,rid).participant_id==report_pid and db.get(Report,rid).content==content
    ids=api().canonical_member_ids(db,db.get(ClassMember,UUID(b['member']['id'])))
    valid=db.query(SessionParticipant).filter(SessionParticipant.member_id.in_(ids),SessionParticipant.superseded_by_participant_id.is_(None)).all()
    assert len(valid)==3 and len({p.session_id for p in valid})==3
    assert sum(p.session_id==future.id for p in valid)==1


def review_fix1_scene(db, role, evidence):
    """A의 유효 예약 참조행과 B의 실제 기록이 같은 회차에서 충돌한다."""
    from app.models.class_membership import ClassMakeupAssignment
    host,_,cls,source_session=setup(db)
    a,b=join(db,cls),join(db,cls)
    first=db.get(ClassMember,UUID(a['member']['id']))
    second=db.get(ClassMember,UUID(b['member']['id']))
    source=db.query(SessionParticipant).filter_by(session_id=source_session.id,member_id=first.id).one()
    source.attendance_status='absent'
    other_source=db.query(SessionParticipant).filter_by(session_id=source_session.id,member_id=second.id).one()
    other_source.attendance_status='withdrawn'
    target_session=Session(type='meditation',class_id=cls.id,host_id=host.id,seq=2,status='scheduled',host_state='assigned',duration_min=60,session_kind='makeup',scheduled_at=NOW+timedelta(days=2),max_participants=8)
    db.add(target_session);db.flush()
    target=SessionParticipant(session_id=target_session.id,member_id=first.id,attendance_status='expected',attendance_kind='makeup',makeup_for_session_id=source_session.id)
    other_target=SessionParticipant(session_id=target_session.id,member_id=second.id,attendance_status='expected',attendance_kind='regular')
    db.add_all([target,other_target]);db.flush()
    assignment=ClassMakeupAssignment(class_id=cls.id,member_id=first.id,source_session_id=source_session.id,source_participant_id=source.id,target_session_id=target_session.id,target_participant_id=target.id,status='reserved')
    db.add(assignment)
    actual=other_source if role=='source' else other_target
    if evidence=='entered':actual.entered_at=NOW
    elif evidence=='report':db.add(Report(session_id=actual.session_id,participant_id=actual.id,type='client',status='completed',content={'summary':'합성 상대방 실기록'}))
    else:actual.checkin_state='completed';actual.checkin_at=NOW
    db.commit()
    return host,cls,a,b,source_session,target_session,source,target,actual,assignment


@pytest.mark.parametrize('role',['source','target'])
@pytest.mark.parametrize('evidence',['entered','report','checkin'])
def test_review_fix1_rejects_invalidating_reserved_makeup_and_keeps_actual_entry_usable(pg_session,role,evidence):
    from app.models.class_scheduling import ClassOperation
    from app.services.entry_credential_service import resolve_participant
    db=pg_session
    host,cls,a,b,source_session,target_session,source,target,actual,assignment=review_fix1_scene(db,role,evidence)
    members=db.query(ClassMember).filter_by(class_id=cls.id).all()
    participants=db.query(SessionParticipant).filter(SessionParticipant.session_id.in_([source_session.id,target_session.id])).all()
    def state():
        return (cls.revision,
            sorted((str(m.id),m.status,str(m.canonical_member_id),m.entry_ver) for m in members),
            sorted((str(p.id),p.attendance_status,str(p.superseded_by_participant_id),p.entry_ver,str(p.entered_at)) for p in participants),
            sorted((str(g.id),str(g.revoked_at)) for g in db.query(ClassGuestCredential).filter_by(class_id=cls.id).all()),
            assignment.status,assignment.source_participant_id,assignment.target_participant_id,
            db.query(ClassGuestMerge).filter_by(class_id=cls.id).count(),db.query(ClassOperation).filter_by(class_id=cls.id).count())
    original=state()
    preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='예약 보존 확인')
    protected=source if role=='source' else target
    assert any(c['code']=='makeup_assignment_invalidated' and c['assignment_id']==str(assignment.id)
               and c['participant_id']==str(protected.id) and c['role']==role for c in preview['conflicts'])
    body=command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='예약 보존 확인')
    with pytest.raises(HTTPException) as exc:api().merge_guests(db,host.id,cls.id,body,now=NOW)
    assert exc.value.status_code==409 and exc.value.detail['code']=='guest_merge_record_conflict'
    assert any(c['code']=='makeup_assignment_invalidated' for c in exc.value.detail['conflicts'])
    assert state()==original
    for joined in (a,b):api().authenticate_guest(db,cls.id,joined['credential_bundle']['read_credential'],now=NOW)
    # 거부된 병합이 기존 completed 멤버의 실제 지정보강 입장 자격을 손상시키지 않는다.
    cls.status='completed';db.get(ClassMember,UUID(a['member']['id'])).status='completed'
    source_session.status='completed';target_session.status='open';db.commit()
    entered=api().guest_entry(db,cls.id,target_session.id,a['credential_bundle']['read_credential'],command(cls),now=NOW)
    assert resolve_participant(db,entered['entry_credential'],target_session.id).id==target.id
    assert assignment.status=='completed' and source.attendance_status=='absent'
    assert source.superseded_by_participant_id is None and target.superseded_by_participant_id is None
    if evidence=='entered':assert actual.entered_at==NOW


def test_review_fix1_explicit_cancel_allows_later_legal_merge_without_rewriting_assignment(pg_session):
    db=pg_session
    host,cls,a,b,ss,ts,source,target,actual,assignment=review_fix1_scene(db,'source','entered')
    preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='명시 취소 전')
    assert any(c['code']=='makeup_assignment_invalidated' for c in preview['conflicts'])
    original=(assignment.id,assignment.member_id,assignment.source_participant_id,assignment.target_participant_id)
    api().guest_cancel_makeup(db,cls.id,assignment.id,a['credential_bundle']['activity_credential'],command(cls),now=NOW)
    assert assignment.status=='cancelled'
    preview=api().preview_merge(db,host.id,cls.id,a['member']['id'],b['member']['id'],reason='명시 취소 후')
    assert preview['conflicts']==[]
    result=api().merge_guests(db,host.id,cls.id,command(cls,source_member_id=a['member']['id'],target_member_id=b['member']['id'],confirmed_preview_fingerprint=preview['preview_fingerprint'],identity_confirmed=True,reason='명시 취소 후'),now=NOW)
    assert result['canonical_member_id']==b['member']['id']
    assert (assignment.id,assignment.member_id,assignment.source_participant_id,assignment.target_participant_id)==original
    assert assignment.status=='cancelled' and actual.entered_at==NOW
