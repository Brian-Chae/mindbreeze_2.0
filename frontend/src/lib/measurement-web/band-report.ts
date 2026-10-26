// SDD-246 T06c — useBand 상태 → live:device 밴드 보고(Device wire 필드). 순수 함수.
// 접촉(contact)은 실제 leadoff 에서만, SQI 는 별도 필드 — SQI 로 접촉을 합성하지 않는다(plan §3.4).
import type { BandReport } from './capture-controller';

export interface BandLike {
  connectionState: 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';
  leadOff: { ch1: boolean; ch2: boolean } | null;
  /** SDK 스케일 0~100 */
  signalQuality: number | null;
  battery: number | null;
}

const BAND_STATE: Record<BandLike['connectionState'], BandReport['band_state']> = {
  connected: 'connected', connecting: 'connecting', disconnected: 'not_worn', unsupported: 'unknown', error: 'lost',
};

export function toBandReport(b: BandLike): BandReport {
  const connected = b.connectionState === 'connected';
  const side = (off: boolean | undefined): 'contact' | 'leadoff' | 'unknown' => (!connected || off === undefined ? 'unknown' : off ? 'leadoff' : 'contact');
  const sqi = connected && b.signalQuality !== null && Number.isFinite(b.signalQuality) ? Math.min(1, Math.max(0, b.signalQuality / 100)) : null;
  const battery = b.battery !== null && Number.isFinite(b.battery) ? Math.min(100, Math.max(0, Math.round(b.battery))) : null;
  return {
    band_state: BAND_STATE[b.connectionState],
    contact: { fp1: side(b.leadOff?.ch1), fp2: side(b.leadOff?.ch2) },
    sqi,
    battery_pct: battery,
    state_reason: b.connectionState === 'error' ? 'ble_error' : null,
  };
}
