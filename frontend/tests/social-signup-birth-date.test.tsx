// @vitest-environment jsdom
// SDD-249: 소셜 신규 가입(서버 422)은 오류 문구 없이 /signup/confirm 으로 이동하고, 거기서 생년월일·동의를 채워 제출하면 birth_date·consents 가 본문에 실려야 한다.
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
  for (const cb of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (cb.parentElement?.textContent?.includes('필수 항목 전체 동의')) await check(cb);
  }
};
const submitBtn = () => buttonByText('가입하기');

test('네이티브 Google: 신규(422)면 오류 문구 없이 확인 화면으로 가고, 생년월일·동의 후 id_token 으로 재요청한다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(birthError()).mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(1);
  expect(h.loginGoogleApi.mock.calls[0][0].birth_date).toBeUndefined();
  expect(container.textContent).toContain('가입 정보 확인');
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(submitBtn().disabled).toBe(true);

  await typeBirth('19900517');
  expect((container.querySelector('#signup-birth-date') as HTMLInputElement).value).toBe('1990.05.17');
  expect(submitBtn().disabled).toBe(true);
  await checkAllRequired();
  expect(submitBtn().disabled).toBe(false);
  await click(submitBtn());

  expect(h.loginGoogleApi).toHaveBeenCalledTimes(2);
  const body = h.loginGoogleApi.mock.calls[1][0];
  expect(body.birth_date).toBe('1990-05-17');
  expect(body.id_token).toBe('id-token');
  expect(body.consents).toMatchObject({ tos: true, privacy: true, sensitive: true, eeg: false, research: false });
});

test('확인 화면: 만 14세 미만은 제출이 막히고 안내가 나온다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(birthError());
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  await typeBirth('20200101');
  await checkAllRequired();
  expect(submitBtn().disabled).toBe(true);
  expect(container.textContent).toContain('만 14세');
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(1);
});

test('웹 Google: 신규(422)면 access_token 으로 확인 화면 후 재요청한다', async () => {
  h.native = false;
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
  h.loginGoogleApi.mockRejectedValueOnce(birthError()).mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  expect(container.textContent).toContain('가입 정보 확인');
  await typeBirth('19900517');
  await checkAllRequired();
  await click(submitBtn());
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(2);
  expect(h.loginGoogleApi.mock.calls[1][0]).toMatchObject({ access_token: 'web-access', birth_date: '1990-05-17' });
  vi.unstubAllEnvs();
});

test('Apple: 신규(422)면 확인 화면 후 같은 nonce·id_token 으로 birth_date 와 함께 재요청한다', async () => {
  h.loginAppleApi.mockRejectedValueOnce(
    new ApiError(422, '생년월일을 입력해 주세요', { detail: { code: 'BIRTH_DATE_REQUIRED', message: '생년월일을 입력해 주세요' } }),
  ).mockResolvedValueOnce(okRes);
  await mountLogin();
  await click(buttonByText('Apple로 계속하기'));
  expect(h.loginAppleApi).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('가입 정보 확인');
  await typeBirth('19900517');
  await checkAllRequired();
  await click(submitBtn());
  expect(h.loginAppleApi).toHaveBeenCalledTimes(2);
  expect(h.loginAppleApi.mock.calls[1][0]).toMatchObject({ birth_date: '1990-05-17', id_token: 'apple-id-token-1234', nonce: 'nonce-12345678' });
});

test('422 가 아닌 오류(401·409 등)는 확인 화면으로 보내지 않고 오류 문구를 보인다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(new ApiError(401, '유효하지 않은 Google 인증 토큰입니다', null));
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  expect(container.textContent).not.toContain('가입 정보 확인');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('유효하지 않은');
});

test('확인 화면: 자격 없이 직접 진입(새로고침)하면 로그인 화면으로 돌아간다', async () => {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/signup/confirm'] }, createElement(Routes, null,
      createElement(Route, { path: '/signup/confirm', element: createElement(SignupConfirmPage) }),
      createElement(Route, { path: '/login', element: createElement('p', null, '로그인 화면') }))));
  });
  expect(container.textContent).toContain('로그인 화면');
});

test('확인 화면: 409 계정 연결 필요 / 탈퇴 처리 중 안내와 로그인 이동 링크', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(birthError()).mockRejectedValueOnce(
    new ApiError(409, '이미 같은 이메일', { detail: { code: 'ACCOUNT_LINK_REQUIRED', message: 'x' } }),
  );
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  await typeBirth('19900517');
  await checkAllRequired();
  await click(submitBtn());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('기존 방법으로 로그인');
});

test('소셜 자격은 localStorage·sessionStorage 에 저장되지 않는다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(birthError());
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
  expect(dump).not.toContain('id-token');
  expect(dump).not.toContain('web-access');
});

test('초대 페이지: 신규 Google 가입은 확인 화면으로 가고, invite_token 이 재요청에 실린다 (#148 유지)', async () => {
  h.native = false;
  h.loginGoogleApi.mockRejectedValueOnce(birthError()).mockResolvedValueOnce(okRes);
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ counselor_name: '김상담', counselor_code: 'ABC123', organization: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/invite/tok123'] },
      createElement(Routes, null,
        createElement(Route, { path: '/invite/:token', element: createElement(InviteLandingPage) }),
        createElement(Route, { path: '/signup/confirm', element: createElement(SignupConfirmPage) }),
        createElement(Route, { path: '/onboarding/client', element: createElement('p', null, '온보딩') }))));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(container.textContent).toContain('김상담');
  await click(buttonByText('Google'));
  expect(container.textContent).toContain('가입 정보 확인');
  await typeBirth('19900517');
  await checkAllRequired();
  await click(submitBtn());
  expect(h.loginGoogleApi).toHaveBeenCalledTimes(2);
  expect(h.loginGoogleApi.mock.calls[1][0]).toMatchObject({ birth_date: '1990-05-17', invite_token: 'tok123' });
  vi.unstubAllGlobals();
});

test('초대 페이지: 없는 초대 / 만료·사용된 초대 문구를 구분한다', async () => {
  for (const [i, [detail, expected]] of ([['초대 링크가 유효하지 않습니다', '확인할 수 없는 링크'], ['초대 링크가 만료되었거나 이미 사용되었습니다', '만료되었거나 이미 사용']] as const).entries()) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 404, headers: { 'Content-Type': 'application/json' } })));
    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: [`/invite/x${i}`] },
        createElement(Routes, null, createElement(Route, { path: '/invite/:token', element: createElement(InviteLandingPage) }))));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.textContent).toContain(expected);
    expect(container.querySelector('a[href="/login?role=client"]')).not.toBeNull();
    vi.unstubAllGlobals();
    await act(async () => root.render(createElement('div')));
  }
});

test('역할 불일치(403)면 올바른 탭으로 이동하는 버튼이 나온다 (SDD-249 P1-1)', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(new ApiError(403, '선택한 Google 계정은 이 로그인 유형의 계정이 아니에요.', { detail: { code: 'ROLE_MISMATCH', message: 'x' } }));
  await mountLogin();
  await click(buttonByText('Google로 회원 로그인'));
  const alertEl = container.querySelector('[role="alert"]');
  expect(alertEl?.textContent).toContain('코치 로그인으로 이동');
  expect(alertEl?.textContent).toContain('기관 로그인으로 이동');
  await click([...alertEl!.querySelectorAll('button')].find((b) => b.textContent?.includes('코치')) as HTMLButtonElement);
  expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('코치');
});

test('상담사 탭 소셜 신규(사전 등록 없음 403)면 상담사 가입 안내로 가는 링크가 나온다', async () => {
  h.loginGoogleApi.mockRejectedValueOnce(new ApiError(403, '사전 등록된 계정이 없습니다. 관리자에게 문의하세요.', null));
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/login?role=counselor'] }, createElement(LoginPage)));
  });
  await click(buttonByText('Google로 코치 로그인'));
  expect(container.querySelector('a[href="/register?role=counselor"]')).not.toBeNull();
});
