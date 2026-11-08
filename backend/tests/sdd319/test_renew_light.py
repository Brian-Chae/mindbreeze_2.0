"""SDD-319 round-1: outbox 없는 renew가 타 명령의 projection/방송을 기다리지 않는다.

DB 트랜잭션은 기존 apply_command_with_retry 경계로 격리한다. 실제 DB 리스·fencing·종료
경합은 tests/sdd246/commands/test_capture_cutoff_pg.py가 검증한다.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import class_participation_service as cps
from app.services import live_single_flight as sf
from app.services import session_live_commands as commands
from app.services.live_redis.client import LiveNotReady, LiveRedisUnavailable
from app.services.session_live_ledger import DurableResult
from app.services.session_live_state import LiveStateService, ScopeStale


@pytest.fixture
def command_case(monkeypatch):
    sid, actor = uuid4(), commands.Actor(uuid4(), 'member', uuid4())
    stream = uuid4()
    cmd = commands.LiveCommand(uuid4(), sid, 'capture.renew', {
        'stream_id': str(stream), 'owner_generation': '1', 'clock_anchor_id': str(uuid4())})
    result = DurableResult(cmd.command_id, 'applied', None, 1, 99, 2,
                           {'stream_id': str(stream), 'generation': '1', 'owner_generation': '1',
                            'lease_expires_at_ms': 200000, 'offline_bound_until_ms': 770000})
    db = SimpleNamespace(get=lambda *a: object(), rollback=lambda: None, close=lambda: None)
    live = object()
    cursors = [{'audience': 'public', 'domain': 'session', 'seq': '2'}]
    monkeypatch.setattr(cps, 'seed_live_state', lambda *a: None)
    monkeypatch.setattr(cps, 'make_probe_resolver', lambda *a: None)
    monkeypatch.setattr(cps, 'pop_after_commit', lambda *a: [])
    monkeypatch.setattr(commands, 'apply_command_with_retry', lambda *a, **kw: result)
    monkeypatch.setattr(cps, '_cursors_for', lambda *a, **kw: cursors)
    return SimpleNamespace(db=db, live=live, cmd=cmd, actor=actor, result=result, cursors=cursors)


@pytest.mark.parametrize('duplicate', [False, True])
def test_renew는_다른_revision의_busy_projector를_기다리지_않고_리스_ACK(command_case, monkeypatch, duplicate):
    case = command_case
    from dataclasses import replace
    result = replace(case.result, duplicate=duplicate)
    monkeypatch.setattr(commands, 'apply_command_with_retry', lambda *a, **kw: result)
    monkeypatch.setattr(sf, 'coalesced_drain', lambda *a, **kw: SimpleNamespace(busy=True, applied_revision=0))
    out = cps.run_live_command(case.db, case.actor, case.cmd, live=case.live)
    assert out.ack['status'] == ('duplicate' if duplicate else 'applied')
    assert out.ack['result']['lease']['expires_at_ms'] == 200000
    assert out.ack['cursors'] == case.cursors
    assert out.committed and not out.degraded


def test_capture_start는_여전히_projection_완료_전_ACK를_성공시키지_않음(command_case, monkeypatch):
    case = command_case
    from dataclasses import replace
    cmd = replace(case.cmd, kind='capture.start')
    monkeypatch.setattr(sf, 'coalesced_drain', lambda *a, **kw: SimpleNamespace(busy=True, applied_revision=0))
    out = cps.run_live_command(case.db, case.actor, cmd, live=case.live)
    assert out.ack['status'] == 'retryable' and out.ack['code'] == 'projection_pending'
    assert out.committed and out.degraded


@pytest.mark.parametrize('error,code,degraded', [
    (LiveRedisUnavailable('redis_unreachable'), 'live_unavailable', True),
    (LiveNotReady('not_ready'), 'projection_pending', True),
    (ScopeStale(1, 2), 'scope_stale', False),
])
def test_renew도_Redis_장애와_scope_변경을_무시하지_않음(command_case, monkeypatch, error, code, degraded):
    case = command_case
    monkeypatch.setattr(sf, 'coalesced_drain', lambda *a, **kw: SimpleNamespace(busy=False, applied_revision=99))
    def bad_scope(*a, **kw):
        raise error
    monkeypatch.setattr(cps, '_cursors_for', bad_scope)
    out = cps.run_live_command(case.db, case.actor, case.cmd, live=case.live)
    assert out.ack['status'] == 'retryable' and out.ack['code'] == code
    assert out.committed and out.degraded is degraded


class HandlerSocket:
    def __init__(self):
        self.handlers = {}

    def on(self, event, namespace=None):
        def register(fn):
            self.handlers[event] = fn
            return fn
        return register


@pytest.mark.parametrize('kind,publish_expected', [('capture.renew', False), ('capture.start', True)])
def test_실제_WS_handler에서_renew만_ACK전_동기_방송을_생략(command_case, monkeypatch, kind, publish_expected):
    from app.ws import session_live_namespace as ns
    from app.services import capture_anchor_watch as caw
    case = command_case
    calls = []
    monkeypatch.setenv('LIVE_PROTOCOL_V2', '1')
    monkeypatch.setattr(ns, 'install_default_ingest_sinks', lambda: None)
    monkeypatch.setattr(cps, 'register_live_handlers', lambda: None)
    monkeypatch.setattr(ns, '_open_db', lambda: case.db)
    monkeypatch.setattr(cps, 'get_live_redis', lambda: case.live)
    monkeypatch.setattr(LiveStateService, 'heartbeat', lambda *a, **kw: {'through': case.cursors})
    monkeypatch.setattr(caw, 'note_result', lambda *a: None)
    ack = {'command_id': str(case.cmd.command_id), 'status': 'applied', 'epoch': '1', 'committed': True,
           'cursors': case.cursors}
    monkeypatch.setattr(cps, 'run_live_command', lambda *a, **kw: cps.RunOutcome(ack, committed=True))
    monkeypatch.setattr(ns, 'publish_session_sync', lambda *a: calls.append('publish'))
    conn = ns.V2Conn(sid='synthetic', session_id=case.cmd.session_id, actor=case.actor, state='READY')
    monkeypatch.setattr(ns, '_v2_conns', {'synthetic': conn})
    sock = HandlerSocket()
    ns.register_v2_handlers(sock, ns._NAMESPACE)
    payload = case.cmd.payload if kind == 'capture.renew' else {
        'device_profile': 'lb2', 'algorithm_version': 'a1', 'model_version': 'm1'}
    wire = {'protocol_version': 2, 'schema_version': 1, 'command_id': str(case.cmd.command_id),
            'session_id': str(case.cmd.session_id), 'kind': kind, 'payload': payload,
            'client_generation': '1', 'expected_epoch': '1'}
    got = asyncio.run(sock.handlers['live:command']('synthetic', wire))
    assert got == ack
    assert calls == (['publish'] if publish_expected else [])


@pytest.mark.parametrize('kind,publish_expected', [('capture.renew', False), ('capture.start', True)])
def test_REST_fallback도_renew만_불필요한_방송_예약을_생략(command_case, monkeypatch, kind, publish_expected):
    import json
    from app.api.v1 import session as api
    from app.ws import session_live_namespace as ns
    case = command_case
    calls = []
    monkeypatch.setattr(api, '_v2_or_404', lambda: None)
    monkeypatch.setattr(api, '_live_actor', lambda *a: (case.cmd.session_id, case.actor))
    ack = {'command_id': str(case.cmd.command_id), 'status': 'applied', 'epoch': '1', 'committed': True,
           'cursors': case.cursors}
    monkeypatch.setattr(cps, 'run_live_command', lambda *a, **kw: cps.RunOutcome(ack, committed=True))
    monkeypatch.setattr(ns, 'schedule_publish', lambda *a: calls.append('publish'))
    payload = case.cmd.payload if kind == 'capture.renew' else {
        'device_profile': 'lb2', 'algorithm_version': 'a1', 'model_version': 'm1'}
    wire = {'protocol_version': 2, 'schema_version': 1, 'command_id': str(case.cmd.command_id),
            'session_id': str(case.cmd.session_id), 'kind': kind, 'payload': payload,
            'client_generation': '1', 'expected_epoch': '1'}
    response = api.live_v2_command(str(case.cmd.session_id), wire, current_user={}, db=case.db)
    assert response.status_code == 200 and json.loads(response.body) == ack
    assert calls == (['publish'] if publish_expected else [])
