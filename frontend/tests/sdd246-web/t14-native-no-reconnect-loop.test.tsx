// @vitest-environment jsdom
// 앱 클래스 중 밴드 연결 반복 방지 — bandConnected 토글·재시도·재렌더에도 startForSession 은 1회, JS 해제도 1회, stop 은 언마운트 때만.
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  platform: 'ios', start: vi.fn(), stop: vi.fn(), release: vi.fn(), attach: vi.fn(), detach: vi.fn(),
  deviceId: 'DEV-1', cached: 'DEV-1' as string | null, startFails: 0,
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => h.platform } }));
vi.mock('../../src/lib/session-live/live-flag', () => ({ isLiveProtocolV2Enabled: () => true }));
vi.mock('../../src/lib/api/client', () => ({
  BASE_URL: 'https://api/api/v1', getNativeRefreshBody: () => ({ refresh_token: 'rt' }), tokenStorage: { getAccess: () => 'at' },
}));
vi.mock('../../src/lib/socket', () => ({ SOCKET_URL: 'https://api' }));
vi.mock('../../src/lib/eeg/eegPersonalScore', () => ({ getActiveModelCache: () => null, refreshActiveModel: async () => null }));
vi.mock('../../src/lib/eeg/bluetoothService', () => ({
  bluetoothService: { getDeviceId: () => h.deviceId, getCachedDeviceId: () => h.cached, releaseForNative: async () => { h.release(); h.deviceId = ''; h.cached = null; return 'DEV-1'; } },
}));
vi.mock('../../src/lib/native-measurement', () => ({
  isNativeMeasurementAvailable: () => true,
  buildNativeModelPayload: () => null,
  getNativeMeasurement: () => ({
    attach: async () => { h.attach(); }, detach: async () => { h.detach(); }, onMeasurement: () => () => undefined, stop: async (r: unknown) => { h.stop(r); return { accepted: true }; },
    startForSession: async (a: { releaseJsBand?: () => Promise<unknown> }) => {
      h.start();
      await a.releaseJsBand?.();
      if (h.startFails > 0) { h.startFails -= 1; throw new Error('boom'); }
      return {};
    },
  }),
}));

import { useNativeMeasurementV2 } from '../../src/lib/measurement-web/use-native-measurement';

type Opts = Parameters<typeof useNativeMeasurementV2>[0];
const opts = (bandConnected: boolean): Opts => ({
  v2: true, sessionId: '00000001-0000-4000-8000-000000000001', participantId: '00000002-0000-4000-8000-000000000002',
  accountId: 'u1', bandOptIn: true, eegConsent: true, bandConnected, enabled: true,
});
function Probe(p: Opts) { useNativeMeasurementV2(p); useEffect(() => undefined); return null; }

let root: Root;
const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });

describe('useNativeMeasurementV2 — 연결 반복 방지', () => {
  beforeEach(() => {
    h.platform = 'ios'; h.deviceId = 'DEV-1'; h.cached = 'DEV-1'; h.startFails = 0;
    for (const f of [h.start, h.stop, h.release, h.attach, h.detach]) f.mockClear();
    root = createRoot(document.createElement('div'));
  });
  afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

  for (const platform of ['ios', 'android']) {
    it(`${platform}: bandConnected 가 true→false→true 로 흔들려도 시작·해제는 1회, stop 0회`, async () => {
      h.platform = platform;
      await act(async () => { root.render(<Probe {...opts(true)} />); });
      await flush();
      await act(async () => { root.render(<Probe {...opts(false)} />); });
      await flush();
      await act(async () => { root.render(<Probe {...opts(true)} />); });
      await flush();
      await act(async () => { root.render(<Probe {...opts(false)} />); });
      await flush();
      expect(h.start).toHaveBeenCalledTimes(1);
      expect(h.release).toHaveBeenCalledTimes(1);
      expect(h.stop).not.toHaveBeenCalled();
    });
  }

  it('성공한 세션 위에서는 재시도 타이머가 없다(시간이 지나도 start 1회)', async () => {
    vi.useFakeTimers();
    await act(async () => { root.render(<Probe {...opts(true)} />); });
    await flush();
    await act(async () => { vi.advanceTimersByTime(120_000); });
    await flush();
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  it('시작 실패는 백오프 재시도 최대 5회까지만(총 6회) 하고 그 뒤로는 멈춘다', async () => {
    vi.useFakeTimers();
    h.startFails = 100;
    await act(async () => { root.render(<Probe {...opts(true)} />); });
    await flush();
    for (let i = 0; i < 8; i += 1) { await act(async () => { vi.advanceTimersByTime(120_000); }); await flush(); }
    expect(h.start).toHaveBeenCalledTimes(6);
  });

  it('언마운트 시에만 stop 1회', async () => {
    await act(async () => { root.render(<Probe {...opts(true)} />); });
    await flush();
    await act(async () => { root.unmount(); });
    expect(h.stop).toHaveBeenCalledTimes(1);
    root = createRoot(document.createElement('div'));
  });
});
