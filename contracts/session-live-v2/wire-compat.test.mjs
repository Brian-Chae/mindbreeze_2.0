// SDD-246 T01 — wire 버전 행렬이 실제 lockfile/requirements 와 어긋나지 않는지 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const compat = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'wire-compat.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'frontend/package-lock.json'), 'utf8')).packages;
const req = readFileSync(join(ROOT, 'backend/requirements.txt'), 'utf8');

test('web client 버전이 package-lock 과 같다', () => {
  for (const n of ['socket.io-client', 'engine.io-client', 'socket.io-parser']) assert.equal(compat.web_client[n], lock[`node_modules/${n}`].version, n);
});
test('server 버전이 requirements.txt 와 같다', () => {
  assert.match(req, new RegExp(`^python-socketio==${compat.server['python-socketio'].replace(/\./g, '\\.')}$`, 'm'));
});
test('재시도/타임아웃 상수가 plan §3.3 과 같다', () => {
  assert.equal(compat.ack_timeout_ms, 2000);
  assert.deepEqual(compat.retry_backoff_ms, [500, 1000, 2000, 4000]);
  assert.equal(compat.protocol_version, 2);
});

test('native 클라이언트가 고정되어 있고 websocket-only 이다', () => {
  for (const os of ['android', 'ios']) {
    const c = compat.native_clients[os];
    assert.equal(c.transport, 'websocket-only', os);
    assert.match(c.protocol, /Engine\.IO 4 \/ Socket\.IO v4/, os);
    assert.ok(c.library && c.version && c.evidence, os);
  }
  assert.equal(compat.native_clients.android.library, 'io.socket:socket.io-client');
  assert.equal(compat.native_clients.android.version, '2.1.2');
});
