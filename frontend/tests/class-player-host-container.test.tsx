// @vitest-environment jsdom
// SDD-208 H5 — 상담사 컨테이너(ClassPlayerPage 의 진행 중 상태·핸들러를 props 로 받아 뷰 모델을 조립): 네트워크 배너·종료·마이크 연동·발언권·채팅
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionLiveMetric } from '../src/lib/api/session';
import { NET_DOWN_AFTER_MS } from '../src/lib/class/player-case';

const livekit = vi.hoisted(() => ({
  local: null as unknown,
  state: 'connected',
  roomProps: {} as Record<string, unknown>,
}));

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: (props: Record<string, unknown> & { children?: ReactNode }) => {
    livekit.roomProps = props;
    return <div data-testid="lk-room">{props.children}</div>;
  },
  RoomAudioRenderer: () => <i data-testid="lk-audio" />,
  useLocalParticipant: () => ({ localParticipant: livekit.local }),
  useConnectionState: () => livekit.state,
  useTracks: () => [],
}));

const chat = vi.hoisted(() => ({ last: {} as Record<string, unknown> }));
vi.mock('../src/components/chat/ClassChatPanel', async () => {
  const { useEffect } = await import('react');
  return {
    ClassChatPanel: (props: { collapsed: boolean; embedded?: boolean; enabled: boolean; onUnreadChange?: (n: number) => void }) => {
      chat.last = props as unknown as Record<string, unknown>;
      useEffect(() => { props.onUnreadChange?.(4); }, [props]);
      return props.collapsed ? null : <div data-testid="chat-room">채팅창</div>;
    },
  };
});

import { HostLiveContainer, type HostLiveContainerProps } from '../src/components/class/player/host/HostLiveContainer';
import { HostEndingCard } from '../src/components/class/player/host/HostEndingCard';

let root: Root;
let container: HTMLDivElement;

const NOW = Date.now();
function row(id: string, name: string, over: Partial<SessionLiveMetric> = {}): SessionLiveMetric {
  return {
    participant_id: id, user_id: `u-${id}`, display_name: name, is_guest: false, band_connected: true, device_status: 'ok', band_battery: 80,
    avg_efficiency: null, current_efficiency: 60, upload_status: null, last_eeg_at: new Date(NOW).toISOString(),
    heart_rate: 70, respiratory_rate: 14, sdnn: 50, raise_hand: false, speaking: false, ...over,
  };
}

function baseProps(over: Partial<HostLiveContainerProps> = {}): HostLiveContainerProps {
  return {
    session: {
      id: 's1', title: '마음챙김 명상수업', location_type: 'online', participant_mode: 'group', duration_min: 30, access_code: 'MIND24',
      chat_room_id: null, record_video: true,
      participants: [
        { user_id: 'u-host', user_name: '상담사', is_waitlisted: false, is_guest: false },
        { user_id: 'u-w1', user_name: '가은', is_waitlisted: true, is_guest: false },
      ],
    } as unknown as HostLiveContainerProps['session'],
    hostUserId: 'u-host',
    hostParticipantId: 'host',
    rows: [row('host', '상담사'), row('p1', '서연'), row('p2', '민준', { raise_hand: true }), row('p3', '지우', { band_connected: false, last_eeg_at: null, device_status: null })],
    extras: {},
    elapsedSec: 754,
    checkins: [],
    waitingEntries: [],
    quietSignals: {},
    live: { socketConnected: true, metricsPollFailing: false, onRetry: vi.fn() },
    speaking: { busyId: null, onSet: vi.fn() },
    chat: { enabled: true, busy: false, onToggleEnabled: vi.fn() },
    recorder: { state: 'recording', pause: vi.fn(), resume: vi.fn() },
    videoRecorder: { state: 'recording', stream: null, facingMode: 'user', pause: vi.fn(), resume: vi.fn(), switchCamera: vi.fn() },
    recording: { elapsedSec: 492, onStart: vi.fn(), onStop: vi.fn() },
    videoOnly: { onStart: vi.fn(), onStop: vi.fn() },
    mediaPrefs: { micOn: true, cameraOn: true },
    liveKit: { token: 'tok', loading: false, error: null, serverUrl: 'wss://lk.test', onDisconnected: vi.fn() },
    band: { connectionState: 'disconnected', battery: null, deviceStatus: null, signalQualityLevel: 'unknown', error: null, isSupported: true, connect: vi.fn(), disconnect: vi.fn() },
    status: { error: null, endFailed: false, ending: false, onRetryEnd: vi.fn() },
    end: { open: false, onRequest: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn() },
    codeCopy: { copied: false, onCopy: vi.fn() },
    onClose: vi.fn(),
    ...over,
  };
}

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
async function setViewport(width: number, height: number): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}
const all = (sel: string, scope: ParentNode = document): HTMLElement[] => [...scope.querySelectorAll<HTMLElement>(sel)];
const one = (sel: string, scope: ParentNode = document): HTMLElement | null => scope.querySelector<HTMLElement>(sel);
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttonByText = (label: string, scope: ParentNode = document): HTMLElement | null =>
  all('button', scope).find((b) => text(b).includes(label) || b.getAttribute('aria-label')?.includes(label)) ?? null;
async function click(el: HTMLElement | null): Promise<void> {
  expect(el, '클릭 대상').not.toBeNull();
  await act(async () => { el?.click(); });
}
const sheet = (): HTMLElement | null => one('[data-pz="sheet"]');

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  // 자연 배경(FadingImageBackground)이 prefers-reduced-motion 을 읽는다
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
  livekit.local = { setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined), setCameraEnabled: vi.fn().mockResolvedValue(undefined) };
  livekit.state = 'connected';
  livekit.roomProps = {};
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await setViewport(1280, 720);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HostLiveContainer — 뷰 모델 조립', () => {
  it('호스트 본인 행은 참가자 타일에서 빼고 입장 대기는 대기자 명단으로 센다', async () => {
    await render(<HostLiveContainer {...baseProps()} />);
    const names = all('[data-pz="tile"]').map((t) => t.dataset.participantId);
    expect(names).toEqual(['p1', 'p2', 'p3']);
    expect(text(one('[data-pz="chipline"]'))).toContain('대기 1');
    expect(text(one('[data-pz="ttl"]'))).toContain('마음챙김 명상수업');
    expect(text(one('[data-pz="ttl"]'))).toContain('12:34');
    expect(text(one('[data-pz="ttl"]'))).toContain('/ 30:00');
  });

  it('손든 회원 칩과 밴드 요약이 라이브 행에서 나온다', async () => {
    await render(<HostLiveContainer {...baseProps()} />);
    const line = text(one('[data-pz="chipline"]'));
    expect(line).toContain('손든 회원 1');
    expect(line).toContain('연결 2');
    expect(line).toContain('미착용 1');
  });

  it('1:1 수업은 첫 참가자(호스트 제외)로 큰 회원 카드를 만든다', async () => {
    const props = baseProps({
      session: { ...baseProps().session, participant_mode: 'one_on_one' },
      rows: [row('host', '상담사'), row('p1', '서연')],
    });
    await render(<HostLiveContainer {...props} />);
    expect(one('[data-pz="solo"]')).not.toBeNull();
    expect(text(one('[data-pz="solo"]'))).toContain('서연');
    expect(one('[data-pz="member-video"]')).toBeNull();
  });

  it('오프라인 수업은 셀프뷰·카메라 토글 없이 요약 패널과 "녹음" 도크', async () => {
    const props = baseProps({ session: { ...baseProps().session, location_type: 'offline' } });
    await render(<HostLiveContainer {...props} />);
    expect(one('[data-pz="selfview"]')).toBeNull();
    expect(one('[data-pz="sumpanel"]')).not.toBeNull();
    expect(text(all('[data-pz="dk"]')[2])).toContain('녹음');
    await click(all('[data-pz="dk"]')[2]);
    expect(one('[role="switch"][aria-label="카메라"]')).toBeNull();
    expect(one('[role="switch"][aria-label="마이크"]')).toBeNull();
  });

  it('상세 시트의 5분 추이는 행이 3초 간격으로 쌓이면 그려진다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const props = baseProps();
    await render(<HostLiveContainer {...props} />);
    vi.setSystemTime(NOW + 4_000);
    await render(<HostLiveContainer {...props} rows={[row('host', '상담사'), row('p1', '서연', { current_efficiency: 66, last_eeg_at: new Date(NOW + 4_000).toISOString() }), row('p2', '민준'), row('p3', '지우')]} />);
    await click(one('[data-pz="tile"][data-participant-id="p1"]'));
    expect(one('.hp-trend svg', sheet() ?? document)).not.toBeNull();
  });
});

describe('네트워크 배너(C16) — 소켓 끊김·복구', () => {
  it('소켓이 끊기면 재연결 배너, 값 흐림, "데이터 수신 일시 중단" → 복구되면 사라진다', async () => {
    await render(<HostLiveContainer {...baseProps({ live: { socketConnected: false, metricsPollFailing: false, onRetry: vi.fn() } })} />);
    expect(text(one('[data-pz="banner"]'))).toContain('연결이 불안정해요');
    expect(text(one('[data-pz="banner"]'))).toContain('데이터 수신이 잠시 중단됐어요');
    expect(one('.hp-grid')?.getAttribute('data-net-bad')).toBe('true');
    expect(text(all('[data-pz="tile"]')[0])).toContain('수신 일시 중단');
    await render(<HostLiveContainer {...baseProps({ live: { socketConnected: true, metricsPollFailing: false, onRetry: vi.fn() } })} />);
    expect(one('[data-pz="banner"]')).toBeNull();
  });

  it('끊김이 NET_DOWN_AFTER_MS 를 넘고 4초 폴링도 실패 중이면 끊김 배너 + 다시 연결', async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const props = baseProps({ live: { socketConnected: false, metricsPollFailing: true, onRetry } });
    await render(<HostLiveContainer {...props} />);
    expect(text(one('[data-pz="banner"]'))).toContain('연결이 불안정해요');
    await act(async () => { vi.advanceTimersByTime(NET_DOWN_AFTER_MS + 1_000); });
    expect(text(one('[data-pz="banner"]'))).toContain('연결이 끊겼어요');
    await click(buttonByText('다시 연결', one('[data-pz="banner"]') ?? document));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('폴링이 살아 있으면 소켓이 오래 끊겨도 끊김이 아니라 불안정으로 둔다', async () => {
    vi.useFakeTimers();
    await render(<HostLiveContainer {...baseProps({ live: { socketConnected: false, metricsPollFailing: false, onRetry: vi.fn() } })} />);
    await act(async () => { vi.advanceTimersByTime(NET_DOWN_AFTER_MS * 3); });
    expect(text(one('[data-pz="banner"]'))).toContain('연결이 불안정해요');
  });
});

describe('종료(C17) — EndSessionModal 재사용 · 종료 재시도', () => {
  it('종료 버튼 → onRequest, 모달이 열려 있으면 계속 진행/클래스 종료 버튼이 페이지 핸들러를 부른다', async () => {
    const end = { open: false, onRequest: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn() };
    await render(<HostLiveContainer {...baseProps({ end })} />);
    await click(one('[data-pz="btn-end"]'));
    expect(end.onRequest).toHaveBeenCalledTimes(1);
    await render(<HostLiveContainer {...baseProps({ end: { ...end, open: true } })} />);
    expect(text(one('[role="dialog"]'))).toContain('클래스를 종료할까요?');
    await click(buttonByText('클래스 종료', one('[role="dialog"]') ?? document));
    expect(end.onConfirm).toHaveBeenCalledTimes(1);
    await click(buttonByText('계속 진행', one('[role="dialog"]') ?? document));
    expect(end.onCancel).toHaveBeenCalledTimes(1);
  });

  it('종료 확정이 실패하면 오류와 종료 재시도 버튼이 나온다', async () => {
    const onRetryEnd = vi.fn();
    await render(<HostLiveContainer {...baseProps({ status: { error: '서버 오류', endFailed: true, ending: false, onRetryEnd } })} />);
    const err = one('[data-pz="error-banner"]');
    expect(text(err)).toContain('서버 오류');
    await click(buttonByText('종료 재시도', err ?? document));
    expect(onRetryEnd).toHaveBeenCalledTimes(1);
  });

  it('화상 연결 오류와 일반 오류가 서로 가리지 않고 함께 보인다', async () => {
    await render(<HostLiveContainer {...baseProps({
      status: { error: '세션을 불러오지 못했습니다', endFailed: false, ending: false, onRetryEnd: vi.fn() },
      liveKit: { token: 'tok', loading: false, error: 'room down', serverUrl: 'wss://lk.test', onDisconnected: vi.fn() },
    })} />);
    const banners = all('[data-pz="error-banner"]');
    expect(banners).toHaveLength(2);
    expect(text(banners[1])).toContain('화상 연결 오류: room down');
  });
});

describe('종료 후 카드(D6 — isEnded 씬 스타일)', () => {
  it('3단계 진행 표시와 기록 보기·목록으로 버튼', async () => {
    const onView = vi.fn();
    const onList = vi.fn();
    await render(<HostEndingCard progress={null} onViewRecord={onView} onGoList={onList} />);
    expect(text(one('[data-pz="ecard"]'))).toContain('수업이 종료됐어요');
    expect(text(one('[data-pz="ecard"]'))).toContain('화면을 닫아도 계속 만들어요');
    await click(buttonByText('기록 보기'));
    await click(buttonByText('목록으로'));
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onList).toHaveBeenCalledTimes(1);
  });
});

describe('마이크 끄기 = LiveKit mute + AI 기록 일시정지 (P7)', () => {
  it('미디어 시트에서 마이크를 끄면 recorder.pause 와 LiveKit 마이크 off, 배너 표시, 켜면 복구', async () => {
    const props = baseProps();
    await render(<HostLiveContainer {...props} />);
    await click(all('[data-pz="dk"]')[2]);
    await click(one('[role="switch"][aria-label="마이크"]', sheet() ?? document));
    expect(props.recorder.pause).toHaveBeenCalledTimes(1);
    expect((livekit.local as { setMicrophoneEnabled: ReturnType<typeof vi.fn> }).setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    expect(text(one('[data-pz="banner"]'))).toContain('마이크 꺼짐');
    await render(<HostLiveContainer {...props} recorder={{ ...props.recorder, state: 'paused' }} />);
    await click(buttonByText('마이크 켜기', one('[data-pz="banner"]') ?? document));
    expect(props.recorder.resume).toHaveBeenCalledTimes(1);
    expect((livekit.local as { setMicrophoneEnabled: ReturnType<typeof vi.fn> }).setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it('입장 전에 마이크를 끈 수업은 꺼짐으로 시작하고 배너로 알린다', async () => {
    await render(<HostLiveContainer {...baseProps({ mediaPrefs: { micOn: false, cameraOn: true } })} />);
    expect(text(one('[data-pz="banner"]'))).toContain('마이크 꺼짐');
  });

  it('마이크 권한 거부(LiveKit)는 코랄 배너 + 허용 방법으로 이어진다', async () => {
    await render(<HostLiveContainer {...baseProps()} />);
    await act(async () => { (livekit.roomProps.onMediaDeviceFailure as (f: unknown, k: string) => void)('PermissionDenied', 'audioinput'); });
    expect(one('[data-pz="banner"]')?.getAttribute('data-tone')).toBe('coral');
    expect(text(one('[data-pz="banner"]'))).toContain('마이크를 쓸 수 없어요');
  });

  it('녹음기 오류도 마이크 권한 문제로 보여 준다(C10)', async () => {
    await render(<HostLiveContainer {...baseProps({ recorder: { state: 'error', pause: vi.fn(), resume: vi.fn() } })} />);
    expect(text(one('[data-pz="banner"]'))).toContain('마이크를 쓸 수 없어요');
  });

  it('토큰이 없으면 화상 브리지를 만들지 않는다', async () => {
    await render(<HostLiveContainer {...baseProps({ liveKit: { token: null, loading: true, error: null, serverUrl: 'wss://lk.test', onDisconnected: vi.fn() } })} />);
    expect(one('[data-testid="lk-room"]')).toBeNull();
  });

  it('토큰이 있으면 브리지를 연결하고 연결 끊김을 페이지에 알린다', async () => {
    const onDisconnected = vi.fn();
    await render(<HostLiveContainer {...baseProps({ liveKit: { token: 'tok', loading: false, error: null, serverUrl: 'wss://lk.test', onDisconnected } })} />);
    expect(one('[data-testid="lk-room"]')).not.toBeNull();
    (livekit.roomProps.onDisconnected as () => void)();
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });
});

describe('발언권·채팅·녹음 연결', () => {
  it('손든 회원 시트의 발언권 부여가 페이지 핸들러로 간다', async () => {
    const props = baseProps();
    await render(<HostLiveContainer {...props} />);
    await click(buttonByText('손든 회원 1', one('[data-pz="chipline"]') ?? document));
    const grant = all('button', sheet() ?? document).find((b) => text(b) === '발언권 부여');
    await click(grant ?? null);
    expect(props.speaking.onSet).toHaveBeenCalledWith('p2', true);
  });

  it('채팅: 시트를 닫아 둔 동안은 ClassChatPanel(embedded)이 collapsed 로 안읽음만 세고 배지가 도크에 뜬다', async () => {
    await render(<HostLiveContainer {...baseProps()} />);
    expect(chat.last.embedded).toBe(true);
    expect(chat.last.collapsed).toBe(true);
    expect(text(all('[data-pz="dk"]')[1])).toContain('4');
    await click(all('[data-pz="dk"]')[1]);
    expect(chat.last.collapsed).toBe(false);
    expect(one('[data-testid="chat-room"]')).not.toBeNull();
  });

  it('채팅 받기 스위치는 페이지의 채팅 켜기/끄기 핸들러를 부른다', async () => {
    const props = baseProps();
    await render(<HostLiveContainer {...props} />);
    await click(all('[data-pz="dk"]')[1]);
    await click(one('[role="switch"][aria-label="채팅 받기"]', sheet() ?? document));
    expect(props.chat.onToggleEnabled).toHaveBeenCalledTimes(1);
  });

  it('녹음 시작·종료·마커는 페이지 핸들러/컴포넌트로 이어진다', async () => {
    const props = baseProps({ recorder: { state: 'idle', pause: vi.fn(), resume: vi.fn() } });
    await render(<HostLiveContainer {...props} />);
    await click(all('[data-pz="dk"]')[2]);
    await click(buttonByText('녹음 시작', sheet() ?? document));
    expect(props.recording.onStart).toHaveBeenCalledTimes(1);
    expect(one('input[placeholder="마커 메모 입력"]', sheet() ?? document)).not.toBeNull();
  });

  it('녹음 일시정지는 음성·영상 녹음기를 함께 멈춘다(기존 동작 계승)', async () => {
    const props = baseProps();
    await render(<HostLiveContainer {...props} />);
    await click(all('[data-pz="dk"]')[2]);
    await click(buttonByText('일시정지', sheet() ?? document));
    expect(props.recorder.pause).toHaveBeenCalledTimes(1);
    expect(props.videoRecorder.pause).toHaveBeenCalledTimes(1);
  });

  it('내 밴드: 미착용은 칩이 없고 도구 시트에서 연결하면 band.connect 를 부른다', async () => {
    const props = baseProps();
    await render(<HostLiveContainer {...props} />);
    expect(text(one('[data-pz="chipline"]'))).not.toContain('내 밴드');
    await click(all('[data-pz="dk"]')[4]);
    await click(all('button', sheet() ?? document).find((b) => text(b) === '보기') ?? null);
    await click(buttonByText('밴드 연결', sheet() ?? document));
    expect(props.band.connect).toHaveBeenCalledTimes(1);
  });

  it('내 밴드: 연결되면 칩에 이완 값이 나온다', async () => {
    const props = baseProps({ band: { ...baseProps().band, connectionState: 'connected', battery: 78, deviceStatus: 'ok', signalQualityLevel: 'ok' } });
    await render(<HostLiveContainer {...props} />);
    expect(text(one('[data-pz="chipline"]'))).toContain('내 밴드 연결됨');
  });

  it('코드 복사는 페이지 핸들러를 부른다', async () => {
    const props = baseProps();
    await render(<HostLiveContainer {...props} />);
    await click(all('[data-pz="dk"]')[4]);
    await click(buttonByText('코드 복사', sheet() ?? document));
    expect(props.codeCopy.onCopy).toHaveBeenCalledTimes(1);
  });

  it('닫기 버튼은 페이지의 onClose 를 부른다', async () => {
    const props = baseProps();
    await render(<HostLiveContainer {...props} />);
    await click(one('[data-pz="btn-close"]'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('하니스 C17 — 종료 확인 → 리포트 생성 중', () => {
  it('phase=confirm 이면 종료 확인 모달이 열려 있고, 종료하면 종료 후 카드로 바뀐다', async () => {
    const { playerCases } = await import('../src/lib/class/fixtures/host-cases');
    const { HARNESS_BACKDROP_SRC } = await import('../src/lib/class/player-harness');
    const params = new URLSearchParams();
    await render(playerCases.C17.render({ sheet: null, detail: null, backdropSrc: HARNESS_BACKDROP_SRC, params }));
    expect(text(one('[role="dialog"]'))).toContain('클래스를 종료할까요?');
    await click(buttonByText('클래스 종료', one('[role="dialog"]') ?? document));
    expect(one('[data-pz="ecard"]')).not.toBeNull();
    expect(text(one('[data-pz="ecard"]'))).toContain('AI 요약');
  });

  it('phase=ending 은 처음부터 종료 후 카드', async () => {
    const { playerCases } = await import('../src/lib/class/fixtures/host-cases');
    const { HARNESS_BACKDROP_SRC } = await import('../src/lib/class/player-harness');
    await render(playerCases.C17.render({ sheet: null, detail: null, backdropSrc: HARNESS_BACKDROP_SRC, params: new URLSearchParams('phase=ending') }));
    expect(one('[data-pz="ecard"]')).not.toBeNull();
    expect(one('[data-pz="top"]')).toBeNull();
  });
});
