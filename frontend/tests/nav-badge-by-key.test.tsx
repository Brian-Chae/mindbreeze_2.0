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
  notificationUnread: 0,
  swapChatReport: false,
}));

vi.mock('../src/lib/terms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/terms')>();
  const replaced: Record<string, string> = {
    class: 'XYZ-클래스', 'meditation-class': 'XYZ-명상 클래스', counseling: 'XYZ-상담',
    'my-class': 'XYZ-내 클래스', 'my-counseling': 'XYZ-내 상담',
    members: 'XYZ-구성원', more: 'XYZ-더보기',
    chat: 'XYZ-채팅', report: 'XYZ-리포트', notification: 'XYZ-알림',
  };
  return { ...actual, term: (key: Parameters<typeof actual.term>[0], area?: Parameters<typeof actual.term>[1]) => {
    if (state.swapChatReport && key === 'chat') return replaced.report;
    if (state.swapChatReport && key === 'report') return replaced.chat;
    return replaced[key] ?? actual.term(key, area);
  } };
});
vi.mock('../src/stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: typeof state.user; logout: () => Promise<void> }) => unknown) =>
    selector({ user: state.user, logout: async () => undefined }),
}));
vi.mock('../src/stores/notificationStore', () => ({
  useNotificationStore: (selector: (s: { wsConnected: boolean; sessionInvites: unknown[]; unread: number }) => unknown) =>
    selector({ wsConnected: true, sessionInvites: state.sessionInvites, unread: state.notificationUnread }),
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
  state.user = { id: 'u1', role: 'org_admin', name: '테스트', email: 'a@example.com' };
  state.sessionInvites = [1, 2, 3];
  state.chatUnread = 4;
  state.agentUnread = 0;
  state.reportUnread = 6;
  state.pendingReview = 5;
  state.notificationUnread = 0;
  state.swapChatReport = false;
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
  return el.querySelector('span.flex-1')?.textContent ?? el.querySelector(':scope > span:not([class])')?.textContent ?? '';
}
function byLabel(selector: string): Record<string, string | null> {
  return Object.fromEntries(Array.from(container.querySelectorAll(selector)).map((el) => [labelOf(el), badgeOf(el)]));
}

describe('FE-NAV-06 키-배지 결합: 사전 라벨을 바꿔도 배지는 해당 키 항목에 붙는다', () => {
  it('사이드바', async () => {
    await act(async () => root.render(
      <MemoryRouter><SidebarNav notificationBadge={2} chatBadge={1} reportBadge={3} sessionBadge={4} /></MemoryRouter>,
    ));
    expect(byLabel('nav a')).toEqual({
      '기관 대시보드': null, 'XYZ-명상 클래스': null, 'XYZ-상담': null,
      'XYZ-채팅': '1', 'XYZ-구성원': null, 'XYZ-리포트': '3', 'XYZ-알림': '4', 설정: null,
    });
  });
  it('상담사·관리자 하단 탭', async () => {
    await act(async () => root.render(
      <MemoryRouter><LayoutBottomTabBar onMoreClick={() => undefined} role="org_admin" /></MemoryRouter>,
    ));
    expect(byLabel('nav > a, nav > button')).toEqual({ 홈: null, 'XYZ-클래스': null, 'XYZ-상담': null, 'XYZ-채팅': '4', 'XYZ-더보기': '8' });
    expect(container.querySelector('nav > button')?.getAttribute('aria-label')).toBe('더보기 8건');
  });
  it('회원 하단 탭', async () => {
    await act(async () => root.render(
      <MemoryRouter><ClientBottomTabBar onMoreClick={() => undefined} /></MemoryRouter>,
    ));
    expect(byLabel('nav > button')).toEqual({ 홈: null, 'XYZ-내 클래스': null, 'XYZ-내 상담': null, 'XYZ-리포트': '6', 'XYZ-더보기': '7' });
    expect(container.querySelector('button[aria-label="더보기 7건"]')).not.toBeNull();
  });
});

describe('FE-NAV-07 드로어 경로', () => {
  it('알림과 승인 대기 리포트가 라벨 변경 후에도 올바른 링크에 붙는다', async () => {
    await act(async () => root.render(
      <MemoryRouter><SidebarNav role="counselor" notificationBadge={4} /></MemoryRouter>,
    ));
    expect(byLabel('nav a')).toEqual({
      '기관 대시보드': null, 'XYZ-명상 클래스': null, 'XYZ-상담': null,
      'XYZ-채팅': null, 'XYZ-구성원': null, 'XYZ-리포트': '5', 'XYZ-알림': '4', 설정: null,
    });
  });
});

describe('라벨 교환 회귀', () => {
  it('채팅·리포트 라벨을 서로 바꿔도 배지는 경로의 키를 따른다', async () => {
    state.swapChatReport = true;
    await act(async () => root.render(
      <MemoryRouter><SidebarNav chatBadge={2} reportBadge={7} notificationBadge={3} /></MemoryRouter>,
    ));
    const chat = container.querySelector('a[href="/chat"]');
    const report = container.querySelector('a[href="/reports"]');
    expect(chat).not.toBeNull();
    expect(report).not.toBeNull();
    expect(labelOf(chat!)).toBe('XYZ-리포트');
    expect(badgeOf(chat!)).toBe('2');
    expect(labelOf(report!)).toBe('XYZ-채팅');
    expect(badgeOf(report!)).toBe('7');
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
