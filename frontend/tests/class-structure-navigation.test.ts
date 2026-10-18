// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SidebarNav from '../src/components/layout/SidebarNav';
import HostTabs from '../src/components/layout/BottomTabBar';
import MemberTabs from '../src/components/client/BottomTabBar';
import { term } from '../src/lib/terms';
import { resolveNotificationTarget } from '../src/lib/api/notifications';
import { useAuthStore } from '../src/stores/authStore';
import { useReportStore } from '../src/stores/reportStore';
import { useNotificationStore } from '../src/stores/notificationStore';

const render = (node: ReturnType<typeof createElement>, path = '/classes') => {
  const container = document.createElement('div');
  const root = createRoot(container);
  flushSync(() => root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)));
  const html = container.innerHTML;
  flushSync(() => root.unmount());
  return html;
};

describe('현재 계약 보존', () => {
  it('기존 용어 키와 기본 영역을 보존한다', () => {
    expect(term('class')).toBe('클래스');
    expect(term('client', 'counseling')).toBe('내담자');
    expect(term('org-counselors')).toBe('상담사');
  });
  it('기존 알림과 회원 입장 경로를 보존한다', () => {
    expect(resolveNotificationTarget({ target_type: 'session', target_id: 's' })).toEqual({ path: '/sessions/s' });
    expect(resolveNotificationTarget({ target_type: 'session', target_id: 's', event_type: 'session_started' }, 'client')).toEqual({ path: '/class/s/enter' });
    expect(resolveNotificationTarget({ report_id: 'r' }, 'client')).toEqual({ path: '/app/reports?report=r' });
    expect(resolveNotificationTarget({ room_id: 'c', params: { message_id: 'm' } })).toEqual({ path: '/chat/c?message=m' });
    expect(resolveNotificationTarget({ target_type: 'unknown', target_id: 'x' })).toBeNull();
  });
});

describe('새 내비게이션', () => {
  it('영역별 호칭과 가산 메뉴 키를 제공한다', () => {
    expect(term('counseling')).toBe('상담');
    expect(term('my-class')).toBe('내 클래스');
    expect(term('my-counseling')).toBe('내 상담');
    expect(term('members')).toBe('구성원');
    expect(term('instructor')).toBe('지도사');
    expect(term('instructor', 'counseling')).toBe('상담사');
  });
  it('회원 사이드바는 두 영역을 항상 표시하고 active와 배지를 분리한다', () => {
    const html = render(createElement(SidebarNav, { role: 'client', notificationBadge: 3, sessionBadge: 2 }), '/app/counseling/r');
    expect(html).toContain('href="/app/classes"');
    expect(html).toContain('href="/app/counseling"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/app\/counseling"/);
    expect(html).toContain('내 상담');
    expect(html).not.toContain('/app/sessions');
  });
  it('호스트 메뉴는 홈·명상 클래스·상담을 노출한다', () => {
    const html = render(createElement(SidebarNav));
    expect(html).toContain('href="/classes"');
    expect(html).toContain('href="/counseling"');
    expect(html).not.toContain('href="/clients"');
    expect(html).toContain('명상 클래스');
  });
  it('플랫폼 관리자는 기존 업무 권한을 유지한다', () => {
    const previous = useAuthStore.getState().user;
    useAuthStore.setState({ user: { id: 'admin', role: 'platform_admin', name: '관리자' } as NonNullable<typeof previous> });
    const html = render(createElement(SidebarNav));
    expect(html).toContain('/admin/orgs');
    expect(html).not.toContain('href="/classes"');
    useAuthStore.setState({ user: previous });
  });
  it('호스트 탭은 상담·채팅과 더보기 승인 배지를 표시한다', () => {
    useReportStore.setState({ pendingReview: 4 });
    useNotificationStore.setState({ unread: 2, sessionInvites: [{ sessionId: 's', notificationId: 'n' }] });
    const html = render(createElement(HostTabs, { onMoreClick: () => {}, role: 'org_admin' }));
    expect(html).toContain('/dashboard/org');
    expect(html).toContain('/counseling');
    expect(html).toContain('/chat');
    expect(html).not.toContain('href="/reports');
    expect(html).toContain('더보기 6건');
  });
  it('회원 탭은 내 상담·리포트를 표시하고 채팅을 더보기로 옮긴다', () => {
    const html = render(createElement(MemberTabs, { onMoreClick: () => {} }), '/app/counseling');
    expect(html).toContain('내 클래스');
    expect(html).toContain('내 상담');
    expect(html).toContain('리포트');
    expect(html).not.toContain('>채팅<');
    expect(html).toContain('aria-current="page"');
  });
  it('명시적인 부모 대상만 역할별 URL로 해석한다', () => {
    expect(resolveNotificationTarget({ target_type: 'class', target_id: 'a/b' }, 'client')).toEqual({ path: '/app/classes/a%2Fb' });
    expect(resolveNotificationTarget({ target_type: 'counseling', target_id: 'r' })).toEqual({ path: '/counseling/r' });
    expect(resolveNotificationTarget({ target_type: 'class' })).toBeNull();
    expect(resolveNotificationTarget({ target_type: 'counseling', target_id: ' ' })).toBeNull();
  });
});

describe('읽기 화면 공통 상태', () => {
  it('로딩·빈 목록·오류·404를 구분하고 서버 원문을 노출하지 않는다', async () => {
    const { ReadStateView } = await import('../src/components/class/structure/read-state');
    expect(render(createElement(ReadStateView, { status: 'loading' }))).toContain('불러오는 중');
    expect(render(createElement(ReadStateView, { status: 'empty', area: 'counseling' }))).toContain('아직 상담이 없어요');
    expect(render(createElement(ReadStateView, { status: 'empty' }))).toContain('아직 클래스가 없어요');
    const error = render(createElement(ReadStateView, { status: 'error', onRetry: () => {} }));
    expect(error).toContain('목록을 불러오지 못했어요');
    expect(error).toContain('다시 시도');
    const missing = render(createElement(ReadStateView, { status: 'not_found', backTo: '/app/counseling' }));
    expect(missing).toContain('내용을 찾을 수 없어요');
    expect(missing).toContain('href="/app/counseling"');
  });
  it('재시도 클릭은 콜백을 한 번 실행한다', async () => {
    const { ReadStateView } = await import('../src/components/class/structure/read-state');
    const { vi } = await import('vitest');
    const retry = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    flushSync(() => root.render(createElement(ReadStateView, { status: 'error', onRetry: retry })));
    container.querySelector('button')?.click();
    expect(retry).toHaveBeenCalledTimes(1);
    flushSync(() => root.unmount());
  });
  it('실제 0·false를 누락과 구분한다', async () => {
    const { ReadField } = await import('../src/components/class/structure/read-state');
    expect(render(createElement(ReadField, { value: 0 }))).toContain('0');
    expect(render(createElement(ReadField, { value: false }))).toContain('아니요');
    expect(render(createElement(ReadField, { value: null }))).toContain('데이터 없음');
    expect(render(createElement(ReadField, {}))).toContain('데이터 없음');
  });
  it('공통 상태 문구에 영역별 금지어와 개발 용어가 없다', async () => {
    const { ReadStateView } = await import('../src/components/class/structure/read-state');
    for (const area of ['meditation', 'counseling'] as const) {
      for (const status of ['loading', 'empty', 'error', 'not_found'] as const) {
        const html = render(createElement(ReadStateView, { status, area, onRetry: () => {} }));
        const text = document.createElement('div');
        text.innerHTML = html;
        expect(text.textContent).not.toMatch(/API|DTO|Phase|placeholder|shim|JSON|세션|수업|오픈/);
        if (area === 'counseling') expect(text.textContent).not.toContain('클래스');
      }
    }
  });
});


describe('읽기 전용 셸 선택', () => {
  it('회원·호스트 셸은 opt-in 스타일을 한 번만 적용한다', async () => {
    const { StructureShell } = await import('../src/components/class/structure/structure-shell');
    const { renderToStaticMarkup } = await import('react-dom/server');
    for (const role of ['host', 'member'] as const) {
      const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(StructureShell, { role, title: '상담 일정', area: 'counseling' }, '본문')));
      expect(html.match(/class="cs-structure /g)).toHaveLength(1);
      expect(html).toContain('data-area="counseling"');
      expect(html).toContain('본문');
    }
  });
  it('기존 AppShell 기본값에 새 스타일을 적용하지 않는다', async () => {
    const { default: AppShell } = await import('../src/components/layout/AppShell');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(AppShell, { title: '기존 화면', children: '본문' })));
    expect(html).not.toContain('cs-structure');
  });
});


describe('더보기 상호작용', () => {
  it('더보기로 옮긴 경로는 더보기에 활성 상태를 표시한다', () => {
    const html = render(createElement(HostTabs, { role: 'counselor', onMoreClick: () => {} }), '/reports');
    const element = document.createElement('div');
    element.innerHTML = html;
    expect(element.querySelector('button')?.getAttribute('aria-current')).toBe('page');
    expect(element.querySelector('button')?.className).toContain('text-[#5F0080]');
  });
  it('회원 채팅에서는 내 상담 탭 대신 더보기가 활성화된다', () => {
    const html = render(createElement(MemberTabs, { onMoreClick: () => {} }), '/app/chat/lucy');
    const element = document.createElement('div');
    element.innerHTML = html;
    const buttons = element.querySelectorAll('button');
    expect(buttons[buttons.length - 1].getAttribute('aria-current')).toBe('page');
    expect(buttons[buttons.length - 1].className).toContain('text-[#5F0080]');
    expect([...buttons].filter((button) => button.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });
});

describe('역할 경계 회귀', () => {
  it('기관 관리자는 기존 구성원 관리 경로를 유지한다', () => {
    const previous = useAuthStore.getState().user;
    useAuthStore.setState({ user: { id: 'org', role: 'org_admin', name: '관리자' } as NonNullable<typeof previous> });
    const html = render(createElement(SidebarNav));
    expect(html).toContain('href="/org/counselors"');
    expect(html).toContain('구성원');
    expect(html).toContain('기관 대시보드');
    expect(html).not.toContain('플레이그라운드');
    useAuthStore.setState({ user: previous });
  });
  it('플랫폼 관리자 모바일 내비는 기존 경로를 유지한다', () => {
    const html = render(createElement(HostTabs, { role: 'platform_admin', onMoreClick: () => {} }), '/admin/orgs/example');
    expect(html).toContain('/admin/orgs');
    expect(html).toContain('href="/sessions"');
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/orgs"/);
    expect(html).not.toContain('href="/counseling"');
  });
  it('RoleGuard는 회원·플랫폼 관리자의 호스트 본문을 렌더링하지 않는다', async () => {
    const { RoleGuard } = await import('../src/components/auth/RoleGuard');
    const previous = useAuthStore.getState();
    for (const role of ['client', 'platform_admin', 'counselor', 'org_admin'] as const) {
      useAuthStore.setState({ isAuthenticated: true, isInitialized: true, user: { id: role, role, name: '사용자' } as NonNullable<typeof previous.user> });
      const html = render(createElement(RoleGuard, { role: ['counselor', 'org_admin'], children: '보호된 본문' }));
      expect(html.includes('보호된 본문')).toBe(role === 'counselor' || role === 'org_admin');
    }
    useAuthStore.setState({ isAuthenticated: false });
    expect(render(createElement(RoleGuard, { role: 'counselor', children: '보호된 본문' }))).not.toContain('보호된 본문');
    useAuthStore.setState(previous);
  });
});
