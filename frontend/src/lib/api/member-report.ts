// 회원 리포트(member_report.v1) API 클라이언트 (SDD-327 T8) — BE T5 계약: /me/reports/{id}/member-report, /book.pdf
import { apiClient } from './client';
import { MEMBER_REPORT_SCHEMA_VERSION, type MemberReport } from '../member-report/types';

export const getMyMemberReport = (reportId: string): Promise<MemberReport> =>
  apiClient.get<MemberReport>(`/me/reports/${encodeURIComponent(reportId)}/member-report`);

export const getMyBookPdf = (reportId: string): Promise<Blob> =>
  apiClient.getBlob(`/me/reports/${encodeURIComponent(reportId)}/book.pdf`);

/** reports.content 안에 저장된 member_report 를 안전하게 꺼낸다. 없거나 버전이 다르면 null(구 리포트 하위호환). */
export function extractMemberReport(content: Record<string, unknown> | null | undefined): MemberReport | null {
  const raw = content?.member_report;
  if (!raw || typeof raw !== 'object') return null;
  const version = (raw as { schema_version?: unknown }).schema_version;
  return version === MEMBER_REPORT_SCHEMA_VERSION ? (raw as MemberReport) : null;
}

export const BOOK_PDF_FILENAME = 'mind-breeze-meditation-book.pdf';

/** 브라우저 다운로드 */
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
