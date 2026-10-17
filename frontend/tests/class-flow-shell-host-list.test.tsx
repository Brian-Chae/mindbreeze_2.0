// @vitest-environment jsdom
// SDD-209 SH5 — FH01 상담사 클래스 목록: 열린 클래스 상단 고정·표→카드·net·시작하기→로비·닫기 확인 시트·useClassList
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassActionSheet } from '../src/components/class/flow/shell/ClassActionSheet';
import { HostClassListView } from '../src/components/class/flow/shell/HostClassListView';
import { buildHostListModel } from '../src/components/class/flow/shell/host-shell-data';
import { useClassList } from '../src/hooks/useClassList';
import SessionListPage from '../src/pages/sessions/SessionListPage';
import { listSessions, transitionSession, type SessionDto } from '../src/lib/api/session';

vi.mock('../src/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/session')>()), listSessions: vi.fn(), transitionSession: vi.fn(),
}));
vi.mock('../src/components/layout/AppShell', () => ({
  default: ({ children, rightSlot }: { children: ReactNode; rightSlot?: ReactNode }) => <div data-testid="app-shell"><div data-testid="right-slot">{rightSlot}</div>{children}</div>,
}));

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const NOW = new Date(2026, 9, 17, 12, 0);
const L = (day: number, hour: number, minute = 0): string => new Date(2026, 9, day, hour, minute).toISOString();

function session(id: string, over: Partial<SessionDto> = {}): SessionDto {
  return {
    id, type: 'meditation', custom_type_name: null, status: 'scheduled', host_id: 'h1', scheduled_at: L(17, 15), access_code: '4827',
    started_at: null, ended_at: null, duration_min: 50, title: `클래스 ${id}`, notes: null, max_participants: 10,
    location_type: 'online', location_address: null, participant_mode: 'group', linkband_mode: 'optional', webrtc_room_id: null,
    sfu_enabled: false, record_audio: true, record_video: true, created_at: L(1, 9),
    participants: [1, 2, 3].map((n) => ({ user_id: `u${n}`, guest_name: null, is_guest: false, band_connected: false, linkband_device_id: null, webrtc_peer_id: null, consent_audio: false, consent_eeg: false, is_waitlisted: false, waitlist_position: null })),
    waitlist_count: 0, ...over,
  } as SessionDto;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('buildHostListModel', () => {
  const list = [
    session('later', { status: 'scheduled', scheduled_at: L(19, 10) }),
    session('today2', { status: 'scheduled', scheduled_at: L(17, 17) }),
    session('free', { status: 'ready', scheduled_at: null }),
    session('open1', { status: 'open', scheduled_at: L(17, 15) }),
    session('done1', { status: 'completed', scheduled_at: L(16, 19) }),
    session('canc1', { status: 'cancelled', scheduled_at: L(15, 16) }),
  ];
  it('열린 클래스가 상단 고정(live), 목록에서는 빠진다', () => {
    const model = buildHostListModel(list, 'upcoming', NOW);
    expect(model.featured).toMatchObject({ kind: 'live', id: 'open1', chip: 'open' });
    expect(model.featured!.waitLabel).toBe('초대 3명');
    expect(model.groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['today2', 'later', 'free']);
    expect(model.groups.map((g) => g.label)).toEqual(['오늘', '10월 19일 (월)', '일정 없음']);
  });
  it('진행 중이 열림보다 우선, 경과 시간 표기', () => {
    const model = buildHostListModel([...list, session('prog', { status: 'in_progress', started_at: L(17, 11, 48), scheduled_at: L(17, 11) })], 'upcoming', NOW);
    expect(model.featured).toMatchObject({ kind: 'live', id: 'prog', chip: 'live' });
    expect(model.featured!.waitLabel).toBe('12분째 · 초대 3명');
  });
  it('열린 게 없으면 가장 임박한 예약이 다음 클래스', () => {
    const model = buildHostListModel(list.filter((s) => s.id !== 'open1'), 'upcoming', NOW);
    expect(model.featured).toMatchObject({ kind: 'next', id: 'today2' });
    expect(model.featured!.hint).toBe('다음 클래스 · 5시간 뒤 시작해요');
    expect(model.groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['later', 'free']);
  });
  it('지난 클래스 탭: 완료·취소 최근 순, 일정 없는 준비는 제외', () => {
    const model = buildHostListModel(list, 'past', NOW);
    expect(model.groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['done1', 'canc1']);
    expect(model.groups[0].items[0]).toMatchObject({ chip: 'done' });
    expect(model.groups[0].label).toBe('어제');
    expect(model.counts).toEqual({ upcoming: 3, past: 2 });
  });
  it('항목: 예정만 클래스 열기 가능, 방식 요약', () => {
    const model = buildHostListModel(list, 'upcoming', NOW);
    const today2 = model.groups[0].items[0];
    expect(today2).toMatchObject({ canOpen: true, sub: '오늘 오후 5:00 · 온라인 그룹' });
    expect(model.groups[2].items[0].sub).toBe('일정 없음 · 온라인 그룹');
  });
  it('비어 있으면 featured null, 그룹 없음', () => {
    const model = buildHostListModel([], 'upcoming', NOW);
    expect(model.featured).toBeNull();
    expect(model.groups).toEqual([]);
  });
});

describe('HostClassListView', () => {
  const model = buildHostListModel([session('open1', { status: 'open' }), session('s2', { status: 'scheduled', scheduled_at: L(18, 10) }), session('d', { status: 'completed', scheduled_at: L(16, 15) })], 'upcoming', NOW);
  const handlers = () => ({ onTab: vi.fn(), onCreate: vi.fn(), onDetail: vi.fn(), onEnterPlayer: vi.fn(), onRequestClose: vi.fn() });
  it('열린 클래스 카드: 이어서 열기·시작하기·클래스 닫기, 탭 2개', async () => {
    const h = handlers();
    await render(<HostClassListView model={model} tab="upcoming" {...h} />);
    const live = q('[data-testid="host-featured"]')!;
    expect(live.textContent).toContain('입장 가능');
    expect(live.textContent).toContain('초대 3명');
    expect(qa('[role="tab"]').map((t) => t.textContent)).toEqual(['예정', '지난 클래스']);
    expect(qa('[role="tab"]')[0].getAttribute('aria-selected')).toBe('true');
    await act(async () => { q<HTMLButtonElement>('[data-testid="featured-continue"]')!.click(); });
    expect(h.onEnterPlayer).toHaveBeenLastCalledWith('open1', 'continue');
    await act(async () => { q<HTMLButtonElement>('[data-testid="featured-start"]')!.click(); });
    expect(h.onEnterPlayer).toHaveBeenLastCalledWith('open1', 'start');
    await act(async () => { q<HTMLButtonElement>('[data-testid="featured-close"]')!.click(); });
    expect(h.onRequestClose).toHaveBeenCalledWith('open1');
    await act(async () => { qa<HTMLButtonElement>('[role="tab"]')[1].click(); });
    expect(h.onTab).toHaveBeenCalledWith('past');
  });
  it('진행 중이면 이어서 열기만', async () => {
    const m = buildHostListModel([session('p', { status: 'in_progress', started_at: L(17, 11, 48) })], 'upcoming', NOW);
    await render(<HostClassListView model={m} tab="upcoming" {...handlers()} />);
    expect(q('[data-testid="featured-continue"]')).not.toBeNull();
    expect(q('[data-testid="featured-start"]')).toBeNull();
    expect(q('[data-testid="featured-close"]')).toBeNull();
  });
  it('목록 항목: 본문 → 상세, 예정 항목의 클래스 열기 → 플레이어', async () => {
    const h = handlers();
    await render(<HostClassListView model={model} tab="upcoming" {...h} />);
    await act(async () => { q<HTMLButtonElement>('.sh-item__main')!.click(); });
    expect(h.onDetail).toHaveBeenCalledWith('s2');
    await act(async () => { q<HTMLButtonElement>('[data-testid="item-open"]')!.click(); });
    expect(h.onEnterPlayer).toHaveBeenLastCalledWith('s2', 'open');
  });
  it('비어 있으면 첫 클래스 만들기 안내 + CTA, net 배너', async () => {
    const h = handlers();
    await render(<HostClassListView model={buildHostListModel([], 'upcoming', NOW)} tab="upcoming" notice="연결이 끊겼어요. 다시 연결되면 자동으로 새로 고쳐요." {...h} />);
    expect(q('[data-testid="host-empty"]')!.textContent).toContain('아직 만든 클래스가 없어요');
    await act(async () => { q<HTMLButtonElement>('[data-testid="host-empty-create"]')!.click(); });
    expect(h.onCreate).toHaveBeenCalledTimes(1);
    expect(q('[role="status"]')!.textContent).toContain('연결이 끊겼어요');
  });
});

describe('ClassActionSheet', () => {
  it('닫기 확인: 회원 N명 안내 + 유지하기/클래스 닫기', async () => {
    const onConfirm = vi.fn(); const onClose = vi.fn();
    await render(<ClassActionSheet kind="close" count={3} onConfirm={onConfirm} onClose={onClose} />);
    const dialog = q('[role="dialog"]')!;
    expect(dialog.getAttribute('data-tone')).toBe('dark');
    expect(dialog.textContent).toContain('클래스를 닫을까요?');
    expect(dialog.textContent).toContain('대기 중인 회원 3명이 모두 나가요');
    await act(async () => { q<HTMLButtonElement>('[data-testid="action-confirm"]')!.click(); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => { q<HTMLButtonElement>('[data-testid="action-keep"]')!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('취소·삭제 문구와 오류 표시', async () => {
    await render(<ClassActionSheet kind="cancel" count={2} onConfirm={() => {}} onClose={() => {}} error="실패했어요" />);
    expect(q('[role="dialog"]')!.textContent).toContain('초대한 회원 2명에게 취소 안내가 가요');
    expect(q('[role="alert"]')!.textContent).toContain('실패했어요');
    await render(<ClassActionSheet kind="delete" count={0} onConfirm={() => {}} onClose={() => {}} />);
    expect(q('[role="dialog"]')!.textContent).toContain('기록과 초대 내역이 모두 사라지고 되돌릴 수 없어요');
  });
});

function Harness({ onState }: { onState: (s: ReturnType<typeof useClassList>) => void }) {
  const state = useClassList({ intervalMs: 30_000 });
  onState(state);
  return null;
}

describe('useClassList', () => {
  it('첫 로딩 → 30초 폴링 → 포커스 시 갱신', async () => {
    vi.useFakeTimers();
    vi.mocked(listSessions).mockResolvedValue({ sessions: [session('a')], total: 1 });
    let state!: ReturnType<typeof useClassList>;
    await render(<Harness onState={(s) => { state = s; }} />);
    await act(async () => { await Promise.resolve(); });
    expect(state.loading).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(listSessions).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); });
    expect(listSessions).toHaveBeenCalledTimes(2);
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    expect(listSessions).toHaveBeenCalledTimes(3);
  });
  it('데이터가 있는 뒤 갱신 실패 → 목록은 유지하고 stale(net)', async () => {
    vi.useFakeTimers();
    vi.mocked(listSessions).mockResolvedValueOnce({ sessions: [session('a')], total: 1 }).mockRejectedValue(new Error('network'));
    let state!: ReturnType<typeof useClassList>;
    await render(<Harness onState={(s) => { state = s; }} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); });
    expect(state.sessions).toHaveLength(1);
    expect(state.stale).toBe(true);
    expect(state.error).toBeNull();
  });
  it('처음부터 실패하면 error', async () => {
    vi.mocked(listSessions).mockRejectedValue(new Error('boom'));
    let state!: ReturnType<typeof useClassList>;
    await render(<Harness onState={(s) => { state = s; }} />);
    await act(async () => { await Promise.resolve(); });
    expect(state.error).toBe('boom');
    expect(state.stale).toBe(false);
  });
});

function Probe() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}{loc.state ? `|${JSON.stringify(loc.state)}` : ''}</div>;
}
async function renderPage(sessions: SessionDto[]): Promise<void> {
  vi.mocked(listSessions).mockResolvedValue({ sessions, total: sessions.length });
  await render(
    <MemoryRouter initialEntries={['/sessions']}>
      <Routes>
        <Route path="/sessions" element={<SessionListPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await Promise.resolve(); });
}

describe('SessionListPage — FH01', () => {
  it('클래스 만들기가 유일한 진입점(예약 만들기 없음) → /sessions/new', async () => {
    await renderPage([session('a')]);
    expect(document.body.textContent).not.toContain('예약 만들기');
    expect(document.body.textContent).not.toContain('즉시 클래스');
    const create = q<HTMLButtonElement>('[data-testid="right-slot"] button')!;
    expect(create.textContent).toContain('클래스 만들기');
    await act(async () => { create.click(); });
    expect(q('[data-testid="where"]')!.textContent).toBe('/sessions/new');
  });
  it('열린 클래스가 목록 필터에서 누락되지 않고 상단에 고정된다', async () => {
    await renderPage([session('s2', { status: 'scheduled', scheduled_at: L(18, 10) }), session('open1', { status: 'open' })]);
    expect(q('[data-testid="host-featured"]')!.textContent).toContain('클래스 open1');
    expect(qa('.sh-item').length).toBe(1);
  });
  it('시작하기 → 플레이어(로비)로 이동하며 의도를 state 로 넘긴다', async () => {
    await renderPage([session('open1', { status: 'open' })]);
    await act(async () => { q<HTMLButtonElement>('[data-testid="featured-start"]')!.click(); });
    expect(q('[data-testid="where"]')!.textContent).toBe('/sessions/open1/player|{"intent":"start"}');
  });
  it('클래스 닫기: 확인 시트를 거쳐 transition 호출(window.confirm 없음)', async () => {
    vi.mocked(transitionSession).mockResolvedValue(session('open1', { status: 'cancelled' }));
    await renderPage([session('open1', { status: 'open' })]);
    await act(async () => { q<HTMLButtonElement>('[data-testid="featured-close"]')!.click(); });
    expect(transitionSession).not.toHaveBeenCalled();
    expect(q('[role="dialog"]')!.textContent).toContain('클래스를 닫을까요?');
    await act(async () => { q<HTMLButtonElement>('[data-testid="action-confirm"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(transitionSession).toHaveBeenCalledWith('open1', 'cancel');
    expect(q('[role="dialog"]')).toBeNull();
  });
});
