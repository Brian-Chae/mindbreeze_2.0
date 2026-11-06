// SDD-318 — 리포트 상세 시트(D안). 기존 dialog 동작(포커스 제한·ESC·뒤로 포커스 복원·배경 스크롤 차단)을 유지한다.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ClientReportViewer from '../reports/ClientReportViewer';
import PastReportsCompare from '../reports/PastReportsCompare';
import { UiV2ArcRing } from './ui-v2-arc-ring';
import { getReport, type ReportDto } from '../../lib/api/reports';
import { isReportDelayed, isReportInReview, REPORT_IN_REVIEW_BADGE, REPORT_IN_REVIEW_DELAYED_NOTICE, REPORT_IN_REVIEW_NOTICE } from '../../lib/report-review-copy';
import '../reports/narrative-sections.css';
import '../../styles/ui-v2.css';

export function UiV2ReportSheet({ reportId, onClose, onReportChange }: { reportId: string; onClose: () => void; onReportChange?: (report: ReportDto) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const changeRef = useRef(onReportChange);
  useEffect(() => { changeRef.current = onReportChange; }, [onReportChange]);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setReport(null);
    getReport(reportId).then((result) => {
      if (cancelled) return;
      setReport(result);
      changeRef.current?.(result);
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : '리포트 조회 실패');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reportId]);

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

  const inReview = report ? isReportInReview(report) : false;
  const when = report?.scheduled_at ?? report?.created_at;
  return createPortal(
    <dialog ref={dialogRef} className="ui-v2 u2-sheet-dialog" aria-modal="true" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="u2-handle" aria-hidden="true" />
      <div className="u2-toolbar">
        <button type="button" className="u2-icon-btn" onClick={onClose} aria-label="리포트 닫기">
          <svg className="u2-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 5-7 7 7 7" /></svg>
        </button>
        <span className="u2-muted">리포트</span>
        <span style={{ width: 44 }} />
      </div>
      <div className="u2-sheet-scroll">
        <section className="u2-cover" style={{ overflow: 'visible' }}>
          <UiV2ArcRing variant="cover" />
          <span className="u2-eyebrow">{report?.session_type === 'meditation' ? '명상수업' : '리포트'}</span>
          <h1 id={titleId}>{report?.session_title || '리포트 상세'}</h1>
          {when && <p className="u2-muted">{new Date(when).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}{report?.counselor_name ? ` · ${report.counselor_name}` : ''}</p>}
        </section>
        {loading && <p className="u2-empty" role="status">불러오는 중...</p>}
        {!loading && error && <div className="u2-alert" role="alert">{error}</div>}
        {!loading && report && inReview && (
          <div className="u2-sheet" data-testid="report-in-review" style={{ textAlign: 'center' }}>
            <span className="u2-chip">{REPORT_IN_REVIEW_BADGE}</span>
            <p style={{ marginTop: 16 }}>{REPORT_IN_REVIEW_NOTICE}</p>
            {isReportDelayed(report) && <p className="u2-muted" style={{ fontSize: 13 }}>{REPORT_IN_REVIEW_DELAYED_NOTICE}</p>}
          </div>
        )}
        {!loading && report && !inReview && <div className="u2-sheet"><ClientReportViewer report={report} onClose={onClose} /></div>}
        {!loading && report && !inReview && <div className="u2-gap"><PastReportsCompare current={report} /></div>}
        <button type="button" className="u2-secondary u2-gap" onClick={onClose}>리포트 닫기</button>
      </div>
    </dialog>,
    document.body,
  );
}
