// 로그인 화면(네이티브)에서 상태바를 웹뷰 위에 겹쳐 반투명 헤더와 색 띠가 생기지 않게 한다.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const calls: string[] = [];
vi.mock('@capacitor/status-bar', () => ({
  Style: { Light: 'LIGHT', Dark: 'DARK' },
  StatusBar: {
    setOverlaysWebView: vi.fn(async ({ overlay }: { overlay: boolean }) => { calls.push(`overlay:${overlay}`); }),
    setBackgroundColor: vi.fn(async ({ color }: { color: string }) => { calls.push(`bg:${color}`); }),
    setStyle: vi.fn(async ({ style }: { style: string }) => { calls.push(`style:${style}`); }),
  },
}));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => true }));
let authed = false;
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (sel: (s: { isAuthenticated: boolean }) => boolean) => sel({ isAuthenticated: authed }) }));

import { useStatusBar } from '../src/lib/native/use-status-bar';

function Probe() { useStatusBar(); return null; }
const Wrap = ({ path, children }: { path: string; children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
async function mount(path: string) {
  const el = document.createElement('div');
  const root = createRoot(el);
  await act(async () => { root.render(<Wrap path={path}><Probe /></Wrap>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  root.unmount();
}

describe('useStatusBar 로그인 화면 overlay', () => {
  beforeEach(() => { calls.length = 0; });
  it('비로그인 /login: 상태바를 웹뷰 위에 겹치고 배경색을 칠하지 않는다', async () => {
    authed = false;
    await mount('/login?role=counselor');
    expect(calls).toEqual(['overlay:true', 'style:DARK']);
  });
  it('비로그인 다른 화면(/register): 기존처럼 어두운 단색 상태바', async () => {
    authed = false;
    await mount('/register');
    expect(calls).toEqual(['overlay:false', 'bg:#1F1B24', 'style:DARK']);
  });
  it('로그인 후: 흰 상태바', async () => {
    authed = true;
    await mount('/home');
    expect(calls).toEqual(['overlay:false', 'bg:#FFFFFF', 'style:LIGHT']);
  });
});
