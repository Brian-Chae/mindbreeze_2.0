"""SDD-319 round-2: projector/명령 큐 왕복을 줄이되 crash·권한 검사를 유지한다."""
from __future__ import annotations
import asyncio
from types import SimpleNamespace as NS
from uuid import uuid4
import pytest
from app.services import class_participation_service as cps, session_live_outbox as ob
from app.services.session_live_commands import Actor
from app.services.session_live_state import LiveStateService, ScopeStale
from app.services.live_redis.client import LiveRedisUnavailable


def projector(monkeypatch, n):
    state = NS(applied=0, marked=set(), calls=[], projected=[])
    rows = [NS(revision=i) for i in range(1, n + 1)]
    db = NS(rollback=lambda: None)
    live = NS(read_meta=lambda sid: {'applied_revision': str(state.applied)}, renew_projector=lambda *a: True)
    def mark(db, sid, rev):
        state.calls.append(rev)
        previous = len(state.marked)
        state.marked.update(range(1, rev + 1))
        return len(state.marked) - previous
    def project(live, sid, row, epoch, fence, auth):
        assert row.revision == state.applied + 1
        state.applied = row.revision
        state.projected.append(row.revision)
        return ['ok']
    monkeypatch.setattr(ob, '_mark_processed', mark)
    monkeypatch.setattr(ob, '_pending_rows', lambda db, sid, applied, batch: [r for r in rows if r.revision > applied][:batch])
    monkeypatch.setattr(ob, '_epoch_row', lambda *a: NS(auth_revision=0))
    monkeypatch.setattr(ob, '_project_row', project)
    return state, db, live


def test_500행_projector는_순서를_보존하며_표기를_배치로_커밋(monkeypatch):
    state, db, live = projector(monkeypatch, 500)
    out = ob.DrainResult()
    ob._drain_locked(db, live, uuid4(), object(), 1, out, ob.Hooks(), 500)
    assert state.projected == list(range(1, 501))
    assert state.marked == set(range(1, 501))
    assert out.applied_revision == out.projected == out.marked == 500
    assert len(state.calls) <= 4, '성공 배치 표기와 시작/종료 복구 표기만 허용'


def test_after_redis_실패면_완료_prefix만_표기하고_재개시_중복투영_없음(monkeypatch):
    state, db, live = projector(monkeypatch, 3)
    sid = uuid4()
    def crash(row):
        if row.revision == 2:
            raise RuntimeError('합성 crash')
    with pytest.raises(RuntimeError, match='합성 crash'):
        ob._drain_locked(db, live, sid, object(), 1, ob.DrainResult(), ob.Hooks(after_redis=crash), 500)
    assert state.applied == 2 and state.marked == {1}
    out = ob.DrainResult()
    ob._drain_locked(db, live, sid, object(), 1, out, ob.Hooks(), 500)
    assert state.projected == [1, 2, 3] and state.marked == {1, 2, 3}
    assert out.projected == 1 and out.applied_revision == 3


class SocketStub:
    def __init__(self):
        self.handlers, self.emitted = {}, []
    def on(self, name, namespace=None):
        def register(fn):
            self.handlers[name] = fn
            return fn
        return register
    async def emit(self, name, data, **kwargs):
        self.emitted.append((name, data))
    async def leave_room(self, *args, **kwargs):
        pass


@pytest.fixture
def command_flow(monkeypatch):
    from app.ws import session_live_namespace as ns
    from app.services import capture_anchor_watch as caw
    actor, sid, cid = Actor(uuid4(), 'member', uuid4()), uuid4(), uuid4()
    state = NS(job=0, jobs=[], steps=[], db_calls=0, scope_calls=0)
    db = NS(get=lambda *a: NS(auth_revision=2), close=lambda: None)
    ack = {'command_id': str(cid), 'status': 'applied', 'epoch': '1', 'committed': True, 'cursors': []}
    monkeypatch.setenv('LIVE_PROTOCOL_V2', '1')
    monkeypatch.setattr(ns, 'install_default_ingest_sinks', lambda: None)
    monkeypatch.setattr(cps, 'register_live_handlers', lambda: None)
    monkeypatch.setattr(ns, '_open_db', lambda: db)
    monkeypatch.setattr(cps, 'get_live_redis', lambda: object())
    monkeypatch.setattr(cps, 'resolve_live_actor', lambda *a: actor)
    monkeypatch.setattr(caw, 'note_result', lambda *a: None)
    monkeypatch.setattr(caw, 'log_gate_reject', lambda *a: None)
    async def job(fn, *args, **kwargs):
        state.job += 1
        state.jobs.append(fn.__name__)
        return fn(*args, **kwargs)
    monkeypatch.setattr(asyncio, 'to_thread', job)
    def scope(*a, **kw):
        state.scope_calls += 1
        state.steps.append(('scope', state.job))
        return {'through': []}
    monkeypatch.setattr(LiveStateService, 'heartbeat', scope)
    def run(*a, **kw):
        state.db_calls += 1
        state.steps.append(('command', state.job))
        return cps.RunOutcome(ack, committed=True)
    monkeypatch.setattr(cps, 'run_live_command', run)
    conn = ns.V2Conn(sid='test', session_id=sid, user_id=actor.actor_id, actor=actor, auth_revision=1, state='READY')
    monkeypatch.setattr(ns, '_v2_conns', {'test': conn})
    sock = SocketStub()
    ns.register_v2_handlers(sock, ns._NAMESPACE)
    wire = {'protocol_version': 2, 'schema_version': 1, 'command_id': str(cid), 'session_id': str(sid),
            'kind': 'capture.renew', 'client_generation': '1', 'expected_epoch': '1',
            'payload': {'stream_id': str(uuid4()), 'owner_generation': '1', 'clock_anchor_id': str(uuid4())}}
    return NS(state=state, conn=conn, sock=sock, wire=wire, actor=actor, ack=ack)


def invoke(case):
    return asyncio.run(case.sock.handlers['live:command']('test', case.wire))


def test_정상_명령은_권한검사와_DB실행을_한_worker에서_순서대로_수행(command_flow):
    c = command_flow
    assert invoke(c) == c.ack
    assert [name for name, _ in c.state.steps] == ['scope', 'command']
    assert len(c.state.jobs) == 1, '정상 요청의 threadpool 큐 왕복은 한 번'
    assert c.state.steps[0][1] == c.state.steps[1][1]


def test_scope_stale은_재인가와_resync후_명령을_한번만_수행(command_flow, monkeypatch):
    c = command_flow
    def stale_once(*a, **kw):
        c.state.scope_calls += 1
        c.state.steps.append(('scope', c.state.job))
        if c.state.scope_calls == 1:
            raise ScopeStale(1, 2)
        return {'through': []}
    monkeypatch.setattr(LiveStateService, 'heartbeat', stale_once)
    assert invoke(c) == c.ack
    assert c.state.db_calls == 1 and c.conn.auth_revision == 2
    assert any(name == 'live:resync_required' for name, _ in c.sock.emitted)


def test_scope_권한상실이면_명령_DB실행없이_거절(command_flow, monkeypatch):
    c = command_flow
    def stale(*a, **kw):
        raise ScopeStale(1, 2)
    monkeypatch.setattr(LiveStateService, 'heartbeat', stale)
    monkeypatch.setattr(cps, 'resolve_live_actor', lambda *a: None)
    result = invoke(c)
    assert result['code'] == 'access_revoked'
    assert c.state.db_calls == 0 and c.conn.state == 'REVOKED'


def test_scope_Redis장애는_기존_명령서비스의_retryable_응답을_보존(command_flow, monkeypatch):
    c = command_flow
    def unavailable(*a, **kw):
        raise LiveRedisUnavailable('redis_unreachable')
    monkeypatch.setattr(LiveStateService, 'heartbeat', unavailable)
    retry = {**c.ack, 'status': 'retryable', 'code': 'live_unavailable'}
    monkeypatch.setattr(cps, 'run_live_command', lambda *a, **kw: cps.RunOutcome(retry, committed=True, degraded=True))
    assert invoke(c) == retry


def test_재인가_직후에도_scope가_바뀌면_DB쓰기없이_retryable(command_flow, monkeypatch):
    c = command_flow
    def stale(*a, **kw):
        c.state.scope_calls += 1
        raise ScopeStale(c.conn.auth_revision or 0, (c.conn.auth_revision or 0) + 1)
    monkeypatch.setattr(LiveStateService, 'heartbeat', stale)
    result = invoke(c)
    assert result['status'] == 'retryable' and result['code'] == 'scope_stale'
    assert result['committed'] is False and c.state.db_calls == 0
    assert c.state.scope_calls == 2, '재인가 뒤 재검사도 실패하면 무한 재시도하지 않는다'


def test_최초_성공행은_다음행_투영전에_재구축_흔적을_남김(monkeypatch):
    state, db, live = projector(monkeypatch, 3)
    def check(row):
        if row.revision == 2:
            assert 1 in state.marked
    ob._drain_locked(db, live, uuid4(), object(), 1, ob.DrainResult(), ob.Hooks(before_redis=check), 500)
