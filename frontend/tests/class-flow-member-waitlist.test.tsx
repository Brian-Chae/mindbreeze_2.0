// @vitest-environment jsdom
// SDD-209 M7 — FM08 대기열(정원 초과) · 대기 취소 확인 시트 · 승격 시 자동 진행
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WaitlistView, type WaitlistViewProps } from '../src/components/class/flow/member/WaitlistView';
import { ApiError } from '../src/lib/api/client';
import { saveEntry, type EntryStateDto } from '../src/lib/api/class-flow';

const getEntryState = vi.fn();
const cancelWaitlist = vi.fn();
vi.mock('../src/lib/api/class-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow')>()),
  getEntryState: (...a: unknown[]) => getEntryState(...a),
  cancelWaitlist: (...a: unknown[]) => cancelWaitlist(...a),
}));
vi.mock('../src/hooks/useBandStep', () => ({
  useBandStep: () => ({ state: 'idle', leadOff: null, battery: 80, connect: vi.fn(), disconnect: vi.fn() }),
}));

import EntryPage from '../src/pages/class/EntryPage';

let root: Root;
let container: HTMLDivElement;
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];
const text = (): string => document.body.textContent ?? '';
const btn = (label: string): HTMLButtonElement | undefined => qa<HTMLButtonElement>('button').find((b) => (b.textContent ?? '').trim() === label);
const noop = (): void => undefined;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  getEntryState.mockReset();
  cancelWaitlist.mockReset();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function props(over: Partial<WaitlistViewProps> = {}): WaitlistViewProps {
  return {
    place: 'online', title: '마음챙김 명상 · 4회차', hostName: '채용욱', whenLabel: '오늘 오후 3:00', placeName: null,
    cancelOpen: false, cancelling: false, cancelError: null,
    onAskCancel: noop, onKeepWaiting: noop, onConfirmCancel: noop, ...over,
  };
}

describe('FM08 화면', () => {
  it('온라인: 문구·정보 3줄·알림 안내·대기 취소, 순번·순위 표현 없음', async () => {
    await render(<WaitlistView {...props()} />);
    expect(text()).toContain('지금은 자리가 가득 찼어요');
    expect(text()).toContain('자리가 나면 자동으로 입장해요.');
    expect(text()).toContain('이 화면을 열어 둬 주세요.');
    expect(qa('.fm-finfo span').map((e) => e.textContent)).toEqual(['클래스', '진행자', '시작']);
    expect(text()).toContain('채용욱');
    expect(text()).toContain('오늘 오후 3:00');
    expect(text()).toContain('자리가 나면 알림으로 알려 드려요.');
    expect(btn('대기 취소')).toBeDefined();
    expect(text()).not.toMatch(/\d+번째|순번|순위|대기 \d+명/);
  });
  it('오프라인: 현장 문구, 진행자 대신 장소, 알림 안내 없음', async () => {
    await render(<WaitlistView {...props({ place: 'offline', placeName: '5층 명상실' })} />);
    expect(text()).toContain('현장 자리가 가득 찼어요');
    expect(text()).toContain('자리가 나면 이 화면에서 알려 드려요.');
    expect(text()).toContain('가까운 곳에서 잠시 기다려 주세요.');
    expect(qa('.fm-finfo span').map((e) => e.textContent)).toEqual(['클래스', '장소', '시작']);
    expect(text()).toContain('5층 명상실');
    expect(text()).not.toContain('알림으로 알려 드려요');
  });
  it('대기 취소 확인 시트: 문구·파괴 동작·계속 대기하기. 버튼으로 요청하기 전까지 취소 호출 없음', async () => {
    const onAskCancel = vi.fn();
    const onKeepWaiting = vi.fn();
    const onConfirmCancel = vi.fn();
    await render(<WaitlistView {...props({ onAskCancel, onKeepWaiting, onConfirmCancel })} />);
    await act(async () => { btn('대기 취소')!.click(); });
    expect(onAskCancel).toHaveBeenCalledTimes(1);
    expect(onConfirmCancel).not.toHaveBeenCalled();
    await render(<WaitlistView {...props({ cancelOpen: true, onAskCancel, onKeepWaiting, onConfirmCancel })} />);
    expect(text()).toContain('대기를 취소할까요?');
    expect(text()).toContain('취소하면 자리가 나도 자동으로 입장하지 않아요. 다시 대기할 수 있어요.');
    const confirm = qa<HTMLButtonElement>('[data-pz="flow-sheet"] button').find((b) => b.textContent === '대기 취소')!;
    expect(confirm.getAttribute('data-kind')).toBe('danger');
    await act(async () => { btn('계속 대기하기')!.click(); });
    expect(onKeepWaiting).toHaveBeenCalledTimes(1);
    expect(onConfirmCancel).not.toHaveBeenCalled();
    await act(async () => { confirm.click(); });
    expect(onConfirmCancel).toHaveBeenCalledTimes(1);
  });
  it('취소 실패 문구와 진행 중 비활성', async () => {
    await render(<WaitlistView {...props({ cancelOpen: true, cancelError: '대기를 취소하지 못했어요. 잠시 후 다시 시도해 주세요.' })} />);
    expect(qa('[role="alert"]').map((e) => e.textContent)).toEqual(['대기를 취소하지 못했어요. 잠시 후 다시 시도해 주세요.']);
    await render(<WaitlistView {...props({ cancelOpen: true, cancelling: true })} />);
    const confirm = qa<HTMLButtonElement>('[data-pz="flow-sheet"] button').find((b) => b.textContent === '대기 취소')!;
    expect(confirm.disabled).toBe(true);
  });
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function stateDto(over: Partial<EntryStateDto> = {}): EntryStateDto {
  return {
    session_id: 's1', status: 'open', guest_state: 'waiting', in_progress: false, ended: false, participant_id: 'p1',
    is_waitlisted: true, report_included: false, started_at: null, ended_at: null, chat_enabled: false, band_connected: false, ...over,
  };
}

function seed(): void {
  saveEntry({
    sessionId: 's1', credential: 'cred', expiresAt: null, participantId: 'p1', isGuest: true,
    classInfo: {
      title: '마음챙김 명상', hostName: '채용욱', scheduledAt: null, startedAt: null, durationMin: 50, locationType: 'online',
      locationAddress: null, participantMode: 'group', linkbandMode: 'optional', maxParticipants: 10, recordAudio: true, recordVideo: true,
    },
  });
}

function renderPage(): Promise<void> {
  return render(
    <MemoryRouter initialEntries={['/class/s1/enter']}>
      <Routes>
        <Route path="/class/:sessionId/enter" element={<EntryPage />} />
        <Route path="/join" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('EntryPage — 대기열 (M7)', () => {
  it('정원 초과(is_waitlisted)면 준비 마법사를 건너뛰고 FM08', async () => {
    seed();
    getEntryState.mockResolvedValue(stateDto());
    await renderPage();
    expect(text()).toContain('지금은 자리가 가득 찼어요');
    expect(text()).not.toContain('시작 전에 확인해 주세요');
  });
  it('대기 취소: 시트에서 확인해야 waitlist/cancel 1회(입장 자격), 성공하면 입장 자격을 지우고 FM04(/join)로', async () => {
    seed();
    getEntryState.mockResolvedValue(stateDto());
    cancelWaitlist.mockResolvedValue({ participant_id: 'p1', cancelled: true, changed: true });
    await renderPage();
    await act(async () => { btn('대기 취소')!.click(); });
    expect(cancelWaitlist).not.toHaveBeenCalled();
    await act(async () => { qa<HTMLButtonElement>('[data-pz="flow-sheet"] button').find((b) => b.textContent === '대기 취소')!.click(); });
    expect(cancelWaitlist).toHaveBeenCalledTimes(1);
    expect(cancelWaitlist).toHaveBeenCalledWith('s1', 'cred');
    expect(window.sessionStorage.getItem('mb_entry_s1')).toBeNull();
    expect(document.querySelector('[data-testid="where"]')?.textContent).toBe('/join');
  });
  it('시트를 닫거나 계속 대기하기는 서버 호출이 없다', async () => {
    seed();
    getEntryState.mockResolvedValue(stateDto());
    await renderPage();
    await act(async () => { btn('대기 취소')!.click(); });
    await act(async () => { btn('계속 대기하기')!.click(); });
    expect(cancelWaitlist).not.toHaveBeenCalled();
    expect(text()).toContain('지금은 자리가 가득 찼어요');
    expect(window.sessionStorage.getItem('mb_entry_s1')).not.toBeNull();
  });
  it('취소 요청이 실패하면 안내하고 대기를 유지한다', async () => {
    seed();
    getEntryState.mockResolvedValue(stateDto());
    cancelWaitlist.mockRejectedValue(new ApiError(500, '서버 원문', null));
    await renderPage();
    await act(async () => { btn('대기 취소')!.click(); });
    await act(async () => { qa<HTMLButtonElement>('[data-pz="flow-sheet"] button').find((b) => b.textContent === '대기 취소')!.click(); });
    expect(text()).toContain('대기를 취소하지 못했어요. 잠시 후 다시 시도해 주세요.');
    expect(text()).not.toContain('서버 원문');
    expect(window.sessionStorage.getItem('mb_entry_s1')).not.toBeNull();
  });
  it('승격(is_waitlisted true→false)을 감지하면 자동으로 준비 첫 단계로 진행한다', async () => {
    seed();
    getEntryState.mockResolvedValue(stateDto());
    await renderPage();
    expect(text()).toContain('지금은 자리가 가득 찼어요');
    getEntryState.mockResolvedValue(stateDto({ is_waitlisted: false }));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(text()).toContain('시작 전에 확인해 주세요');
  });
});
