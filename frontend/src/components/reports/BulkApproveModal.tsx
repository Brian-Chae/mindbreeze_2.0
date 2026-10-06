// 상담사 일괄 승인 확인 모달 — 네이티브 dialog (ESC/오버레이 클릭 닫기)
// window.confirm 대신 자체 팝업으로, 코멘트 없이 일괄 발송된다는 경고를 명확히 보여준다.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface BulkApproveModalProps {
  /** 현재 목록에서 확인된 검토중(pending_review) 리포트 수 (표시용) */
  pendingCount: number;
  /** 확인 시 실행 — 성공하면 resolve, 실패하면 reject(모달이 에러를 표시) */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export default function BulkApproveModal({
  pendingCount,
  onConfirm,
  onClose,
}: BulkApproveModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '일괄 승인 처리에 실패했습니다');
      setSubmitting(false);
    }
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby="bulk-approve-title"
      aria-describedby="bulk-approve-desc"
      onCancel={(e) => {
        e.preventDefault();
        if (!submitting) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      className="m-auto w-[min(92vw,440px)] rounded-2xl p-0 shadow-2xl backdrop:bg-black/40"
    >
      <div className="p-6">
        <h2 id="bulk-approve-title" className="text-[16px] font-bold text-[#1F1F1F]">
          일괄 승인
        </h2>
        <p id="bulk-approve-desc" className="mt-3 text-[14px] leading-relaxed text-[#4A4A4A]">
          상담사 코멘트 없이 검토중인 리포트{pendingCount > 0 ? ` ${pendingCount}건` : ''}이
          내담자에게 일괄 발송됩니다.
          <br />
          일괄 승인 처리 하시겠습니까?
        </p>
        {error && (
          <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-10 rounded-xl border border-[#E8D9F5] bg-white px-4 text-[13px] font-semibold text-[#5F0080] hover:bg-[#F5EDFC] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="h-10 rounded-xl bg-[#5F0080] px-5 text-[13px] font-semibold text-white hover:bg-[#4A0066] disabled:opacity-50"
          >
            {submitting ? '처리 중...' : '일괄 승인'}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
