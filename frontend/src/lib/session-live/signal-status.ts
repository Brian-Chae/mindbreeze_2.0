/**
 * SDD-026 — LeadOff(접촉) / SQI(신호품질) 분리 + 서버 임계 정합
 *
 * 서버 계약: valid≥0.7, degraded≥0.4, else invalid.
 * unknown/null 을 ok·valid 로 승격하지 않는다.
 */

import type { DeviceStatus } from '../api/session';
import type { LeadOffStatus } from '../eeg/types/eeg';

/** 서버와 동일 임계 (signal_quality 0~1) */
export const SIGNAL_QUALITY_VALID = 0.7;
export const SIGNAL_QUALITY_DEGRADED = 0.4;

/** last_eeg_at 기준 BLE/전송 단절 판정 (ms) */
export const EEG_STALE_MS = 10_000;

export type SignalQualityLevel = 'ok' | 'degraded' | 'invalid' | 'unknown';

/** SDK SQI(0~100) → API signal_quality(0~1) */
export function toApiSignalQuality(sqi0to100: number): number {
  return Math.min(1, Math.max(0, sqi0to100 / 100));
}

/** 0~1 또는 0~100 입력을 0~1로 정규화. null은 null 유지 */
export function normalizeSignalQuality01(
  value: number | null | undefined,
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value > 1 ? Math.min(1, value / 100) : Math.min(1, Math.max(0, value));
}

/**
 * SQI → 품질 레벨. null/unknown은 'unknown' (ok 승격 금지).
 */
export function signalQualityLevel(
  signalQuality01: number | null | undefined,
): SignalQualityLevel {
  const sq = normalizeSignalQuality01(signalQuality01 ?? null);
  if (sq == null) return 'unknown';
  if (sq >= SIGNAL_QUALITY_VALID) return 'ok';
  if (sq >= SIGNAL_QUALITY_DEGRADED) return 'degraded';
  return 'invalid';
}

export function signalQualityLevelLabel(level: SignalQualityLevel): string {
  if (level === 'ok') return '양호';
  if (level === 'degraded') return '저하';
  if (level === 'invalid') return '불량';
  return '미확인';
}

/**
 * 하드웨어 LeadOff → device_status(접촉).
 * LeadOff 미수신 시 unknown — SQI로 추정하지 않음.
 */
export function deviceStatusFromLeadOff(
  connected: boolean,
  leadOff: LeadOffStatus | null,
): DeviceStatus {
  if (!connected) return 'disconnected';
  if (leadOff == null) return 'unknown';
  if (leadOff.ch1 || leadOff.ch2) return 'lead_off';
  return 'ok';
}

/** 접촉 라벨 — unknown을 정상으로 표시하지 않음 */
export function contactStatusLabel(status: DeviceStatus | null | undefined): string {
  if (status === 'ok') return '정상';
  if (status === 'lead_off') return '불량';
  if (status === 'disconnected') return '끊김';
  if (status === 'unsupported') return '미지원';
  if (status === 'unknown') return '미확인';
  return '—';
}

/**
 * last_eeg_at staleness로 BLE 단절/전송중단 여부.
 * connected 플래그가 true여도 최근 EEG가 없으면 stale.
 */
/**
 * last_eeg_at staleness.
 * null은 "미사용"이지 단절이 아님 — 호출측에서 band_connected와 함께 해석한다.
 * 여기서 null이면 false(staleness 판정 불가)를 반환한다.
 */
export function isEegStale(
  lastEegAt: string | number | null | undefined,
  nowMs: number = Date.now(),
  staleMs: number = EEG_STALE_MS,
): boolean {
  if (lastEegAt == null) return false;
  const ts =
    typeof lastEegAt === 'number' ? lastEegAt : new Date(lastEegAt).getTime();
  if (Number.isNaN(ts)) return false;
  return nowMs - ts > staleMs;
}

/**
 * UI용 연결 표시: BLE 연결 + 최근 EEG.
 * - 미연결 → disconnected
 * - 연결됐지만 last_eeg_at이 오래됨 → stale
 * - 첫 샘플 전(null)은 connected로 대기
 */
export function resolveBandLinkState(params: {
  bleConnected: boolean;
  lastEegAt: string | number | null | undefined;
  nowMs?: number;
}): 'connected' | 'disconnected' | 'stale' {
  if (!params.bleConnected) return 'disconnected';
  if (params.lastEegAt == null) return 'connected';
  if (isEegStale(params.lastEegAt, params.nowMs)) return 'stale';
  return 'connected';
}
