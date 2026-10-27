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
