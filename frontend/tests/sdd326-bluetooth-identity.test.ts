// SDD-326 T7: bluetoothService 가 연결 직후 시리얼을 스냅샷하고, releaseForNative 로 deviceName 이 지워진 뒤에도 유지한다.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  initialize: vi.fn(async () => undefined),
  requestDevice: vi.fn(),
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  isConnected: vi.fn(async () => true),
  onConnectionLost: vi.fn(),
  discoverServices: vi.fn(async () => [{ uuid: '', characteristics: [] }]),
  startNotifications: vi.fn(async () => undefined),
  stopNotifications: vi.fn(async () => undefined),
  readCharacteristic: vi.fn(),
  getBatteryLevel: vi.fn(async () => 80),
}));
vi.mock('../src/lib/eeg/bluetooth', () => ({ getBluetoothProvider: () => provider }));

import { bluetoothService } from '../src/lib/eeg/bluetoothService';

const EEG_SERVICE = 'df7b5d95-3afe-00a1-084c-b50895ef4f95';
const EEG_CHAR = '00ab4d15-66b4-0d8a-824f-8d6f8966c6e5';

async function connectAs(name: string | null, id = 'dev-1') {
  provider.requestDevice.mockResolvedValue({ deviceId: id, name });
  provider.discoverServices.mockImplementation(async () => [
    { uuid: EEG_SERVICE, characteristics: [{ uuid: EEG_CHAR, properties: { read: false, write: false, notify: true, indicate: false } }] },
  ]);
  await bluetoothService.connect(id);
}

beforeEach(async () => {
  Object.values(provider).forEach((f) => f.mockClear?.());
  provider.readCharacteristic.mockReset();
  await bluetoothService.disconnect().catch(() => undefined);
});

describe('bluetoothService.getBandIdentity', () => {
  it('연결 직후 시리얼을 대문자로 스냅샷하고, 펌웨어를 읽으면 채운다', async () => {
    provider.readCharacteristic.mockResolvedValue(new DataView(new TextEncoder().encode('1.0.4').buffer));
    await connectAs('lxb-0263008a');
    await vi.waitFor(() => expect(bluetoothService.getBandIdentity()).toEqual({ serial: 'LXB-0263008A', firmware: '1.0.4' }));
  });
  it('releaseForNative 로 deviceName 이 지워져도 시리얼 스냅샷이 남는다 (인계 전 채취)', async () => {
    provider.readCharacteristic.mockRejectedValue(new Error('no 180a'));
    await connectAs('LXB-0263008A', 'dev-release');
    await bluetoothService.releaseForNative();
    expect(bluetoothService.getDeviceName()).toBe('Unknown Device');
    expect(bluetoothService.getBandIdentity()).toEqual({ serial: 'LXB-0263008A', firmware: null });
  });
  it('펌웨어 읽기 실패는 연결을 막지 않고 시리얼만 보고한다', async () => {
    provider.readCharacteristic.mockRejectedValue(new Error('SecurityError'));
    await connectAs('LXB-0263008A');
    expect(bluetoothService.isConnected()).toBe(true);
    expect(bluetoothService.getBandIdentity()?.serial).toBe('LXB-0263008A');
  });
  it('이름이 null 이거나 LXB 가 아니면 식별 없음', async () => {
    provider.readCharacteristic.mockRejectedValue(new Error('x'));
    await connectAs(null);
    expect(bluetoothService.getBandIdentity()).toBeNull();
    await bluetoothService.disconnect();
    await connectAs('Galaxy Buds', 'dev-2');
    expect(bluetoothService.getBandIdentity()).toBeNull();
  });
  it('다른 밴드로 교체하면 새 시리얼로 바뀐다', async () => {
    provider.readCharacteristic.mockRejectedValue(new Error('x'));
    await connectAs('LXB-0263008A');
    await bluetoothService.disconnect();
    await connectAs('LXB-11112222', 'dev-2');
    expect(bluetoothService.getBandIdentity()?.serial).toBe('LXB-11112222');
  });
});
