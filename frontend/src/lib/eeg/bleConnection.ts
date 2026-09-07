// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
import type { EEGDevice } from './types/eeg';
import { createLogger } from "./logger";


const logger = createLogger("BLEConn");
// LINK BAND BLE 연결 헬퍼. UUID/상수는 호출측이 주입한다.

export interface LinkBandBLEUUIDs {
  EEG_SERVICE: string;
  EEG_CHARACTERISTIC: string;
  PPG_SERVICE: string;
  PPG_CHARACTERISTIC: string;
  ACCELEROMETER_SERVICE: string;
  ACCELEROMETER_CHARACTERISTIC: string;
  BATTERY_SERVICE: string;
  BATTERY_CHARACTERISTIC: string;
}

export interface BLEServices {
  eegService: BluetoothRemoteGATTService;
  eegCharacteristic: BluetoothRemoteGATTCharacteristic;
  ppgService: BluetoothRemoteGATTService | null;
  ppgCharacteristic: BluetoothRemoteGATTCharacteristic | null;
  accelerometerService: BluetoothRemoteGATTService | null;
  accelerometerCharacteristic: BluetoothRemoteGATTCharacteristic | null;
  batteryService: BluetoothRemoteGATTService | null;
  batteryCharacteristic: BluetoothRemoteGATTCharacteristic | null;
}

const NAME_FILTERS: BluetoothLEScanFilter[] = [
  { namePrefix: 'LXB' },
  { namePrefix: 'LinkBand' },
  { namePrefix: 'LOOXID' },
];

function optionalServices(uuids: LinkBandBLEUUIDs): BluetoothServiceUUID[] {
  return [
    uuids.EEG_SERVICE,
    uuids.PPG_SERVICE,
    uuids.ACCELEROMETER_SERVICE,
    uuids.BATTERY_SERVICE,
  ];
}

export async function scanBLE(uuids: LinkBandBLEUUIDs): Promise<{ device: BluetoothDevice; result: EEGDevice } | null> {
  if (!navigator.bluetooth) {
    throw new Error('Web Bluetooth API가 지원되지 않습니다.');
  }

  const device = await navigator.bluetooth.requestDevice({
    filters: NAME_FILTERS,
    optionalServices: optionalServices(uuids),
  });

  if (!device) return null;

  return {
    device,
    result: {
      id: device.id,
      name: device.name || 'LINK BAND',
      connected: false,
      batteryLevel: 0,
      signalQuality: 'good',
    },
  };
}

export async function requestDevice(uuids: LinkBandBLEUUIDs): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters: NAME_FILTERS,
    optionalServices: optionalServices(uuids),
  });
}

export async function discoverServices(
  server: BluetoothRemoteGATTServer,
  uuids: LinkBandBLEUUIDs
): Promise<BLEServices> {
  // EEG는 필수
  const eegService = await server.getPrimaryService(uuids.EEG_SERVICE);
  const eegCharacteristic = await eegService.getCharacteristic(uuids.EEG_CHARACTERISTIC);

  let ppgService: BluetoothRemoteGATTService | null = null;
  let ppgCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  try {
    ppgService = await server.getPrimaryService(uuids.PPG_SERVICE);
    ppgCharacteristic = await ppgService.getCharacteristic(uuids.PPG_CHARACTERISTIC);
  } catch (ppgError) {
    logger.error('❌ PPG 서비스 연결 실패:', ppgError);
    ppgService = null;
    ppgCharacteristic = null;
  }

  let accelerometerService: BluetoothRemoteGATTService | null = null;
  let accelerometerCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  try {
    accelerometerService = await server.getPrimaryService(uuids.ACCELEROMETER_SERVICE);
    accelerometerCharacteristic = await accelerometerService.getCharacteristic(uuids.ACCELEROMETER_CHARACTERISTIC);
  } catch (error) {
    logger.warn('⚠️ 가속도계 서비스 연결 실패 (선택적):', error);
  }

  let batteryService: BluetoothRemoteGATTService | null = null;
  let batteryCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  try {
    batteryService = await server.getPrimaryService(uuids.BATTERY_SERVICE);
    batteryCharacteristic = await batteryService.getCharacteristic(uuids.BATTERY_CHARACTERISTIC);
  } catch (error) {
    logger.warn('⚠️ 배터리 서비스 연결 실패 (선택적):', error);
  }

  return {
    eegService,
    eegCharacteristic,
    ppgService,
    ppgCharacteristic,
    accelerometerService,
    accelerometerCharacteristic,
    batteryService,
    batteryCharacteristic,
  };
}
