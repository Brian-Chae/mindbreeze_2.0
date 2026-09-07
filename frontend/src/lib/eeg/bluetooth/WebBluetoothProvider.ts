// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
/**
 * Web Bluetooth Provider — navigator.bluetooth (Chrome/Edge)
 * 
 * 기존 bluetoothService.ts 의 BLE 연결 로직을 감싸는 래퍼입니다.
 * 실제 패킷 파싱은 bluetoothService.ts 에서 그대로 처리합니다.
 */

import type { BluetoothProvider, BluetoothDeviceInfo, BLEService, BLECharacteristic, RequestDeviceOptions } from './BluetoothProvider';

export class WebBluetoothProvider implements BluetoothProvider {
  readonly platform = 'web' as const;

  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;

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
    
    this.server = await this.device.gatt!.connect();
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
    
    characteristic.addEventListener('characteristicvaluechanged', (event) => {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) onData(value);
    });
  }

  async stopNotifications(
    _deviceId: string,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<void> {
    if (!this.server) throw new Error('Not connected');

    const service = await this.server.getPrimaryService(serviceUuid);
    const characteristic = await service.getCharacteristic(characteristicUuid);
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
