// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const socket = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return { connected: false, on: (name: string, fn: (...args: unknown[]) => void) => {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name)!.add(fn);
  }, off: (name: string, fn: (...args: unknown[]) => void) => handlers.get(name)?.delete(fn),
  fire: (name: string, data?: unknown) => handlers.get(name)?.forEach(fn => fn(data)), handlers };
});
vi.mock('../src/lib/socket', () => ({ getChatSocket: () => socket }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (state: { accessToken: string }) => unknown) => selector({ accessToken: 'test-only' }) }));
import { useNotificationSocket } from '../src/hooks/useNotificationSocket';
import { useNotificationStore } from '../src/stores/notificationStore';
import { apiClient, tokenStorage } from '../src/lib/api/client';
let unread = 1;
let countRequests = 0;
const container = document.createElement('div');
const root = createRoot(container);
function Badge() {
  useNotificationSocket();
  const count = useNotificationStore(state => state.unread);
  // 실제 store 구독과 DOM 배지까지 검증한다.
  return <span>{count}</span>;
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  unread = 1; countRequests = 0;
  tokenStorage.clear(); localStorage.clear(); useNotificationStore.getState().reset();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const path = String(input);
    if (path.endsWith('/unread-count')) countRequests++;
    return new Response(JSON.stringify(path.endsWith('/unread-count') ? { unread } : { notifications: [], rooms: [], total: 0 }), { headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(async () => { await act(async () => root.render(null)); vi.unstubAllGlobals(); });
it('알림 수신 시 30초 캐시를 기다리지 않고 실제 배지가 바뀐다', async () => {
  await act(async () => root.render(<Badge />)); await settle();
  expect(container.textContent).toBe('1');
  unread = 7;
  await act(async () => socket.fire('new_notification', {})); await settle();
  expect(container.textContent).toBe('7');
  expect(countRequests).toBe(2);
});
it('최초 연결과 재연결은 연결 전에 완료된 배지 조회를 재검증한다', async () => {
  await act(async () => root.render(<Badge />)); await settle();
  unread = 2;
  await act(async () => socket.fire('connect')); await settle();
  expect(container.textContent).toBe('2');
  unread = 3;
  await act(async () => socket.fire('connect')); await settle();
  expect(container.textContent).toBe('3');
});
it('채팅 이벤트는 방 캐시만 비우고 알림·강사 후보 캐시는 유지한다', async () => {
  await act(async () => root.render(<Badge />)); await settle();
  await apiClient.get('/chat/rooms');
  await apiClient.get('/classes/instructor-candidates');
  const before = vi.mocked(fetch).mock.calls.length;
  socket.fire('new_message', {});
  await apiClient.get('/classes/instructor-candidates');
  await apiClient.get('/notifications/unread-count');
  expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  await apiClient.get('/chat/rooms');
  expect(vi.mocked(fetch).mock.calls.length).toBe(before + 1);
});
