// 네이티브 측정 중 기기 메뉴용 신호·접촉·연결 상태. JS BLE 연결이 풀려 있어도 네이티브 snapshot 에서 가져온다.
import type { DeviceStatus } from '../api/session';
import { signalQualityLevel, type SignalQualityLevel } from '../session-live/signal-status';
import type { MeasurementSnapshot } from './types';

export interface NativeDeviceState {
  signalQualityLevel: SignalQualityLevel;
  deviceStatus: DeviceStatus;
  /** band_state==='connected' */
  connected: boolean;
}

/** 접촉: 한쪽이라도 leadoff → lead_off, 둘 다 contact → ok, 그 외(미보고 포함)는 unknown — ok 로 승격하지 않는다. */
export function toNativeDevice(s: MeasurementSnapshot): NativeDeviceState {
  const m = s.metrics;
  const c = m?.contact;
  let deviceStatus: DeviceStatus = 'unknown';
  if (c) {
    if (c.fp1 === 'leadoff' || c.fp2 === 'leadoff') deviceStatus = 'lead_off';
    else if (c.fp1 === 'contact' && c.fp2 === 'contact') deviceStatus = 'ok';
  }
  return {
    signalQualityLevel: signalQualityLevel(m?.sqi ?? null),
    deviceStatus,
    connected: s.collection?.band_state === 'connected',
  };
}

/**
 * 네이티브가 밴드를 소유 중인가: 앱 네이티브 경로에서 시작 중·실행 중이거나 snapshot 을 한 번이라도 받았으면 true.
 * 이때 JS BLE(useBand)는 놓인 상태라 '연결 끊김' 판정·재연결 버튼에 쓰면 안 된다.
 */
export function isNativeBandOwned(path: string, status: string, device: NativeDeviceState | null): boolean {
  return path === 'native' && (device !== null || status === 'starting' || status === 'running');
}

/**
 * 네이티브 시작 실패 사유를 기기 시트 오류줄용 문구로 바꾼다(순수). 정상·대기 중이면 null.
 * 이전에는 사유가 화면에 안 올라와 '연결하는 중'에서 멈춘 것처럼 보였다.
 */
export function describeNativeStartFailure(path: string, status: string, code: string | null): string | null {
  if (path !== 'native' || status !== 'failed' || !code) return null;
  const known: Record<string, string> = {
    already_active: '이전 측정이 아직 정리되지 않았어요. 앱을 다시 열어 주세요.',
    js_band_release_failed: '밴드 연결을 앱 측정으로 넘기지 못했어요.',
    credentials_unavailable: '로그인 정보를 읽지 못했어요. 다시 로그인해 주세요.',
    native_ownership_disabled: '이 기기에서는 앱 측정이 꺼져 있어요.',
  };
  return `측정을 시작하지 못했어요 (${known[code] ?? code})`;
}
