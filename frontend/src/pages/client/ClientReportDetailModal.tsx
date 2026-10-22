// 내담자용 리포트 팝업 — 네이티브 dialog로 포커스 제한과 ESC 처리
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ClientReportViewer from '../../components/reports/ClientReportViewer';
import { getReport, listReports, type ReportDto } from '../../lib/api/reports';
import {
  isReportDelayed,
  isReportInReview,
  REPORT_IN_REVIEW_BADGE,
  REPORT_IN_REVIEW_DELAYED_NOTICE,
  REPORT_IN_REVIEW_NOTICE,
} from '../../lib/report-review-copy';
import '../../components/reports/narrative-sections.css';

type ClientReportDetailModalProps = {
  onClose: () => void;
  /** 리포트 로드(열람 → is_read 마킹) 후 목록에 전파 */
  onReportChange?: (report: ReportDto) => void;
} & ({ reportId: string; sessionId?: never } | { sessionId: string; reportId?: never });

export function ClientReportDetailModal({ reportId, sessionId, onClose, onReportChange }: ClientReportDetailModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onReportChangeRef = useRef(onReportChange);
  useEffect(() => {
    onReportChangeRef.current = onReportChange;
  }, [onReportChange]);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    async function loadReport() {
      try {
        // 세션 ID는 리포트 ID와 다르므로 본인의 내담자 리포트를 먼저 찾는다.
        const id = reportId ?? (await listReports()).reports.find(
          (item) => item.session_id === sessionId && item.type === 'client' && item.id,
        )?.id;
        if (cancelled) return;
        if (!id) throw new Error('리포트를 찾을 수 없습니다');
        const result = await getReport(id);
        if (cancelled) return;
        setReport(result);
        onReportChangeRef.current?.(result);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '리포트 조회 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadReport();
    return () => { cancelled = true; };
  }, [reportId, sessionId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="report-sample-modal"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="report-sample-toolbar">
        <h2 id={titleId} className="mobile:[overflow-wrap:anywhere] truncate">{report?.session_title || '리포트 상세'}</h2>
        <button type="button" onClick={onClose} aria-label="리포트 닫기">
          닫기 <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="report-sample-scroll">
        {loading && <div className="p-8 mobile:p-4 text-[#6F6F6F] text-sm mobile:text-mb-body" role="status">불러오는 중...</div>}
        {!loading && error && <div className="m-6 p-3 rounded-xl bg-red-50 text-red-700 text-sm mobile:text-mb-body" role="alert">{error}</div>}
        {!loading && report && isReportInReview(report) && (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center" data-testid="report-in-review">
            <span className="inline-flex items-center rounded-full bg-[#F5EDFC] px-2.5 py-1 text-[12px] mobile:text-mb-caption font-bold text-[#5F0080]">
              {REPORT_IN_REVIEW_BADGE}
            </span>
            <p className="text-[15px] mobile:text-mb-body text-[#1F1F1F]">{REPORT_IN_REVIEW_NOTICE}</p>
            {isReportDelayed(report) && <p className="text-[13px] mobile:text-mb-caption text-[#6F6F6F]">{REPORT_IN_REVIEW_DELAYED_NOTICE}</p>}
          </div>
        )}
        {!loading && report && !isReportInReview(report) && <ClientReportViewer report={report} onClose={onClose} />}
      </div>
    </dialog>,
    document.body,
  );
}
