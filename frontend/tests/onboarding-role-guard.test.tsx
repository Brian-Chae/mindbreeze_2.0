// @vitest-environment jsdom
// SDD-249 P1-4: 온보딩 화면은 역할이 다르면 다른 역할 화면을 노출하지 않고 안내 + 내 홈 이동 버튼을 보여 준다.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { RoleGuard } from '../src/components/auth/RoleGuard';
import { useAuthStore } from '../src/stores/authStore';

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

function setUser(role: string | null, extra: Record<string, unknown> = {}) {
  useAuthStore.setState({
    user: role ? ({ id: 'u', role, name: 'n', email: 'a@b.c', onboarding_completed: true, ...extra } as never) : null,
    isAuthenticated: Boolean(role),
    isInitialized: true,
  });
}
async function mount(path: string, need: 'client' | 'counselor') {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null,
      createElement(Route, { path: '/onboarding/x', element: createElement(RoleGuard, { role: need, onMismatch: 'notice' }, createElement('p', null, `${need} 온보딩 본문`)) }),
      createElement(Route, { path: '/login', element: createElement('p', null, '로그인') }),
    )));
  });
}

test('코치 계정이 회원 온보딩에 들어가면 안내와 코치 홈 이동 버튼이 나오고 본문은 보이지 않는다', async () => {
  setUser('counselor');
  await mount('/onboarding/x', 'client');
  expect(container.textContent).toContain('이 화면은 회원용이에요');
  expect(container.textContent).not.toContain('온보딩 본문');
  expect(container.querySelector('a[href="/dashboard"]')?.textContent).toContain('내 홈으로');
});

test('회원 계정이 코치 온보딩에 들어가면 안내와 회원 홈 이동 버튼', async () => {
  setUser('client');
  await mount('/onboarding/x', 'counselor');
  expect(container.textContent).toContain('이 화면은 코치용이에요');
  expect(container.querySelector('a[href="/app"]')).not.toBeNull();
});

test('올바른 역할은 본문, 비로그인은 로그인으로', async () => {
  setUser('client');
  await mount('/onboarding/x', 'client');
  expect(container.textContent).toContain('client 온보딩 본문');
  act(() => root.unmount());
  container.remove();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  setUser(null);
  await mount('/onboarding/x', 'client');
  expect(container.textContent).toContain('로그인');
});
