// @ts-nocheck — link-band-sdk 이식본 (verbatim/noUnusedLocals 완화)
/**
 * Bluetooth Provider Factory — 웹 전용 (Web Bluetooth API).
 * Capacitor 네이티브 BLE는 MB 2.0 MVP1 스코프에서 제외한다.
 */

import type { BluetoothProvider } from './BluetoothProvider';

let _provider: BluetoothProvider | null = null;

/** WebBluetoothProvider 싱글톤을 반환한다. */
export async function getBluetoothProvider(): Promise<BluetoothProvider> {
  if (_provider) return _provider;

  const { WebBluetoothProvider } = await import('./WebBluetoothProvider');
  _provider = new WebBluetoothProvider();
  console.log(`[BluetoothProvider] Web mode: ${_provider.platform}`);
  return _provider;
}

/** 테스트용 — 싱글톤 초기화 */
export function resetBluetoothProvider(): void {
  _provider = null;
}
