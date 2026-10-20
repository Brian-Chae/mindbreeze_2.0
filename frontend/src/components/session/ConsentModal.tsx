// 음성 녹음 동의 모달

import { useDialogA11y } from '../../hooks/useDialogA11y';
import { PrivacyPolicyLink } from '../legal/PrivacyPolicyLink';
import { RAW_RETENTION_DAYS } from '../../lib/privacy-policy';
import { isAiEnabled } from '../../lib/feature-flags';

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConsentModal({ open, onConfirm, onCancel }: Props) {
  const dialogRef = useDialogA11y(open, onCancel);
  if (!open) return null;
  // SDD-220: AI 기능이 꺼져 있으면 "AI 기록지" 문구 없이 녹음만 안내한다(서버도 STT·요약을 큐에 넣지 않는다).
  const aiEnabled = isAiEnabled();
  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2 id="consent-modal-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          음성 녹음 동의가 필요합니다
        </h2>
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          {aiEnabled
            ? '이 세션의 음성을 녹음하고 AI 기록지 자동 생성을 위해 사용합니다. 동의하지 않으시면 수동 기록 모드로 진행됩니다.'
            : '이 세션의 음성을 녹음해 클래스 기록으로 보관합니다. 동의하지 않으시면 수동 기록 모드로 진행됩니다.'}
        </p>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-neutral-500 dark:text-neutral-400">
          <li>{aiEnabled ? '녹음 데이터는 STT/요약 처리 후 ' : '녹음 데이터는 '}클래스 종료일부터 {RAW_RETENTION_DAYS}일이 지나면 삭제됩니다</li>
          <li>본인 세션과 담당 상담사만 접근할 수 있습니다</li>
          <li>언제든지 녹음을 중지할 수 있습니다</li>
          <li><PrivacyPolicyLink>개인정보 처리방침</PrivacyPolicyLink>에서 자세한 내용을 확인할 수 있습니다</li>
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            동의하고 녹음 시작
          </button>
        </div>
      </div>
    </div>
  );
}
