// @vitest-environment jsdom
// SDD-215 — 역할별 새 메뉴·경로와 더보기로 이동한 배지 계약을 고정한다.
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// SDD-219: 상담 공개(플래그 on) 기준의 기존 동작을 검증한다.
vi.stubEnv('VITE_COUNSELING_ENABLED', 'true');
// SDD-220: 이 테스트는 AI 공개(on) 계약을 검증한다 — 기본값이 off 로 바뀌어 모듈 수준에서 켠다(단언 불변).
vi.stubEnv('VITE_AI_ENABLED', 'true');
vi.stubEnv('VITE_STT_ENABLED', 'true'); // SDD-228: 받아쓰기 on 계약

const state = vi.hoisted(() => ({
  user: { id: 'u1', role: 'counselor', name: '테스트', email: 'a@example.com' } as { id: string; role: string; name: string; email: string } | null,
  sessionInvites: [] as unknown[],
  chatUnread: 0,
  agentUnread: 0,
  reportUnread: 0,
  pendingReview: 0,
  notificationUnread: 0,
}));

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
import MobileDrawer from '../src/components/layout/MobileDrawer';
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
  state.notificationUnread = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function badgeOf(el: Element): string | null {
  const texts = Array.from(el.querySelectorAll('span.rounded-full, .floating-bottom-nav__badge')).map((s) => s.textContent ?? '');
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
  return el.querySelector(':scope > span:not([class])')?.textContent ?? '';
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
      ['/dashboard', '홈'], ['/classes', '명상 클래스'], ['/clients', '회원'], ['/counseling', '상담'], ['/chat', '채팅'],
      ['/reports', '리포트'], ['/playground', '플레이그라운드'], ['/notifications', '알림'], ['/settings', '설정'],
    ]);
  });
  it('기관 관리자', async () => {
    state.user = { id: 'u2', role: 'org_admin', name: '테스트', email: 'a@example.com' };
    await renderSidebar();
    expect(sidebarEntries()).toEqual([
      ['/dashboard/org', '기관 대시보드'], ['/classes', '명상 클래스'], ['/clients', '회원'], ['/counseling', '상담'], ['/chat', '채팅'],
      ['/org/counselors', '구성원'], ['/reports', '리포트'], ['/org/data-center', '데이터 센터'], ['/notifications', '알림'], ['/settings', '설정'],
    ]);
  });
  it('회원', async () => {
    state.user = { id: 'u3', role: 'client', name: '테스트', email: 'a@example.com' };
    await renderSidebar({ role: 'client' });
    expect(sidebarEntries()).toEqual([
      ['/app', '홈'], ['/app/classes', '내 클래스'], ['/app/counseling', '내 상담'], ['/app/chat', '채팅'], ['/app/reports', '리포트'],
      ['/app/notifications', '알림'], ['/app/profile', '설정'],
    ]);
  });
  it('플랫폼 관리자', async () => {
    state.user = { id: 'u4', role: 'platform_admin', name: '테스트', email: 'a@example.com' };
    await renderSidebar();
    expect(sidebarEntries()).toEqual([
      ['/chat', '채팅'], ['/admin/data-center', '데이터 센터'], ['/notifications', '알림'], ['/settings', '설정'],
      ['/admin/orgs', '기관 관리'], ['/admin/applications', '가입 신청'], ['/admin/users', '상담사 관리'],
      ['/admin/clients', '회원 관리'], ['/admin/chat-reports', '채팅 신고'], ['/playground', '플레이그라운드'],
    ]);
  });
  it('role=client prop 은 로그인 역할과 무관하게 회원 목록을 쓴다', async () => {
    state.user = { id: 'u1', role: 'counselor', name: '테스트', email: 'a@example.com' };
    await renderSidebar({ role: 'client' });
    expect(sidebarEntries().map(([, label]) => label)).toEqual(['홈', '내 클래스', '내 상담', '채팅', '리포트', '알림', '설정']);
  });
});

describe('FE-NAV-02 상담사·관리자 하단 탭 라벨·경로 골든', () => {
  const cases: [UserRole | undefined, Entry[]][] = [
    ['counselor', [['/dashboard', '홈'], ['/classes', '클래스'], ['/counseling', '상담'], ['/chat', '대화']]],
    ['org_admin', [['/dashboard/org', '홈'], ['/classes', '클래스'], ['/counseling', '상담'], ['/chat', '대화']]],
    ['platform_admin', [['/admin/orgs', '홈'], ['/admin/applications', '가입 신청'], ['/admin/users', '사용자'], ['/chat', '대화']]],
    ['client', [['/app', '홈'], ['/app/classes', '내 클래스'], ['/app/counseling', '상담'], ['/app/reports', '리포트']]],
    [undefined, [['/dashboard', '홈'], ['/classes', '클래스'], ['/counseling', '상담'], ['/chat', '대화']]],
  ];
  for (const [role, expected] of cases) {
    it(`role=${role ?? '미지정'}`, async () => {
      await renderLayoutTabs(role);
      const links = Array.from(container.querySelectorAll('nav > a')).map((a): Entry => [a.getAttribute('href') ?? '', tabLabel(a)]);
      expect(links).toEqual([...expected, [role === 'client' ? '/app/profile' : '/settings', '설정']]);
      expect(container.querySelector('nav > button')).toBeNull();
    });
  }
});

describe('FE-NAV-03 회원 하단 탭 라벨·이동 골든', () => {
  it('버튼 라벨과 이동 경로', async () => {
    await renderClientTabs();
    const buttons = Array.from(container.querySelectorAll('nav > a, nav > button'));
    expect(buttons.map(tabLabel)).toEqual(['홈', '내 클래스', '상담', '리포트', '설정']);
    const expectedPaths = ['/app', '/app/classes', '/app/counseling', '/app/reports', '/app/profile'];
    for (const [index, path] of expectedPaths.entries()) {
      await act(async () => { buttons[index].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
      expect(container.querySelector('[data-testid="path"]')?.textContent).toBe(path);
    }
  });
});

describe('FE-NAV-05 배지 현행값', () => {
  it('사이드바: 영역 미확인 초대는 알림에만 표시한다(0·3·10)', async () => {
    for (const [count, shown] of [[0, null], [3, '3'], [10, '9+']] as const) {
      await renderSidebar({ sessionBadge: count });
      expect(sidebarBadges()['알림']).toBe(shown);
      expect(sidebarBadges()['명상 클래스']).toBeNull();
      expect(sidebarBadges()['상담']).toBeNull();
    }
  });
  it('사이드바: 알림·리포트·채팅 배지(비상담사: chatBadge + agentBadge)', async () => {
    state.user = { id: 'u2', role: 'org_admin', name: '테스트', email: 'a@example.com' };
    await renderSidebar({ notificationBadge: 12, reportBadge: 2, chatBadge: 1, agentBadge: 2, sessionBadge: 5 });
    expect(sidebarBadges()).toEqual({ '데이터 센터': null, '기관 대시보드': null, '명상 클래스': null, 회원: null, 상담: null, 채팅: '3', 구성원: null, 리포트: '2', 알림: '9+', 설정: null });
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
  it('드로어 경로: 승인 대기 리포트는 공유 저장소에서 읽는다', async () => {
    state.chatUnread = 5;
    state.reportUnread = 5;
    state.pendingReview = 2;
    state.sessionInvites = [1, 2];
    await renderSidebar({ role: 'counselor', notificationBadge: 4 });
    expect(sidebarBadges()).toEqual({ 홈: null, '명상 클래스': null, 회원: null, 상담: null, 채팅: null, 리포트: '2', 플레이그라운드: null, 알림: '4', 설정: null });
  });
  it('상담사·관리자 하단 탭: 업무 배지를 설정에 붙이지 않는다', async () => {
    state.sessionInvites = [1, 2, 3];
    state.notificationUnread = 4;
    state.chatUnread = 4;
    state.agentUnread = 99;
    state.reportUnread = 7;
    state.pendingReview = 2;
    await renderLayoutTabs('counselor');
    expect(tabBadges()).toEqual({ 홈: null, 클래스: null, 상담: null, 대화: '4', 설정: null });
    expect(container.querySelector('a[href="/settings"]')?.getAttribute('aria-label')).toBe('설정');
    await renderLayoutTabs('client');
    expect(tabBadges()).toEqual({ 홈: null, '내 클래스': null, 상담: null, 리포트: '7', 설정: null });
    state.sessionInvites = new Array(10).fill(0);
    await renderLayoutTabs('org_admin');
    expect(tabBadges()).toEqual({ 홈: null, 클래스: null, 상담: null, 대화: '4', 설정: null });
    expect(container.querySelector('a[href="/settings"]')?.getAttribute('aria-label')).toBe('설정');
    state.sessionInvites = [];
    state.notificationUnread = 0;
    state.pendingReview = 0;
    await renderLayoutTabs('org_admin');
    expect(tabBadges()).toEqual({ 홈: null, 클래스: null, 상담: null, 대화: '4', 설정: null });
  });
  it('회원 하단 탭: 리포트는 미열람, 설정은 업무 배지 없음', async () => {
    state.sessionInvites = [1];
    state.chatUnread = 4;
    state.agentUnread = 3;
    state.reportUnread = 12;
    await renderClientTabs();
    const badges = Object.fromEntries(
      Array.from(container.querySelectorAll('nav > a, nav > button')).map((el) => [tabLabel(el), badgeOf(el)]),
    );
    expect(badges).toEqual({ 홈: null, '내 클래스': null, 상담: null, 리포트: '9+', 설정: null });
  });
});


function NavigationWithMore({ member = false }: { member?: boolean }) {
  const [open, setOpen] = useState(false);
  return <>
    <button aria-label="메뉴 열기" onClick={() => setOpen(true)}>전체 메뉴</button>
    {member
      ? <ClientBottomTabBar onMoreClick={() => setOpen(true)} />
      : <LayoutBottomTabBar role="counselor" onMoreClick={() => setOpen(true)} />}
    <MobileDrawer open={open} onClose={() => setOpen(false)} role={member ? 'client' : 'counselor'} />
    <Probe />
  </>;
}

describe('전체 메뉴 실제 접근과 역할별 리포트 배지', () => {
  for (const member of [false, true]) {
    it(`${member ? '회원' : '호스트'}: 전체 메뉴에서 리포트·알림·설정으로 이동하고 드로어를 닫는다`, async () => {
      state.pendingReview = 2;
      state.reportUnread = 5;
      state.notificationUnread = 3;
      const destinations: Entry[] = member
        ? [['/app/reports', '리포트'], ['/app/notifications', '알림'], ['/app/profile', '설정']]
        : [['/reports', '리포트'], ['/notifications', '알림'], ['/settings', '설정']];
      await act(async () => root.render(<MemoryRouter><NavigationWithMore member={member} /></MemoryRouter>));
      for (const [path, label] of destinations) {
        const more = container.querySelector('button[aria-label="메뉴 열기"]');
        expect(more).not.toBeNull();
        await act(async () => more!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
        const drawer = container.querySelector('aside[aria-hidden="false"]');
        expect(drawer).not.toBeNull();
        const link = drawer!.querySelector(`a[href="${path}"]`);
        expect(link?.querySelector('span.flex-1')?.textContent).toBe(label);
        if (label === '리포트') expect(badgeOf(link!)).toBe(member ? '5' : '2');
        if (label === '알림') expect(badgeOf(link!)).toBe('3');
        await act(async () => link!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
        expect(container.querySelector('[data-testid="path"]')?.textContent).toBe(path);
        expect(container.querySelector('aside')?.getAttribute('aria-hidden')).toBe('true');
      }
    });
  }
  it('회원 리포트 기본 배지는 미열람 수이고 명시적 0은 저장소 값으로 대체하지 않는다', async () => {
    state.reportUnread = 5;
    state.pendingReview = 2;
    await renderSidebar({ role: 'client' });
    expect(sidebarBadges()).toEqual({ 홈: null, '내 클래스': null, '내 상담': null, 채팅: null, 리포트: '5', 알림: null, 설정: null });
    await renderSidebar({ role: 'client', reportBadge: 0 });
    expect(sidebarBadges()).toEqual({ 홈: null, '내 클래스': null, '내 상담': null, 채팅: null, 리포트: null, 알림: null, 설정: null });
  });
});

it('데이터 센터에는 기관·플랫폼 관리자의 리포트 배지를 복제하지 않는다',async()=>{
 for(const role of ['org_admin','platform_admin']){
  state.user={id:'admin',role,name:'테스트',email:'admin@example.invalid'};
  await renderSidebar({reportBadge:7});
  expect(sidebarBadges()['데이터 센터']).toBeNull();
  if(role==='org_admin')expect(sidebarBadges()['리포트']).toBe('7');
 }
});
