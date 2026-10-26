// @vitest-environment jsdom
// 서버 재시작·토큰 만료 후 재연결 — 최신 토큰 재인증 · 자동 재join · joined 재시도 · REST 폴백 판정
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const net = vi.hoisted(() => ({
  sockets: [] as TestSocket[],
  access: { value: 'tok-old' as string | null },
  refresh: vi.fn<() => Promise<string | null>>(),
}));
vi.mock('../src/lib/api/client', () => ({
  refreshAccessToken: net.refresh,
  tokenStorage: { getAccess: () => net.access.value },
}));
type Handler = (...args: unknown[]) => void;
interface TestSocket {
  active: boolean; connected: boolean; disconnected: boolean; auth: unknown;
  io: { on: (e: string, h: Handler) => void; fire: (e: string) => void };
  on: (e: string, h: Handler) => TestSocket; off: (e: string, h: Handler) => TestSocket;
  emit: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
  receive: (e: string, ...a: unknown[]) => void;
}
vi.mock('socket.io-client', () => ({
  io: (_u: string, o: { auth: unknown }) => {
    const h = new Map<string, Set<Handler>>();
    const mh = new Map<string, Set<Handler>>();
    const s: TestSocket = {
      active: true, connected: false, disconnected: true, auth: o.auth,
      io: {
        on: (e, fn) => { const set = mh.get(e) ?? new Set(); set.add(fn); mh.set(e, set); },
        fire: (e) => mh.get(e)?.forEach((fn) => fn()),
      },
      on(e, fn) { const set = h.get(e) ?? new Set(); set.add(fn); h.set(e, set); return s; },
      off(e, fn) { h.get(e)?.delete(fn); return s; },
      emit: vi.fn(),
      connect: vi.fn(() => { s.active = true; return s; }),
      disconnect: vi.fn(() => { s.connected = false; s.disconnected = true; return s; }),
      receive(e, ...a) { h.get(e)?.forEach((fn) => fn(...a)); },
    };
    net.sockets.push(s);
    return s;
  },
}));
import {
  LIVE_JOIN_RETRY_MS, disconnectSessionLiveSocket, getSessionLiveSocket, isSessionLiveJoined, joinSessionLive,
} from '../src/lib/socket';

const up = (s: TestSocket): void => { s.connected = true; s.disconnected = false; s.receive('connect'); };
const down = (s: TestSocket, reason = 'transport close'): void => { s.connected = false; s.disconnected = true; s.receive('disconnect', reason); };

beforeEach(() => { vi.useFakeTimers(); net.access.value = 'tok-old'; });
afterEach(() => { disconnectSessionLiveSocket(); net.sockets.length = 0; vi.useRealTimers(); });

it('재연결 시도 때 최신 토큰으로 재인증한다', () => {
  const s = getSessionLiveSocket('tok-old') as unknown as TestSocket;
  net.access.value = 'tok-new';
  s.io.fire('reconnect_attempt');
  expect(s.auth).toEqual({ token: 'tok-new' });
});

it('끊김 후 재연결되면 훅 없이도 마지막 세션 room 에 자동 재join 한다', () => {
  const s = getSessionLiveSocket('tok') as unknown as TestSocket;
  up(s);
  joinSessionLive(s as never, 'S1', 'P1');
  expect(s.emit).toHaveBeenCalledWith('join', { session_id: 'S1', participant_id: 'P1' });
  s.receive('joined', { session_id: 'S1' });
  expect(isSessionLiveJoined('S1')).toBe(true);

  down(s);
  expect(isSessionLiveJoined('S1')).toBe(false);
  s.emit.mockClear();
  up(s); // 서버 재시작 후 재접속
  expect(s.emit).toHaveBeenCalledWith('join', { session_id: 'S1', participant_id: 'P1' });
  expect(isSessionLiveJoined('S1')).toBe(false);
  s.receive('joined', { session_id: 'S1' });
  expect(isSessionLiveJoined('S1')).toBe(true);
});

it('joined 가 오지 않으면 연결 상태에서 join 을 재전송하고, 받으면 멈춘다', () => {
  const s = getSessionLiveSocket('tok') as unknown as TestSocket;
  up(s);
  joinSessionLive(s as never, 'S1', 'P1');
  s.emit.mockClear();
  vi.advanceTimersByTime(LIVE_JOIN_RETRY_MS + 10);
  expect(s.emit).toHaveBeenCalledTimes(1);
  s.receive('joined', { session_id: 'S1' });
  vi.advanceTimersByTime(LIVE_JOIN_RETRY_MS * 3);
  expect(s.emit).toHaveBeenCalledTimes(1);
});

it('미연결 상태의 join 은 emit 하지 않고 연결 시 1회만 보낸다(중복 없음)', () => {
  const s = getSessionLiveSocket('tok') as unknown as TestSocket;
  joinSessionLive(s as never, 'S1', 'P1');
  expect(s.emit).not.toHaveBeenCalled();
  up(s);
  expect(s.emit.mock.calls.filter((c) => c[0] === 'join')).toHaveLength(1);
});

it('leave 이후에는 재연결해도 재join 하지 않는다', async () => {
  const { leaveSessionLive } = await import('../src/lib/socket');
  const s = getSessionLiveSocket('tok') as unknown as TestSocket;
  up(s);
  joinSessionLive(s as never, 'S1', 'P1');
  leaveSessionLive(s as never, 'S1');
  down(s);
  s.emit.mockClear();
  up(s);
  expect(s.emit).not.toHaveBeenCalled();
});

it('access_revoked/join_denied 이후에는 재연결해도 재join 하지 않는다', () => {
  const s = getSessionLiveSocket('tok') as unknown as TestSocket;
  up(s);
  joinSessionLive(s as never, 'S1', 'P1');
  s.receive('access_revoked', { session_id: 'S1' });
  down(s);
  s.emit.mockClear();
  up(s);
  vi.advanceTimersByTime(LIVE_JOIN_RETRY_MS * 3);
  expect(s.emit).not.toHaveBeenCalled();
});
