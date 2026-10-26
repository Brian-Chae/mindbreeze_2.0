import type { UseBiosignalCaptureResult } from '../../hooks/useBiosignalCapture';
export type RecordingStatus = Pick<UseBiosignalCaptureResult, 'status' | 'stopReason' | 'pendingCount' | 'blockedCount' | 'quotaWarning' | 'resumeBlocked'>;
/** BLE 연결과 별개인 로컬 기록/전송 상태. 생체 점수나 판정은 표시하지 않는다. */
export function BiosignalRecordingStatus({ state }: { state: RecordingStatus | undefined }) {
  if (!state || (state.status === 'inactive' && !state.pendingCount && !state.blockedCount)) return null;
  const stopped = state.status === 'stopped' && state.stopReason !== 'closed';
  const message = stopped ? (state.stopReason === 'quota' ? '저장 공간 부족으로 기록 중단' : state.stopReason === 'lease_lost' ? '다른 창이 기록 중 · 이 창 기록 중단' : '기기 저장 실패로 기록 중단')
    : state.quotaWarning ? '기기 저장 공간이 부족해지고 있어요' : state.status === 'running' ? '기기에 기록 중' : '기록 종료';
  // 정상 백로그(전송 대기)는 숫자 없이 '기록 저장 중'으로만 알린다. 사용자가 조치할 수 있는 '전송 확인 필요'(보관된 건)만 눈에 띄게 한다.
  const saving = state.pendingCount > 0;
  const blocked = state.blockedCount > 0;
  return <div role="status" className="relative z-50 bg-slate-900 px-4 py-2 text-sm text-white" data-testid="biosignal-recording-status">
    <span>{message}{saving ? <span className="ml-2 text-xs text-slate-300" data-testid="biosignal-saving">· 기록 저장 중</span> : null}</span>
    {blocked && <span className="ml-3 rounded bg-amber-400 px-2 py-0.5 font-medium text-slate-900" data-testid="biosignal-blocked">전송 확인 필요 {state.blockedCount}건</span>}
    {blocked && <button type="button" className="ml-3 min-h-[44px] px-3 underline" onClick={() => void state.resumeBlocked()}>전송 재개</button>}
  </div>;
}
