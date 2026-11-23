// SDD-330: 권한·배터리 설정 바로가기. 사용자가 설정 메뉴를 직접 찾지 않도록 앱에서 해당 화면을 연다.
// 네이티브 플러그인(AppSettings)이 없는 구버전 앱·웹에서는 모든 함수가 false 를 돌려주고, 호출부는 기존 안내 문구로 폴백한다.
import { registerPlugin } from '@capacitor/core';
import { getPlatform, isNativeApp } from './platform';

interface AppSettingsPlugin {
  openAppSettings(): Promise<void>;
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
  openBatterySettings(): Promise<void>;
  /** SDD-333: enabled=null 이면 알 수 없음(권한 전 iOS·어댑터 없음) */
  isBluetoothEnabled(): Promise<{ enabled: boolean | null }>;
  requestEnableBluetooth(): Promise<{ mode: 'already_on' | 'system_dialog' | 'settings' | 'power_alert' }>;
  openBluetoothSettings(): Promise<{ mode: 'settings' }>;
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

/**
 * SDD-333: 블루투스 전원이 켜져 있는지. 꺼짐 false / 켜짐 true / 알 수 없음(웹·구버전 앱·iOS 권한 전) null.
 * 알 수 없으면 꺼짐 안내를 띄우지 않는다 — 거짓 경고 금지.
 */
export async function isBluetoothEnabled(): Promise<boolean | null> {
  const p = native();
  if (!p) return null;
  try {
    const r = await p.isBluetoothEnabled();
    return typeof r.enabled === 'boolean' ? r.enabled : null;
  } catch {
    return null;
  }
}

/** 블루투스 켜기 요청 결과. unavailable = 구버전 앱·웹(버튼을 숨긴다). */
export type EnableBluetoothResult = 'already_on' | 'system_dialog' | 'settings' | 'power_alert' | 'unavailable';

/**
 * 블루투스 켜기 바로가기.
 * Android: 시스템 "블루투스 켜기" 창 → 거부·실패 시 블루투스 설정 화면. Android 12+ 권한이 없으면 권한 요청 뒤 한 번 더 시도한다.
 * iOS: 시스템 "Bluetooth 켜기" 알림(CBCentralManagerOptionShowPowerAlertKey). 비공개 URL(App-Prefs:)은 쓰지 않는다.
 */
export async function requestEnableBluetooth(): Promise<EnableBluetoothResult> {
  const p = native();
  if (!p) return 'unavailable';
  const run = async (): Promise<EnableBluetoothResult> => (await p.requestEnableBluetooth()).mode;
  try {
    return await run();
  } catch (e) {
    const code = (e as { code?: string; message?: string } | null);
    if (getPlatform() === 'android' && (code?.code === 'permission' || code?.message === 'permission')) {
      if (await requestBluetoothPermission()) {
        try { return await run(); } catch { /* 아래 설정 화면 폴백 */ }
      }
      try { await p.openBluetoothSettings(); return 'settings'; } catch { return 'unavailable'; }
    }
    return 'unavailable';
  }
}

/** Android 블루투스 설정 화면을 연다. Android 외·구버전은 false. */
export function openBluetoothSettings(): Promise<boolean> {
  if (getPlatform() !== 'android') return Promise.resolve(false);
  return attempt((p) => p.openBluetoothSettings());
}
