// @vitest-environment jsdom
// SDD-208 I1 — ClassPlayerPage 의 진행 중(in_progress) 호스트 구간이 새 HostLiveContainer 로 바뀌고,
// 세팅·대기 씬은 그대로 옛 HostClassWorkspace 를 쓴다. 페이지는 컨테이너에 값·핸들러만 넘기고 종료 모달·채팅 오버레이는 중복으로 두지 않는다.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClassPlayerPage from '../src/pages/sessions/ClassPlayerPage';
import { useAuthStore } from '../src/stores/authStore';

const h = vi.hoisted(() => ({
  containerProps: [] as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
  session: {} as Record<string, unknown>,
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

vi.mock('../src/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/session')>()),
  getSession: (...a: unknown[]) => h.getSession(...a),
  getSessionLiveMetrics: (...a: unknown[]) => h.getSessionLiveMetrics(...a),
  setParticipantSpeaking: (...a: unknown[]) => h.setParticipantSpeaking(...a),
  transitionSession: (...a: unknown[]) => h.transitionSession(...a),
}));
vi.mock('../src/lib/api/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/chat')>()),
  setSessionChatEnabled: (...a: unknown[]) => h.setSessionChatEnabled(...a),
}));
vi.mock('../src/lib/api/audio', () => ({ startAudio: vi.fn(), stopAudio: vi.fn() }));
vi.mock('../src/lib/api/video', () => ({ startVideo: vi.fn(), stopVideo: vi.fn() }));
vi.mock('../src/lib/socket', () => ({ getActiveSessionLiveSocket: () => h.rawSocket }));
vi.mock('../src/hooks/useAudioRecorder', () => ({ useAudioRecorder: () => h.recorder }));
vi.mock('../src/hooks/useVideoRecorder', () => ({ useVideoRecorder: () => h.videoRecorder }));
vi.mock('../src/hooks/useBand', () => ({
  useBand: () => ({
    isSupported: true, isMock: false, connectionState: 'disconnected', battery: null, deviceStatus: null, signalQualityLevel: 'unknown',
    signalQuality: null, lastEegAt: null, currentEfficiency: null, uploadStatus: null, error: null,
    connect: vi.fn(), disconnect: vi.fn(),
  }),
}));
vi.mock('../src/hooks/useLiveKit', () => ({ useLiveKit: () => h.liveKit }));
vi.mock('../src/hooks/useSessionLiveSocket', () => ({
  useSessionLiveSocket: () => ({ isConnected: true, isReady: true, hasSnapshot: true, sendSignal: vi.fn(), sendAudioSync: vi.fn() }),
}));
vi.mock('../src/hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }));
vi.mock('../src/hooks/useLeaveGuard', () => ({ useLeaveGuard: () => ({ state: 'unblocked' }) }));
vi.mock('../src/hooks/useWaitingRoomCount', () => ({ useWaitingRoomCount: () => ({ entries: [], count: 0, nicknames: [] }) }));
vi.mock('../src/hooks/useClassAudioPlayer', () => ({ useClassAudioPlayer: () => ({ state: {}, actions: {} }) }));
vi.mock('../src/hooks/useReportProgress', () => ({ useReportProgress: () => ({ progress: null }) }));
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
vi.mock('../src/components/class/waiting-room-readiness-panel', () => ({ WaitingRoomReadinessPanel: () => null }));
vi.mock('../src/components/class/ClassAudioPanel', () => ({ ClassAudioPanel: () => null }));
vi.mock('../src/components/session/SessionPreJoinPreview', () => ({ SessionPreJoinPreview: () => createElement('div', null, '미디어 프리뷰') }));

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
async function renderPage(): Promise<void> {
  const router = createMemoryRouter(
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
  h.containerProps.length = 0;
  Object.assign(h.liveKit, { token: null, loading: false, error: null });
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

  it('종료: 요청 → 모달 열림 → 확정하면 end 전이 후 기록 페이지로 이동', async () => {
    await renderPage();
    expect(lastProps().end.open).toBe(false);
    await act(async () => { lastProps().end.onRequest(); });
    expect(lastProps().end.open).toBe(true);
    await act(async () => { lastProps().end.onCancel(); });
    expect(lastProps().end.open).toBe(false);
    await act(async () => { lastProps().end.onRequest(); });
    await fire(() => lastProps().end.onConfirm());
    expect(h.liveKit.disconnect).toHaveBeenCalled();
    expect(h.transitionSession).toHaveBeenCalledWith('s1', 'end');
    expect(document.body.textContent).toContain('기록 화면');
  });

  it('종료가 실패하면 오류와 endFailed 를 알리고, [종료 재시도]로 다시 시도한다', async () => {
    h.transitionSession.mockRejectedValueOnce(new Error('서버 오류'));
    await renderPage();
    await fire(() => lastProps().end.onConfirm());
    expect(lastProps().status).toMatchObject({ error: '서버 오류', endFailed: true });
    await fire(() => lastProps().status.onRetryEnd());
    expect(h.transitionSession).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('기록 화면');
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

describe('진행 중이 아닌 씬·호스트가 아닌 사용자는 옛 화면을 그대로 쓴다', () => {
  it('대기실(open)의 호스트는 옛 워크스페이스와 채팅 오버레이를 본다', async () => {
    h.session = makeSession('open');
    await renderPage();
    expect(q('[data-testid="host-live-container"]')).toBeNull();
    expect(q('.host-class-player')).not.toBeNull();
    expect(q('[data-testid="page-chat-overlay"]')).not.toBeNull();
  });

  it('세팅(ready)의 호스트는 미디어 프리뷰가 있는 옛 워크스페이스를 본다', async () => {
    h.session = makeSession('ready');
    await renderPage();
    expect(q('[data-testid="host-live-container"]')).toBeNull();
    expect(document.body.textContent).toContain('미디어 프리뷰');
  });

  it('진행 중이라도 호스트가 아니면(기관관리자 등) 옛 모니터 화면이다', async () => {
    h.session = makeSession('in_progress', { host_id: 'someone-else' });
    await renderPage();
    expect(q('[data-testid="host-live-container"]')).toBeNull();
    expect(document.body.textContent).toContain('나가기');
  });
});
