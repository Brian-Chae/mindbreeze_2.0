// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientHomePage from '../src/pages/client/ClientHomePage';
import { useAuthStore } from '../src/stores/authStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/lib/api/client', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/client')>()), apiClient: { get: api.get, post: api.post } }));
vi.mock('../src/lib/api/session', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/session')>()), listSessions: vi.fn().mockResolvedValue({ sessions: [], total: 0 }) }));
vi.mock('../src/lib/api/reports', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/reports')>()), listReports: vi.fn().mockResolvedValue({ reports: [], total: 0 }) }));
vi.mock('../src/lib/api/chat', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/chat')>()), listChatRooms: vi.fn().mockResolvedValue({ rooms: [] }) }));
vi.mock('../src/lib/api/notifications', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/notifications')>()), listNotifications: vi.fn().mockResolvedValue({ notifications: [], total: 0, unread: 0 }), markRead: vi.fn() }));

let cleanup: (() => void) | undefined;
async function render() {
  const el = document.createElement('div');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => { root.render(createElement(MemoryRouter, null, <ClientHomePage />)); });
  cleanup = () => { act(() => root.unmount()); el.remove(); };
  return el;
}
const user = (counselors: unknown[]) => ({ id: 'u1', name: '회원', role: 'client', counselors }) as never;
beforeEach(() => { vi.clearAllMocks(); api.get.mockImplementation(async (url: string) => (url === '/client/counselors' ? useAuthStore.getState().user?.counselors ?? [] : [])); });
afterEach(() => cleanup?.());

describe('홈 담당 상담사 영역', () => {
  it('0명이어도 영역과 추가 버튼이 보인다', async () => {
    useAuthStore.setState({ user: user([]) });
    const el = await render();
    expect(el.textContent).toContain('담당 코치');
    expect(el.textContent).toContain('+ 코치 추가');
    expect(el.textContent).toContain('아직 연결된 코치가 없어요');
  });
  it('여러 명이면 전부 표시하고 추가 버튼으로 시트가 열린다', async () => {
    useAuthStore.setState({ user: user([{ id: 'a', name: '김상담', profile_image: null, org_name: '대구교육청' }, { id: 'b', name: '이코치', profile_image: null }]) });
    const el = await render();
    expect(el.textContent).toContain('김상담');
    expect(el.textContent).toContain('이코치');
    const add = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('코치 추가'))!;
    await act(async () => add.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
