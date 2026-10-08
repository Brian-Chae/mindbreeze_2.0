import { isNativeApp } from '../native/platform';
import type { BluetoothAdapter } from './bluetooth-adapter';

export function isBleSupported(): boolean {
  return isNativeApp() || (typeof navigator !== 'undefined' && 'bluetooth' in navigator);
}

export async function createBluetoothAdapter(): Promise<BluetoothAdapter> {
  if (isNativeApp()) {
    const { CapacitorBleAdapter } = await import('./capacitor-ble-adapter');
    return new CapacitorBleAdapter();
  }
  const { WebBluetoothAdapter } = await import('./web-bluetooth-adapter');
  return new WebBluetoothAdapter();
}
