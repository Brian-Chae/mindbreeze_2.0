// SDD-077 주 담당자 정보 수정 — 이름/전화 정정 (담당자 교체 아님)

import { useEffect, useRef, useState } from 'react';
import { patchPrimaryAdminProfile } from '../../lib/api/counselor-info';
import type { OrganizationUserSummaryDto } from '../../lib/api/admin';

const control = 'rounded-lg border border-[#DDDEE7] bg-white px-3 py-2 text-sm disabled:opacity-50';

export default function PrimaryAdminEdit({ orgId, person, onCancel, onSaved, onGuardChange }: {
  orgId: string;
  person: OrganizationUserSummaryDto;
  onCancel: () => void;
  onSaved: () => void;
  onGuardChange: (dirty: boolean, busy: boolean) => void;
}) {
  const [name, setName] = useState(person.name);
  const [phone, setPhone] = useState(person.phone ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  useEffect(() => {
    onGuardChange(true, busy);
    return () => onGuardChange(false, false);
  }, [busy, onGuardChange]);

  const submit = async () => {
    if (submitting.current || !reason.trim()) return;
    if (!name.trim()) { setError('이름은 비울 수 없습니다.'); return; }
    submitting.current = true;
    setBusy(true); setError('');
    try {
      await patchPrimaryAdminProfile(orgId, {
        name: name.trim(),
        phone: phone.trim() || null,
        reason: reason.trim(),
        // 저장 직전 담당자 교체 충돌 감지
        expected_user_id: person.id,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다. 다시 시도해주세요.');
    } finally {
      submitting.current = false; setBusy(false);
    }
  };

  return <form aria-label="주 담당자 정보 수정" onSubmit={(event) => { event.preventDefault(); void submit(); }}
    className="mt-4 space-y-3 rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm">
    <h4 className="font-bold">담당자 정보 수정 (이름·전화)</h4>
    <p className="text-xs text-[#6F6F6F]">담당자 교체가 아니라 신원 정보 정정입니다. 이메일은 아이디로 사용되어 변경할 수 없습니다.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block text-xs text-[#6F6F6F]">이름 (필수)
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} required maxLength={100} className={`${control} mt-1 w-full`} />
      </label>
      <label className="block text-xs text-[#6F6F6F]">전화번호
        <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} maxLength={20} className={`${control} mt-1 w-full`} placeholder="010-0000-0000" />
      </label>
      <div className="sm:col-span-2">
        <span className="block text-xs text-[#6F6F6F]">이메일 (변경 불가)</span>
        <p className="mt-1 rounded-lg bg-slate-100 px-3 py-2 text-[#6F6F6F]">{person.email}</p>
      </div>
    </div>
    <label className="block">변경 사유 (필수)
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} required maxLength={2000}
        rows={2} className={`${control} mt-1 block w-full`} />
    </label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex gap-2">
      <button type="button" disabled={busy} onClick={onCancel} className={control}>취소</button>
      <button type="submit" disabled={busy || !reason.trim()} className={`${control} border-purple-800 text-purple-900`}>
        {busy ? '저장 중...' : '저장'}
      </button>
    </div>
  </form>;
}
