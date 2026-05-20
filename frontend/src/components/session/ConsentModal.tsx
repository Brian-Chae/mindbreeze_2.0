// 음성 녹음 동의 모달

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConsentModal({ open, onConfirm, onCancel }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          음성 녹음 동의가 필요합니다
        </h2>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          이 세션의 음성을 녹음하고 AI 기록지 자동 생성을 위해 사용합니다. 동의하지 않으시면 수동 기록 모드로 진행됩니다.
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-neutral-500 dark:text-neutral-400">
          <li>녹음 데이터는 STT/요약 처리 후 30일간 보관됩니다</li>
          <li>본인 세션과 담당 상담사만 접근할 수 있습니다</li>
          <li>언제든지 녹음을 중지할 수 있습니다</li>
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            동의하고 녹음 시작
          </button>
        </div>
      </div>
    </div>
  );
}
