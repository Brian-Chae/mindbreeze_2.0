// SDD-088: 클래스 종료 2단계 확인 모달 — window.confirm 1회를 대체한다.
// 종료 시 일어나는 일(녹음·녹화 종료, 리포트 자동 생성, 회원 화면 종료)을 고지한다.

interface EndSessionModalProps {
  open: boolean;
  ending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EndSessionModal({ open, ending, onConfirm, onCancel }: EndSessionModalProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h4 className="text-lg font-semibold text-[#1F1F1F]">클래스를 종료할까요?</h4>
        <ul className="mt-3 space-y-1.5 text-sm text-[#6F6F6F]">
          <li>· 진행 중인 음성 녹음·영상 녹화가 종료됩니다</li>
          <li>· 상담사·회원 리포트가 자동 생성됩니다</li>
          <li>· 참여 중인 회원의 화면도 함께 종료됩니다</li>
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={ending} className="mb-btn mb-btn--ghost">
            계속 진행
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={ending}
            className="mb-btn !bg-[#B3261E] hover:!bg-[#8F1E18] disabled:cursor-not-allowed"
          >
            {ending ? '종료 중...' : '클래스 종료'}
          </button>
        </div>
      </div>
    </div>
  );
}
