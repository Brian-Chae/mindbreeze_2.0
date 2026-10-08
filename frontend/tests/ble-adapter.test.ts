import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { createBluetoothAdapter, isBleSupported } from '../src/lib/ble';
import { CapacitorBleAdapter } from '../src/lib/ble/capacitor-ble-adapter';
import { WebBluetoothProvider } from '../src/lib/eeg/bluetooth/WebBluetoothProvider';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(), getPlatform: vi.fn() },
}));

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(), requestDevice: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
    getServices: vi.fn(), startNotifications: vi.fn(), stopNotifications: vi.fn(),
    read: vi.fn(), write: vi.fn(),
  },
}));

const deviceId = 'link-band-1';
const serviceUuid = '0000fe40-cc7a-482a-984a-7f2ed5b3e58f';
const characteristicUuid = '0000fe41-cc7a-482a-984a-7f2ed5b3e58f';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
  vi.mocked(BleClient.requestDevice).mockResolvedValue({ deviceId, name: 'LXB-001' });
});

afterEach(() => vi.unstubAllGlobals());

describe('BLE 플랫폼 선택과 웹 호환성', () => {
  it.each(['ios', 'android'])('%s 앱에서는 Web Bluetooth 없이 네이티브 어댑터를 선택한다', async (platform) => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue(platform);
    vi.stubGlobal('navigator', {});
    const adapter = await createBluetoothAdapter();
    expect(adapter).toBeInstanceOf(CapacitorBleAdapter);
    expect(adapter.platform).toBe(platform);
    expect(isBleSupported()).toBe(true);
  });

  it('웹에서는 기존 Provider로 장치를 요청하고 네이티브 플러그인은 호출하지 않는다', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    const requestDevice = vi.fn().mockResolvedValue({ id: deviceId, name: 'LXB-001' });
    vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
    const adapter = await createBluetoothAdapter();
    expect(adapter).toBeInstanceOf(WebBluetoothProvider);
    await adapter.initialize();
    await expect(adapter.requestDevice({ namePrefix: 'LXB', services: [serviceUuid] }))
      .resolves.toEqual({ deviceId, name: 'LXB-001' });
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ namePrefix: 'LXB' }], optionalServices: [serviceUuid], acceptAllDevices: false,
    });
    expect(BleClient.initialize).not.toHaveBeenCalled();
    expect(BleClient.requestDevice).not.toHaveBeenCalled();
    expect(isBleSupported()).toBe(true);
  });

  it('미지원 브라우저에서는 기존 안내에 사용할 지원 여부와 초기화 오류를 유지한다', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.stubGlobal('navigator', {});
    expect(isBleSupported()).toBe(false);
    await expect((await createBluetoothAdapter()).initialize()).rejects.toThrow('Web Bluetooth API');
  });
});

describe('Capacitor BLE 어댑터', () => {
  it('스캔부터 연결·알림·해제 후 재연결까지 동일한 패킷을 전달한다', async () => {
    const adapter = new CapacitorBleAdapter();
    const onData = vi.fn();
    const onLost = vi.fn();
    adapter.onConnectionLost(onLost);
    await adapter.initialize();
    expect(BleClient.initialize).toHaveBeenCalledWith({ androidNeverForLocation: true });
    await expect(adapter.requestDevice({ services: [serviceUuid], namePrefix: 'LXB' }))
      .resolves.toEqual({ deviceId, name: 'LXB-001' });
    expect(BleClient.requestDevice).toHaveBeenCalledWith({ services: [serviceUuid], namePrefix: 'LXB', name: undefined });
    await adapter.connect(deviceId);
    expect(await adapter.isConnected(deviceId)).toBe(true);
    await adapter.startNotifications(deviceId, serviceUuid, characteristicUuid, onData);
    const packet = new DataView(Uint8Array.from([1, 2, 3, 4]).buffer);
    vi.mocked(BleClient.startNotifications).mock.calls[0][3](packet);
    expect(onData).toHaveBeenCalledExactlyOnceWith(packet);
    expect(BleClient.startNotifications).toHaveBeenCalledWith(deviceId, serviceUuid, characteristicUuid, expect.any(Function));
    await adapter.stopNotifications(deviceId, serviceUuid, characteristicUuid);
    expect(BleClient.stopNotifications).toHaveBeenCalledWith(deviceId, serviceUuid, characteristicUuid);
    await adapter.disconnect(deviceId);
    expect(BleClient.disconnect).toHaveBeenCalledWith(deviceId);
    vi.mocked(BleClient.connect).mock.calls[0][1]?.(deviceId);
    expect(onLost).not.toHaveBeenCalled();
    expect(await adapter.isConnected(deviceId)).toBe(false);
    await adapter.connect(deviceId);
    await adapter.startNotifications(deviceId, serviceUuid, characteristicUuid, onData);
    vi.mocked(BleClient.startNotifications).mock.calls[1][3](packet);
    expect(await adapter.isConnected(deviceId)).toBe(true);
    expect(BleClient.connect).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenCalledTimes(2);
  });

  it('예기치 않은 연결 해제는 상태를 지우고 중복 없이 재연결 콜백을 전달한다', async () => {
    const adapter = new CapacitorBleAdapter();
    const onLost = vi.fn();
    adapter.onConnectionLost(onLost);
    await adapter.connect(deviceId);
    const disconnected = vi.mocked(BleClient.connect).mock.calls[0][1];
    disconnected?.(deviceId);
    disconnected?.(deviceId);
    expect(await adapter.isConnected(deviceId)).toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
    await adapter.connect(deviceId);
    expect(await adapter.isConnected(deviceId)).toBe(true);
    vi.mocked(BleClient.connect).mock.calls[1][1]?.(deviceId);
    expect(onLost).toHaveBeenCalledTimes(2);
  });

  it('연결 실패를 상위 호출자에게 전달하고 연결 상태로 기록하지 않는다', async () => {
    const adapter = new CapacitorBleAdapter();
    vi.mocked(BleClient.connect).mockRejectedValueOnce(new Error('연결 실패'));
    await expect(adapter.connect(deviceId)).rejects.toThrow('연결 실패');
    expect(await adapter.isConnected(deviceId)).toBe(false);
  });

  it('연결 완료 전에 해제되면 연결을 실패로 처리하고 해제 상태를 유지한다', async () => {
    const adapter = new CapacitorBleAdapter();
    const onLost = vi.fn();
    adapter.onConnectionLost(onLost);
    vi.mocked(BleClient.connect).mockImplementationOnce(async (id, onDisconnect) => {
      onDisconnect?.(id);
    });
    await expect(adapter.connect(deviceId)).rejects.toThrow();
    expect(await adapter.isConnected(deviceId)).toBe(false);
  });

  it('이전 연결의 늦은 해제 콜백이 재연결된 상태를 지우지 않는다', async () => {
    const adapter = new CapacitorBleAdapter();
    const onLost = vi.fn();
    adapter.onConnectionLost(onLost);
    await adapter.connect(deviceId);
    const previousDisconnect = vi.mocked(BleClient.connect).mock.calls[0][1];
    await adapter.disconnect(deviceId);
    await adapter.connect(deviceId);
    previousDisconnect?.(deviceId);
    expect(await adapter.isConnected(deviceId)).toBe(true);
    expect(onLost).not.toHaveBeenCalled();
    vi.mocked(BleClient.connect).mock.calls[1][1]?.(deviceId);
    expect(await adapter.isConnected(deviceId)).toBe(false);
    expect(onLost).toHaveBeenCalledOnce();
  });

  it('읽기·쓰기 시 바이트와 UUID를 보존하며 배터리는 표준 서비스를 사용한다', async () => {
    const adapter = new CapacitorBleAdapter();
    const packet = new DataView(Uint8Array.from([42, 255]).buffer);
    vi.mocked(BleClient.read).mockResolvedValue(packet);
    await expect(adapter.readCharacteristic(deviceId, serviceUuid, characteristicUuid)).resolves.toBe(packet);
    expect(BleClient.read).toHaveBeenCalledWith(deviceId, serviceUuid, characteristicUuid);
    const bytes = Uint8Array.from([3, 7, 255]).buffer;
    await adapter.writeCharacteristic(deviceId, serviceUuid, characteristicUuid, bytes);
    const [writtenDevice, writtenService, writtenCharacteristic, writtenValue] = vi.mocked(BleClient.write).mock.calls[0];
    expect([writtenDevice, writtenService, writtenCharacteristic]).toEqual([deviceId, serviceUuid, characteristicUuid]);
    expect(Array.from(new Uint8Array(writtenValue.buffer, writtenValue.byteOffset, writtenValue.byteLength))).toEqual([3, 7, 255]);
    await expect(adapter.getBatteryLevel(deviceId)).resolves.toBe(42);
    expect(BleClient.read).toHaveBeenLastCalledWith(deviceId, '0000180f-0000-1000-8000-00805f9b34fb', '00002a19-0000-1000-8000-00805f9b34fb');
    vi.mocked(BleClient.read).mockRejectedValueOnce(new Error('선택 서비스 없음'));
    await expect(adapter.getBatteryLevel(deviceId)).resolves.toBe(0);
  });

  it('서비스 특성의 누락된 권한은 false로 정규화한다', async () => {
    vi.mocked(BleClient.getServices).mockResolvedValue([{
      uuid: serviceUuid,
      characteristics: [{ uuid: characteristicUuid, properties: { notify: true }, descriptors: [] }],
    }]);
    await expect(new CapacitorBleAdapter().discoverServices(deviceId)).resolves.toEqual([{
      uuid: serviceUuid,
      characteristics: [{ uuid: characteristicUuid, properties: { read: false, write: false, notify: true, indicate: false } }],
    }]);
  });
});
