// 설치된 Socket.IO 상태 전이로 소켓 수명 계약을 독립 검증한다.
// Manager.open을 대체하므로 네트워크·서버·인증 정보에 접근하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'frontend/node_modules/typescript'));
const { Manager } = require(path.join(root, 'frontend/node_modules/socket.io-client'));

(async () => {
  let creates = 0, opens = 0, refreshCalls = 0;
  const source = fs.readFileSync(path.join(root, 'frontend/src/lib/socket.ts'), 'utf8');
  const accessor = source.slice(source.indexOf('export const getSessionLiveSocket ='), source.indexOf('export const disconnectSessionLiveSocket'));
  const context = {
    SOCKET_URL: 'http://127.0.0.1:9',
    console: { warn() {}, error() {} },
    refreshAccessToken: async () => { refreshCalls++; return null; },
    io: (_url, options) => {
      creates++;
      const manager = new Manager('http://127.0.0.1:9', { autoConnect: false, reconnection: false });
      manager.open = () => { opens++; return manager; };
      const socket = manager.socket('/session-live', { auth: options.auth });
      socket.connect();
      return socket;
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpile(`
    let sessionLiveSocket = null;
    let sessionLiveToken;
    let sessionLiveTokenRefreshAttempted = false;
    let liveSnapshotCache = null;
    let liveCurrentSession = null;
    let liveCurrentParticipant = null;
    ${accessor.replace('export const', 'const')}
    globalThis.get = getSessionLiveSocket;
  `), context);
  const first = context.get('fake-token');
  const second = context.get('fake-token');
  let delivered = 0;
  first.on('eeg_feature', () => delivered++);
  first.onconnect('sid');
  first.onclose('transport close');
  const third = context.get('fake-token');
  third.emitEvent(['eeg_feature', {}]);
  const maintained = { sameDuringConnecting: first === second, sameDuringReconnect: first === third, creates, subscribersDelivered: delivered };
  first.onconnect('sid2');
  first.ondisconnect();
  let before = opens;
  const recovered = context.get('fake-token');
  const recovery = { same: recovered === first, active: recovered.active, connectCalls: opens - before };
  first.emitEvent(['connect_error', new Error('token_expired')]);
  await Promise.resolve();
  await Promise.resolve();
  before = opens;
  context.get('fake-token');
  context.get('fake-token');
  const guarded = { active: first.active, connectCalls: opens - before, refreshCalls };
  before = opens;
  const changed = context.get('new-fake-token');
  const tokenRecovery = { same: changed === first, active: changed.active, connectCalls: opens - before, authUpdated: changed.auth.token === 'new-fake-token' };
  const result = { maintained, recovery, guarded, tokenRecovery };
  first.disconnect();
  assert.deepStrictEqual(result, {
    maintained: { sameDuringConnecting: true, sameDuringReconnect: true, creates: 1, subscribersDelivered: 1 },
    recovery: { same: true, active: true, connectCalls: 1 },
    guarded: { active: false, connectCalls: 0, refreshCalls: 1 },
    tokenRecovery: { same: true, active: true, connectCalls: 1, authUpdated: true },
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
