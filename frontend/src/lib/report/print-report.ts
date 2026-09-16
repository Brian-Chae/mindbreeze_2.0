import { apiClient } from '../api/client';

/** 서버에서 생성한 PDF를 저장한다. 토큰 열람에는 로그인 토큰을 보내지 않는다. */
export async function downloadReportPdf(source: { reportId: string } | { token: string }): Promise<void> {
  const byToken = 'token' in source;
  const path = byToken
    ? `/reports/view/pdf?token=${encodeURIComponent(source.token)}`
    : `/reports/${encodeURIComponent(source.reportId)}/pdf`;
  const blob = await apiClient.getBlob(path, { skipAuth: byToken });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mind-breeze-report.pdf';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // 브라우저가 다운로드를 시작할 시간을 확보한 뒤 메모리를 해제한다.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
