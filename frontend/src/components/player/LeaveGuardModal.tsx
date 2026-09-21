// SDD-088: SPA 라우팅 이탈 확인 모달 — useLeaveGuard 의 blocker 상태로 렌더한다.
// open: [클래스 닫기]/[계속 진행]/[나가기(상태 유지)]
// in_progress/paused: [클래스 종료 후 나가기]/[계속 진행] — 단순 나가기 없음(최고 강도)

import type { SessionStatus } from '../../lib/api/session';

interface LeaveGuardModalProps {
  status: SessionStatus;
  busy: boolean;
  /** 계속 진행 — 이탈 취소 */
  onStay: () => void;
  /** open: 클래스 닫기(cancel) 후 이탈 / in_progress: 클래스 종료(end) 후 이탈 */
  onCloseAndLeave: () => void;
  /** open 전용: 상태 유지한 채 이탈 */
  onLeaveKeepOpen: () => void;
}

export function LeaveGuardModal({
  status,
  busy,
  onStay,
  onCloseAndLeave,
  onLeaveKeepOpen,
}: LeaveGuardModalProps) {
  const isOpen = status === 'open';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h4 className="text-lg font-semibold text-[#1F1F1F]">
          {isOpen ? '클래스가 오픈된 상태입니다' : '클래스가 진행 중입니다'}
        </h4>
        <p className="mt-3 text-sm text-[#6F6F6F]">
          {isOpen
            ? '지금 나가면 회원들이 대기실에 남겨집니다. 클래스를 닫거나, 오픈 상태를 유지한 채 나갈 수 있습니다.'
            : '지금 나가면 녹음·녹화가 중단될 수 있습니다. 클래스를 종료한 뒤 나가는 것을 권장합니다.'}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {isOpen && (
            <button
              type="button"
              onClick={onLeaveKeepOpen}
              disabled={busy}
              className="mb-btn mb-btn--ghost"
            >
              나가기 (오픈 유지)
            </button>
          )}
          <button
            type="button"
            onClick={onCloseAndLeave}
            disabled={busy}
            className="mb-btn mb-btn--soft disabled:cursor-not-allowed"
          >
            {busy ? '처리 중...' : isOpen ? '클래스 닫고 나가기' : '클래스 종료 후 나가기'}
          </button>
          <button type="button" onClick={onStay} disabled={busy} className="mb-btn">
            계속 진행
          </button>
        </div>
      </div>
    </div>
  );
}
