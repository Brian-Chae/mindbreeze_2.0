import type { BluetoothProvider } from './BluetoothProvider';
import { createBluetoothAdapter } from '../../ble';

let provider: Promise<BluetoothProvider> | null = null;

export function getBluetoothProvider(): Promise<BluetoothProvider> {
  provider ??= createBluetoothAdapter().catch((error: unknown) => {
    provider = null;
    throw error;
  });
  return provider;
}

export function resetBluetoothProvider(): void {
  provider = null;
}
