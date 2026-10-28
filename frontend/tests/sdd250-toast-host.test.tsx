// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/lib/api/notifications', async (orig) => ({
  ...(await orig<object>()), markRead: vi.fn(async () => {}), getUnreadCount: vi.fn(async () => ({ unread: 0 })),
}));
import NotificationToastHost from '../src/components/notifications/notification-toast-host';
import { useAuthStore } from '../src/stores/authStore';
import { useNotificationStore } from '../src/stores/notificationStore';

let root: Root; let host: HTMLDivElement;
const Where = () => createElement('i', { 'data-testid': 'where' }, useLocation().pathname);
const SID = '11111111-1111-4111-8111-111111111111';
const mount = async () => {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/app'] }, createElement(NotificationToastHost), createElement(Where))));
};
const show = (id: string, extra: Record<string, unknown> | null = null) =>
  act(() => { useNotificationStore.getState().showToast({ id, type: 'info', title: `제목${id}`, body: '본문', extra }); });

beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  useNotificationStore.getState().reset();
  useAuthStore.setState({ user: { id: 'u', role: 'client' } as never });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useNotificationStore.getState().reset(); });

describe('SDD-250 NotificationToastHost', () => {
  it('TS18 클래스형: assertive, 입장하기, 눌러 이동하고 닫힌다', async () => {
    await mount();
    await show('a', { event_type: 'class_invited', target_type: 'class', target_id: 'c1', params: { start_now: true, session_id: SID } });
    const el = host.querySelector('[data-testid="notification-toast"]')!;
    expect(el.getAttribute('role')).toBe('status');
    expect(el.getAttribute('aria-live')).toBe('assertive');
    expect(host.querySelector('[data-testid="toast-enter"]')?.textContent).toBe('입장하기');
    await act(async () => { (el.querySelector('.nt-toast__body') as HTMLButtonElement).click(); });
    expect(host.querySelector('[data-testid="where"]')?.textContent).toBe(`/class/${SID}/enter`);
    expect(useNotificationStore.getState().toasts).toHaveLength(0);
  });

  it('일반형 polite, 입장하기 없음, ✕ 로 닫기', async () => {
    await mount(); await show('g');
    const el = host.querySelector('[data-testid="notification-toast"]')!;
    expect(el.getAttribute('aria-live')).toBe('polite');
    expect(host.querySelector('[data-testid="toast-enter"]')).toBeNull();
    await act(async () => { (el.querySelector('.nt-toast__close') as HTMLButtonElement).click(); });
    expect(host.querySelector('[data-testid="notification-toast"]')).toBeNull();
  });

  it('TS13 4개를 쌓으면 3개 + +1건', async () => {
    await mount(); for (const id of ['1', '2', '3', '4']) await show(id);
    expect(host.querySelectorAll('[data-testid="notification-toast"]')).toHaveLength(3);
    expect(host.querySelector('[data-testid="toast-more"]')?.textContent).toContain('+1건');
    expect(host.querySelector('.nt-toast__title')?.textContent).toBe('제목4');
  });

  it('Esc 로 최신 토스트를 닫는다', async () => {
    await mount(); await show('e');
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(useNotificationStore.getState().toasts).toHaveLength(0);
  });
});
