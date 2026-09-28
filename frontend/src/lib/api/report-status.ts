/**
 * SDD-027 — 리포트 파이프라인 상태 · data_credibility
 *
 * pending_review = 2.0 상담사 승인 게이트.
 * data_credibility는 quality 게이트에서 파생(서버 값 우선, 없으면 EEG status 매핑).
 */

import type { EegQualityStatus } from './report';
import { apiClient } from './client';

/** ReportStatus 4단계 (snake_case — BE 계약) */
export type ReportPipelineStatus =
  | 'pending_analysis'
  | 'pending_review'
  | 'completed'
  | 'error';

const PIPELINE_STATUSES: readonly ReportPipelineStatus[] = [
  'pending_analysis',
  'pending_review',
  'completed',
  'error',
];

/** UI 표시용 한글 라벨 (SDD-060) */
export const REPORT_STATUS_LABELS: Record<ReportPipelineStatus, string> = {
  pending_analysis: '분석중',
  pending_review: '검토중',
  completed: '승인됨',
  error: '실패',
};

/** data_credibility 표시 문자열(서버 number/string 또는 quality 파생) */
export type DataCredibilityDisplay = {
  /** 원천 값 문자열 */
  value: string;
  /** 짧은 설명 */
  label: string;
};

function isPipelineStatus(value: unknown): value is ReportPipelineStatus {
  return typeof value === 'string' && PIPELINE_STATUSES.includes(value as ReportPipelineStatus);
}

/**
 * 서버 status 우선. 없으면 sent_at 유무로 레거시 폴백.
 * — sent_at 있음 → completed
 * — 없음 → pending_review (승인 게이트 대기)
 */
export function resolveReportStatus(input: {
  status?: string | null;
  sent_at?: string | null;
}): ReportPipelineStatus {
  if (isPipelineStatus(input.status)) return input.status;
  if (input.sent_at) return 'completed';
  return 'pending_review';
}

/** quality 게이트 → data_credibility 라벨 */
export function credibilityFromQuality(
  status: EegQualityStatus | null | undefined,
): DataCredibilityDisplay | null {
  if (!status || status === 'not_measured') return null;
  switch (status) {
    case 'valid':
      return { value: 'high', label: '신뢰도 높음 (valid)' };
    case 'degraded':
      return { value: 'medium', label: '신뢰도 주의 (degraded)' };
    case 'invalid':
      return { value: 'low', label: '신뢰도 낮음 (invalid)' };
    case 'insufficient':
      return { value: 'insufficient', label: '데이터 부족 (insufficient)' };
    default:
      return null;
  }
}

/**
 * 서버 data_credibility 우선, 없으면 EEG quality에서 파생.
 * number는 0~1 또는 0~100 스케일로 표시.
 */
export function resolveDataCredibility(
  dataCredibility: string | number | null | undefined,
  eegStatus: EegQualityStatus | null | undefined,
): DataCredibilityDisplay | null {
  if (typeof dataCredibility === 'number' && !Number.isNaN(dataCredibility)) {
    const pct =
      dataCredibility >= 0 && dataCredibility <= 1
        ? Math.round(dataCredibility * 100)
        : Math.round(dataCredibility);
    return { value: String(dataCredibility), label: `데이터 신뢰도 ${pct}%` };
  }
  if (typeof dataCredibility === 'string' && dataCredibility.trim() !== '') {
    const trimmed = dataCredibility.trim();
    // 서버가 quality status를 그대로 내려준 경우
    const fromQuality = credibilityFromQuality(trimmed as EegQualityStatus);
    if (fromQuality) return fromQuality;
    return { value: trimmed, label: `데이터 신뢰도: ${trimmed}` };
  }
  return credibilityFromQuality(eegStatus);
}

/** 상담사 승인 버튼 노출 여부 — pending_review = 승인 게이트 */
export function canApproveReport(input: {
  status?: string | null;
  sent_at?: string | null;
  alreadyApprovedLocally?: boolean;
}): boolean {
  if (input.alreadyApprovedLocally) return false;
  const status = resolveReportStatus(input);
  return status === 'pending_review';
}

/**
 * SDD-095 — 리포트 '생성 진행' 상태(승인 게이트와 독립 축).
 *
 * 세션 종료 후 STT → 화자분리 → AI 요약 → 리포트 생성이 수 분 걸리므로,
 * 사용자에게 '처리 중'을 명확히 보여주기 위한 진행 축이다.
 *  - pending    미시작
 *  - processing 진행 중
 *  - ready      완료
 *  - partial    일부만 생성(마이크 오프·저신뢰·요약 실패 등)
 */
export type ReportGenerationStatus = 'pending' | 'processing' | 'ready' | 'partial';

const GENERATION_STATUSES: readonly ReportGenerationStatus[] = [
  'pending',
  'processing',
  'ready',
  'partial',
];

export const REPORT_GENERATION_LABELS: Record<ReportGenerationStatus, string> = {
  pending: '준비 중',
  processing: '생성 중',
  ready: '완료',
  partial: '일부 생성',
};

/** 스텝퍼 스텝 키 — 녹음 저장 → STT → 요약 → 완료 */
export type ReportProgressStepKey = 'save' | 'stt' | 'summary' | 'ready';

export const REPORT_PROGRESS_STEP_LABELS: Record<ReportProgressStepKey, string> = {
  save: '녹음 저장',
  stt: '음성 인식(STT)',
  summary: 'AI 요약',
  ready: '리포트 완료',
};

const STEP_ORDER: readonly ReportProgressStepKey[] = ['save', 'stt', 'summary', 'ready'];

export type ReportStepState = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface ReportProgressStep {
  key: ReportProgressStepKey;
  label: string;
  state: ReportStepState;
}

export interface ReportProgressDto {
  session_id: string;
  generation_status: ReportGenerationStatus;
  stage: ReportProgressStepKey;
  /** 0~100 */
  progress: number;
  /** partial/차단 사유 코드 */
  reason: string | null;
  /** 승인 게이트 상태(참고) */
  report_status: string | null;
  steps: ReportProgressStep[];
  updated_at: string | null;
}

/** reason 코드 → 사용자 문구 */
export const REPORT_PROGRESS_REASON_LABELS: Record<string, string> = {
  mic_off: '마이크를 사용하지 않아 AI 요약 없이 기록만 남겼어요.',
  low_confidence: '음성 분석 신뢰도가 낮아 AI 요약은 제공하지 않아요.',
  no_transcript: '음성에서 말을 찾지 못해 AI 요약을 만들지 못했어요.',
  stt_failed: '음성 인식에 실패해 AI 요약을 만들지 못했어요.',
  summary_failed: 'AI 요약 생성에 실패했어요. 전사문은 확인할 수 있어요.',
  report_failed: '리포트 생성 중 오류가 발생했어요.',
};

export function resolveReportGenerationStatus(value: unknown): ReportGenerationStatus {
  return typeof value === 'string' && GENERATION_STATUSES.includes(value as ReportGenerationStatus)
    ? (value as ReportGenerationStatus)
    : 'pending';
}

/** 생성 종료 상태 — ready(완료) 또는 partial(일부 완료) */
export function isReportGenerationDone(status: ReportGenerationStatus | null | undefined): boolean {
  return status === 'ready' || status === 'partial';
}

export function reportProgressReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return REPORT_PROGRESS_REASON_LABELS[reason] ?? null;
}

function asStepKey(value: unknown): ReportProgressStepKey | null {
  return typeof value === 'string' && STEP_ORDER.includes(value as ReportProgressStepKey)
    ? (value as ReportProgressStepKey)
    : null;
}

function asStepState(value: unknown): ReportStepState {
  return value === 'active' || value === 'done' || value === 'skipped' || value === 'failed'
    ? value
    : 'pending';
}

/**
 * 서버 진행 계약 파싱(방어적). 서버가 스텝을 일부만 줘도 표준 4스텝 순서를 보장한다.
 * 계약이 아니면 null — 화면은 스텝퍼를 숨기고 기존 상태 표시로 폴백한다.
 */
export function parseReportProgress(raw: unknown): ReportProgressDto | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;

  const stepsRaw = Array.isArray(data.steps) ? data.steps : [];
  const byKey = new Map<ReportProgressStepKey, ReportStepState>();
  for (const item of stepsRaw) {
    if (typeof item !== 'object' || item === null) continue;
    const step = item as Record<string, unknown>;
    const key = asStepKey(step.key);
    if (!key) continue;
    byKey.set(key, asStepState(step.state));
  }
  const steps: ReportProgressStep[] = STEP_ORDER.map((key) => ({
    key,
    label: REPORT_PROGRESS_STEP_LABELS[key],
    state: byKey.get(key) ?? 'pending',
  }));

  const progressRaw = typeof data.progress === 'number' && !Number.isNaN(data.progress) ? data.progress : 0;
  return {
    session_id: typeof data.session_id === 'string' ? data.session_id : '',
    generation_status: resolveReportGenerationStatus(data.generation_status),
    stage: asStepKey(data.stage) ?? 'save',
    progress: Math.max(0, Math.min(100, Math.round(progressRaw))),
    reason: typeof data.reason === 'string' ? data.reason : null,
    report_status: typeof data.report_status === 'string' ? data.report_status : null,
    steps,
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : null,
  };
}

/**
 * SDD-095 — 세션의 리포트 생성 진행 상태 조회.
 * 종료 화면(대기 화면)이 최초 1회 조회 + 주기 폴링으로 스텝퍼를 복원한다.
 */
export const getSessionReportStatus = async (sessionId: string): Promise<ReportProgressDto | null> => {
  const raw = await apiClient.get<unknown>(`/sessions/${sessionId}/report-status`);
  return parseReportProgress(raw);
};
