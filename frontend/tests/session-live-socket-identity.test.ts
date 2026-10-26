// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';

// 네트워크만 대체하고 실제 소켓 accessor·구독 코드를 실행한다.
const network = vi.hoisted(() => ({ sockets: [] as TestSocket[], refresh: vi.fn<() => Promise<string | null>>() }));
vi.mock('../src/lib/api/client', () => ({ refreshAccessToken: network.refresh }));
type Handler = (...args: unknown[]) => void;
interface TestSocket {
  active: boolean;
  connected: boolean;
  disconnected: boolean;
  auth: unknown;
  on: (event: string, handler: Handler) => TestSocket;
  off: (event: string, handler: Handler) => TestSocket;
  disconnect: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  receive: (event: string, ...args: unknown[]) => void;
}
vi.mock('socket.io-client', () => ({
  io: (_url: string, options: { auth: unknown }) => {
    const handlers = new Map<string, Set<Handler>>();
    const socket: TestSocket = {
      active: true, connected: false, disconnected: true, auth: options.auth,
      on(event, handler) { const set = handlers.get(event) ?? new Set(); set.add(handler); handlers.set(event, set); return socket; },
      off(event, handler) { handlers.get(event)?.delete(handler); return socket; },
      disconnect: vi.fn(() => { socket.connected = false; socket.disconnected = true; return socket; }),
      connect: vi.fn(() => socket),
      receive(event, ...args) { handlers.get(event)?.forEach(fn => fn(...args)); },
    };
    network.sockets.push(socket);
    return socket;
  },
}));
import { disconnectSessionLiveSocket, getSessionLiveSocket, subscribeSessionLiveEegFeature } from '../src/lib/socket';
afterEach(() => { disconnectSessionLiveSocket(); network.sockets.length = 0; });

it.each(['최초 연결', '자동 재연결'])('%s 중 다른 소비자가 조회해도 EEG 구독자를 보존한다', stage => {
  const first = getSessionLiveSocket('test-token');
  const received = vi.fn();
  subscribeSessionLiveEegFeature(first, received);
  if (stage === '자동 재연결') {
    network.sockets[0].connected = true;
    network.sockets[0].disconnected = false;
    network.sockets[0].receive('connect');
    network.sockets[0].connected = false;
    network.sockets[0].disconnected = true;
    network.sockets[0].receive('disconnect', 'transport close');
  }
  const second = getSessionLiveSocket('test-token');
  const transport = network.sockets.at(-1)!;
  transport.receive('eeg_feature', { session_id: 's1', participant_id: 'p1', relaxation_index: 0.5 });
  expect(received).toHaveBeenCalledOnce();
  expect(second).toBe(first);
  expect(network.sockets).toHaveLength(1);
  expect(transport.disconnect).not.toHaveBeenCalled();
});
it('토큰 갱신 중에도 구독 객체를 보존하고 다음 인증 정보를 갱신한다', () => {
  const first = getSessionLiveSocket('old');
  expect(getSessionLiveSocket('new')).toBe(first);
  expect(first.auth).toEqual({ token: 'new' });
});
it('명시적 최종 해제 뒤에는 새로운 소켓을 만든다', () => {
  const first: Socket = getSessionLiveSocket();
  disconnectSessionLiveSocket();
  expect(getSessionLiveSocket()).not.toBe(first);
});

it('서버가 닫은 inactive 소켓도 같은 객체로 연결을 재개한다', () => {
  const first = getSessionLiveSocket('token');
  network.sockets[0].active = false;
  expect(getSessionLiveSocket('token')).toBe(first);
  expect(network.sockets[0].connect).toHaveBeenCalledOnce();
});

it('토큰 갱신 실패 후 같은 인증으로 반복 연결하지 않고 새 토큰이면 재개한다', async () => {
  network.refresh.mockResolvedValueOnce(null);
  getSessionLiveSocket('expired');
  const socket = network.sockets[0];
  socket.active = false;
  socket.receive('connect_error', new Error('token_expired'));
  await Promise.resolve();
  socket.connect.mockClear();
  getSessionLiveSocket('expired');
  getSessionLiveSocket('expired');
  expect(socket.connect).not.toHaveBeenCalled();
  getSessionLiveSocket('renewed');
  expect(socket.connect).toHaveBeenCalledOnce();
  expect(socket.auth).toEqual({ token: 'renewed' });
});
