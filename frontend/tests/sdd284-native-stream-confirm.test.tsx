// @vitest-environment jsdom
// SDD-284 T1·T2 — 스트림 확정 감시·자동 재시작·웹 경로 하강
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as string[], snap: { state: 'ARMING', streamId: null } as { state: string; streamId: string | null } | null,
  stopFails: false, reclaimOk: true, requestIds: [] as string[],
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' } }));
vi.mock('../src/lib/session-live/live-flag', () => ({ isLiveProtocolV2Enabled: () => true }));
vi.mock('../src/lib/api/client', () => ({ BASE_URL: 'https://api/api/v1', getNativeRefreshBody: () => ({ refresh_token: 'rt' }), tokenStorage: { getAccess: () => 'at' } }));
vi.mock('../src/lib/socket', () => ({ SOCKET_URL: 'https://api' }));
vi.mock('../src/lib/eeg/eegPersonalScore', () => ({ getActiveModelCache: () => null, refreshActiveModel: async () => null }));
vi.mock('../src/lib/eeg/bluetoothService', () => ({ bluetoothService: { getDeviceId: () => 'DEV-1', getCachedDeviceId: () => 'DEV-1', releaseForNative: async () => 'DEV-1' } }));
vi.mock('../src/lib/native-measurement', () => ({
  isNativeMeasurementAvailable: () => true,
  buildNativeModelPayload: () => null,
  getNativeMeasurement: () => ({
    attach: async () => undefined, detach: async () => undefined, onMeasurement: () => () => undefined, onUploadProgress: () => () => undefined,
    reconnectBand: async () => true,
    getSnapshot: async () => h.snap,
    reclaimJsBand: async () => { h.calls.push('reclaim'); return h.reclaimOk; },
    stop: async () => { h.calls.push('stop'); if (h.stopFails) throw new Error('stop_boom'); return { accepted: true }; },
    startForSession: async (a: { requestId: string }) => { h.calls.push('start'); h.requestIds.push(a.requestId); return {}; },
  }),
}));

import { useNativeMeasurementV2, isStreamConfirmed, isStreamUnhealthy, NATIVE_CONFIRM_MS, NATIVE_HEALTH_MS, type UseNativeMeasurementResult } from '../src/lib/measurement-web/use-native-measurement';
import { decideMeasurementPath } from '../src/lib/measurement-web/measurement-path';

type Opts = Parameters<typeof useNativeMeasurementV2>[0];
const opts: Opts = { v2: true, sessionId: '00000001-0000-4000-8000-000000000001', participantId: '00000002-0000-4000-8000-000000000002', accountId: 'u1', bandOptIn: true, eegConsent: true, bandConnected: true, enabled: true };
const ref = { last: null as unknown as UseNativeMeasurementResult };
const cur = () => ref.last;
function Probe(p: Opts) { ref.last = useNativeMeasurementV2(p); useEffect(() => undefined); return null; }
const flush = () => act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); await flush(); };
const confirmed = { state: 'CAPTURING', streamId: 'abcdef12-0000-4000-8000-000000000000' };

let root: Root;
describe('SDD-284 순수 판정', () => {
  it('isStreamConfirmed: streamId 있고 CAPTURING/RECONNECTING 만', () => {
    expect(isStreamConfirmed({ state: 'CAPTURING', streamId: 's' })).toBe(true);
    expect(isStreamConfirmed({ state: 'RECONNECTING', streamId: 's' })).toBe(true);
    expect(isStreamConfirmed({ state: 'ARMING', streamId: 's' })).toBe(false);
    expect(isStreamConfirmed({ state: 'CAPTURING', streamId: null })).toBe(false);
    expect(isStreamConfirmed(null)).toBe(false);
  });
  it('isStreamUnhealthy: BLOCKED/CLOSED/IDLE/streamId null 이상, 읽기 실패·종료 처리 중은 보류', () => {
    for (const state of ['BLOCKED', 'CLOSED', 'IDLE']) expect(isStreamUnhealthy({ state: state as 'IDLE', streamId: 's' })).toBe(true);
    expect(isStreamUnhealthy({ state: 'CAPTURING', streamId: null })).toBe(true);
    expect(isStreamUnhealthy({ state: 'CAPTURING', streamId: 's' })).toBe(false);
    expect(isStreamUnhealthy({ state: 'SEALING', streamId: 's' })).toBe(false);
    expect(isStreamUnhealthy(null)).toBe(false);
  });
});

describe('decideMeasurementPath — nativeFailed', () => {
  const base = { v2: true, native: true, webBluetooth: true, bandConnected: true, eegConsent: true, bandOptIn: true };
  it('기본(undefined)은 현행 native, nativeFailed 면 web_wasm, 밴드 미연결이면 off, 게스트·안드로이드 기존 동작 불변', () => {
    expect(decideMeasurementPath(base)).toBe('native');
    expect(decideMeasurementPath({ ...base, nativeFailed: false })).toBe('native');
    expect(decideMeasurementPath({ ...base, nativeFailed: true })).toBe('web_wasm');
    expect(decideMeasurementPath({ ...base, nativeFailed: true, bandConnected: false })).toBe('off');
    expect(decideMeasurementPath({ ...base, guest: true })).toBe('web_wasm');
    expect(decideMeasurementPath({ ...base, native: false })).toBe('web_wasm');
    expect(decideMeasurementPath({ ...base, v2: false, nativeFailed: true })).toBe('legacy');
  });
});

describe('useNativeMeasurementV2 — 스트림 확정 감시', () => {
  beforeEach(() => { h.calls.length = 0; h.requestIds.length = 0; h.snap = { state: 'ARMING', streamId: null }; h.stopFails = false; h.reclaimOk = true; vi.useFakeTimers(); root = createRoot(document.createElement('div')); });
  afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); });

  it('시작 직후에는 running 이 아니고, 스트림이 확정되면 running + 진단 값', async () => {
    await act(async () => { root.render(<Probe {...opts} />); });
    await flush();
    expect(cur().status).toBe('starting');
    h.snap = confirmed;
    await advance(2000);
    expect(cur().status).toBe('running');
    expect(cur().diagnostics.streamIdHead).toBe('abcdef12');
    expect(cur().diagnostics.nativeState).toBe('CAPTURING');
    expect(h.calls).toEqual(['start']);
  });

  it('20초 안에 확정 안 되면 stop 후 새 requestId 로 재시작(첫 시도 requestId 는 결정적, 이후 새 값)', async () => {
    await act(async () => { root.render(<Probe {...opts} />); });
    await flush();
    await advance(NATIVE_CONFIRM_MS + 2000);
    expect(h.calls.slice(0, 2)).toEqual(['start', 'stop']);
    h.snap = confirmed;
    await advance(3000 + 100); // 백오프 3초 뒤 재시작
    await advance(2000);
    expect(h.calls.filter((c) => c === 'start')).toHaveLength(2);
    expect(h.requestIds[0]).not.toBe(h.requestIds[1]);
    expect(cur().status).toBe('running');
    expect(cur().diagnostics.restartCount).toBe(1);
    expect(cur().nativeFailed).toBe(false);
  });

  it('running 중 10초 건강 점검: streamId 가 사라지면 재시작 경로', async () => {
    h.snap = confirmed;
    await act(async () => { root.render(<Probe {...opts} />); });
    await flush(); await advance(2000);
    expect(cur().status).toBe('running');
    h.snap = { state: 'CAPTURING', streamId: null };
    await advance(NATIVE_HEALTH_MS + 100);
    expect(h.calls).toContain('stop');
    expect(cur().status).toBe('starting');
    expect(cur().code).toBe('native_stream_lost');
  });

  it('확정 실패 3회면 stop → JS 밴드 소유권 회수 → web_wasm 하강, 그 뒤 native 로 되돌아가지 않음', async () => {
    await act(async () => { root.render(<Probe {...opts} />); });
    await flush();
    for (let i = 0; i < 12 && !cur().nativeFailed; i += 1) await advance(NATIVE_CONFIRM_MS + 8000);
    expect(cur().nativeFailed).toBe(true);
    expect(cur().path).toBe('off'); // 시험 환경은 webBluetooth 미지원이라 off — 하강 입력(nativeFailed)이 native 를 막았다는 뜻
    expect(h.calls.filter((c) => c === 'start')).toHaveLength(3);
    const iStop = h.calls.lastIndexOf('stop'); const iReclaim = h.calls.indexOf('reclaim');
    expect(iReclaim).toBeGreaterThan(iStop); // stop 이 먼저
    h.snap = confirmed;
    await advance(120_000);
    expect(h.calls.filter((c) => c === 'start')).toHaveLength(3); // 되돌아가 재시작하지 않음
  });

  it('하강 전 stop 이 실패하면 하강하지 않고 오류 상태만', async () => {
    h.stopFails = true;
    await act(async () => { root.render(<Probe {...opts} />); });
    await flush();
    for (let i = 0; i < 6; i += 1) await advance(NATIVE_CONFIRM_MS + 8000);
    expect(cur().nativeFailed).toBe(false);
    expect(h.calls).not.toContain('reclaim');
    expect(cur().status).toBe('failed');
    expect(cur().code).toBe('native_stop_failed');
  });

  it('소유권 회수가 거절되면 하강하지 않는다', async () => {
    h.reclaimOk = false;
    await act(async () => { root.render(<Probe {...opts} />); });
    await flush();
    for (let i = 0; i < 12; i += 1) await advance(NATIVE_CONFIRM_MS + 8000);
    expect(h.calls).toContain('reclaim');
    expect(cur().nativeFailed).toBe(false);
    expect(cur().code).toBe('js_band_reclaim_failed');
  });
});
