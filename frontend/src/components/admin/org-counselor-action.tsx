import { useEffect, useRef, useState } from 'react';
import {
  patchAdminOrganizationCounselor, removeAdminOrganizationCounselor,
  type AdminOrganizationCounselorDto,
} from '../../lib/api/admin';

const control = 'rounded-lg border border-[#DDDEE7] bg-white px-3 py-2 text-sm disabled:opacity-50';

export default function OrgCounselorAction({ orgId, member, action, onCancel, onSaved, onGuardChange }: {
  orgId: string; member: AdminOrganizationCounselorDto; action: 'role' | 'remove';
  onCancel: () => void; onSaved: () => void; onGuardChange: (dirty: boolean, busy: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const nextRole = member.role === 'org_admin' ? 'counselor' : 'org_admin';
  const label = action === 'role' ? '역할 변경' : '소속 해제';
  useEffect(() => { cancelRef.current?.focus(); }, []);
  useEffect(() => {
    onGuardChange(true, busy);
    return () => onGuardChange(false, false);
  }, [busy, onGuardChange]);
  const submit = async () => {
    if (submitting.current || !reason.trim()) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      if (action === 'role') await patchAdminOrganizationCounselor(orgId, member.id, { role: nextRole, reason: reason.trim() });
      else await removeAdminOrganizationCounselor(orgId, member.id, reason.trim());
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '변경하지 못했습니다. 다시 시도해주세요.');
    } finally {
      submitting.current = false; setBusy(false);
    }
  };
  return <form aria-label={`상담사 ${label} 확인`} onSubmit={(event) => { event.preventDefault(); void submit(); }}
    className="mb-4 space-y-3 rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm">
    <h3 className="font-bold">{member.name} · {label} 확인</h3>
    <p>{action === 'role'
      ? `계정 전체 역할을 ${nextRole === 'org_admin' ? '기관 관리자' : '상담사'}로 변경합니다. 접근 권한이 변경됩니다.`
      : '기관 소속을 해제합니다. 기관 관리자라면 상담사로 변경됩니다. 계정과 과거 상담 기록은 삭제되지 않습니다.'}</p>
    <label className="block">상담사 변경 사유 (필수)
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} required maxLength={2000}
        className={`${control} mt-1 block w-full`} rows={3} />
    </label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex gap-2">
      <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className={control}>취소</button>
      <button type="submit" disabled={busy || !reason.trim()} className={`${control} border-purple-800 text-purple-900`}>{busy ? '처리 중...' : `${label} 실행`}</button>
    </div>
  </form>;
}
