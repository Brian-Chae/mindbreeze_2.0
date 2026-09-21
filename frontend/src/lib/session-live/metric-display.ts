/**
 * SDD-083 — 내담자 상태 카드/테이블 공용 표시 유틸
 *
 * SessionMonitorTable 의 행 판정 로직과 동일 규칙을 카드 그리드에서 재사용한다.
 * (밴드 미사용: last_eeg_at 없음 + band_connected false → 단절이 아니라 "미사용")
 */

import type { SessionLiveMetric } from '../api/session';
import type { MonitorSummaryCounts } from '../../components/session/SessionMonitorSummary';
import { isEegStale, isLowBattery } from './signal-status';

/** null/undefined 지표 값을 '-'로 표시. 0은 유효값 */
export function formatMetric(
  value: number | null | undefined,
  suffix = '',
): string {
  if (value === null || value === undefined) return '-';
  return `${Math.round(value)}${suffix}`;
}

/** 연결실패 판정 — 밴드 미사용(이력 없음)은 실패로 치지 않음 */
export function isConnectionFailed(row: SessionLiveMetric): boolean {
  if (row.device_status === 'disconnected') return true;
  if (row.last_eeg_at == null && !row.band_connected) return false;
  if (!row.band_connected) return true;
  return isEegStale(row.last_eeg_at);
}

/** 실시간 수신 중 판정 — EEG 이력이 있고 stale하지 않은 참가자 (관제 상태 바 집계용) */
export function isStreamingLive(row: SessionLiveMetric): boolean {
  return (
    Boolean(row.band_connected) &&
    row.last_eeg_at != null &&
    !isEegStale(row.last_eeg_at)
  );
}

/** 카드 표시용 밴드 상태 — 연결됨 / 끊김(전송중단 포함) / 미사용 */
export type BandCardState = 'connected' | 'disconnected' | 'none';

export function bandCardState(row: SessionLiveMetric): BandCardState {
  if (row.last_eeg_at == null && !row.band_connected) return 'none';
  if (isConnectionFailed(row)) return 'disconnected';
  return 'connected';
}

export function bandCardStateLabel(state: BandCardState): string {
  if (state === 'connected') return '밴드 연결됨';
  if (state === 'disconnected') return '밴드 끊김';
  return '밴드 미사용';
}

/** DashboardBox 필터와 행 매칭 (테이블과 동일 규칙) */
export function matchesMonitorFilter(
  row: SessionLiveMetric,
  filter: keyof MonitorSummaryCounts | null,
): boolean {
  if (!filter || filter === 'participants') return true;
  if (filter === 'leadOff') return row.device_status === 'lead_off';
  if (filter === 'connectionFailed') return isConnectionFailed(row);
  if (filter === 'lowBattery') return isLowBattery(row.band_battery);
  return true;
}

/** 현재 지표(두뇌휴식도·BPM·호흡수) 표시 가능 여부 — 접촉 OK + 최신 EEG */
export function canShowCurrentMetrics(row: SessionLiveMetric): boolean {
  return row.device_status === 'ok' && !isEegStale(row.last_eeg_at);
}

/** 카드/상세 공용 — 상태 변화 시계열 1포인트 */
export interface ParticipantHistoryPoint {
  /** epoch ms */
  t: number;
  efficiency: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
}
