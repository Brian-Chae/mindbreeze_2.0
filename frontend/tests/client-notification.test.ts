// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClientNotificationPage from '../src/pages/client/ClientNotificationPage';
import { listNotifications, markRead, type NotificationDto } from '../src/lib/api/notifications';
vi.mock('../src/lib/api/notifications', async (original) => ({ ...await original<typeof import('../src/lib/api/notifications')>(), listNotifications: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn() }));
vi.mock('../src/stores/notificationStore', () => ({ useNotificationStore: { getState: () => ({ fetch: vi.fn() }) } }));
let root: Root;
let container: HTMLDivElement;
const notification: NotificationDto = {
  id: 'notification', type: 'chat', title: '새 채팅', body: '알림 본문', is_read: false, created_at: '2026-09-27T00:00:00Z',
  extra: { schema_version: 1, target_type: 'chat_room', target_id: 'room', params: { message_id: 'message' } },
};
function Location() { const location = useLocation(); return createElement('output', null, location.pathname + location.search); }
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(listNotifications).mockResolvedValue({ notifications: [notification], total: 1, unread: 1 });
  vi.mocked(markRead).mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/app/notifications'] }, createElement(ClientNotificationPage), createElement(Location))));
}
it.each([false, true])('읽음 여부 %s와 관계없이 내담자 메시지 경로로 이동한다', async (isRead) => {
  vi.mocked(listNotifications).mockResolvedValue({ notifications: [{ ...notification, is_read: isRead }], total: 1, unread: 1 });
  await render();
  const card = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('새 채팅'))!;
  await act(async () => card.click());
  expect(container.querySelector('output')?.textContent).toBe('/app/chat/room?message=message');
});
it('정보형 알림을 클릭하면 전체 내용을 표시하고 센터에 머문다', async () => {
  vi.mocked(listNotifications).mockResolvedValue({ notifications: [{ ...notification, extra: null }], total: 1, unread: 1 });
  await render();
  await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes('새 채팅'))!.click());
  expect(container.querySelector('p')?.textContent).toBe('알림 본문');
  expect(container.querySelector('output')?.textContent).toBe('/app/notifications');
});
it('목록 오류는 정상 빈 상태와 구분하고 재시도한다', async () => {
  vi.mocked(listNotifications).mockRejectedValueOnce(new Error('오프라인'));
  await render();
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  expect(container.textContent).not.toContain('아직 알림이 없습니다.');
  await act(async () => [...container.querySelectorAll('button')].find((item) => item.textContent === '다시 시도')!.click());
  expect(container.textContent).toContain('새 채팅');
});
