// @vitest-environment jsdom
// SDD-208 M5 — 회원 컨테이너: 훅 조립(useBand·소켓·LiveKit·오디오·채팅)과 뷰 모델 변환. 훅은 모킹한다.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberClassContainer } from '../src/components/class/player/member/MemberClassContainer';
import { useAuthStore } from '../src/stores/authStore';
import { EEG_STALE_MS } from '../src/lib/session-live/signal-status';

/* ───────── 모킹 ───────── */
const h = vi.hoisted(() => {
  const band = {
    isSupported: true,
    isMock: false,
    connectionState: 'connected' as string,
    battery: 82 as number | null,
    signalQualityLevel: 'ok',
    deviceStatus: 'ok' as string | null,
    leadOff: null,
    get lastEegAt(): string { return new Date(Date.now() - 500).toISOString(); },
    scoredIndices: { focusIndex: 58, relaxationIndex: 72, emotionalStability: 64 } as Record<string, number> | null,
    heartRate: 68 as number | null,
    respiratoryRate: 11 as number | null,
    sdnn: 52 as number | null,
    pendingCount: 0,
    error: null as string | null,
    connectedElapsedSec: 720,
    getEegWaveformSamples: () => ({ fp1: [1, 2, 3, 2, 1], fp2: [2, 1, 2, 3, 2] }),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  return {
    band,
    bandOptions: [] as Array<Record<string, unknown>>,
    socketOptions: [] as Array<Record<string, unknown>>,
    socket: { isConnected: true, sendSignal: vi.fn(() => 'sent' as const) },
    rawSocket: { connected: false, connect: vi.fn() },
    lk: {
      token: 'tok' as string | null, canPublish: true, error: null as string | null, notReady: false, attemptCount: 0, serverUrl: 'wss://lk.test',
      speaking: false, raisedHand: false, raising: false, raiseHandError: null as string | null,
      connect: vi.fn(async () => undefined), disconnect: vi.fn(), raiseHand: vi.fn(async () => undefined), roomId: null, loading: false,
    },
    lkOptions: [] as Array<Record<string, unknown>>,
    audio: { state: { track: null as { title: string } | null, playing: false, positionSec: 0, durationSec: null, volume: 0.6, blocked: false, synced: false, drift: 0 }, setVolume: vi.fn(), resume: vi.fn() },
    audioOptions: [] as Array<Record<string, unknown>>,
    getSession: vi.fn(),
    getEntryState: vi.fn(),
    chatProps: [] as Array<Record<string, unknown>>,
    unread: 0,
    roomConnection: 'connected',
    roomProps: [] as Array<Record<string, unknown>>,
    rendererVolume: [] as number[],
  };
});

vi.mock('../src/hooks/useBand', () => ({
  useBand: (options: Record<string, unknown>) => {
    h.bandOptions.push(options);
    return h.band;
  },
}));
vi.mock('../src/hooks/useSessionLiveSocket', () => ({
  useSessionLiveSocket: (options: Record<string, unknown>) => {
    h.socketOptions.push(options);
    return h.socket;
  },
}));
vi.mock('../src/hooks/useMemberLiveKit', () => ({
  useMemberLiveKit: (options: Record<string, unknown>) => {
    h.lkOptions.push(options);
    return h.lk;
  },
}));
vi.mock('../src/hooks/useGuestAudioSync', () => ({
  useGuestAudioSync: (options: Record<string, unknown>) => {
    h.audioOptions.push(options);
    return h.audio;
  },
}));
vi.mock('../src/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/session')>()),
  getSession: (...args: unknown[]) => h.getSession(...args),
}));
vi.mock('../src/lib/api/class-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-flow')>()),
  getEntryState: (...args: unknown[]) => h.getEntryState(...args),
}));
vi.mock('../src/lib/socket', () => ({ getActiveSessionLiveSocket: () => h.rawSocket }));
vi.mock('../src/components/chat/ClassChatPanel', async () => {
  const React = await import('react');
  return {
    ClassChatPanel: (props: Record<string, unknown> & { collapsed: boolean; onUnreadChange?: (n: number) => void }) => {
      h.chatProps.push(props);
      React.useEffect(() => { props.onUnreadChange?.(h.unread); });
      return props.collapsed ? null : React.createElement('p', { 'data-testid': 'chat-panel' }, '채팅방');
    },
  };
});
vi.mock('../src/components/class/ClassOnboardingCoachmarks', () => ({ ClassOnboardingCoachmarks: () => null }));
vi.mock('@livekit/components-react', async () => {
  const React = await import('react');
  return {
    LiveKitRoom: (props: Record<string, unknown> & { children?: ReactNode }) => {
      h.roomProps.push({ ...props, children: undefined });
      return React.createElement('div', { 'data-testid': 'lk-room' }, props.children);
    },
    RoomAudioRenderer: ({ volume }: { volume?: number }) => {
      h.rendererVolume.push(volume ?? 1);
      return null;
    },
    useLocalParticipant: () => ({
      localParticipant: { setCameraEnabled: vi.fn(async () => undefined), setMicrophoneEnabled: vi.fn(async () => undefined) },
      isCameraEnabled: false,
      isMicrophoneEnabled: true,
    }),
    useTracks: () => [],
    useConnectionState: () => h.roomConnection,
  };
});

/* ───────── 도우미 ───────── */
let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);
const qa = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (): string => document.body.textContent ?? '';
const buttonByText = (label: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
const dockButton = (label: string): HTMLButtonElement | undefined =>
  qa('[data-pz="dk"]').find((b) => b.querySelector('.pz-dk__label')?.textContent === label) as HTMLButtonElement | undefined;
async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

interface Props {
  locationType?: 'online' | 'offline';
  participantMode?: 'one_on_one' | 'group';
  maxParticipants?: number;
  linkbandMode?: 'required' | 'optional' | 'none';
  waitlisted?: boolean;
  onLeave?: () => void;
}

function Container({ locationType = 'online', participantMode = 'one_on_one', maxParticipants = 1, linkbandMode, waitlisted, onLeave = () => undefined }: Props) {
  return (
    <MemberClassContainer
      title="마음챙김 명상수업 · 4회차"
      startedAt={new Date(Date.now() - 754_000).toISOString()}
      durationMin={30}
      onLeave={onLeave}
      sessionId="s1"
      participantId="p1"
      entryCredential="cred"
      hostName="채용욱"
      locationType={locationType}
      participantMode={participantMode}
      maxParticipants={maxParticipants}
      linkbandMode={linkbandMode}
      waitlisted={waitlisted}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-16T05:00:00Z'));
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  // jsdom 에는 matchMedia 가 없다 — 교차 페이드 배경(FadingImageBackground)이 움직임 줄이기 설정을 읽는다
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }),
  });
  Object.defineProperty(h.band, 'lastEegAt', { configurable: true, get: () => new Date(Date.now() - 500).toISOString() });
  Object.assign(h.band, {
    isSupported: true, isMock: false, connectionState: 'connected', battery: 82, signalQualityLevel: 'ok', deviceStatus: 'ok',
    scoredIndices: { focusIndex: 58, relaxationIndex: 72, emotionalStability: 64 }, heartRate: 68, respiratoryRate: 11, sdnn: 52,
    pendingCount: 0, error: null,
  });
  h.band.connect.mockClear();
  h.band.disconnect.mockClear();
  h.bandOptions.length = 0;
  h.socketOptions.length = 0;
  h.lkOptions.length = 0;
  h.audioOptions.length = 0;
  h.chatProps.length = 0;
  h.roomProps.length = 0;
  h.rendererVolume.length = 0;
  h.unread = 0;
  h.roomConnection = 'connected';
  Object.assign(h.socket, { isConnected: true });
  h.socket.sendSignal.mockClear();
  h.rawSocket.connect.mockClear();
  Object.assign(h.lk, { token: 'tok', canPublish: true, speaking: false, raisedHand: false, error: null, notReady: false, attemptCount: 0 });
  h.lk.connect.mockClear();
  h.lk.raiseHand.mockClear();
  Object.assign(h.audio.state, { track: null, volume: 0.6, blocked: false, synced: false });
  h.audio.setVolume.mockClear();
  h.audio.resume.mockClear();
  h.getSession.mockReset().mockResolvedValue({ host_id: 'h1', participants: [], chat_enabled: true, chat_room_id: 'room-1' });
  h.getEntryState.mockReset().mockResolvedValue({ chat_enabled: false });
  useAuthStore.setState({
    isAuthenticated: true,
    user: { name: '김수연', counselors: [{ id: 'h1', name: '채용욱', profile_image: null }] } as unknown as ReturnType<typeof useAuthStore.getState>['user'],
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/* ───────── 테스트 ───────── */

describe('데이터 → 뷰 모델', () => {
  it('연결된 밴드의 값이 링에 나오고, 제목·시계·상담사 이름이 채워진다', async () => {
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="ring"]')?.textContent).toContain('이완도');
    expect(q('[data-pz="ring"] .pz-ring__num b')?.textContent).toBe('72');
    expect(q('[data-pz="title"]')?.textContent).toContain('마음챙김 명상수업 · 4회차');
    expect(q('[data-pz="title"]')?.textContent).toMatch(/12:3[4-6]/);
    expect(q('[data-pz="pip"]')).toBeNull(); // 상담사 카메라 트랙이 없으면 PiP 없음
  });
  it('밴드 상태 파생: 처음부터 미연결이면 미착용(off), 연결했다 끊기면 끊김(lost)', async () => {
    h.band.connectionState = 'disconnected';
    h.band.deviceStatus = 'disconnected';
    await render(<Container />);
    expect(q('[data-pz="ring"]')?.getAttribute('data-core')).toBe('msg');
    expect(q('[data-pz="info-card"]')?.textContent).toContain('원하시면 기기에서 LINK BAND를 연결할 수 있어요.');
    h.band.connectionState = 'connected';
    h.band.deviceStatus = 'ok';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="ring"]')?.getAttribute('data-core')).toBe('gauge');
    h.band.connectionState = 'disconnected';
    h.band.deviceStatus = 'disconnected';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="ring"]')?.getAttribute('data-core')).toBe('dim');
    expect(q('[data-pz="info-card"]')?.textContent).toContain('다시 연결해도 앞서 측정한 값은 안전하게 보관돼요.');
  });
  it('EEG 수신이 EEG_STALE_MS 이상 끊기면 끊김으로 본다(연결 플래그만 믿지 않는다)', async () => {
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="ring"]')?.getAttribute('data-core')).toBe('gauge');
    Object.defineProperty(h.band, 'lastEegAt', { configurable: true, get: () => new Date(Date.now() - EEG_STALE_MS - 2000).toISOString() });
    await advance(1000);
    expect(q('[data-pz="ring"]')?.getAttribute('data-core')).toBe('dim');
  });
  it('접촉 불량(lead_off)·신호 약함·배터리 부족·미지원이 그대로 화면 상태가 된다', async () => {
    h.band.deviceStatus = 'lead_off';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="ring"]')?.textContent).toMatch(/접촉을 확인해\s*주세요/);
    h.band.deviceStatus = 'ok';
    h.band.signalQualityLevel = 'degraded';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="guide"]')?.textContent).toContain('접촉이 약해요');
    h.band.signalQualityLevel = 'ok';
    h.band.battery = 12;
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="guide"]')?.textContent).toBe('배터리가 12%예요 · 곧 충전해 주세요');
    h.band.battery = 82;
    h.band.connectionState = 'unsupported';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="guide"]')?.textContent).toBe('이 브라우저에서는 밴드 연결이 안 돼요');
  });
  it('상담사 이름: 클래스 요약에서 받은 hostName 을 그대로 쓰고 이름 때문에 따로 조회하지 않는다', async () => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
    await render(<Container waitlisted />);
    expect(document.body.textContent).toContain('채용욱 상담사');
    expect(h.getSession).not.toHaveBeenCalled();
  });
});

describe('실시간 소켓 구독', () => {
  it('eeg_feature·audio_sync 콜백만 등록하고 그룹 평균(onGroupAverage)은 구독하지 않는다(F5·합의 #5)', async () => {
    await render(<Container />);
    const options = h.socketOptions.at(-1)!;
    expect(options).toMatchObject({ sessionId: 's1', participantId: 'p1', enabled: true, skipAuth: false });
    expect(typeof options.onEegFeature).toBe('function');
    expect(typeof options.onClassAudioSync).toBe('function');
    expect('onGroupAverage' in options).toBe(false);
    expect(options.onGroupAverage).toBeUndefined();
  });
  it('게스트는 skipAuth 로 연결한다', async () => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
    await render(<Container />);
    expect(h.socketOptions.at(-1)).toMatchObject({ skipAuth: true });
    expect(h.bandOptions.at(-1)).toMatchObject({ skipAuth: true });
  });
  it('밴드 링크가 끊긴 동안에도 내 eeg_feature(서버값)는 이완도로 이어 보여 주고, 남의 이벤트는 무시한다', async () => {
    await render(<Container />);
    await advance(1000);
    h.band.connectionState = 'disconnected';
    h.band.deviceStatus = 'disconnected';
    h.band.scoredIndices = null;
    await render(<Container />);
    expect(q('[data-pz="ring"]')?.getAttribute('data-core')).toBe('dim');
    expect(q('[data-pz="ring"] .pz-ring__num')).toBeNull();
    const onEeg = h.socketOptions.at(-1)!.onEegFeature as (event: Record<string, unknown>) => void;
    await act(async () => { onEeg({ participant_id: 'other', session_id: 's1', current_efficiency: 90 }); });
    expect(q('[data-pz="ring"] .pz-ring__num')).toBeNull();
    await act(async () => { onEeg({ participant_id: 'p1', session_id: 's1', current_efficiency: 50 }); });
    expect(q('[data-pz="ring"] .pz-ring__num b')?.textContent).toMatch(/^\d+$/);
    await act(async () => { onEeg({ participant_id: 'p1', session_id: 'other-session', current_efficiency: 10 }); });
  });
  it('class:group_average 같은 평균 이벤트가 있어도 화면에 평균·그룹 문구가 없다', async () => {
    await render(<Container />);
    await advance(1000);
    await act(async () => { dockButton('내 상태')?.click(); });
    expect(text()).not.toMatch(/그룹|평균|순위|상위|하위|종합|총점|점수/);
  });
});

describe('1Hz 링버퍼(5분)', () => {
  it('300초가 쌓이면 "5분간 ±N" 추이가 보이고, 값이 바뀌면 변화량이 반영된다', async () => {
    await render(<Container />);
    await advance(5000);
    expect(q('[data-pz="trend"]')?.textContent).toContain('측정 중');
    // 이완도가 60 → 72 로 오르는 5분
    for (let i = 0; i < 300; i += 1) {
      h.band.scoredIndices = { focusIndex: 58, relaxationIndex: 60 + (12 * i) / 299, emotionalStability: 64 };
      await advance(1000);
    }
    expect(q('[data-pz="trend"]')?.textContent).toMatch(/5분간 \+1[0-2]/);
  });
  it('접촉 불량·끊김 동안은 전 지표를 미측정으로 두어 값이 쌓이지 않는다', async () => {
    h.band.deviceStatus = 'lead_off';
    await render(<Container />);
    await advance(60_000);
    h.band.deviceStatus = 'ok';
    await advance(1000);
    expect(q('[data-pz="trend"]')?.textContent).toContain('측정 중');
  });
});

describe('채팅', () => {
  it('로그인 회원: 5초마다 chat_enabled 를 조회하고 시트가 닫혀 있어도 안읽음 배지를 올린다', async () => {
    h.unread = 3;
    await render(<Container />);
    await advance(5000);
    expect(h.getSession.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.chatProps.at(-1)).toMatchObject({ sessionId: 's1', enabled: true, roomId: 'room-1', embedded: true, collapsed: true });
    expect(q('.pz-dk__badge')?.textContent).toBe('3');
  });
  it('채팅 시트를 열면 collapsed=false 로 바뀌어 채팅방이 보이고 배지는 사라진다', async () => {
    await render(<Container />);
    await advance(1000);
    h.unread = 0;
    await act(async () => { dockButton('채팅')?.click(); });
    expect(h.chatProps.at(-1)).toMatchObject({ collapsed: false });
    expect(q('[data-pz="sheet"] [data-testid="chat-panel"]')).not.toBeNull();
  });
  it('비회원: 입장 자격으로 상태를 조회해 채팅이 켜져 있으면 회원 전용 안내를 보여 준다', async () => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
    h.getEntryState.mockResolvedValue({ chat_enabled: true });
    await render(<Container />);
    await advance(100);
    expect(h.getEntryState).toHaveBeenCalledWith('s1', 'cred');
    await act(async () => { dockButton('채팅')?.click(); });
    expect(q('[data-pz="sheet"]')?.textContent).toContain('채팅은 회원 전용이에요');
  });
  it('채팅 상태 조회가 실패해도 클래스 진행에 영향이 없다', async () => {
    h.getSession.mockRejectedValue(new Error('network'));
    await render(<Container />);
    await advance(5000);
    expect(q('[data-pz="ring"]')).not.toBeNull();
  });
});

describe('접촉 불량 안내 상태(LeadOffModal → 시트)', () => {
  it('lead_off 가 되면 기기 시트가 자동으로 열리고 [접촉 다시 확인] 으로 접으면 다시 자동으로 열리지 않는다', async () => {
    h.band.deviceStatus = 'lead_off';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="sheet"]')?.getAttribute('aria-label')).toBe('접촉 확인');
    await act(async () => { buttonByText('접촉 다시 확인')?.click(); });
    expect(q('[data-pz="sheet"]')).toBeNull();
    await advance(3000);
    expect(q('[data-pz="sheet"]')).toBeNull();
    // 도크에서는 언제든 다시 열 수 있다
    await act(async () => { dockButton('기기')?.click(); });
    expect(q('[data-pz="sheet"]')?.getAttribute('aria-label')).toBe('접촉 확인');
  });
  it('접촉이 복구되면 15초 동안 "AI 분석중"이 기기 시트에 보인다', async () => {
    h.band.deviceStatus = 'lead_off';
    await render(<Container />);
    await advance(1000);
    h.band.deviceStatus = 'ok';
    await render(<Container />);
    await advance(1000);
    await act(async () => { dockButton('기기')?.click(); });
    expect(q('[data-pz="sheet"]')?.textContent).toContain('AI 분석중');
    await advance(15_000);
    expect(q('[data-pz="sheet"]')?.textContent).not.toContain('AI 분석중');
  });
  it('자동으로 열린 접촉 확인 시트는 접촉이 복구되면 저절로 닫힌다(직접 연 시트는 건드리지 않는다)', async () => {
    h.band.deviceStatus = 'lead_off';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="sheet"]')?.getAttribute('aria-label')).toBe('접촉 확인');
    h.band.deviceStatus = 'ok';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="sheet"]')).toBeNull();
    // 사용자가 직접 연 기기 시트는 복구 때 닫히지 않는다
    await act(async () => { dockButton('기기')?.click(); });
    h.band.deviceStatus = 'lead_off';
    await render(<Container />);
    await advance(1000);
    await act(async () => { buttonByText('접촉 다시 확인')?.click(); });
    await act(async () => { dockButton('기기')?.click(); });
    h.band.deviceStatus = 'ok';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="sheet"]')?.getAttribute('aria-label')).toBe('기기');
  });
  it('새로 lead_off 가 되면(무시한 뒤라도) 안내가 다시 자동으로 열린다', async () => {
    h.band.deviceStatus = 'lead_off';
    await render(<Container />);
    await advance(1000);
    await act(async () => { buttonByText('접촉 다시 확인')?.click(); });
    h.band.deviceStatus = 'ok';
    await render(<Container />);
    await advance(1000);
    h.band.deviceStatus = 'lead_off';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="sheet"]')?.getAttribute('aria-label')).toBe('접촉 확인');
  });
});

describe('밴드 조작', () => {
  it('연결·해제·취소·재연결은 useBand 의 같은 인스턴스(한 번만 호출)로 전달된다', async () => {
    h.band.connectionState = 'disconnected';
    h.band.deviceStatus = 'disconnected';
    await render(<Container />);
    await act(async () => { dockButton('기기')?.click(); });
    await act(async () => { buttonByText('LINK BAND 연결')?.click(); });
    // SDD-220 TS26: OS 권한 요청 전 사전 안내를 거친다(확인 전에는 연결하지 않는다).
    expect(h.band.connect).not.toHaveBeenCalled();
    await act(async () => { buttonByText('확인하고 계속')?.click(); });
    expect(h.band.connect).toHaveBeenCalledTimes(1);
    expect(new Set(h.bandOptions.map((o) => JSON.stringify(o))).size).toBe(1);
  });
  it('연결 대기 중 [취소] → band.disconnect()', async () => {
    h.band.connectionState = 'connecting';
    h.band.deviceStatus = 'disconnected';
    await render(<Container />);
    await act(async () => { buttonByText('취소')?.click(); });
    expect(h.band.disconnect).toHaveBeenCalledTimes(1);
  });
  it('[밴드 없이 계속](미지원 브라우저) → 밴드 UI 를 접는다', async () => {
    h.band.connectionState = 'unsupported';
    await render(<Container />);
    await act(async () => { buttonByText('밴드 없이 계속')?.click(); });
    expect(qa('[data-pz="dk"]').map((el) => el.querySelector('.pz-dk__label')?.textContent)).toEqual(['채팅', '조용한 신호', '소리']);
  });
  it('linkband_mode=none: 기기·내 상태 도크와 밴드 안내가 없다(D7)', async () => {
    await render(<Container linkbandMode="none" />);
    expect(qa('[data-pz="dk"]').map((el) => el.querySelector('.pz-dk__label')?.textContent)).toEqual(['채팅', '조용한 신호', '소리']);
    expect(q('[data-pz="ring"]')?.textContent).toMatch(/함께하는\s*수업이에요/);
  });
});

describe('조용한 신호·종료·화면 끄기', () => {
  it('신호 버튼 → useSessionLiveSocket.sendSignal', async () => {
    await render(<Container />);
    await act(async () => { dockButton('조용한 신호')?.click(); });
    await act(async () => { qa('[data-pz="sheet"] .player-signal')[1].click(); });
    expect(h.socket.sendSignal).toHaveBeenCalledWith('difficult');
  });
  it('나가기: 확인 모달 → 확정할 때만 onLeave', async () => {
    const onLeave = vi.fn();
    await render(<Container onLeave={onLeave} />);
    await act(async () => { q<HTMLButtonElement>('[data-pz="leave"]')?.click(); });
    expect(onLeave).not.toHaveBeenCalled();
    expect(text()).toContain('나가시겠어요?');
    await act(async () => { buttonByText('계속 진행')?.click(); });
    expect(onLeave).not.toHaveBeenCalled();
    await act(async () => { q<HTMLButtonElement>('[data-pz="leave"]')?.click(); });
    await act(async () => { buttonByText('나가기')?.click(); });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
  it('화면 끄기: 검정 덮개 + 시계, [화면 켜기] 로 복귀', async () => {
    await render(<Container />);
    await act(async () => { dockButton('소리')?.click(); });
    await act(async () => { buttonByText('화면 끄기')?.click(); });
    const overlay = q('[data-testid="member-screen-off"]');
    expect(overlay?.getAttribute('aria-hidden')).toBe('false');
    expect(overlay?.textContent).toMatch(/\d\d:\d\d/);
    expect(q('[data-pz="app"]')?.closest('[inert]')).not.toBeNull();
    await act(async () => { buttonByText('화면 켜기')?.click(); });
    expect(q('[data-testid="member-screen-off"]')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('스피커·오디오', () => {
  it('온라인 기본 스피커 ON · 오프라인 기본 OFF, 소리 시트에서 바꾸면 방의 상담사 음성 볼륨이 따라간다', async () => {
    await render(<Container />);
    expect(h.rendererVolume.at(-1)).toBe(1);
    await act(async () => { dockButton('소리')?.click(); });
    await act(async () => { q<HTMLButtonElement>('[data-pz="sheet"] [role="switch"]')?.click(); });
    expect(h.rendererVolume.at(-1)).toBe(0);
  });
  it('오프라인 수업은 LiveKit 방을 만들지 않고 가이드 오디오도 재생하지 않는다', async () => {
    await render(<Container locationType="offline" participantMode="group" maxParticipants={30} />);
    expect(q('[data-testid="lk-room"]')).toBeNull();
    expect(h.audioOptions.at(-1)).toMatchObject({ enabled: false });
    expect(q('[data-pz="side-card"]')).not.toBeNull();
    expect(q('[data-pz="media-row"]')).toBeNull();
  });
  it('온라인: 가이드 동기 재생 상태가 소리 시트에 나온다(볼륨 변경 → setVolume)', async () => {
    Object.assign(h.audio.state, { track: { title: '고요한 숲의 아침' }, synced: true });
    await render(<Container />);
    expect(h.audioOptions.at(-1)).toMatchObject({ enabled: true });
    await act(async () => { dockButton('소리')?.click(); });
    expect(q('[data-pz="sheet"]')?.textContent).toContain('고요한 숲의 아침');
    const slider = q<HTMLInputElement>('[data-pz="sheet"] input[type="range"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(slider, '30');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(h.audio.setVolume).toHaveBeenCalledWith(0.3);
  });
});

describe('LiveKit·미디어 연결', () => {
  it('온라인 1:1: 방 입장(connect) 후 video=false 로 연결하고 카메라는 회원이 켠다(P8)', async () => {
    await render(<Container />);
    expect(h.lk.connect).toHaveBeenCalled();
    expect(h.roomProps.at(-1)).toMatchObject({ video: false, audio: true, token: 'tok' });
    expect(h.lkOptions.at(-1)).toMatchObject({ participantId: 'p1', entryCredential: 'cred', sessionId: 's1' });
    expect(h.lkOptions.at(-1)).not.toHaveProperty('code');
    expect(h.lkOptions.at(-1)).not.toHaveProperty('participantToken');
  });
  it('온라인 그룹(≤20)은 발언권 이벤트를 듣고(listenSpeakingChanges) 손들기를 서버에 보낸다', async () => {
    h.lk.canPublish = false;
    await render(<Container participantMode="group" maxParticipants={10} />);
    expect(h.lkOptions.at(-1)).toMatchObject({ listenSpeakingChanges: true });
    expect(qa('[data-pz="mbtn"]').map((b) => b.textContent)).toEqual(['뮤트 중', '손들기']);
    await act(async () => { buttonByText('손들기')?.click(); });
    expect(h.lk.raiseHand).toHaveBeenCalledTimes(1);
  });
  it('온라인 그룹 20명 초과: 수신 전용 — 마이크·카메라·손들기 없음', async () => {
    h.lk.canPublish = false;
    await render(<Container participantMode="group" maxParticipants={30} />);
    expect(h.lkOptions.at(-1)).toMatchObject({ listenSpeakingChanges: false });
    expect(q('[data-pz="media-row"]')).toBeNull();
    expect(text()).not.toContain('기본 뮤트');
  });
  it('상담사 화상이 아직 시작되지 않았으면(notReady) 지수 백오프로 다시 연결한다', async () => {
    h.lk.token = null;
    h.lk.notReady = true;
    h.lk.attemptCount = 0;
    await render(<Container />);
    expect(h.lk.connect).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(h.lk.connect).toHaveBeenCalledTimes(2);
  });
});

describe('네트워크 상태(M18·M19)', () => {
  it('소켓이 끊기면 재연결 배너, 15초 이상 지속되면 끊김 카드, 복구되면 해제', async () => {
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="banner"]')).toBeNull();
    h.socket.isConnected = false;
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="banner"]')?.textContent).toContain('연결이 불안정해요');
    await advance(15_000);
    expect(q('[data-pz="net-down"]')?.textContent).toContain('연결이 끊겼어요');
    h.socket.isConnected = true;
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="net-down"]')).toBeNull();
    expect(q('[data-pz="banner"]')).toBeNull();
  });
  it('처음 연결되기 전의 isConnected=false 는 끊김으로 보지 않는다', async () => {
    h.socket.isConnected = false;
    await render(<Container />);
    await advance(30_000);
    expect(q('[data-pz="banner"]')).toBeNull();
    expect(q('[data-pz="net-down"]')).toBeNull();
    h.socket.isConnected = true;
  });
  it('LiveKit 이 재연결 중이면 소켓이 살아 있어도 재연결 배너', async () => {
    await render(<Container />);
    await advance(1000);
    h.roomConnection = 'reconnecting';
    await render(<Container />);
    await advance(1000);
    expect(q('[data-pz="banner"]')).not.toBeNull();
  });
  it('[다시 연결] → LiveKit 토큰 재요청과 소켓 재연결 시도', async () => {
    await render(<Container />);
    await advance(1000);
    h.socket.isConnected = false;
    await render(<Container />);
    await advance(16_000);
    h.lk.connect.mockClear();
    await act(async () => { buttonByText('다시 연결')?.click(); });
    expect(h.lk.connect).toHaveBeenCalledTimes(1);
    expect(h.rawSocket.connect).toHaveBeenCalledTimes(1);
    h.socket.isConnected = true;
  });
  it('끊김 카드에는 보관 중인 밴드 데이터가 있을 때만 보관 문구', async () => {
    h.band.pendingCount = 7;
    await render(<Container />);
    await advance(1000);
    h.socket.isConnected = false;
    await render(<Container />);
    await advance(16_000);
    expect(q('[data-pz="net-down"]')?.textContent).toContain('안전하게 보관 중이에요');
    h.socket.isConnected = true;
  });
});

describe('대기열(M20)', () => {
  it('waitlisted 이면 대기 화면만 보이고 밴드·소켓·LiveKit 연결을 하지 않는다', async () => {
    await render(<Container waitlisted />);
    expect(q('[data-pz="fv-card"]')?.textContent).toContain('대기 중이에요');
    expect(q('[data-pz="ring"]')).toBeNull();
    expect(h.bandOptions.at(-1)).toMatchObject({ enabled: false });
    expect(h.socketOptions.at(-1)).toMatchObject({ enabled: false });
    expect(h.lk.connect).not.toHaveBeenCalled();
  });
  it('[대기열에서 나가기] → onLeave(확인 모달 없이)', async () => {
    const onLeave = vi.fn();
    await render(<Container waitlisted onLeave={onLeave} />);
    await act(async () => { buttonByText('대기열에서 나가기')?.click(); });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
  it('로그인 회원에게만 푸시 안내', async () => {
    await render(<Container waitlisted />);
    expect(text()).toContain('푸시');
    useAuthStore.setState({ isAuthenticated: false, user: null });
    await render(<Container waitlisted />);
    expect(text()).not.toContain('푸시');
  });
});

describe('정적 검사 — verify §5', () => {
  const dir = resolve(__dirname, '../src/components/class/player/member');
  const sources = readdirSync(dir).filter((f) => /\.(tsx?|css)$/.test(f)).map((f) => ({ name: f, code: readFileSync(join(dir, f), 'utf8') }));
  const caseSource = readFileSync(resolve(__dirname, '../src/lib/class/member-player-case.ts'), 'utf8');

  it('X1: 회원 번들 경로에 그룹 평균 코드·문구가 없다', () => {
    // verify X1: 주석까지 포함해 문자열 자체가 0 이어야 한다
    for (const { name, code } of [...sources, { name: 'member-player-case.ts', code: caseSource }]) {
      expect(code, name).not.toMatch(/group-average|onGroupAverage|GroupAverage|그룹 평균/);
    }
  });
  it('X4: useBand 는 MemberClassContainer 만 호출한다(인스턴스 중복 방지)', () => {
    const callers = sources.filter(({ code }) => /\buseBand\s*\(/.test(code)).map(({ name }) => name);
    expect(callers).toEqual(['MemberClassContainer.tsx']);
  });
  it('X2·X3: 이모지와 호흡 지시 문구가 없다', () => {
    for (const { name, code } of [...sources, { name: 'member-player-case.ts', code: caseSource }]) {
      expect(code, name).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(code, name).not.toMatch(/호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/);
    }
  });
  it('X5: any 를 쓰지 않는다', () => {
    for (const { name, code } of sources.filter((s) => s.name.endsWith('.ts') || s.name.endsWith('.tsx'))) {
      expect(code, name).not.toMatch(/:\s*any\b|<any>|as any\b/);
    }
  });
  it('X6·X7: 아이콘 전용 버튼은 shared 프리미티브(IconCircleButton)나 aria-label 을 쓴다', () => {
    const view = sources.find((s) => s.name === 'MemberTopBar.tsx')!.code;
    expect(view).toContain('IconCircleButton');
  });
});

describe('상담사 영상 연결 안내 복원(SDD-208 I1) — 옛 CounselorLiveTile 의 실패 안내·재시도', () => {
  it('토큰 발급이 실패(error)하면 상담사 PiP 자리에 안내 칩과 [영상 다시 시도]가 나온다', async () => {
    h.lk.token = null;
    h.lk.error = '서버 오류';
    await render(<Container />);
    const issue = q('[data-pz="pip-issue"]');
    expect(issue?.textContent).toContain('상담사 영상을 불러오지 못했습니다');
    h.lk.connect.mockClear();
    await act(async () => { buttonByText('영상 다시 시도')?.click(); });
    expect(h.lk.connect).toHaveBeenCalledTimes(1);
  });
  it('상담사 화상이 아직 시작되지 않아 재시도를 모두 쓰면(notReady, 5회) 기다림 안내와 [영상 다시 시도]', async () => {
    h.lk.token = null;
    h.lk.notReady = true;
    h.lk.attemptCount = 5;
    await render(<Container />);
    expect(q('[data-pz="pip-issue"]')?.textContent).toContain('상담사 영상을 기다리고 있어요');
    expect(buttonByText('영상 다시 시도')).toBeDefined();
  });
  it('아직 재시도 중이거나 정상 연결(트랙 없음)일 때는 칩을 보이지 않는다 — 트랙이 없는 것과 연결 실패를 구분', async () => {
    h.lk.token = null;
    h.lk.notReady = true;
    h.lk.attemptCount = 2;
    await render(<Container />);
    expect(q('[data-pz="pip-issue"]')).toBeNull();
    Object.assign(h.lk, { token: 'tok', notReady: false, attemptCount: 0, error: null });
    await render(<Container />);
    expect(q('[data-pz="pip-issue"]')).toBeNull();
  });
  it('오프라인 수업은 상담사 영상을 연결하지 않으므로(현행 변경, D2) 토큰을 요청하지도 안내 칩을 그리지도 않는다', async () => {
    h.lk.token = null;
    h.lk.error = '서버 오류';
    await render(<Container locationType="offline" participantMode="group" maxParticipants={30} />);
    expect(h.lk.connect).not.toHaveBeenCalled();
    expect(q('[data-pz="pip-issue"]')).toBeNull();
  });
});
