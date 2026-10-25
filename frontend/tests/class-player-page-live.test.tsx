// @vitest-environment jsdom
// SDD-208 I1 — ClassPlayerPage 의 진행 중(in_progress) 호스트 구간은 HostLiveContainer,
// SDD-209 I2 — 세팅(ready/scheduled)·대기(open)·닫힘(cancelled) 호스트 구간은 HostPrepContainer 가 맡는다.
// 페이지는 컨테이너에 값·핸들러만 넘기고 종료 모달·채팅 오버레이는 중복으로 두지 않는다.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClassPlayerPage from '../src/pages/sessions/ClassPlayerPage';
import { useAuthStore } from '../src/stores/authStore';

const h = vi.hoisted(() => ({
  recordDisplay: vi.fn(),
  liveOptions: {} as Record<string, unknown>,
  bandOptions: {} as Record<string, unknown>,
  participation: {sessionId:'s1',version: -1, revoked: false, participants: {} as Record<string, unknown>},
  containerProps: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  prepProps: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  calls: [] as string[],
  media: { mic: 'on', cam: 'on', level: 0.2, steps: 1, quiet: false, speakerPlaying: false, videoRef: { current: null }, startMic: vi.fn(async () => undefined), stopMic: vi.fn(), toggleMic: vi.fn(async () => undefined), startCamera: vi.fn(async () => undefined), stopCamera: vi.fn(), toggleCamera: vi.fn(async () => undefined), recheck: vi.fn(async () => undefined), playTestTone: vi.fn(async () => undefined) },
  session: {} as Record<string, unknown>,
  getClass: vi.fn(),
  getSession: vi.fn(),
  getSessionLiveMetrics: vi.fn(),
  setParticipantSpeaking: vi.fn(),
  transitionSession: vi.fn(),
  setSessionChatEnabled: vi.fn(),
  liveKit: { token: null as string | null, loading: false, error: null as string | null, serverUrl: 'wss://lk.test', connect: vi.fn(), disconnect: vi.fn(), session: null },
  recorder: { state: 'idle', start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), pause: vi.fn(), resume: vi.fn() },
  videoRecorder: { state: 'idle', stream: null, facingMode: 'user', start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined), pause: vi.fn(), resume: vi.fn(), switchCamera: vi.fn(), getExpectedCount: () => 0 },
  rawSocket: { connected: false, connect: vi.fn() },
}));

vi.mock('../src/lib/api/class-structure', () => ({ getClass: (...args: unknown[]) => h.getClass(...args) }));
vi.mock('../src/lib/api/class-operations', () => ({ classOperationsApi: { members: vi.fn(async () => ({ members: [] })) } }));
vi.mock('../src/lib/api/class-member-candidates', () => ({ searchClassMemberCandidates: vi.fn(async () => ({ members: [], has_more: false })) }));
vi.mock('../src/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/session')>()),
  getSession: (...a: unknown[]) => h.getSession(...a),
  getSessionLiveMetrics: (...a: unknown[]) => h.getSessionLiveMetrics(...a),
  setParticipantSpeaking: (...a: unknown[]) => h.setParticipantSpeaking(...a),
  transitionSession: (...a: unknown[]) => { h.calls.push(`transition:${String(a[1])}`); return h.transitionSession(...a); },
}));
vi.mock('../src/lib/api/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/chat')>()),
  setSessionChatEnabled: (...a: unknown[]) => h.setSessionChatEnabled(...a),
}));
vi.mock('../src/lib/api/audio', () => ({
  startAudio: (...a: unknown[]) => { h.calls.push(`audio/start:${String(a[1])}`); return Promise.resolve(); },
  stopAudio: vi.fn(),
}));
vi.mock('../src/lib/api/video', () => ({
  startVideo: () => { h.calls.push('video/start'); return Promise.resolve(); },
  stopVideo: vi.fn(),
}));
vi.mock('../src/lib/api/class-flow-host', () => ({
  remindInvitees: vi.fn(async () => ({ session_id: 's1', cooldown_sec: 60, results: [{ participant_id: 'a', status: 'queued' }], summary: {} })),
  getReportChoiceSummary: vi.fn(async () => ({ included: 1, excluded: 2, total: 3 })),
  getResearchConsentSummary: vi.fn(async () => ({ consented: 1, total: 3 })),
}));
vi.mock('../src/hooks/useMediaCheck', () => ({ useMediaCheck: () => h.media }));
vi.mock('../src/lib/socket', () => ({ getActiveSessionLiveSocket: () => h.rawSocket }));
vi.mock('../src/hooks/useAudioRecorder', () => ({ useAudioRecorder: () => h.recorder }));
vi.mock('../src/hooks/useVideoRecorder', () => ({ useVideoRecorder: () => h.videoRecorder }));
vi.mock('../src/hooks/useBand', () => ({
  useBand: (options: Record<string, unknown>) => {h.bandOptions=options;return ({
    isSupported: true, isMock: false, connectionState: 'disconnected', battery: null, deviceStatus: null, signalQualityLevel: 'unknown',
    signalQuality: null, lastEegAt: null, currentEfficiency: null, uploadStatus: null, error: null,
    connect: vi.fn(), disconnect: vi.fn(), recordDisplay: h.recordDisplay,
  });},
}));
vi.mock('../src/hooks/useLiveKit', () => ({ useLiveKit: () => h.liveKit }));
vi.mock('../src/hooks/useSessionLiveSocket', () => ({
  useSessionLiveSocket: (options:Record<string, unknown>) => {h.liveOptions=options;return ({ isConnected: true, isReady: true, hasSnapshot: true, sendSignal: vi.fn(), sendAudioSync: vi.fn() });},
}));
vi.mock('../src/hooks/useParticipationSnapshot',()=>({useParticipationSnapshot:()=>h.participation}));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }));
vi.mock('../src/hooks/useLeaveGuard', () => ({ useLeaveGuard: () => ({ state: 'unblocked' }) }));
vi.mock('../src/hooks/useWaitingRoomCount', () => ({ useWaitingRoomCount: () => ({ entries: [], count: 0, nicknames: [] }) }));
vi.mock('../src/hooks/useClassAudioPlayer', () => ({ useClassAudioPlayer: () => ({ state: { tracks: [], selectedTrackId: null, playing: false, positionSec: 0, durationSec: null, volume: 0.6 }, actions: { selectTrack: vi.fn(), toggle: vi.fn(), setVolume: vi.fn() } }) }));
vi.mock('../src/hooks/useReportProgress', () => ({ useReportProgress: () => ({ progress: null, generationStatus: null }) }));
vi.mock('../src/components/class/FadingImageBackground', () => ({ FadingImageBackground: () => null }));
vi.mock('../src/components/chat/ClassChatPanel', () => ({
  ClassChatPanel: () => createElement('aside', { 'data-testid': 'page-chat-overlay' }, '페이지 채팅 오버레이'),
}));
vi.mock('../src/components/class/player/host/HostLiveContainer', () => ({
  HostLiveContainer: (props: Record<string, unknown>) => {
    h.containerProps.push(props);
    return createElement('section', { 'data-testid': 'host-live-container' }, '새 상담사 진행 화면');
  },
}));
vi.mock('../src/components/class/flow/host/HostPrepContainer', () => ({
  HostPrepContainer: (props: Record<string, unknown>) => {
    h.prepProps.push(props);
    return createElement('section', { 'data-testid': 'host-prep-container', 'data-phase': String(props.phase) }, '새 상담사 시작 전 화면');
  },
}));

const metric = (id: string, extra: Record<string, unknown> = {}) => ({
  participant_id: id, display_name: `회원 ${id}`, is_guest: false, band_connected: true, device_status: 'ok', band_battery: 80,
  avg_efficiency: 0.5, current_efficiency: 0.5, upload_status: 'completed', last_eeg_at: new Date().toISOString(), heart_rate: 70, respiratory_rate: 14,
  raise_hand: false, speaking: false, user_id: `u-${id}`, ...extra,
});

function makeSession(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 's1', title: '저녁 명상', type: 'meditation', status, host_id: 'host-1', location_type: 'online', participant_mode: 'group',
    max_participants: 12, duration_min: 30, access_code: 'ABC123', started_at: new Date(Date.now() - 60_000).toISOString(), opened_at: new Date().toISOString(),
    chat_enabled: false, chat_room_id: 'room-1', record_audio: true, record_video: true,
    participants: [{ participant_id: 'w1', user_id: 'u-w1', user_name: '대기 회원', is_waitlisted: true, is_guest: false, band_connected: false }],
    ...extra,
  };
}

let root: Root;
let container: HTMLDivElement;
let pageRouter: ReturnType<typeof createMemoryRouter>;
async function renderPage(): Promise<void> {
  const router = pageRouter = createMemoryRouter(
    [
      { path: '/sessions/:id/player', element: createElement(ClassPlayerPage) },
      { path: '/sessions/:id/record', element: createElement('p', null, '기록 화면') },
      { path: '/sessions', element: createElement('p', null, '세션 목록') },
    ],
    { initialEntries: ['/sessions/s1/player'] },
  );
  await act(async () => { root.render(createElement(RouterProvider, { router }) as ReactNode); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}
const lastProps = () => h.containerProps.at(-1) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
/** 핸들러(void)를 부르고 뒤따르는 비동기 작업(API 응답·상태 갱신)이 끝날 때까지 흘려보낸다 */
const fire = (fn: () => unknown) => act(async () => { fn(); await vi.advanceTimersByTimeAsync(10); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-16T05:00:00Z'));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }) });
  h.participation={sessionId:'s1',version:-1,revoked:false,participants:{}};
  h.containerProps.length = 0;
  h.prepProps.length = 0;
  h.calls.length = 0; h.recordDisplay.mockClear();
  Object.assign(h.liveKit, { token: null, loading: false, error: null });
  h.getClass.mockReset().mockResolvedValue({ id: 'class-1', revision: 1, status: 'active', capacity: 10, capabilities: { invite: true } });
  h.getSession.mockReset().mockImplementation(async () => h.session);
  h.getSessionLiveMetrics.mockReset().mockResolvedValue({ metrics: [metric('host-p', { user_id: 'host-1' }), metric('a'), metric('b')] });
  h.setParticipantSpeaking.mockReset().mockResolvedValue({ participant_id: 'a', speaking: true, raise_hand: false });
  h.transitionSession.mockReset().mockResolvedValue({ ...makeSession('completed') });
  h.setSessionChatEnabled.mockReset().mockResolvedValue({ chat_enabled: true });
  h.liveKit.connect.mockClear();
  h.liveKit.disconnect.mockClear();
  h.recorder.pause.mockClear();
  h.rawSocket.connect.mockClear();
  useAuthStore.setState({ isAuthenticated: true, isInitialized: true, user: { id: 'host-1', name: '채용욱', role: 'counselor' } as unknown as ReturnType<typeof useAuthStore.getState>['user'] });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('진행 중 호스트: 새 컨테이너로 교체', () => {
  beforeEach(() => { h.session = makeSession('in_progress'); });

  it('SDD244 H06: session_player 표시를 60초 동안 매초 기록', async () => {
    await renderPage();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(h.bandOptions.displayViewKind).toBe('session_player');
    expect(h.recordDisplay).toHaveBeenCalledTimes(60);
  });

  it('옛 헤더·워크스페이스 대신 HostLiveContainer 하나만 그리고, 페이지의 채팅 오버레이·종료 모달은 중복으로 두지 않는다', async () => {
    await renderPage();
    expect(q('[data-testid="host-live-container"]')).not.toBeNull();
    expect(q('.host-class-player')).toBeNull();
    expect(document.body.textContent).not.toContain('나가기');
    expect(q('[data-testid="page-chat-overlay"]')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });

  it('컨테이너에 호스트 id·지표 행·세션 정보·대기자를 넘긴다(대기자 id 는 participant_id)', async () => {
    await renderPage();
    const props = lastProps();
    expect(props.hostUserId).toBe('host-1');
    expect(props.hostParticipantId).toBe('host-p');
    expect(props.rows.map((r: { participant_id: string }) => r.participant_id)).toEqual(['host-p', 'a', 'b']);
    expect(props.session).toMatchObject({ id: 's1', location_type: 'online', participant_mode: 'group', access_code: 'ABC123' });
    expect(props.elapsedSec).toBeGreaterThanOrEqual(0);
    expect(props.speaking.busyId).toBeNull();
    expect(props.status).toMatchObject({ error: null, endFailed: false, ending: false });
  });

  it('발언권 부여는 API 호출 중 busyId 를 알리고 끝나면 지운다', async () => {
    let resolve: (v: unknown) => void = () => undefined;
    h.setParticipantSpeaking.mockReturnValue(new Promise((r) => { resolve = r; }));
    await renderPage();
    await act(async () => { lastProps().speaking.onSet('a', true); });
    expect(h.setParticipantSpeaking).toHaveBeenCalledWith('s1', 'a', true);
    expect(lastProps().speaking.busyId).toBe('a');
    await act(async () => { resolve({ participant_id: 'a', speaking: true, raise_hand: false }); await vi.advanceTimersByTimeAsync(10); });
    expect(lastProps().speaking.busyId).toBeNull();
  });

  it('지표 폴링이 실패하면 metricsPollFailing=true, 다시 성공하면 false', async () => {
    await renderPage();
    expect(lastProps().live.metricsPollFailing).toBe(false);
    h.getSessionLiveMetrics.mockRejectedValue(new Error('network'));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(lastProps().live.metricsPollFailing).toBe(true);
    h.getSessionLiveMetrics.mockResolvedValue({ metrics: [metric('a')] });
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(lastProps().live.metricsPollFailing).toBe(false);
  });

  it('지표 폴링 성공 시각(metricsLastOkAt)을 기록한다 — 첫 성공 전 null, 성공 후 값, 실패해도 마지막 성공 시각 유지', async () => {
    await renderPage();
    expect(lastProps().live.metricsLastOkAt).not.toBeNull();
    const ok = lastProps().live.metricsLastOkAt;
    h.getSessionLiveMetrics.mockRejectedValue(new Error('network'));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(lastProps().live.metricsLastOkAt).toBe(ok);
  });

  it('[다시 연결]은 지표를 다시 받고 끊긴 소켓을 다시 연결한다', async () => {
    await renderPage();
    h.getSessionLiveMetrics.mockClear();
    await act(async () => { lastProps().live.onRetry(); });
    expect(h.getSessionLiveMetrics).toHaveBeenCalled();
    expect(h.rawSocket.connect).toHaveBeenCalled();
  });

  it('채팅 켜기/끄기는 서버에 보내고 결과를 컨테이너에 알린다', async () => {
    await renderPage();
    expect(lastProps().chat.enabled).toBe(false);
    await fire(() => lastProps().chat.onToggleEnabled());
    expect(h.setSessionChatEnabled).toHaveBeenCalledWith('s1', true);
    expect(lastProps().chat.enabled).toBe(true);
  });

  it('종료: 요청 → 모달 열림 → 확정하면 end 전이 후 같은 화면에서 리포트 진행(ending)', async () => {
    await renderPage();
    const startedAt = new Date(Date.now() - 180_000).toISOString();
    h.transitionSession.mockResolvedValueOnce(makeSession('completed', { started_at: startedAt, ended_at: new Date(Date.parse(startedAt) + 150_000).toISOString() }));
    expect(lastProps().end.open).toBe(false);
    await act(async () => { lastProps().end.onRequest(); });
    expect(lastProps().end.open).toBe(true);
    await act(async () => { lastProps().end.onCancel(); });
    expect(lastProps().end.open).toBe(false);
    await act(async () => { lastProps().end.onRequest(); });
    await fire(() => lastProps().end.onConfirm());
    expect(h.liveKit.disconnect).toHaveBeenCalled();
    expect(h.transitionSession).toHaveBeenCalledWith('s1', 'end');
    expect(document.body.textContent).not.toContain('기록 화면');
    expect(lastPrep()).toMatchObject({ phase: 'ending' });
    expect(lastPrep().ending).toMatchObject({ steps: null, durationMin: 3 });
  });

  it('종료가 실패하면 오류와 endFailed 를 알리고, [종료 재시도]로 다시 시도한다', async () => {
    h.transitionSession.mockRejectedValueOnce(new Error('서버 오류'));
    await renderPage();
    await fire(() => lastProps().end.onConfirm());
    expect(lastProps().status).toMatchObject({ error: '서버 오류', endFailed: true });
    await fire(() => lastProps().status.onRetryEnd());
    expect(h.transitionSession).toHaveBeenCalledTimes(2);
    expect(lastPrep()).toMatchObject({ phase: 'ending' });
  });

  it('화상 연결이 끊기면 오류 문구를 알린다', async () => {
    await renderPage();
    await act(async () => { lastProps().liveKit.onDisconnected(); });
    expect(lastProps().status.error).toBe('화상 회의 연결이 끊어졌습니다');
  });

  it('닫기 버튼은 세션 목록으로 이동한다', async () => {
    await renderPage();
    await act(async () => { lastProps().onClose(); });
    expect(document.body.textContent).toContain('세션 목록');
  });
});

const lastPrep = () => h.prepProps.at(-1) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('시작 전·닫힘 호스트: HostPrepContainer 로 교체 (SDD-209 I2)', () => {
  it.each([['ready', 'setup'], ['scheduled', 'setup'], ['open', 'lobby'], ['cancelled', 'closed']])('%s 상태는 phase=%s 로 그린다', async (status, phase) => {
    h.session = makeSession(status);
    await renderPage();
    expect(q('[data-testid="host-live-container"]')).toBeNull();
    expect(q('[data-testid="host-prep-container"]')?.getAttribute('data-phase')).toBe(phase);
    expect(q('.host-class-player')).toBeNull();
  });

  it('로비: 초대 명단은 호스트 본인을 뺀 live-metrics 행이고, 입장 코드는 세션의 4자리 값이다', async () => {
    h.session = makeSession('open', { access_code: '4821' });
    await renderPage();
    expect(lastPrep().roster).toEqual([
      { participantId: 'a', name: '회원 a' },
      { participantId: 'b', name: '회원 b' },
    ]);
    expect(lastPrep().accessCode).toBe('4821');
    expect(lastPrep().ctx).toEqual({ place: 'online', size: 'group', band: undefined });
  });

  it('세팅(온라인)에서만 장비 점검을 켜고, 오프라인은 getUserMedia 를 부르지 않는다', async () => {
    h.session = makeSession('ready', { location_type: 'offline' });
    await renderPage();
    expect(h.media.startMic).not.toHaveBeenCalled();
    expect(h.media.startCamera).not.toHaveBeenCalled();
  });

  it('세팅(온라인): 점검을 켜고, 열면 장비 사용 값을 보관한 채 open 전이한다', async () => {
    h.session = makeSession('ready');
    h.transitionSession.mockResolvedValue(makeSession('open'));
    await renderPage();
    expect(h.media.startMic).toHaveBeenCalled();
    expect(h.media.startCamera).toHaveBeenCalled();
    await fire(() => lastPrep().onOpen({ cameraOn: true, micOn: false }));
    expect(h.calls).toContain('transition:open');
  });

  it('시작(녹음): start 전이 → 화상 연결 → audio/start(true) → 녹음기 → 영상, 동의 모달 없음', async () => {
    h.session = makeSession('open');
    h.transitionSession.mockResolvedValue(makeSession('in_progress'));
    await renderPage();
    await fire(() => lastPrep().onStart('record'));
    expect(h.calls.filter((c) => c.startsWith('transition') || c.startsWith('audio') || c.startsWith('video'))).toEqual(['transition:start', 'audio/start:true', 'video/start']);
    expect(h.liveKit.connect).toHaveBeenCalledTimes(1);
    expect(h.recorder.start).toHaveBeenCalledTimes(1);
  });

  it('시작(수동 기록): audio/start(false) 로 선언하고 녹음기는 켜지 않는다', async () => {
    h.session = makeSession('open');
    h.transitionSession.mockResolvedValue(makeSession('in_progress'));
    await renderPage();
    await fire(() => lastPrep().onStart('manual'));
    expect(h.calls).toContain('audio/start:false');
    expect(h.calls).not.toContain('audio/start:true');
    expect(h.recorder.start).not.toHaveBeenCalled();
  });

  it('오프라인 시작은 화상 연결과 영상 녹화를 하지 않는다', async () => {
    h.session = makeSession('open', { location_type: 'offline' });
    h.transitionSession.mockResolvedValue(makeSession('in_progress', { location_type: 'offline' }));
    await renderPage();
    await fire(() => lastPrep().onStart('record'));
    expect(h.liveKit.connect).not.toHaveBeenCalled();
    expect(h.calls).not.toContain('video/start');
  });

  it('클래스 닫기: cancel 전이 후 같은 화면에서 FH10(closed, 대기 인원 포함)을 보여 준다', async () => {
    h.session = makeSession('open');
    h.transitionSession.mockResolvedValue(makeSession('cancelled'));
    await renderPage();
    await fire(() => lastPrep().onCloseClass());
    expect(h.calls).toContain('transition:cancel');
    expect(lastPrep().phase).toBe('closed');
    expect(lastPrep().stateKind).toBe('closed-0');
  });

  it('이미 닫힌 클래스에 다시 들어오면 closed-revisit', async () => {
    h.session = makeSession('cancelled');
    await renderPage();
    expect(lastPrep().stateKind).toBe('closed-revisit');
  });

  it('로비 도구: 시작 확인 시트용 익명 집계를 받아 넘긴다', async () => {
    h.session = makeSession('open');
    await renderPage();
    expect(lastPrep().excluded).toBe(2);
    expect(lastPrep().research).toBe(1);
  });

  it('세션을 못 받으면 서버 문구 없이 FH10 오류 화면(404=찾을 수 없는 클래스)을 보여 준다', async () => {
    const { ApiError } = await import('../src/lib/api/client');
    h.getClass.mockReset().mockResolvedValue({ id: 'class-1', revision: 1, status: 'active', capacity: 10, capabilities: { invite: true } });
  h.getSession.mockReset().mockRejectedValue(new ApiError(404, '서버 원문 메시지', null));
    await renderPage();
    expect(document.body.textContent).toContain('찾을 수 없는 클래스예요');
    expect(document.body.textContent).not.toContain('서버 원문 메시지');
  });
});

describe('호스트가 아닌 사용자는 옛 화면을 그대로 쓴다', () => {
  it('진행 중이라도 호스트가 아니면(기관관리자 등) 옛 모니터 화면이다', async () => {
    h.session = makeSession('in_progress', { host_id: 'someone-else' });
    await renderPage();
    expect(q('[data-testid="host-live-container"]')).toBeNull();
    expect(document.body.textContent).toContain('나가기');
  });
});

describe('T04 리뷰: 실제 페이지의 참여 갱신 경계',()=>{
  beforeEach(()=>{h.session=makeSession('in_progress',{class_id:'c1'});});
  const emitParticipant = (version:number, participants:unknown[]) => fire(()=>{
    const callback=h.liveOptions.onParticipantChanged as (event:unknown)=>void;
    callback({session_id:'s1',version:0,participation_version:version,participants});
  });
  it('최신 A+B roster 뒤 오래된 A 이벤트가 와도 B를 제거하지 않는다',async()=>{
    await renderPage();
    h.participation={sessionId:'s1',version:5,revoked:false,participants:{a:{participant_id:'a',entered_at:null,presence_state:'unknown'},b:{participant_id:'b',entered_at:null,presence_state:'unknown'}}};
    await emitParticipant(5,[metric('a'),metric('b')]);await emitParticipant(4,[metric('a')]);
    expect(lastProps().rows.map((row:{participant_id:string})=>row.participant_id)).toContain('b');
  });
  it('heartbeat의 참여상태만 갱신하고 최신 EEG 측정값은 유지한다',async()=>{
    await renderPage();const before=lastProps().rows.find((row:{participant_id:string})=>row.participant_id==='a');
    await emitParticipant(1,[metric('a',{device_status:null,current_efficiency:null,avg_efficiency:null,last_eeg_at:null})]);
    const after=lastProps().rows.find((row:{participant_id:string})=>row.participant_id==='a');
    expect(after.current_efficiency).toBe(before.current_efficiency);expect(after.last_eeg_at).toBe(before.last_eeg_at);expect(after.device_status).toBe('ok');
  });
  it('권한회수 뒤 페이지에 남아있는 BLE 훅의 session과 upload 자격도 비활성화한다',async()=>{
    await renderPage();expect(h.bandOptions.enabled).toBe(true);
    h.participation={sessionId:'s1',version:2,revoked:true,participants:{}};
    await fire(()=>{const cb=h.liveOptions.onSessionStateChanged as (event:unknown)=>void;cb({session_id:'s1',status:'in_progress',version:1});});
    expect(h.bandOptions.enabled).toBe(false);expect(h.bandOptions.sessionId).toBe('');expect(h.bandOptions.participantId).toBe(null);
  });
});
it('T04: REST 최신 roster 뒤 오래된 joined snapshot도 B의 EEG를 지우지 않는다',async()=>{
  h.session=makeSession('in_progress',{class_id:'c1'});await renderPage();
  const before=lastProps().rows.find((row:{participant_id:string})=>row.participant_id==='b');
  h.participation={sessionId:'s1',version:5,revoked:false,participants:{a:{participant_id:'a'},b:{participant_id:'b'}}};
  await fire(()=>{const cb=h.liveOptions.onSessionStateChanged as (event:unknown)=>void;cb({session_id:'s1',status:'in_progress',version:1});});
  await fire(()=>{const cb=h.liveOptions.onSnapshot as (event:unknown)=>void;cb({session_id:'s1',status:'in_progress',version:1,participation_version:4,participants:[metric('a')]});});
  expect(lastProps().rows.find((row:{participant_id:string})=>row.participant_id==='b').current_efficiency).toBe(before.current_efficiency);
});

it('T04 route reuse: A 버전50을 B에 이월하지 않고 B 버전1과2를 즉시 반영한다',async()=>{
  h.session=makeSession('in_progress',{class_id:'class-a'});
  h.participation={sessionId:'s1',version:50,revoked:false,participants:{a:{participant_id:'a'}}};
  await renderPage();
  // 훅이 effect에서 reset하기 전 첫 B 렌더에도 A 상태를 돌려주는 경계를 보존한다.
  h.session=makeSession('in_progress',{id:'s2',class_id:'class-b'});
  await act(async()=>{await pageRouter.navigate('/sessions/s2/player');});
  h.participation={sessionId:'s2',version:0,revoked:false,participants:{b:{participant_id:'b'}}};
  await fire(()=>{const cb=h.liveOptions.onSnapshot as (event:unknown)=>void;cb({session_id:'s2',status:'in_progress',version:1,participation_version:1,participants:[metric('b',{display_name:'B 최초'})]});});
  expect(lastProps().rows.find((row:{participant_id:string})=>row.participant_id==='b').display_name).toBe('B 최초');
  await fire(()=>{const cb=h.liveOptions.onParticipantChanged as (event:unknown)=>void;cb({session_id:'s2',version:1,participation_version:2,participants:[metric('b',{display_name:'B 최신'})]});});
  expect(lastProps().rows.find((row:{participant_id:string})=>row.participant_id==='b').display_name).toBe('B 최신');
});
it('T04 route reuse: B 로딩 중 A 데이터를 숨기고 늦은 A HTTP·joined 응답도 B를 덮지 않는다',async()=>{
  h.session=makeSession('in_progress',{class_id:'class-a'});await renderPage();
  const lateSnapshot=h.liveOptions.onSnapshot as (event:unknown)=>void;
  let oldMetrics!:(value:unknown)=>void;let oldSession!:(value:unknown)=>void;let newSession!:(value:unknown)=>void;
  h.getSessionLiveMetrics.mockImplementationOnce(()=>new Promise(resolve=>{oldMetrics=resolve;}));
  h.getSession.mockImplementationOnce(()=>new Promise(resolve=>{oldSession=resolve;}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
  h.getSession.mockImplementationOnce(()=>new Promise(resolve=>{newSession=resolve;}));
  h.getSessionLiveMetrics.mockResolvedValue({metrics:[metric('b',{display_name:'B 화면'})]});
  await act(async()=>{await pageRouter.navigate('/sessions/s2/player');});
  expect(q('[data-testid="host-live-container"]')).toBeNull();
  await act(async()=>newSession(makeSession('in_progress',{id:'s2',class_id:'class-b'})));
  await act(async()=>oldMetrics({metrics:[metric('old-a',{display_name:'과거 A'})]}));
  await act(async()=>oldSession(makeSession('in_progress',{class_id:'class-a'})));
  await fire(()=>lateSnapshot({session_id:'s1',status:'in_progress',version:5,participation_version:55,participants:[metric('old-a',{display_name:'과거 A'})]}));
  expect(lastProps().session.id).toBe('s2');
  expect(lastProps().rows.map((row:{participant_id:string})=>row.participant_id)).not.toContain('old-a');
});

describe('SDD-223 진행 화면 내부 초대', () => {
  it.each(['open', 'in_progress'])('%s에서 클래스 상세를 조회하고 화면 이동 없이 공용 시트를 연다', async status => {
    h.session = makeSession(status, { class_id: 'class-1' });
    await renderPage();
    expect(h.getClass).toHaveBeenCalledWith('class-1', expect.any(AbortSignal));
    const props = status === 'open' ? h.prepProps.at(-1)! : lastProps();
    if (status === 'open') expect(props.canInvite).toBe(true);
    await fire(status === 'open' ? props.onInviteAdd : props.onInvite);
    expect(q('[role="dialog"]')?.getAttribute('aria-label')).toBe('회원 초대');
    expect(pageRouter.state.location.pathname).toBe('/sessions/s1/player');
  });
  it.each([{ status: 'completed', invite: true }, { status: 'active', invite: false }])('클래스 상태 $status, invite=$invite이면 초대를 숨긴다', async value => {
    h.getClass.mockResolvedValue({ id: 'class-1', status: value.status, capabilities: { invite: value.invite } });
    h.session = makeSession('in_progress', { class_id: 'class-1' });
    await renderPage(); expect(lastProps().onInvite).toBeUndefined();
  });
});
