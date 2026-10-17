// @vitest-environment jsdom
// SDD-209 SH6 — FH04 상담사 클래스 상세: 입장 코드 표시·공유, 준비 현황·다음 할 일, 취소/닫기/삭제 확인 시트
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostDetailView } from '../src/components/class/flow/shell/HostDetailView';
import { toHostDetailData } from '../src/components/class/flow/shell/host-shell-data';
import SessionDetailPage from '../src/pages/sessions/SessionDetailPage';
import {
  deleteSession, duplicateSession, getSession, inviteParticipant, removeParticipant, saveSessionAsTemplate, transitionSession,
  type SessionDto, type SessionParticipant,
} from '../src/lib/api/session';

vi.mock('../src/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/session')>()),
  getSession: vi.fn(), transitionSession: vi.fn(), deleteSession: vi.fn(), duplicateSession: vi.fn(),
  inviteParticipant: vi.fn(), removeParticipant: vi.fn(), saveSessionAsTemplate: vi.fn(),
}));
vi.mock('../src/hooks/useSessionLiveSocket', () => ({ useSessionLiveSocket: () => ({ isReady: false }) }));
vi.mock('../src/components/layout/AppShell', () => ({
  default: ({ children, rightSlot }: { children: ReactNode; rightSlot?: ReactNode }) => <div data-testid="app-shell"><div data-testid="right-slot">{rightSlot}</div>{children}</div>,
}));
vi.mock('../src/components/session/ParticipantPicker', () => ({
  ParticipantPicker: ({ onChange }: { onChange: (s: { userId: string; name: string; email: string }[]) => void }) => (
    <button type="button" data-testid="picker-pick" onClick={() => onChange([{ userId: 'u9', name: '새회원', email: 'n@x.com' }])}>선택</button>
  ),
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

function participant(n: number, over: Partial<SessionParticipant> = {}): SessionParticipant {
  return { user_id: `u${n}`, guest_name: null, is_guest: false, band_connected: false, linkband_device_id: null, webrtc_peer_id: null, consent_audio: false, consent_eeg: false, is_waitlisted: false, waitlist_position: null, user_name: `회원${n}`, ...over };
}
function session(over: Partial<SessionDto> = {}): SessionDto {
  return {
    id: 's1', type: 'meditation', custom_type_name: null, status: 'scheduled', host_id: 'h1', scheduled_at: L(17, 15), access_code: '4827',
    started_at: null, ended_at: null, duration_min: 50, title: '마음챙김 명상 4회차', notes: null, max_participants: 10,
    location_type: 'online', location_address: null, participant_mode: 'group', linkband_mode: 'optional', webrtc_room_id: null,
    sfu_enabled: false, record_audio: true, record_video: true, created_at: L(1, 9),
    participants: [participant(1), participant(2), participant(3)], waitlist_count: 0, ...over,
  } as SessionDto;
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('toHostDetailData', () => {
  it('준비·예정: 코드는 보이되 복사 비활성(열리면 사용), 클래스 취소 행, 장소 수정 가능', () => {
    const d = toHostDetailData(session({ status: 'ready', scheduled_at: null }), { now: NOW });
    expect(d.chip).toBe('ready');
    expect(d.next).toMatchObject({ title: '클래스를 열어 참가자를 맞이해요', cta: '클래스 열기', ctaKind: 'player' });
    expect(d.code).toEqual({ state: 'wait', value: '4827' });
    expect(d.cancelRow).toEqual({ kind: 'cancel', label: '클래스 취소' });
    expect(d.canEditPlace).toBe(true);
    expect(d.inviteText).toBe('초대 3명');
    expect(d.people.total).toBe(3);
    expect(d.people.items[0]).toMatchObject({ name: '회원1', chip: 'invited', removable: true });
  });
  it('입장 가능: 코드 활성, 닫기 행에 회원 수, 이어서 열기', () => {
    const d = toHostDetailData(session({ status: 'open' }), { now: NOW });
    expect(d.code.state).toBe('active');
    expect(d.cancelRow).toEqual({ kind: 'close', label: '클래스 닫기 (회원 3명이 나가요)' });
    expect(d.next.cta).toBe('이어서 열기');
    expect(d.canEditPlace).toBe(false);
  });
  it('진행 중: 클래스 취소 숨김', () => {
    const d = toHostDetailData(session({ status: 'in_progress', started_at: L(17, 11, 48) }), { now: NOW });
    expect(d.cancelRow).toBeNull();
    expect(d.next.title).toBe('12분째 진행 중이에요');
    expect(d.code.state).toBe('active');
  });
  it('완료: 코드 닫힘·링크 복사 없음·기록 보기·초대 불가', () => {
    const d = toHostDetailData(session({ status: 'completed' }), { now: NOW });
    expect(d.code).toEqual({ state: 'closed', value: null });
    expect(d.showLinkCopy).toBe(false);
    expect(d.next).toMatchObject({ cta: '기록 보기', ctaKind: 'record' });
    expect(d.people.canInvite).toBe(false);
    expect(d.people.items[0].removable).toBe(false);
  });
  it('취소: 복제해서 만들기, 삭제 가능', () => {
    const d = toHostDetailData(session({ status: 'cancelled' }), { now: NOW });
    expect(d.next).toMatchObject({ cta: '복제해서 만들기', ctaKind: 'duplicate' });
    expect(d.canDelete).toBe(true);
    expect(d.inviteText).toBe('3명에게 취소 안내를 보냈어요');
  });
  it('삭제는 준비·예정·취소에서만 허용(진행 중·완료 거부)', () => {
    const allowed = (status: SessionDto['status']): boolean => toHostDetailData(session({ status }), { now: NOW }).canDelete;
    expect([allowed('ready'), allowed('scheduled'), allowed('cancelled')]).toEqual([true, true, true]);
    expect([allowed('open'), allowed('in_progress'), allowed('completed')]).toEqual([false, false, false]);
  });
  it('오프라인: 주소·영상 녹화 없음, 정원 가득이면 초대 불가', () => {
    const d = toHostDetailData(session({ location_type: 'offline', location_address: '서울 강남구 테헤란로 152 7층', record_video: false, max_participants: 3 }), { now: NOW });
    expect(d.placeText).toBe('서울 강남구 테헤란로 152 7층');
    expect(d.recordText).toBe('음성 녹음 · AI 분석');
    expect(d.people.full).toBe(true);
    expect(d.people.canInvite).toBe(false);
  });
  it('대기열과 이름 없는 참가자', () => {
    const d = toHostDetailData(session({ participants: [participant(1), participant(2, { is_waitlisted: true, waitlist_position: 2 }), participant(3, { user_name: undefined, user_email: undefined, user_id: null, guest_name: null, is_guest: true })] }), { now: NOW });
    expect(d.people.items.map((p) => p.name)).toEqual(['회원1', '참가자']);
    expect(d.people.waitlist[0]).toMatchObject({ name: '회원2', chip: 'waitlist', waitLabel: '대기 2순위' });
    expect(JSON.stringify(d)).not.toContain('게스트');
  });
  it('이메일 초대 현황: 마스킹된 값·발송 요청 상태·다시 보내기', () => {
    const d = toHostDetailData(session({ status: 'open' }), {
      now: NOW,
      mailInvites: [
        { id: 'm1', maskedEmail: 'se***@…', state: 'requested', cooldownSec: 0 },
        { id: 'm2', maskedEmail: 'ha***@…', state: 'failed', cooldownSec: 0 },
        { id: 'm3', maskedEmail: 'ji***@…', state: 'requested', cooldownSec: 42 },
        { id: 'm4', maskedEmail: null, state: 'requested', cooldownSec: 0 },
      ],
    });
    expect(d.mailInvites.map((m) => [m.email, m.label, m.again])).toEqual([
      ['se***@…', '발송 요청함', 'on'],
      ['ha***@…', '발송하지 못했어요', 'on'],
      ['ji***@…', '발송 요청함', 'wait'],
      ['삭제된 정보', '발송 요청함', 'gone'],
    ]);
    expect(d.mailInvites[2].waitText).toBe('42초 뒤에 다시 보낼 수 있어요');
  });
});

describe('HostDetailView', () => {
  const handlers = () => ({
    onCta: vi.fn(), onCopyCode: vi.fn(), onCopyLink: vi.fn(), onEditPlace: vi.fn(), onRequestAction: vi.fn(),
    onInvite: vi.fn(), onRemove: vi.fn(), onResend: vi.fn(),
  });
  it('열린 클래스: 코드 크게 + 복사 활성, 링크 복사, 닫기 행', async () => {
    const h = handlers();
    await render(<HostDetailView data={toHostDetailData(session({ status: 'open' }), { now: NOW })} {...h} />);
    expect(q('[aria-label="입장 코드 4자리"]')!.textContent).toBe('4827');
    const copy = q<HTMLButtonElement>('[data-testid="copy-code"]')!;
    expect(copy.disabled).toBe(false);
    await act(async () => { copy.click(); });
    expect(h.onCopyCode).toHaveBeenCalledTimes(1);
    await act(async () => { q<HTMLButtonElement>('[data-testid="copy-link"]')!.click(); });
    expect(h.onCopyLink).toHaveBeenCalledTimes(1);
    await act(async () => { q<HTMLButtonElement>('[data-testid="cancel-row"]')!.click(); });
    expect(h.onRequestAction).toHaveBeenCalledWith('close');
    await act(async () => { q<HTMLButtonElement>('[data-testid="detail-cta"]')!.click(); });
    expect(h.onCta).toHaveBeenCalledTimes(1);
  });
  it('열리기 전: 코드는 보이지만 복사는 비활성 + 열리면 사용할 수 있어요', async () => {
    await render(<HostDetailView data={toHostDetailData(session({ status: 'scheduled' }), { now: NOW })} {...handlers()} />);
    expect(q<HTMLButtonElement>('[data-testid="copy-code"]')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('열리면 사용할 수 있어요');
  });
  it('종료·취소: 코드가 닫혔어요, 링크 복사·코드 복사 없음', async () => {
    await render(<HostDetailView data={toHostDetailData(session({ status: 'completed' }), { now: NOW })} {...handlers()} />);
    expect(document.body.textContent).toContain('코드가 닫혔어요');
    expect(q('[data-testid="copy-code"]')).toBeNull();
    expect(q('[data-testid="copy-link"]')).toBeNull();
    expect(q('[data-testid="cancel-row"]')).toBeNull();
  });
  it('참가자 제거·초대, 이메일 초대 다시 보내기(쿨다운 중 비활성)', async () => {
    const h = handlers();
    const data = toHostDetailData(session({ status: 'scheduled' }), {
      now: NOW,
      mailInvites: [{ id: 'm1', maskedEmail: 'se***@…', state: 'requested', cooldownSec: 0 }, { id: 'm3', maskedEmail: 'ji***@…', state: 'requested', cooldownSec: 42 }],
    });
    await render(<HostDetailView data={data} {...h} />);
    await act(async () => { qa<HTMLButtonElement>('[data-testid="remove-participant"]')[0].click(); });
    expect(h.onRemove).toHaveBeenCalledWith('u1');
    await act(async () => { q<HTMLButtonElement>('[data-testid="invite-open"]')!.click(); });
    expect(h.onInvite).toHaveBeenCalledTimes(1);
    const [again, waiting] = qa<HTMLButtonElement>('[data-testid="resend-mail"]');
    expect(again.disabled).toBe(false);
    expect(waiting.disabled).toBe(true);
    await act(async () => { again.click(); });
    expect(h.onResend).toHaveBeenCalledWith('m1');
  });
});

function Probe() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}
async function renderPage(s: SessionDto): Promise<void> {
  vi.mocked(getSession).mockResolvedValue(s);
  await render(
    <MemoryRouter initialEntries={[`/sessions/${s.id}`]}>
      <Routes>
        <Route path="/sessions/:id" element={<><SessionDetailPage /><Probe /></>} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => { await Promise.resolve(); });
}
const click = async (sel: string): Promise<void> => { await act(async () => { q<HTMLButtonElement>(sel)!.click(); }); await act(async () => { await Promise.resolve(); }); };

describe('SessionDetailPage — FH04', () => {
  it('열린 클래스: 코드 복사는 4자리 코드, 링크 복사는 코드를 싣지 않는다', async () => {
    await renderPage(session({ status: 'open' }));
    await click('[data-testid="copy-code"]');
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith('4827');
    await click('[data-testid="copy-link"]');
    const link = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0];
    expect(link).toMatch(/\/join$/);
    expect(link).not.toContain('4827');
  });
  it('CTA: 클래스 열기 → 플레이어(로비), 완료 → 기록 보기', async () => {
    await renderPage(session({ status: 'scheduled' }));
    await click('[data-testid="detail-cta"]');
    expect(q('[data-testid="where"]')!.textContent).toBe('/sessions/s1/player');
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderPage(session({ status: 'completed' }));
    await click('[data-testid="detail-cta"]');
    expect(q('[data-testid="where"]')!.textContent).toBe('/sessions/s1/record');
  });
  it('클래스 취소: window.confirm 없이 확인 시트 → transition cancel', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    vi.mocked(transitionSession).mockResolvedValue(session({ status: 'cancelled' }));
    await renderPage(session({ status: 'scheduled' }));
    await click('[data-testid="cancel-row"]');
    expect(q('[role="dialog"]')!.textContent).toContain('초대한 회원 3명에게 취소 안내가 가요');
    expect(transitionSession).not.toHaveBeenCalled();
    await click('[data-testid="action-confirm"]');
    expect(transitionSession).toHaveBeenCalledWith('s1', 'cancel');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(q('[role="dialog"]')).toBeNull();
  });
  it('유지하기를 누르면 아무 것도 호출하지 않는다', async () => {
    await renderPage(session({ status: 'open' }));
    await click('[data-testid="cancel-row"]');
    expect(q('[role="dialog"]')!.textContent).toContain('클래스를 닫을까요?');
    await click('[data-testid="action-keep"]');
    expect(transitionSession).not.toHaveBeenCalled();
    expect(q('[role="dialog"]')).toBeNull();
  });
  it('더보기 시트: 복제·템플릿 저장·삭제(삭제는 확인 시트를 한 번 더 거친다)', async () => {
    vi.mocked(duplicateSession).mockResolvedValue(session({ id: 's2' }));
    vi.mocked(saveSessionAsTemplate).mockResolvedValue(session());
    vi.mocked(deleteSession).mockResolvedValue(undefined);
    await renderPage(session({ status: 'ready', scheduled_at: null }));
    await click('[data-testid="menu-open"]');
    expect(q('[role="dialog"]')!.textContent).toContain('복제');
    await click('[data-testid="menu-template"]');
    expect(saveSessionAsTemplate).toHaveBeenCalledWith('s1');
    await click('[data-testid="menu-open"]');
    await click('[data-testid="menu-delete"]');
    expect(q('[role="dialog"]')!.textContent).toContain('클래스를 삭제할까요?');
    expect(deleteSession).not.toHaveBeenCalled();
    await click('[data-testid="action-confirm"]');
    expect(deleteSession).toHaveBeenCalledWith('s1');
    expect(q('[data-testid="where"]')!.textContent).toBe('/sessions');
  });
  it('진행 중에는 삭제 메뉴가 없다', async () => {
    await renderPage(session({ status: 'in_progress', started_at: L(17, 11, 48) }));
    await click('[data-testid="menu-open"]');
    expect(q('[data-testid="menu-delete"]')).toBeNull();
    expect(q('[data-testid="cancel-row"]')).toBeNull();
  });
  it('복제 → 새 클래스 상세로 이동', async () => {
    vi.mocked(duplicateSession).mockResolvedValue(session({ id: 's2' }));
    await renderPage(session({ status: 'ready', scheduled_at: null }));
    await click('[data-testid="menu-open"]');
    await click('[data-testid="menu-duplicate"]');
    expect(duplicateSession).toHaveBeenCalledWith('s1');
    expect(q('[data-testid="where"]')!.textContent).toBe('/sessions/s2');
  });
  it('참가자 초대·제거', async () => {
    vi.mocked(inviteParticipant).mockResolvedValue(session());
    vi.mocked(removeParticipant).mockResolvedValue(session());
    await renderPage(session({ status: 'scheduled' }));
    await click('[data-testid="invite-open"]');
    await click('[data-testid="picker-pick"]');
    await click('[data-testid="invite-submit"]');
    expect(inviteParticipant).toHaveBeenCalledWith('s1', 'u9');
    await act(async () => { qa<HTMLButtonElement>('[data-testid="remove-participant"]')[0].click(); });
    await act(async () => { await Promise.resolve(); });
    expect(removeParticipant).toHaveBeenCalledWith('s1', 'u1');
  });
});
