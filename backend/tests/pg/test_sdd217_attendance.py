"""SDD-217 V07~10/V36 실제 PostgreSQL 검증."""
from app.api.deps import get_current_user_optional
from datetime import timedelta
from uuid import uuid4
import importlib.util
import asyncio
from types import SimpleNamespace
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from app.models.class_membership import ClassAttendanceEvent
from app.models.class_program import ClassMember
from app.models.session import Session, SessionParticipant
from tests.pg.test_sdd217_membership import setup, NOW, command
pytestmark=pytest.mark.pg

def attendance():
    assert importlib.util.find_spec('app.services.class_attendance_service'),'출석 서비스 구현 필요'
    from app.services import class_attendance_service
    return class_attendance_service

def scene(db,status='scheduled',cap=1):
    host,other,parent,clients,member=setup(db,capacity=3)
    parent.status='active';parent.recurrence_rule={'start_now':True}
    row=Session(type='meditation',class_id=parent.id,host_id=host.id,seq=1,status=status,host_state='assigned',participant_mode='group',duration_min=60,max_participants=cap,scheduled_at=NOW+timedelta(days=1),webrtc_room_id=uuid4())
    db.add(row);db.flush()
    p=SessionParticipant(session_id=row.id,user_id=member.user_id,member_id=member.id,attendance_status='expected')
    db.add(p);db.commit()
    return host,other,parent,clients,member,row,p

def act(db,actor,parent,member,row,action,**extra):
    return attendance().change_attendance(db,actor.id,parent.id,row.id,member.id,command(parent,expected_participation_version=row.participation_version,action=action,**extra),now=NOW)

def test_v07_actual_enter_attended_once_not_invite_or_checkin(pg_session,monkeypatch):
    from app.services import session_service as s
    host,_,parent,clients,member,row,p=scene(pg_session,'open')
    p.checkin_state='completed';pg_session.commit()
    assert p.entered_at is None and p.attendance_status=='expected'
    monkeypatch.setattr(s,'_notify_participant_changed',lambda *a:None);monkeypatch.setattr(s,'_notify_promoted',lambda *a:None)
    s._enter_resolved(row,pg_session,user_id=str(clients[0].id),require_invite=True)
    assert p.attendance_status=='attended'
    entered,version=p.entered_at,row.participation_version
    assert entered is not None and version==1
    s._enter_resolved(row,pg_session,user_id=str(clients[0].id),require_invite=True)
    assert p.entered_at==entered and row.participation_version==version

@pytest.mark.parametrize('action,expected',[('end','absent'),('cancel','expected')])
def test_v08_end_only_unentered_expected(pg_session,monkeypatch,action,expected):
    from app.services import session_service as s
    host,_,parent,clients,member,row,p=scene(pg_session,'in_progress',5)
    states=[('expected',NOW),('excused',None),('attended',NOW),('withdrawn',None)];others=[]
    for state,entered in states:
        other=SessionParticipant(session_id=row.id,attendance_status=state,entered_at=entered);pg_session.add(other);others.append(other)
    pg_session.commit()
    for name in ('_notify_session_state','_notify_participants_event','_close_out_media_on_cancel'):monkeypatch.setattr(s,name,lambda *a,**kw:None)
    from app.services import audio_service,video_service,research_export_service
    monkeypatch.setattr(audio_service,'finalize_on_session_end',lambda *a:None);monkeypatch.setattr(video_service,'finalize_on_session_end',lambda *a:None);monkeypatch.setattr(research_export_service,'on_session_completed',lambda *a:None)
    s.transition_status(str(row.id),str(host.id),action,pg_session)
    assert p.attendance_status==expected
    assert [o.attendance_status for o in others]==[x[0] for x in states]

def test_v09_excuse_return_and_direct_enter_recheck_capacity(pg_session):
    from app.services import session_service as s
    host,_,parent,clients,member,row,p=scene(pg_session)
    result=act(pg_session,clients[0],parent,member,row,'excuse')
    assert p.attendance_status=='excused' and result['participation_version']==1
    other=ClassMember(class_id=parent.id,user_id=clients[1].id,status='active',kind='member',joined_via='code');pg_session.add(other);pg_session.flush()
    pg_session.add(SessionParticipant(session_id=row.id,member_id=other.id,user_id=other.user_id,attendance_status='expected'));pg_session.commit()
    with pytest.raises(HTTPException) as exc:act(pg_session,clients[0],parent,member,row,'undo_excuse')
    assert exc.value.status_code==409 and p.attendance_status=='excused'
    row.status='open';pg_session.commit()
    with pytest.raises(HTTPException) as exc:s._enter_resolved(row,pg_session,user_id=str(clients[0].id),require_invite=True)
    assert exc.value.status_code==409 and p.entered_at is None

def test_v10_http_self_forbidden_instructor_audit_and_stale(pg_session,monkeypatch):
    from app.api.v1 import class_membership
    from app.api.deps import get_current_user
    from app.core.database import get_db
    from app.config import settings
    host,other,parent,clients,member,row,p=scene(pg_session,'completed');monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(class_membership.router,prefix='/api/v1');identity={'id':str(clients[0].id)}
    app.dependency_overrides[get_current_user]=lambda:identity
    app.dependency_overrides[get_current_user_optional] = app.dependency_overrides[get_current_user];app.dependency_overrides[get_db]=lambda:pg_session
    path=f'/api/v1/classes/{parent.id}/sessions/{row.id}/members/{member.id}/attendance'
    body=command(parent,expected_participation_version=0,action='correct_absent',reason='지도사 확인')
    with TestClient(app) as client:
        assert client.post(path,json=body).status_code==403
        identity['id']=str(other.id);assert client.post(path,json=body).status_code==403
        identity['id']=str(host.id);assert client.post(path,json={**body,'reason':None}).status_code==422
        response=client.post(path,json=body);assert response.status_code==200,response.text
        assert client.post(path,json=body).json()==response.json()
        assert client.post(path,json=command(parent,expected_participation_version=0,action='correct_attended',reason='추가 확인')).status_code==409
    event=pg_session.query(ClassAttendanceEvent).filter_by(participant_id=p.id).one()
    assert (event.old_status,event.new_status,event.actor_user_id,event.reason)==('expected','absent',host.id,'지도사 확인')
    assert p.entered_at is None

def test_v36_removed_login_and_credential_cannot_access(pg_session):
    from app.services.session_service import resolve_participant_actor,resolve_live_join,participant_livekit_token
    from app.services.class_membership_service import transition_membership
    from app.services.entry_credential_service import issue
    host,_,parent,clients,member,row,p=scene(pg_session,'in_progress');token,_=issue(p)
    transition_membership(pg_session,host.id,parent.id,member.id,command(parent,action='remove'),now=NOW)
    for identity in ({'current_user_id':str(clients[0].id),'entry_credential':None},{'current_user_id':None,'entry_credential':token}):
        with pytest.raises(HTTPException):resolve_participant_actor(row.id,pg_session,**identity)
        with pytest.raises(HTTPException):participant_livekit_token(str(row.id),pg_session,**identity)
    assert resolve_live_join(str(row.id),str(clients[0].id),str(p.id),pg_session) is None

def test_v36_livekit_reconcile_removes_member_identity(pg_session):
    from app.services.class_access_service import reconcile_observers
    host,_,parent,clients,member,row,p=scene(pg_session,'in_progress');member.status='removed';pg_session.commit();removed=[]
    class Room:
        async def list_participants(self,request):return SimpleNamespace(participants=[SimpleNamespace(identity=str(p.id)),SimpleNamespace(identity=str(host.id))])
        async def remove_participant(self,request):removed.append(request.identity)
    result=asyncio.run(reconcile_observers(pg_session,row,SimpleNamespace(room=Room())))
    assert result==1 and removed==[str(p.id)]


def test_v07_legacy_join_records_attended_and_rejects_removed(pg_session,monkeypatch):
    from app.services import session_service as s
    from app.services.class_membership_service import transition_membership
    host,_,parent,clients,member,row,p=scene(pg_session,'in_progress')
    monkeypatch.setattr(s,'generate_livekit_token',lambda *a,**kw:'합성토큰')
    s.join_session(str(row.id),str(clients[0].id),'합성',pg_session)
    assert p.attendance_status=='attended' and p.entered_at is not None
    transition_membership(pg_session,host.id,parent.id,member.id,command(parent,action='remove'),now=NOW)
    with pytest.raises(HTTPException):s.join_session(str(row.id),str(clients[0].id),'합성',pg_session)


def test_v36_ws_refresh_removes_revoked_member_rooms(pg_session,monkeypatch):
    from app.ws import session_live_namespace as ws
    from app.services import session_service as s
    host,_,parent,clients,member,row,p=scene(pg_session,'in_progress');member.status='removed';pg_session.commit()
    sid='합성-소켓';session_id=str(row.id);pid=str(p.id)
    contexts={sid:{'role':'participant','session_id':session_id,'participant_id':pid,'user_id':str(clients[0].id)}}
    rooms={ws._room_all(session_id),ws._room_self(session_id,pid)};events=[]
    class Sio:
        async def get_session(self,sid,**kw):return contexts[sid]
        async def leave_room(self,sid,room,**kw):rooms.discard(room)
        async def save_session(self,sid,value,**kw):contexts[sid]=value
        async def emit(self,event,payload,**kw):events.append(event)
    monkeypatch.setattr(ws,'_get_sio',lambda:Sio())
    monkeypatch.setattr(ws,'_sid_session_ids',{sid:session_id})
    monkeypatch.setattr(ws,'_resolve_join',lambda session_id,uid,pid=None,entry_credential=None:s.resolve_live_join(session_id,uid,pid,pg_session,entry_credential=entry_credential))
    asyncio.run(ws._refresh_instructor_rooms(session_id))
    assert not rooms and 'access_revoked' in events


@pytest.mark.parametrize('winner',['enter','remove'])
def test_v36_enter_remove_two_connections_serialized(scratch_db,monkeypatch,winner):
    from sqlalchemy import create_engine,event,text
    from sqlalchemy.orm import Session as DBSession
    from concurrent.futures import ThreadPoolExecutor
    import threading
    from tests.pg.conftest import alembic_ok
    from app.services import session_service as service
    from app.services.class_membership_service import transition_membership
    url=scratch_db('attendance_race_'+winner);alembic_ok(url,'upgrade','head');engine=create_engine(url)
    monkeypatch.setattr(service,'_notify_participant_changed',lambda *a:None);monkeypatch.setattr(service,'_notify_promoted',lambda *a:None)
    try:
        with DBSession(engine) as seed:
            host,_,parent,clients,member,row,p=scene(seed,'open')
            # client < host 순서를 고정하여 이전 무작위 UUID 의존 deadlock을 재현한다.
            from uuid import UUID
            from app.models.user import User
            client=User(id=UUID(int=host.id.int-1),email=f'{uuid4()}@example.com',password_hash='x',name='합성 경합 회원',role='client',status='active')
            seed.add(client);seed.flush();member.user_id=client.id;p.user_id=client.id;seed.commit()
            ids=(host.id,parent.id,client.id,member.id,row.id,p.id)
        blocked=threading.Event()
        def observed(conn,cursor,statement,parameters,context,many):
            if 'FOR ' in statement:blocked.set()
        with DBSession(engine) as first:
            # 선행 트랜잭션도 실제 서비스와 같은 User→Class→members→sessions 잠금을 얻는다.
            from app.services.class_write_service import lock_class_session
            parent,row=lock_class_session(first,first.get(Session,ids[4]),ids[2] if winner=='enter' else ids[0])
            event.listen(engine,'before_cursor_execute',observed)
            def second():
                with DBSession(engine) as db:
                    db.execute(text("SET LOCAL lock_timeout='5s'"))
                    try:
                        if winner=='enter':
                            return transition_membership(db,ids[0],ids[1],ids[3],{'operation_key':str(uuid4()),'expected_revision':parent.revision,'action':'remove'},now=NOW)
                        return service.enter_session_as_invited(str(ids[4]),str(ids[2]),db)
                    except HTTPException as exc:
                        db.rollback();return {'error':exc.status_code}
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(second)
                # User 잠금에서도 먼저 직렬화될 수 있으므로 대기 결과와 최종 상태를 함께 검증한다.
                assert blocked.wait(timeout=3)
                assert not future.done()
                if winner=='enter':
                    attendance().mark_entered(first,row,first.get(SessionParticipant,ids[5]),NOW);first.commit()
                else:
                    transition_membership(first,ids[0],ids[1],ids[3],command(parent,action='remove'),now=NOW)
                result=future.result(timeout=8)
            event.remove(engine,'before_cursor_execute',observed)
        with DBSession(engine) as check:
            p=check.get(SessionParticipant,ids[5]);member=check.get(ClassMember,ids[3])
            assert member.status=='removed'
            assert p.attendance_status==('attended' if winner=='enter' else 'expected')
            assert (p.entered_at is not None)==(winner=='enter')
            assert service.resolve_live_join(str(ids[4]),str(ids[2]),str(ids[5]),check) is None
            if winner=='remove':assert result['error']==403
    finally:engine.dispose()


def test_v09_two_connections_excuse_seat_taken_before_return(scratch_db):
    from sqlalchemy import create_engine,event,text
    from sqlalchemy.orm import Session as DBSession
    from concurrent.futures import ThreadPoolExecutor
    import threading
    from tests.pg.conftest import alembic_ok
    from app.services.class_write_service import lock_class_session
    url=scratch_db('attendance_return');alembic_ok(url,'upgrade','head');engine=create_engine(url)
    try:
        with DBSession(engine) as seed:
            host,_,parent,clients,member,row,p=scene(seed)
            act(seed,clients[0],parent,member,row,'excuse')
            other=ClassMember(class_id=parent.id,user_id=clients[1].id,status='active',kind='member',joined_via='code');seed.add(other);seed.flush()
            spare=SessionParticipant(session_id=row.id,member_id=other.id,user_id=other.user_id,attendance_status='excused');seed.add(spare);seed.commit()
            ids=(host.id,parent.id,clients[0].id,member.id,row.id,p.id,spare.id)
        reached=threading.Event()
        def observe(conn,cursor,statement,parameters,context,many):
            if 'FOR ' in statement:reached.set()
        with DBSession(engine) as seat:
            parent,row=lock_class_session(seat,seat.get(Session,ids[4]),ids[0])
            seat.get(SessionParticipant,ids[6]).attendance_status='expected';seat.flush()
            event.listen(engine,'before_cursor_execute',observe)
            def returning():
                with DBSession(engine) as db:
                    db.execute(text("SET LOCAL lock_timeout='5s'"))
                    try:
                        return attendance().change_attendance(db,ids[2],ids[1],ids[4],ids[3],{'operation_key':str(uuid4()),'expected_revision':parent.revision,'expected_participation_version':row.participation_version,'action':'undo_excuse'},now=NOW)
                    except HTTPException as exc:return {'error':exc.detail['code']}
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(returning)
                assert reached.wait(timeout=3) and not future.done()
                seat.commit()
                assert future.result(timeout=8)=={'error':'session_capacity'}
            event.remove(engine,'before_cursor_execute',observe)
        with DBSession(engine) as db:
            assert db.get(SessionParticipant,ids[5]).attendance_status=='excused'
            assert db.get(SessionParticipant,ids[6]).attendance_status=='expected'
    finally:engine.dispose()


def test_v10_audit_insert_failure_rolls_back_everything(pg_session):
    from sqlalchemy import event
    host,_,parent,clients,member,row,p=scene(pg_session,'completed')
    revision,version=parent.revision,row.participation_version
    def fail(*args):raise RuntimeError('합성 감사 저장 실패')
    event.listen(ClassAttendanceEvent,'before_insert',fail)
    try:
        with pytest.raises(RuntimeError):act(pg_session,host,parent,member,row,'correct_absent',reason='교정 사유')
    finally:event.remove(ClassAttendanceEvent,'before_insert',fail)
    assert parent.revision==revision and row.participation_version==version and p.attendance_status=='expected'
    assert pg_session.query(ClassAttendanceEvent).filter_by(participant_id=p.id).count()==0


@pytest.mark.parametrize('finish', ['remove', 'complete'])
def test_v36_real_websocket_effect_consumer_revokes_room(scratch_db,monkeypatch,finish):
    """실제 loopback WebSocket/Socket.IO·PG·effect 소비. LiveKit SDK 경계만 대역."""
    import socket
    import socketio
    import uvicorn
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as DBSession
    from tests.pg.conftest import alembic_ok
    from app.ws import session_live_namespace as ws
    from app.services.entry_credential_service import issue
    from app.services.class_membership_service import transition_membership
    from app.services.class_effect_service import process_effects
    from app.models.class_scheduling import ClassEffect
    from livekit import api as livekit_api
    url=scratch_db('attendance_ws_'+finish);alembic_ok(url,'upgrade','head');engine=create_engine(url)
    try:
        with DBSession(engine) as seed:
            host,_,parent,clients,member,row,p=scene(seed,'in_progress')
            token,_=issue(p);ids=(host.id,parent.id,member.id,row.id,p.id)
        sio=socketio.AsyncServer(async_mode='asgi',cors_allowed_origins='*')
        monkeypatch.setattr(ws,'_get_sio',lambda:sio);monkeypatch.setattr(ws,'_open_db',lambda:DBSession(engine))
        monkeypatch.setattr(ws,'_sid_session_ids',{});monkeypatch.setattr(ws,'_session_socket_counts',{});monkeypatch.setattr(ws,'_loop',None)
        ws.register_session_live_namespace(sio)
        removed=[]
        class Room:
            async def list_participants(self,request):return SimpleNamespace(participants=[SimpleNamespace(identity=str(ids[4]))])
            async def remove_participant(self,request):removed.append(request.identity)
        class Client:
            room=Room()
            async def aclose(self):pass
        monkeypatch.setattr(livekit_api,'LiveKitAPI',lambda *a,**kw:Client())
        if finish == 'complete':
            from app.services import audio_service,video_service,research_export_service,session_service
            monkeypatch.setattr(audio_service,'finalize_on_session_end',lambda *a:None)
            monkeypatch.setattr(video_service,'finalize_on_session_end',lambda *a:None)
            monkeypatch.setattr(research_export_service,'on_session_completed',lambda *a:None)
            monkeypatch.setattr(session_service,'_notify_participants_event',lambda *a,**kw:None)
        def remove_and_consume():
            with DBSession(engine) as db:
                parent=db.get(__import__('app.models.class_program',fromlist=['Class']).Class,ids[1])
                if finish == 'complete':
                    participant=db.get(SessionParticipant,ids[4])
                    participant.entered_at=NOW;participant.attendance_status='attended';db.commit()
                    session_service.transition_status(str(ids[3]),str(ids[0]),'end',db)
                    return None
                transition_membership(db,ids[0],ids[1],ids[2],command(parent,action='remove'),now=NOW)
                # 본 검증은 회수 의도만 소비하며 알림은 별도 T02 검증 범위다.
                db.query(ClassEffect).filter(ClassEffect.class_id==ids[1],ClassEffect.kind!='live_access_reconcile').update({'status':'done'});db.commit()
                return process_effects(db,class_id=ids[1])
        async def run():
            sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(8);sock.setblocking(False)
            server=uvicorn.Server(uvicorn.Config(socketio.ASGIApp(sio),log_level='error',lifespan='off'))
            task=asyncio.create_task(server.serve(sockets=[sock]));client=socketio.AsyncClient();joined=asyncio.Event();revoked=asyncio.Event();terminal=asyncio.Event();stopped=asyncio.Event()
            client.on('joined',lambda data:joined.set(),namespace='/session-live')
            client.on('access_revoked',lambda data:revoked.set(),namespace='/session-live')
            client.on('session_state_changed',lambda data:terminal.set() if data.get('status')=='completed' else None,namespace='/session-live')
            client.on(ws.AUDIO_SYNC_EVENT,lambda data:stopped.set() if data.get('action')=='stop' else None,namespace='/session-live')
            try:
                for _ in range(100):
                    if server.started:break
                    await asyncio.sleep(.01)
                await client.connect(f'http://127.0.0.1:{sock.getsockname()[1]}',namespaces=['/session-live'],transports=['websocket'])
                await client.emit('join',{'session_id':str(ids[3]),'participant_id':str(ids[4]),'entry_credential':token},namespace='/session-live')
                await asyncio.wait_for(joined.wait(),3)
                counts=await asyncio.to_thread(remove_and_consume)
                if finish == 'complete':
                    await asyncio.wait_for(terminal.wait(),3)
                    await asyncio.wait_for(stopped.wait(),3)
                    assert not revoked.is_set()
                else:
                    await asyncio.wait_for(revoked.wait(),3)
                server_sid=client.get_sid('/session-live')
                assert ws._room_all(str(ids[3])) not in sio.rooms(server_sid,namespace='/session-live')
                assert ws._room_self(str(ids[3]),str(ids[4])) not in sio.rooms(server_sid,namespace='/session-live')
                if finish == 'remove':
                    assert counts=={'done':1,'failed':0} and removed==[str(ids[4])]
                else:
                    assert counts is None and removed==[]
            finally:
                if client.connected:await client.disconnect()
                server.should_exit=True;await task
                await sio.shutdown()
        asyncio.run(run())
    finally:engine.dispose()


def test_attendance_commit_event_has_separate_participation_version(pg_session,monkeypatch):
    from app.ws import session_live_namespace as ws
    host,_,parent,clients,member,row,p=scene(pg_session)
    seen=[]
    def capture(session_id,payload):
        assert pg_session.query(ClassAttendanceEvent).filter_by(participant_id=p.id).count()==1
        seen.append(payload)
    monkeypatch.setattr(ws,'notify_participant_changed',capture)
    act(pg_session,clients[0],parent,member,row,'excuse')
    assert len(seen)==1
    assert seen[0]['participation_version']==1 and seen[0]['version']==row.state_version
    assert seen[0]['participants'][0]['attendance_status']=='excused'


def test_excused_member_cannot_bypass_enter_capacity_with_media_or_ws(pg_session,monkeypatch):
    from app.services import session_service as service
    host,_,parent,clients,member,row,p=scene(pg_session,'open')
    p.attendance_status='excused';pg_session.commit()
    monkeypatch.setattr(service,'generate_livekit_token',lambda *a,**kw:'합성토큰')
    with pytest.raises(HTTPException):service.participant_livekit_token(str(row.id),pg_session,current_user_id=str(clients[0].id))
    assert service.resolve_live_join(str(row.id),str(clients[0].id),str(p.id),pg_session) is None


def test_attended_reenter_is_idempotent_after_capacity_shrink(pg_session,monkeypatch):
    from app.services import session_service as s
    host,_,parent,clients,member,row,p=scene(pg_session,'open',2)
    p.entered_at=NOW;p.attendance_status='attended'
    other=SessionParticipant(session_id=row.id,attendance_status='expected');pg_session.add(other);row.max_participants=1;pg_session.commit()
    monkeypatch.setattr(s,'_notify_participant_changed',lambda *a:None)
    s._enter_resolved(row,pg_session,user_id=str(clients[0].id),require_invite=True)
    assert p.entered_at==NOW and p.attendance_status=='attended' and row.participation_version==0


def test_user_no_key_update_still_serializes_account_deactivation(scratch_db):
    from sqlalchemy import create_engine,event,update
    from sqlalchemy.orm import Session as DBSession
    from concurrent.futures import ThreadPoolExecutor
    import threading
    from tests.pg.conftest import alembic_ok
    from tests.pg.sdd216_helpers import user
    from app.models.user import User
    from app.services.class_write_service import lock_users
    url=scratch_db('attendance_user_lock');alembic_ok(url,'upgrade','head');engine=create_engine(url)
    try:
        with DBSession(engine) as seed:
            actor=user(seed,role='client');seed.commit();uid=actor.id
        reached=threading.Event()
        def observe(conn,cursor,statement,parameters,context,many):
            if statement.startswith('UPDATE users'):reached.set()
        with DBSession(engine) as first:
            lock_users(first,[uid])
            event.listen(engine,'before_cursor_execute',observe)
            def deactivate():
                with DBSession(engine) as second:
                    second.execute(update(User).where(User.id==uid).values(status='inactive'));second.commit()
            with ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(deactivate)
                assert reached.wait(timeout=3) and not future.done()
                first.commit();future.result(timeout=5)
            event.remove(engine,'before_cursor_execute',observe)
        with DBSession(engine) as check:assert check.get(User,uid).status=='inactive'
    finally:engine.dispose()


@pytest.mark.parametrize('loss',['removed','organization_inactive','guest_scope'])
def test_review_r1_correct_rechecks_current_instructor_eligibility(pg_session,loss):
    from app.models.class_program import ClassInstructor
    from app.models.user_org_membership import UserOrgMembership
    from app.services.class_instructor_service import remove_instructor
    host,other,parent,clients,member,row,p=scene(pg_session,'completed')
    if loss=='removed':
        pg_session.add(ClassInstructor(class_id=parent.id,user_id=other.id,role='lead'))
        pg_session.flush();remove_instructor(pg_session,parent,host.id)
    elif loss=='organization_inactive':
        pg_session.query(UserOrgMembership).filter_by(user_id=host.id,org_id=parent.organization_id).one().status='inactive'
    else:
        other_session=Session(type='meditation',class_id=parent.id,host_id=host.id,seq=2,status='completed',host_state='assigned',duration_min=60)
        pg_session.add(other_session);pg_session.flush()
        instructor=pg_session.query(ClassInstructor).filter_by(class_id=parent.id,user_id=host.id).one()
        instructor.role='guest';instructor.scope_session_id=other_session.id
    pg_session.commit()
    with pytest.raises(HTTPException) as exc:act(pg_session,host,parent,member,row,'correct_absent',reason='현재 권한 필요')
    assert exc.value.status_code==403
    assert p.attendance_status=='expected'
    assert pg_session.query(ClassAttendanceEvent).filter_by(participant_id=p.id).count()==0


@pytest.mark.parametrize('member_status',['completed','removed','left'])
def test_review_r2_terminal_notify_before_room_cleanup(pg_session,monkeypatch,member_status):
    from app.ws import session_live_namespace as ws
    from app.services import session_service as service
    from app.services.class_rolling_service import finish_class_if_due
    from tests.test_sdd024_session_live_ws import FakeSio
    host,_,parent,clients,member,row,p=scene(pg_session,'completed')
    p.attendance_status='attended';p.entered_at=NOW;row.ended_at=NOW
    assert finish_class_if_due(pg_session,parent,NOW)
    member.status=member_status;pg_session.commit()
    sid='정상-종료';session_id=str(row.id);pid=str(p.id)
    sio=FakeSio();sio.sessions[sid]={'role':'participant','session_id':session_id,'participant_id':pid,'user_id':str(clients[0].id)}
    sio.rooms[('/session-live',sid)]={ws._room_all(session_id),ws._room_self(session_id,pid)}
    monkeypatch.setattr(ws,'_get_sio',lambda:sio);monkeypatch.setattr(ws,'_sid_session_ids',{sid:session_id})
    monkeypatch.setattr(ws,'_resolve_join',lambda sid,uid,pid=None,credential=None:service.resolve_live_join(sid,uid,pid,pg_session,entry_credential=credential))
    class Borrowed:
        def __enter__(self):return pg_session
        def __exit__(self,*args):pass
        def close(self):pass
        def __getattr__(self,name):return getattr(pg_session,name)
    monkeypatch.setattr(ws,'_open_db',lambda:Borrowed())
    asyncio.run(ws.broadcast_session_state(session_id,{'status':'completed','version':row.state_version,'ended_at':NOW.isoformat(),'PRIVATE':'비공개'}))
    direct=[e for e in sio.emits if e['to']==sid]
    terminal=[e for e in direct if e['event']=='session_state_changed']
    audio=[e for e in direct if e['event']==ws.AUDIO_SYNC_EVENT]
    if member_status=='completed':
        assert len(terminal)==1 and terminal[0]['data']['status']=='completed'
        assert len(audio)==1 and audio[0]['data']['action']=='stop'
        assert 'PRIVATE' not in str(direct)
    else:
        assert terminal==[] and audio==[]
    assert not sio.rooms[('/session-live',sid)]
