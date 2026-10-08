// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import SidebarNav from '../src/components/layout/SidebarNav';
import { useCounselorAgentStore } from '../src/stores/agent-counselor-store';
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (state: { user: { id: string; role: string; name: string } }) => unknown) => selector({ user: { id: 'c1', role: 'counselor', name: '상담사' } }) }));
vi.mock('../src/stores/notificationStore', () => ({ useNotificationStore: (selector: (state: { wsConnected: boolean }) => unknown) => selector({ wsConnected: true }) }));
vi.mock('../src/lib/api/agent-counselor', () => ({ getUnreadCount: async () => ({ unread: 12 }) }));
it('루시(AI) 미읽음이 채팅 메뉴 배지에 합산되고 읽음 처리 시 사라진다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter><SidebarNav /></MemoryRouter>));
    // AI 대화 메뉴는 채팅으로 통합 — 루시(AI) 미읽음은 채팅 배지에 합산된다.
    expect(container.querySelector('a[href="/agent"]')).toBeNull();
    const link = container.querySelector('a[href="/chat"]');
    expect(link?.textContent).toBe('채팅9+');
    await act(async () => useCounselorAgentStore.getState().setUnread(0));
    expect(link?.textContent).toBe('채팅');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
