// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSessionLiveSocket } from '../src/hooks/useSessionLiveSocket';

const { socket, listeners } = vi.hoisted(() => {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  const socket = {
    connected: true,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (payload?: unknown) => void) => listeners.get(event)?.delete(handler)),
  };
  return { socket, listeners };
});
vi.mock('../src/lib/socket', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/socket')>(),
  getSessionLiveSocket: () => socket,
}));
let root: Root;
let container: HTMLDivElement;
let live: ReturnType<typeof useSessionLiveSocket>;
function Probe({ participantId = 'p1' }: { participantId?: string | null }) {
  // 테스트 프로브 컴포넌트: 훅 반환값을 외부 변수에 캡처한다(렌더 사이드이펙트 의도).
  // eslint-disable-next-line react-hooks/globals
  live = useSessionLiveSocket({ sessionId: 's1', participantId, skipAuth: true });
  return null;
}
async function receive(event: string, payload?: unknown) {
  await act(async () => { listeners.get(event)?.forEach((handler) => handler(payload)); });
}
const signalPayload = (signal_type: string, participant_id: string) => ({
  session_id: 's1',
  participant_id,
  signal_type,
});
/** class:signal emit 만 추린다(join/leave 등과 구분) */
const signalCalls = () => socket.emit.mock.calls.filter((c: unknown[]) => c[0] === 'class:signal');
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  listeners.clear(); socket.connected = true; socket.emit.mockClear();
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); });

it('transport 연결만으로는 전송하지 않고 버퍼링한다(join 확정 전)', async () => {
  await act(async () => root.render(createElement(Probe)));
  expect(live.sendSignal('following')).toBe('queued');
  expect(signalCalls()).toHaveLength(0);
});

it('join 확정 시 버퍼된 신호를 확정된 본인 id로 flush 한다', async () => {
  await act(async () => root.render(createElement(Probe)));
  live.sendSignal('following');
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });
  expect(signalCalls()).toHaveLength(1);
  expect(socket.emit).toHaveBeenCalledWith('class:signal', signalPayload('following', 'p1'));
  // 이후에는 즉시 전송된다
  expect(live.sendSignal('resting')).toBe('sent');
});

it('연결 + 확정 후에는 즉시 전송한다(sent)', async () => {
  await act(async () => root.render(createElement(Probe)));
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });
  expect(live.sendSignal('resting')).toBe('sent');
  expect(socket.emit).toHaveBeenCalledWith('class:signal', signalPayload('resting', 'p1'));
});

it('서버가 확정한 본인 id로 전송한다(요청 id와 다를 수 있음)', async () => {
  await act(async () => root.render(createElement(Probe, { participantId: null })));
  await receive('joined', { session_id: 's1', participant_id: 'resolved-member', version: 1 });
  expect(live.sendSignal('resting')).toBe('sent');
  expect(socket.emit).toHaveBeenCalledWith('class:signal', signalPayload('resting', 'resolved-member'));
});

it('단절 중 신호를 버퍼링했다가 재join 확정 시 일괄 flush 한다', async () => {
  await act(async () => root.render(createElement(Probe)));
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });

  socket.connected = false; await receive('disconnect');
  expect(live.sendSignal('difficult')).toBe('queued');
  expect(live.sendSignal('following')).toBe('queued'); // 다른 유형도 버퍼링

  socket.connected = true; await receive('connect');
  expect(live.sendSignal('resting')).toBe('queued'); // 재join 전 → 여전히 버퍼링

  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });
  // 단절 중 눌린 유형들이 모두 flush 됐다
  const calls = signalCalls();
  expect(calls).toHaveLength(3);
  expect(calls[0]).toEqual(['class:signal', signalPayload('difficult', 'p1')]);
  expect(calls[1]).toEqual(['class:signal', signalPayload('following', 'p1')]);
  expect(calls[2]).toEqual(['class:signal', signalPayload('resting', 'p1')]);
  // 이후 즉시 전송
  expect(live.sendSignal('following')).toBe('sent');
});

it('단절 중 같은 유형은 최신 1건으로 압축한다(중복 flush 방지)', async () => {
  await act(async () => root.render(createElement(Probe)));
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });

  socket.connected = false; await receive('disconnect');
  expect(live.sendSignal('difficult')).toBe('queued');
  expect(live.sendSignal('difficult')).toBe('queued');
  expect(live.sendSignal('difficult')).toBe('queued'); // 3회 연타

  socket.connected = true; await receive('connect');
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });

  const calls = signalCalls();
  expect(calls).toHaveLength(1); // 유형별 최신 1건
  expect(calls[0]).toEqual(['class:signal', signalPayload('difficult', 'p1')]);
});

it('참가자 미확정이면 버퍼링하되 flush 하지 않는다', async () => {
  await act(async () => root.render(createElement(Probe, { participantId: null })));
  await receive('joined', { session_id: 's1', version: 1 }); // participant_id 없음
  expect(live.sendSignal('resting')).toBe('queued');
  expect(signalCalls()).toHaveLength(0);
});

it('join 거부 상태에서는 전송하지 않는다(failed), 재join 시 복구', async () => {
  await act(async () => root.render(createElement(Probe)));
  await receive('join_denied', { session_id: 's1' });
  expect(live.sendSignal('resting')).toBe('failed');
  expect(live.isReady).toBe(false);
  // 재join 확정 시 정상 복구
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });
  expect(live.sendSignal('resting')).toBe('sent');
});
