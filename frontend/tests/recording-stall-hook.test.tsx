// @vitest-environment jsdom
// [Fix] 녹음 끊김 감지·자동 재시작 — useAudioRecorder 연동 (verify V7~V10)
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeAudioEvent, NativeAudioRecorderPlugin } from '../src/lib/native-audio-recorder/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SECRET_ACCESS = 'access-secret-xyz';
const SECRET_REFRESH = 'refresh-secret-xyz';

const resolveMock = vi.fn();
vi.mock('../src/lib/native-audio-recorder', async () => {
  const types = await vi.importActual<object>('../src/lib/native-audio-recorder/types');
  return { ...types, resolveNativeAudioRecorder: () => resolveMock() };
});
vi.mock('../src/lib/api/audio', () => ({ uploadChunk: vi.fn().mockResolvedValue({}) }));
vi.mock('../src/lib/api/client', () => ({
  BASE_URL: 'https://dev.example/api/v1',
  tokenStorage: { getAccess: () => SECRET_ACCESS },
  getNativeRefreshBody: () => ({ refresh_token: SECRET_REFRESH }),
}));
vi.mock('../src/hooks/use-mobile-swipe-protection', () => ({ useMobileSwipeProtection: () => undefined }));
let resumeCb: (() => Promise<void> | void) | null = null;
vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { audio: 60 },
  subscribeAppResume: (cb: () => Promise<void> | void) => {
    resumeCb = cb;
    return () => { resumeCb = null; };
  },
}));

import { useAudioRecorder } from '../src/hooks/useAudioRecorder';

type Handler = (ev: NativeAudioEvent) => void;
const status = (state: string, extra: Record<string, unknown> = {}) => ({
  state, sessionId: 's1', nextChunkIndex: 0, uploadedCount: 0, pendingCount: 0, lastUploadedIndex: -1, ...extra,
});

function makePlugin() {
  const handlers: Record<string, Handler> = {};
  const removes: Array<ReturnType<typeof vi.fn>> = [];
  const plugin = {
    isAvailable: vi.fn().mockResolvedValue({ available: true }),
    start: vi.fn().mockResolvedValue(status('recording')),
    stop: vi.fn().mockResolvedValue({ pendingCount: 0, uploadedCount: 3, lastChunkIndex: 2 }),
    pause: vi.fn().mockResolvedValue(status('paused')),
    resume: vi.fn().mockResolvedValue(status('recording')),
    setMicEnabled: vi.fn().mockResolvedValue(status('micOff')),
    getStatus: vi.fn().mockResolvedValue(status('recording', { uploadedCount: 7 })),
    updateCredentials: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn(async (name: string, cb: Handler) => {
      handlers[name] = cb;
      const remove = vi.fn().mockResolvedValue(undefined);
      removes.push(remove);
      return { remove };
    }),
  };
  return { plugin: plugin as unknown as NativeAudioRecorderPlugin & typeof plugin, handlers, removes };
}

let api: ReturnType<typeof useAudioRecorder>;
let root: ReturnType<typeof createRoot>;
let box: HTMLDivElement;
const onError = vi.fn();
function Probe() {
  const hook = useAudioRecorder({ sessionId: 's1', onError });
  useEffect(() => {
    api = hook;
  });
  return null;
}
async function mount() {
  box = document.createElement('div');
  document.body.append(box);
  root = createRoot(box);
  await act(async () => root.render(<Probe />));
}

beforeEach(() => {
  vi.useFakeTimers();
  resolveMock.mockReset();
  onError.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('녹음 정지 감지 연동', () => {
  it('V7 recording 인데 30초 진행 없음 → stalled + 네이티브 상태가 recording 이면 캡처를 새로 연다', async () => {
    const { plugin } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await advance(40_000);
    expect(api.stalled).toBe(true);
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(plugin.start).toHaveBeenCalledTimes(2);
  });

  it('V7b 네이티브가 paused 로 멈춰 있으면 resume 으로 복구한다', async () => {
    const { plugin } = makePlugin();
    plugin.getStatus.mockResolvedValue(status('paused'));
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await advance(40_000);
    expect(plugin.resume).toHaveBeenCalledTimes(1);
    expect(plugin.start).toHaveBeenCalledTimes(1);
  });

  it('V8 마이크 꺼짐(setMicEnabled false) 60초 → 경고·복구 없음', async () => {
    const { plugin } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => api.setMicEnabled(false));
    await advance(60_000);
    expect(api.stalled).toBe(false);
    expect(plugin.resume).not.toHaveBeenCalled();
    expect(plugin.start).toHaveBeenCalledTimes(1);
  });

  it('V9 restartRecording: stop 후 lastChunkIndex+1 로 start', async () => {
    const { plugin } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => api.restartRecording());
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(plugin.start).toHaveBeenLastCalledWith(expect.objectContaining({ startChunkIndex: 3 }));
    expect(api.state).toBe('recording');
  });

  it('V10 인터럽션 일시정지 표시 → 재개 시 해제', async () => {
    const { plugin, handlers } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => handlers.stateChanged({ event: 'stateChanged', sessionId: 's1', state: 'paused', reason: 'interruption' }));
    expect(api.pausedByInterruption).toBe(true);
    expect(api.state).toBe('paused');
    await act(async () => handlers.stateChanged({ event: 'stateChanged', sessionId: 's1', state: 'recording', reason: 'interruption' }));
    expect(api.pausedByInterruption).toBe(false);
  });
});
