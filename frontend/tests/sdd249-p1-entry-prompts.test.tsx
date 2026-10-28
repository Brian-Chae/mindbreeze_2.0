// @vitest-environment jsdom
// SDD-249 D6·D7: 앱 기관 문의는 웹 문의로 연결, 코드 입장 게스트에게 선택 가입 권유(건너뛰기 가능).
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const h = vi.hoisted(() => ({ native: false }));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => h.native, getPlatform: () => (h.native ? 'ios' : 'web') }));

import RegisterPage from '../src/pages/RegisterPage';
import { GuestSignupPrompt } from '../src/components/auth/GuestSignupPrompt';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test('웹: 기관 가입 상담 카드, 앱: 웹 문의 안내 링크로 대체 (D6)', async () => {
  h.native = false;
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(RegisterPage))));
  expect(container.querySelector('a[href="/register/organization"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="app-org-inquiry"]')).toBeNull();
  act(() => root.unmount());
  h.native = true;
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(RegisterPage))));
  expect(container.querySelector('a[href="/register/organization"]')).toBeNull();
  const link = container.querySelector('[data-testid="app-org-inquiry"]') as HTMLAnchorElement;
  expect(link.textContent).toContain('기관 도입은 웹에서 문의해요');
  expect(link.getAttribute('href')).toMatch(/\/\?inquiry=1$/);
  expect(link.getAttribute('rel')).toContain('noopener');
});

test('게스트 가입 권유는 선택이며 건너뛰면 사라진다 (D7)', async () => {
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(GuestSignupPrompt))));
  expect(container.textContent).toContain('리포트를 계속 관리하고 편하게 클래스에 계속 참여하려면 가입하세요');
  expect(container.querySelector('a[href="/register/client"]')).not.toBeNull();
  const skip = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('건너뛰고 계속 참여하기')) as HTMLButtonElement;
  await act(async () => { skip.click(); });
  expect(container.querySelector('[data-testid="guest-signup-prompt"]')).toBeNull();
});
