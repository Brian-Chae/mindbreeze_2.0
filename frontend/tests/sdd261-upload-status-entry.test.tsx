// @vitest-environment jsdom
// SDD-261: 설정 진입 링크(역할별) — V-U16/17 노출 규칙
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { useAuthStore } from '../src/stores/authStore';
import SettingsContent from '../src/components/settings/settings-content';
vi.mock('../src/components/settings/account-settings', () => ({ default: () => null }));
vi.mock('../src/components/settings/notification-groups', () => ({ default: () => null }));
vi.mock('../src/components/settings/WebPushCard', () => ({ default: () => null }));
vi.mock('../src/components/settings/privacy-consents', () => ({ PrivacyConsentsSection: () => null }));
vi.mock('../src/components/chat/blocked-users-list', () => ({ BlockedUsersList: () => null }));
vi.mock('../src/components/settings/account-deletion', () => ({ AccountDeletionSection: () => null }));
it.each([['counselor', '/upload-status'], ['org_admin', '/upload-status'], ['platform_admin', '/admin/upload-status'], ['client', null]] as const)('설정 링크: %s', async (role, to) => {
  useAuthStore.setState({ user: { id: 'u', role, name: 'n', email: 'e@e.test' } as never });
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><SettingsContent /></MemoryRouter>));
  expect(host.querySelector('a[data-upload-status-link]')?.getAttribute('href') ?? null).toBe(to);
  await act(async () => root.unmount());
});
