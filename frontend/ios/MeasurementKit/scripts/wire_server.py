"""합성 python-socketio 서버 — T07 wire 호환 시험 전용. dev 서버/DB/.env 를 쓰지 않는다.
/session-live namespace, websocket-only. connect auth{token}: 'good-*' 만 허용, 'expired' 는 token_expired 로 거절.
live:hello / live:join(snapshot+sync_complete 전송) / live:applied(READY) / live:presence / live:metric(ACK) / live:command(ACK) / live:reauth
테스트 제어: 'test:push' 이벤트로 서버가 임의 이벤트를 방송, 'test:stats' 로 수신 통계 조회.
"""
import asyncio, sys, json, uuid
import socketio
from aiohttp import web

sio = socketio.AsyncServer(async_mode='aiohttp', cors_allowed_origins='*', allow_upgrades=False, transports=['websocket'])
app = web.Application(); sio.attach(app)
NS = '/session-live'
stats = {'connects': 0, 'hello': 0, 'join': 0, 'applied': 0, 'presence': 0, 'metric_windows': 0, 'commands': {}, 'reauth': 0, 'tokens': []}
sessions = {}

@sio.on('connect', namespace=NS)
async def connect(sid, environ, auth):
    stats['connects'] += 1
    tok = (auth or {}).get('token', '')
    stats['tokens'].append(tok)
    if tok == 'expired':
        raise socketio.exceptions.ConnectionRefusedError('token_expired')
    if not tok.startswith('good'):
        raise socketio.exceptions.ConnectionRefusedError('auth_failed')
    sessions[sid] = {'token': tok}

@sio.on('live:hello', namespace=NS)
async def hello(sid, data):
    stats['hello'] += 1
    if data.get('protocol_version') != 2 or 'native_background' not in data.get('capabilities', []):
        return {'ok': False, 'code': 'upgrade_required', 'retryable': False}
    return {'ok': True, 'protocol_version': 2, 'capabilities': [], 'server_time_ms': 1, 'heartbeat_s': 5, 'state': 'CONNECTING'}

@sio.on('live:join', namespace=NS)
async def join(sid, data):
    stats['join'] += 1
    snap = str(uuid.uuid4())
    sessions[sid]['snap'] = snap
    async def later():
        await asyncio.sleep(0.05)
        await sio.emit('live:snapshot', {'snapshot_id': snap, 'epoch': '1', 'through': [{'audience': 'host', 'domain': 'metrics', 'seq': '0'}]}, to=sid, namespace=NS)
        await sio.emit('live:sync_complete', {'snapshot_id': snap, 'through': []}, to=sid, namespace=NS)
    asyncio.get_event_loop().create_task(later())
    return {'ok': True, 'snapshot_id': snap, 'state': 'RESYNCING', 'epoch': '1'}

@sio.on('live:applied', namespace=NS)
async def applied(sid, data):
    stats['applied'] += 1
    ok = data.get('snapshot_id') == sessions[sid].get('snap')
    return {'ok': ok, 'state': 'READY' if ok else 'RESYNCING'}

@sio.on('live:presence', namespace=NS)
async def presence(sid, data):
    stats['presence'] += 1
    stats['last_presence'] = data
    return {'ok': True, 'lease_ttl_s': 15}

@sio.on('live:metric', namespace=NS)
async def metric(sid, data):
    acks = []
    for w in data.get('windows', []):
        stats['metric_windows'] += 1
        acks.append({'session_id': w['session_id'], 'participant_id': w['participant_id'], 'stream_id': w['stream_id'], 'sequence': w['sequence'],
                     'status': 'accepted', 'durable': True, 'feature_hash': w['feature_hash'], 'received_at_server_ms': 1})
    return {'protocol_version': 2, 'schema_version': 1, 'acks': acks}

@sio.on('live:command', namespace=NS)
async def command(sid, data):
    cid = data['command_id']
    stats['commands'][cid] = stats['commands'].get(cid, 0) + 1
    if data.get('kind') == 'test.drop_first' and stats['commands'][cid] == 1:
        return None   # ACK 유실 모사(응답 없음 → 클라이언트 timeout)
    return {'command_id': cid, 'status': 'applied' if stats['commands'][cid] == 1 else 'duplicate', 'epoch': '1', 'cursors': [], 'committed': True}

@sio.on('live:reauth', namespace=NS)
async def reauth(sid, data):
    stats['reauth'] += 1
    return {'ok': data.get('token', '').startswith('good')}

@sio.on('test:push', namespace=NS)
async def push(sid, data):
    await sio.emit(data['event'], data.get('payload', {}), to=sid, namespace=NS)
    return {'ok': True}

@sio.on('test:stats', namespace=NS)
async def get_stats(sid, data):
    return json.loads(json.dumps(stats))

async def hb():
    while True:
        await asyncio.sleep(5)
        for sid in list(sessions):
            await sio.emit('live:heartbeat', {'epoch': '1', 'through': [], 'auth_revision': '1', 'server_time_ms': 1}, to=sid, namespace=NS)

async def on_start(app): asyncio.get_event_loop().create_task(hb())
app.on_startup.append(on_start)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    web.run_app(app, host='127.0.0.1', port=port, print=lambda *_: None) if port else None
