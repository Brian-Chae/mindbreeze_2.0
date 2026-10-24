// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/stores/authStore';
import SettingsContent from '../src/components/settings/settings-content';
vi.mock('../src/components/settings/account-settings', () => ({ default: () => <p>계정 편집</p> }));
vi.mock('../src/components/settings/notification-groups', () => ({ default: () => <p>목적별 알림</p> }));
vi.mock('../src/components/settings/WebPushCard', () => ({ default: () => null }));
vi.mock('../src/components/settings/privacy-consents', () => ({ PrivacyConsentsSection: () => null }));
vi.mock('../src/components/settings/account-deletion', () => ({ AccountDeletionSection: () => null }));
afterEach(() => vi.restoreAllMocks());
it.each(['client', 'counselor', 'org_admin', 'platform_admin'] as const)('%s는 5그룹·플레이그라운드·로그아웃 진입을 가진다', async (role) => {
  useAuthStore.setState({ user: { id: 'sample', role, name: '샘플', email: 'sample@example.test' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> });
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><SettingsContent /></MemoryRouter>));
  expect(host.querySelectorAll('[data-settings-group]')).toHaveLength(5);
  expect(host.querySelector('a[href="/playground"]')).not.toBeNull();
  expect(host.textContent).toContain('로그아웃');
  expect(host.querySelector('a[href="/reports?settings=operations"]') !== null).toBe(role === 'counselor' || role === 'org_admin');
  await act(async () => root.unmount());
});
