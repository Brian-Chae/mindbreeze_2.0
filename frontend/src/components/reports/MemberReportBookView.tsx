// 회원 리포트 v11 화면 연결 (SDD-327 T8) — MemberReportView + 보내기 + 책 PDF 받기
import { useState } from 'react';
import { MemberReportView } from '../member-report';
import { ReportShareEntry } from '../report-share';
import { buttonClass } from '../ui';
import { MemberReportViewV2 } from '../member-report-v2';
import { getMyBookPdf, BOOK_PDF_FILENAME, isMemberReportV2, type AnyMemberReport } from '../../lib/api/member-report';
import { savePdfBlob } from '../../lib/native/save-pdf';
import { buildNativeShareHandler } from '../../lib/native/share-report';

interface Props {
  report: AnyMemberReport;
  /** 본인 리포트 id. 토큰(메일 링크) 열람처럼 id 로 접근할 수 없으면 null → 보내기·책 받기 숨김 */
  reportId: string | null;
}

export default function MemberReportBookView({ report, reportId }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    if (!reportId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await savePdfBlob(await getMyBookPdf(reportId), BOOK_PDF_FILENAME, '명상 기록 책 저장');
    } catch {
      setError('책 PDF를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const shareSlot = reportId ? (
    <ReportShareEntry reportId={reportId} mode="member" onNativeShare={buildNativeShareHandler(reportId)} />
  ) : undefined;
  const headerActionSlot = reportId ? (
    <button type="button" data-print-exclude data-testid="book-pdf-button" onClick={download} disabled={busy} aria-busy={busy}
      className={buttonClass({ variant: 'secondary' })}>
      {busy ? '책 준비 중...' : '명상 기록 책 PDF'}
    </button>
  ) : undefined;

  return (
    <div data-testid="member-report-book-view">
      {isMemberReportV2(report)
        ? <MemberReportViewV2 report={report} shareSlot={shareSlot} headerActionSlot={headerActionSlot} />
        : <MemberReportView report={report} shareSlot={shareSlot} headerActionSlot={headerActionSlot} />}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
