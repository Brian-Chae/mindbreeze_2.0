// @vitest-environment jsdom
// SDD-309: 소셜 신규 가입 확인 화면(/signup/confirm)의 초대 코치 코드 — 필수 입력, 초대 토큰이면 면제, 요청 본문에 counselor_code.
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
import SignupConfirmPage from '../src/pages/SignupConfirmPage';
import { useSocialSignupStore } from '../src/stores/social-signup-store';
import InviteLandingPage from '../src/pages/clients/InviteLandingPage';

const okUser = { id: 'u1', email: 'a@b.c', name: 'A', role: 'client', client_required_fields: [] };
const okRes = { access_token: 't', token_type: 'bearer', user: okUser };
const birthError = () => new ApiError(422, '생년월일을 입력해 주세요', { detail: '생년월일을 입력해 주세요' });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.native = true;
  h.loginGoogleApi.mockReset();
  h.loginAppleApi.mockReset();
  useSocialSignupStore.getState().clear();
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
    root.render(createElement(MemoryRouter, { initialEntries: ['/login?role=client'] }, createElement(Routes, null,
      createElement(Route, { path: '/login', element: createElement(LoginPage) }),
      createElement(Route, { path: '/signup/confirm', element: createElement(SignupConfirmPage) }),
      createElement(Route, { path: '/app', element: createElement('p', null, '회원 홈') }),
      createElement(Route, { path: '/onboarding/client/essentials', element: createElement('p', null, '필수 정보') }))));
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

const typeBirth = async (value: string) => setInput(container.querySelector('#signup-birth-date') as HTMLInputElement, value);
const checkAllRequired = async () => {
  await setInput(container.querySelector('[aria-label="이름"]') as HTMLInputElement, '가입 회원');
  const gender = container.querySelector('[aria-label="성별"]') as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(gender, 'female'); gender.dispatchEvent(new Event('change', { bubbles: true })); });
  for (const cb of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (cb.parentElement?.textContent?.includes('필수 항목 전체 동의')) await check(cb);
  }
};
const submitBtn = () => buttonByText('가입하기');
const codeInput = () => container.querySelector('#social-counselor-code') as HTMLInputElement | null;
const codeRequired = () => new ApiError(422, '코치 코드를 확인해주세요.', { detail: { code: 'COUNSELOR_CODE_REQUIRED', message: '코치 코드를 확인해주세요.' } });

test('V11 확인 화면: 코치 코드 6자리 전에는 가입하기가 비활성이다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(codeRequired());
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  expect(codeInput()).not.toBeNull();
  expect(container.textContent).toContain('초대 코치 코드');
  await typeBirth('19900517');
  await checkAllRequired();
  expect(submitBtn().disabled).toBe(true);
  await setInput(codeInput()!, '12345');
  expect(submitBtn().disabled).toBe(true);
  await setInput(codeInput()!, '12a3456x');
  expect(codeInput()!.value).toBe('123456');
  expect(submitBtn().disabled).toBe(false);
});

test('V13 Google: counselor_code 가 요청 본문에 실린다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(codeRequired()).mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  await typeBirth('19900517');
  await checkAllRequired();
  await setInput(codeInput()!, '123456');
  await click(submitBtn());
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(2);
  expect(h.loginGoogleApi.mock.calls[1][0]).toMatchObject({ id_token: 'id-token', counselor_code: '123456', birth_date: '1990-05-17' });
});

test('V13 Apple: counselor_code 가 요청 본문에 실린다', async () => {
  h.loginAppleApi.mockRejectedValueOnce(codeRequired()).mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Apple로 계속하기'));
  await typeBirth('19900517');
  await checkAllRequired();
  await setInput(codeInput()!, '654321');
  await click(submitBtn());
  expect(h.loginAppleApi.mock.calls[1][0]).toMatchObject({ counselor_code: '654321', nonce: 'nonce-12345678' });
});

test('V14 잘못된 코드(404)는 코드칸 아래에 안내하고 입력을 유지해 재시도할 수 있다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(codeRequired())
    .mockRejectedValueOnce(new ApiError(404, '코치 코드를 찾을 수 없습니다', { detail: '코치 코드를 찾을 수 없습니다' }))
    .mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  await typeBirth('19900517');
  await checkAllRequired();
  await setInput(codeInput()!, '999999');
  await click(submitBtn());
  expect(container.querySelector('#social-counselor-code-error')?.textContent).toContain('코치 코드를 찾을 수 없습니다');
  expect(codeInput()!.value).toBe('999999');
  expect(submitBtn().disabled).toBe(false);
  await setInput(codeInput()!, '123456');
  expect(container.querySelector('#social-counselor-code-error')).toBeNull();
  await click(submitBtn());
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(3);
});

test('V12 초대 토큰이 있으면 코치 코드칸이 없고 가입할 수 있다', async () => {
  useSocialSignupStore.getState().begin({ credential: { provider: 'google', tokenKind: 'id_token', token: 'id-token' }, role: 'client', rememberMe: true, inviteToken: 'tok123' });
  h.loginGoogleApi.mockResolvedValueOnce(okRes);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/signup/confirm'] }, createElement(Routes, null,
      createElement(Route, { path: '/signup/confirm', element: createElement(SignupConfirmPage) }),
      createElement(Route, { path: '/onboarding/client/essentials', element: createElement('p', null, '필수 정보') }),
      createElement(Route, { path: '/app', element: createElement('p', null, '회원 홈') }))));
  });
  expect(codeInput()).toBeNull();
  await typeBirth('19900517');
  await checkAllRequired();
  expect(submitBtn().disabled).toBe(false);
  await click(submitBtn());
  expect(h.loginGoogleApi.mock.calls[0][0]).toMatchObject({ invite_token: 'tok123' });
  expect(h.loginGoogleApi.mock.calls[0][0].counselor_code).toBeUndefined();
});

test('V17 확인 화면에 금지 문구가 없다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(codeRequired());
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  for (const word of ['점수', '종합점수', '좋음', '나쁨', '보증', '100%']) expect(container.textContent).not.toContain(word);
});
