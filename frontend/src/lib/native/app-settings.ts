// SDD-330: 권한·배터리 설정 바로가기. 사용자가 설정 메뉴를 직접 찾지 않도록 앱에서 해당 화면을 연다.
// 네이티브 플러그인(AppSettings)이 없는 구버전 앱·웹에서는 모든 함수가 false 를 돌려주고, 호출부는 기존 안내 문구로 폴백한다.
import { registerPlugin } from '@capacitor/core';
import { getPlatform, isNativeApp } from './platform';

interface AppSettingsPlugin {
  openAppSettings(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  openBatterySettings(): Promise<void>;
}

let plugin: AppSettingsPlugin | null = null;
function native(): AppSettingsPlugin | null {
  if (!isNativeApp()) return null;
  plugin ??= registerPlugin<AppSettingsPlugin>('AppSettings');
  return plugin;
}

/** 플러그인이 없는 구버전 앱이면 호출이 'not implemented' 로 실패한다 — 실패는 false 로 삼킨다. */
async function attempt(run: (p: AppSettingsPlugin) => Promise<unknown>): Promise<boolean> {
  const p = native();
  if (!p) return false;
  try {
    await run(p);
    return true;
  } catch {
    return false;
  }
}

/** 이 앱의 권한 설정 화면(Android 앱 정보 / iOS 설정 앱)을 연다. 열었으면 true. */
export function openAppSettings(): Promise<boolean> {
  return attempt((p) => p.openAppSettings());
}

/** Android 배터리 최적화 예외 요청을 연다. Android 앱이 아니면 false. */
export function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (getPlatform() !== 'android') return Promise.resolve(false);
  return attempt((p) => p.requestIgnoreBatteryOptimizations());
}

/** Android 배터리 최적화 설정 화면을 연다. */
export function openBatterySettings(): Promise<boolean> {
  if (getPlatform() !== 'android') return Promise.resolve(false);
  return attempt((p) => p.openBatterySettings());
}

/** 배터리 최적화에서 이미 제외됐는지. 조회 불가(구버전·iOS)는 null. */
export async function isBatteryOptimizationIgnored(): Promise<boolean | null> {
  if (getPlatform() !== 'android') return null;
  const p = native();
  if (!p) return null;
  try {
    return (await p.isIgnoringBatteryOptimizations()).ignoring;
  } catch {
    return null;
  }
}

/** 앱 안에서 직접 블루투스 권한 요청 창을 띄운다(Android 근처 기기 / iOS 블루투스). 요청을 시도했으면 true. */
export async function requestBluetoothPermission(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { BleClient } = await import('@capacitor-community/bluetooth-le');
    await BleClient.initialize({ androidNeverForLocation: true });
    return true;
  } catch {
    return false;
  }
}
