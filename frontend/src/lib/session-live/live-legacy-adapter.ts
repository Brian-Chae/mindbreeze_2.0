// SDD-246 T06 — LiveState → 기존 호스트 화면 모델(SessionLiveMetric) 변환.
// 기존 컴포넌트(host-live-model, 테이블/카드)를 그대로 쓰되, 지표·손·장치 값의 출처를 LiveState 하나로 고정한다.
// legacy(rich participant) 는 신원 필드(live-view 의 allowlist)만 참조한다.
import type { DeviceStatus, SessionLiveMetric } from '../api/session';
import type { LiveState } from './live-state';
import { buildMemberRows, type LegacyIdentity, type MemberRow } from './live-view';

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
      band_connected: row.freshness !== 'none',
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

// ── 페이지 보조 모델 (v2 단일 출처에서 파생) ─────────────────────────────

import type { SessionStatus } from '../api/session';
import type { WaitingRoomEntry } from '../../hooks/useWaitingRoomCount';

/** LiveState.session.phase → 기존 화면이 쓰는 SessionStatus. 아직 snapshot 이 없으면 null. */
export function sessionStatusOf(state: LiveState | null): SessionStatus | null {
  const phase = state?.session?.data.phase;
  switch (phase) {
    case 'scheduled': return 'scheduled';
    case 'open':
    case 'waiting': return 'open';
    case 'in_progress': return 'in_progress';
    case 'ended': return 'completed';
    case 'cancelled': return 'cancelled';
    default: return null;
  }
}

/** 대기실 항목 — waiting 도메인 + 신원(legacy allowlist). 준비 완료 여부만 쓰고 점수/원시값은 없다. */
export function toWaitingEntries(state: LiveState, legacy: readonly LegacyIdentity[] = []): WaitingRoomEntry[] {
  const byId = new Map(legacy.map((p) => [p.participant_id, p]));
  const out: WaitingRoomEntry[] = [];
  for (const [pid, v] of Object.entries(state.waiting)) {
    if (state.removed[pid] !== undefined) continue;
    const part = state.participation[pid]?.data;
    if (part && (part.attendance === 'left' || part.attendance === 'removed')) continue;
    const name = (byId.get(pid) as { display_name?: unknown } | undefined)?.display_name;
    const done = v.data.ready;
    out.push({
      participantId: pid,
      nickname: typeof name === 'string' ? name : null,
      checkin: null,
      readiness: { surveyDone: done, bandDone: done, deviceDone: done },
    });
  }
  return out.sort((a, b) => a.participantId.localeCompare(b.participantId));
}

/** 무음 신호 — 만료 전 신호만, 참여자별 최신 1건. */
export function activeSignals(state: LiveState, nowMs: number): Array<{ participantId: string; type: 'following' | 'difficult' | 'resting'; expiresAtMs: number }> {
  return Object.entries(state.signal)
    .filter(([pid, v]) => state.removed[pid] === undefined && v.data.expires_at_ms > nowMs)
    .map(([pid, v]) => ({ participantId: pid, type: v.data.signal_type, expiresAtMs: v.data.expires_at_ms }));
}
