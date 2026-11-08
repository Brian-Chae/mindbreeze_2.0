"""명시 실행 localhost Socket.IO/PG/Redis 부하. 합성 V2Conn, 120 snapshot, 고정 CPU 압박.

S319_SOCKET_LOAD=1. 외부 접근/기존 데이터 삭제 없이 UUID DB/Redis 증거를 보존한다.
실제 v2 command/metric handler. 로그인·REST 입장은 주입하며 저장은 REST 서비스를 시험 소켓으로 호출.
"""
from __future__ import annotations
import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import logging
import os
from pathlib import Path
import socket
import sys
import threading
import time
import uuid
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker
from tests.sdd308.test_s5_measurement import preserved_pg_url, _p95

@pytest.fixture(scope='session')
def pg_url():
    yield from preserved_pg_url()

@pytest.fixture(scope='session')
def pg_engine(pg_url):
    engine = sa.create_engine(pg_url, pool_size=20, max_overflow=20)
    yield engine
    engine.dispose()

@pytest.fixture
def maker(pg_engine):
    return sessionmaker(bind=pg_engine, autoflush=False)

def metric_window(sid, pid, stream, seq):
    return {'session_id': str(sid), 'participant_id': str(pid), 'stream_id': stream['stream_id'],
            'stream_generation': str(stream['generation']), 'sequence': str(seq),
            'window_start_us': str((seq-1)*1_000_000), 'window_end_us': str(seq*1_000_000),
            'observed_at_ms': int(time.time()*1000), 'clock_anchor_id': str(uuid.uuid4()),
            'clock_uncertainty_ms': 12.5, 'device_profile_version': 'linkband2-v1',
            'algorithm_version': 'web-ts-1', 'model_version': 'b0', 'feature_hash': 'a'*64,
            'contact': {'fp1': 'contact', 'fp2': 'contact'}, 'sqi': 0.9,
            'metrics': {'focus_raw': {'value': 1.5, 'unit': 'index_raw', 'validity': 'valid', 'reason': None,
                'last_valid_sequence': None, 'last_valid_observed_at_ms': None}}}

@pytest.mark.skipif(os.environ.get('S319_SOCKET_LOAD') != '1', reason='명시 실행하는 소켓 부하')
def test_renew_socket_snapshot_burst_cpu(maker, pg_engine, monkeypatch, caplog):
    import socketio
    from aiohttp import web
    from app.models.eeg_feature import EEGFeatureWindow
    from app.models.live_state import LiveOutbox, LiveSessionEpoch
    from app.models.session import SessionParticipant
    from app.schemas.session_live_ingest import parse_metric_batch
    from app.services import class_participation_service as cps, live_ingest_service as ingest, session_live_outbox as ob
    from app.services.live_redis.client import LiveRedis
    from app.services.session_live_commands import Actor
    from app.services.session_live_state import Scope
    from app.ws import session_live_namespace as ns
    from tests.sdd308.helpers import build_scene
    n, ticks = int(os.environ.get('S319_SOCKET_N','100')), int(os.environ.get('S319_SOCKET_TICKS','32'))
    burst, burn = int(os.environ.get('S319_SOCKET_BURST','120')), float(os.environ.get('S319_SOCKET_BURN_MS','15'))
    assert 0 <= burn < 25
    live = LiveRedis.from_url('redis://localhost:6379/11', prefix='sdd319-renew:'+uuid.uuid4().hex)
    try:
        live.r.ping()
    except Exception:
        live.r.close()
        pytest.skip('로컬 Redis 없음')
    caplog.set_level(logging.INFO, logger=cps.__name__)
    caplog.set_level(logging.INFO, logger="app.services.live_command_timing")
    from app.services import live_single_flight as sf
    before_stats = dict(sf.stats)
    scene = build_scene(maker,n)
    cps.register_live_handlers(); cps.set_live_redis(live)
    monkeypatch.setenv('LIVE_PROTOCOL_V2','1')
    monkeypatch.setattr(ns,'_open_db',maker); monkeypatch.setattr(ns,'_v2_conns',{})
    monkeypatch.setattr(ns,'_METRIC_SINK',None); monkeypatch.setattr(ns,'_DEVICE_SINK',None)
    with maker() as db:
        cps.seed_live_state(db,scene.session_id)
        ob.drain(db,live,scene.session_id)
    counts, errors = Counter(), Counter()
    timings = {k: [] for k in ('renew','metric','store','snapshot')}
    emitted, received, cpu_samples, lags = set(), set(), [], []
    settle = {}
    mutex = threading.Lock()
    def count(k, v=1):
        with mutex: counts[k] += v
    def db_error(ctx):
        if getattr(ctx.original_exception,'pgcode',None)=='40P01': count('deadlock')
    sa.event.listen(pg_engine,'handle_error',db_error)

    async def run():
        loop = asyncio.get_running_loop()
        loop.set_default_executor(ThreadPoolExecutor(max_workers=32))
        sio = socketio.AsyncServer(async_mode='aiohttp',logger=False,engineio_logger=False,ping_timeout=60)
        app = web.Application(); sio.attach(app)
        monkeypatch.setattr(ns,'_get_sio',lambda:sio); monkeypatch.setattr(ns,'_loop',loop)
        ns.register_v2_handlers(sio,ns._NAMESPACE)
        original_emit=sio.emit
        async def traced_emit(name,data=None,**kw):
            out=await original_emit(name,data,**kw)
            if name=='live:event': emitted.add((data['event_id'],data['audience']))
            return out
        sio.emit=traced_emit
        @sio.on('connect',namespace=ns._NAMESPACE)
        async def connect(sid,environ,auth):
            i=int(auth['index'])
            if i<n:
                uid,pid=scene.members[i]; actor=Actor(actor_id=uid,role='member',participant_id=pid); aud=f'member:{pid}'
            else:
                uid=scene.host_id; actor=Actor(actor_id=uid,role='host'); aud='host'
            conn=ns.V2Conn(sid=sid,user_id=uid,session_id=scene.session_id,actor=actor,state='READY')
            ns._v2_conns[sid]=conn
            for audience in ('public',aud):
                room=ns.room_audience(scene.session_id,audience)
                await sio.enter_room(sid,room,namespace=ns._NAMESPACE); conn.rooms.append(room)
        @sio.on('disconnect',namespace=ns._NAMESPACE)
        async def disconnect(sid,reason=None): ns._v2_drop(sid)
        @sio.on('test:snapshot',namespace=ns._NAMESPACE)
        async def snapshot(sid,data):
            def read():
                with maker() as db: return ob.snapshot_ready(db,live,scene.session_id,Scope('host'))
            return await asyncio.to_thread(read)
        @sio.on('test:store',namespace=ns._NAMESPACE)
        async def store(sid,data):
            actor=ns._v2_conns[sid].actor
            def save():
                with maker() as db:
                    return ingest.store_batch(db,db.get(SessionParticipant,actor.participant_id),scene.session_id,parse_metric_batch(data))
            return await asyncio.to_thread(save)
        runner=web.AppRunner(app,access_log=None); await runner.setup()
        bound=socket.socket(); bound.bind(('127.0.0.1',0)); bound.listen(256); bound.setblocking(False)
        port=bound.getsockname()[1]; await web.SockSite(runner,bound).start()
        finish,pressure_on=threading.Event(),threading.Event()
        async def pressure():
            wall0,cpu0,expected=time.monotonic(),time.process_time(),time.monotonic()
            while not finish.is_set():
                if pressure_on.is_set():
                    now=time.monotonic(); lags.append(max(0,now-expected)); until=now+burn/1000
                    while time.monotonic()<until: pass
                    expected=time.monotonic()+(25-burn)/1000
                    await asyncio.sleep((25-burn)/1000)
                    wall,cpu=time.monotonic(),time.process_time()
                    if wall-wall0>=1:
                        cpu_samples.append((cpu-cpu0)/(wall-wall0)*100); wall0,cpu0=wall,cpu
                else:
                    wall0,cpu0=time.monotonic(),time.process_time(); await asyncio.sleep(.01)
        async def clients():
            clients_list,captures=[],{}
            async def call(client,name,data,timing=None):
                start=time.monotonic()
                try: result=await client.call(name,data,namespace=ns._NAMESPACE,timeout=30)
                except Exception as exc:
                    with mutex: errors[f'{name}:{type(exc).__name__}']+=1
                    return {}
                if timing:
                    with mutex: timings[timing].append(time.monotonic()-start)
                return result
            def cmd(kind,payload):
                return {'protocol_version':2,'schema_version':1,'command_id':str(uuid.uuid4()),'session_id':str(scene.session_id),'expected_epoch':str(live.read_meta(scene.session_id)['epoch']),'client_generation':'0','kind':kind,'payload':payload}
            async def init(i):
                client=socketio.AsyncClient(logger=False,engineio_logger=False,reconnection=False); clients_list.append(client)
                @client.on('live:event',namespace=ns._NAMESPACE)
                async def receive(data):
                    with mutex: received.add((data['event_id'],data['audience']))
                await client.connect(f'http://127.0.0.1:{port}',auth={'index':i},namespaces=[ns._NAMESPACE],transports=['websocket'],wait_timeout=30)
                if i<n:
                    ack=await call(client,'live:command',cmd('capture.start',{'device_profile':'linkband2-v1','algorithm_version':'web-ts-1','model_version':'b0'}))
                    assert ack.get('committed'),ack.get('code')
                    captures[i]=(client,ack['result']); count('started')
                return client
            try:
                host=await init(n)
                await asyncio.gather(*(init(i) for i in range(n)))
                started=time.monotonic(); pressure_on.set()
                async def member(i):
                    client,stream=captures[i]; pid=scene.members[i][1]
                    for tick in range(ticks):
                        await asyncio.sleep(max(0,started+tick-time.monotonic()))
                        if tick%10==0:
                            ack=await call(client,'live:command',cmd('capture.renew',{'stream_id':stream['stream_id'],'owner_generation':str(stream['generation']),'clock_anchor_id':str(uuid.uuid4())}),'renew')
                            count('renew')
                            if ack.get('code')=='projection_pending': count('projection_pending')
                            if not ack.get('committed'): count('renew_failed')
                        payload={'protocol_version':2,'schema_version':1,'windows':[metric_window(scene.session_id,pid,stream,tick+1)]}
                        metric,stored=await asyncio.gather(call(client,'live:metric',payload,'metric'),call(client,'test:store',payload,'store'))
                        metric_ack=metric.get('acks',[{}])[0]
                        count('metric_projected' if metric_ack.get('status')=='projected' else 'metric_failed')
                        count('metric_status:'+str(metric_ack.get('status',metric.get('code','missing')))+':'+str(metric_ack.get('code','none')))
                        count('stored_ack' if stored and stored[0].get('durable') else 'store_failed')
                    count('completed')
                async def refresh():
                    await asyncio.sleep(2)
                    await asyncio.gather(*(call(host,'test:snapshot',{},'snapshot') for _ in range(burst)))
                    count('snapshot_completed',len(timings['snapshot']))
                await asyncio.gather(refresh(),*(member(i) for i in range(n)))
                pressure_on.clear()
                settle_started=time.monotonic()
                def settled():
                    with maker() as db:
                        target=int(db.get(LiveSessionEpoch,scene.session_id).revision)
                    applied=int(live.read_meta(scene.session_id)['applied_revision'])
                    done=int(live.r.get(live.emitted_key(scene.session_id)) or 0)
                    with sf._lock:
                        active=bool(sf._pub_running.get(('publish',str(scene.session_id))))
                    return target,applied,done,active
                settle['before']=await asyncio.to_thread(settled)
                while True:
                    future=asyncio.run_coroutine_threadsafe(asyncio.to_thread(ns.publish_session_sync,scene.session_id),loop)
                    await asyncio.wrap_future(future)
                    state=await asyncio.to_thread(settled)
                    if state[0]==state[1]==state[2] and not state[3]:
                        break
                    if time.monotonic()-settle_started>60:
                        raise AssertionError('최종 projection/publish 안정화 제한 초과')
                    await asyncio.sleep(.1)
                settle['after']=state
                settle['duration_s']=time.monotonic()-settle_started
                await asyncio.sleep(.5)
            finally:
                pressure_on.clear()
                await asyncio.gather(*(c.disconnect() for c in clients_list if c.connected),return_exceptions=True)
                finish.set()
        pressure_task=asyncio.create_task(pressure()); failure=[]
        def client_thread():
            try: asyncio.run(clients())
            except BaseException as exc: failure.append(exc); finish.set()
        worker=threading.Thread(target=client_thread,daemon=True); start=time.monotonic(); worker.start()
        try:
            while not finish.is_set(): await asyncio.sleep(.1)
            await asyncio.to_thread(worker.join,10)
            if failure: raise failure[0]
            return time.monotonic()-start
        finally:
            finish.set(); await pressure_task; await sio.shutdown(); await runner.cleanup()
    try:
        elapsed=asyncio.run(run())
        with maker() as db:
            expected={(str(r.event_id),aud) for r in db.scalars(sa.select(LiveOutbox).where(LiveOutbox.session_id==scene.session_id)) for aud in r.audience_policy}
            stored=db.scalar(sa.select(sa.func.count()).select_from(EEGFeatureWindow).where(EEGFeatureWindow.session_id==scene.session_id))
            revision=db.get(LiveSessionEpoch,scene.session_id).revision
        summary={'n':n,'ticks':ticks,'burst':burst,'burn_ms':burn,'period_ms':25,'elapsed_s':elapsed,'counts':dict(counts),'errors':dict(errors),
                 'p95_s':{k:_p95(v) for k,v in timings.items()},'cpu_process_mean_pct':sum(cpu_samples)/len(cpu_samples) if cpu_samples else None,
                 'cpu_process_max_pct':max(cpu_samples) if cpu_samples else None,'loop_lag_p95_s':_p95(lags),'stored_count':stored,'expected_windows':n*ticks,
                 'broadcast_expected_pairs':len(expected),'broadcast_missing_pairs':len(expected-emitted),'client_missing_pairs':len(expected-received),
                 'revision':revision,'applied_revision':int(live.read_meta(scene.session_id)['applied_revision']),'emitted_revision':int(live.r.get(live.emitted_key(scene.session_id)) or 0),
                 'final_settle':settle,'source_path':cps.__file__,'cps_sha256':hashlib.sha256(Path(cps.__file__).read_bytes()).hexdigest(),'namespace_sha256':hashlib.sha256(Path(ns.__file__).read_bytes()).hexdigest(),
                 'single_flight_stats':{k: v-before_stats.get(k,0) for k,v in sf.stats.items()},
                 'timing_logs':[r.getMessage() for r in caplog.records if 'live_command_timing' in r.getMessage()],
                 'limitations':['합성 V2Conn 인증/입장 주입','저장은 REST 서비스이나 test socket으로 전송','client도 같은 process 별도 loop','고정 CPU busy slice 합성 압박','fixed ticks 밀리면 종료 연장','직접 READY 주입으로 연결당 heartbeat 스케줄러 미실행','client coverage는 event_id×audience 합집합이며 클라이언트별 전송보장 아님']}
        if os.environ.get('S319_SOCKET_RESULT'): Path(os.environ['S319_SOCKET_RESULT']).write_text(json.dumps(summary,ensure_ascii=False,indent=2))
        print('S319_SOCKET_LOAD '+json.dumps(summary,ensure_ascii=False),flush=True)
        assert counts['started']==counts['completed']==n,summary
        assert not errors and counts.get('deadlock',0)==0,summary
        assert stored==n*ticks and counts.get('store_failed',0)==0,summary
        assert not expected-emitted,summary
    finally:
        sa.event.remove(pg_engine,'handle_error',db_error); cps.set_live_redis(None); live.r.close()

if __name__=='__main__':
    baseline=os.environ.get('S308_BASELINE_SRC')
    if baseline:
        sys.path.insert(0,baseline)
        import app
        assert Path(app.__file__).resolve().is_relative_to(Path(baseline).resolve())
    raise SystemExit(pytest.main(sys.argv[1:]))
