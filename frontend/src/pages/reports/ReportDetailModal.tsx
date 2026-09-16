// 리포트 상세 팝업 모달 — SDD-064
// ESC / 오버레이 클릭 / 닫기 버튼으로 닫힘. 모바일 전체 · 데스크톱 큰 모달.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReportDetailView from '../../components/reports/ReportDetailView';
import { getReport, type ReportDto } from '../../lib/api/reports';
import '../../components/reports/narrative-sections.css';

interface ReportDetailModalProps {
  reportId: string;
  onClose: () => void;
}

export function ReportDetailModal({ reportId, onClose }: ReportDetailModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    getReport(reportId)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '리포트 조회 실패');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

  const title =
    (report?.content?.headline as string | undefined) ||
    report?.session_title ||
    '리포트 상세';

  return createPortal(
    <dialog
      ref={dialogRef}
      className="report-sample-modal"
      aria-labelledby="report-detail-modal-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="report-sample-toolbar">
        <h2 id="report-detail-modal-title" className="truncate">
          {title}
        </h2>
        <button type="button" onClick={onClose} autoFocus aria-label="리포트 닫기">
          닫기 <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="report-sample-scroll">
        {loading && (
          <div className="p-8 text-[#6F6F6F] text-sm" role="status">
            불러오는 중...
          </div>
        )}
        {!loading && error && !report && (
          <div className="p-6 space-y-4">
            <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div>
            <button
              type="button"
              onClick={onClose}
              className="mb-btn mb-btn-secondary text-[14px] px-5 py-2.5 rounded-xl"
            >
              닫기
            </button>
          </div>
        )}
        {!loading && report && (
          <div className="px-4 py-5 sm:px-6 md:px-8">
            <ReportDetailView
              report={report}
              onReportChange={setReport}
              error={error}
              showListAction
              listActionLabel="닫기"
              onListAction={onClose}
            />
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
