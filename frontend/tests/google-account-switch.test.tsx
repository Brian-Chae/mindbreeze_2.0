// 구글 계정 전환(상담사 A 로그아웃 → 회원 탭 B) — 이전 계정이 조용히 재사용되지 않아야 한다.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

const social = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  login: vi.fn().mockResolvedValue({ result: { idToken: 'tok' } }),
  logout: vi.fn().mockResolvedValue(undefined),
}));
const gis = vi.hoisted(() => ({ googleLogout: vi.fn(), useGoogleLogin: vi.fn(() => () => {}) }));
const platform = vi.hoisted(() => ({ native: true }));

vi.mock('@capgo/capacitor-social-login', () => ({ SocialLogin: social }));
vi.mock('@react-oauth/google', () => gis);
vi.mock('../src/lib/native/platform', () => ({
  isNativeApp: () => platform.native,
  getPlatform: () => (platform.native ? 'ios' : 'web'),
}));

beforeEach(() => {
  vi.clearAllMocks();
  platform.native = true;
});

test('V1 네이티브 Google 로그인은 항상 계정 선택창을 강제한다(forcePrompt)', async () => {
  const { nativeGoogleIdToken } = await import('../src/lib/native/google');
  await nativeGoogleIdToken();
  expect(social.login).toHaveBeenCalledWith({ provider: 'google', options: { forcePrompt: true } });
});

test('V2 네이티브 로그아웃은 Google·Apple 소셜 세션을 모두 정리하고, 실패해도 던지지 않는다', async () => {
  social.logout.mockRejectedValueOnce(new Error('not logged in'));
  const { clearSocialSessions } = await import('../src/lib/native/social-session');
  await expect(clearSocialSessions()).resolves.toBeUndefined();
  expect(social.logout).toHaveBeenCalledWith({ provider: 'google' });
  expect(social.logout).toHaveBeenCalledWith({ provider: 'apple' });
  expect(gis.googleLogout).toHaveBeenCalled();
});

test('V3a 웹 로그아웃은 GIS 자동 선택을 해제한다', async () => {
  platform.native = false;
  const { clearSocialSessions } = await import('../src/lib/native/social-session');
  await clearSocialSessions();
  expect(gis.googleLogout).toHaveBeenCalled();
  expect(social.logout).not.toHaveBeenCalled();
});

test('V3b 웹 Google 로그인은 prompt=select_account 로 계정 선택창을 띄운다', async () => {
  const { default: LoginPage } = await import('../src/pages/LoginPage');
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/login?role=client'] }, createElement(LoginPage)));
  const config = (gis.useGoogleLogin.mock.calls[0] as unknown as [{ prompt?: string }])[0];
  expect(config.prompt).toBe('select_account');
});

test('V2b authStore.logout 은 소셜 세션 정리를 호출한다', async () => {
  vi.doMock('../src/lib/api/auth', async (orig) => ({ ...(await orig<object>()), logout: vi.fn().mockResolvedValue(undefined) }));
  const clear = vi.fn().mockResolvedValue(undefined);
  vi.doMock('../src/lib/native/social-session', () => ({ clearSocialSessions: clear }));
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  vi.stubGlobal('sessionStorage', globalThis.localStorage);
  vi.resetModules();
  const { useAuthStore } = await import('../src/stores/authStore');
  await useAuthStore.getState().logout();
  expect(clear).toHaveBeenCalledTimes(1);
});
