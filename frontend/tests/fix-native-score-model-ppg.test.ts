// 앱(Android) 네이티브 측정: 활성 표준 모델 전달 + JS 밴드 소유 해제.
import { describe, expect, it, vi } from 'vitest';
import { NativeMeasurementFacade, buildNativeModelPayload } from '../src/lib/native-measurement';
import type { NativeMeasurementPlugin } from '../src/lib/native-measurement/types';
import type { NormalizationModelDto } from '../src/lib/api/normalization-api';

const SID = '00000001-0000-4000-8000-000000000001';
const dto = (params: NormalizationModelDto['params'], version: number | string = 7): NormalizationModelDto =>
  ({ id: 1, version, n_samples: 10, params, created_at: '2026-10-01T00:00:00Z', is_active: true });

function plugin(): NativeMeasurementPlugin & { startMeasurement: ReturnType<typeof vi.fn> } {
  return {
    getCapabilities: vi.fn(), startMeasurement: vi.fn(async () => ({ managerId: 'm', streamId: 's', ownerGeneration: '1' })),
    setNativeOwnership: vi.fn(async () => ({ enabled: true })), setJSBandOwnership: vi.fn(async () => ({ accepted: true })),
    registerCredential: vi.fn(async () => ({ credentialHandle: 'abcdefghijklmnop1234' })), handoffCredentials: vi.fn(async () => ({ handoff: true })),
    getMeasurementSnapshot: vi.fn(), dispatchLiveCommand: vi.fn(), stopMeasurement: vi.fn(async () => ({ accepted: true })), addListener: vi.fn(),
  } as never;
}
const base = (platform: 'ios' | 'android') => ({
  platform, sessionId: SID, requestId: `r-${platform}-${Math.random()}`, accountId: 'u1', apiBase: 'https://api/x', socketBase: 'https://api',
  instanceId: 'i1', deviceId: 'AA:BB', tokens: { accessToken: 'AT-secret', refreshToken: 'RT-secret' },
});

describe('buildNativeModelPayload', () => {
  it('유효 지표만, direction 문자열 정규화, 버전 접두', () => {
    const p = buildNativeModelPayload(dto({
      focusIndex: { m: -1, s: 0.5, direction: 1 },
      relaxationIndex: { m: -0.3, s: 0.4, direction: '1' as never },
      stressIndex: { m: 0, s: 0, direction: 1 },        // s<=0 → 제외
      bogus: { m: 0, s: 1, direction: 1 },
    } as never))!;
    expect(p.modelVersion).toBe('7');
    expect(Object.keys(JSON.parse(p.modelParams)).sort()).toEqual(['focusIndex', 'relaxationIndex']);
    expect(JSON.parse(p.modelParams).relaxationIndex.direction).toBe(1);
  });
  it('모델 없음/유효 지표 0개 → null (코호트 유지)', () => {
    expect(buildNativeModelPayload(null)).toBeNull();
    expect(buildNativeModelPayload(dto({}))).toBeNull();
    expect(buildNativeModelPayload(dto({ focusIndex: { m: 1, s: -1, direction: 1 } }))).toBeNull();
  });
});

describe('startForSession — 모델·밴드 소유', () => {
  const model = { modelParams: '{"focusIndex":{"m":1,"s":2,"direction":1}}', modelVersion: '7' };

  it('Android: 모델이 start 요청에 실린다. 토큰은 없다', async () => {
    const p = plugin(); await new NativeMeasurementFacade(p).startForSession({ ...base('android'), model });
    const req = p.startMeasurement.mock.calls[0][0];
    expect(req).toMatchObject({ modelParams: model.modelParams, modelVersion: '7' });
    expect(JSON.stringify(req)).not.toContain('secret');
  });
  it('모델 없으면 필드를 보내지 않는다(코호트 유지)', async () => {
    const p = plugin(); await new NativeMeasurementFacade(p).startForSession(base('android'));
    const req = p.startMeasurement.mock.calls[0][0];
    expect('modelParams' in req).toBe(false); expect('modelVersion' in req).toBe(false);
  });
  it('Android: 시작 전에 releaseJsBand 가 먼저 호출된다', async () => {
    const p = plugin(); const order: string[] = [];
    p.startMeasurement.mockImplementation(async () => { order.push('start'); return { managerId: 'm', streamId: 's', ownerGeneration: '1' }; });
    const releaseJsBand = vi.fn(async () => { order.push('release'); });
    await new NativeMeasurementFacade(p).startForSession({ ...base('android'), releaseJsBand });
    expect(order).toEqual(['release', 'start']);
  });
  it('Android: releaseJsBand 가 실패해도 시작은 계속된다(수신 실패는 실기기 진단)', async () => {
    const p = plugin();
    await new NativeMeasurementFacade(p).startForSession({ ...base('android'), releaseJsBand: vi.fn(async () => { throw new Error('x'); }) });
    expect(p.startMeasurement).toHaveBeenCalledTimes(1);
  });
  it('iOS: 모델이 start 요청에 실린다(없으면 생략)', async () => {
    const p = plugin(); await new NativeMeasurementFacade(p).startForSession({ ...base('ios'), model });
    expect(p.startMeasurement.mock.calls[0][0]).toMatchObject({ modelParams: model.modelParams, modelVersion: '7' });
    const q = plugin(); await new NativeMeasurementFacade(q).startForSession(base('ios'));
    expect('modelParams' in q.startMeasurement.mock.calls[0][0]).toBe(false);
  });
  it('iOS: releaseJsBand 는 호출하지 않는다(setJSBandOwnership 경로 유지)', async () => {
    const p = plugin(); const releaseJsBand = vi.fn(async () => undefined);
    await new NativeMeasurementFacade(p).startForSession({ ...base('ios'), releaseJsBand });
    expect(releaseJsBand).not.toHaveBeenCalled(); expect(p.setJSBandOwnership).toHaveBeenCalledWith({ owning: false });
  });
});
