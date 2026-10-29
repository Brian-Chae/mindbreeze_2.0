// SDD-255 — 회원용 리포트 모바일 뷰어: 어떤 화면에서든 최대 430px 한 컬럼 프레임으로 보여주고,
// 넓은 화면(≥561px)에서는 '데스크톱 보기' 버튼으로 기존 넓은 레이아웃을 모달로 연다. 선택은 저장하지 않는다.
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClientReportBody } from './ClientReportViewer';
import type { ReportDto } from '../../lib/api/reports';
import './narrative-sections.css';
import './member-report-frame.css';

interface Props {
  report: ReportDto;
  /** 검토 화면에서 코멘트 편집 카드가 같은 내용을 이미 보여줄 때 중복 표시를 막는다. */
  hideCounselorComment?: boolean;
}

function DesktopReportDialog({ report, hideCounselorComment, onClose }: Props & { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal?.();
    return () => dialog?.close?.();
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="report-sample-modal"
      data-testid="member-report-desktop-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="report-sample-toolbar">
        <h2 id={titleId}>데스크톱 보기</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose}>모바일로 보기</button>
          <button type="button" onClick={onClose} aria-label="데스크톱 보기 닫기">닫기 <span aria-hidden="true">×</span></button>
        </div>
      </div>
      <div className="report-sample-scroll">
        <div className="mx-auto max-w-4xl p-4">
          <ClientReportBody report={report} hideCounselorComment={hideCounselorComment} />
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

export default function MemberReportViewer({ report, hideCounselorComment = false }: Props) {
  const [desktopOpen, setDesktopOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    setDesktopOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div data-testid="member-report-viewer">
      {/* ≥561px 에서만 노출 (모바일 실기기는 현재와 동일하게 전체 폭, 버튼 없음) */}
      <div className="member-report-desktop-toggle">
        <button
          ref={triggerRef}
          type="button"
          data-testid="member-report-desktop-button"
          onClick={() => setDesktopOpen(true)}
          className="inline-flex min-h-11 items-center rounded-xl border border-[#E8D9F5] bg-white px-4 text-[14px] font-semibold text-[#5F0080] hover:bg-[#F5EDFC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F0080]"
        >
          데스크톱 보기
        </button>
      </div>
      <div className="member-report-frame" data-testid="member-report-frame">
        <ClientReportBody report={report} hideCounselorComment={hideCounselorComment} />
      </div>
      {desktopOpen && <DesktopReportDialog report={report} hideCounselorComment={hideCounselorComment} onClose={close} />}
    </div>
  );
}
