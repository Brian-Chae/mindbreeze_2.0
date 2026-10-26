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
    registerActiveAdapter(this);
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
    // 재연결·재입장 때 같은 characteristic 에 네이티브 구독이 남아 있으면 같은 패킷이 중복 전달된다.
    // 등록 전에 항상 해제를 시도한다(구독이 없으면 무시).
    try {
      await BleClient.stopNotifications(deviceId, serviceUuid, characteristicUuid);
    } catch {
      // 구독 없음 — 정상
    }
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

  /**
   * 앱 복귀 시 실제 연결 상태 확인 (SDD-222 G1).
   * 백그라운드 중 OS 가 연결을 끊어도 해제 이벤트가 유실될 수 있어 로컬 Set 만으로는 알 수 없다.
   * 배터리 read 실패 시 OS 연결 목록으로 실제 단절을 확인한 뒤에만 재연결을 유도한다.
   * 이 어댑터가 연결로 알고 있지 않은 기기는 검증 대상이 아니므로 프로브 없이 false.
   */
  async verifyConnection(deviceId: string): Promise<boolean> {
    if (!this.connectedDevices.has(deviceId)) return false;
    const attempt = this.connectionAttempts.get(deviceId);
    const isCurrent = () => this.connectionAttempts.get(deviceId) === attempt && this.connectedDevices.has(deviceId);
    try {
      await BleClient.read(deviceId, BATTERY_SERVICE_UUID, BATTERY_LEVEL_CHAR_UUID);
      return this.connectedDevices.has(deviceId);
    } catch {
      if (!isCurrent()) return this.connectedDevices.has(deviceId);
      // 배터리는 선택적이다. read 실패만으로 정상 BLE를 끊지 않고 OS 상태를 확인한다.
      // iOS는 서비스 필터가 필수이므로 LINK BAND의 필수 EEG 서비스를 사용한다.
      try {
        const devices = await BleClient.getConnectedDevices([LINK_BAND_EEG_SERVICE_UUID]);
        if (!isCurrent()) return this.connectedDevices.has(deviceId);
        if (devices.some(device => device.deviceId === deviceId)) return true;
      } catch {
        // OS 상태도 확인할 수 없으면 연결 해제 이벤트를 기다린다.
        return this.connectedDevices.has(deviceId);
      }
      this.connectionAttempts.delete(deviceId);
      this.connectedDevices.delete(deviceId);
      try {
        await BleClient.disconnect(deviceId);
      } catch {
        // 이미 끊긴 연결의 정리 실패는 무시
      }
      // 정리 대기 중 시작한 새 연결에 이전 단절 이벤트를 전달하지 않는다.
      if (!this.connectionAttempts.has(deviceId)) this.connectionLost();
      return this.connectedDevices.has(deviceId);
    }
  }

  /** 현재 연결로 알고 있는 기기 ID 목록 (복귀 시 검증용) */
  getConnectedDeviceIds(): string[] {
    return [...this.connectedDevices];
  }

  async getBatteryLevel(deviceId: string): Promise<number> {
    try {
      const result = await BleClient.read(
        deviceId,
        BATTERY_SERVICE_UUID,
        BATTERY_LEVEL_CHAR_UUID
      );
      return result.getUint8(0);
    } catch {
      // 선택적 배터리 서비스가 없는 기기는 기존 기본값을 유지한다.
      return 0;
    }
  }
}

// 가장 최근에 만든 어댑터 — useBand 가 provider 인스턴스에 접근하지 않고도 복귀 시 연결 확인
let activeAdapter: CapacitorBleAdapter | null = null;
function registerActiveAdapter(adapter: CapacitorBleAdapter): void {
  activeAdapter = adapter;
}

/**
 * 활성 네이티브 어댑터의 연결 기기를 검증한다.
 * @returns true=정상, false=끊김 감지(재연결 트리거됨), null=검증할 연결 없음(웹·미연결)
 */
export async function verifyActiveBleConnection(): Promise<boolean | null> {
  const ids = activeAdapter?.getConnectedDeviceIds() ?? [];
  if (!activeAdapter || ids.length === 0) return null;
  const results = await Promise.all(ids.map((id) => activeAdapter!.verifyConnection(id)));
  return results.every(Boolean);
}

// BLE 표준 UUID
const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
const BATTERY_LEVEL_CHAR_UUID = '00002a19-0000-1000-8000-00805f9b34fb';

// bluetoothService의 LINK BAND 필수 EEG 서비스. 선택적 배터리 서비스로 조회하지 않는다.
const LINK_BAND_EEG_SERVICE_UUID = 'df7b5d95-3afe-00a1-084c-b50895ef4f95';
