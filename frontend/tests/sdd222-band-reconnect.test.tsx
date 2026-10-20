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
const stream = vi.hoisted(() => ({
  onEEGData: null as null | ((d: { fp1: number; fp2: number }[]) => void),
  flush: vi.fn(async () => undefined),
}));
const gap = vi.hoisted(() => ({
  open: vi.fn(), recordAttempt: vi.fn(), close: vi.fn(() => null), getOpenGap: vi.fn(() => null), getClosedGaps: vi.fn(() => []),
}));

const life = vi.hoisted(() => ({
  resume: [] as { cb: () => void | Promise<void>; order?: number }[],
  pause: [] as { cb: () => void | Promise<void>; order?: number }[],
  verify: vi.fn<() => Promise<boolean | null>>(),
}));
vi.mock('../src/lib/native/app-lifecycle', () => ({
  RESUME_ORDER: { socket: 10, rawFlush: 20, ble: 30, screen: 40 },
  subscribeAppResume: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; life.resume.push(e);
    return () => { life.resume.splice(life.resume.indexOf(e), 1); };
  },
  subscribeAppPause: (cb: () => void | Promise<void>, order?: number) => {
    const e = { cb, order }; life.pause.push(e);
    return () => { life.pause.splice(life.pause.indexOf(e), 1); };
  },
}));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => true, getPlatform: () => 'android' }));
vi.mock('../src/lib/ble/capacitor-ble-adapter', () => ({ verifyActiveBleConnection: () => life.verify() }));
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
    setCallbacks(cb: { onEEGData?: (d: { fp1: number; fp2: number }[]) => void }) {
      stream.onEEGData = cb.onEEGData ?? null;
    }
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
  useEegRawUpload: () => ({ enqueueChunk: vi.fn(async () => undefined), drain: vi.fn(), flush: stream.flush }),
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
  stream.flush.mockClear(); stream.onEEGData = null;
  life.resume.length = 0; life.pause.length = 0; life.verify.mockReset().mockResolvedValue(true);
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

const fireResume = () => act(async () => { await Promise.all(life.resume.map((e) => e.cb())); await vi.advanceTimersByTimeAsync(0); });

describe('useBand 복귀 시 BLE 확인 (V8)', () => {
  it('BLE 단계(order 30)로 복귀 구독을 등록한다', async () => {
    await act(async () => root.render(<Harness />));
    expect(life.resume.map((e) => e.order)).toContain(30);
  });

  it('V8 연결 중 복귀했을 때 verifyConnection 실패 → 끊김 경로와 동일하게 재연결이 시작된다', async () => {
    await mountAndConnect();
    life.verify.mockImplementation(async () => {
      ble.connected = false;
      ble.lost?.(); // 어댑터가 connectionLost 와 같은 경로를 탄다
      return false;
    });
    await fireResume();
    expect(life.verify).toHaveBeenCalledTimes(1);
    expect(gap.open).toHaveBeenCalledTimes(1);
    const before = ble.connectImpl.mock.calls.length;
    await advance(1000);
    expect(ble.connectImpl.mock.calls.length).toBe(before + 1);
    expect(api.connectionState).toBe('connected');
  });

  it('연결이 정상이면 재연결을 시작하지 않는다', async () => {
    await mountAndConnect();
    await fireResume();
    expect(life.verify).toHaveBeenCalledTimes(1);
    expect(gap.open).not.toHaveBeenCalled();
  });

  it('재연결 백오프 대기 중 복귀하면 타이머를 기다리지 않고 즉시 재시도한다', async () => {
    await mountAndConnect();
    ble.connectImpl.mockRejectedValueOnce(new Error('fail'));
    await dropLink();
    await advance(1000); // 1차 실패 → 2초 후 재시도 예약
    const before = ble.connectImpl.mock.calls.length;
    await fireResume(); // 백그라운드에서 타이머가 멈춰 있었다고 가정
    expect(ble.connectImpl.mock.calls.length).toBe(before + 1);
    expect(api.connectionState).toBe('connected');
  });

  it('V17 백그라운드 전환 구독은 raw 큐 flush(20)보다 먼저(메모리 버퍼 적재) 실행되도록 등록된다', async () => {
    await act(async () => root.render(<Harness />));
    expect(life.pause).toHaveLength(1);
    expect(life.pause[0].order).toBeLessThan(20);
  });

  it('V7 밴드를 연결한 적 없으면 복귀해도 검증·재연결을 하지 않는다', async () => {
    await act(async () => root.render(<Harness />));
    await fireResume();
    expect(life.verify).not.toHaveBeenCalled();
    expect(ble.connectImpl).not.toHaveBeenCalled();
    expect(gap.open).not.toHaveBeenCalled();
  });

  it('검증 중 예외가 나도 복귀 처리는 던지지 않는다(V10)', async () => {
    await mountAndConnect();
    life.verify.mockRejectedValue(new Error('probe boom'));
    await expect(fireResume()).resolves.not.toThrow();
  });
});

describe('BLE 콜백 throttle flush (G6, V15·V16)', () => {
  const samples = (n: number) => Array.from({ length: n }, () => ({ fp1: 1, fp2: 2 }));
  const feed = (n = 5) => act(async () => { stream.onEEGData?.(samples(n)); });

  it('V15 5초 안에 콜백이 여러 번 와도 flush 는 최대 1회, 5초 경과 후 다시 허용된다', async () => {
    await mountAndConnect();
    for (let i = 0; i < 20; i++) await feed();
    expect(stream.flush).toHaveBeenCalledTimes(1);
    await act(async () => { vi.setSystemTime(Date.now() + 4900); });
    await feed();
    expect(stream.flush).toHaveBeenCalledTimes(1);
    await act(async () => { vi.setSystemTime(Date.now() + 200); });
    await feed();
    expect(stream.flush).toHaveBeenCalledTimes(2);
  });

  it('V16 setInterval 이 멈춘(타이머 미진행) 상태에서도 BLE 콜백만으로 flush 가 계속 호출된다', async () => {
    await mountAndConnect();
    await feed();
    for (let i = 1; i <= 3; i++) {
      // 타이머는 한 번도 진행시키지 않고 시계만 앞으로 — 백그라운드 스로틀 상황 재현
      await act(async () => { vi.setSystemTime(Date.now() + 5100); });
      await feed();
    }
    expect(stream.flush).toHaveBeenCalledTimes(4);
  });
});
