// SDD-246 T06 — LiveState → 기존 호스트 화면 모델(SessionLiveMetric) 변환.
// 기존 컴포넌트(host-live-model, 테이블/카드)를 그대로 쓰되, 지표·손·장치 값의 출처를 LiveState 하나로 고정한다.
// legacy(rich participant) 는 신원 필드(live-view 의 allowlist)만 참조한다.
import type { DeviceStatus, SessionLiveMetric } from '../api/session';
import type { LiveState } from './live-state';
import { buildMemberRows, freshnessOf, type LegacyIdentity, type MemberRow } from './live-view';

export interface LegacyAdapterOptions {
  nowMs: number;
  legacy?: readonly LegacyIdentity[];
}

function deviceStatusOf(row: MemberRow): DeviceStatus {
  // 접촉은 센서의 actual leadoff 만 본다. SQI 로 합성하지 않는다.
  if (row.freshness === 'none' || row.freshness === 'stale' || row.freshness === 'time_uncertain') return 'unknown';
  const c = row.deviceContact;
  if (!c) return 'unknown';
  if (c.fp1 === 'leadoff' || c.fp2 === 'leadoff') return 'lead_off';
  if (c.fp1 === 'contact' && c.fp2 === 'contact') return 'ok';
  return 'unknown';
}

const num = (m: { value: number | null; validity: string } | undefined): number | null =>
  m && m.validity === 'valid' && m.value != null ? m.value : null;

export function toSessionLiveMetrics(state: LiveState, opts: LegacyAdapterOptions): SessionLiveMetric[] {
  return buildMemberRows(state, opts).map((row): SessionLiveMetric => {
    const status = deviceStatusOf(row);
    const usable = row.freshness === 'fresh' || row.freshness === 'delayed';
    const lastEegAt = row.observedAtMs != null ? new Date(row.observedAtMs).toISOString() : null;
    const level = row.sqi == null ? 'unknown' : row.sqi >= 0.7 ? 'ok' : row.sqi >= 0.4 ? 'degraded' : 'invalid';
    return {
      participant_id: row.participantId,
      display_name: row.displayName,
      is_guest: row.isGuest,
      band_connected: row.observedAtMs != null && freshnessOf(row.observedAtMs, opts.nowMs) !== 'none',
      device_status: status,
      band_battery: row.batteryPct,
      avg_efficiency: null,
      current_efficiency: usable ? num(row.metrics.relaxation_display) : null,
      upload_status: null,
      last_eeg_at: lastEegAt,
      signal_quality: row.sqi,
      signal_quality_level: level,
      heart_rate: usable ? num(row.metrics.bpm) : null,
      respiratory_rate: usable ? num(row.metrics.respiration) : null,
      sdnn: usable ? num(row.metrics.sdnn) : null,
      raise_hand: row.handRaised,
      speaking: row.canPublish,
    };
  });
}
