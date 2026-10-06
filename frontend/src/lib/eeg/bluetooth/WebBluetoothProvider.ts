// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
/**
 * Web Bluetooth Provider — navigator.bluetooth (Chrome/Edge)
 * 
 * 기존 bluetoothService.ts 의 BLE 연결 로직을 감싸는 래퍼입니다.
 * 실제 패킷 파싱은 bluetoothService.ts 에서 그대로 처리합니다.
 */

import type { BluetoothProvider, BluetoothDeviceInfo, BLEService, RequestDeviceOptions } from './BluetoothProvider';

export class WebBluetoothProvider implements BluetoothProvider {
  readonly platform = 'web' as const;

  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;

  private onConnectionLostCb: (() => void) | null = null;

  // EEG-BLE-001: characteristicvaluechanged 리스너를 characteristic 별로 보관한다.
  // 재연결(reconnect) 시 startNotifications 가 같은 characteristic 에 리스너를 다시
  // 등록하면 데이터가 N배로 중복 emit 되므로, stopNotifications/disconnect 에서
  // removeEventListener 로 반드시 해제해 누적을 막는다.
  private valueChangedHandlers = new Map<string, (event: Event) => void>();

  private handleDisconnected = (): void => {
    this.onConnectionLostCb?.();
  };

  private listenerKey(serviceUuid: string, characteristicUuid: string): string {
    return `${serviceUuid}::${characteristicUuid}`;
  }

  async initialize(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth API is not available in this browser');
    }
  }

  async requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDeviceInfo> {
    const filters = options?.namePrefix
      ? [{ namePrefix: options.namePrefix }]
      : options?.name
        ? [{ name: options.name }]
        : undefined;

    const device = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices: options?.services ?? [],
      acceptAllDevices: !filters && !options?.services?.length,
    });

    this.device = device;

    return {
      deviceId: device.id,
      name: device.name ?? null,
    };
  }

  async connect(_deviceId: string): Promise<void> {
    if (!this.device) throw new Error('No device selected. Call requestDevice() first.');

    // 예기치 않은 연결 해제 감지 — Provider 내부 책임.
    // (이전에는 bluetoothService.performConnectionLossHandling 에서 처리했으나,
    //  Provider 추상화 후 이곳에서 gattserverdisconnected 를 감지해 콜백을 발화한다.)
    // remove-before-add 로 재연결 시 리스너 중복 등록을 방지한다.
    this.device.removeEventListener('gattserverdisconnected', this.handleDisconnected);
    this.device.addEventListener('gattserverdisconnected', this.handleDisconnected);

    // EEG-BLE-001: gatt 재연결 시 이전 characteristic 객체는 무효화되므로
    // 보관하던 값-변경 핸들러도 함께 폐기한다(재등록은 startNotifications 에서 수행).
    this.valueChangedHandlers.clear();

    this.server = await this.device.gatt!.connect();
  }

  onConnectionLost(callback: () => void): void {
    this.onConnectionLostCb = callback;
  }

  async disconnect(_deviceId: string): Promise<void> {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
  }

  async discoverServices(_deviceId: string): Promise<BLEService[]> {
    if (!this.server) throw new Error('Not connected');

    const services = await this.server.getPrimaryServices();
    
    return Promise.all(
      services.map(async (svc) => ({
        uuid: svc.uuid,
        characteristics: await Promise.all(
          (await svc.getCharacteristics()).map((ch) => ({
            uuid: ch.uuid,
            properties: {
              read: ch.properties.read ?? false,
              write: ch.properties.write ?? false,
              notify: ch.properties.notify ?? false,
              indicate: ch.properties.indicate ?? false,
            },
          }))
        ),
      }))
    );
  }

  async startNotifications(
    _deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    onData: (data: DataView) => void
  ): Promise<void> {
    if (!this.server) throw new Error('Not connected');

    const service = await this.server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
    
    await characteristic.startNotifications();

    // EEG-BLE-001: 같은 characteristic 에 대해 remove-before-add 로 중복 등록을 막는다.
    const key = this.listenerKey(serviceUuid, characteristicUuid);
    const previous = this.valueChangedHandlers.get(key);
    if (previous) {
      characteristic.removeEventListener('characteristicvaluechanged', previous);
    }

    const handler = (event: Event): void => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) onData(value);
    };
    characteristic.addEventListener('characteristicvaluechanged', handler);
    this.valueChangedHandlers.set(key, handler);
  }

  async stopNotifications(
    _deviceId: string,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<void> {
    if (!this.server) throw new Error('Not connected');

    const service = await this.server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);

    // EEG-BLE-001: stopNotifications 만 호출하면 JS 리스너가 남아 재연결 시
    // 중복 emit 된다. 등록 시 보관한 핸들러를 removeEventListener 로 해제한다.
    const key = this.listenerKey(serviceUuid, characteristicUuid);
    const handler = this.valueChangedHandlers.get(key);
    if (handler) {
      characteristic.removeEventListener('characteristicvaluechanged', handler);
      this.valueChangedHandlers.delete(key);
    }

    await characteristic.stopNotifications();
  }

  async readCharacteristic(
    _deviceId: string,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<DataView> {
    if (!this.server) throw new Error('Not connected');

    const service = await this.server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
    return characteristic.readValue();
  }

  async writeCharacteristic(
    _deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    data: ArrayBuffer
  ): Promise<void> {
    if (!this.server) throw new Error('Not connected');

    const service = await this.server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
    await characteristic.writeValue(data);
  }

  async isConnected(_deviceId: string): Promise<boolean> {
    return this.device?.gatt?.connected ?? false;
  }

  async getBatteryLevel(_deviceId: string): Promise<number> {
    if (!this.server) throw new Error('Not connected');

    try {
      const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
      const BATTERY_LEVEL_CHAR = '00002a19-0000-1000-8000-00805f9b34fb';
      const batteryService = await this.server.getPrimaryService(BATTERY_SERVICE);
      const batteryChar = await batteryService.getCharacteristic(BATTERY_LEVEL_CHAR);
      const value = await batteryChar.readValue();
      return value.getUint8(0);
    } catch {
      return 0;
    }
  }
}
