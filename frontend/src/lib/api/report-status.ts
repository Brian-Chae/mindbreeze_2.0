/**
 * SDD-027 — 리포트 파이프라인 상태 · data_credibility
 *
 * pending_review = 2.0 상담사 승인 게이트.
 * data_credibility는 quality 게이트에서 파생(서버 값 우선, 없으면 EEG status 매핑).
 */

import type { EegQualityStatus } from './report';

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

/** UI 표시용 한글 라벨 */
export const REPORT_STATUS_LABELS: Record<ReportPipelineStatus, string> = {
  pending_analysis: '분석 대기',
  pending_review: '검수 대기',
  completed: '완료',
  error: '오류',
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
