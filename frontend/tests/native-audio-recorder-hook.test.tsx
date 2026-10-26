// @vitest-environment jsdom
// SDD-247 FE: useAudioRecorder 네이티브 위임 (verify F1~F7, F9)
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
  resolveMock.mockReset();
  onError.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

describe('F1 웹/미지원 → MediaRecorder', () => {
  it('플러그인이 없으면 네이티브 start 없이 기존 경로(getUserMedia)를 탄다', async () => {
    resolveMock.mockResolvedValue(null);
    const getUserMedia = vi.fn().mockRejectedValue(new Error('no-mic'));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await mount();
    await act(async () => api.start());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(api.state).toBe('error');
  });
});

describe('네이티브 경로', () => {
  it('F2 start 인자 계약 + recording', async () => {
    const { plugin } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    expect(plugin.start).toHaveBeenCalledWith({
      sessionId: 's1', apiBase: 'https://dev.example/api/v1', accessToken: SECRET_ACCESS,
      refreshToken: SECRET_REFRESH, chunkMs: 5000, startChunkIndex: 0,
    });
    expect(api.state).toBe('recording');
  });

  it('F3 pause/resume/마이크 오프·온/stop 위임', async () => {
    const { plugin } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => api.pause());
    expect(plugin.pause).toHaveBeenCalledTimes(1);
    expect(api.state).toBe('paused');
    await act(async () => api.resume());
    expect(plugin.resume).toHaveBeenCalledTimes(1);
    expect(api.state).toBe('recording');
    await act(async () => api.setMicEnabled(false));
    expect(plugin.setMicEnabled).toHaveBeenLastCalledWith({ enabled: false });
    expect(api.state).toBe('paused');
    await act(async () => api.setMicEnabled(true));
    expect(plugin.setMicEnabled).toHaveBeenLastCalledWith({ enabled: true });
    expect(api.state).toBe('recording');
    await act(async () => api.stop());
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    expect(api.state).toBe('stopped');
    expect(api.uploadedChunks).toBe(3);
  });

  it('F3 이어 녹음 시 lastChunkIndex+1 부터 시작(인덱스 연속)', async () => {
    const { plugin } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => api.stop());
    await act(async () => api.start());
    expect(plugin.start).toHaveBeenLastCalledWith(expect.objectContaining({ startChunkIndex: 3 }));
  });

  it('F4 stop 오류 → error 상태', async () => {
    const { plugin } = makePlugin();
    plugin.stop.mockRejectedValue(new Error('boom'));
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => api.stop());
    expect(api.state).toBe('error');
    expect(onError).toHaveBeenCalled();
  });

  it('start 거부(permission_denied)는 MediaRecorder 로 폴백하지 않고 error', async () => {
    const { plugin } = makePlugin();
    plugin.start.mockRejectedValue(new Error('permission_denied'));
    resolveMock.mockResolvedValue(plugin);
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await mount();
    await act(async () => api.start());
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(api.state).toBe('error');
  });

  it('F5 auth_expired → 복귀 시 updateCredentials 재인계(1회)', async () => {
    const { plugin, handlers } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => handlers.error({ event: 'error', sessionId: 's1', code: 'auth_expired', message: 'x', recoverable: true }));
    expect(plugin.updateCredentials).not.toHaveBeenCalled();
    await act(async () => { await resumeCb?.(); });
    expect(plugin.updateCredentials).toHaveBeenCalledWith({ accessToken: SECRET_ACCESS, refreshToken: SECRET_REFRESH });
    await act(async () => { await resumeCb?.(); });
    expect(plugin.updateCredentials).toHaveBeenCalledTimes(1);
  });

  it('F6 복귀 시 getStatus 로 동기화(MediaRecorder 복구 미실행)', async () => {
    const { plugin } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await mount();
    await act(async () => api.start());
    await act(async () => { await resumeCb?.(); });
    expect(plugin.getStatus).toHaveBeenCalled();
    expect(api.uploadedChunks).toBe(7);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('F7 chunkUploaded → uploadedChunks, 언마운트 시 리스너 해제', async () => {
    const { plugin, handlers, removes } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => handlers.chunkUploaded({ event: 'chunkUploaded', sessionId: 's1', chunkIndex: 4, sizeBytes: 10, uploadedCount: 5, pendingCount: 0 }));
    expect(api.uploadedChunks).toBe(5);
    await act(async () => root.unmount());
    expect(removes).toHaveLength(3);
    removes.forEach((r) => expect(r).toHaveBeenCalled());
    root = createRoot(box);
  });

  it('F9 토큰 값이 onError 로 새지 않는다', async () => {
    const { plugin, handlers } = makePlugin();
    resolveMock.mockResolvedValue(plugin);
    await mount();
    await act(async () => api.start());
    await act(async () => handlers.error({ event: 'error', sessionId: 's1', code: 'upload_failed', message: '실패', recoverable: true }));
    const text = JSON.stringify(onError.mock.calls.map((c) => String((c[0] as Error).message)));
    expect(text).not.toContain(SECRET_ACCESS);
    expect(text).not.toContain(SECRET_REFRESH);
  });
});
