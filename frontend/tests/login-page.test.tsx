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

test('기본 회원 탭은 이메일 로그인을 위에, 간편 로그인을 아래에 둔다 (SDD-227 V03)', () => {
  const html = render('/login');
  expect((html.match(/role="tab"/g) || []).length).toBe(3);
  const order = ['type="email"', '이메일로 회원 로그인', '비밀번호 찾기', '회원가입', '간편 로그인', 'Google로 회원 로그인'].map((k) => html.indexOf(k));
  order.forEach((i) => expect(i).toBeGreaterThan(-1));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(html).toMatch(/register\?role=client/);
});

test('회원 탭에만 하단 코드 입장 카드가 있고 링크에 코드가 없다 (SDD-227 V01·V02·V05)', () => {
  for (const url of ['/login', '/login?role=client']) {
    const html = render(url);
    expect(html).toMatch(/입장 코드가 있나요\?/);
    expect(html).toMatch(/href="\/join"/);
  }
  for (const url of ['/login?role=counselor', '/login?role=org_admin', '/login?role=platform_admin']) {
    const html = render(url);
    expect(html).not.toMatch(/입장 코드가 있나요|href="\/join/);
  }
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
