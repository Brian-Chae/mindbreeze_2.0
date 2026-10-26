"""T04: 실제 PostgreSQL의 영속 체크인·여러 탭 lease·스냅샷 권한."""
from datetime import timedelta
import importlib.util
import pytest
from fastapi import HTTPException
from app.models.record import SessionRecord
from app.models.session import Session
from tests.pg.test_sdd217_attendance import scene, NOW
pytestmark = pytest.mark.pg

def service():
    assert importlib.util.find_spec('app.services.class_participation_service'), '참여 스냅샷 서비스 필요'
    from app.services import class_participation_service
    return class_participation_service

def test_nv04_persisted_before_only_no_pii(pg_session):
    host, _, cls, clients, _, row, p = scene(pg_session, 'in_progress')
    pg_session.add(SessionRecord(session_id=row.id, status='idle', subjective_state={'participants':{str(p.id):{'after':{'note':'비공개'}}}})); pg_session.commit()
    svc = service()
    result = svc.snapshot(pg_session, cls.id, row.id, str(host.id), now=NOW)
    assert result['participants'][0]['checkin_state'] == 'unknown'
    record = pg_session.query(SessionRecord).filter_by(session_id=row.id).one()
    record.subjective_state={'participants':{str(p.id):{'before':{'note':'비공개', 'recorded_at':NOW.isoformat()}}}}; pg_session.commit()
    result = svc.snapshot(pg_session, cls.id, row.id, str(host.id), now=NOW)
    assert result['participants'][0]['checkin_state'] == 'completed'
    assert '비공개' not in str(result) and 'note' not in str(result)
    assert result['participants'][0]['presence_state'] == 'unknown'
    assert p.entered_at is None

def test_nv05_08_multiple_tabs_expiry_and_monotonic_version(pg_session):
    host, _, cls, clients, _, row, p = scene(pg_session, 'in_progress')
    svc = service(); context={'session_id':str(row.id),'participant_id':str(p.id),'user_id':str(clients[0].id),'role':'participant'}
    first = svc.socket_update(pg_session, 'tab-a', context, 'join', now=NOW)
    second = svc.socket_update(pg_session, 'tab-b', context, 'join', now=NOW+timedelta(seconds=5))
    assert first['participants'][0]['presence_state']=='connected'
    assert second['participation_version'] > first['participation_version']
    left = svc.socket_update(pg_session, 'tab-a', context, 'leave', now=NOW+timedelta(seconds=10))
    assert left['participants'][0]['presence_state']=='connected'
    refreshed = svc.socket_update(pg_session, 'tab-b', context, 'heartbeat', now=NOW+timedelta(seconds=30))
    expired = svc.snapshot(pg_session, cls.id, row.id, str(host.id), now=NOW+timedelta(seconds=121))
    assert expired['participants'][0]['presence_state']=='disconnected'
    assert expired['participation_version'] > refreshed['participation_version']
    assert (row.state_version or 0) == 0 and p.entered_at is None

def test_nv06_snapshot_self_and_current_host_only(pg_session):
    host, other, cls, clients, _, row, p = scene(pg_session, 'in_progress')
    svc=service()
    own=svc.snapshot(pg_session, cls.id, row.id, str(clients[0].id), now=NOW)
    assert [x['participant_id'] for x in own['participants']]==[str(p.id)]
    with pytest.raises(HTTPException): svc.snapshot(pg_session, cls.id, row.id, str(other.id), now=NOW)
    from app.models.class_program import ClassInstructor
    instructor=pg_session.query(ClassInstructor).filter_by(class_id=cls.id,user_id=host.id).one(); instructor.status='removed'; pg_session.commit()
    with pytest.raises(HTTPException): svc.snapshot(pg_session, cls.id, row.id, str(host.id), now=NOW)

def test_nv04_rest_before_persists_state_and_increments(pg_session,monkeypatch):
    from app.schemas.record import CheckinRequest
    from app.services import record_service, session_service
    host, _, cls, clients, _, row, p = scene(pg_session, 'in_progress')
    monkeypatch.setattr(session_service, '_notify_participant_changed', lambda *a:None)
    record_service.submit_checkin(str(row.id), CheckinRequest(phase='before',arousal=3),str(clients[0].id),pg_session)
    assert p.checkin_state=='completed' and p.checkin_at is not None
    assert row.participation_version==1

def test_nv06_http_snapshot_no_operational_privilege(pg_session,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.v1 import class_membership
    from app.api.deps import get_current_user_optional
    from app.core.database import get_db
    from app.config import settings
    host, other, cls, clients, _, row, p=scene(pg_session,'in_progress')
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(class_membership.router,prefix='/api/v1'); identity={'id':str(host.id)}
    app.dependency_overrides[get_current_user_optional]=lambda:identity; app.dependency_overrides[get_db]=lambda:pg_session
    with TestClient(app) as client:
        path=f'/api/v1/classes/{cls.id}/sessions/{row.id}/participation'
        response=client.get(path); assert response.status_code==200,response.text
        assert response.json()['participants'][0]['presence_state']=='unknown'
        identity['id']=str(other.id); assert client.get(path).status_code==403

@pytest.mark.parametrize("join_failure", [False, True])
def test_nv05_real_ws_join_heartbeat_leave_disconnect(scratch_db,monkeypatch,join_failure):
    import asyncio, socket
    import socketio, uvicorn
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session as DBSession
    from tests.pg.conftest import alembic_ok
    from app.ws import session_live_namespace as ws
    from app.services.entry_credential_service import issue
    from app.models.class_membership import SessionPresenceLease
    url=scratch_db('participation_ws'); alembic_ok(url,'upgrade','head'); engine=create_engine(url)
    try:
        with DBSession(engine) as seed:
            host,_,cls,clients,member,row,p=scene(seed,'in_progress'); token,_=issue(p); sid,pid=row.id,p.id
        sio=socketio.AsyncServer(async_mode='asgi',cors_allowed_origins='*')
        monkeypatch.setattr(ws,'_get_sio',lambda:sio);monkeypatch.setattr(ws,'_open_db',lambda:DBSession(engine))
        monkeypatch.setattr(ws,'_sid_session_ids',{});monkeypatch.setattr(ws,'_session_socket_counts',{});monkeypatch.setattr(ws,'_loop',None)
        ws.register_session_live_namespace(sio)
        if join_failure:
            from app.services import class_participation_service
            update = class_participation_service.socket_update
            def fail_join(db, socket_id, context, action, **kw):
                if action == 'join': raise HTTPException(403, detail='가입 직후 권한 상실')
                return update(db, socket_id, context, action, **kw)
            monkeypatch.setattr(class_participation_service,'socket_update',fail_join)
        def stored():
            with DBSession(engine) as db:
                leases=db.query(SessionPresenceLease).filter_by(session_id=sid).all()
                return len(leases),db.get(Session,sid).participation_version
        async def run():
            sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(8);sock.setblocking(False)
            server=uvicorn.Server(uvicorn.Config(socketio.ASGIApp(sio),log_level='error',lifespan='off'))
            task=asyncio.create_task(server.serve(sockets=[sock])); client=socketio.AsyncClient(); joined=asyncio.Queue()
            client.on('joined',lambda data:joined.put_nowait(data),namespace='/session-live')
            client.on('join_denied',lambda data:joined.put_nowait(data),namespace='/session-live')
            try:
                for _ in range(100):
                    if server.started: break
                    await asyncio.sleep(.01)
                await client.connect(f'http://127.0.0.1:{sock.getsockname()[1]}',namespaces=['/session-live'],transports=['websocket'])
                payload={'session_id':str(sid),'participant_id':str(pid),'entry_credential':token}
                await client.emit('join',payload,namespace='/session-live'); event=await asyncio.wait_for(joined.get(),3)
                if join_failure:
                    assert 'snapshot' not in event
                    server_sid=client.get_sid('/session-live')
                    assert ws._room_all(str(sid)) not in sio.rooms(server_sid,namespace='/session-live')
                    assert ws._room_self(str(sid),str(pid)) not in sio.rooms(server_sid,namespace='/session-live')
                    return
                assert event['snapshot'].get('participation_version',0)>0
                assert event['snapshot']['participants'][0]['presence_state']=='connected'
                count,version=await asyncio.to_thread(stored); assert count==1
                ack=await client.call('participation_heartbeat',{'participant_id':'타인','session_id':'타회차'},namespace='/session-live',timeout=3)
                assert ack['participation_version']>version
                await client.call('leave',{'session_id':str(sid)},namespace='/session-live',timeout=3)
                assert (await asyncio.to_thread(stored))[0]==0
                await client.emit('join',payload,namespace='/session-live');await asyncio.wait_for(joined.get(),3)
                await client.disconnect()
                for _ in range(50):
                    if (await asyncio.to_thread(stored))[0]==0:break
                    await asyncio.sleep(.01)
                assert (await asyncio.to_thread(stored))[0]==0
            finally:
                if client.connected:await client.disconnect()
                server.should_exit=True;await task;await sio.shutdown()
        asyncio.run(run())
    finally:engine.dispose()

def test_guest_participation_http_uses_entry_credential(pg_session,monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.api.v1 import class_membership
    from app.api.deps import get_current_user_optional
    from app.core.database import get_db
    from app.config import settings
    from app.services.entry_credential_service import issue
    host,_,cls,clients,_,row,p=scene(pg_session,'in_progress');p.user_id=None;pg_session.commit();token,_=issue(p)
    monkeypatch.setattr(settings,'class_scheduling_enabled',True)
    app=FastAPI();app.include_router(class_membership.router,prefix='/api/v1')
    app.dependency_overrides[get_current_user_optional]=lambda:None;app.dependency_overrides[get_db]=lambda:pg_session
    path=f'/api/v1/classes/{cls.id}/sessions/{row.id}/participation'
    with TestClient(app) as client:
        response=client.get(path,headers={'X-Entry-Credential':token})
        assert response.status_code==200,response.text
        assert [x['participant_id'] for x in response.json()['participants']]==[str(p.id)]
        assert client.get(path).status_code==401

def test_event_version_is_captured_before_commit_releases_lock(pg_session,monkeypatch):
    from app.services.session_service import _notify_participant_changed
    from app.ws import session_live_namespace as ws
    host,_,cls,clients,_,row,p=scene(pg_session,'in_progress')
    row.participation_version=7;pg_session.commit(); seen=[]
    original=pg_session.commit
    def advance_after_commit():
        original()
        # 잠금 해제 직후 다른 쓰기가 버전을 올리는 경계를 결정적으로 주입한다.
        row.participation_version += 1
        original()
    monkeypatch.setattr(pg_session,'commit',advance_after_commit)
    monkeypatch.setattr(ws,'notify_participant_changed',lambda sid,payload:seen.append(payload))
    _notify_participant_changed(row,pg_session)
    assert seen[0]['participation_version']==7
    assert row.participation_version==8
