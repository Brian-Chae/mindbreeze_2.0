// bluetoothService.releaseForNative — 네이티브가 밴드를 잡기 전 JS 연결을 놓는다.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

describe('use-native-measurement 배선', () => {
  const src = readFileSync('src/lib/measurement-web/use-native-measurement.ts', 'utf8');
  it('iOS·Android 모두 releaseForNative 를 넘기고, 시작 전에 활성 모델을 조회한다', () => {
    expect(src).toContain('releaseForNative');
    expect(src).toMatch(/releaseJsBand: \(\) => bluetoothService\.releaseForNative\(\)/);
    expect(src).toContain('buildNativeModelPayload');
    expect(src).toMatch(/getActiveModelCache\(\)/);
  });
  it('시작 후 래치: stale band 상태가 풀려도 native 를 멈추지 않는다', () => {
    expect(src).toContain('startedRef.current');
    expect(src).toContain('latchedRef.current');
    expect(src).toMatch(/latched: latchedRef\.current/);
  });
});

describe('LinkBandBluetoothService.releaseForNative', () => {
  it('연결 ID 를 먼저 확보하고 해제한 뒤 ID 를 돌려준다', async () => {
    const { bluetoothService } = await import('../src/lib/eeg/bluetoothService');
    const svc = bluetoothService as unknown as { deviceId: string | null; lastDeviceId: string | null; disconnect: () => Promise<void> };
    svc.deviceId = 'AA:BB:CC'; svc.lastDeviceId = 'AA:BB:CC';
    const spy = vi.spyOn(svc, 'disconnect').mockImplementation(async () => { svc.deviceId = null; svc.lastDeviceId = null; });
    const id = await bluetoothService.releaseForNative();
    expect(id).toBe('AA:BB:CC'); expect(spy).toHaveBeenCalledTimes(1);
  });
  it('연결이 없으면 null, 해제하지 않는다', async () => {
    const { bluetoothService } = await import('../src/lib/eeg/bluetoothService');
    const svc = bluetoothService as unknown as { deviceId: string | null; lastDeviceId: string | null; disconnect: () => Promise<void> };
    svc.deviceId = null; svc.lastDeviceId = null;
    const spy = vi.spyOn(svc, 'disconnect').mockResolvedValue(undefined);
    expect(await bluetoothService.releaseForNative()).toBeNull(); expect(spy).not.toHaveBeenCalled();
  });
});

describe('releaseForNative 이후 JS 자동 재연결 억제', () => {
  it('releaseForNative 후 isReleasedForNative=true, useBand 자동 재연결 경로가 이를 확인한다', async () => {
    const { bluetoothService } = await import('../src/lib/eeg/bluetoothService');
    vi.spyOn(bluetoothService, 'disconnect').mockResolvedValue();
    (bluetoothService as unknown as { lastDeviceId: string }).lastDeviceId = 'AA:BB';
    (bluetoothService as unknown as { releasedForNative: boolean }).releasedForNative = false;
    expect(bluetoothService.isReleasedForNative()).toBe(false);
    await bluetoothService.releaseForNative();
    expect(bluetoothService.isReleasedForNative()).toBe(true);
    const band = readFileSync('src/hooks/useBand.ts', 'utf8');
    expect(band.match(/isReleasedForNative\(\)/g)?.length).toBe(2);
  });
});
