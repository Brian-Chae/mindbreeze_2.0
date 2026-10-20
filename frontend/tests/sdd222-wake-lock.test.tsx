// @vitest-environment jsdom
// SDD-222 T-J8 — useWakeLock 네이티브 분기 (V19·V20·V21)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  keepAwake: vi.fn(async () => undefined),
  allowSleep: vi.fn(async () => undefined),
  resume: [] as { cb: () => void | Promise<void>; order?: number }[],
}));
vi.mock('../src/lib/native/platform', () => ({
  isNativeApp: () => h.native,
  getPlatform: () => (h.native ? 'android' : 'web'),
}));
vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { socket: 10, rawFlush: 20, ble: 30, screen: 40 },
  subscribeAppResume: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; h.resume.push(e);
    return () => { h.resume.splice(h.resume.indexOf(e), 1); };
  },
  subscribeAppPause: () => () => undefined,
}));
vi.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: { keepAwake: h.keepAwake, allowSleep: h.allowSleep },
}));

import { useWakeLock } from '../src/hooks/useWakeLock';

let root: Root;
function Harness({ enabled }: { enabled: boolean }) {
  useWakeLock(enabled);
  return null;
}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const render = async (enabled: boolean) => { await act(async () => root.render(<Harness enabled={enabled} />)); await settle(); };

const sentinel = () => ({
  released: false,
  release: vi.fn(async () => undefined),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.native = true; h.resume.length = 0;
  h.keepAwake.mockClear(); h.allowSleep.mockClear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('useWakeLock 네이티브', () => {
  it('V19 enabled=true 면 KeepAwake.keepAwake, false 로 바뀌면 allowSleep 을 호출한다', async () => {
    await render(true);
    expect(h.keepAwake).toHaveBeenCalledTimes(1);
    expect(h.allowSleep).not.toHaveBeenCalled();
    await render(false);
    expect(h.allowSleep).toHaveBeenCalledTimes(1);
  });

  it('V19 언마운트 시 allowSleep 을 호출한다', async () => {
    await render(true);
    await act(async () => root.unmount());
    expect(h.allowSleep).toHaveBeenCalledTimes(1);
    root = createRoot(document.createElement('div'));
  });

  it('V21 앱 복귀(screen 단계 40)에서 KeepAwake 를 재요청한다', async () => {
    await render(true);
    expect(h.resume.map((e) => e.order)).toEqual([40]);
    await act(async () => { await h.resume[0].cb(); });
    expect(h.keepAwake).toHaveBeenCalledTimes(2);
  });

  it('enabled=false 에서는 아무것도 호출·구독하지 않는다', async () => {
    await render(false);
    expect(h.keepAwake).not.toHaveBeenCalled();
    expect(h.resume).toHaveLength(0);
  });

  it('네이티브에서는 navigator.wakeLock 경로를 쓰지 않는다', async () => {
    const request = vi.fn(async () => sentinel());
    vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
    await render(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('KeepAwake 호출 실패는 조용히 무시한다(수업 화면 영향 없음)', async () => {
    h.keepAwake.mockRejectedValueOnce(new Error('unsupported'));
    await expect(render(true)).resolves.not.toThrow();
  });
});

describe('useWakeLock 웹 회귀', () => {
  it('V20 웹에서는 navigator.wakeLock 만 사용하고 KeepAwake·앱 복귀 구독은 쓰지 않는다', async () => {
    h.native = false;
    const s = sentinel();
    const request = vi.fn(async () => s);
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    await render(true);
    expect(request).toHaveBeenCalledWith('screen');
    expect(h.keepAwake).not.toHaveBeenCalled();
    expect(h.resume).toHaveLength(0);
    await act(async () => root.unmount());
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(h.allowSleep).not.toHaveBeenCalled();
    root = createRoot(document.createElement('div'));
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('웹: 탭이 다시 visible 되면 wake lock 을 재요청한다(기존 동작 유지)', async () => {
    h.native = false;
    const request = vi.fn(async () => sentinel());
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    await render(true);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(request).toHaveBeenCalledTimes(2);
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('웹: wakeLock 미지원 브라우저에서도 예외 없이 무시한다', async () => {
    h.native = false;
    await expect(render(true)).resolves.not.toThrow();
    expect(h.keepAwake).not.toHaveBeenCalled();
  });
});
