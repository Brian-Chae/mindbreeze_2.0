import { useEffect, useRef, useState } from 'react';
import type { UseBiosignalCaptureResult } from '../../hooks/useBiosignalCapture';
import '../../components/notifications/notification-toast-host.css';
import './recording-status.css';

export type RecordingStatus = Pick<UseBiosignalCaptureResult, 'status' | 'stopReason' | 'pendingCount' | 'blockedCount' | 'quotaWarning' | 'resumeBlocked'>;

/** 전송 대기가 줄지 않고 이 시간 이상 쌓이기만 할 때 '서버 연결 문제'로 안내한다(정상 업로드의 짧은 대기는 숨김). */
export const PENDING_NOTICE_DELAY_MS = 60_000;

/**
 * 전송 대기가 delayMs 동안 한 번도 줄지 않고 남아 있을 때 true.
 * 정상 업로드는 대기가 주기적으로 줄거나 0이 되므로 타이머가 다시 시작된다. 줄면(복구) 즉시 false.
 */
function useStalledPending(pendingCount: number, delayMs: number): boolean {
  const [stalled, setStalled] = useState(false);
  const prev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = pendingCount;
    const clear = (): void => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    if (pendingCount === 0 || pendingCount < before) {
      clear();
      setStalled(false);
    }
    // 대기가 새로 생기거나 줄어든 시점부터 다시 센다. 늘기만 하면 기존 타이머를 유지한다.
    if (pendingCount > 0 && (before === 0 || pendingCount < before)) {
      timer.current = setTimeout(() => setStalled(true), delayMs);
    }
  }, [pendingCount, delayMs]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return pendingCount > 0 && stalled;
}

/**
 * BLE 연결과 별개인 로컬 기록/전송 상태 안내.
 * 정상 기록·업로드 중에는 아무것도 그리지 않는다(백그라운드). 문제가 있을 때만 앱 토스트 스타일로 짧게 알리고,
 * 복구되면 사라진다. 헤더(클래스 이름·시간 배지)를 가리지 않도록 상단 바 아래에 띄운다. 생체 점수·판정은 표시하지 않는다.
 */
export function BiosignalRecordingStatus({ state, pendingDelayMs = PENDING_NOTICE_DELAY_MS }: { state: RecordingStatus | undefined; pendingDelayMs?: number }) {
  const stalled = useStalledPending(state?.pendingCount ?? 0, pendingDelayMs);
  if (!state) return null;
  const stopped = state.status === 'stopped' && state.stopReason !== 'closed';
  const blocked = state.blockedCount > 0;
  const message = stopped
    ? (state.stopReason === 'quota' ? '저장 공간 부족으로 기록 중단' : state.stopReason === 'lease_lost' ? '다른 창이 기록 중 · 이 창 기록 중단' : '기기 저장 실패로 기록 중단')
    : state.quotaWarning ? '기기 저장 공간이 부족해지고 있어요'
      : stalled ? '서버 연결이 불안정해요'
        : null;
  if (!message && !blocked) return null;
  return <div className="rs-notice" role="status" aria-live="polite" data-testid="biosignal-recording-status">
    <div className="nt-toast rs-notice__toast">
      <div className="rs-notice__body">
        {message && <b className="nt-toast__title">{message}</b>}
        {stalled && <span className="nt-toast__text" data-testid="biosignal-saving">측정값은 기기에 안전하게 보관 중이에요. 연결되면 자동으로 올라가요.</span>}
        {blocked && <span className="rs-notice__chip" data-testid="biosignal-blocked">전송 확인 필요 {state.blockedCount}건</span>}
        {blocked && <button type="button" className="rs-notice__retry" onClick={() => void state.resumeBlocked()}>전송 재개</button>}
      </div>
    </div>
  </div>;
}
