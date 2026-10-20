// @vitest-environment jsdom
// SDD-222 T-J10 — HostLiveKitBridge 앱 복귀 처리 (V36·V37·V38)
import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState } from 'livekit-client';

const h = vi.hoisted(() => ({
  state: 'connected' as string,
  mounts: 0,
  setCamera: vi.fn(async (..._a: unknown[]) => undefined),
  setMic: vi.fn(async (..._a: unknown[]) => undefined),
  resume: [] as { cb: () => void | Promise<void>; order?: number }[],
}));

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }: { children: ReactNode }) => {
    useEffect(() => { h.mounts += 1; }, []);
    return <div>{children}</div>;
  },
  RoomAudioRenderer: () => null,
  useConnectionState: () => h.state,
  useLocalParticipant: () => ({ localParticipant: { setCameraEnabled: h.setCamera, setMicrophoneEnabled: h.setMic } }),
  // 실제 Room 처럼 state 는 호출 시점의 최신 값을 돌려주는 살아 있는 객체
  useRoomContext: () => ({
    get state() { return h.state; },
    localParticipant: { setCameraEnabled: h.setCamera, setMicrophoneEnabled: h.setMic },
  }),
  useTracks: () => [],
}));
vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { socket: 10, rawFlush: 20, ble: 30, screen: 40, liveKit: 50, audio: 60 },
  subscribeAppResume: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; h.resume.push(e);
    return () => { h.resume.splice(h.resume.indexOf(e), 1); };
  },
  subscribeAppPause: () => () => undefined,
}));

import { HostLiveKitBridge } from '../src/components/class/player/host/HostLiveKitBridge';

let root: Root;
const render = (camOn: boolean) => act(async () => root.render(
  <HostLiveKitBridge token="t" serverUrl="wss://x" micOn camOn={camOn} />,
));
const fireResume = () => act(async () => { for (const e of [...h.resume]) await e.cb(); });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.state = ConnectionState.Connected; h.mounts = 0; h.resume.length = 0;
  h.setCamera.mockClear(); h.setMic.mockClear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('HostLiveKitBridge — 앱 복귀', () => {
  it('V38 연결 상태+카메라 켜짐이면 복귀 시 setCameraEnabled(true) 를 다시 호출하고 재연결하지 않는다 (V37)', async () => {
    await render(true);
    h.setCamera.mockClear();
    await fireResume();
    expect(h.setCamera).toHaveBeenCalledWith(true);
    expect(h.mounts).toBe(1);
  });

  it('V38 카메라 꺼짐이면 복귀해도 카메라를 켜지 않는다', async () => {
    await render(false);
    h.setCamera.mockClear();
    await fireResume();
    expect(h.setCamera).not.toHaveBeenCalledWith(true);
  });

  it('V36 연결이 끊겨 있으면 복귀 시 LiveKit 연결을 다시 맺는다(재마운트)', async () => {
    await render(true);
    h.state = ConnectionState.Disconnected;
    await fireResume();
    expect(h.mounts).toBe(2);
  });

  it('LiveKit 복구는 소켓 재연결 뒤(order > socket)에 실행되도록 등록된다', async () => {
    await render(true);
    expect(h.resume.every((e) => (e.order ?? 0) > 10)).toBe(true);
  });
});
