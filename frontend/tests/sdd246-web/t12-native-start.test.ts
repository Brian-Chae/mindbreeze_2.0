// SDD-246 T12 — 앱 측정 자동 시작(facade.startForSession), requestId 멱등, 지표 null 보존, v1 feature 업로드 차단 배선.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NativeMeasurementFacade } from '../../src/lib/native-measurement';
import type { NativeMeasurementPlugin, MeasurementSnapshot } from '../../src/lib/native-measurement/types';
import { deterministicRequestId, toMetricSnapshot } from '../../src/lib/measurement-web/use-native-measurement';

const SID = '00000001-0000-4000-8000-000000000001';
const HANDLE = 'abcdefghijklmnop1234';

function plugin(over: Partial<NativeMeasurementPlugin> = {}): NativeMeasurementPlugin & { startMeasurement: ReturnType<typeof vi.fn> } {
  return {
    getCapabilities: vi.fn(),
    startMeasurement: vi.fn(async () => ({ managerId: 'm', streamId: 's', ownerGeneration: '1' })),
    setNativeOwnership: vi.fn(async () => ({ enabled: true })),
    setJSBandOwnership: vi.fn(async () => ({ accepted: true })),
    registerCredential: vi.fn(async () => ({ credentialHandle: HANDLE })),
    handoffCredentials: vi.fn(async () => ({ handoff: true })),
    getMeasurementSnapshot: vi.fn(),
    dispatchLiveCommand: vi.fn(),
    stopMeasurement: vi.fn(async () => ({ accepted: true })),
    addListener: vi.fn(),
    ...over,
  } as never;
}
const args = (platform: 'ios' | 'android', requestId = 'r1') => ({
  platform, sessionId: SID, requestId, accountId: 'u1', apiBase: 'https://api/x', socketBase: 'https://api', instanceId: 'i1',
  deviceId: 'DEVICE-ID', tokens: { accessToken: 'AT-secret-1', refreshToken: 'RT-secret-1' },
});

describe('T12 facade.startForSession', () => {
  it('iOS: JS 소유 해제 → 인계 → start 에 peripheralId, 토큰은 start 요청에 없다', async () => {
    const p = plugin(); const f = new NativeMeasurementFacade(p);
    await f.startForSession(args('ios'));
    expect(p.setJSBandOwnership).toHaveBeenCalledWith({ owning: false });
    const req = p.startMeasurement.mock.calls[0][0];
    expect(req).toMatchObject({ sessionId: SID, credentialHandle: HANDLE, peripheralId: 'DEVICE-ID' });
    expect(JSON.stringify(req)).not.toContain('secret');
  });
  it('Android: address=deviceId(MAC)', async () => {
    const p = plugin(); const f = new NativeMeasurementFacade(p);
    await f.startForSession(args('android'));
    expect(p.startMeasurement.mock.calls[0][0]).toMatchObject({ address: 'DEVICE-ID', apiBase: 'https://api/x' });
  });
  it('같은 requestId 는 한 번만 시작', async () => {
    const p = plugin(); const f = new NativeMeasurementFacade(p);
    await Promise.all([f.startForSession(args('android')), f.startForSession(args('android'))]);
    expect(p.startMeasurement).toHaveBeenCalledTimes(1);
  });
  it('JS 소유 해제가 거절되면 시작하지 않는다', async () => {
    const p = plugin({ setJSBandOwnership: vi.fn(async () => ({ accepted: false })) });
    await expect(new NativeMeasurementFacade(p).startForSession(args('ios'))).rejects.toThrow('js_band_release_failed');
    expect(p.startMeasurement).not.toHaveBeenCalled();
  });
  it('메서드 없음은 native_method_unavailable', async () => {
    const p = plugin({ registerCredential: undefined });
    await expect(new NativeMeasurementFacade(p).startForSession(args('ios', 'r2'))).rejects.toThrow('native_method_unavailable');
  });
});

describe('T12 requestId·지표', () => {
  it('requestId 는 session+participant 로 결정되고 UUID 형식', () => {
    const a = deterministicRequestId(SID, 'p1');
    expect(a).toBe(deterministicRequestId(SID, 'p1'));
    expect(a).not.toBe(deterministicRequestId(SID, 'p2'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('snapshot.metrics → 6지표, 없음/null 은 null 유지(0 치환 금지)', () => {
    const mv = (value: number | null) => ({ value, unit: '', validity: 'valid', reason: null, last_valid_sequence: null, last_valid_observed_at_ms: null });
    const snap = { metrics: { metrics: { focus_display: mv(0), relaxation_display: mv(55), bpm: mv(null) } } } as unknown as MeasurementSnapshot;
    expect(toMetricSnapshot(snap)).toEqual({ focus: 0, relaxation: 55, emotional: null, bpm: null, respiration: null, hrv: null });
    expect(toMetricSnapshot({ metrics: null } as unknown as MeasurementSnapshot).focus).toBeNull();
  });
});

describe('T12 v1 feature 업로드 차단 배선', () => {
  const src = readFileSync('src/hooks/useBand.ts', 'utf8');
  it('옵션 기본 true, REST/WS/재전송/적재 경로가 모두 ref 로 가드된다', () => {
    expect(src).toContain('v1FeatureUpload = true');
    expect(src).toMatch(/if \(!v1FeatureUploadRef\.current\) return false;/);
    expect(src).toContain("v1_feature_upload_disabled");
    expect(src).toMatch(/retransmitInFlightRef\.current \|\| !v1FeatureUploadRef\.current/);
    expect(src).toMatch(/!observation && v1FeatureUploadRef\.current && sessionId/);
  });
  it('MemberClassContainer 는 web_wasm/native 일 때 끈다', () => {
    const c = readFileSync('src/components/class/player/member/MemberClassContainer.tsx', 'utf8');
    expect(c).toContain("v1FeatureUpload: v2Path !== 'web_wasm' && v2Path !== 'native'");
  });
});
