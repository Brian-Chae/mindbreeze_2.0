// SDD-078: 관리자 비밀번호 재설정 확인 폼 — 대상 요약 + 사유 필수 + 효과 고지
import { useEffect, useRef, useState } from 'react';
import type { PasswordResetIssueResponse } from '../../lib/api/admin';

const control = 'rounded-lg border border-[#DDDEE7] bg-white px-3 py-2 text-sm disabled:opacity-50';

export default function PasswordResetConfirm({ target, submit, onCancel, onSaved, onGuardChange }: {
  target: { name: string; email: string; roleLabel: string };
  submit: (reason: string) => Promise<PasswordResetIssueResponse>;
  onCancel: () => void; onSaved: (message: string) => void;
  onGuardChange: (dirty: boolean, busy: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  useEffect(() => {
    onGuardChange(true, busy);
    return () => onGuardChange(false, false);
  }, [busy, onGuardChange]);
  const send = async () => {
    if (submitting.current || !reason.trim()) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const result = await submit(reason.trim());
      onSaved(result.email_sent
        ? `${target.name}님에게 재설정 링크를 발송했습니다.`
        : '재설정 링크를 발급했지만 이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } catch (err) {
      setError(err instanceof Error ? err.message : '재설정 링크를 발송하지 못했습니다. 다시 시도해주세요.');
    } finally {
      submitting.current = false; setBusy(false);
    }
  };
  return <form aria-label="비밀번호 재설정 확인" onSubmit={(event) => { event.preventDefault(); void send(); }}
    className="mb-4 space-y-3 rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm">
    <h3 className="font-bold">{target.name} · 비밀번호 재설정</h3>
    <p>{target.roleLabel} <strong>{target.name}</strong> ({target.email})의 등록 이메일(=아이디)로
      재설정 링크가 발송됩니다. 링크는 24시간 동안 유효하며, 새 비밀번호 설정 시 모든 기기에서 로그아웃됩니다.</p>
    <label className="block">재설정 사유 (필수)
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} required maxLength={2000}
        className={`${control} mt-1 block w-full`} rows={3} />
    </label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex gap-2">
      <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel} className={control}>취소</button>
      <button type="submit" disabled={busy || !reason.trim()} className={`${control} border-purple-800 text-purple-900`}>
        {busy ? '발송 중...' : '재설정 링크 발송'}</button>
    </div>
  </form>;
}
