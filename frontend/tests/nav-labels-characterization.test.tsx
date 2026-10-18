// @vitest-environment jsdom
// SDD-211 T0-FE — 내비 라벨·배지 특성화(현행 동작 박제). 키 전환(T2) 이후에도 이 파일은 수정 없이 통과해야 한다.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { id: 'u1', role: 'counselor', name: '테스트', email: 'a@example.com' } as { id: string; role: string; name: string; email: string } | null,
  sessionInvites: [] as unknown[],
  chatUnread: 0,
  agentUnread: 0,
  reportUnread: 0,
  pendingReview: 0,
}));

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
import type { UserRole } from '../src/lib/api/auth';
import { useCounselorAgentStore } from '../src/stores/agent-counselor-store';

type Entry = [string, string];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.user = { id: 'u1', role: 'counselor', name: '테스트', email: 'a@example.com' };
  state.sessionInvites = [];
  state.chatUnread = 0;
  state.agentUnread = 0;
  state.reportUnread = 0;
  state.pendingReview = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function badgeOf(el: Element): string | null {
  const texts = Array.from(el.querySelectorAll('span.rounded-full')).map((s) => s.textContent ?? '');
  return texts.find((t) => t !== '') ?? null;
}
function sidebarEntries(): Entry[] {
  return Array.from(container.querySelectorAll('nav a')).map((a) => [
    a.getAttribute('href') ?? '',
    a.querySelector('span.flex-1')?.textContent ?? '',
  ]);
}
function sidebarBadges(): Record<string, string | null> {
  return Object.fromEntries(
    Array.from(container.querySelectorAll('nav a')).map((a) => [a.querySelector('span.flex-1')?.textContent ?? '', badgeOf(a)]),
  );
}
function tabItems(): Element[] {
  return Array.from(container.querySelectorAll('nav > a, nav > button'));
}
function tabLabel(el: Element): string {
  return el.lastElementChild?.textContent ?? '';
}
function tabBadges(): Record<string, string | null> {
  return Object.fromEntries(tabItems().map((el) => [tabLabel(el), badgeOf(el)]));
}

async function renderSidebar(props: Parameters<typeof SidebarNav>[0] = {}) {
  await act(async () => root.render(<MemoryRouter><SidebarNav {...props} /></MemoryRouter>));
}
async function renderLayoutTabs(role?: UserRole) {
  await act(async () => root.render(<MemoryRouter><LayoutBottomTabBar onMoreClick={() => undefined} role={role} /></MemoryRouter>));
}
function Probe() {
  const { pathname } = useLocation();
  return <output data-testid="path">{pathname}</output>;
}
async function renderClientTabs() {
  await act(async () => root.render(
    <MemoryRouter initialEntries={['/start']}><ClientBottomTabBar onMoreClick={() => undefined} /><Probe /></MemoryRouter>,
  ));
}

describe('FE-NAV-01 사이드바 라벨·경로 골든(역할 4종)', () => {
  it('상담사', async () => {
    state.user = { id: 'u1', role: 'counselor', name: '테스트', email: 'a@example.com' };
    await renderSidebar();
    expect(sidebarEntries()).toEqual([
      ['/dashboard', '대시보드'], ['/sessions', '클래스'], ['/clients', '내담자'], ['/chat', '채팅'],
      ['/reports', '리포트'], ['/playground', '플레이그라운드'], ['/notifications', '알림'], ['/settings', '설정'],
    ]);
  });
  it('기관 관리자', async () => {
    state.user = { id: 'u2', role: 'org_admin', name: '테스트', email: 'a@example.com' };
    await renderSidebar();
    expect(sidebarEntries()).toEqual([
      ['/dashboard/org', '기관 대시보드'], ['/sessions', '클래스'], ['/clients', '내담자'], ['/chat', '채팅'],
      ['/org/counselors', '상담사'], ['/reports', '리포트'], ['/notifications', '알림'], ['/settings', '설정'],
    ]);
  });
  it('회원', async () => {
    state.user = { id: 'u3', role: 'client', name: '테스트', email: 'a@example.com' };
    await renderSidebar({ role: 'client' });
    expect(sidebarEntries()).toEqual([
      ['/app', '홈'], ['/app/sessions', '클래스'], ['/app/chat', '채팅'], ['/app/reports', '리포트'],
      ['/app/notifications', '알림'], ['/app/profile', '설정'],
    ]);
  });
  it('플랫폼 관리자', async () => {
    state.user = { id: 'u4', role: 'platform_admin', name: '테스트', email: 'a@example.com' };
    await renderSidebar();
    expect(sidebarEntries()).toEqual([
      ['/admin/orgs', '기관 관리'], ['/admin/applications', '가입 신청'], ['/admin/users', '상담사 관리'],
      ['/admin/clients', '회원 관리'], ['/playground', '플레이그라운드'],
    ]);
  });
  it('role=client prop 은 로그인 역할과 무관하게 회원 목록을 쓴다', async () => {
    state.user = { id: 'u1', role: 'counselor', name: '테스트', email: 'a@example.com' };
    await renderSidebar({ role: 'client' });
    expect(sidebarEntries().map(([, label]) => label)).toEqual(['홈', '클래스', '채팅', '리포트', '알림', '설정']);
  });
});

describe('FE-NAV-02 상담사·관리자 하단 탭 라벨·경로 골든', () => {
  const cases: [UserRole | undefined, Entry[]][] = [
    ['counselor', [['/dashboard', '홈'], ['/sessions', '클래스'], ['/chat', '채팅'], ['/reports?status=pending', '리포트']]],
    ['org_admin', [['/dashboard/org', '홈'], ['/sessions', '클래스'], ['/chat', '채팅'], ['/reports?status=pending', '리포트']]],
    ['platform_admin', [['/admin/orgs', '홈'], ['/sessions', '클래스'], ['/chat', '채팅'], ['/reports?status=pending', '리포트']]],
    ['client', [['/app', '홈'], ['/app/sessions', '클래스'], ['/app/chat', '채팅'], ['/app/reports', '리포트']]],
    [undefined, [['/dashboard', '홈'], ['/sessions', '클래스'], ['/chat', '채팅'], ['/reports?status=pending', '리포트']]],
  ];
  for (const [role, expected] of cases) {
    it(`role=${role ?? '미지정'}`, async () => {
      await renderLayoutTabs(role);
      const links = Array.from(container.querySelectorAll('nav > a')).map((a): Entry => [a.getAttribute('href') ?? '', tabLabel(a)]);
      expect(links).toEqual(expected);
      expect(container.querySelector('nav > button')?.textContent).toBe('더보기');
    });
  }
});

describe('FE-NAV-03 회원 하단 탭 라벨·이동 골든', () => {
  it('버튼 라벨과 이동 경로', async () => {
    await renderClientTabs();
    const buttons = Array.from(container.querySelectorAll('nav > button'));
    expect(buttons.map(tabLabel)).toEqual(['홈', '클래스', '채팅', '리포트', '더보기']);
    const expectedPaths = ['/app', '/app/sessions', '/app/chat', '/app/reports'];
    for (const [index, path] of expectedPaths.entries()) {
      await act(async () => { buttons[index].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(container.querySelector('[data-testid="path"]')?.textContent).toBe(path);
    }
  });
});

describe('FE-NAV-05 배지 현행값', () => {
  it('사이드바: 클래스 배지는 sessionBadge prop (0 → 없음, 3 → 3, 10 → 9+)', async () => {
    for (const [count, shown] of [[0, null], [3, '3'], [10, '9+']] as const) {
      await renderSidebar({ sessionBadge: count });
      expect(sidebarBadges()['클래스']).toBe(shown);
    }
  });
  it('사이드바: 알림·리포트·채팅 배지(비상담사: chatBadge + agentBadge)', async () => {
    state.user = { id: 'u2', role: 'org_admin', name: '테스트', email: 'a@example.com' };
    await renderSidebar({ notificationBadge: 12, reportBadge: 2, chatBadge: 1, agentBadge: 2, sessionBadge: 5 });
    expect(sidebarBadges()).toMatchObject({ 알림: '9+', 리포트: '2', 채팅: '3', 클래스: '5', 내담자: null, 설정: null });
  });
  it('사이드바: 상담사 채팅 배지는 chatBadge + 루시 미읽음 + 위험(agentBadge 무시)', async () => {
    state.user = { id: 'u1', role: 'counselor', name: '테스트', email: 'a@example.com' };
    await renderSidebar({ chatBadge: 1, agentBadge: 50 });
    await act(async () => {
      useCounselorAgentStore.getState().setUnread(2);
      useCounselorAgentStore.getState().setOpenRisk(1);
    });
    expect(sidebarBadges()['채팅']).toBe('4');
    await act(async () => {
      useCounselorAgentStore.getState().setUnread(0);
      useCounselorAgentStore.getState().setOpenRisk(0);
    });
    expect(sidebarBadges()['채팅']).toBe('1');
  });
  it('드로어 경로: 알림 배지만 받으면 채팅·리포트·클래스 배지는 0(없음)', async () => {
    state.chatUnread = 5;
    state.reportUnread = 5;
    state.sessionInvites = [1, 2];
    await renderSidebar({ role: 'counselor', notificationBadge: 4 });
    expect(sidebarBadges()).toMatchObject({ 알림: '4', 채팅: null, 리포트: null, 클래스: null });
  });
  it('상담사·관리자 하단 탭: 클래스=sessionInvites.length, 채팅=채팅방 미읽음만, 리포트=역할별', async () => {
    state.sessionInvites = [1, 2, 3];
    state.chatUnread = 4;
    state.agentUnread = 99;
    state.reportUnread = 7;
    state.pendingReview = 2;
    await renderLayoutTabs('counselor');
    expect(tabBadges()).toMatchObject({ 홈: null, 클래스: '3', 채팅: '4', 리포트: '2' });
    await renderLayoutTabs('client');
    expect(tabBadges()).toMatchObject({ 클래스: '3', 채팅: '4', 리포트: '7' });
    state.sessionInvites = new Array(10).fill(0);
    await renderLayoutTabs('org_admin');
    expect(tabBadges()['클래스']).toBe('9+');
    state.sessionInvites = [];
    await renderLayoutTabs('org_admin');
    expect(tabBadges()['클래스']).toBeNull();
  });
  it('회원 하단 탭: 채팅=채팅방+루시 미읽음, 리포트=미열람, 클래스=초대 수', async () => {
    state.sessionInvites = [1];
    state.chatUnread = 4;
    state.agentUnread = 3;
    state.reportUnread = 12;
    await renderClientTabs();
    const badges = Object.fromEntries(
      Array.from(container.querySelectorAll('nav > button')).map((el) => [tabLabel(el), badgeOf(el)]),
    );
    expect(badges).toMatchObject({ 홈: null, 클래스: '1', 채팅: '7', 리포트: '9+', 더보기: null });
  });
});
