// @vitest-environment jsdom
// SDD-217 NV-01/02 — 실제 SDK의 원본 교체를 거쳐 셀프뷰 연결·해제를 검증한다.
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LocalVideoTrack, TrackEvent } from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const livekit = vi.hoisted(() => ({ tracks: [] as unknown[], mounts: 0 }));
vi.mock('@livekit/components-react', async () => {
  const { useEffect } = await import('react');
  return {
    LiveKitRoom: ({ children }: { children: ReactNode }) => {
      useEffect(() => { livekit.mounts += 1; }, []);
      return children;
    },
    RoomAudioRenderer: () => null,
    useConnectionState: () => 'connected',
    useLocalParticipant: () => ({ localParticipant: null }),
    useRoomContext: () => ({ state: "connected", localParticipant: null }),
    useTracks: () => livekit.tracks,
  };
});
import { HostLiveKitBridge } from '../src/components/class/player/host/HostLiveKitBridge';
import { HostSelfView } from '../src/components/class/player/host/HostHeadSlot';
// jsdom의 카메라·MediaStream 경계만 대체하고 attach/restart/replace는 실제 SDK로 실행한다.
class CameraTrack extends EventTarget {
  readonly kind = 'video';
  enabled = true;
  readyState: MediaStreamTrackState = 'live';
  constructor(readonly id: string) { super(); }
  getConstraints(): MediaTrackConstraints { return {}; }
  getSettings(): MediaTrackSettings { return { width: 640, height: 480 }; }
  async applyConstraints(): Promise<void> { /* 합성 카메라 */ }
  stop(): void { this.readyState = 'ended'; }
}
class CameraStream {
  private tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) { this.tracks = [...tracks]; }
  getTracks(): MediaStreamTrack[] { return [...this.tracks]; }
  getVideoTracks(): MediaStreamTrack[] { return this.tracks.filter((track) => track.kind === 'video'); }
  getAudioTracks(): MediaStreamTrack[] { return this.tracks.filter((track) => track.kind === 'audio'); }
  addTrack(track: MediaStreamTrack): void { if (!this.tracks.includes(track)) this.tracks.push(track); }
  removeTrack(track: MediaStreamTrack): void { this.tracks = this.tracks.filter((item) => item !== track); }
}
const rawTrack = (id: string): MediaStreamTrack => new CameraTrack(id) as unknown as MediaStreamTrack;
let root: Root;
let container: HTMLDivElement;
let sdkTrack: LocalVideoTrack;
let getUserMedia: ReturnType<typeof vi.fn>;
let detachEvents: number;
function Harness({ tick = 0, cameraOn = true }: { tick?: number; cameraOn?: boolean }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [track, setTrack] = useState<LocalVideoTrack | null>(null);
  return <>
    <output>{tick}</output>
    <HostLiveKitBridge token="test" serverUrl="wss://synthetic.invalid" micOn camOn={cameraOn} onSelfStream={setStream} onSelfTrack={setTrack} />
    <HostSelfView cam={cameraOn ? 'on' : 'off'} mic="on" big={false} stream={stream} track={track} netBad={false} onPress={() => undefined} />
  </>;
}
async function render(tick = 0, cameraOn = true): Promise<void> {
  await act(async () => { root.render(<Harness tick={tick} cameraOn={cameraOn} />); });
}
const video = (): HTMLVideoElement => container.querySelector('video') as HTMLVideoElement;
const displayedTracks = (): MediaStreamTrack[] => (video().srcObject as MediaStream).getVideoTracks();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal('MediaStream', CameraStream);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  sdkTrack = new LocalVideoTrack(rawTrack('first'), {}, false);
  await Promise.resolve();
  await Promise.resolve();
  livekit.tracks = [{ participant: { isLocal: true }, publication: { track: sdkTrack } }];
  livekit.mounts = 0;
  detachEvents = 0;
  sdkTrack.on(TrackEvent.ElementDetached, () => { detachEvents += 1; });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  sdkTrack.detach();
  sdkTrack.stop();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('SDD-217 셀프뷰 원본 교체', () => {
  it('SDD-224: 같은 SDK 트랙에서 폴백 스트림만 바뀌면 재attach하지 않는다', async () => {
    const attach = vi.spyOn(sdkTrack, 'attach');
    const view = (stream: MediaStream) => <HostSelfView cam="on" mic="on" big={false} stream={stream} track={sdkTrack} netBad={false} onPress={() => undefined} />;
    await act(async () => root.render(view(new CameraStream() as unknown as MediaStream)));
    const element = video();
    await act(async () => root.render(view(new CameraStream() as unknown as MediaStream)));
    expect(video()).toBe(element);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detachEvents).toBe(0);
  });
  it('NV-01: 같은 SDK 트랙의 restartTrack 뒤 새 카메라 원본을 표시한다', async () => {
    await render();
    expect(displayedTracks()[0].id).toBe('first');
    const next = rawTrack('recovered');
    getUserMedia.mockResolvedValue(new CameraStream([next]));
    await act(async () => { await sdkTrack.restartTrack(); });
    expect(sdkTrack.mediaStreamTrack).toBe(next);
    expect(displayedTracks()[0]).toBe(next);
    expect(displayedTracks()[0].readyState).toBe('live');
  });
  it('NV-01: 이벤트가 없는 SDK replaceTrack 경로도 새 원본을 표시한다', async () => {
    await render();
    Object.defineProperty(sdkTrack, 'sender', { value: { replaceTrack: async () => undefined }, configurable: true });
    const next = rawTrack('replacement');
    await act(async () => { await sdkTrack.replaceTrack(next); });
    expect(sdkTrack.mediaStreamTrack).toBe(next);
    expect(displayedTracks()[0]).toBe(next);
  });
  it('NV-02: 타이머 렌더는 재연결·추가 캡처 없이 유지하고 카메라 끔과 unmount에서 해제한다', async () => {
    await render();
    const element = video();
    const stream = element.srcObject;
    for (let tick = 1; tick <= 3; tick += 1) await render(tick);
    expect(video()).toBe(element);
    expect(video().srcObject).toBe(stream);
    expect(sdkTrack.attachedElements).toEqual([element]);
    expect(detachEvents).toBe(0);
    expect(livekit.mounts).toBe(1);
    expect(getUserMedia).not.toHaveBeenCalled();
    await render(4, false);
    expect(sdkTrack.attachedElements).toEqual([]);
    expect(element.srcObject).toBeNull();
    await render(5, true);
    const restored = video();
    expect(sdkTrack.attachedElements).toEqual([restored]);
    await act(async () => root.render(null));
    expect(sdkTrack.attachedElements).toEqual([]);
    expect(restored.srcObject).toBeNull();
    expect(detachEvents).toBe(2);
  });
});
