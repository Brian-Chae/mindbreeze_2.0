// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WaitingRoomReadinessPanel } from '../src/components/class/waiting-room-readiness-panel';
const mocks = vi.hoisted(() => ({ request: vi.fn(), socket: { connected: true, on: vi.fn(), off: vi.fn() } }));
vi.mock('../src/lib/socket', () => ({ getActiveSessionLiveSocket: () => mocks.socket, requestWaitingRoomReminder: mocks.request }));
it('구버전 체크인은 설문만 완료로 표시하고 서버 실패를 알린다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const element = document.createElement('div');
  const root = createRoot(element);
  mocks.request.mockRejectedValue(new Error('전송 실패'));
  await act(async () => root.render(createElement(WaitingRoomReadinessPanel, { sessionId: 's1', entries: [
    { participantId: 'p1', nickname: '민지', checkin: { arousal: 3, valence: 3, note: '전달 말' } },
    { participantId: 'p2', nickname: '지우', checkin: null, readiness: { surveyDone: true, bandDone: true, deviceDone: true } },
  ] })));
  expect(element.textContent).toContain('1 / 전체 2명 완료');
  expect(element.textContent).toContain('1/3');
  expect(element.textContent).toContain('전달 말');
  await act(async () => element.querySelector('button')?.click());
  expect(mocks.request).toHaveBeenCalledWith(mocks.socket, 's1', ['p1']);
  expect(element.querySelector('[role="alert"]')?.textContent).toBe('전송 실패');
  await act(async () => root.unmount());
});

it('빈 대기실과 전원 완료에서는 리마인드를 비활성화한다', async () => {
  const element = document.createElement('div'); const root = createRoot(element);
  await act(async () => root.render(createElement(WaitingRoomReadinessPanel, { sessionId: 's1', entries: [] })));
  expect(element.textContent).toContain('0 / 전체 0명 완료');
  expect(element.querySelector('button')?.disabled).toBe(true);
  await act(async () => root.render(createElement(WaitingRoomReadinessPanel, { sessionId: 's1', entries: [
    { participantId: 'p1', nickname: null, checkin: null, readiness: { surveyDone: true, bandDone: true, deviceDone: true } },
  ] })));
  expect(element.querySelector('button')?.disabled).toBe(true);
  expect(element.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  await act(async () => root.unmount());
});

it('중복 클릭은 막고 ack 이후에만 서버 수락을 표시한다', async () => {
  const element = document.createElement('div'); const root = createRoot(element);
  let acknowledge: ((value: { ok: boolean; sent: number }) => void) | undefined;
  mocks.request.mockClear();
  mocks.request.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
  await act(async () => root.render(createElement(WaitingRoomReadinessPanel, { sessionId: 's1', entries: [
    { participantId: 'p1', nickname: '민지', checkin: null },
  ] })));
  await act(async () => { element.querySelector('button')?.click(); element.querySelector('button')?.click(); });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(element.querySelector('button')?.disabled).toBe(true);
  expect(element.querySelector('[role="status"]')).toBeNull();
  await act(async () => acknowledge?.({ ok: true, sent: 1 }));
  expect(element.querySelector('[role="status"]')?.textContent).toContain('서버가 1명');
  await act(async () => root.unmount());
});

it('늦게 연결된 호스트 소켓의 연결상태 prop 변경을 반영한다', async () => {
  const element = document.createElement('div'); const root = createRoot(element);
  const entries = [{ participantId: 'p1', nickname: '민지', checkin: null }];
  await act(async () => root.render(createElement(WaitingRoomReadinessPanel, { sessionId: 's1', entries, isConnected: false })));
  expect(element.querySelector('button')?.disabled).toBe(true);
  await act(async () => root.render(createElement(WaitingRoomReadinessPanel, { sessionId: 's1', entries, isConnected: true })));
  expect(element.querySelector('button')?.disabled).toBe(false);
  await act(async () => root.unmount());
});
