import { apiClient } from '../api/client';
import { savePdfBlob } from '../native/save-pdf';

/** 서버에서 생성한 PDF를 저장한다. 토큰 열람에는 로그인 토큰을 보내지 않는다. */
export async function downloadReportPdf(source: { reportId: string } | { token: string }): Promise<void> {
  const byToken = 'token' in source;
  const path = byToken
    ? `/reports/view/pdf?token=${encodeURIComponent(source.token)}`
    : `/reports/${encodeURIComponent(source.reportId)}/pdf`;
  const blob = await apiClient.getBlob(path, { skipAuth: byToken });
  await savePdfBlob(blob, 'mind-breeze-report.pdf', '리포트 PDF 저장');
}
