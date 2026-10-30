// SDD-253 D2 — 데스크톱 분할 검토: 선택한 회원의 리포트를 목록 옆에서 읽고, 코멘트 저장 후 '승인하고 발송' 한 번으로 처리한다.
// 읽기·편집·승인은 기존 ReportDetailView 를 그대로 재사용한다(모바일 전체화면 상세와 같은 본문).
import { useEffect, useState } from 'react';
import ReportDetailView from './ReportDetailView';
import { getReport, type ReportDto } from '../../lib/api/reports';
import '../reports/narrative-sections.css';
import './report-review-pane.css';

interface Props {
  reportId: string;
  onClose: () => void;
  onReportChange: (report: ReportDto) => void;
}

export default function ReportReviewPane({ reportId, onClose, onReportChange }: Props) {
  const [report, setReport] = useState<ReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionContainer, setActionContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    getReport(reportId)
      .then((r) => !cancelled && setReport(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : '리포트를 불러오지 못했습니다.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const path = report ? [report.session_title, report.counselor_name && `담당 ${report.counselor_name}`, report.participant_name].filter(Boolean).join(' › ') : '';

  return (
    <section aria-label="리포트 검토" className="report-review-pane sticky top-4 flex h-[calc(100vh-168px)] min-h-[520px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#DED6E3] bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-[#E8E0EC] px-7 py-4">
        <div className="min-w-0">
          <p className="m-0 truncate text-[13px] text-[#8B8191]">{path || '불러오는 중'}</p>
          <h2 className="m-0 truncate text-[18px] font-bold text-[#29272D]">{report?.type === 'counselor' ? '코치용 · 회차 공통' : '회원용 리포트 검토'}</h2>
        </div>
        <button type="button" onClick={onClose} className="h-11 shrink-0 whitespace-nowrap rounded-[10px] border border-[#DED8E3] bg-white px-4 text-[14px] font-semibold text-[#5F0080] hover:bg-[#F5EDFC]">목록으로</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
        {loading && <div className="text-[#6F6F6F]">불러오는 중...</div>}
        {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {report && (
          <ReportDetailView
            report={report}
            onReportChange={(next) => {
              setReport(next);
              onReportChange(next);
            }}
            showListAction={false}
            actionContainer={actionContainer}
          />
        )}
      </div>
      <div ref={setActionContainer} className="border-t border-[#E5DCE9] bg-white px-7 py-4" />
    </section>
  );
}
