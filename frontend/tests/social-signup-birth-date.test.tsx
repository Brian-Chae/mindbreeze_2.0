// @vitest-environment jsdom
// 소셜 신규 가입: 422(생년월일 필요) 후 입력란을 채워 재시도하면 birth_date 가 요청 본문에 실려야 한다.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  loginGoogleApi: vi.fn(),
  loginAppleApi: vi.fn(),
  googleSuccess: null as null | ((r: { access_token: string }) => Promise<void>),
}));

vi.mock('../src/lib/native/platform', () => ({
  isNativeApp: () => h.native,
  getPlatform: () => (h.native ? 'ios' : 'web'),
}));
vi.mock('../src/lib/native/google', () => ({ nativeGoogleIdToken: vi.fn().mockResolvedValue('id-token') }));
vi.mock('../src/lib/native/apple', () => ({
  isAppleLoginAvailable: () => true,
  nativeAppleCredential: vi.fn().mockResolvedValue({ idToken: 'apple-id-token-1234', nonce: 'nonce-12345678', authorizationCode: 'code' }),
}));
vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: (cfg: { onSuccess: (r: { access_token: string }) => Promise<void> }) => {
    h.googleSuccess = cfg.onSuccess;
    return () => { void cfg.onSuccess({ access_token: 'web-access' }); };
  },
}));
vi.mock('../src/lib/api/auth', async (orig) => ({
  ...(await orig<object>()),
  loginGoogle: h.loginGoogleApi,
  loginApple: h.loginAppleApi,
  requestAppleChallenge: vi.fn().mockResolvedValue({ nonce: 'nonce-12345678', expires_in: 300 }),
}));

import { ApiError } from '../src/lib/api/client';
import LoginPage from '../src/pages/LoginPage';
import InviteLandingPage from '../src/pages/clients/InviteLandingPage';

const okUser = { id: 'u1', email: 'a@b.c', name: 'A', role: 'client' };
const okRes = { access_token: 't', token_type: 'bearer', user: okUser };
const birthError = () => new ApiError(422, '생년월일을 입력해 주세요', { detail: '생년월일을 입력해 주세요' });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.native = true;
  h.loginGoogleApi.mockReset();
  h.loginAppleApi.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mountLogin() {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/login?role=client'] }, createElement(LoginPage)));
  });
}
const buttonByText = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;
async function click(el: Element) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
}
async function setInput(el: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(el) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function check(el: HTMLInputElement) {
  await act(async () => { el.click(); });
}

test('네이티브 Google: 422 후 생년월일·동의를 채워 다시 누르면 birth_date·consents 가 본문에 실린다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(birthError()).mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(1);
  expect(h.loginGoogleApi.mock.calls[0][0].birth_date).toBeUndefined();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('생년월일');

  await setInput(container.querySelector('#social-birth-date') as HTMLInputElement, '1990-05-17');
  await check(container.querySelector('#google-consent') as HTMLInputElement);
  await click(buttonByText('Google로 회원 로그인'));

  expect(h.loginGoogleApi).toHaveBeenCalledTimes(2);
  const body = h.loginGoogleApi.mock.calls[1][0];
  expect(body.birth_date).toBe('1990-05-17');
  expect(body.id_token).toBe('id-token');
  expect(body.consents).toMatchObject({ tos: true, privacy: true, sensitive: true });
});

test('네이티브 Google: 재시도 전에 이전 오류가 남아 있지 않고, 입력이 틀리면 서버 호출 없이 안내한다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(birthError());
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();

  // 생년월일을 비우고 다시 누르면 서버로 가지 않고 같은 안내(입력 검증)로 막힌다.
  await click(buttonByText('Google로 회원 로그인'));
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('생년월일을 입력해 주세요.');

  await setInput(container.querySelector('#social-birth-date') as HTMLInputElement, '2020-01-01');
  await click(buttonByText('Google로 회원 로그인'));
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('만 14세');
});

test('웹 Google: 재시도 시 birth_date 가 본문에 실린다', async () => {
  h.native = false;
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
  h.loginGoogleApi.mockRejectedValueOnce(birthError()).mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  await setInput(container.querySelector('#social-birth-date') as HTMLInputElement, '1990-05-17');
  await check(container.querySelector('#google-consent') as HTMLInputElement);
  await click(buttonByText('Google로 회원 로그인'));
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(2);
  expect(h.loginGoogleApi.mock.calls[1][0]).toMatchObject({ access_token: 'web-access', birth_date: '1990-05-17' });
  vi.unstubAllEnvs();
});

test('Apple: 422 후 생년월일·동의를 채워 다시 누르면 birth_date 가 본문에 실린다', async () => {
  h.loginAppleApi.mockRejectedValueOnce(
    new ApiError(422, '생년월일을 입력해 주세요', { detail: { code: 'BIRTH_DATE_REQUIRED', message: '생년월일을 입력해 주세요' } }),
  ).mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Apple로 계속하기'));
  expect(h.loginAppleApi).toHaveBeenCalledTimes(1);
  const field = container.querySelector('#social-birth-date') as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await setInput(field!, '1990-05-17');
  await check(container.querySelector('#google-consent') as HTMLInputElement);
  await click(buttonByText('Apple로 계속하기'));
  expect(h.loginAppleApi).toHaveBeenCalledTimes(2);
  expect(h.loginAppleApi.mock.calls[1][0].birth_date).toBe('1990-05-17');
});

test('초대 페이지: 생년월일 입력 후 Google 가입 시 birth_date 가 본문에 실리고, 잘못된 값이면 서버 호출 없이 안내한다', async () => {
  h.native = false;
  vi.doMock('../src/lib/api/invite', () => ({}));
  h.loginGoogleApi.mockResolvedValue(okRes);
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ valid: true, counselor_name: '상담사', status: 'pending' }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/invite/tok123'] },
      createElement(Routes, null, createElement(Route, { path: '/invite/:token', element: createElement(InviteLandingPage) }))));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  const input = container.querySelector('#invite-birth-date') as HTMLInputElement | null;
  expect(input).not.toBeNull();
  for (const cb of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await check(cb);
  // 잘못된 값(만 14세 미만)은 서버 호출 없이 안내한다.
  await setInput(input!, '2020-01-01');
  await click(buttonByText('Google'));
  expect(h.loginGoogleApi).not.toHaveBeenCalled();
  expect(container.textContent).toContain('만 14세');
  await setInput(input!, '1990-05-17');
  await click(buttonByText('Google'));
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(1);
  expect(h.loginGoogleApi.mock.calls[0][0]).toMatchObject({ birth_date: '1990-05-17', invite_token: 'tok123' });
  vi.unstubAllGlobals();
});
