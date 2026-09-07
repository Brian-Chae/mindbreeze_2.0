// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
/**
 * Bluetooth Provider Interface
 * 
 * Web Bluetooth API (navigator.bluetooth) 와 Capacitor BLE Plugin (CoreBluetooth) 를
 * 동일한 인터페이스로 추상화합니다.
 * 
 * - Web: navigator.bluetooth.requestDevice() → GATT connect
 * - iOS: Capacitor BLE Plugin → CoreBluetooth connect
 */

export interface BluetoothDeviceInfo {
  deviceId: string;
  name: string | null;
}

export interface BLEService {
  uuid: string;
  characteristics: BLECharacteristic[];
}

export interface BLECharacteristic {
  uuid: string;
  properties: {
    read: boolean;
    write: boolean;
    notify: boolean;
    indicate: boolean;
  };
}

export interface BluetoothProvider {
  /** 플랫폼 식별자 (디버깅용) */
  readonly platform: 'web' | 'ios' | 'android';

  /** BLE 어댑터 초기화 (권한 요청 등) */
  initialize(): Promise<void>;

  /** 디바이스 검색 및 선택 */
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDeviceInfo>;

  /** 디바이스 연결 */
  connect(deviceId: string): Promise<void>;

  /** 디바이스 연결 해제 */
  disconnect(deviceId: string): Promise<void>;

  /** GATT 서비스 목록 조회 */
  discoverServices(deviceId: string): Promise<BLEService[]>;

  /** Characteristic Notification 시작 */
  startNotifications(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    onData: (data: DataView) => void
  ): Promise<void>;

  /** Characteristic Notification 중지 */
  stopNotifications(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<void>;

  /** Characteristic 읽기 */
  readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<DataView>;

  /** Characteristic 쓰기 */
  writeCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    data: ArrayBuffer
  ): Promise<void>;

  /** 연결 상태 확인 */
  isConnected(deviceId: string): Promise<boolean>;

  /** 배터리 레벨 읽기 (Battery Service 0x180F) */
  getBatteryLevel(deviceId: string): Promise<number>;
}

export interface RequestDeviceOptions {
  /** 필터링할 서비스 UUID 목록 */
  services?: string[];
  /** 디바이스 이름 필터 (정확히 일치) */
  name?: string;
  /**
   * 디바이스 이름 접두사 필터.
   * LINK BAND 는 'LXB' 등 접두사로 광고하므로 정확한 이름을 모르는 스캔 단계에서 사용.
   * Web Bluetooth(`filters: [{ namePrefix }]`) / Capacitor BLE(`namePrefix`) 양쪽이 지원.
   */
  namePrefix?: string;
  /** 검색 타임아웃 (ms), 기본 10000 */
  timeout?: number;
}
