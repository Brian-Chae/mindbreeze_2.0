import { useRef, useState } from 'react';
import { ApiError } from '../../../lib/api/client';
import type { WriteCommand } from '../../../lib/api/class-scheduling';
export const operationButton = 'rounded-xl border border-[#ded8d0] bg-white px-4 py-2 text-sm font-medium disabled:opacity-40';
export const operationInput = 'w-full rounded-xl border border-[#ded8d0] bg-white px-3 py-2 text-sm';
const errors: Record<string, string> = {
  stale_class: '다른 변경이 있어요. 최신 내용을 다시 불러온 뒤 시도해 주세요.',
  stale_session: '회차가 변경됐어요. 최신 내용을 다시 불러와 주세요.',
  reason_required: '센터 관리자의 변경 사유를 입력해 주세요.',
  regular_sessions_remaining: '아직 완료하지 않은 정규 회차가 있어요. 회차를 완료하거나 취소한 뒤 마무리해 주세요.',
  class_transition_conflict: '입장 중이거나 진행 중인 회차를 먼저 종료해 주세요.',
  class_capacity: '클래스 정원을 초과했어요.',
  last_lead: '마지막 주강사는 제거할 수 없어요. 새 주강사를 먼저 지정해 주세요.',
  instructor_has_sessions: '아직 배정된 회차가 있어요. 회차의 진행자를 먼저 변경해 주세요.',
};
export function operationError(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = (error.data as { detail?: { code?: string } } | null)?.detail;
    if (detail?.code && errors[detail.code]) return errors[detail.code];
  }
  return error instanceof Error ? error.message : '저장하지 못했어요. 다시 시도해 주세요.';
}
export function useClassOperation(revision: number | undefined, onSaved: () => void) {
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const run = async (signature: string, action: (command: WriteCommand) => Promise<unknown>, admin = false): Promise<boolean> => {
    if (lock.current) return false;
    if (admin && !reason.trim()) { setError('센터 관리자의 변경 사유를 입력해 주세요.'); return false; }
    if (revision === undefined) { setError('변경 버전을 확인할 수 없어요. 새로고침해 주세요.'); return false; }
    const completeSignature = JSON.stringify([signature, reason, revision]);
    if (pending.current?.signature !== completeSignature) pending.current = { signature: completeSignature, key: crypto.randomUUID() };
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try { await action({ operation_key: pending.current.key, expected_revision: revision, ...(reason.trim() ? { reason: reason.trim() } : {}) }); pending.current = null; setMessage('저장했어요.'); onSaved(); return true; }
    catch (e) { setError(operationError(e)); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, message, reason, setReason, run };
}
export function OperationFeedback({ operation, admin = false }: { operation: ReturnType<typeof useClassOperation>; admin?: boolean }) {
  return <>{admin && <label className="block space-y-2 text-sm">센터 관리자 변경 사유<textarea className={operationInput} value={operation.reason} maxLength={1000} onChange={e => operation.setReason(e.target.value)} /></label>}{operation.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{operation.error}</p>}{operation.message && <p role="status" className="text-sm text-emerald-800">{operation.message}</p>}</>;
}
