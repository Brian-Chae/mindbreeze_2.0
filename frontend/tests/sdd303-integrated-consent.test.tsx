// @vitest-environment jsdom
// SDD-303 — 실제 입장 페이지의 서버 저장·밴드 경계.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, ApiError } from '../src/lib/api/client';
import { loadEntry, saveEntry, type StoredEntry } from '../src/lib/api/class-flow';
import { readBandSkip } from '../src/lib/class/flow/band-skip';
import { useAuthStore } from '../src/stores/authStore';

const band = vi.hoisted(() => ({ enabled: [] as boolean[], state: 'idle', connect: vi.fn(), hold: [] as { want: { eegConsent: boolean; bandDone: boolean } }[] }));
vi.mock('../src/hooks/useBandStep', () => ({ useBandStep: (enabled: boolean) => { band.enabled.push(enabled); return { state: band.state, leadOff: null, battery: 80, connect: band.connect, disconnect: vi.fn() }; } }));
vi.mock('../src/hooks/useWaitingRoomPresence', () => ({ useWaitingRoomPresence: () => undefined }));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: () => undefined }));
vi.mock('../src/lib/measurement-web/use-native-band-hold', () => ({ holdEnvironment: () => ({ native: true, platform: 'android', v2: true }), useNativeBandHold: (value: typeof band.hold[number]) => { band.hold.push(value); } }));
vi.mock('../src/lib/session-live/use-live-v2', () => ({ useLiveV2: () => ({ ready: false, state: null, client: null }) }));
import EntryPage from '../src/pages/class/EntryPage';

let root: Root;
let container: HTMLDivElement;
let consents: { participant_id: string; recording_consented: boolean; recording_notice_version: string | null; eeg_collection_consented: boolean | null; eeg_notice_version: string | null };
let research: { participant_id: string; consented: boolean; notice_version: string | null };
let report = false;
const entry = (over: Partial<StoredEntry> = {}): StoredEntry => ({
  sessionId: 's1', credential: 'cred', expiresAt: null, participantId: 'p1', isGuest: false,
  classInfo: { title: '함께 쉬어가는 명상', hostName: '코치', scheduledAt: null, startedAt: null, durationMin: 50, locationType: 'offline', locationAddress: null, participantMode: 'group', linkbandMode: 'optional', maxParticipants: 10, recordAudio: true, recordVideo: false, sessionType: 'meditation' }, ...over,
});
const state = () => ({ session_id: 's1', participant_id: 'p1', status: 'open', is_waitlisted: false, report_included: report, started_at: null, ended_at: null, chat_enabled: false, band_connected: false });
const boxes = () => [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const box = (name: string) => { const el = container.querySelector<HTMLInputElement>(`input[data-consent="${name}"]`); expect(el, `${name} 체크박스`).not.toBeNull(); return el!; };
const button = (label: string) => { const el = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label); expect(el, label).toBeDefined(); return el!; };
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };
async function renderPage(seed = true, over: Partial<StoredEntry> = {}) { if (seed) saveEntry(entry(over)); await act(async () => root.render(<MemoryRouter initialEntries={['/class/s1/enter']}><Routes><Route path="/class/:sessionId/enter" element={<EntryPage />} /></Routes></MemoryRouter>)); }
// SDD-303: 열린 회차는 입장하기 탭 없이 동의 화면으로 자동 진입한다.
async function openConsent(over: Partial<StoredEntry> = {}) { await renderPage(true, over); }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  sessionStorage.clear(); localStorage.clear(); band.enabled = []; band.hold = []; band.state = 'idle'; band.connect.mockReset();
  useAuthStore.setState({ isAuthenticated: true, user: null });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) });
  consents = { participant_id: 'p1', recording_consented: true, recording_notice_version: 'rec-1', eeg_collection_consented: null, eeg_notice_version: null };
  research = { participant_id: 'p1', consented: false, notice_version: 'r5-2' }; report = false;
  vi.spyOn(apiClient, 'get').mockImplementation(async (path) => {
    if (path.includes('/entry/consents')) return consents as never;
    if (path.includes('/research-consent')) return research as never;
    if (path.includes('/entry-state')) return state() as never;
    throw new Error(`예상하지 않은 GET ${path}`);
  });
  vi.spyOn(apiClient, 'put').mockResolvedValue({} as never);
  vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('예상하지 않은 POST'));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); useAuthStore.setState({ isAuthenticated: false, user: null }); });

describe('통합 동의와 실제 저장', () => {
  it('전체/부분 선택을 동기화하고 개별 선택만으로 서버에 쓰지 않는다', async () => {
    await openConsent(); expect(boxes()).toHaveLength(5); expect(box('all').indeterminate).toBe(true);
    await click(box('all')); expect(boxes().every(el => el.checked)).toBe(true);
    await click(box('research')); expect(box('all').indeterminate).toBe(true); expect(apiClient.put).not.toHaveBeenCalled();
    await click(box('required')); expect(button('동의하고 계속하기').disabled).toBe(true);
  });
  it('필수만 제출하면 EEG false 저장 후 설문 없이 밴드 없이 대기실로 간다', async () => {
    await openConsent(); await click(button('동의하고 계속하기'));
    expect(apiClient.put).toHaveBeenCalledWith('/sessions/s1/report-choice', { participant_id: 'p1', report_included: false, notice_acknowledged: true, notice_version: 'class-team-v1' }, expect.objectContaining({ headers: { 'X-Entry-Credential': 'cred' } }));
    expect(apiClient.put).toHaveBeenCalledWith('/sessions/s1/entry/eeg-consent', { consented: false, notice_version: 'eeg-1' }, expect.anything());
    expect(container.textContent).not.toContain('지금 집중은 어떤가요?');
    expect(readBandSkip('s1')).toBe(true); expect(band.enabled).toEqual([]); expect(band.connect).not.toHaveBeenCalled();
    expect(band.hold.at(-1)?.want).toMatchObject({ eegConsent: false, bandDone: false }); expect(container.textContent).toContain('코치가 시작하면 자동으로 입장해요');
  });
  it('EEG true 저장 후 기존 c 연결 화면이 사용자 제스처를 기다린다', async () => {
    await openConsent(); await click(box('eeg')); await click(button('동의하고 계속하기'));
    expect(band.enabled.at(-1)).toBe(true); expect(band.connect).not.toHaveBeenCalled(); expect(container.textContent).toContain('LINK BAND 연결하기'); expect(band.hold.at(-1)?.want.bandDone).toBe(false);
  });
  it('서버 기동의를 복원하고 유효한 녹음·EEG·연구를 다시 기록하지 않는다', async () => {
    consents.eeg_collection_consented = true; consents.eeg_notice_version = 'eeg-1'; research = { participant_id: 'p1', consented: true, notice_version: 'r5-2' }; report = true;
    // 필수·EEG·연구가 현행 고지로 모두 확정이면 화면 없이 건너뛰고 서버 값을 그대로 파생한다(저장 0).
    await openConsent(); expect(boxes()).toHaveLength(0); expect(apiClient.put).not.toHaveBeenCalled();
    expect(band.enabled.at(-1)).toBe(true); expect(container.textContent).toContain('LINK BAND 연결하기');
  });
  it('조회 실패는 미동의로 덮어쓰지 않고 재시도한다', async () => {
    vi.mocked(apiClient.get).mockImplementationOnce(async () => state() as never).mockImplementationOnce(async () => { throw new Error('offline'); });
    await openConsent(); expect(container.textContent).toContain('동의 정보를 확인하지 못했어요'); expect(apiClient.put).not.toHaveBeenCalled();
    await click(button('다시 확인하기')); expect(boxes()).toHaveLength(5);
  });
  it('리포트 저장 실패는 선택을 유지하고 밴드 진입을 막으며 EEG 성공을 재전송하지 않는다', async () => {
    vi.mocked(apiClient.put).mockResolvedValueOnce({} as never).mockRejectedValueOnce(new Error('offline'));
    await openConsent(); await click(box('eeg')); await click(button('동의하고 계속하기'));
    expect(container.textContent).toContain('선택을 모두 저장하지 못했어요'); expect(document.activeElement?.getAttribute('role')).toBe('alert'); expect(box('eeg').checked).toBe(true); expect(band.enabled).toEqual([]);
    expect(vi.mocked(apiClient.put).mock.calls.map(args => args[0])).toEqual(['/sessions/s1/entry/eeg-consent', '/sessions/s1/report-choice']);
    await click(button('다시 저장하기'));
    expect(vi.mocked(apiClient.put).mock.calls.filter(args => args[0].endsWith('/eeg-consent'))).toHaveLength(1); expect(boxes()).toHaveLength(0); expect(container.textContent).toContain('LINK BAND 연결하기');
  });
  it('연타는 같은 요청 1회, 언마운트 후 EEG 후속 저장은 없다', async () => {
    let finish!: (value: never) => void; vi.mocked(apiClient.put).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openConsent(); const submit = button('동의하고 계속하기'); await act(async () => { submit.click(); submit.click(); }); expect(apiClient.put).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null)); await act(async () => finish({} as never)); expect(apiClient.put).toHaveBeenCalledTimes(1); expect(band.enabled).toEqual([]);
  });
  it('guest와 bandMode none은 연구/EEG를 표시하거나 저장하지 않는다', async () => {
    const seeded = entry(); seeded.isGuest = true; seeded.classInfo!.linkbandMode = 'none'; await openConsent(seeded); expect(boxes()).toHaveLength(3);
    expect(container.querySelector('[data-consent="research"]')).toBeNull(); expect(container.querySelector('[data-consent="eeg"]')).toBeNull(); await click(button('동의하고 계속하기'));
    expect(vi.mocked(apiClient.put).mock.calls.map(args => args[0])).toEqual(['/sessions/s1/report-choice']);
  });
  it('녹음 gate는 모두 미선택으로 시작하고 필수 전에는 자격 재요청이 없다', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new ApiError(403, 'required', { detail: { code: 'RECORDING_CONSENT_REQUIRED' } }));
    await renderPage(false); expect(boxes()).toHaveLength(5); expect(boxes().every(el => !el.checked)).toBe(true); expect(button('클래스 정보 확인하기').disabled).toBe(true); expect(apiClient.post).toHaveBeenCalledTimes(1);
  });
  it('신규 자격의 계정 EEG true보다 명시적 false를 먼저 저장하고 부분 실패 중 부모 자격을 공개하지 않는다', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new ApiError(403, 'required', { detail: { code: 'RECORDING_CONSENT_REQUIRED' } })).mockResolvedValue({
      entry_credential: 'new-cred', participant_id: 'p1', expires_at: null, is_guest: false, is_waitlisted: false, eeg_collection_consented: true,
      session: { id: 's1', type: 'meditation', title: '명상', host_name: '코치', scheduled_at: null, started_at: null, duration_min: 50, location_type: 'offline', location_address: null, participant_mode: 'group', linkband_mode: 'optional', max_participants: 10, record_audio: true, record_video: false },
    } as never);
    vi.mocked(apiClient.put).mockImplementation(async (path, payload) => {
      if (path.endsWith('/eeg-consent')) { consents.eeg_collection_consented = (payload as { consented: boolean }).consented; consents.eeg_notice_version = 'eeg-1'; return {} as never; }
      if (path.endsWith('/research-consent')) throw new Error('offline');
      return {} as never;
    });
    consents.eeg_collection_consented = true; consents.eeg_notice_version = 'eeg-1';
    await renderPage(false); await click(box('required')); await click(box('eeg')); await click(box('eeg')); await click(button('클래스 정보 확인하기'));
    expect(apiClient.put).not.toHaveBeenCalled(); expect(box('eeg').checked).toBe(false);
    await click(box('research')); await click(button('동의하고 계속하기'));
    expect(vi.mocked(apiClient.put).mock.calls.map(args => args[0])).toEqual(['/sessions/s1/entry/eeg-consent', '/sessions/s1/research-consent']);
    expect(consents.eeg_collection_consented).toBe(false); expect(loadEntry('s1')).toBeNull(); expect(band.enabled).toEqual([]);
    expect(box('eeg').checked).toBe(false);
    // 재시도에서 자격을 다시 발급하지 않고, 변경된 선택은 이전 checkpoint와 비교해 실제 저장한다.
    await click(box('eeg')); vi.mocked(apiClient.put).mockResolvedValue({} as never); await click(button('다시 저장하기'));
    expect(apiClient.post).toHaveBeenCalledTimes(2); expect(loadEntry('s1')?.eegCollectionConsented).toBe(true);
    expect(vi.mocked(apiClient.put).mock.calls.filter(args => args[0].endsWith('/eeg-consent')).map(args => args[1])).toEqual([{ consented: false, notice_version: 'eeg-1' }, { consented: true, notice_version: 'eeg-1' }]);
    expect(boxes()).toHaveLength(0); expect(container.textContent).toContain('LINK BAND 연결하기');
  });
  it('저장된 false와 구 버전 true는 미선택이며 전체 동의가 저절로 활성화되지 않는다', async () => {
    consents.eeg_collection_consented = true; consents.eeg_notice_version = 'eeg-old'; research = { participant_id: 'p1', consented: true, notice_version: 'old' };
    await openConsent(); expect(box('eeg').checked).toBe(false); expect(box('research').checked).toBe(false); expect(box('all').checked).toBe(false);
    await click(button('동의하고 계속하기'));
    expect(apiClient.put).toHaveBeenCalledWith('/sessions/s1/entry/eeg-consent', { consented: false, notice_version: 'eeg-1' }, expect.anything());
    expect(apiClient.put).toHaveBeenCalledWith('/sessions/s1/research-consent', { participant_id: 'p1', consented: false, notice_version: 'r5-2' }, expect.anything());
  });
  it('상세 안내는 연구 보관/철회·명상 열람/개인정보 링크를 보존한다', async () => {
    await openConsent(); await click(button('개인정보·기록과 선택 동의 자세히 보기'));
    for (const text of ['삭제 기한 없이 계속 보관', '철회하려면 운영팀', '센터 관리자', '전사 원문', '90일', '설정 > 개인정보']) expect(container.textContent).toContain(text);
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
  });

  it('통합 조회에서 종료를 확인하면 일반 조회 오류 대신 기존 종료 안내로 보낸다', async () => {
    let states = 0;
    vi.mocked(apiClient.get).mockImplementation(async path => {
      if (path.endsWith('/entry/consents')) return consents as never;
      if (path.endsWith('/research-consent')) return research as never;
      if (path.includes('/entry-state')) return { ...state(), status: ++states === 1 ? 'open' : 'completed' } as never;
      throw new Error('unexpected');
    });
    await openConsent(); expect(container.textContent).toContain('이미 끝난 클래스예요'); expect(container.textContent).not.toContain('동의 정보를 확인하지 못했어요'); expect(apiClient.put).not.toHaveBeenCalled();
  });
  it('제출 직전 서버 취소 확인 시 녹음/EEG를 포함한 저장을 시작하지 않는다', async () => {
    await openConsent();
    const original = vi.mocked(apiClient.get).getMockImplementation()!;
    vi.mocked(apiClient.get).mockImplementation(async path => path.includes('/entry-state') ? { ...state(), status: 'cancelled' } as never : original(path));
    await click(button('동의하고 계속하기')); expect(container.textContent).toContain('클래스가 취소됐어요'); expect(apiClient.put).not.toHaveBeenCalled();
  });
  it('밴드 준비 후 외부 EEG 철회는 잠금 선택으로 덮어쓰거나 부모 hold 입력을 바꾸지 않는다', async () => {
    band.state = 'connected';
    await openConsent(); await click(box('eeg')); await click(button('동의하고 계속하기')); await click(button('다음'));
    expect(band.hold.at(-1)?.want).toMatchObject({ eegConsent: true, bandDone: true });
    consents.eeg_collection_consented = false; consents.eeg_notice_version = 'eeg-1'; vi.mocked(apiClient.put).mockClear();
    await click(button('선택 바꾸기'));
    expect(container.textContent).toContain('뇌파 동의가 다른 화면에서 변경됐어요'); expect(apiClient.put).not.toHaveBeenCalled();
    expect(band.hold.at(-1)?.want).toMatchObject({ eegConsent: true, bandDone: true });
  });

  it('자격이 없으면 실제 회차 정보와 기존 선택을 먼저 보여 주고 재확인 전에는 선택 동의를 쓰지 않는다', async () => {
    consents.eeg_collection_consented = true; consents.eeg_notice_version = 'eeg-1'; research = { participant_id: 'p1', consented: true, notice_version: 'r5-2' }; report = true;
    vi.mocked(apiClient.post).mockRejectedValueOnce(new ApiError(403, 'required', { detail: { code: 'RECORDING_CONSENT_REQUIRED' } })).mockResolvedValue({
      entry_credential: 'new-cred', participant_id: 'p1', expires_at: null, is_guest: false, is_waitlisted: false, eeg_collection_consented: true,
      session: { id: 's1', type: 'meditation', title: '실제 오프라인 명상', host_name: '코치', scheduled_at: null, started_at: null, duration_min: 50, location_type: 'offline', location_address: null, participant_mode: 'group', linkband_mode: 'optional', max_participants: 10, record_audio: true, record_video: false },
    } as never);
    await renderPage(false); await click(box('required')); await click(button('클래스 정보 확인하기'));
    expect(container.textContent).toContain('실제 오프라인 명상'); expect(container.textContent).toContain('기존 선택을 확인');
    expect(box('research').checked).toBe(true); expect(box('report').checked).toBe(true); expect(apiClient.put).not.toHaveBeenCalled(); expect(loadEntry('s1')).toBeNull();
    await click(button('개인정보·기록과 선택 동의 자세히 보기')); expect(container.textContent).toContain('현장 대화를'); expect(container.textContent).toContain('센터 관리자는');
    await click(button('확인했어요')); await click(button('동의하고 계속하기')); expect(loadEntry('s1')).not.toBeNull();
    expect(vi.mocked(apiClient.put).mock.calls.map(args => args[0])).toEqual(['/sessions/s1/report-choice']);
  });
  it('EEG 거절로 c를 생략하면 대기실로 가고 선택 바꾸기는 동의 화면으로 돌아오며 완료 시 대기실로 복귀한다', async () => {
    await openConsent(); await click(button('동의하고 계속하기'));
    expect(container.textContent).toContain('코치가 시작하면 자동으로 입장해요'); expect(band.enabled).toEqual([]);
    await click(button('선택 바꾸기')); expect(boxes()).toHaveLength(5);
    await click(button('동의하고 계속하기')); expect(container.textContent).toContain('코치가 시작하면 자동으로 입장해요');
  });

  it('종료 상태와 동의 403이 동시에 있으면 종료 안내를 우선한다', async () => {
    let states = 0;
    vi.mocked(apiClient.get).mockImplementation(async path => {
      if (path.includes('/entry-state')) return { ...state(), status: ++states === 1 ? 'open' : 'completed' } as never;
      throw new ApiError(403, 'forbidden', null);
    });
    await openConsent(); expect(container.textContent).toContain('이미 끝난 클래스예요'); expect(apiClient.put).not.toHaveBeenCalled();
  });
  it('녹음 선검사 뒤 비초대 403이면 기존 코드 입력 복구 화면으로 돌아간다', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new ApiError(403, 'required', { detail: { code: 'RECORDING_CONSENT_REQUIRED' } })).mockRejectedValue(new ApiError(403, 'not invited', null));
    await renderPage(false); await click(box('required')); await click(button('클래스 정보 확인하기'));
    expect(container.textContent).toContain('코드 입력하기'); expect(apiClient.put).not.toHaveBeenCalled();
  });

  it('연구 미선택과 저장된 거절을 구별하여 고지 버전 없는 false는 명시적 거절로 저장한다', async () => {
    research.notice_version = null;
    await openConsent(); expect(box('research').checked).toBe(false); await click(button('동의하고 계속하기'));
    expect(apiClient.put).toHaveBeenCalledWith('/sessions/s1/research-consent', { participant_id: 'p1', consented: false, notice_version: 'r5-2' }, expect.anything());
  });

  it('밴드 없이 준비한 뒤에는 EEG를 다시 선택하고 기존 c 연결 단계로 갈 수 있다', async () => {
    await openConsent(); await click(button('동의하고 계속하기'));
    consents.eeg_collection_consented = false; consents.eeg_notice_version = 'eeg-1';
    await click(button('선택 바꾸기')); expect(box('eeg').disabled).toBe(false);
    await click(box('eeg')); await click(button('동의하고 계속하기'));
    await click(button('LINK BAND 다시 연결하기')); expect(container.textContent).toContain('LINK BAND 연결하기'); expect(band.connect).not.toHaveBeenCalled();
  });

  it('미개방 대기 후 동의 완료하고 요약에서 재검토해도 이전 touched가 서버 true를 덮어쓰지 않는다', async () => {
    consents.eeg_collection_consented = true; consents.eeg_notice_version = 'eeg-1'; research = { participant_id: 'p1', consented: true, notice_version: 'r5-2' }; report = true; band.state = 'connected';
    vi.mocked(apiClient.post)
      .mockRejectedValueOnce(new ApiError(403, 'required', { detail: { code: 'RECORDING_CONSENT_REQUIRED' } }))
      .mockRejectedValueOnce(new ApiError(409, 'not open', { detail: { code: 'session_not_open' } }))
      .mockResolvedValue({ entry_credential: 'new-cred', participant_id: 'p1', expires_at: null, is_guest: false, is_waitlisted: false, eeg_collection_consented: true,
        session: { id: 's1', type: 'meditation', title: '명상', host_name: '코치', scheduled_at: null, started_at: null, duration_min: 50, location_type: 'offline', location_address: null, participant_mode: 'group', linkband_mode: 'optional', max_participants: 10, record_audio: true, record_video: false },
      } as never);
    await renderPage(false); await click(box('all')); await click(button('클래스 정보 확인하기'));
    expect(container.textContent).toContain('아직 열리지 않았어요'); await click(button('입장 대기하기'));
    // 서버에 모두 확정이면 동의 화면 없이 밴드 단계로 간다. 대기실에서 선택 바꾸기로 다시 열어도 서버 값이 유지된다.
    expect(boxes()).toHaveLength(0); await click(button('다음'));
    await click(button('선택 바꾸기')); expect(box('required').checked).toBe(true); expect(box('eeg').checked).toBe(true); expect(box('research').checked).toBe(true); expect(box('report').checked).toBe(true);
  });

});
