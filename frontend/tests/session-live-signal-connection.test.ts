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
  live = useSessionLiveSocket({ sessionId: 's1', participantId, skipAuth: true });
  return null;
}
async function receive(event: string, payload?: unknown) {
  await act(async () => { listeners.get(event)?.forEach((handler) => handler(payload)); });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  listeners.clear(); socket.connected = true; socket.emit.mockClear();
  container = document.createElement('div'); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); });
it('transport 연결만으로 전송 성공을 표시하지 않고 join 완료 후 전송한다', async () => {
  await act(async () => root.render(createElement(Probe)));
  expect(live.sendSignal('following')).toBe(false);
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });
  expect(live.sendSignal('following')).toBe(true);
  expect(socket.emit).toHaveBeenCalledWith('class:signal', { session_id: 's1', participant_id: 'p1', signal_type: 'following' });
});
it('서버가 join에서 확정한 본인 참가자 id로 전송한다', async () => {
  await act(async () => root.render(createElement(Probe, { participantId: null })));
  await receive('joined', { session_id: 's1', participant_id: 'resolved-member', version: 1 });
  expect(live.sendSignal('resting')).toBe(true);
  expect(socket.emit).toHaveBeenCalledWith('class:signal', { session_id: 's1', participant_id: 'resolved-member', signal_type: 'resting' });
});
it('참가자 미확정 또는 join 거부 상태에서는 전송하지 않는다', async () => {
  await act(async () => root.render(createElement(Probe, { participantId: null })));
  await receive('joined', { session_id: 's1', version: 1 });
  expect(live.sendSignal('resting')).toBe(false);
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });
  await receive('join_denied', { session_id: 's1' });
  expect(live.sendSignal('resting')).toBe(false);
  expect(live.isReady).toBe(false);
});
it('단절 후 재연결해도 새 join 승인 전에는 전송하지 않는다', async () => {
  await act(async () => root.render(createElement(Probe)));
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });
  socket.connected = false; await receive('disconnect');
  expect(live.sendSignal('difficult')).toBe(false);
  socket.connected = true; await receive('connect');
  expect(live.sendSignal('difficult')).toBe(false);
  await receive('joined', { session_id: 's1', participant_id: 'p1', version: 1 });
  expect(live.sendSignal('difficult')).toBe(true);
});
