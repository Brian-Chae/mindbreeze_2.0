// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), me: vi.fn(), login: vi.fn() }));
vi.mock('../src/lib/api/client', async (original) => ({ ...(await original<object>()), refreshAccessTokenResult: mocks.refresh }));
vi.mock('../src/lib/api/auth', async (original) => ({ ...(await original<object>()), getUserMe: mocks.me, login: mocks.login }));
import { useAuthStore } from '../src/stores/authStore';
import type { User } from '../src/lib/api/auth';
const oldUser = { id: 'old', role: 'client', name: '기존', onboarding_completed: true } as User;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { vi.clearAllMocks(); localStorage.setItem('mb_user', JSON.stringify(oldUser)); mocks.refresh.mockResolvedValue({ ok: true, token: 'fixture' }); useAuthStore.setState({ user: null, isInitialized: false }); });
test('캐시 완료 상태 대신 최신 본인 필수 누락 상태를 사용한다', async () => {
  mocks.me.mockResolvedValue({ ...oldUser, client_required_fields: ['gender'] }); useAuthStore.getState().initialize(); await flush();
  expect(useAuthStore.getState().user?.client_required_fields).toEqual(['gender']); expect(useAuthStore.getState().isInitialized).toBe(true);
});
test('본인 GET 장애는 캐시를 보존하고 로그아웃하지 않는다', async () => {
  mocks.me.mockRejectedValue(new Error('offline')); useAuthStore.getState().initialize(); await flush();
  expect(useAuthStore.getState().user?.id).toBe('old'); expect(useAuthStore.getState().isAuthenticated).toBe(true); expect(useAuthStore.getState().sessionError).not.toBeNull();
});
test('늦게 도착한 GET은 새 로그인 사용자를 덮어쓰지 않는다', async () => {
  let resolve!: (user: User) => void; mocks.me.mockReturnValue(new Promise<User>((done) => { resolve = done; }));
  useAuthStore.getState().initialize(); await flush();
  mocks.login.mockResolvedValue({ access_token: 'new-fixture', user: { ...oldUser, id: 'new' } }); await useAuthStore.getState().login('fixture@example.test', 'test');
  resolve(oldUser); await flush(); expect(useAuthStore.getState().user?.id).toBe('new'); expect(useAuthStore.getState().isInitialized).toBe(true);
});
