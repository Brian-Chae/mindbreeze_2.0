// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  native: true,
  auth: { isAuthenticated: false, user: null as { id: string } | null },
  stop: vi.fn(async () => {}),
  start: vi.fn(),
  fetch: vi.fn(async () => {}),
}));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => state.native }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (auth: typeof state.auth) => unknown) => selector(state.auth) }));
vi.mock('../src/stores/notificationStore', () => ({ useNotificationStore: { getState: () => ({ fetch: state.fetch }) } }));
vi.mock('../src/lib/native/push', () => ({ startPushRegistration: state.start }));
import { NativeBootstrap } from '../src/lib/native/use-push-registration';
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  state.native = true;
  state.auth = { isAuthenticated: false, user: null };
  state.start.mockReturnValue({ ready: Promise.resolve(), stop: state.stop });
  root = createRoot(document.createElement('div'));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => { await act(async () => root.unmount()); });
it('웹 로그인과 네이티브 비로그인 상태에서 등록하지 않는다', async () => {
  await act(async () => root.render(<NativeBootstrap />));
  expect(state.start).not.toHaveBeenCalled();
  state.native = false;
  state.auth = { isAuthenticated: true, user: { id: 'fixture-user' } };
  await act(async () => root.render(<NativeBootstrap />));
  expect(state.start).not.toHaveBeenCalled();
});
it('로그인 시 마운트하고 알림 갱신·라우팅·로그아웃 정리를 연결한다', async () => {
  state.auth = { isAuthenticated: true, user: { id: 'fixture-user' } };
  await act(async () => root.render(<NativeBootstrap />));
  expect(state.start).toHaveBeenCalledOnce();
  const [navigate, refresh] = state.start.mock.calls[0] as [(path: string) => void, () => void];
  const popstate = vi.fn();
  window.addEventListener('popstate', popstate);
  navigate('/app/ai');
  expect(window.location.pathname).toBe('/app/ai');
  expect(popstate).toHaveBeenCalledOnce();
  refresh();
  expect(state.fetch).toHaveBeenCalledOnce();
  window.removeEventListener('popstate', popstate);
  state.auth = { isAuthenticated: false, user: null };
  await act(async () => root.render(<NativeBootstrap />));
  expect(state.stop).toHaveBeenCalledOnce();
});
