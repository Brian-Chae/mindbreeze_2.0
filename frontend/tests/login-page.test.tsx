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

test('상담사는 이메일 우선, 기관은 Google·Apple 제공(SDD-249 D2)·셀프 가입 없음', () => {
  const counselor = render('/login?role=counselor');
  expect(counselor.indexOf('type="email"')).toBeLessThan(
    counselor.indexOf('Google로 상담사 로그인'),
  );
  expect(counselor).toMatch(/register\?role=counselor/);
  const org = render('/login?role=org_admin');
  expect(org).toMatch(/기관 관리자 로그인/);
  expect(org).toMatch(/Google로 기관 로그인/);
  expect(org).toMatch(/운영자가 지정한 계정/);
  expect(org).toMatch(/href="\/register\/organization"/);
  expect(org).not.toMatch(/href="\/register\?role/);
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


test('로그인 제목과 역할 스위치는 본문 앞의 헤더에 있고 브랜드 대형 제목은 없다', () => {
  const html = render('/login');
  expect(html).toMatch(/<header[\s\S]*<h1[^>]*>로그인<\/h1>[\s\S]*role="tablist"[\s\S]*<\/header>/);
  expect(html).not.toContain('MIND BREEZE 로그인');
  expect(html).toContain('aria-label="Mind Breeze 홈으로 이동"');
});

test('각 역할 안내는 로그인 버튼 바로 다음에 표시한다', () => {
  for (const [role, description] of [
    ['client', '상담과 명상을 이용하는 회원을 위한 로그인입니다.'],
    ['counselor', '상담사 계정으로 세션과 회원을 관리하세요.'],
    ['org_admin', '기관에서 발급받은 관리자 계정을 사용하세요.'],
    ['platform_admin', 'Google Workspace 계정으로 로그인하세요.'],
  ]) {
    expect(render(`/login?role=${role}`)).toContain(`</button><p class="text-center text-[12.5px] text-white/78 text-white/[0.78]">${description}</p>`);
  }
});
