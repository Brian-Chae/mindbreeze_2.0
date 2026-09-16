// AI 리포트 API 클라이언트

import { apiClient } from './client';

// content.eeg 계약·어댑터는 report.ts (SDD-022)
export type {
  AdaptedReportContent,
  EegMetricKey,
  EegQualityStatus,
  EegTimelinePoint,
  ReportEegContent,
  ReportMarker,
} from './report';
export {
  adaptReportContent,
  CLIENT_METRIC_LABELS,
  CLIENT_PRIMARY_METRIC_KEYS,
  COUNSELOR_METRIC_LABELS,
  EEG_METRIC_KEYS,
  reliabilityLabel,
  resolveMetricLabel,
} from './report';

// SDD-027 — 파이프라인 상태 · data_credibility
export type {
  DataCredibilityDisplay,
  ReportPipelineStatus,
} from './report-status';
export {
  REPORT_STATUS_LABELS,
  canApproveReport,
  credibilityFromQuality,
  resolveDataCredibility,
  resolveReportStatus,
} from './report-status';

export type ReportType = 'counselor' | 'client';

export interface ReportDto {
  id: string;
  session_id: string;
  /** 게스트 리포트 시 null 가능(SDD-027) */
  user_id: string | null;
  type: ReportType;
  content: Record<string, unknown>;
  pdf_url: string | null;
  sent_at: string | null;
  is_read: boolean;
  created_at: string | null;
  session_title: string | null;
  session_type: string | null;
  scheduled_at: string | null;
  /**
   * SDD-027 파이프라인 상태.
   * 미제공 시 resolveReportStatus가 sent_at 기준 폴백.
   */
  status?: string | null;
  /**
   * quality 게이트 파생 신뢰도(서버).
   * number(0~1/0~100) 또는 quality/라벨 문자열.
   */
  data_credibility?: string | number | null;
  /** 게스트/참여자 기반 리포트 */
  participant_id?: string | null;
  /** SDD-050 — participant.report_email (client 리포트 재발송 기본값) */
  report_email?: string | null;
  /** SDD-065 — 참여자 표시명 (게스트 guest_name / 회원 user.name) */
  participant_name?: string | null;
  /** SDD-065 — male | female | other */
  gender?: string | null;
  /** SDD-065 — ISO date (YYYY-MM-DD) */
  birth_date?: string | null;
  /** SDD-065 — participant.user_id 없으면 true */
  is_guest?: boolean | null;
}

export interface ReportListResponse {
  reports: ReportDto[];
  total: number;
}

/** SDD-058 — 리포트 목록 페이지네이션 */
export interface ListReportsParams {
  page?: number;
  limit?: number;
}

const DEFAULT_REPORT_LIST_LIMIT = 20;

function buildReportListQuery(params?: ListReportsParams): string {
  if (!params) return '';
  const page = params.page ?? 1;
  const limit = params.limit ?? DEFAULT_REPORT_LIST_LIMIT;
  const sp = new URLSearchParams();
  sp.set('page', String(page));
  sp.set('limit', String(limit));
  return `?${sp.toString()}`;
}

export const listReports = (params?: ListReportsParams): Promise<ReportListResponse> =>
  apiClient.get<ReportListResponse>(`/reports${buildReportListQuery(params)}`);
export const getReport = (id: string): Promise<ReportDto> =>
  apiClient.get<ReportDto>(`/reports/${id}`);

/** SDD-052 — 메일 토큰 기반 리포트 열람 (로그인 불필요) */
export const getReportView = (token: string): Promise<ReportDto> =>
  apiClient.get<ReportDto>(`/reports/view?token=${encodeURIComponent(token)}`, {
    skipAuth: true,
  });

export const generateReport = (sessionId: string, type: ReportType = 'counselor'): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/generate/${sessionId}`, { type });

export const updateReport = (id: string, content: Record<string, unknown>): Promise<ReportDto> =>
  apiClient.put<ReportDto>(`/reports/${id}`, { content });

export const approveReport = (id: string, note?: string): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/${id}/approve`, { note });

/** SDD-049 — 리포트 자동 승인 설정 */
export interface AutoApproveResponse {
  enabled: boolean;
}

export const getAutoApprove = (): Promise<AutoApproveResponse> =>
  apiClient.get<AutoApproveResponse>('/reports/auto-approve');

export const setAutoApprove = (enabled: boolean): Promise<AutoApproveResponse> =>
  apiClient.patch<AutoApproveResponse>('/reports/auto-approve', { enabled });

/** SDD-050 — 리포트 메일 재발송 */
export interface ResendReportEmailResponse {
  ok?: boolean;
  email?: string;
  message?: string;
}

export const resendReportEmail = (
  reportId: string,
  email: string,
): Promise<ResendReportEmailResponse> =>
  apiClient.post<ResendReportEmailResponse>(`/reports/${reportId}/resend-email`, { email });
