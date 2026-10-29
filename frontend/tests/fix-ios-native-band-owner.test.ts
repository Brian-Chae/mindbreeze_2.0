// iOS 네이티브 밴드 소유: 소유 판정·재연결 브리지.
import { describe, expect, it, vi } from 'vitest';
import { NativeMeasurementFacade } from '../src/lib/native-measurement';
import { isNativeBandOwned } from '../src/lib/native-measurement/device-status';
import type { NativeMeasurementPlugin } from '../src/lib/native-measurement/types';

const dev = { signalQualityLevel: 'ok', deviceStatus: 'ok', connected: true } as never;

describe('isNativeBandOwned', () => {
  it('native 경로에서 시작 중·실행 중·snapshot 수신이면 소유', () => {
    expect(isNativeBandOwned('native', 'starting', null)).toBe(true);
    expect(isNativeBandOwned('native', 'running', null)).toBe(true);
    expect(isNativeBandOwned('native', 'idle', dev)).toBe(true);
  });
  it('native 가 아니거나 시작 전·실패면 소유 아님(JS BLE 상태를 쓴다)', () => {
    expect(isNativeBandOwned('web_wasm', 'running', dev)).toBe(false);
    expect(isNativeBandOwned('legacy', 'idle', null)).toBe(false);
    expect(isNativeBandOwned('native', 'idle', null)).toBe(false);
    expect(isNativeBandOwned('native', 'failed', null)).toBe(false);
  });
});

describe('facade.reconnectBand', () => {
  it('iOS: 네이티브 reconnectBand 호출, accepted 반환', async () => {
    const reconnectBand = vi.fn(async () => ({ accepted: true }));
    const f = new NativeMeasurementFacade({ reconnectBand } as unknown as NativeMeasurementPlugin);
    expect(await f.reconnectBand('ios')).toBe(true);
    expect(reconnectBand).toHaveBeenCalledTimes(1);
  });
  it('android·웹·메서드 없음·거절(not_active)은 false, 예외를 던지지 않는다', async () => {
    const reconnectBand = vi.fn(async () => { throw new Error('not_active'); });
    const f = new NativeMeasurementFacade({ reconnectBand } as unknown as NativeMeasurementPlugin);
    expect(await f.reconnectBand('ios')).toBe(false);
    expect(await f.reconnectBand('android')).toBe(false);
    expect(await new NativeMeasurementFacade({} as NativeMeasurementPlugin).reconnectBand('ios')).toBe(false);
  });
});

describe('facade.startForSession — iOS JS 해제가 돌려준 연결 ID 이월', () => {
  const base = { platform: 'ios' as const, sessionId: '00000001-0000-4000-8000-000000000001', requestId: '00000003-0000-4000-8000-000000000003', accountId: 'u1', apiBase: 'https://a/api/v1', socketBase: 'https://a', instanceId: 'i', tokens: { accessToken: 'at-xxxxxxxx', refreshToken: 'rt-xxxxxxxx' } };
  const plugin = () => ({
    setNativeOwnership: vi.fn(async () => ({ enabled: true })), setJSBandOwnership: vi.fn(async () => ({ accepted: true })),
    registerCredential: vi.fn(async () => ({ credentialHandle: 'abcdefghijklmnop1234' })), startMeasurement: vi.fn(async () => ({})),
  });
  it('저장된 deviceId 가 없어도 releaseJsBand 가 돌려준 ID 를 peripheralId 로 넘긴다', async () => {
    const p = plugin();
    await new NativeMeasurementFacade(p as unknown as NativeMeasurementPlugin).startForSession({ ...base, deviceId: null, releaseJsBand: async () => 'AAAAAAAA-0000-4000-8000-000000000001' });
    expect(p.startMeasurement).toHaveBeenCalledWith(expect.objectContaining({ peripheralId: 'AAAAAAAA-0000-4000-8000-000000000001' }));
  });
  it('deviceId 가 있으면 그것을 우선, 둘 다 없으면 peripheralId 생략(스캔)', async () => {
    const p = plugin();
    await new NativeMeasurementFacade(p as unknown as NativeMeasurementPlugin).startForSession({ ...base, deviceId: 'D1', releaseJsBand: async () => 'D2' });
    expect(p.startMeasurement).toHaveBeenCalledWith(expect.objectContaining({ peripheralId: 'D1' }));
    const q = plugin();
    await new NativeMeasurementFacade(q as unknown as NativeMeasurementPlugin).startForSession({ ...base, requestId: '00000004-0000-4000-8000-000000000004', deviceId: null, releaseJsBand: async () => null });
    expect((q.startMeasurement.mock.calls[0] as unknown[])[0]).not.toHaveProperty('peripheralId');
  });
});
