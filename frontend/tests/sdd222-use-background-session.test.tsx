// @vitest-environment jsdom
// SDD-222 T-J9 — useBackgroundSession (V25·V28, 복귀 재시도, 배터리 안내 1회)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  resume: [] as { cb: () => void | Promise<void>; order?: number }[],
  platform: 'android' as 'android' | 'ios' | 'web',
}));
vi.mock('../src/lib/native/background-session', () => ({
  startBackgroundSession: () => h.start(),
  stopBackgroundSession: () => h.stop(),
}));
vi.mock('../src/lib/native/platform', () => ({
  isNativeApp: () => h.platform !== 'web',
  getPlatform: () => h.platform,
}));
vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { socket: 10, rawFlush: 20, ble: 30, screen: 40 },
  subscribeAppResume: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; h.resume.push(e);
    return () => { h.resume.splice(h.resume.indexOf(e), 1); };
  },
  subscribeAppPause: () => () => undefined,
}));

import { BATTERY_GUIDE_STORAGE_KEY, useBackgroundSession } from '../src/hooks/useBackgroundSession';

let root: Root;
let last: ReturnType<typeof useBackgroundSession>;
function Harness({ active }: { active: boolean }) {
  last = useBackgroundSession(active);
  return null;
}
const render = (active: boolean) => act(async () => root.render(<Harness active={active} />));

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  h.start.mockClear(); h.stop.mockClear(); h.resume.length = 0; h.platform = 'android';
  localStorage.clear();
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); });

describe('useBackgroundSession', () => {
  it('active=true 인 동안 시작 1회, 리렌더로 재시작하지 않는다', async () => {
    await render(true); await render(true);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.stop).not.toHaveBeenCalled();
  });

  it('V25 active 가 true→false 로 바뀌면 종료한다', async () => {
    await render(true); await render(false);
    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('V25 언마운트하면 종료한다', async () => {
    await render(true);
    await act(async () => root.unmount());
    expect(h.stop).toHaveBeenCalledTimes(1);
    root = createRoot(document.createElement('div'));
  });

  it('active=false 로 시작하면 시작도 종료도 호출하지 않는다', async () => {
    await render(false);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.stop).not.toHaveBeenCalled();
    expect(h.resume).toHaveLength(0);
  });

  it('앱 복귀 시 아직 시작되지 않았을 수 있으므로(권한 허용 후 복귀 등) 시작을 재시도한다', async () => {
    await render(true);
    await act(async () => { await h.resume[0].cb(); });
    expect(h.start).toHaveBeenCalledTimes(2); // 멱등은 background-session 이 보장
  });

  it('비활성 상태에서는 복귀해도 시작하지 않는다', async () => {
    await render(true); await render(false);
    h.start.mockClear();
    expect(h.resume).toHaveLength(0);
  });
});

describe('배터리 최적화 안내', () => {
  it('Android 앱에서 첫 활성화 시 1회 노출되고, 확인하면 다시 노출되지 않는다', async () => {
    await render(true);
    expect(last.batteryGuideOpen).toBe(true);
    await act(async () => last.dismissBatteryGuide());
    expect(last.batteryGuideOpen).toBe(false);
    expect(localStorage.getItem(BATTERY_GUIDE_STORAGE_KEY)).toBe('1');
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    await render(true);
    expect(last.batteryGuideOpen).toBe(false);
  });

  it('iOS·웹에서는 노출하지 않는다', async () => {
    h.platform = 'ios';
    await render(true);
    expect(last.batteryGuideOpen).toBe(false);
  });

  it('active=false 에서는 노출하지 않는다', async () => {
    await render(false);
    expect(last.batteryGuideOpen).toBe(false);
  });

  it('localStorage 접근이 막혀도 예외 없이 동작한다', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    await expect(render(true)).resolves.not.toThrow();
    spy.mockRestore();
  });
});
