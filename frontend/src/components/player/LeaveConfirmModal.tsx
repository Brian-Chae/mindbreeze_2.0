// 회원 이탈 확인 모달 — SDD-131(②-20): 종료/이탈 버튼 확인 없이 즉시 종료되던 문제 해결.
// 상담사 EndSessionModal 2단계 확인 패턴과 동일한 구조로, 진행 중 이탈 시 뇌파·리포트 중단을 고지한다.

interface LeaveConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function LeaveConfirmModal({ open, onConfirm, onCancel }: LeaveConfirmModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-confirm-title"
      >
        <h4 id="leave-confirm-title" className="text-lg font-semibold text-[#1F1F1F]">
          나가시겠어요?
        </h4>
        <p className="mt-3 text-sm leading-6 text-[#6F6F6F]">
          나가면 뇌파 측정과 리포트 신청이 중단될 수 있습니다.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="mb-btn mb-btn--ghost">
            계속 진행
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="mb-btn !bg-[#B3261E] hover:!bg-[#8F1E18]"
          >
            나가기
          </button>
        </div>
      </div>
    </div>
  );
}
