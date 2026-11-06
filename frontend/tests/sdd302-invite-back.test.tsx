// @vitest-environment jsdom
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test } from 'vitest';
import AuthShell from '../src/components/auth/AuthShell';
import SignupConfirmPage from '../src/pages/SignupConfirmPage';
import { useSocialSignupStore } from '../src/stores/social-signup-store';
afterEach(() => useSocialSignupStore.getState().clear());
function backHref(html: string) { const node = document.createElement('div'); node.innerHTML = html; return new URL(node.querySelector('.signup-back')!.getAttribute('href')!, 'https://fixture.test'); }
test('이메일 회원 가입 뒤로가기에서 초대 토큰과 코드를 유지한다', () => {
  const url = backHref(renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/register/client?token=invite-fixture&code=123456'] }, createElement(AuthShell, { title: '회원 가입', variant: 'member', children: '가입 폼' }))));
  expect(url.pathname).toBe('/register'); expect(url.searchParams.get('token')).toBe('invite-fixture'); expect(url.searchParams.get('code')).toBe('123456');
});
test('소셜 확인 뒤로가기에서 메모리 pending의 초대 토큰을 유지한다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useSocialSignupStore.getState().begin({ credential: { provider: 'google', tokenKind: 'access_token', token: 'fixture' }, inviteToken: 'social-invite', inviteCode: '123456', rememberMe: true });
  const container = document.createElement('div'); const root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/signup/confirm'] }, createElement(SignupConfirmPage))));
  const url = backHref(container.innerHTML);
  expect(url.searchParams.get('token')).toBe('social-invite'); expect(url.searchParams.get('code')).toBe('123456');
  await act(async () => root.unmount());
});
