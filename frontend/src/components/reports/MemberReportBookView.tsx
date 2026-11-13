// 회원 리포트 v11 화면 연결 (SDD-327 T8) — MemberReportView + 보내기 + 책 PDF 받기
import { useState } from 'react';
import { MemberReportView } from '../member-report';
import { ReportShareEntry } from '../report-share';
import { buttonClass } from '../ui';
import type { MemberReport } from '../../lib/member-report/types';
import { getMyBookPdf, BOOK_PDF_FILENAME, saveBlobAsFile } from '../../lib/api/member-report';
import { buildNativeShareHandler } from '../../lib/native/share-report';

interface Props {
  report: MemberReport;
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
      saveBlobAsFile(await getMyBookPdf(reportId), BOOK_PDF_FILENAME);
    } catch {
      setError('책 PDF를 받지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="member-report-book-view">
      <MemberReportView
        report={report}
        shareSlot={reportId ? (
          <ReportShareEntry reportId={reportId} mode="member" onNativeShare={buildNativeShareHandler(reportId)} />
        ) : undefined}
        headerActionSlot={reportId ? (
          <button type="button" data-print-exclude data-testid="book-pdf-button" onClick={download} disabled={busy} aria-busy={busy}
            className={buttonClass({ variant: 'secondary' })}>
            {busy ? '책 준비 중...' : '명상 기록 책 PDF'}
          </button>
        ) : undefined}
      />
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
