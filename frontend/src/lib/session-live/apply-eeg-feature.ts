/**
 * SDD-028 T6 — WS eeg_feature 증분 반영
 *
 * 전체 metrics를 재계산하지 않고 해당 participant 행만 갱신한다.
 * 값이 실질적으로 동일하면 기존 배열 참조를 그대로 반환해 불필요 재렌더를 막는다.
 */

import type { SessionLiveMetric } from '../api/session';
import type { SessionLiveEegFeatureEvent } from '../socket';
import {
  normalizeSignalQuality01,
  signalQualityLevel,
} from './signal-status';

/** 증분 패치 결과 — 변경 없으면 same=true 로 호출측이 setState 스킵 가능 */
export interface ApplyEegFeatureResult {
  rows: SessionLiveMetric[];
  /** true면 rows === 입력 배열 (참조 동일) */
  unchanged: boolean;
}

/** 두 행의 라이브 표시 필드가 같은지 (참조 안정성용) */
function liveFieldsEqual(a: SessionLiveMetric, b: SessionLiveMetric): boolean {
  return (
    a.band_connected === b.band_connected &&
    a.device_status === b.device_status &&
    a.band_battery === b.band_battery &&
    a.current_efficiency === b.current_efficiency &&
    a.upload_status === b.upload_status &&
    a.last_eeg_at === b.last_eeg_at &&
    a.signal_quality === b.signal_quality &&
    a.signal_quality_level === b.signal_quality_level &&
    a.heart_rate === b.heart_rate &&
    a.respiratory_rate === b.respiratory_rate
  );
}

/**
 * eeg_feature 이벤트 → 해당 참가자 행만 증분 패치.
 * 다른 행 객체 참조는 유지한다.
 */
export function applyEegFeatureToMetrics(
  rows: SessionLiveMetric[],
  event: SessionLiveEegFeatureEvent,
): SessionLiveMetric[] {
  return applyEegFeatureToMetricsDetailed(rows, event).rows;
}

/**
 * 증분 패치 + unchanged 플래그.
 * setState(prev => ...) 안에서 unchanged면 prev를 그대로 돌려 리렌더를 억제한다.
 */
export function applyEegFeatureToMetricsDetailed(
  rows: SessionLiveMetric[],
  event: SessionLiveEegFeatureEvent,
): ApplyEegFeatureResult {
  const feature = event.feature;
  const efficiency =
    event.current_efficiency ??
    event.relaxation_index ??
    feature?.relaxation_index ??
    null;
  const sq01 = normalizeSignalQuality01(
    event.signal_quality ?? feature?.signal_quality ?? null,
  );
  const sqLevel = event.signal_quality_level ?? signalQualityLevel(sq01);
  // device_status는 접촉(LeadOff). SQI로 ok/lead_off 추정 금지.
  const contactStatus = event.device_status ?? null;
  const lastAt =
    event.last_eeg_at ??
    (feature?.timestamp != null
      ? new Date(feature.timestamp).toISOString()
      : new Date().toISOString());
  /** 과거 feature(재전송분)로 행의 last_eeg_at이 되돌아가 false stale이 되지 않게 최신만 취한다 */
  const newerLastAt = (rowAt: string | null | undefined): string => {
    const rowMs = rowAt ? new Date(rowAt).getTime() : Number.NaN;
    const nextMs = new Date(lastAt).getTime();
    if (!Number.isFinite(nextMs)) return rowAt ?? lastAt;
    if (!Number.isFinite(rowMs)) return lastAt;
    return nextMs >= rowMs ? lastAt : (rowAt as string);
  };
  const bandConnected = event.band_connected ?? true;
  const heartRate =
    event.feature?.heart_rate ?? null;
  const respiratoryRate =
    event.feature?.respiratory_rate ?? null;

  let found = false;
  let changed = false;
  const next = rows.map((row) => {
    if (row.participant_id !== event.participant_id) return row;
    found = true;
    const patched: SessionLiveMetric = {
      ...row,
      band_connected: bandConnected,
      device_status: contactStatus ?? row.device_status,
      band_battery: event.band_battery ?? row.band_battery,
      current_efficiency:
        typeof efficiency === 'number' ? efficiency : row.current_efficiency,
      upload_status: event.upload_status ?? 'streaming',
      last_eeg_at: newerLastAt(row.last_eeg_at),
      signal_quality: sq01 ?? row.signal_quality ?? null,
      signal_quality_level: sqLevel,
      heart_rate:
        typeof heartRate === 'number' ? heartRate : row.heart_rate ?? null,
      respiratory_rate:
        typeof respiratoryRate === 'number'
          ? respiratoryRate
          : row.respiratory_rate ?? null,
    };
    if (liveFieldsEqual(row, patched)) return row;
    changed = true;
    return patched;
  });

  if (!found && event.participant_id) {
    next.push({
      participant_id: event.participant_id,
      display_name: '참가자',
      is_guest: false,
      band_connected: bandConnected,
      // unknown을 ok로 승격하지 않음
      device_status: contactStatus ?? 'unknown',
      band_battery: event.band_battery ?? null,
      avg_efficiency: null,
      current_efficiency: typeof efficiency === 'number' ? efficiency : null,
      upload_status: event.upload_status ?? 'streaming',
      last_eeg_at: lastAt,
      signal_quality: sq01,
      signal_quality_level: sqLevel,
      heart_rate: typeof heartRate === 'number' ? heartRate : null,
      respiratory_rate:
        typeof respiratoryRate === 'number' ? respiratoryRate : null,
    });
    return { rows: next, unchanged: false };
  }

  if (!changed) {
    return { rows, unchanged: true };
  }
  return { rows: next, unchanged: false };
}
