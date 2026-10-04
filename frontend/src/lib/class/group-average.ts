// SDD-124: 절대 그룹 평균(회원 노출용) — `class:group_average` 계약 + 표시 정규화.
//
// 백엔드 `group_aggregate.compute_group_average` 가 밴드 착용자들의 최근 구간 절대 평균을
// 익명 집계해 공용 룸으로 내려준다. payload 에 개인 식별자·개인 점수·순위는 없다.
//
// 스케일 원칙:
//   마음 지표(focus/relaxation/emotional)는 백엔드가 raw(0~1)로 내려주고,
//   프론트가 자기값과 동일한 `scoreIndices` 로 정규화한다(정규화 함수 단일화 → 비교 정합).
//   몸 지표(bpm/호흡/HRV)는 절대값 그대로 쓴다. HRV 는 회원 기준 `sdnn`.

import { scoreIndices } from '../eeg/eegPersonalScore';

/** WS 이벤트명 — 백엔드 `/session-live` 네임스페이스와 동일 계약 */
export const GROUP_AVERAGE_EVENT = 'class:group_average';

export type GroupAverageSampleStatus = 'ok' | 'insufficient';

export interface GroupAverageMetric {
  /** 절대 평균. 표본 부족·산출 불가면 null */
  mean: number | null;
}

export interface GroupAverageMetrics {
  focus_index: GroupAverageMetric;
  relaxation_index: GroupAverageMetric;
  emotional_stability: GroupAverageMetric;
  heart_rate: GroupAverageMetric;
  respiratory_rate: GroupAverageMetric;
  sdnn: GroupAverageMetric;
}

export interface GroupAverageEvent {
  session_id?: string;
  at?: string | null;
  wearer_count: number;
  min_wearers: number;
  sample_status: GroupAverageSampleStatus;
  metrics: GroupAverageMetrics;
}

const SAMPLE_STATUSES: readonly GroupAverageSampleStatus[] = ['ok', 'insufficient'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asMetric = (value: unknown): GroupAverageMetric => {
  if (!isRecord(value)) return { mean: null };
  const mean = typeof value.mean === 'number' && Number.isFinite(value.mean) ? value.mean : null;
  return { mean };
};

/** 서버 payload 검증 — 미정의 값은 계약 밖이므로 조용히 무시 */
export function isGroupAverageEvent(value: unknown): value is GroupAverageEvent {
  if (!isRecord(value)) return false;
  if (typeof value.sample_status !== 'string') return false;
  if (!(SAMPLE_STATUSES as readonly string[]).includes(value.sample_status)) return false;
  if (!isRecord(value.metrics)) return false;
  return typeof value.wearer_count === 'number';
}

/** 수신 payload 정규화 — 누락 필드는 null 로 접는다(크래시 금지) */
export function normalizeGroupAverage(raw: unknown): GroupAverageEvent | null {
  if (!isGroupAverageEvent(raw)) return null;
  const record = raw as unknown as Record<string, unknown>;
  const metrics = record.metrics as Record<string, unknown>;
  return {
    session_id: typeof record.session_id === 'string' ? record.session_id : undefined,
    at: typeof record.at === 'string' ? record.at : null,
    wearer_count: Math.max(0, Math.trunc(raw.wearer_count)),
    min_wearers:
      typeof record.min_wearers === 'number' && record.min_wearers > 0 ? record.min_wearers : 3,
    sample_status: raw.sample_status,
    metrics: {
      focus_index: asMetric(metrics.focus_index),
      relaxation_index: asMetric(metrics.relaxation_index),
      emotional_stability: asMetric(metrics.emotional_stability),
      heart_rate: asMetric(metrics.heart_rate),
      respiratory_rate: asMetric(metrics.respiratory_rate),
      sdnn: asMetric(metrics.sdnn),
    },
  };
}

/** 회원 지표 6종의 그룹 평균(표시 스케일) — 마음 0~100, 몸 절대값. 산출 불가면 null */
export interface GroupAverageDisplay {
  focus: number | null;
  relaxation: number | null;
  emotional: number | null;
  bpm: number | null;
  respiration: number | null;
  hrv: number | null;
}

/** 표본이 충분한가 — 서버 판정 + 착용자 수 교차 확인 */
export function isGroupAverageSufficient(event: GroupAverageEvent): boolean {
  return event.sample_status === 'ok' && event.wearer_count >= event.min_wearers;
}

/** 표시용 그룹 평균으로 변환 — 마음 raw(0~1) → 자기값과 동일한 scoreIndices(0~100) */
export function toDisplayGroupAverage(event: GroupAverageEvent): GroupAverageDisplay {
  const m = event.metrics;
  const sufficient = isGroupAverageSufficient(event);

  const focusMean = m.focus_index.mean;
  const relaxationMean = m.relaxation_index.mean;
  const emotionalMean = m.emotional_stability.mean;

  const mind = scoreIndices({
    focusIndex: focusMean ?? undefined,
    relaxationIndex: relaxationMean ?? undefined,
    emotionalStability: emotionalMean ?? undefined,
  });

  return {
    focus: sufficient && focusMean != null ? mind.focusIndex : null,
    relaxation: sufficient && relaxationMean != null ? mind.relaxationIndex : null,
    emotional: sufficient && emotionalMean != null ? mind.emotionalStability : null,
    bpm: sufficient && m.heart_rate.mean != null ? m.heart_rate.mean : null,
    respiration: sufficient && m.respiratory_rate.mean != null ? m.respiratory_rate.mean : null,
    hrv: sufficient && m.sdnn.mean != null ? m.sdnn.mean : null,
  };
}
