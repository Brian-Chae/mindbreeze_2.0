// SDD-022 — 리포트 content.eeg 계약 + UI 매핑 어댑터
// UI 기대(summary/insights/markers/eeg_summary/eeg_timeline)와
// 생성기 산출(content.eeg)을 단일 뷰 모델로 통일한다.

/** reports.ts 와 동일 — 순환 import 방지용 로컬 별칭 */
export type ReportViewType = 'counselor' | 'client';

/** 품질 게이트 4상태 + LINK BAND 미측정 */
export type EegQualityStatus =
  | 'valid'
  | 'degraded'
  | 'invalid'
  | 'insufficient'
  | 'not_measured';

/** 하루밴드 7지표 키 (순서 고정) */
export const EEG_METRIC_KEYS = [
  'focus_index_stability_score',
  'total_neural_activity_score',
  'cognitive_load_stability_score',
  'stress_score',
  'hemispheric_balance_score',
  'emotional_stability_score',
  'relaxation_score',
] as const;

export type EegMetricKey = (typeof EEG_METRIC_KEYS)[number];

/** 내담자용 쉬운 라벨 (두뇌휴식도 = relaxation_score) */
export const CLIENT_METRIC_LABELS: Record<EegMetricKey, string> = {
  focus_index_stability_score: '집중 안정',
  total_neural_activity_score: '뇌 활동량',
  cognitive_load_stability_score: '인지 부하 안정',
  stress_score: '스트레스',
  hemispheric_balance_score: '좌우 균형',
  emotional_stability_score: '정서 안정',
  relaxation_score: '두뇌휴식도',
};

/** 상담사용 라벨 */
export const COUNSELOR_METRIC_LABELS: Record<EegMetricKey, string> = {
  focus_index_stability_score: 'Focus stability',
  total_neural_activity_score: 'Neural activity',
  cognitive_load_stability_score: 'Cognitive load stability',
  stress_score: 'Stress',
  hemispheric_balance_score: 'Hemispheric balance',
  emotional_stability_score: 'Emotional stability',
  relaxation_score: 'Relaxation',
};

/** 내담자 기본 노출 상위 지표 (나머지 접힘) */
export const CLIENT_PRIMARY_METRIC_KEYS: readonly EegMetricKey[] = [
  'relaxation_score',
  'focus_index_stability_score',
  'stress_score',
  'emotional_stability_score',
];

export interface EegTimelinePoint {
  /** X축(분) — Recharts 기존 dataKey `min` 계약 유지 */
  min: number;
  concentration: number | null;
  relaxation: number | null;
  stress: number | null;
}

export interface ReportEegContent {
  status: EegQualityStatus;
  reliability: number | null;
  drowsiness_flag: boolean;
  /** 종합점수. null 보존 — 0으로 채우지 않음 */
  score: number | null;
  metrics: Record<EegMetricKey, number | null>;
  summary_labels: Partial<Record<EegMetricKey, string>>;
  timeline: EegTimelinePoint[];
  normalization_version: string | null;
}

export interface ReportMarker {
  label: string;
  value: string | number;
}

/**
 * UI가 소비하는 단일 매핑 결과.
 * eeg_summary / eeg_timeline은 레거시 필드명과의 호환 뷰.
 */
export interface AdaptedReportContent {
  summary: string | null;
  insights: string[];
  markers: ReportMarker[];
  headline: string | null;
  /** Cover 종합점수 — valid/degraded만 노출, 그 외 null */
  coverScore: number | null;
  /** Cover 사유 칩 문구 (invalid/insufficient/degraded) */
  coverReasonChip: string | null;
  eeg: ReportEegContent | null;
  /** not_measured 또는 EEG 없음 → DOM 미노출 */
  showEegSection: boolean;
  /** valid/degraded만 지표·타임라인 표시 */
  showEegMetrics: boolean;
  showEegTimeline: boolean;
  /** 평탄 뷰: 7지표 (null 유지) */
  eeg_summary: Partial<Record<EegMetricKey, number | null>> | null;
  eeg_timeline: EegTimelinePoint[];
}

const QUALITY_STATUSES: readonly EegQualityStatus[] = [
  'valid',
  'degraded',
  'invalid',
  'insufficient',
  'not_measured',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** null 보존 — falsy를 0으로 바꾸지 않음 */
function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  return value;
}

function asQualityStatus(value: unknown): EegQualityStatus | null {
  if (typeof value !== 'string') return null;
  return QUALITY_STATUSES.includes(value as EegQualityStatus)
    ? (value as EegQualityStatus)
    : null;
}

/** 0~1 비율이면 0~100으로, 이미 퍼센트면 그대로 */
function toDisplayScale(value: number | null): number | null {
  if (value === null) return null;
  if (value >= 0 && value <= 1) {
    return Math.round(value * 1000) / 10;
  }
  return value;
}

function emptyMetrics(): Record<EegMetricKey, number | null> {
  return {
    focus_index_stability_score: null,
    total_neural_activity_score: null,
    cognitive_load_stability_score: null,
    stress_score: null,
    hemispheric_balance_score: null,
    emotional_stability_score: null,
    relaxation_score: null,
  };
}

function parseMetrics(raw: unknown): Record<EegMetricKey, number | null> {
  const metrics = emptyMetrics();
  if (!isRecord(raw)) return metrics;
  for (const key of EEG_METRIC_KEYS) {
    metrics[key] = asNullableNumber(raw[key]);
  }
  return metrics;
}

function parseSummaryLabels(raw: unknown): Partial<Record<EegMetricKey, string>> {
  if (!isRecord(raw)) return {};
  const labels: Partial<Record<EegMetricKey, string>> = {};
  for (const key of EEG_METRIC_KEYS) {
    const label = asString(raw[key]);
    if (label) labels[key] = label;
  }
  return labels;
}

function parseTimeline(raw: unknown): EegTimelinePoint[] {
  if (!Array.isArray(raw)) return [];
  const points: EegTimelinePoint[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const t = asNullableNumber(item.t);
    const minLegacy = asNullableNumber(item.min);
    const x = t ?? minLegacy;
    if (x === null) continue;
    points.push({
      min: x,
      concentration: toDisplayScale(asNullableNumber(item.concentration)),
      relaxation: toDisplayScale(asNullableNumber(item.relaxation)),
      stress: toDisplayScale(asNullableNumber(item.stress)),
    });
  }
  return points;
}

function parseMarkers(raw: unknown): ReportMarker[] {
  if (!Array.isArray(raw)) return [];
  const markers: ReportMarker[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const label = asString(item.label);
    if (!label) continue;
    const value = item.value;
    if (typeof value === 'string' || typeof value === 'number') {
      markers.push({ label, value });
    }
  }
  return markers;
}

function parseInsights(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

function coverReasonForStatus(status: EegQualityStatus): string | null {
  switch (status) {
    case 'degraded':
      return '측정 품질 주의';
    case 'invalid':
      return '품질 미달 · 점수 미제공';
    case 'insufficient':
      return '데이터 부족 · 점수 미제공';
    default:
      return null;
  }
}

/** content.eeg 블록 파싱. 없거나 not_measured면 null */
function parseEegBlock(raw: unknown): ReportEegContent | null {
  if (!isRecord(raw)) return null;

  const status = asQualityStatus(raw.status) ?? 'not_measured';
  if (status === 'not_measured') return null;

  return {
    status,
    reliability: asNullableNumber(raw.reliability),
    drowsiness_flag: asBoolean(raw.drowsiness_flag, false),
    score: asNullableNumber(raw.score),
    metrics: parseMetrics(raw.metrics),
    summary_labels: parseSummaryLabels(raw.summary_labels),
    timeline: parseTimeline(raw.timeline),
    normalization_version: asString(raw.normalization_version),
  };
}

/**
 * 레거시 eeg_summary / eeg_timeline → content.eeg 동등 뷰.
 * 품질 필드가 없으면 valid로 간주(기존 노출 회귀 방지).
 */
function parseLegacyEeg(
  content: Record<string, unknown>,
): ReportEegContent | null {
  const summaryRaw = content.eeg_summary;
  const timeline = parseTimeline(content.eeg_timeline);
  const hasSummary = isRecord(summaryRaw) && Object.keys(summaryRaw).length > 0;
  if (!hasSummary && timeline.length === 0) return null;

  const metrics = emptyMetrics();
  let score: number | null = null;
  if (isRecord(summaryRaw)) {
    for (const key of EEG_METRIC_KEYS) {
      if (key in summaryRaw) {
        metrics[key] = asNullableNumber(summaryRaw[key]);
      }
    }
    // 레거시 요약에 채널명이 있을 수 있음 — 타임라인만 있으면 점수 없음
    score = asNullableNumber(summaryRaw.score);
  }

  return {
    status: 'valid',
    reliability: null,
    drowsiness_flag: false,
    score,
    metrics,
    summary_labels: {},
    timeline,
    normalization_version: null,
  };
}

/**
 * 리포트 content → UI 단일 뷰.
 * @param reportType counselor=전체 지표, client=쉬운 라벨/상위 지표(컴포넌트에서 소비)
 */
export function adaptReportContent(
  content: Record<string, unknown> | null | undefined,
  _reportType: ReportViewType = 'counselor',
): AdaptedReportContent {
  void _reportType; // 라벨/접힘 비대칭은 컴포넌트에서 reportType으로 처리

  if (!content) {
    return {
      summary: null,
      insights: [],
      markers: [],
      headline: null,
      coverScore: null,
      coverReasonChip: null,
      eeg: null,
      showEegSection: false,
      showEegMetrics: false,
      showEegTimeline: false,
      eeg_summary: null,
      eeg_timeline: [],
    };
  }

  const eeg = parseEegBlock(content.eeg) ?? parseLegacyEeg(content);
  const showEegSection = eeg !== null;
  const showEegMetrics =
    eeg !== null && (eeg.status === 'valid' || eeg.status === 'degraded');
  const showEegTimeline = showEegMetrics && eeg.timeline.length > 0;

  // invalid/insufficient/not_measured에서는 종합점수를 0으로 채우지 않음
  let coverScore: number | null = null;
  if (eeg && (eeg.status === 'valid' || eeg.status === 'degraded')) {
    coverScore = eeg.score;
  } else if (!eeg) {
    // EEG 없음(미착용) — 레거시 상담 점수만 허용
    coverScore = asNullableNumber(content.score);
  }

  const eeg_summary: Partial<Record<EegMetricKey, number | null>> | null = eeg
    ? { ...eeg.metrics }
    : null;

  return {
    summary: asString(content.summary),
    insights: parseInsights(content.insights),
    markers: parseMarkers(content.markers),
    headline: asString(content.headline),
    coverScore,
    coverReasonChip: eeg ? coverReasonForStatus(eeg.status) : null,
    eeg,
    showEegSection,
    showEegMetrics,
    showEegTimeline,
    eeg_summary,
    eeg_timeline: eeg?.timeline ?? [],
  };
}

/** 지표 표시 라벨 해석 (summary_labels 우선 → 역할 기본값) */
export function resolveMetricLabel(
  key: EegMetricKey,
  reportType: ReportViewType,
  summaryLabels?: Partial<Record<EegMetricKey, string>>,
): string {
  const fromContent = summaryLabels?.[key];
  if (fromContent) return fromContent;
  return reportType === 'client'
    ? CLIENT_METRIC_LABELS[key]
    : COUNSELOR_METRIC_LABELS[key];
}

/** reliability 수치 → 내담자용 짧은 카피 */
export function reliabilityLabel(reliability: number | null): string | null {
  if (reliability === null) return null;
  if (reliability >= 0.7) return '측정 신뢰도 높음';
  if (reliability >= 0.3) return '측정 신뢰도 보통';
  return '측정 신뢰도 낮음';
}
