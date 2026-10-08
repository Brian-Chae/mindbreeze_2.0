/**
 * 네이티브 BLE 어댑터 — 참조 SDK의 Capacitor BLE 연결 방식을 유지한다.
 * 
 * iOS: CoreBluetooth 프레임워크
 * Android: Android BLE API
 * 
 * npm: @capacitor-community/bluetooth-le
 */

import { getPlatform } from '../native/platform';
import { BleClient } from '@capacitor-community/bluetooth-le';
import type { BluetoothProvider, BluetoothDeviceInfo, BLEService, RequestDeviceOptions } from '../eeg/bluetooth/BluetoothProvider';

export class CapacitorBleAdapter implements BluetoothProvider {
  readonly platform: 'ios' | 'android';

  private connectedDevices = new Set<string>();
  private connectionAttempts = new Map<string, symbol>();
  private connectionLost: () => void = () => {};

  constructor() {
    this.platform = getPlatform() === 'android' ? 'android' : 'ios';
  }

  onConnectionLost(callback: () => void): void {
    this.connectionLost = callback;
  }

  async initialize(): Promise<void> {
    await BleClient.initialize({ androidNeverForLocation: true });
  }

  async requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDeviceInfo> {
    // BLE 디바이스 스캔
    // namePrefix 는 LINK BAND 처럼 정확한 이름을 모르는 스캔 단계에서 접두사 매칭에 사용한다.
    const device = await BleClient.requestDevice({
      services: options?.services ?? [],
      name: options?.name,
      namePrefix: options?.namePrefix,
    });

    return {
      deviceId: device.deviceId,
      name: device.name ?? null,
    };
  }

  async connect(deviceId: string): Promise<void> {
    const attempt = Symbol();
    this.connectionAttempts.set(deviceId, attempt);
    this.connectedDevices.delete(deviceId);
    try {
      await BleClient.connect(deviceId, (disconnectedDeviceId) => {
        // 이전 연결의 늦은 해제 이벤트가 새 연결 상태를 지우지 않도록 한다.
        if (this.connectionAttempts.get(disconnectedDeviceId) !== attempt) return;
        this.connectionAttempts.delete(disconnectedDeviceId);
        this.connectedDevices.delete(disconnectedDeviceId);
        this.connectionLost();
      });
      if (this.connectionAttempts.get(deviceId) !== attempt) {
        throw new Error('LINK BAND 연결 중 연결이 해제되었습니다. 다시 연결해 주세요.');
      }
      this.connectedDevices.add(deviceId);
    } catch (error: unknown) {
      if (this.connectionAttempts.get(deviceId) === attempt) {
        this.connectionAttempts.delete(deviceId);
        this.connectedDevices.delete(deviceId);
      }
      throw error;
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    this.connectionAttempts.delete(deviceId);
    this.connectedDevices.delete(deviceId);
    await BleClient.disconnect(deviceId);
  }

  async discoverServices(deviceId: string): Promise<BLEService[]> {
    const services = await BleClient.getServices(deviceId);
    
    return services.map((svc) => ({
      uuid: svc.uuid,
      characteristics: svc.characteristics.map((ch) => ({
        uuid: ch.uuid,
        properties: {
          read: ch.properties?.read ?? false,
          write: ch.properties?.write ?? false,
          notify: ch.properties?.notify ?? false,
          indicate: ch.properties?.indicate ?? false,
        },
      })),
    }));
  }

  async startNotifications(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    onData: (data: DataView) => void
  ): Promise<void> {
    await BleClient.startNotifications(
      deviceId,
      serviceUuid,
      characteristicUuid,
      (rawData: DataView) => {
        // Capacitor BLE Plugin 이 DataView 로 콜백
        onData(rawData);
      }
    );
  }

  async stopNotifications(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<void> {
    await BleClient.stopNotifications(deviceId, serviceUuid, characteristicUuid);
  }

  async readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<DataView> {
    return BleClient.read(deviceId, serviceUuid, characteristicUuid);
  }

  async writeCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    data: ArrayBuffer
  ): Promise<void> {
    await BleClient.write(deviceId, serviceUuid, characteristicUuid, new DataView(data));
  }

  async isConnected(deviceId: string): Promise<boolean> {
    return this.connectedDevices.has(deviceId);
  }

  async getBatteryLevel(deviceId: string): Promise<number> {
    try {
      const result = await BleClient.read(
        deviceId,
        BATTERY_SERVICE_UUID,
        BATTERY_LEVEL_CHAR_UUID
      );
      return result.getUint8(0);
    } catch (error) {
      // 선택적 배터리 서비스가 없는 기기는 기존 기본값을 유지한다.
      return 0;
    }
  }
}

// BLE 표준 UUID
const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL_CHAR_UUID = '00002a19-0000-1000-8000-00805f9b34fb';
