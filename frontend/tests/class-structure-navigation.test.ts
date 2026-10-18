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
    expect(html).toContain('더보기 7건');
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
