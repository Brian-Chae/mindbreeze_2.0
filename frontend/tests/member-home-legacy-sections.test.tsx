// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// SDD-219: 상담 공개(플래그 on) 기준의 기존 동작을 검증한다.
vi.stubEnv('VITE_COUNSELING_ENABLED', 'true');
import { MemberStructureHomePage } from '../src/pages/client/member-structure-home-page';
import { MemberClassesPage } from '../src/pages/client/member-classes-page';
import { useAuthStore } from '../src/stores/authStore';
import { useNotificationStore } from '../src/stores/notificationStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ home: vi.fn(), classes: vi.fn(), sessions: vi.fn(), reports: vi.fn(), rooms: vi.fn(), notifs: vi.fn(), send: vi.fn() }));
vi.mock('../src/hooks/use-class-structure', () => ({ useMixedHome: api.home, useClasses: api.classes, useClassDetail: vi.fn() }));
vi.mock('../src/lib/api/session', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/session')>()), listSessions: api.sessions }));
vi.mock('../src/lib/api/reports', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/reports')>()), listReports: api.reports }));
vi.mock('../src/lib/api/chat', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/chat')>()), listChatRooms: api.rooms, sendChatMessage: api.send }));
vi.mock('../src/lib/api/notifications', async (orig) => ({ ...(await orig<typeof import('../src/lib/api/notifications')>()), listNotifications: api.notifs, markRead: vi.fn() }));
vi.mock('../src/components/class/structure/structure-shell', () => ({
  StructureShell: ({ title, children, rightSlot }: { title: string; children: ReactNode; rightSlot?: ReactNode }) => <main><h1>{title}</h1>{children}{rightSlot}</main>,
}));

const soon = new Date(Date.now() + 3600_000).toISOString();
const session = {
  id: 'inv-1', type: 'meditation', custom_type_name: null, status: 'scheduled', host_id: 'c1', scheduled_at: soon, access_code: null,
  started_at: null, ended_at: null, duration_min: 30, title: '초대받은 호흡 명상', notes: null, max_participants: 5,
  location_type: 'online', location_address: null, participant_mode: 'one_on_one', linkband_mode: 'none', webrtc_room_id: null,
  sfu_enabled: false, record_audio: false, record_video: false, created_at: soon, participants: [], waitlist_count: 0,
};
const classRow = { area: 'meditation', id: 'class-1', title: '호흡 명상', status: 'active', schedule_mode: 'fixed', planned_session_count: 8, progress: { completed: 0, total: 8 }, session_count: 1, has_open_session: false,
  next_session: { id: 'next-3', seq: 3, scheduled_at: '2099-11-20T10:00:00+09:00', status: 'scheduled', host: { id: 'host', name: '김지도' } } };

let cleanup: (() => void) | undefined;
async function render(node: ReactNode, path = '/app') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)); });
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return container;
}
beforeEach(() => {
  vi.clearAllMocks();
  api.home.mockReturnValue({ classes: { status: 'success', data: { classes: [classRow], total: 1 } }, counseling: { status: 'success', data: { relationships: [], total: 0 } }, retry: vi.fn() });
  api.sessions.mockResolvedValue({ sessions: [session], total: 1 });
  api.reports.mockResolvedValue({ reports: [{ id: 'r1', session_id: 'inv-1', user_id: 'u', type: 'client', content: {}, pdf_url: null, sent_at: soon, is_read: false, created_at: soon, session_title: '지난 명상 리포트', session_type: 'meditation', scheduled_at: soon }], total: 1 });
  api.rooms.mockResolvedValue({ rooms: [{ id: 'room-1', room_type: 'direct', name: null, peer_name: '박상담', display_name: '박상담', unread_count: 2, last_message: { content: '안녕하세요 메시지', created_at: soon }, last_message_at: soon }] });
  api.notifs.mockResolvedValue({ notifications: [{ id: 'n1', type: 'x', title: '새 알림 제목', body: null, is_read: false, extra: null, created_at: soon }], total: 1, unread: 1 });
  useAuthStore.setState({ user: { id: 'u', name: '홍길동', counselors: [{ id: 'c1', name: '박상담', profile_image: null }] } as never });
  useNotificationStore.setState({ sessionInvites: [{ sessionId: 'inv-1', notificationId: null }] as never });
});
afterEach(() => cleanup?.());

describe('회원 홈 기존 섹션 복원', () => {
  it('인사말과 기존 8개 영역을 새 히어로와 함께 렌더한다', async () => {
    const view = await render(<MemberStructureHomePage />);
    expect(view.querySelector('h1')?.textContent).toBe('안녕하세요, 홍길동님');
    const heads = [...view.querySelectorAll('h2')].map((h) => h.textContent);
    for (const name of ['초대된 클래스', '이번 주 클래스', '내 리포트', '담당 상담사', '최근 대화', '새 알림', '내 클래스', '내 상담']) expect(heads).toContain(name);
    expect(view.querySelector('[data-testid="enter-with-code"]')?.textContent).toContain('코드로 입장하기');
    expect(view.textContent).toContain('초대받은 호흡 명상');
    expect(view.textContent).toContain('지난 명상 리포트');
    expect(view.textContent).toContain('박상담');
    expect(view.textContent).toContain('안녕하세요 메시지');
    expect(view.textContent).toContain('새 알림 제목');
  });
  it('새 히어로는 class-hero 하나만 있고 클래스명 · N회차를 보여 준다', async () => {
    const view = await render(<MemberStructureHomePage />);
    const heroes = view.querySelectorAll('[data-testid="class-hero"]');
    expect(heroes).toHaveLength(1);
    expect(heroes[0].querySelector('h2.sh-hero__title')?.textContent).toBe('호흡 명상 · 3회차');
    expect(heroes[0].querySelector('.sh-hbox__tx b')).not.toBeNull();
    expect(heroes[0].querySelector('a')?.getAttribute('href')).toBe('/class/next-3/enter');
  });
  it('기존 데이터 조회가 실패해도 새 히어로·내 클래스는 유지하고 오류를 격리한다', async () => {
    api.sessions.mockRejectedValue(new Error('서버 오류 원문'));
    const view = await render(<MemberStructureHomePage />);
    expect(view.querySelector('[data-testid="class-hero"]')).not.toBeNull();
    expect(view.querySelector('a[href="/app/classes/class-1"]')).not.toBeNull();
    expect(view.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });
  it('상담사 미연결 회원도 홈이 열린다', async () => {
    useAuthStore.setState({ user: { id: 'u', name: '홍길동', counselors: [] } as never });
    const view = await render(<MemberStructureHomePage />);
    expect(view.querySelector('h1')?.textContent).toBe('안녕하세요, 홍길동님');
    expect([...view.querySelectorAll('h2')].map((h) => h.textContent)).not.toContain('담당 상담사');
  });
});

describe('내 클래스 신청 진입', () => {
  beforeEach(() => api.classes.mockReturnValue({ state: { status: 'success', data: { classes: [classRow], total: 1 } }, retry: vi.fn() }));
  it('클래스 신청하기를 누르면 상담사를 고르는 신청 시트가 열리고 신청 메시지를 보낸다', async () => {
    const view = await render(<MemberClassesPage />, '/app/classes');
    const button = [...view.querySelectorAll('button')].find((b) => b.textContent?.includes('클래스 신청하기'));
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });
    expect(api.rooms).toHaveBeenCalledTimes(1);
    const send = document.querySelector<HTMLButtonElement>('[data-testid="apply-send"]');
    expect(send?.disabled).toBe(false);
    await act(async () => { send?.click(); });
    expect(api.send).toHaveBeenCalledWith('room-1', { content: '클래스 신청합니다', type: 'system', event_type: 'session_request' });
  });
});
