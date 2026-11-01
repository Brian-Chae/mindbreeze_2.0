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
vi.mock('../src/components/chat/blocked-users-list', () => ({ BlockedUsersList: () => <p>차단 목록</p> }));
vi.mock('../src/components/settings/account-deletion', () => ({ AccountDeletionSection: () => null }));
afterEach(() => vi.restoreAllMocks());
it.each(['client', 'counselor', 'org_admin', 'platform_admin'] as const)('%s는 6그룹(client 8그룹, 차단한 사용자 포함)·플레이그라운드·로그아웃 진입을 가진다', async (role) => {
  useAuthStore.setState({ user: { id: 'sample', role, name: '샘플', email: 'sample@example.test' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> });
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<MemoryRouter><SettingsContent /></MemoryRouter>));
  expect(host.querySelectorAll('[data-settings-group]')).toHaveLength(role === 'client' ? 8 : 6); // SDD-256 상담사 관리 + SDD-262 내 데이터 저장 현황: client 만 추가
  expect(host.textContent).toContain('차단한 사용자');
  expect(host.textContent?.includes('내 데이터 저장 현황')).toBe(role === 'client');
  expect(host.querySelector('a[href="/app/profile/upload-status"]') !== null).toBe(role === 'client');
  expect(host.textContent?.includes('코치 관리')).toBe(role === 'client');
  expect(host.querySelector('a[href="/playground"]')).not.toBeNull();
  expect(host.textContent).toContain('로그아웃');
  expect(host.querySelector('a[href="/reports?settings=operations"]') !== null).toBe(role === 'counselor' || role === 'org_admin');
  await act(async () => root.unmount());
});
