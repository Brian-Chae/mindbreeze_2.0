// @vitest-environment jsdom
// SDD-211 T2 — 배지는 라벨이 아니라 키로 결합한다. 용어 사전의 라벨을 바꿔도 배지가 같은 항목에 붙어야 한다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'u1', role: 'org_admin', name: '테스트', email: 'a@example.com' } as { id: string; role: string; name: string; email: string },
  sessionInvites: [1, 2, 3] as unknown[],
  chatUnread: 4,
  agentUnread: 0,
  reportUnread: 6,
  pendingReview: 5,
}));

vi.mock('../src/lib/terms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/terms')>();
  const replaced: Record<string, string> = { class: 'XYZ-클래스', chat: 'XYZ-채팅', report: 'XYZ-리포트', notification: 'XYZ-알림' };
  return { ...actual, term: (key: Parameters<typeof actual.term>[0], area?: Parameters<typeof actual.term>[1]) => replaced[key] ?? actual.term(key, area) };
});
vi.mock('../src/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: typeof state.user; logout: () => Promise<void> }) => unknown) =>
    selector({ user: state.user, logout: async () => undefined }),
}));
vi.mock('../src/stores/notificationStore', () => ({
  useNotificationStore: (selector: (s: { wsConnected: boolean; sessionInvites: unknown[]; unread: number }) => unknown) =>
    selector({ wsConnected: true, sessionInvites: state.sessionInvites, unread: 0 }),
}));
vi.mock('../src/stores/chatStore', () => ({
  useChatStore: (selector: (s: { rooms: { unread_count: number }[] }) => unknown) =>
    selector({ rooms: [{ unread_count: state.chatUnread }] }),
}));
vi.mock('../src/stores/agent-store', () => ({
  useAgentStore: (selector: (s: { unread: number }) => unknown) => selector({ unread: state.agentUnread }),
}));
vi.mock('../src/stores/reportStore', () => ({
  useReportStore: (selector: (s: { unread: number; pendingReview: number }) => unknown) =>
    selector({ unread: state.reportUnread, pendingReview: state.pendingReview }),
}));
vi.mock('../src/lib/api/agent-counselor', () => ({ getUnreadCount: async () => ({ unread: 0 }) }));
vi.mock('../src/lib/api/agent-checkin', () => ({ listCheckinClients: async () => ({ items: [] }) }));

import SidebarNav from '../src/components/layout/SidebarNav';
import LayoutBottomTabBar from '../src/components/layout/BottomTabBar';
import ClientBottomTabBar from '../src/components/client/BottomTabBar';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function badgeOf(el: Element): string | null {
  return Array.from(el.querySelectorAll('span.rounded-full')).map((s) => s.textContent ?? '').find((t) => t !== '') ?? null;
}
function labelOf(el: Element): string {
  return el.querySelector('span.flex-1')?.textContent ?? el.lastElementChild?.textContent ?? '';
}
function byLabel(selector: string): Record<string, string | null> {
  return Object.fromEntries(Array.from(container.querySelectorAll(selector)).map((el) => [labelOf(el), badgeOf(el)]));
}

describe('FE-NAV-06 키-배지 결합: 사전 라벨을 바꿔도 배지는 해당 키 항목에 붙는다', () => {
  it('사이드바', async () => {
    await act(async () => root.render(
      <MemoryRouter><SidebarNav notificationBadge={2} chatBadge={1} reportBadge={3} sessionBadge={4} /></MemoryRouter>,
    ));
    expect(byLabel('nav a')).toMatchObject({
      'XYZ-클래스': '4', 'XYZ-채팅': '1', 'XYZ-리포트': '3', 'XYZ-알림': '2', 내담자: null, 설정: null,
    });
  });
  it('상담사·관리자 하단 탭', async () => {
    await act(async () => root.render(
      <MemoryRouter><LayoutBottomTabBar onMoreClick={() => undefined} role="org_admin" /></MemoryRouter>,
    ));
    expect(byLabel('nav > a')).toMatchObject({ 홈: null, 'XYZ-클래스': '3', 'XYZ-채팅': '4', 'XYZ-리포트': '5' });
  });
  it('회원 하단 탭', async () => {
    await act(async () => root.render(
      <MemoryRouter><ClientBottomTabBar onMoreClick={() => undefined} /></MemoryRouter>,
    ));
    expect(byLabel('nav > button')).toMatchObject({ 홈: null, 'XYZ-클래스': '3', 'XYZ-채팅': '4', 'XYZ-리포트': '6', 더보기: null });
  });
});

describe('FE-NAV-07 드로어 경로', () => {
  it('알림 배지만 전달받으면 채팅·리포트·클래스 배지는 붙지 않는다', async () => {
    await act(async () => root.render(
      <MemoryRouter><SidebarNav role="counselor" notificationBadge={4} /></MemoryRouter>,
    ));
    expect(byLabel('nav a')).toMatchObject({ 'XYZ-알림': '4', 'XYZ-채팅': null, 'XYZ-리포트': null, 'XYZ-클래스': null });
  });
});

describe('FE-NAV-08 라벨 비교식 재도입 방지', () => {
  const FILES = [
    'src/components/layout/SidebarNav.tsx',
    'src/components/layout/BottomTabBar.tsx',
    'src/components/client/BottomTabBar.tsx',
  ];
  for (const file of FILES) {
    it(`${file} 에 label === '문자열' 비교가 없다`, () => {
      const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(source.match(/\blabel\s*===\s*['"]/g) ?? []).toEqual([]);
    });
  }
});
