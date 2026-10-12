// @vitest-environment jsdom
// 개선 3: 대기실 인원 연동 — 참가자 측 입장 알림(join/leave + heartbeat)과
//         상담사 측 인원 카운트(waiting_room_changed, TTL 정리)를 검증한다.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  useWaitingRoomPresence,
  WAITING_ROOM_HEARTBEAT_MS,
} from '../src/hooks/useWaitingRoomPresence';
import type { WaitingRoomChangedEvent } from '../src/lib/socket';
import { useWaitingRoomCount } from '../src/hooks/useWaitingRoomCount';

type ChangedHandler = (event: WaitingRoomChangedEvent) => void;

const socketLib = vi.hoisted(() => {
  const state = { handlers: [] as ChangedHandler[] };
  const fakeSocket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    once: vi.fn(),
  };
  return {
    state,
    fakeSocket,
    getSessionLiveSocket: vi.fn(() => fakeSocket),
    getActiveSessionLiveSocket: vi.fn(() => fakeSocket as unknown),
    joinSessionLive: vi.fn(),
    emitWaitingRoomPresence: vi.fn(() => true),
    subscribeWaitingRoomChanged: vi.fn((_socket: unknown, handler: ChangedHandler) => {
      state.handlers.push(handler);
      return () => {
        const index = state.handlers.indexOf(handler);
        if (index >= 0) state.handlers.splice(index, 1);
      };
    }),
  };
});

vi.mock('../src/lib/socket', () => ({
  getSessionLiveSocket: socketLib.getSessionLiveSocket,
  getActiveSessionLiveSocket: socketLib.getActiveSessionLiveSocket,
  joinSessionLive: socketLib.joinSessionLive,
  emitWaitingRoomPresence: socketLib.emitWaitingRoomPresence,
  subscribeWaitingRoomChanged: socketLib.subscribeWaitingRoomChanged,
}));

let root: Root;
let container: HTMLDivElement;

function PresenceHarness({ nickname }: { nickname: string | null }): ReactNode {
  useWaitingRoomPresence({
    sessionId: 'session-1',
    participantId: 'participant-1',
    nickname,
    enabled: true,
  });
  return createElement('div', null, 'presence');
}

function CountHarness({ enabled = true }: { enabled?: boolean }): ReactNode {
  const { count, nicknames } = useWaitingRoomCount({ sessionId: 'session-1', enabled });
  return createElement('div', null, `count:${count}|${nicknames.join(',')}`);
}

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

async function unmount(): Promise<void> {
  await act(async () => root.unmount());
}

function deliver(event: Parameters<ChangedHandler>[0]): void {
  for (const handler of [...socketLib.state.handlers]) handler(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  socketLib.state.handlers = [];
  socketLib.fakeSocket.connected = true;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  container.remove();
  vi.useRealTimers();
});

// ── 참가자: 대기실 입장 알림 ────────────────────────────────────────

it('대기실에 들어가면 join 을 알리고, 나갈 때 leave 를 알린다', async () => {
  await render(createElement(PresenceHarness, { nickname: '민지' }));
  expect(socketLib.joinSessionLive).toHaveBeenCalledWith(socketLib.fakeSocket, 'session-1', 'participant-1');
  expect(socketLib.emitWaitingRoomPresence).toHaveBeenCalledTimes(1);
  expect(socketLib.emitWaitingRoomPresence).toHaveBeenCalledWith(
    socketLib.fakeSocket,
    expect.objectContaining({ session_id: 'session-1', action: 'join', nickname: '민지' }),
  );

  await unmount();
  const last = socketLib.emitWaitingRoomPresence.mock.calls.at(-1);
  expect(last?.[1]).toMatchObject({ session_id: 'session-1', action: 'leave' });
});

it('상담사가 늦게 접속해도 셈해지도록 heartbeat 로 join 을 반복한다', async () => {
  vi.useFakeTimers();
  await render(createElement(PresenceHarness, { nickname: null }));

  const joinCalls = (): number =>
    socketLib.emitWaitingRoomPresence.mock.calls.filter(
      (call) => (call[1] as { action?: string }).action === 'join',
    ).length;

  expect(joinCalls()).toBe(1);
  await act(async () => {
    vi.advanceTimersByTime(WAITING_ROOM_HEARTBEAT_MS * 2);
  });
  expect(joinCalls()).toBe(3);
  await unmount();
});

// ── 상담사: 대기실 인원 카운트 ───────────────────────────────────────

it('waiting_room_changed 로 대기 인원과 닉네임을 갱신한다', async () => {
  await render(createElement(CountHarness, {}));
  expect(container.textContent).toBe('count:0|');

  await act(async () => {
    deliver({ session_id: 'session-1', participant_id: 'p1', action: 'join', nickname: '민지' });
  });
  expect(container.textContent).toBe('count:1|민지');

  await act(async () => {
    deliver({ session_id: 'session-1', participant_id: 'p2', action: 'join', nickname: '지우' });
  });
  expect(container.textContent).toBe('count:2|민지,지우');

  // 같은 참여자의 join 은 중복 집계하지 않는다
  await act(async () => {
    deliver({ session_id: 'session-1', participant_id: 'p1', action: 'join', nickname: '민지' });
  });
  expect(container.textContent).toBe('count:2|민지,지우');

  await act(async () => {
    deliver({ session_id: 'session-1', participant_id: 'p1', action: 'leave' });
  });
  expect(container.textContent).toBe('count:1|지우');
});

it('다른 세션의 이벤트는 세지 않는다', async () => {
  await render(createElement(CountHarness, {}));
  await act(async () => {
    deliver({ session_id: 'other-session', participant_id: 'p1', action: 'join' });
  });
  expect(container.textContent).toBe('count:0|');
});

it('닉네임이 없으면 participant_id 로 표시한다', async () => {
  await render(createElement(CountHarness, {}));
  await act(async () => {
    deliver({ session_id: 'session-1', participant_id: 'p9', action: 'join' });
  });
  expect(container.textContent).toBe('count:1|p9');
});

it('대기실 씬이 아니면(enabled=false) 구독하지 않고 0 을 반환한다', async () => {
  await render(createElement(CountHarness, { enabled: false }));
  expect(socketLib.subscribeWaitingRoomChanged).not.toHaveBeenCalled();
  await act(async () => {
    deliver({ session_id: 'session-1', participant_id: 'p1', action: 'join' });
  });
  expect(container.textContent).toBe('count:0|');
});

it('준비 상태 변경을 leave 없이 즉시 보내고 heartbeat에 유지한다', async () => {
  vi.useFakeTimers();
  function ReadyHarness({ done }: { done: boolean }) {
    useWaitingRoomPresence({ sessionId: 'session-1', participantId: 'p1', enabled: true,
      readiness: { surveyDone: done, bandDone: done, deviceDone: done } });
    return null;
  }
  await render(createElement(ReadyHarness, { done: false }));
  await render(createElement(ReadyHarness, { done: true }));
  expect(socketLib.emitWaitingRoomPresence).toHaveBeenLastCalledWith(socketLib.fakeSocket,
    expect.objectContaining({ readiness: { surveyDone: true, bandDone: true, deviceDone: true } }));
  await act(async () => vi.advanceTimersByTime(WAITING_ROOM_HEARTBEAT_MS));
  expect(socketLib.emitWaitingRoomPresence).toHaveBeenLastCalledWith(socketLib.fakeSocket,
    expect.objectContaining({ readiness: { surveyDone: true, bandDone: true, deviceDone: true } }));
  expect(socketLib.emitWaitingRoomPresence.mock.calls.some(call => (call[1] as { action: string }).action === 'leave')).toBe(false);
  await unmount();
});


it('준비 상태 수신·구버전 payload·45초 TTL을 유지한다', async () => {
  vi.useFakeTimers();
  function EntriesHarness() {
    const { entries } = useWaitingRoomCount({ sessionId: 'session-1', enabled: true });
    return createElement('div', null, JSON.stringify(entries));
  }
  await render(createElement(EntriesHarness));
  await act(async () => deliver({ session_id: 'session-1', participant_id: 'p1', action: 'join',
    readiness: { surveyDone: true, bandDone: true, deviceDone: true } }));
  expect(container.textContent).toContain('"deviceDone":true');
  await act(async () => deliver({ session_id: 'session-1', participant_id: 'p2', action: 'join' }));
  expect(JSON.parse(container.textContent ?? '[]')).toHaveLength(2);
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(container.textContent).toBe('[]');
  await unmount();
});
