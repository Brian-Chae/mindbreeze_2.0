// SDD-222 T-J4 — 어댑터 verifyConnection (V8 기반)
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { CapacitorBleAdapter, verifyActiveBleConnection } from '../src/lib/ble/capacitor-ble-adapter';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(), getPlatform: vi.fn() },
}));
vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(), requestDevice: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
    getServices: vi.fn(), startNotifications: vi.fn(), stopNotifications: vi.fn(),
    read: vi.fn(), write: vi.fn(), getConnectedDevices: vi.fn(),
  },
}));

const deviceId = 'link-band-1';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
  vi.mocked(BleClient.getConnectedDevices).mockResolvedValue([]);
});

describe('CapacitorBleAdapter.verifyConnection', () => {
  it('프로브 read 가 성공하면 true 이고 재연결 콜백은 호출되지 않는다', async () => {
    const adapter = new CapacitorBleAdapter();
    const onLost = vi.fn();
    adapter.onConnectionLost(onLost);
    await adapter.connect(deviceId);
    vi.mocked(BleClient.read).mockResolvedValue(new DataView(Uint8Array.from([80]).buffer));
    await expect(adapter.verifyConnection(deviceId)).resolves.toBe(true);
    expect(onLost).not.toHaveBeenCalled();
    expect(await adapter.isConnected(deviceId)).toBe(true);
  });

  it('프로브가 실패하면 false, 상태를 지우고 connectionLost 와 같은 경로를 1회 탄다', async () => {
    const adapter = new CapacitorBleAdapter();
    const onLost = vi.fn();
    adapter.onConnectionLost(onLost);
    await adapter.connect(deviceId);
    vi.mocked(BleClient.read).mockRejectedValue(new Error('not connected'));
    await expect(adapter.verifyConnection(deviceId)).resolves.toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(await adapter.isConnected(deviceId)).toBe(false);
    // 이후 늦게 도착한 해제 이벤트가 중복 콜백을 만들지 않는다
    vi.mocked(BleClient.connect).mock.calls[0][1]?.(deviceId);
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('연결되지 않은 기기는 프로브 없이 false 이고 콜백을 호출하지 않는다', async () => {
    const adapter = new CapacitorBleAdapter();
    const onLost = vi.fn();
    adapter.onConnectionLost(onLost);
    await expect(adapter.verifyConnection(deviceId)).resolves.toBe(false);
    expect(BleClient.read).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
  });
});

describe('verifyActiveBleConnection', () => {
  it('활성 어댑터가 없으면 null(검증 불가)을 반환한다', async () => {
    await expect(verifyActiveBleConnection()).resolves.toBeNull();
  });

  it('활성 어댑터의 연결 기기를 검증하고 실패 시 false 를 반환한다', async () => {
    const adapter = new CapacitorBleAdapter();
    const onLost = vi.fn();
    adapter.onConnectionLost(onLost);
    await adapter.connect(deviceId);
    vi.mocked(BleClient.read).mockRejectedValue(new Error('gone'));
    await expect(verifyActiveBleConnection()).resolves.toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});

// 배터리 read 오류와 실제 BLE 단절은 별개다.
describe('복귀 검증이 정상 연결을 끊지 않는다', () => {
  it.each(['ios', 'android'])('%s에서 배터리 read가 실패해도 OS 연결 중이면 유지한다', async platform => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    const adapter = new CapacitorBleAdapter();
    const lost = vi.fn();
    adapter.onConnectionLost(lost);
    await adapter.connect(deviceId);
    vi.mocked(BleClient.read).mockRejectedValue(new Error('Battery service unavailable'));
    vi.mocked(BleClient.getConnectedDevices).mockResolvedValue([{ deviceId, name: 'LXB' }]);
    for (let i = 0; i < 3; i++) await expect(adapter.verifyConnection(deviceId)).resolves.toBe(true);
    expect(await adapter.isConnected(deviceId)).toBe(true);
    expect(BleClient.getConnectedDevices).toHaveBeenCalledWith(['df7b5d95-3afe-00a1-084c-b50895ef4f95']);
    expect(BleClient.disconnect).not.toHaveBeenCalled();
    expect(lost).not.toHaveBeenCalled();
  });
  it('OS 조회도 실패하면 단절로 단정하여 해제하지 않는다', async () => {
    const adapter = new CapacitorBleAdapter();
    await adapter.connect(deviceId);
    vi.mocked(BleClient.read).mockRejectedValue(new Error('busy'));
    vi.mocked(BleClient.getConnectedDevices).mockRejectedValue(new Error('unavailable'));
    await adapter.verifyConnection(deviceId);
    expect(await adapter.isConnected(deviceId)).toBe(true);
    expect(BleClient.disconnect).not.toHaveBeenCalled();
  });
  it('이전 연결의 늦은 read 실패는 새 연결을 해제하지 않는다', async () => {
    const adapter = new CapacitorBleAdapter();
    await adapter.connect(deviceId);
    let fail!: (reason: Error) => void;
    vi.mocked(BleClient.read).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const check = adapter.verifyConnection(deviceId);
    await adapter.connect(deviceId);
    fail(new Error('old connection closed'));
    await check;
    expect(await adapter.isConnected(deviceId)).toBe(true);
    expect(BleClient.disconnect).not.toHaveBeenCalled();
  });
});
