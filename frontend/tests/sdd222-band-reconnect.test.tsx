// @vitest-environment jsdom
// SDD-222 T-J3 — useBand 자동 재연결 루프 (V2·V3·V4·V5·V7)
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ble = vi.hoisted(() => ({
  connectImpl: vi.fn<(id: string) => Promise<void>>(),
  lost: null as null | (() => void),
  connected: false,
  cached: null as string | null,
  disconnectSvc: vi.fn(async () => undefined),
}));
const gap = vi.hoisted(() => ({
  open: vi.fn(), recordAttempt: vi.fn(), close: vi.fn(() => null), getOpenGap: vi.fn(() => null), getClosedGaps: vi.fn(() => []),
}));

vi.mock('../src/lib/ble', () => ({ isBleSupported: () => true }));
vi.mock('../src/lib/eeg/ble-gap-log', () => ({ bleGapLog: gap, createBleGapLog: () => gap }));
vi.mock('../src/lib/eeg/bluetoothService', () => ({
  bluetoothService: {
    isConnected: () => ble.connected,
    getCachedDeviceId: () => ble.cached,
    scan: async () => [{ id: 'd1', name: 'LXB' }],
    connect: async (id: string) => {
      await ble.connectImpl(id);
      ble.connected = true;
      ble.cached = id;
    },
    disconnect: async () => {
      ble.connected = false;
      await ble.disconnectSvc();
    },
    onConnectionLost: (cb: () => void) => { ble.lost = cb; },
    setCallbacks: vi.fn(),
    getBatteryLevel: async () => 80,
  },
}));
vi.mock('../src/lib/eeg/StreamProcessor', () => ({
  StreamProcessor: class {
    setBluetoothService() {}
    setCallbacks() {}
    setStoreCallbacks() {}
    async start() {}
    cleanup() {}
  },
}));
vi.mock('../src/lib/eeg/AnalysisMetricsService', () => ({
  AnalysisMetricsService: { getInstance: () => ({ setCallbacks: vi.fn(), getLatestEegFeature: () => null }) },
}));
vi.mock('../src/lib/socket', async (original) => ({
  ...(await original<typeof import('../src/lib/socket')>()),
  getSessionLiveSocket: () => ({ connected: false, on: vi.fn(), off: vi.fn() }),
  joinSessionLive: vi.fn(), retainSessionLiveRoom: vi.fn(), releaseSessionLiveRoom: vi.fn(),
  subscribeSessionLiveFeatureAck: () => () => undefined,
  subscribeSessionLiveEegFeature: () => () => undefined,
}));
vi.mock('../src/hooks/useEegRawUpload', () => ({
  useEegRawUpload: () => ({ enqueueChunk: vi.fn(), drain: vi.fn(), flush: vi.fn() }),
}));
vi.mock('../src/lib/session-live/feature-queue', () => ({
  enqueueFeature: vi.fn(), listPendingFeatures: async () => [], removeAckedFeature: vi.fn(),
  loadStreamCursor: async () => ({ streamId: 's', nextSequence: 0 }),
}));
vi.mock('../src/lib/eeg/eegPersonalScore', async (original) => ({
  ...(await original<typeof import('../src/lib/eeg/eegPersonalScore')>()),
  refreshActiveModel: async () => undefined,
}));
const policy = vi.hoisted(() => ({ delays: [] as number[] }));
vi.mock('../src/lib/ble/reconnect-policy', async (original) => {
  const mod = await original<typeof import('../src/lib/ble/reconnect-policy')>();
  return {
    ...mod,
    nextReconnectDelay: (attempt: number) => {
      policy.delays.push(attempt);
      return mod.nextReconnectDelay(attempt, () => 0.5);
    },
  };
});

import { useBand } from '../src/hooks/useBand';

type BandApi = ReturnType<typeof useBand>;
let api: BandApi;
let root: Root;
function Harness() {
  api = useBand({ sessionId: 's1', participantId: 'p1', enabled: true, skipAuth: true });
  return null;
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  ble.connected = false; ble.cached = null; ble.lost = null;
  ble.connectImpl.mockReset().mockResolvedValue(undefined);
  gap.open.mockClear(); gap.recordAttempt.mockClear(); gap.close.mockClear();
  policy.delays.length = 0;
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

async function mountAndConnect() {
  await act(async () => root.render(<Harness />));
  await act(async () => { await api.connect(); });
  expect(api.connectionState).toBe('connected');
}
async function dropLink() {
  ble.connected = false;
  await act(async () => { ble.lost?.(); });
}

describe('useBand 자동 재연결', () => {
  it('V3 재연결 중 connect() 가 실패해도 루프가 멈추지 않고 다음 백오프로 재시도한다', async () => {
    await mountAndConnect();
    ble.connectImpl.mockRejectedValueOnce(new Error('fail1')).mockRejectedValueOnce(new Error('fail2'));
    await dropLink();
    await advance(1000); // 1차 시도 → 실패
    expect(ble.connectImpl).toHaveBeenCalledTimes(2);
    await advance(2000); // 2차 시도 → 실패
    expect(ble.connectImpl).toHaveBeenCalledTimes(3);
    await advance(4000); // 3차 시도 → 성공
    expect(ble.connectImpl).toHaveBeenCalledTimes(4);
    expect(api.connectionState).toBe('connected');
  });

  it('V2 재연결 성공 시 시도 횟수가 0 으로 리셋된다', async () => {
    await mountAndConnect();
    ble.connectImpl.mockRejectedValueOnce(new Error('fail'));
    await dropLink();
    await advance(1000);
    await advance(2000); // 성공
    expect(api.connectionState).toBe('connected');
    policy.delays.length = 0;
    await dropLink();
    expect(policy.delays).toEqual([0]);
  });

  it('V4 수동 해제하면 예약된 재시도가 취소되고 이후 재연결이 없다', async () => {
    await mountAndConnect();
    await dropLink();
    const callsBefore = ble.connectImpl.mock.calls.length;
    await act(async () => { await api.disconnect(); });
    await advance(120_000);
    expect(ble.connectImpl).toHaveBeenCalledTimes(callsBefore);
  });

  it('V4 재시도 실패 대기 중 수동 해제해도 이후 재연결이 없다', async () => {
    await mountAndConnect();
    ble.connectImpl.mockRejectedValue(new Error('down'));
    await dropLink();
    await advance(1000); // 실패 → 다음 재시도 예약됨
    const callsBefore = ble.connectImpl.mock.calls.length;
    await act(async () => { await api.disconnect(); });
    await advance(120_000);
    expect(ble.connectImpl).toHaveBeenCalledTimes(callsBefore);
  });

  it('V5 끊김→복구 시 갭 로그를 열고 시도마다 기록한 뒤 복구 시 닫는다', async () => {
    await mountAndConnect();
    ble.connectImpl.mockRejectedValueOnce(new Error('fail'));
    await dropLink();
    expect(gap.open).toHaveBeenCalledTimes(1);
    expect(gap.close).not.toHaveBeenCalled();
    await advance(1000);
    await advance(2000);
    expect(gap.recordAttempt).toHaveBeenCalledTimes(2);
    expect(gap.close).toHaveBeenCalledTimes(1);
  });

  it('V7 밴드를 연결하지 않은 회원은 재연결·갭 로그 코드가 호출되지 않는다', async () => {
    await act(async () => root.render(<Harness />));
    await advance(120_000);
    expect(gap.open).not.toHaveBeenCalled();
    expect(gap.recordAttempt).not.toHaveBeenCalled();
    expect(gap.close).not.toHaveBeenCalled();
    expect(policy.delays).toEqual([]);
    expect(ble.connectImpl).not.toHaveBeenCalled();
  });
});
