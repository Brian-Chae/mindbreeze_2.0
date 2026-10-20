// @vitest-environment jsdom
// SDD-222 T-J5 — app-lifecycle / useAppResume (V18 + resume 구독)
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  handler: null as null | ((s: { isActive: boolean }) => void),
  remove: vi.fn(async () => undefined),
  addListener: vi.fn(),
}));
vi.mock('../src/lib/native/platform', () => ({
  isNativeApp: () => h.native,
  getPlatform: () => (h.native ? 'android' : 'web'),
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: h.addListener },
}));

async function load() {
  vi.resetModules();
  return import('../src/lib/native/app-lifecycle');
}
const emit = async (isActive: boolean) => {
  await act(async () => { h.handler?.({ isActive }); await Promise.resolve(); });
};

beforeEach(() => {
  h.native = true; h.handler = null; h.remove.mockClear(); h.addListener.mockReset();
  h.addListener.mockImplementation(async (_e: string, cb: (s: { isActive: boolean }) => void) => {
    h.handler = cb;
    return { remove: h.remove };
  });
});

describe('app-lifecycle', () => {
  it('V18 웹에서는 @capacitor/app 리스너를 등록하지 않는다', async () => {
    h.native = false;
    const { subscribeAppResume } = await load();
    const unsub = subscribeAppResume(vi.fn());
    await Promise.resolve();
    expect(h.addListener).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
  });

  it('네이티브: isActive=true 는 resume, false 는 pause 구독자에게만 전달된다', async () => {
    const { subscribeAppResume, subscribeAppPause } = await load();
    const onResume = vi.fn(); const onPause = vi.fn();
    subscribeAppResume(onResume); subscribeAppPause(onPause);
    await Promise.resolve();
    await emit(true);
    expect(onResume).toHaveBeenCalledTimes(1); expect(onPause).not.toHaveBeenCalled();
    await emit(false);
    expect(onPause).toHaveBeenCalledTimes(1); expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('네이티브 리스너는 구독자 수와 무관하게 1개만 등록되고, 마지막 해제 시 제거된다', async () => {
    const { subscribeAppResume } = await load();
    const a = subscribeAppResume(vi.fn()); const b = subscribeAppResume(vi.fn());
    await Promise.resolve();
    expect(h.addListener).toHaveBeenCalledTimes(1);
    a(); await Promise.resolve();
    expect(h.remove).not.toHaveBeenCalled();
    b(); await Promise.resolve(); await Promise.resolve();
    expect(h.remove).toHaveBeenCalledTimes(1);
  });

  it('한 구독자의 예외가 다른 구독자 호출을 막지 않는다', async () => {
    const { subscribeAppResume } = await load();
    const bad = vi.fn(() => { throw new Error('x'); }); const good = vi.fn();
    subscribeAppResume(bad); subscribeAppResume(good);
    await Promise.resolve();
    await emit(true);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('구독 해제 후에는 호출되지 않는다', async () => {
    const { subscribeAppResume } = await load();
    const cb = vi.fn(); const other = vi.fn();
    const unsub = subscribeAppResume(cb); subscribeAppResume(other);
    await Promise.resolve();
    unsub();
    await emit(true);
    expect(cb).not.toHaveBeenCalled(); expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('useAppResume', () => {
  it('최신 콜백을 호출하고 언마운트 시 해제한다', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.resetModules(); // 앞선 테스트의 구독 상태가 남지 않도록 모듈 초기화
    const { useAppResume } = await import('../src/hooks/useAppResume');
    const calls: string[] = [];
    function Harness({ tag }: { tag: string }) {
      useAppResume(() => { calls.push(tag); });
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<Harness tag="a" />));
    await act(async () => root.render(<Harness tag="b" />));
    await Promise.resolve();
    await emit(true);
    expect(calls).toEqual(['b']);
    await act(async () => root.unmount());
    await emit(true);
    expect(calls).toEqual(['b']);
  });
});
