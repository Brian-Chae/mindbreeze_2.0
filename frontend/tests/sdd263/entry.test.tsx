// @vitest-environment jsdom
// SDD-263: 정식 메뉴 진입점 — 사이드바(역할별)·모바일 하단 탭 5개 불변·설정 그룹
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { useAuthStore } from '../../src/stores/authStore';
import SidebarNav from '../../src/components/layout/SidebarNav';
import SettingsContent from '../../src/components/settings/settings-content';
import { getMobileMenuTabs } from '../../src/lib/mobile-menu-swipe';
vi.mock('../../src/components/settings/account-settings', () => ({ default: () => null }));
vi.mock('../../src/components/settings/notification-groups', () => ({ default: () => null }));
vi.mock('../../src/components/settings/WebPushCard', () => ({ default: () => null }));
vi.mock('../../src/components/settings/privacy-consents', () => ({ PrivacyConsentsSection: () => null }));
vi.mock('../../src/components/chat/blocked-users-list', () => ({ BlockedUsersList: () => null }));
vi.mock('../../src/components/settings/account-deletion', () => ({ AccountDeletionSection: () => null }));
vi.mock('../../src/lib/api/agent-counselor', () => ({ getUnreadCount: () => Promise.resolve({ unread: 0 }) }));
vi.mock('../../src/lib/api/agent-checkin', () => ({ listCheckinClients: () => Promise.resolve({ items: [] }) }));

const setRole = (role: string) => useAuthStore.setState({ user: { id: 'u', role, name: 'n', email: 'e@e.test' } as never });
async function render(node: React.ReactElement) {
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  return { host, root };
}
it.each([['counselor', '/upload-status'], ['org_admin', '/upload-status'], ['platform_admin', '/admin/upload-status'], ['client', null]] as const)('사이드바 데이터 현황: %s', async (role, to) => {
  setRole(role);
  const { host, root } = await render(<SidebarNav />);
  const links = [...host.querySelectorAll('[data-sidebar-menu] a')].map((a) => a.getAttribute('href'));
  expect(links.includes('/upload-status') || links.includes('/admin/upload-status')).toBe(to !== null);
  if (to) expect(links).toContain(to);
  await act(async () => root.unmount());
});
it.each([['counselor', '/upload-status'], ['org_admin', '/upload-status'], ['platform_admin', '/admin/upload-status']] as const)('설정 정식 그룹: %s', async (role, to) => {
  setRole(role);
  const { host, root } = await render(<SettingsContent />);
  expect(host.querySelectorAll('[data-settings-group]')).toHaveLength(7);
  expect(host.textContent).toContain('데이터 현황');
  expect(host.querySelector('a[data-upload-status-link]')?.getAttribute('href')).toBe(to);
  await act(async () => root.unmount());
});
it('모바일 하단 탭은 5개 고정(6번째 탭 없음)', () => {
  for (const role of ['counselor', 'org_admin', 'client'] as const) {
    const tabs = getMobileMenuTabs(role, true);
    expect(tabs).toHaveLength(5);
    expect(tabs.some((t) => t.to.includes('upload-status'))).toBe(false);
  }
});
