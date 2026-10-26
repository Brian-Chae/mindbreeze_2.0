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
