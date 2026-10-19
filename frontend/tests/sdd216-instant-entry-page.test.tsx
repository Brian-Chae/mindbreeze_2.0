// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api/client';
import { saveEntry, type EnterResult, type EntryStateDto } from '../src/lib/api/class-flow';
import { useAuthStore } from '../src/stores/authStore';
const api = vi.hoisted(() => ({ invited: vi.fn(), state: vi.fn() }));
vi.mock('../src/lib/api/class-flow', async (original) => ({
  ...(await original<typeof import('../src/lib/api/class-flow')>()),
  enterInvitedSession: api.invited, getEntryState: api.state,
}));
vi.mock('../src/hooks/useWaitingRoomPresence', () => ({ useWaitingRoomPresence: () => undefined }));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: () => undefined }));
import EntryPage from '../src/pages/class/EntryPage';
const first = 'a1111111-1111-4111-8111-111111111111';
const second = 'b2222222-2222-4222-8222-222222222222';
function result(sessionId = first): EnterResult {
  return {
    entry_credential: `credential-${sessionId}`, expires_at: null, participant_id: 'p1', is_guest: false, is_waitlisted: false,
    session: {
      id: sessionId, type: 'meditation', custom_type_name: null, status: 'open', host_id: 'h1', scheduled_at: null,
      access_code: null, started_at: null, ended_at: null, duration_min: 50, title: `클래스 ${sessionId}`, notes: null,
      max_participants: 10, location_type: 'offline', location_address: null, participant_mode: 'group', linkband_mode: 'none',
      webrtc_room_id: null, sfu_enabled: false, record_audio: false, record_video: false, created_at: '', participants: [], waitlist_count: 0,
    },
  };
}
function seed(sessionId = first): void {
  saveEntry({ sessionId, credential: `credential-${sessionId}`, expiresAt: null, participantId: 'p1', isGuest: false,
    classInfo: { title: `클래스 ${sessionId}`, hostName: '진행자', scheduledAt: null, startedAt: null, durationMin: 50,
      locationType: 'offline', locationAddress: null, participantMode: 'group', linkbandMode: 'none', maxParticipants: 10, recordAudio: false, recordVideo: false } });
}
let root: Root;
let container: HTMLDivElement;
const text = () => container.textContent ?? '';
async function click(label: string): Promise<void> {
  const button = [...container.querySelectorAll<HTMLElement>('button,a')].find((node) => node.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
function Location() { const location = useLocation(); return <output>{location.pathname + location.search}</output>; }
async function render(): Promise<void> {
  await act(async () => root.render(<MemoryRouter initialEntries={[`/class/${first}/enter`]}>
    <Link to={`/class/${second}/enter`}>다른 회차</Link><Link to="/class/invalid/enter">잘못된 회차</Link>
    <Routes><Route path="/class/:sessionId/enter" element={<EntryPage />} /><Route path="/join" element={<Location />} /><Route path="/login" element={<Location />} /></Routes>
  </MemoryRouter>));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) });
  sessionStorage.clear(); useAuthStore.setState({ isAuthenticated: false, user: null });
  api.invited.mockReset(); api.state.mockReset();
  api.invited.mockRejectedValue(new ApiError(403, '비공개 서버 문구', null));
  api.state.mockImplementation(async (sessionId: string): Promise<EntryStateDto> => ({
    session_id: sessionId, status: 'open', guest_state: 'waiting', in_progress: false, ended: false, participant_id: 'p1',
    is_waitlisted: false, report_included: false, started_at: null, ended_at: null, chat_enabled: false, band_connected: false,
  }));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useAuthStore.setState({ isAuthenticated: false, user: null }); });
describe('즉시 초대 링크 참가 자격 안내', () => {
  it('로그인 없는 이메일 수신자는 코드 입장으로 연결하며 자격 API를 호출하지 않는다', async () => {
    await render();
    expect(text()).toContain('초대 이메일의 참여 코드');
    expect(text()).not.toContain('입장 정보가 만료됐어요');
    await click('코드 입력하기');
    expect(container.querySelector('output')?.textContent).toBe('/join');
    expect(api.invited).not.toHaveBeenCalled(); expect(api.state).not.toHaveBeenCalled();
  });
  it('기존 회원 로그인 경로와 로그인 후 초대 링크를 다시 여는 안내를 제공한다', async () => {
    await render();
    expect(text()).toContain('초대 링크를 다시 열어');
    await click('로그인하기');
    expect(container.querySelector('output')?.textContent).toBe('/login?role=client');
  });
  it('이메일만 지정된 기존 회원도 403이면 코드 입장을 안내하며 참가 자격을 만들지 않는다', async () => {
    useAuthStore.setState({ isAuthenticated: true }); await render();
    expect(text()).toContain('초대 이메일의 참여 코드'); expect(text()).not.toContain('비공개 서버 문구');
    expect(api.invited).toHaveBeenCalledWith(first); expect(api.state).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`mb_entry_${first}`)).toBeNull();
    await click('코드 입력하기'); expect(container.querySelector('output')?.textContent).toBe('/join');
  });
  it('선택된 회원은 서버가 발급한 자격으로 기존 입장 확인을 연다', async () => {
    useAuthStore.setState({ isAuthenticated: true }); api.invited.mockResolvedValue(result()); await render();
    expect(text()).toContain(`클래스 ${first}`); expect(text()).toContain('입장하기');
    expect(api.state).toHaveBeenCalledWith(first, `credential-${first}`);
  });
  it('저장 자격이 있으면 편의 입장을 반복하지 않고 기존 동의 준비 화면을 연다', async () => {
    seed(); await render(); await click('입장하기');
    expect(text()).toContain('시작 전에 확인해 주세요'); expect(api.invited).not.toHaveBeenCalled();
  });
  it('기존 자격의 401은 실제 만료 안내와 저장 자격 삭제를 유지한다', async () => {
    seed(); api.state.mockRejectedValue(new ApiError(401, '비공개', null)); await render();
    expect(text()).toContain('입장 정보가 만료됐어요'); expect(sessionStorage.getItem(`mb_entry_${first}`)).toBeNull();
  });
  it('네트워크 장애는 자격 없음으로 단정하지 않고 초대 확인을 재시도한다', async () => {
    useAuthStore.setState({ isAuthenticated: true }); api.invited.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(result());
    await render(); expect(text()).toContain('네트워크 연결이 끊겼어요');
    await click('다시 연결'); expect(text()).toContain(`클래스 ${first}`); expect(api.invited).toHaveBeenCalledTimes(2);
  });
  it('서버 장애는 오류 안내와 재시도 경로를 제공한다', async () => {
    useAuthStore.setState({ isAuthenticated: true }); api.invited.mockRejectedValueOnce(new ApiError(500, '비공개', null)).mockResolvedValueOnce(result());
    await render(); expect(text()).toContain('잠시 문제가 생겼어요'); await click('다시 시도');
    expect(text()).toContain(`클래스 ${first}`);
  });
  it('다른 회차로 이동하면 이전 자격·준비 단계·클래스 정보를 전달하지 않는다', async () => {
    seed(); await render(); await click('입장하기'); await click('다른 회차');
    expect(text()).not.toContain(`클래스 ${first}`); expect(text()).not.toContain('시작 전에 확인해 주세요');
    expect(api.state).not.toHaveBeenCalledWith(second, `credential-${first}`);
    expect(text()).toContain('초대 이메일의 참여 코드');
  });
  it('잘못된 회차로 이동해도 저장된 다른 회차 자격을 재사용하지 않는다', async () => {
    seed(); await render(); await click('잘못된 회차');
    expect(text()).not.toContain(`클래스 ${first}`); expect(api.state).not.toHaveBeenCalledWith('invalid', `credential-${first}`);
  });
  it('이전 회차의 늦은 초대 응답은 새 화면과 저장소를 덮어쓰지 않는다', async () => {
    let resolveFirst!: (value: EnterResult) => void;
    useAuthStore.setState({ isAuthenticated: true });
    api.invited.mockImplementation((id: string) => id === first ? new Promise<EnterResult>((resolve) => { resolveFirst = resolve; }) : Promise.resolve(result(second)));
    await render(); await click('다른 회차'); await act(async () => resolveFirst(result()));
    expect(text()).toContain(`클래스 ${second}`); expect(text()).not.toContain(`클래스 ${first}`);
    expect(sessionStorage.getItem(`mb_entry_${first}`)).toBeNull();
  });
  it('다른 회차를 반환한 응답과 잘못 연결된 저장 자격을 수용하지 않는다', async () => {
    seed(second); sessionStorage.setItem(`mb_entry_${first}`, sessionStorage.getItem(`mb_entry_${second}`)!);
    useAuthStore.setState({ isAuthenticated: true }); api.invited.mockResolvedValue(result(second)); await render();
    expect(text()).not.toContain(`클래스 ${second}`); expect(api.state).not.toHaveBeenCalled();
  });
});
