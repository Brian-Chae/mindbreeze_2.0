// @vitest-environment jsdom
// SDD-208 H4 — 상담사 LiveKit 제어·권한·녹음 연동(마이크 끄기 = LiveKit mute + AI 기록 일시정지 + 영상 녹화 음성 무음, 뇌파는 무관)
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MediaDeviceFailure } from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playerCases } from '../src/lib/class/fixtures/host-cases';
import { HARNESS_BACKDROP_SRC, type PlayerCaseContext } from '../src/lib/class/player-harness';

/* ───────── LiveKit 훅 모킹 ───────── */

interface FakeLocal {
  setMicrophoneEnabled: ReturnType<typeof vi.fn>;
  setCameraEnabled: ReturnType<typeof vi.fn>;
}
const livekit = vi.hoisted(() => ({
  local: null as unknown,
  tracks: [] as unknown[],
  state: 'connected',
  roomProps: {} as Record<string, unknown>,
  audioRendererCount: 0,
}));

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: (props: Record<string, unknown> & { children?: ReactNode }) => {
    livekit.roomProps = props;
    return <div data-testid="lk-room">{props.children}</div>;
  },
  RoomAudioRenderer: () => {
    livekit.audioRendererCount += 1;
    return <i data-testid="lk-audio" />;
  },
  useLocalParticipant: () => ({ localParticipant: livekit.local }),
  useConnectionState: () => livekit.state,
  useTracks: () => livekit.tracks,
}));

import { HostLiveKitBridge } from '../src/components/class/player/host/HostLiveKitBridge';
import { useHostMediaControl, resolveCamUi, resolveMicUi } from '../src/components/class/player/host/host-media-control';

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(node); });
}
function ctxFor(query = ''): PlayerCaseContext {
  const params = new URLSearchParams(query);
  return { sheet: params.get('sheet') || null, detail: params.get('detail') || null, backdropSrc: HARNESS_BACKDROP_SRC, params };
}
async function renderCase(id: string, query = ''): Promise<void> {
  await render(playerCases[id].render(ctxFor(query)));
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
  const local: FakeLocal = { setMicrophoneEnabled: vi.fn().mockResolvedValue(undefined), setCameraEnabled: vi.fn().mockResolvedValue(undefined) };
  livekit.local = local;
  livekit.tracks = [];
  livekit.state = 'connected';
  livekit.roomProps = {};
  livekit.audioRendererCount = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await setViewport(1280, 720);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const local = (): FakeLocal => livekit.local as FakeLocal;

/* ───────── HostLiveKitBridge ───────── */

describe('HostLiveKitBridge — VideoConference 를 대체하는 헤드리스 브리지', () => {
  const bridge = (props: Partial<Parameters<typeof HostLiveKitBridge>[0]> = {}): ReactNode => (
    <HostLiveKitBridge token="tok" serverUrl="wss://lk.test" micOn camOn {...props} />
  );

  it('연결 시 마이크·카메라 초기 상태로 발행하고 회원 음성을 들려 주는 오디오 렌더러만 둔다(그리드 UI 없음)', async () => {
    await render(bridge({ micOn: true, camOn: false }));
    expect(livekit.roomProps.token).toBe('tok');
    expect(livekit.roomProps.serverUrl).toBe('wss://lk.test');
    expect(livekit.roomProps.connect).toBe(true);
    expect(livekit.roomProps.audio).toBe(true);
    expect(livekit.roomProps.video).toBe(false);
    expect(livekit.audioRendererCount).toBeGreaterThan(0);
    expect(container.querySelectorAll('video')).toHaveLength(0);
  });

  it('마이크를 끄면 LiveKit 로컬 마이크가 mute 되고 다시 켜면 복구된다', async () => {
    await render(bridge({ micOn: true }));
    await render(bridge({ micOn: false }));
    expect(local().setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
    await render(bridge({ micOn: true }));
    expect(local().setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
  });

  it('카메라를 끄면 LiveKit 카메라가 꺼진다', async () => {
    await render(bridge({ camOn: true }));
    await render(bridge({ camOn: false }));
    expect(local().setCameraEnabled).toHaveBeenLastCalledWith(false);
  });

  it('연결 전에는 로컬 참가자 제어를 호출하지 않는다', async () => {
    livekit.state = 'connecting';
    await render(bridge({ micOn: false }));
    expect(local().setMicrophoneEnabled).not.toHaveBeenCalled();
  });

  it('권한 거부·기기 없음을 마이크/카메라 실패로 올린다', async () => {
    const onMediaFailure = vi.fn();
    await render(bridge({ onMediaFailure }));
    const handler = livekit.roomProps.onMediaDeviceFailure as (f: MediaDeviceFailure | undefined, kind?: MediaDeviceKind) => void;
    handler(MediaDeviceFailure.PermissionDenied, 'audioinput');
    handler(MediaDeviceFailure.NotFound, 'videoinput');
    handler(MediaDeviceFailure.DeviceInUse, 'audioinput');
    expect(onMediaFailure).toHaveBeenNthCalledWith(1, 'mic', 'denied');
    expect(onMediaFailure).toHaveBeenNthCalledWith(2, 'camera', 'notfound');
    expect(onMediaFailure).toHaveBeenNthCalledWith(3, 'mic', 'other');
  });

  it('연결이 끊기면 onDisconnected 를 올린다', async () => {
    const onDisconnected = vi.fn();
    await render(bridge({ onDisconnected }));
    (livekit.roomProps.onDisconnected as () => void)();
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('내 카메라 트랙은 셀프뷰로, 원격(회원) 카메라 트랙은 회원 영상으로 올리고 트랙이 없으면 null', async () => {
    const mine = {} as MediaStream;
    const theirs = {} as MediaStream;
    const onSelfStream = vi.fn();
    const onMemberStream = vi.fn();
    livekit.tracks = [];
    await render(bridge({ onSelfStream, onMemberStream }));
    expect(onSelfStream).toHaveBeenLastCalledWith(null);
    expect(onMemberStream).toHaveBeenLastCalledWith(null);
    livekit.tracks = [
      { participant: { isLocal: true, identity: 'host' }, publication: { isMuted: false, track: { mediaStream: mine } } },
      { participant: { isLocal: false, identity: 'm1' }, publication: { isMuted: false, track: { mediaStream: theirs } } },
    ];
    await render(bridge({ onSelfStream, onMemberStream }));
    expect(onSelfStream).toHaveBeenLastCalledWith(mine);
    expect(onMemberStream).toHaveBeenLastCalledWith(theirs);
  });

  it('꺼진(mute) 회원 카메라 트랙은 영상으로 올리지 않는다', async () => {
    const onMemberStream = vi.fn();
    livekit.tracks = [{ participant: { isLocal: false, identity: 'm1' }, publication: { isMuted: true, track: { mediaStream: {} as MediaStream } } }];
    await render(bridge({ onMemberStream }));
    expect(onMemberStream).toHaveBeenLastCalledWith(null);
  });
});

/* ───────── 마이크·카메라 제어 훅 (P7) ───────── */

interface Spies {
  recorder: { state: 'idle' | 'recording' | 'paused' | 'stopped' | 'error'; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
  video: { state: 'idle' | 'recording' | 'paused' | 'stopped' | 'error'; stream: MediaStream | null; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
}
function makeSpies(recorderState: Spies['recorder']['state'], videoState: Spies['video']['state'], tracks: { enabled: boolean }[] = []): Spies {
  return {
    recorder: { state: recorderState, pause: vi.fn(), resume: vi.fn() },
    video: { state: videoState, stream: { getAudioTracks: () => tracks } as unknown as MediaStream, pause: vi.fn(), resume: vi.fn() },
  };
}

type Control = ReturnType<typeof useHostMediaControl>;
async function mountControl(spies: Spies, initial = { mic: true, cam: true }): Promise<{ get: () => Control; rerender: (s: Spies) => Promise<void> }> {
  let latest: Control | null = null;
  function Probe({ s }: { s: Spies }): ReactNode {
    latest = useHostMediaControl({ initialMicOn: initial.mic, initialCamOn: initial.cam, recorder: s.recorder, videoRecorder: s.video });
    return null;
  }
  await render(<Probe s={spies} />);
  return { get: () => latest as Control, rerender: async (s) => { await render(<Probe s={s} />); } };
}

describe('useHostMediaControl — 마이크 끄기 = AI 기록 제외, 뇌파는 그대로 (P7)', () => {
  it('녹음 중 마이크를 끄면 recorder.pause() 하고 영상 녹화 오디오 트랙을 무음으로 만든다', async () => {
    const tracks = [{ enabled: true }, { enabled: true }];
    const spies = makeSpies('recording', 'recording', tracks);
    const control = await mountControl(spies);
    await act(async () => { control.get().toggleMic(); });
    expect(control.get().micOn).toBe(false);
    expect(spies.recorder.pause).toHaveBeenCalledTimes(1);
    expect(tracks.every((t) => t.enabled === false)).toBe(true);
    expect(spies.video.pause).not.toHaveBeenCalled();
  });

  it('마이크를 다시 켜면 우리가 멈춘 녹음만 resume 하고 오디오 트랙을 복구한다', async () => {
    const tracks = [{ enabled: true }];
    const spies = makeSpies('recording', 'recording', tracks);
    const control = await mountControl(spies);
    await act(async () => { control.get().toggleMic(); });
    await control.rerender({ ...spies, recorder: { ...spies.recorder, state: 'paused' } });
    await act(async () => { control.get().toggleMic(); });
    expect(spies.recorder.resume).toHaveBeenCalledTimes(1);
    expect(tracks[0].enabled).toBe(true);
    expect(control.get().micOn).toBe(true);
  });

  it('사용자가 직접 일시정지한 녹음은 마이크를 켜도 자동 재개하지 않는다', async () => {
    const spies = makeSpies('paused', 'recording', [{ enabled: true }]);
    const control = await mountControl(spies);
    await act(async () => { control.get().toggleMic(); });
    await act(async () => { control.get().toggleMic(); });
    expect(spies.recorder.pause).not.toHaveBeenCalled();
    expect(spies.recorder.resume).not.toHaveBeenCalled();
  });

  it('녹음 전(idle)에 마이크를 꺼도 녹음기를 건드리지 않는다', async () => {
    const spies = makeSpies('idle', 'idle');
    const control = await mountControl(spies);
    await act(async () => { control.get().toggleMic(); });
    expect(spies.recorder.pause).not.toHaveBeenCalled();
    expect(control.get().micOn).toBe(false);
  });

  it('카메라 전환(스트림 교체) 후에도 마이크가 꺼져 있으면 새 오디오 트랙도 무음이다', async () => {
    const first = [{ enabled: true }];
    const spies = makeSpies('recording', 'recording', first);
    const control = await mountControl(spies);
    await act(async () => { control.get().toggleMic(); });
    const second = [{ enabled: true }];
    await control.rerender({ ...spies, video: { ...spies.video, stream: { getAudioTracks: () => second } as unknown as MediaStream } });
    expect(second[0].enabled).toBe(false);
  });

  it('카메라를 끄면 영상 녹화를 일시정지하고 켜면 우리가 멈춘 것만 재개한다', async () => {
    const spies = makeSpies('idle', 'recording');
    const control = await mountControl(spies);
    await act(async () => { control.get().toggleCam(); });
    expect(control.get().camOn).toBe(false);
    expect(spies.video.pause).toHaveBeenCalledTimes(1);
    await control.rerender({ ...spies, video: { ...spies.video, state: 'paused' } });
    await act(async () => { control.get().toggleCam(); });
    expect(spies.video.resume).toHaveBeenCalledTimes(1);
  });

  it('초기값이 꺼짐이면 그대로 꺼짐으로 시작한다(입장 전 선택 계승)', async () => {
    const control = await mountControl(makeSpies('idle', 'idle'), { mic: false, cam: false });
    expect(control.get().micOn).toBe(false);
    expect(control.get().camOn).toBe(false);
  });
});

describe('마이크·카메라 UI 상태 판정', () => {
  it('권한 실패나 녹음기 오류가 있으면 denied, 아니면 켜짐/꺼짐', () => {
    expect(resolveMicUi({ micOn: true, failure: null, recorderState: 'idle' })).toBe('on');
    expect(resolveMicUi({ micOn: false, failure: null, recorderState: 'idle' })).toBe('off');
    expect(resolveMicUi({ micOn: true, failure: 'denied', recorderState: 'idle' })).toBe('denied');
    expect(resolveMicUi({ micOn: true, failure: null, recorderState: 'error' })).toBe('denied');
  });

  it('카메라: 권한 거부는 denied, 기기 없음은 nodevice, 영상 녹화 오류는 denied', () => {
    expect(resolveCamUi({ camOn: true, failure: null, videoState: 'idle' })).toBe('on');
    expect(resolveCamUi({ camOn: false, failure: null, videoState: 'idle' })).toBe('off');
    expect(resolveCamUi({ camOn: true, failure: 'denied', videoState: 'idle' })).toBe('denied');
    expect(resolveCamUi({ camOn: true, failure: 'notfound', videoState: 'idle' })).toBe('nodevice');
    expect(resolveCamUi({ camOn: true, failure: null, videoState: 'error' })).toBe('denied');
  });
});

/* ───────── 미디어 시트·권한 시트(하니스) ───────── */

describe('미디어 시트 — 온라인(C07·C09)', () => {
  it('카메라·마이크 스위치와 AI 기록 줄이 있고 BGM 은 없다(진행 중 BGM 무재생 정책, D3)', async () => {
    await renderCase('C01', 'sheet=media');
    const s = sheet();
    expect(text(s)).toContain('미디어');
    expect(one('[role="switch"][aria-label="카메라"]', s ?? document)).not.toBeNull();
    expect(one('[role="switch"][aria-label="마이크"]', s ?? document)).not.toBeNull();
    expect(text(s)).toContain('AI 기록');
    expect(text(s)).not.toContain('BGM');
    expect(text(s)).not.toContain('배경 음악');
  });

  it('C07 카메라 꺼짐: 카메라 스위치는 꺼짐이고 셀프뷰 자리는 유지된다', async () => {
    await renderCase('C07', 'sheet=media');
    expect(one('[role="switch"][aria-label="카메라"]', sheet() ?? document)?.getAttribute('aria-checked')).toBe('false');
    expect(text(sheet())).toContain('꺼짐');
    expect(one('[data-pz="selfview"]')).not.toBeNull();
    expect(text(one('[data-pz="selfview"]'))).toContain('카메라 꺼짐');
  });

  it('카메라 스위치를 누르면 셀프뷰가 켜짐/꺼짐으로 바뀐다', async () => {
    await renderCase('C01', 'sheet=media');
    await click(one('[role="switch"][aria-label="카메라"]', sheet() ?? document));
    expect(text(one('[data-pz="selfview"]'))).toContain('카메라 꺼짐');
  });

  it('마이크 스위치를 끄면 설명이 "꺼짐 · AI 기록 제외"가 되고 배너가 나온다', async () => {
    await renderCase('C01', 'sheet=media');
    await click(one('[role="switch"][aria-label="마이크"]', sheet() ?? document));
    expect(text(sheet())).toContain('꺼짐 · AI 기록 제외');
    expect(text(one('[data-pz="banner"]'))).toContain('마이크 꺼짐');
  });

  it('C09: 마이크 꺼짐 상태에서 AI 기록 줄은 마이크를 켜야 이어진다고 안내한다', async () => {
    await renderCase('C09', 'sheet=media');
    expect(one('[role="switch"][aria-label="마이크"]', sheet() ?? document)?.getAttribute('aria-checked')).toBe('false');
    expect(text(sheet())).toContain('마이크를 켜면 이어서 기록돼요');
  });

  it('녹음 중: 일시정지·녹음 종료(기존 RecordingControls 재사용)와 마커 입력이 있다', async () => {
    await renderCase('C11', 'sheet=media');
    const s = sheet();
    expect(text(s)).toContain('녹음 중');
    expect(buttonByText('일시정지', s ?? document)).not.toBeNull();
    expect(buttonByText('녹음 종료', s ?? document)).not.toBeNull();
    expect(one('input[placeholder="마커 메모 입력"]', s ?? document)).not.toBeNull();
  });

  it('녹음 전: 녹음 시작 버튼', async () => {
    await renderCase('C01', 'sheet=media');
    expect(buttonByText('녹음 시작', sheet() ?? document)).not.toBeNull();
  });

  it('녹음 중 일시정지를 누르면 재개로 바뀌고 칩이 기록 일시정지가 된다', async () => {
    await renderCase('C11', 'sheet=media');
    await click(buttonByText('일시정지', sheet() ?? document));
    expect(buttonByText('재개', sheet() ?? document)).not.toBeNull();
    expect(text(one('[data-pz="chipline"]'))).toContain('기록 일시정지');
  });
});

describe('미디어 시트 — 오프라인(C04·C06): 카메라 토글 DOM 없음', () => {
  it.each(['C04', 'C06'])('%s: 시트 제목은 "녹음", 카메라·마이크 스위치·카메라 줄이 없고 녹음 마이크 상태만 있다', async (id) => {
    await renderCase(id, 'sheet=media');
    const s = sheet();
    expect(text(s)).toContain('녹음');
    expect(text(s)).not.toContain('내 카메라');
    expect(one('[role="switch"][aria-label="카메라"]')).toBeNull();
    expect(one('[role="switch"][aria-label="마이크"]')).toBeNull();
    expect(text(s)).toContain('녹음 마이크');
    expect(text(s)).toContain('멈춘 구간은 AI 기록에서 빠져요. 뇌파는 계속 기록돼요.');
    expect(text(s)).not.toContain('BGM');
  });
});

describe('권한 거부(C08·C10) — 배너·허용 방법 시트', () => {
  it('C08: 셀프뷰에 코랄 "카메라를 쓸 수 없어요"와 설정 안내, 누르면 허용 방법 시트', async () => {
    await renderCase('C08');
    const view = one('[data-pz="selfview"]');
    expect(view?.getAttribute('data-denied')).toBe('true');
    expect(text(view)).toContain('카메라를 쓸 수 없어요');
    await click(view);
    expect(text(sheet())).toContain('카메라 허용 방법');
    expect(all('ol li', sheet() ?? document)).toHaveLength(3);
    expect(text(sheet())).toContain('허용하지 않아도 수업은 계속 진행할 수 있어요.');
  });

  it('C08: 미디어 시트의 카메라 줄은 "권한이 필요해요"와 설정 안내 버튼(스위치 없음)', async () => {
    await renderCase('C08', 'sheet=media');
    const s = sheet();
    expect(text(s)).toContain('권한이 필요해요');
    expect(buttonByText('설정 안내', s ?? document)).not.toBeNull();
    expect(one('[role="switch"][aria-label="카메라"]', s ?? document)).toBeNull();
  });

  it('C10: 코랄 배너의 허용 방법 → 마이크 허용 방법 시트(3단계 + 시작/종료 영향 안내)', async () => {
    await renderCase('C10');
    await click(buttonByText('허용 방법', one('[data-pz="banner"]') ?? document));
    const s = sheet();
    expect(text(s)).toContain('마이크 허용 방법');
    expect(all('ol li', s ?? document)).toHaveLength(3);
    expect(text(s)).toContain('브라우저 주소창 왼쪽의 자물쇠 아이콘을 눌러요');
    expect(text(s)).toContain('허용하지 않으면 이 수업은 AI 기록에서 빠져요. 뇌파는 계속 기록돼요.');
    expect(buttonByText('허용했어요 · 다시 확인', s ?? document)).not.toBeNull();
  });
});
