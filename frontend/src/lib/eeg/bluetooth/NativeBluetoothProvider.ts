// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
/**
 * NativeBluetoothProvider 스텁 — Capacitor BLE는 MB 2.0 웹 빌드에서 제외.
 * getBluetoothProvider()는 WebBluetoothProvider만 사용한다.
 */

import type {
  BluetoothProvider,
  BluetoothDeviceInfo,
  BLEService,
  RequestDeviceOptions,
} from './BluetoothProvider';

const UNSUPPORTED = 'NativeBluetoothProvider는 MB 2.0 웹 빌드에서 지원하지 않습니다';

/** 호출 시 명시적 오류 — 네이티브 BLE 미지원 */
export class NativeBluetoothProvider implements BluetoothProvider {
  readonly platform = 'ios' as const;

  async initialize(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async requestDevice(_options?: RequestDeviceOptions): Promise<BluetoothDeviceInfo> {
    throw new Error(UNSUPPORTED);
  }

  async connect(_deviceId: string): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async disconnect(_deviceId: string): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async discoverServices(_deviceId: string): Promise<BLEService[]> {
    throw new Error(UNSUPPORTED);
  }

  async startNotifications(
    _deviceId: string,
    _serviceUuid: string,
    _characteristicUuid: string,
    _onData: (data: DataView) => void,
  ): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async stopNotifications(
    _deviceId: string,
    _serviceUuid: string,
    _characteristicUuid: string,
  ): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async readCharacteristic(
    _deviceId: string,
    _serviceUuid: string,
    _characteristicUuid: string,
  ): Promise<DataView> {
    throw new Error(UNSUPPORTED);
  }

  async writeCharacteristic(
    _deviceId: string,
    _serviceUuid: string,
    _characteristicUuid: string,
    _data: ArrayBuffer,
  ): Promise<void> {
    throw new Error(UNSUPPORTED);
  }

  async isConnected(_deviceId: string): Promise<boolean> {
    return false;
  }

  async getBatteryLevel(_deviceId: string): Promise<number> {
    throw new Error(UNSUPPORTED);
  }
}
