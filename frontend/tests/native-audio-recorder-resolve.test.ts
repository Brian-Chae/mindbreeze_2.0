// SDD-247 회귀: Capacitor 플러그인 프록시는 모든 속성 접근을 네이티브 메서드로 바꾼다.
// async 함수가 프록시를 그대로 resolve 하면 Promise 가 `.then` 을 조회 → "NativeAudioRecorder.then() is not implemented"
// 로 reject 되어 네이티브 녹음이 시작되지 않았다(Note10 실측, evidence/note10-v1.md).
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Capacitor registerPlugin 프록시 흉내: 정의되지 않은 속성(then 포함)도 함수로 돌려준다. */
function capacitorLikeProxy(impl: Record<string, unknown>): unknown {
  return new Proxy(impl, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      return () => Promise.reject(new Error(`NativeAudioRecorder.${String(prop)}() is not implemented on android`));
    },
  });
}

const proxy = capacitorLikeProxy({
  isAvailable: () => Promise.resolve({ available: true }),
  start: vi.fn(() => Promise.resolve()),
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => proxy,
}));

describe('resolveNativeAudioRecorder', () => {
  afterEach(() => vi.clearAllMocks());

  it('플러그인 프록시를 await 해도 then 함정에 걸리지 않고 메서드를 쓸 수 있다', async () => {
    const { resolveNativeAudioRecorder } = await import('../src/lib/native-audio-recorder');
    const plugin = await resolveNativeAudioRecorder();
    expect(plugin).not.toBeNull();
    await plugin!.start({
      sessionId: 's1', apiBase: 'https://x/api/v1', accessToken: 'a', refreshToken: 'r', chunkMs: 5000, startChunkIndex: 0,
    });
    expect((proxy as { start: ReturnType<typeof vi.fn> }).start).toHaveBeenCalledTimes(1);
  });
});
