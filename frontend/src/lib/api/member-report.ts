// 회원 리포트(member_report.v1) API 클라이언트 (SDD-327 T8) — BE T5 계약: /me/reports/{id}/member-report, /book.pdf
import { apiClient } from './client';
import { MEMBER_REPORT_SCHEMA_VERSION, type MemberReport } from '../member-report/types';
import { MEMBER_REPORT_V2_SCHEMA_VERSION, type MemberReportV2 } from '../member-report/types-v2';

export const getMyMemberReport = (reportId: string): Promise<MemberReport> =>
  apiClient.get<MemberReport>(`/me/reports/${encodeURIComponent(reportId)}/member-report`);

export const getMyBookPdf = (reportId: string): Promise<Blob> =>
  apiClient.getBlob(`/me/reports/${encodeURIComponent(reportId)}/book.pdf`);

/** SDD-328 — v1/v2 판별 유니온 */
export type AnyMemberReport = MemberReport | MemberReportV2;

export function isMemberReportV2(report: AnyMemberReport): report is MemberReportV2 {
  return report.schema_version === MEMBER_REPORT_V2_SCHEMA_VERSION;
}

/** reports.content 안에 저장된 member_report 를 안전하게 꺼낸다. 없거나 알 수 없는 버전이면 null(구 화면 폴백). v1·v2 모두 반환. */
export function extractMemberReport(content: Record<string, unknown> | null | undefined): AnyMemberReport | null {
  const raw = content?.member_report;
  if (!raw || typeof raw !== 'object') return null;
  const version = (raw as { schema_version?: unknown }).schema_version;
  if (version === MEMBER_REPORT_SCHEMA_VERSION) return raw as MemberReport;
  if (version === MEMBER_REPORT_V2_SCHEMA_VERSION) return raw as MemberReportV2;
  return null;
}

export const BOOK_PDF_FILENAME = 'mind-breeze-meditation-book.pdf';

/** 브라우저 다운로드(웹 전용). 앱에서는 a.download 가 동작하지 않으므로 lib/native/save-pdf 의 savePdfBlob 을 쓴다. */
export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try { link.click(); } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
