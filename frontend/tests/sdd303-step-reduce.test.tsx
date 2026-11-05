// @vitest-environment jsdom
// SDD-303 A안 — 권한 안내 인라인, 접촉 확인 자동 진행, 입장 탭 수 실측
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionGuide } from '../src/components/native/permission-guide';
import { BandStepView } from '../src/components/class/flow/member/BandStepView';
import { apiClient } from '../src/lib/api/client';
import { saveEntry, type StoredEntry } from '../src/lib/api/class-flow';
import { useAuthStore } from '../src/stores/authStore';

const band = vi.hoisted(() => ({ state: 'idle', leadOff: null as { ch1: boolean; ch2: boolean } | null, connect: vi.fn() }));
vi.mock('../src/hooks/useBandStep', () => ({ useBandStep: () => ({ state: band.state, leadOff: band.leadOff, battery: 80, connect: band.connect, disconnect: vi.fn() }) }));
vi.mock('../src/hooks/useWaitingRoomPresence', () => ({ useWaitingRoomPresence: () => undefined }));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: () => undefined }));
vi.mock('../src/hooks/useLobbyBgm', () => ({ useLobbyBgm: () => ({ state: { track: null, volume: 0.6, blocked: false, muted: false }, setVolume: vi.fn(), toggleMute: vi.fn(), resume: vi.fn() }) }));
vi.mock('../src/lib/session-live/use-live-v2', () => ({ useLiveV2: () => ({ ready: false, state: null, client: null }) }));
import EntryPage from '../src/pages/class/EntryPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let container: HTMLDivElement;
const btn = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
let taps = 0;
const tap = async (label: string) => { const el = btn(label); expect(el, label).toBeDefined(); taps += 1; await act(async () => { el!.click(); }); };
const checkbox = (name: string) => container.querySelector<HTMLInputElement>(`input[data-consent="${name}"]`)!;
const tapBox = async (name: string) => { taps += 1; await act(async () => { checkbox(name).click(); }); };

let consents: Record<string, unknown>; let research: Record<string, unknown>; let report = false;
const entry = (over: Partial<StoredEntry['classInfo']> & { isGuest?: boolean } = {}): StoredEntry => ({
  sessionId: 's1', credential: 'cred', expiresAt: null, participantId: 'p1', isGuest: over.isGuest ?? false,
  classInfo: { title: '명상', hostName: '코치', scheduledAt: null, startedAt: null, durationMin: 50, locationType: 'offline', locationAddress: null, participantMode: 'group', linkbandMode: 'optional', maxParticipants: 10, recordAudio: true, recordVideo: false, ...over } as never,
});
const state = () => ({ session_id: 's1', participant_id: 'p1', status: 'open', is_waitlisted: false, report_included: report, started_at: null, ended_at: null, chat_enabled: false, band_connected: false });
async function mount(e: StoredEntry) {
  saveEntry(e);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/class/s1/enter'] }, createElement(Routes, null, createElement(Route, { path: '/class/:sessionId/enter', element: createElement(EntryPage) })))));
}

beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  sessionStorage.clear(); localStorage.clear(); taps = 0; band.state = 'idle'; band.leadOff = null; band.connect.mockReset();
  useAuthStore.setState({ isAuthenticated: true, user: null });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (m: string) => ({ matches: false, media: m, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) });
  consents = { participant_id: 'p1', recording_consented: true, recording_notice_version: 'rec-1', eeg_collection_consented: null, eeg_notice_version: null };
  research = { participant_id: 'p1', consented: false, notice_version: 'r5-2' }; report = false;
  vi.spyOn(apiClient, 'get').mockImplementation(async (path) => {
    if (path.includes('/entry/consents')) return consents as never;
    if (path.includes('/research-consent')) return research as never;
    if (path.includes('/entry-state')) return state() as never;
    throw new Error(`예상하지 않은 GET ${path}`);
  });
  vi.spyOn(apiClient, 'put').mockResolvedValue({} as never);
});
afterEach(async () => { vi.useRealTimers(); await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); useAuthStore.setState({ isAuthenticated: false, user: null }); });

describe('권한 안내 인라인 (V2-2/V2-3)', () => {
  it('PermissionGuide 기본은 시트를 거치고 inline 이면 1탭으로 곧바로 계속한다', async () => {
    const onContinue = vi.fn();
    await act(async () => root.render(createElement(PermissionGuide, { kind: 'bluetooth', onContinue, children: (r) => createElement('button', { onClick: r }, '연결') })));
    await act(async () => btn('연결')!.click());
    expect(onContinue).not.toHaveBeenCalled(); expect(container.querySelector('[role=dialog]')).not.toBeNull();
    await act(async () => root.render(createElement(PermissionGuide, { kind: 'bluetooth', inline: true, onContinue, children: (r) => createElement('button', { onClick: r }, '연결') })));
    await act(async () => btn('연결')!.click());
    expect(onContinue).toHaveBeenCalledOnce();
  });
  it('밴드 화면은 Bluetooth 권한 설명을 인라인으로 보이고 연결 1탭이 곧바로 onConnect 를 호출한다', async () => {
    const onConnect = vi.fn();
    await act(async () => root.render(createElement(BandStepView, { bandMode: 'opt', place: 'offline', steps: { total: 2, current: 1 }, state: 'idle', leadOff: null, battery: null, onConnect, onDisconnect: vi.fn(), onNext: vi.fn(), onSkip: vi.fn(), onBack: vi.fn(), onExit: vi.fn() })));
    expect(container.textContent).toContain('Bluetooth 권한을 사용해요');
    await act(async () => btn('LINK BAND 연결하기')!.click());
    expect(onConnect).toHaveBeenCalledOnce();
    expect(container.querySelector('[role=dialog]')).toBeNull(); expect(container.textContent).not.toContain('확인하고 계속');
  });
});

describe('접촉 확인 자동 진행 (A-14)', () => {
  it('접촉 양호가 확인되면 탭 없이 대기실로, 미확인·불량은 자동 진행하지 않는다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount(entry());
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await tapBox('eeg');
    band.state = 'connected'; band.leadOff = null;
    await tap('동의하고 계속하기');
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(container.textContent).toContain('LINK BAND를 연결해요'); // leadOff 미확인 → 자동 진행 없음
    band.leadOff = { ch1: true, ch2: false };
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/class/s1/enter'] }, createElement(Routes, null, createElement(Route, { path: '/class/:sessionId/enter', element: createElement(EntryPage) })))));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(container.textContent).toContain('LINK BAND를 연결해요'); // 불량 → 자동 진행 없음
    band.state = 'connected'; band.leadOff = { ch1: false, ch2: false };
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/class/s1/enter'] }, createElement(Routes, null, createElement(Route, { path: '/class/:sessionId/enter', element: createElement(EntryPage) })))));
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(container.textContent).toContain('코치가 시작하면 자동으로 입장해요');
  });
});

describe('탭 수 실측 (A안)', () => {
  it('오프라인·밴드 새 연결(접촉 양호 자동): 동의 EEG 선택 1 + 저장 1 + 연결 1 = 3탭, 입장하기 탭 0', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount(entry());
    await tapBox('eeg'); await tap('동의하고 계속하기');
    expect(container.textContent).toContain('LINK BAND를 연결해요');
    await tap('LINK BAND 연결하기'); expect(band.connect).toHaveBeenCalledOnce();
    band.state = 'connected'; band.leadOff = { ch1: false, ch2: false };
    await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/class/s1/enter'] }, createElement(Routes, null, createElement(Route, { path: '/class/:sessionId/enter', element: createElement(EntryPage) })))));
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(container.textContent).toContain('코치가 시작하면 자동으로 입장해요');
    expect(taps).toBe(3);
  });
  it('EEG 선택 안 함(밴드 미사용): 저장 1탭으로 밴드 단계 없이 대기실', async () => {
    await mount(entry());
    await tap('동의하고 계속하기');
    expect(container.textContent).toContain('코치가 시작하면 자동으로 입장해요'); // EEG 미동의 → 밴드 단계 없음
    expect(taps).toBe(1);
  });
  it('bandMode=none: 저장 1탭으로 대기실', async () => {
    await mount(entry({ linkbandMode: 'none' }));
    await tap('동의하고 계속하기');
    expect(container.textContent).toContain('코치가 시작하면 자동으로 입장해요');
    expect(taps).toBe(1);
  });
  it('모든 선택이 서버에 유효: 동의 화면 건너뜀, 밴드 연결 1탭(+접촉 자동)', async () => {
    consents.eeg_collection_consented = true; consents.eeg_notice_version = 'eeg-1'; research = { participant_id: 'p1', consented: true, notice_version: 'r5-2' }; report = true;
    sessionStorage.setItem('mb_consent_done_s1_p1', '1');
    await mount(entry());
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(0);
    expect(container.textContent).toContain('LINK BAND를 연결해요');
    await tap('LINK BAND 연결하기');
    expect(taps).toBe(1); expect(apiClient.put).not.toHaveBeenCalled();
  });
  it('재입장·유효 동의·밴드 미사용 기록(EEG 거절 확정): 동의 화면과 밴드 모두 건너뛰고 0탭 대기실', async () => {
    consents.eeg_collection_consented = false; consents.eeg_notice_version = 'eeg-1'; research = { participant_id: 'p1', consented: false, notice_version: 'r5-2' };
    sessionStorage.setItem('mb_consent_done_s1_p1', '1');
    await mount(entry());
    expect(container.textContent).toContain('코치가 시작하면 자동으로 입장해요');
    expect(taps).toBe(0); expect(apiClient.put).not.toHaveBeenCalled();
  });
  it('동의 화면에서 이전으로 돌아가도 자동으로 다시 넘어가지 않는다(루프 없음)', async () => {
    consents.eeg_collection_consented = false; consents.eeg_notice_version = 'eeg-1';
    await mount(entry());
    await tap('동의하고 계속하기');
    expect(btn('선택 바꾸기')).toBeDefined();
  });
});
