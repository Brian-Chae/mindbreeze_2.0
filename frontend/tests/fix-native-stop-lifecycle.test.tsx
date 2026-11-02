// @vitest-environment jsdom
// 실제 훅 마운트 경계 회귀 — (1) 화면 유지 중 bandOptIn 토글은 stop/start 를 만들지 않는다 (2) 이전 화면의 늦은 stop 이 새 회차를 끊지 않는다.
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as unknown[][], stopDelay: 0, releaseGate: null as null | Promise<string>, startGate: null as null | Promise<unknown> }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' } }));
vi.mock('../src/lib/session-live/live-flag', () => ({ isLiveProtocolV2Enabled: () => true }));
vi.mock('../src/lib/api/client', () => ({ BASE_URL: 'https://api/api/v1', getNativeRefreshBody: () => ({ refresh_token: 'rt' }), tokenStorage: { getAccess: () => 'at' } }));
vi.mock('../src/lib/socket', () => ({ SOCKET_URL: 'https://api' }));
vi.mock('../src/lib/eeg/eegPersonalScore', () => ({ getActiveModelCache: () => null, refreshActiveModel: async () => null }));
vi.mock('../src/lib/eeg/bluetoothService', () => ({ bluetoothService: { getDeviceId: () => 'DEV-1', getCachedDeviceId: () => 'DEV-1', releaseForNative: async () => (h.releaseGate ? h.releaseGate : 'DEV-1') } }));
vi.mock('../src/lib/native-measurement', () => ({
  isNativeMeasurementAvailable: () => true,
  buildNativeModelPayload: () => null,
  getNativeMeasurement: () => ({
    attach: async () => undefined, detach: async () => undefined, onMeasurement: () => () => undefined, onUploadProgress: () => () => undefined,
    reconnectBand: async () => { h.calls.push(['reconnect']); return true; },
    stop: async (r: { reason: string }) => { h.calls.push(['stop', r.reason]); return { accepted: true }; },
    startForSession: async (a: { sessionId: string; releaseJsBand?: () => Promise<unknown>; isValid?: () => boolean }) => {
      // 실제 facade 순서 재현: release await → 유효성 재확인 → native start → (진행 중 await)
      if (a.releaseJsBand) await a.releaseJsBand();
      if (a.isValid && !a.isValid()) throw new Error('start_cancelled');
      h.calls.push(['start', a.sessionId]);
      if (h.startGate) await h.startGate;
      return {};
    },
  }),
}));

import { useNativeMeasurementV2 } from '../src/lib/measurement-web/use-native-measurement';

type Opts = Parameters<typeof useNativeMeasurementV2>[0];
const opts = (over: Partial<Opts> = {}): Opts => ({
  v2: true, sessionId: '00000001-0000-4000-8000-00000000000A', participantId: '00000002-0000-4000-8000-000000000002',
  accountId: 'u1', bandOptIn: true, eegConsent: true, bandConnected: true, enabled: true, ...over,
});
function Probe(p: Opts) { useNativeMeasurementV2(p); useEffect(() => undefined); return null; }
const flush = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
const names = () => h.calls.map((c) => c.join(':'));

let root: Root;
describe('useNativeMeasurementV2 — stop 생명주기 (실제 마운트 경계)', () => {
  beforeEach(() => { h.calls.length = 0; vi.useFakeTimers(); root = createRoot(document.createElement('div')); });
  afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

  it('시나리오1: bandOptIn=false 를 오래 유지해도(화면 유지) stop(user_left) 0회, 복귀해도 start 추가 없음', async () => {
    await act(async () => { root.render(<Probe {...opts()} />); });
    await flush();
    await act(async () => { root.render(<Probe {...opts({ bandOptIn: false })} />); });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    await act(async () => { root.render(<Probe {...opts()} />); });
    await flush();
    expect(names().filter((n) => n.startsWith('stop'))).toEqual([]);
    expect(names().filter((n) => n.startsWith('start'))).toHaveLength(1);
  });

  it('시나리오2: ready=false 상태에서 언마운트 후 새 회차 B 시작 — 늦은 타이머가 B 를 끊지 않는다', async () => {
    await act(async () => { root.render(<Probe {...opts()} />); });
    await flush();
    await act(async () => { root.render(<Probe {...opts({ bandOptIn: false })} />); });
    await act(async () => { root.unmount(); });
    await flush();
    root = createRoot(document.createElement('div'));
    await act(async () => { root.render(<Probe {...opts({ sessionId: '00000001-0000-4000-8000-00000000000B' })} />); });
    await flush();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(names()).toEqual(['start:00000001-0000-4000-8000-00000000000A', 'stop:user_left', 'start:00000001-0000-4000-8000-00000000000B']);
  });

  it('언마운트·동의 철회만 명시적 stop', async () => {
    await act(async () => { root.render(<Probe {...opts()} />); });
    await flush();
    await act(async () => { root.render(<Probe {...opts({ eegConsent: false })} />); });
    await flush();
    expect(names()).toContain('stop:consent_withdrawn');
    expect(names().filter((n) => n.startsWith('stop'))).toHaveLength(1);
  });

  it('경합1: BLE release 대기 중 동의 철회 → start 가 실행되지 않고 최종 정지', async () => {
    let release!: (v: string) => void;
    h.releaseGate = new Promise<string>((r) => { release = r; });
    await act(async () => { root.render(<Probe {...opts()} />); });
    await flush();
    await act(async () => { root.render(<Probe {...opts({ eegConsent: false })} />); });
    await flush();
    release('DEV-1');
    await flush();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await flush();
    expect(names().filter((n) => n.startsWith('start'))).toEqual([]);
    expect(names().filter((n) => n.startsWith('stop'))).toEqual(['stop:consent_withdrawn']);
    h.releaseGate = null;
  });

  it('경합2: start 요청이 나간 뒤(완료 전) 동의 철회 → 완료 직후 stop(consent_withdrawn)이 마지막', async () => {
    let done!: () => void;
    h.startGate = new Promise<unknown>((r) => { done = () => r({}); });
    await act(async () => { root.render(<Probe {...opts()} />); });
    await flush();
    expect(names()).toEqual(['start:00000001-0000-4000-8000-00000000000A']);
    await act(async () => { root.render(<Probe {...opts({ eegConsent: false })} />); });
    await flush();
    done();
    await flush();
    const stops = names().filter((n) => n.startsWith('stop'));
    expect(stops.length).toBeGreaterThanOrEqual(1);
    expect(names()[names().length - 1]).toBe('stop:consent_withdrawn');
    h.startGate = null;
  });
});
