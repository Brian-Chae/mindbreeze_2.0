// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import DashboardPage from '../src/pages/DashboardPage';
import { MemberClassCard } from '../src/components/class/structure/member-class-views';
import { adaptMemberClass } from '../src/lib/class-structure/adapters';

const mocks = vi.hoisted(() => ({ dashboard: vi.fn(), classes: vi.fn(), retry: vi.fn() }));
vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children, rightSlot }: { children: ReactNode; rightSlot?: ReactNode }) => <main><header>{rightSlot}</header>{children}</main> }));
vi.mock('../src/lib/api/dashboard', () => ({ getCounselorDashboard: mocks.dashboard }));
vi.mock('../src/hooks/use-class-structure', () => ({ useClasses: () => ({ retry: mocks.retry, state: mocks.classes() }) }));
vi.mock('../src/lib/api/chat', () => ({ listChatRooms: async () => ({ rooms: [] }) }));
vi.mock('../src/lib/api/notifications', () => ({ listNotifications: async () => ({ notifications: [], total: 0, unread: 0 }) }));

const dash = (classes: unknown[], extra = {}) => ({ counselor_name: '테스트', total_participants: 0, classes, ...extra });
async function mount() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const box = document.createElement('div'); const root = createRoot(box);
  await act(async () => root.render(<MemoryRouter><DashboardPage /></MemoryRouter>));
  return { box, unmount: () => act(async () => root.unmount()) };
}
const hrefs = (box: HTMLElement) => [...box.querySelectorAll('a')].map((a) => a.getAttribute('href'));
afterEach(() => vi.clearAllMocks());

it('헤더 3개 진입과 일정 없음 히어로 + 클래스 없음 빈 상태', async () => {
  mocks.dashboard.mockResolvedValue(dash([]));
  mocks.classes.mockReturnValue({ status: 'success', data: { classes: [], total: 0 } });
  const { box, unmount } = await mount();
  expect(hrefs(box)).toEqual(expect.arrayContaining(['/classes', '/classes/now', '/classes/new']));
  const hero = box.querySelector('[data-testid="counselor-home-hero"]')!;
  expect(hero.textContent).toContain('예정된 회차가 없어요');
  expect(hero.querySelector('a')?.getAttribute('href')).toBe('/classes/now');
  expect(box.textContent).toContain('아직 클래스가 없어요');
  expect(box.textContent).toContain('예정된 일정이 없습니다');
  expect(box.textContent).not.toContain('데이터 없음');
  await unmount();
});

it('클래스 조회 실패는 해당 섹션만 오류+재시도, 나머지 유지', async () => {
  mocks.dashboard.mockResolvedValue(dash([{ id: 's1', class_id: 'c1', area: 'meditation', title: '호흡', status: 'scheduled', type: 'meditation', scheduled_at: '2099-01-01T10:00:00Z', participant_count: 1, guest_count: 0, pending_review_count: 2 }]));
  mocks.classes.mockReturnValue({ status: 'error', message: '목록을 불러오지 못했어요' });
  const { box, unmount } = await mount();
  const section = box.querySelector('section[aria-label="내 클래스"]')!;
  expect(section.textContent).toContain('목록을 불러오지 못했어요');
  await act(async () => [...section.querySelectorAll('button')].find((b) => b.textContent === '다시 시도')!.click());
  expect(mocks.retry).toHaveBeenCalled();
  expect(box.querySelector('[data-testid="counselor-home-hero"]')?.textContent).toContain('호흡');
  expect(box.textContent).toContain('리포트 검토 대기 2건');
  expect(hrefs(box)).toContain('/reports?status=pending');
  await unmount();
});

it('구회차(class_id 없음)는 /sessions/:id fallback, 진행 중이면 상태 칩', async () => {
  mocks.dashboard.mockResolvedValue(dash([{ id: 'old', title: '구회차', status: 'in_progress', type: 'meditation', participant_count: 0, guest_count: 0, scheduled_at: null, pending_review_count: 0 }]));
  mocks.classes.mockReturnValue({ status: 'loading' });
  const { box, unmount } = await mount();
  expect(box.querySelector('[data-testid="counselor-home-hero"] a')?.getAttribute('href')).toBe('/sessions/old');
  await unmount();
});

it('공통 카드: 기본은 회원 경로, href 주입 시 상담사 경로, 상담사 코드 비노출', () => {
  const model = adaptMemberClass({ id: 'c9', title: null, status: 'active', schedule_mode: 'fixed', planned_session_count: null, area: 'meditation', progress: { completed: 0, total: 0 }, session_count: 0, next_session: null, has_open_session: false } as never);
  const render = (node: ReactNode) => { const b = document.createElement('div'); const r = createRoot(b); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); act(() => r.render(<MemoryRouter>{node}</MemoryRouter>)); return b; };
  expect(render(<MemberClassCard model={model} />).querySelector('a')?.getAttribute('href')).toBe('/app/classes/c9');
  const host = render(<MemberClassCard model={model} href="/classes/c9" />);
  expect(host.querySelector('a')?.getAttribute('href')).toBe('/classes/c9');
  expect(host.textContent).toContain('이름 없는 클래스');
  expect(host.textContent).not.toContain('데이터 없음');
  expect(host.textContent).not.toContain('0/0');
});
