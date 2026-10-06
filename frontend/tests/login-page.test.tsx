// TQ-16: TS require.extensions 즉석 트랜스파일 + import.meta 정규식 치환 해킹을 제거하고,
// vitest 가 TSX 를 직접 변환하도록 네이티브 테스트로 이관한다.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import LoginPage from '../src/pages/LoginPage';

// 렌더 중 호출되는 외부 OAuth 훅만 스텁으로 대체한다.
vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: () => () => {},
}));

const render = (url: string): string =>
  renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [url] }, createElement(LoginPage)),
  );

test('기본 회원 탭은 Google을 이메일보다 먼저 보여 준다', () => {
  const html = render('/login');
  expect((html.match(/role="tab"/g) || []).length).toBe(3);
  expect(html).toMatch(/Google로 회원 로그인/);
  expect(html.indexOf('Google로 회원 로그인')).toBeLessThan(html.indexOf('type="email"'));
  expect(html).toMatch(/register\?role=client/);
});

test('상담사는 이메일 우선, 기관은 Google과 가입이 없다', () => {
  const counselor = render('/login?role=counselor');
  expect(counselor.indexOf('type="email"')).toBeLessThan(
    counselor.indexOf('Google로 상담사 로그인'),
  );
  expect(counselor).toMatch(/register\?role=counselor/);
  const org = render('/login?role=org_admin');
  expect(org).toMatch(/기관 관리자 로그인/);
  expect(org).not.toMatch(/Google|href="\/register/);
});

test('관리자 모드는 공개 탭과 이메일을 숨긴다', () => {
  const html = render('/login?role=platform_admin');
  expect(html).toMatch(/플랫폼 관리자 로그인/);
  expect(html).toMatch(/Google Workspace/);
  expect(html).toMatch(/일반 로그인으로 돌아가기/);
  expect(html).not.toMatch(/role="tab"|type="email"/);
});

test('알 수 없는 role은 회원 화면이다', () => {
  expect(render('/login?role=unknown')).toMatch(/Google로 회원 로그인/);
});
