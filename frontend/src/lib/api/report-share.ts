// 리포트 공유 메일 API 클라이언트 (SDD-327 T15) — 회원 전용.
// 상담사·기관관리자는 기존 reports.ts 의 resendReportEmail 을 그대로 쓴다.

import { apiClient } from './client';
import type {
  ReportShareHistoryResponse,
  ReportShareRequest,
  ReportShareResponse,
} from './report-share.types';

export type {
  ReportShareHistoryItem,
  ReportShareHistoryResponse,
  ReportShareRequest,
  ReportShareResponse,
  ReportShareStatus,
} from './report-share.types';
export {
  REPORT_SHARE_MAX_MESSAGE_LEN,
  REPORT_SHARE_MAX_RECIPIENTS,
  REPORT_SHARE_MAX_SENDER_NAME_LEN,
} from './report-share.types';

export const shareMyReportByEmail = (
  reportId: string,
  body: ReportShareRequest,
): Promise<ReportShareResponse> =>
  apiClient.post<ReportShareResponse>(`/me/reports/${reportId}/share-email`, body);

export const getMyReportShareHistory = (reportId: string): Promise<ReportShareHistoryResponse> =>
  apiClient.get<ReportShareHistoryResponse>(`/me/reports/${reportId}/share-history`);
