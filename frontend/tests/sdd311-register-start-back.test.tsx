// @vitest-environment jsdom
// SDD-311 — 가입 시작 화면의 뒤로 가기는 자기 자신이 아니라 로그인 화면으로 간다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/components/auth/GoogleLoginButton', () => ({ default: () => null }));
vi.mock('../src/components/auth/AppleLoginButton', () => ({ default: () => null }));

import RegisterStartPage from '../src/pages/register/RegisterStartPage';

let root: Root; let container: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }

it('가입 시작 화면 뒤로 가기 링크는 현재 주소가 아니라 /login?role=client 이다', async () => {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/register?role=client']}>
      <Routes><Route path="/register" element={<RegisterStartPage />} /><Route path="/login" element={<Where />} /></Routes>
    </MemoryRouter>));
  const back = container.querySelector<HTMLAnchorElement>('a.signup-back')!;
  expect(back.getAttribute('href')).toBe('/login?role=client');
  await act(async () => back.click());
  expect(container.querySelector('[data-testid="where"]')!.textContent).toBe('/login?role=client');
});
