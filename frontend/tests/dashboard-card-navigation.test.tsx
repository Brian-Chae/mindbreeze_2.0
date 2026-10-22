// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import DashboardPage from '../src/pages/DashboardPage';
vi.mock('../src/components/layout/AppShell', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../src/lib/api/dashboard', () => ({ getCounselorDashboard: async () => ({ counselor_name: '테스트', total_participants: 3, in_progress_classes: 1, pending_review_count: 1, classes: [{ id: 's1', class_id: 'c1', area: 'meditation', title: '호흡 수업', status: 'open', type: 'meditation', scheduled_at: '2099-01-01T10:00:00Z', participant_count: 3, guest_count: 0, access_code: 'ABC123', has_record: true }] }) }));
vi.mock('../src/hooks/use-class-structure', () => ({ useClasses: () => ({ retry: vi.fn(), state: { status: 'success', data: { total: 1, classes: [{ id: 'c1', title: '호흡 수업', status: 'active', schedule_mode: 'fixed', planned_session_count: 4, area: 'meditation', progress: { completed: 1, total: 4 }, session_count: 4, next_session: { id: 's1', seq: 2, scheduled_at: '2099-01-01T10:00:00Z', status: 'scheduled', host: { name: '김지도' } }, has_open_session: true }] } } }) }));
vi.mock('../src/lib/api/chat', () => ({ listChatRooms: async () => ({ rooms: [{ id: 'room1', display_name: '회원 대화' }] }) }));
vi.mock('../src/lib/api/notifications', () => ({ listNotifications: async () => ({ notifications: [{ id: 'n1', title: '수업 알림', is_read: false, created_at: '2026-01-01' }] }) }));

it('일정·요약·알림 전체가 링크이며 클래스 보조 동작과 링크가 중첩되지 않는다', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter><DashboardPage /></MemoryRouter>));
    const section = (title: string) => [...container.querySelectorAll('section')].find(s => s.querySelector('h2')?.textContent === title)!;
    const schedule = section('오늘 · 다가오는 일정').querySelector('a')!;
    expect(schedule.getAttribute('href')).toBe('/classes/c1/sessions/s1');
    expect(schedule.parentElement?.textContent).toContain('참여 3명');
    for (const [label, path] of [['회차 상세 →', '/classes/c1/sessions/s1'], ['리포트 검토 →', '/reports?status=pending'], ['일정 보기 →', '/classes'], ['회원 관리 →', '/clients']]) {
      const link = [...container.querySelectorAll('a')].find(a => a.textContent?.includes(label));
      expect(link?.getAttribute('href')).toBe(path);
    }
    expect(section('새 알림').querySelector('a')?.textContent).toBe('전체');
    // SDD-221: 알림 행은 읽음 처리 후 대상 화면으로 이동하는 버튼
    expect([...section('새 알림').querySelectorAll('button')].some(b => b.textContent?.includes('수업 알림'))).toBe(true);
    // SDD-232: 내 클래스 카드는 부모 클래스 1장, 상담사 경로 /classes/:id
    const cardLink = section('내 클래스').querySelector('a.mc-card-link');
    expect(cardLink?.getAttribute('href')).toBe('/classes/c1');
    expect(cardLink?.textContent).toContain('호흡 수업');
    // 히어로: 회차 상세 보기만(입장/시작 버튼 없음)
    const hero = container.querySelector('[data-testid="counselor-home-hero"] a');
    expect(hero?.textContent).toBe('회차 상세 보기');
    expect(hero?.getAttribute('href')).toBe('/classes/c1/sessions/s1');
    expect([...container.querySelectorAll('button')].some(b => b.textContent === '입장')).toBe(false);
    // 헤더 기능 유지는 AppShell mock 으로 렌더되지 않으므로 별도 검증(verify A1)
    expect(container.querySelector('a a, a button, button a')).toBeNull();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const copy = [...section('오늘 · 다가오는 일정').querySelectorAll('button')].find(b => b.textContent === '복사');
    await act(async () => copy?.click());
    expect(writeText).toHaveBeenCalledWith('ABC123');
    expect(copy?.textContent).toBe('복사됨');
    expect([...container.querySelectorAll('a')].some(a => ['/sessions', '/sessions/new'].includes(a.getAttribute('href') ?? ''))).toBe(false);
  } finally { await act(async () => root.unmount()); }
});
