// @vitest-environment jsdom
// SDD-297 — iOS 는 저장 진행 이벤트가 안 와도 snapshot(archive.queue)로 연결 진단 줄을 채운다
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ measurementCb: null as null | ((s: unknown) => void), uploadCb: null as null | ((p: unknown) => void) }));
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
    attach: async () => undefined, detach: async () => undefined,
    onMeasurement: (cb: (s: unknown) => void) => { h.measurementCb = cb; return () => undefined; },
    onUploadProgress: (cb: (p: unknown) => void) => { h.uploadCb = cb; return () => undefined; },
    reconnectBand: async () => true,
    getSnapshot: async () => ({ state: 'CAPTURING', streamId: 'abcdef12-0000-4000-8000-000000000000' }),
    reclaimJsBand: async () => true, stop: async () => ({ accepted: true }),
    startForSession: async () => ({}),
  }),
}));

import { useNativeMeasurementV2, uploadPatchFromSnapshot, type UseNativeMeasurementResult } from '../src/lib/measurement-web/use-native-measurement';
import { DIAG_UNKNOWN, deriveConnectionDiagnostics } from '../src/components/class/player/member/connection-diagnostics-model';

let SID = '00000001-0000-4000-8000-000000000097';
let n = 0;
const queue = (o: Record<string, unknown> = {}) => ({ live_pending: 3, live_acked: 120, archive_pending: 2, archive_verified: 9, pending_authorization: 0, pending_time_review: 0, oldest_pending_age_ms: null, disk_used_bytes: 0, disk_limit_bytes: 1, ...o });
const iosSnap = (q: unknown = queue()) => ({ bridge_version: 1, managerGeneration: '1', seq: '5', sessionId: SID, state: 'CAPTURING', streamId: 'abcdef12-0000-4000-8000-000000000000', metrics: null, collection: { band_state: 'connected' }, archive: { queue: q, last_verified_at_ms: null } });

describe('uploadPatchFromSnapshot (순수)', () => {
  it('V1 iOS 형태 snapshot → 4개 값', () => {
    expect(uploadPatchFromSnapshot(iosSnap() as never)).toEqual({ featurePending: 3, featureAcked: 120, rawPending: 2, rawUploading: 0, rawVerified: 9 });
  });
  it('V2 queue 없음·숫자 아님 → null', () => {
    expect(uploadPatchFromSnapshot(null)).toBeNull();
    expect(uploadPatchFromSnapshot({ ...iosSnap(), archive: undefined } as never)).toBeNull();
    expect(uploadPatchFromSnapshot(iosSnap(queue({ live_acked: 'x' })) as never)).toBeNull();
  });
  it('V3 patch → 진단 줄이 확인 전이 아님', () => {
    const p = uploadPatchFromSnapshot(iosSnap() as never)!;
    const v = deriveConnectionDiagnostics({ path: 'native', status: 'running', code: null, nativeState: 'CAPTURING', streamIdHead: 'abcdef12', restartCount: 0, lastConfirmElapsedMs: 1, nativeFailed: false, socket: 'connected',
      upload: { featurePending: p.featurePending, featureAcked: p.featureAcked, rawPending: p.rawPending + p.rawUploading, rawVerified: p.rawVerified }, backlogSinceMs: null, nowMs: 1 });
    for (const c of v.counts) { expect(c.pending).not.toBe(DIAG_UNKNOWN); expect(c.arrived).not.toBe(DIAG_UNKNOWN); }
  });
});

type Opts = Parameters<typeof useNativeMeasurementV2>[0];
const mkOpts = (): Opts => ({ v2: true, sessionId: SID, participantId: '00000002-0000-4000-8000-000000000002', accountId: 'u1', bandOptIn: true, eegConsent: true, bandConnected: true, enabled: true });
let opts: Opts = mkOpts();
const ref = { last: null as unknown as UseNativeMeasurementResult };
function Probe(p: Opts) { ref.last = useNativeMeasurementV2(p); useEffect(() => undefined); return null; }
const flush = () => act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
let root: Root; let box: HTMLDivElement;
beforeEach(() => { n += 1; SID = `00000001-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`; opts = mkOpts(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); h.measurementCb = null; h.uploadCb = null; box = document.createElement('div'); document.body.append(box); root = createRoot(box); });
afterEach(async () => { await act(async () => root.unmount()); box.remove(); });
const mount = async () => { await act(async () => { root.render(<Probe {...opts} />); }); await flush(); };

describe('훅 통합', () => {
  it('V6·V7 이벤트 0건, snapshot 만 오는 iOS → diagnostics.upload 가 채워지고 재렌더된다', async () => {
    await mount();
    expect(ref.last.diagnostics.upload).toBeNull();
    await act(async () => { h.measurementCb?.(iosSnap()); });
    expect(ref.last.diagnostics.upload).toEqual({ featurePending: 3, featureAcked: 120, rawPending: 2, rawVerified: 9 });
    await act(async () => { h.measurementCb?.(iosSnap(queue({ live_acked: 130 }))); });
    expect(ref.last.diagnostics.upload?.featureAcked).toBe(130);
  });
  it('V4 이벤트가 오면 이벤트 우선 — 이후 snapshot 이 되돌리지 않는다', async () => {
    await mount();
    await act(async () => { h.uploadCb?.({ featurePending: 0, featureAcked: 500, rawPending: 0, rawUploading: 0, rawVerified: 20 }); });
    expect(ref.last.diagnostics.upload?.featureAcked).toBe(500);
    await act(async () => { h.measurementCb?.(iosSnap()); });
    expect(ref.last.diagnostics.upload?.featureAcked).toBe(500);
  });
  it('V2 snapshot 에 queue 가 없으면 확인 전 유지(null)', async () => {
    await mount();
    await act(async () => { h.measurementCb?.({ ...iosSnap(), archive: undefined }); });
    expect(ref.last.diagnostics.upload).toBeNull();
  });
});
