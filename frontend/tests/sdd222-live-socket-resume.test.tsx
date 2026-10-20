// @vitest-environment jsdom
// SDD-222 T-J6 — useSessionLiveSocket 복귀 처리 (V11·V12)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;
const h = vi.hoisted(() => ({
  resume: [] as { cb: () => void | Promise<void>; order?: number }[],
  handlers: new Map<string, Set<Handler>>(),
  joinedHandler: null as null | ((e: unknown) => void),
  join: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  socket: { connected: true } as { connected: boolean } & Record<string, unknown>,
}));

const fire = (name: string, ...args: unknown[]) => h.handlers.get(name)?.forEach((fn) => fn(...args));

vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { socket: 10, rawFlush: 20, ble: 30, screen: 40 },
  subscribeAppResume: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; h.resume.push(e);
    return () => { h.resume.splice(h.resume.indexOf(e), 1); };
  },
  subscribeAppPause: () => () => undefined,
}));
vi.mock('../src/lib/socket', async (original) => {
  const mod = await original<typeof import('../src/lib/socket')>();
  const noop = () => () => undefined;
  return {
    ...mod,
    getSessionLiveSocket: () => h.socket,
    joinSessionLive: (...a: unknown[]) => h.join(...a),
    retainSessionLiveRoom: vi.fn(), releaseSessionLiveRoom: vi.fn(),
    subscribeSessionLiveJoined: (_s: unknown, fn: (e: unknown) => void) => { h.joinedHandler = fn; return () => undefined; },
    subscribeSessionLiveEegFeature: noop, subscribeSessionStateChanged: noop, subscribeParticipantChanged: noop,
    subscribeDeviceStatusChanged: noop, subscribeSpeakingChanged: noop, subscribeClassSignal: noop,
    subscribeClassAggregate: noop, subscribeGroupAverage: noop, subscribeClassAudioSync: noop,
  };
});

import { useSessionLiveSocket } from '../src/hooks/useSessionLiveSocket';

let root: Root;
function Harness() {
  useSessionLiveSocket({ sessionId: 's1', participantId: 'p1', skipAuth: true });
  return null;
}
const joined = () => act(async () => { h.joinedHandler?.({ session_id: 's1', participant_id: 'p1', version: 1, status: 'in_progress', participants: [] }); });
const resume = () => act(async () => { await Promise.all(h.resume.map((e) => e.cb())); await vi.advanceTimersByTimeAsync(0); });
const heartbeats = () => h.emit.mock.calls.filter((c) => c[0] === 'participation_heartbeat').length;

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.resume.length = 0; h.handlers.clear(); h.joinedHandler = null;
  h.join.mockClear(); h.emit.mockClear(); h.connect.mockReset();
  h.socket = {
    connected: true,
    on: (n: string, fn: Handler) => { const set = h.handlers.get(n) ?? new Set(); set.add(fn); h.handlers.set(n, set); },
    off: (n: string, fn: Handler) => { h.handlers.get(n)?.delete(fn); },
    emit: (...a: unknown[]) => h.emit(...a),
    connect: () => {
      h.connect();
      h.socket.connected = true;
      fire('connect');
    },
  };
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe('useSessionLiveSocket 복귀 처리', () => {
  it('소켓 단계(order 10)로 등록된다', async () => {
    await act(async () => root.render(<Harness />));
    expect(h.resume.map((e) => e.order)).toEqual([10]);
  });

  it('V11 이미 connected 이면 connect() 재호출·중복 join 없이 heartbeat 만 즉시 1회 보낸다', async () => {
    await act(async () => root.render(<Harness />));
    await joined();
    expect(h.join).toHaveBeenCalledTimes(1);
    await resume();
    expect(h.connect).not.toHaveBeenCalled();
    expect(h.join).toHaveBeenCalledTimes(1);
    expect(heartbeats()).toBe(1);
  });

  it('V12 단절 후 복귀하면 재연결 → join 1회, joined 확정 직후 heartbeat 즉시 1회', async () => {
    await act(async () => root.render(<Harness />));
    await joined();
    h.socket.connected = false;
    act(() => fire('disconnect', 'transport close'));
    expect(h.join).toHaveBeenCalledTimes(1);
    await resume();
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.join).toHaveBeenCalledTimes(2); // 재연결의 'connect' 이벤트로 재join 1회
    expect(heartbeats()).toBe(0); // joined 확정 전에는 보내지 않는다
    await joined();
    expect(heartbeats()).toBe(1);
    await joined(); // 이후 joined 재수신은 추가 heartbeat 를 만들지 않는다
    expect(heartbeats()).toBe(1);
  });

  it('재연결 핸드셰이크 중 복귀가 반복돼도 join 은 늘지 않는다(connect 는 복귀마다 1회, 중복 처리는 socket.io 가 흡수)', async () => {
    await act(async () => root.render(<Harness />));
    await joined();
    h.socket.connected = false;
    h.socket.connect = () => { h.connect(); }; // 아직 연결 안 됨(핸드셰이크 진행 중)
    act(() => fire('disconnect', 'transport close'));
    await resume();
    await resume();
    expect(h.connect).toHaveBeenCalledTimes(2);
    expect(h.join).toHaveBeenCalledTimes(1);
  });

  it('언마운트하면 복귀 구독이 해제된다', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => root.render(null));
    expect(h.resume).toHaveLength(0);
  });
});
