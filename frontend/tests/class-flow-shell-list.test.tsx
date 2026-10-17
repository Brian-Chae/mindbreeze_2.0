// @vitest-environment jsdom
// SDD-209 SH3 — FM02 회원 클래스 목록: 입장 가능 최상단·카드 정보 축소·이중 렌더 제거·신청 바텀 시트
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplySheet } from '../src/components/class/flow/shell/ApplySheet';
import { MemberClassListView } from '../src/components/class/flow/shell/MemberClassListView';
import { buildClassSections } from '../src/components/class/flow/shell/shell-data';
import ClientSessionListPage from '../src/pages/client/ClientSessionListPage';
import { listSessions, type SessionDto } from '../src/lib/api/session';
import { listChatRooms, sendChatMessage, type ChatRoom } from '../src/lib/api/chat';
import { useNotificationStore } from '../src/stores/notificationStore';

vi.mock('../src/lib/api/session', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api/session')>()), listSessions: vi.fn() }));
vi.mock('../src/lib/api/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/chat')>()), listChatRooms: vi.fn(), sendChatMessage: vi.fn(),
}));
vi.mock('../src/lib/api/notifications', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/api/notifications')>()), markRead: vi.fn() }));

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const NOW = new Date(2026, 9, 17, 12, 0);
const L = (day: number, hour: number, minute = 0): string => new Date(2026, 9, day, hour, minute).toISOString();

function session(id: string, over: Partial<SessionDto> & { host_name?: string } = {}): SessionDto {
  return {
    id, type: 'meditation', custom_type_name: null, status: 'scheduled', host_id: 'h1', scheduled_at: L(20, 15), access_code: '4827',
    started_at: null, ended_at: null, duration_min: 50, title: `클래스 ${id}`, notes: null, max_participants: 10,
    location_type: 'online', location_address: null, participant_mode: 'group', linkband_mode: 'optional', webrtc_room_id: null,
    sfu_enabled: false, record_audio: true, record_video: true, created_at: L(1, 9), participants: [], waitlist_count: 0,
    ...over,
  } as SessionDto;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useNotificationStore.setState({ sessionInvites: [] });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('buildClassSections', () => {
  const list = [
    session('past-done', { status: 'completed', scheduled_at: L(16, 15) }),
    session('sch-late', { status: 'scheduled', scheduled_at: L(24, 20) }),
    session('open1', { status: 'open', scheduled_at: L(17, 15) }),
    session('sch-soon', { status: 'scheduled', scheduled_at: L(18, 10) }),
    session('inv1', { status: 'scheduled', scheduled_at: L(23, 14), host_name: '박서연' }),
    session('live1', { status: 'in_progress', scheduled_at: L(17, 11), started_at: L(17, 11, 48) }),
    session('ready1', { status: 'ready', scheduled_at: null }),
    session('canc', { status: 'cancelled', scheduled_at: L(19, 15) }),
  ];
  it('입장 가능 → 초대받은 → 예정 → 지난 순, 빈 섹션은 생략', () => {
    const sections = buildClassSections(list, new Set(['inv1']), NOW);
    expect(sections.map((s) => s.key)).toEqual(['enterable', 'invited', 'upcoming', 'past']);
    expect(sections[0].entries.map((e) => e.data.id)).toEqual(['live1', 'open1']);
    expect(sections[1].entries.map((e) => e.data.id)).toEqual(['inv1']);
    expect(sections[2].entries.map((e) => e.data.id)).toEqual(['sch-soon', 'sch-late', 'ready1']);
    expect(sections[3].entries.map((e) => e.data.id)).toEqual(['canc', 'past-done']);
    expect(buildClassSections([], new Set(), NOW)).toEqual([]);
  });
  it('입장 가능 카드는 강조 + 입장하기, 초대 카드는 클래스 확인 + 초대한 상담사', () => {
    const sections = buildClassSections(list, new Set(['inv1']), NOW);
    expect(sections[0].entries[0]).toMatchObject({ highlight: true, action: { label: '입장하기', kind: 'enter' } });
    expect(sections[1].entries[0]).toMatchObject({ chip: 'invited', action: { label: '클래스 확인', kind: 'confirm' } });
    expect(sections[1].entries[0].data.subLine).toBe('박서연 상담사가 초대했어요');
    expect(sections[2].entries[0].action).toBeUndefined();
  });
  it('이미 입장 가능한 초대 클래스는 초대 섹션에 중복하지 않는다', () => {
    const sections = buildClassSections([session('o', { status: 'open' })], new Set(['o']), NOW);
    expect(sections.map((s) => s.key)).toEqual(['enterable']);
  });
});

describe('MemberClassListView', () => {
  it('섹션 제목·개수·카드, 입장하기/클래스 확인 액션', async () => {
    const onOpen = vi.fn(); const onEnter = vi.fn(); const onConfirm = vi.fn();
    const sections = buildClassSections([session('open1', { status: 'open' }), session('inv1', { host_name: '박서연' })], new Set(['inv1']), NOW);
    await render(<MemberClassListView sections={sections} onOpen={onOpen} onEnter={onEnter} onConfirmInvite={onConfirm} />);
    const titles = qa('.sh-sec h2').map((e) => e.textContent);
    expect(titles).toEqual(['지금 입장할 수 있어요', '초대받은 클래스']);
    expect(qa('[data-testid="class-card"]')).toHaveLength(2);
    const [enterBtn, confirmBtn] = qa<HTMLButtonElement>('[data-testid="class-card-action"]');
    await act(async () => { enterBtn.click(); });
    expect(onEnter).toHaveBeenCalledWith('open1');
    await act(async () => { confirmBtn.click(); });
    expect(onConfirm).toHaveBeenCalledWith('inv1');
    await act(async () => { qa<HTMLButtonElement>('.sh-ccard__main')[0].click(); });
    expect(onOpen).toHaveBeenCalledWith('open1');
  });
  it('클래스가 하나도 없으면 안내 한 칸', async () => {
    await render(<MemberClassListView sections={[]} onOpen={() => {}} onEnter={() => {}} onConfirmInvite={() => {}} />);
    expect(q('[data-testid="empty-row"]')!.textContent).toContain('아직 예정된 클래스가 없어요');
  });
});

describe('ApplySheet', () => {
  const options = [{ id: 'r1', name: '김하늘 상담사' }, { id: 'r2', name: '박서연 상담사' }];
  it('상담사 라디오 선택 → 신청 메시지 보내기', async () => {
    const onSelect = vi.fn(); const onSend = vi.fn();
    await render(<ApplySheet open options={options} selectedId="r1" onSelect={onSelect} onSend={onSend} onClose={() => {}} />);
    const radios = qa('[role="radio"]');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(q('[role="radiogroup"]')).not.toBeNull();
    await act(async () => { radios[1].click(); });
    expect(onSelect).toHaveBeenCalledWith('r2');
    await act(async () => { q<HTMLButtonElement>('[data-testid="apply-send"]')!.click(); });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(q('[role="dialog"]')!.textContent).toContain('클래스 신청하기');
  });
  it('채팅방이 없으면 안내, 불러오기 실패면 다시 시도', async () => {
    const onRetry = vi.fn();
    await render(<ApplySheet open options={[]} selectedId={null} onSelect={() => {}} onSend={() => {}} onClose={() => {}} />);
    expect(q('[role="dialog"]')!.textContent).toContain('연결된 상담사 채팅방이 없어요');
    expect(q<HTMLButtonElement>('[data-testid="apply-send"]')!.disabled).toBe(true);
    await render(<ApplySheet open options={[]} selectedId={null} loadError="불러오지 못했어요" onRetry={onRetry} onSelect={() => {}} onSend={() => {}} onClose={() => {}} />);
    await act(async () => { q<HTMLButtonElement>('[data-testid="apply-retry"]')!.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

function Probe() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}
async function renderPage(sessions: SessionDto[], entry: string | { pathname: string; state: unknown } = '/app/sessions'): Promise<void> {
  vi.mocked(listSessions).mockResolvedValue({ sessions, total: sessions.length });
  vi.mocked(listChatRooms).mockResolvedValue({ rooms: [{ id: 'r1', room_type: 'direct', peer_name: '김하늘 상담사', name: '김하늘' } as unknown as ChatRoom] });
  vi.mocked(sendChatMessage).mockResolvedValue({} as never);
  await render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/app/sessions" element={<ClientSessionListPage />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await Promise.resolve(); });
}

describe('ClientSessionListPage — FM02', () => {
  it('입장 가능 클래스가 맨 위, 같은 클래스는 한 번만 그린다(이중 렌더 없음)', async () => {
    await renderPage([session('a', { status: 'scheduled', scheduled_at: L(20, 15), title: '예정 하나' }), session('b', { status: 'open', title: '열린 하나' })]);
    const cards = qa('[data-testid="class-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('열린 하나');
    expect(qa('.sh-sec h2').map((e) => e.textContent)).toEqual(['지금 입장할 수 있어요', '예정된 클래스']);
    expect(document.body.textContent!.match(/예정 하나/g)).toHaveLength(1);
  });
  it('카드에 입장 코드 값·클래스 코드 라벨이 없다', async () => {
    await renderPage([session('b', { status: 'open' })]);
    expect(document.body.textContent).not.toContain('4827');
    expect(document.body.textContent).not.toContain('클래스 코드');
  });
  it('카드 본문 → 상세, 입장하기 → 상세', async () => {
    await renderPage([session('b', { status: 'open' })]);
    await act(async () => { qa<HTMLButtonElement>('.sh-ccard__main')[0].click(); });
    expect(q('[data-testid="where"]')!.textContent).toBe('/app/sessions/b');
  });
  it('신청 시트: 이벤트로 열고 상담사에게 신청 메시지를 보낸다', async () => {
    await renderPage([session('a')]);
    await act(async () => { window.dispatchEvent(new CustomEvent('open-session-request')); });
    await act(async () => { await Promise.resolve(); });
    expect(q('[role="dialog"]')!.textContent).toContain('김하늘 상담사');
    await act(async () => { q<HTMLButtonElement>('[data-testid="apply-send"]')!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(sendChatMessage).toHaveBeenCalledWith('r1', { content: '클래스 신청합니다', type: 'system', event_type: 'session_request' });
    expect(q('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain('클래스 신청을 보냈어요');
  });
  it('홈의 신청 진입(state.openApply)이면 시트가 바로 열린다', async () => {
    await renderPage([], { pathname: '/app/sessions', state: { openApply: true } });
    await act(async () => { await Promise.resolve(); });
    expect(q('[role="dialog"]')).not.toBeNull();
  });
});
