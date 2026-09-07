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
}

export interface ReportListResponse {
  reports: ReportDto[];
  total: number;
}

export const listReports = (): Promise<ReportListResponse> =>
  apiClient.get<ReportListResponse>('/reports');

export const getReport = (id: string): Promise<ReportDto> =>
  apiClient.get<ReportDto>(`/reports/${id}`);

export const generateReport = (sessionId: string, type: ReportType = 'counselor'): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/generate/${sessionId}`, { type });

export const updateReport = (id: string, content: Record<string, unknown>): Promise<ReportDto> =>
  apiClient.put<ReportDto>(`/reports/${id}`, { content });

export const approveReport = (id: string, note?: string): Promise<ReportDto> =>
  apiClient.post<ReportDto>(`/reports/${id}/approve`, { note });
