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
it('상담사 네비에 AI 진입점과 미읽음 배지가 나타나고 읽음 처리 시 사라진다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter><SidebarNav /></MemoryRouter>));
    const link = container.querySelector('a[href="/agent"]');
    expect(link?.textContent).toBe('AI 대화9+');
    await act(async () => useCounselorAgentStore.getState().setUnread(0));
    expect(link?.textContent).toBe('AI 대화');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
