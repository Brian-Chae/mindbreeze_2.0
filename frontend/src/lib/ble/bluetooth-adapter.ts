// 기존 EEG Provider 계약을 유지해 패킷 처리·UUID·재연결 경로를 공유한다.
export type {
  BluetoothProvider as BluetoothAdapter,
  BluetoothDeviceInfo,
  BLEService,
  RequestDeviceOptions,
} from '../eeg/bluetooth/BluetoothProvider';
