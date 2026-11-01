// SDD-265: 전송 현황(진행) 와이어 → 화면용 형태 변환. 계약 필드명 변경은 이 파일과 upload-overview.ts/upload-status.ts 의 정규화만 고친다.
// 계약: specs/sdd-264-upload-progress-expected/contract.md §2~§3, specs/sdd-265-upload-status-redesign/contract.md
export type PersonProgressState = 'all_received' | 'in_progress' | 'needs_attention' | 'expected_unknown' | 'not_collected';
const STATES: readonly PersonProgressState[] = ['all_received', 'in_progress', 'needs_attention', 'expected_unknown', 'not_collected'];

export interface ProgressRatio { expected: number | null; received: number; percent: number | null }
export interface PersonProgress {
  state: PersonProgressState;
  feature: ProgressRatio;
  raw: { eeg: ProgressRatio; ppg: ProgressRatio; acc: ProgressRatio };
  total: ProgressRatio;
}
export interface ProgressParticipants {
  total: number; counted: number; all_received: number; in_progress: number; needs_attention: number; expected_unknown: number; not_collected: number;
}
export interface SessionProgress {
  participants: ProgressParticipants;
  feature: ProgressRatio;
  raw: { eeg: ProgressRatio; ppg: ProgressRatio; acc: ProgressRatio };
  overall: ProgressRatio;
}

/** 크기·길이 가산 필드(회차 단위). 모르면 null. */
export interface SessionMetrics {
  /** 수집 대상 인원(participants − excluded)과 그중 서버에 1건 이상 도착한 인원. */
  participants_expected: number | null;
  participants_arrived: number | null;
  /** 참여자 한 명 기준 화면(참여자 행)에서는 본인 측정 길이(measured_min). */
  measured_min: number | null;
  bytes_arrived: number | null;
  bytes_expected: number | null;
  duration_min: number | null;
  participant_minutes_total: number | null;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const emptyRatio = (): ProgressRatio => ({ expected: null, received: 0, percent: null });
export function normalizeRatio(raw: unknown): ProgressRatio {
  const r = rec(raw);
  return { expected: numOrNull(r.expected), received: num(r.received), percent: numOrNull(r.percent) };
}
const normalizeRaw = (raw: unknown) => { const r = rec(raw); return { eeg: normalizeRatio(r.eeg), ppg: normalizeRatio(r.ppg), acc: normalizeRatio(r.acc) }; };

/** 참여자별 progress. 블록이 없으면(구 서버) null — 화면은 '집계 대기'로 후퇴한다. */
export function normalizePersonProgress(raw: unknown): PersonProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = rec(raw);
  const state = STATES.find((s) => s === r.state);
  if (!state) return null;
  return { state, feature: normalizeRatio(r.feature), raw: normalizeRaw(r.raw), total: normalizeRatio(r.total) };
}

export function normalizeSessionProgress(raw: unknown): SessionProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = rec(raw); const p = rec(r.participants);
  return {
    participants: {
      total: num(p.total), counted: num(p.counted), all_received: num(p.all_received), in_progress: num(p.in_progress),
      needs_attention: num(p.needs_attention), expected_unknown: num(p.expected_unknown), not_collected: num(p.not_collected),
    },
    feature: normalizeRatio(r.feature), raw: normalizeRaw(r.raw), overall: normalizeRatio(r.overall),
  };
}

export function normalizeSessionMetrics(raw: unknown): SessionMetrics {
  const r = rec(raw);
  return {
    participants_expected: numOrNull(r.participants_expected), participants_arrived: numOrNull(r.participants_arrived), measured_min: numOrNull(r.measured_min),
    bytes_arrived: numOrNull(r.bytes_arrived), bytes_expected: numOrNull(r.bytes_expected),
    duration_min: numOrNull(r.duration_min), participant_minutes_total: numOrNull(r.participant_minutes_total),
  };
}
