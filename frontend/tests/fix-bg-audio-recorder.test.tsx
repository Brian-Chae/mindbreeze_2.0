// @vitest-environment jsdom
// FIX 스토어 백그라운드 녹음 — useAudioRecorder 복귀 복구 (V4·V5·V6) + 호스트 FGS 마이크 타입 (V1·V2)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  resume: [] as { cb: () => void | Promise<void> }[],
  uploads: [] as number[],
}));
vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { socket: 10, rawFlush: 20, ble: 30, screen: 40, liveKit: 50, audio: 60 },
  subscribeAppResume: (cb: () => void | Promise<void>) => {
    const e = { cb }; h.resume.push(e);
    return () => { h.resume.splice(h.resume.indexOf(e), 1); };
  },
  subscribeAppPause: () => () => undefined,
}));
vi.mock('../src/lib/api/audio', () => ({
  uploadChunk: async (_s: string, idx: number) => { h.uploads.push(idx); },
}));
vi.mock('../src/hooks/use-mobile-swipe-protection', () => ({ useMobileSwipeProtection: () => undefined }));

import { useAudioRecorder } from '../src/hooks/useAudioRecorder';

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onerror: unknown = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) { FakeRecorder.instances.push(this); }
  static isTypeSupported() { return true; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.onstop?.(); }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  emit() { this.ondataavailable?.({ data: new Blob(['x']) }); }
}
let tracks: { readyState: string; stop: () => void }[] = [];
const getUserMedia = vi.fn(async () => {
  const t = { readyState: 'live', stop: vi.fn() };
  tracks.push(t);
  return { getTracks: () => [t] };
});

let root: Root;
let api: ReturnType<typeof useAudioRecorder>;
function Harness() { api = useAudioRecorder({ sessionId: 's1' }); return null; }
const render = () => act(async () => root.render(<Harness />));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.resume.length = 0; h.uploads.length = 0; FakeRecorder.instances = []; tracks = []; getUserMedia.mockClear();
  Object.defineProperty(globalThis.navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('useAudioRecorder — 복귀 복구', () => {
  it('V4 녹음 중 복귀했을 때 track 이 ended 면 새 스트림·recorder 로 재시작하고 인덱스를 이어간다', async () => {
    await render();
    await act(async () => { await api.start(); });
    FakeRecorder.instances[0].emit();
    tracks[0].readyState = 'ended';
    FakeRecorder.instances[0].state = 'inactive';
    await act(async () => { await h.resume[0].cb(); });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(FakeRecorder.instances).toHaveLength(2);
    FakeRecorder.instances[1].emit();
    await act(async () => { await Promise.resolve(); });
    expect(h.uploads).toEqual([0, 1]);
  });

  it('V5 track 이 살아 있으면 재시작하지 않는다', async () => {
    await render();
    await act(async () => { await api.start(); });
    await act(async () => { await h.resume[0].cb(); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('V5 녹음 중이 아니면(idle) 복귀해도 마이크를 열지 않는다', async () => {
    await render();
    await act(async () => { for (const e of h.resume) await e.cb(); });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('V6 정지 후에는 복귀해도 재시작하지 않는다', async () => {
    await render();
    await act(async () => { await api.start(); });
    await act(async () => { await api.stop(); });
    await act(async () => { for (const e of h.resume) await e.cb(); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
