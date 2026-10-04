// 내담자용 리포트 팝업 — 네이티브 dialog로 포커스 제한과 ESC 처리
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ClientReportViewer from '../../components/reports/ClientReportViewer';
import { getReport, listReports, type ReportDto } from '../../lib/api/reports';
import '../../components/reports/narrative-sections.css';

type ClientReportDetailModalProps = {
  onClose: () => void;
} & ({ reportId: string; sessionId?: never } | { sessionId: string; reportId?: never });

export function ClientReportDetailModal({ reportId, sessionId, onClose }: ClientReportDetailModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
        if (!cancelled) setReport(result);
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
        <h2 id={titleId} className="truncate">{report?.session_title || '리포트 상세'}</h2>
        <button type="button" onClick={onClose} aria-label="리포트 닫기">
          닫기 <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="report-sample-scroll">
        {loading && <div className="p-8 text-[#6F6F6F] text-sm" role="status">불러오는 중...</div>}
        {!loading && error && <div className="m-6 p-3 rounded-xl bg-red-50 text-red-700 text-sm" role="alert">{error}</div>}
        {!loading && report && <ClientReportViewer report={report} onClose={onClose} />}
      </div>
    </dialog>,
    document.body,
  );
}
