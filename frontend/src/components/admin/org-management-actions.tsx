import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api/client';
import {
  patchAdminOrganization, getOrganizationDeactivationImpact,
  deactivateAdminOrganization, reactivateAdminOrganization,
  type AdminOrganizationDetailDto, type OrganizationImpactDto,
} from '../../lib/api/admin';

const control = 'rounded-lg border border-[#DDDEE7] bg-white px-3 py-2 text-sm text-[#1F1F1F] disabled:opacity-50';
const primary = 'rounded-lg border border-[#5F0080] bg-[#5F0080] px-3 py-2 text-sm font-semibold text-white hover:bg-[#4B0066] disabled:opacity-50';
type Props = {
  org: AdminOrganizationDetailDto;
  onSaved: (org: AdminOrganizationDetailDto) => void;
  onReload: () => void;
  onGuardChange: (dirty: boolean, busy: boolean) => void;
};

export default function OrgManagementActions({ org, onSaved, onReload, onGuardChange }: Props) {
  const [mode, setMode] = useState<'view' | 'edit' | 'deactivate' | 'reactivate'>('view');
  const [name, setName] = useState(org.name);
  const [phone, setPhone] = useState(org.phone ?? '');
  const [address, setAddress] = useState(org.address ?? '');
  const [verified, setVerified] = useState(org.verified);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [impact, setImpact] = useState<OrganizationImpactDto | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dirty = mode === 'edit'
    ? name !== org.name || phone !== (org.phone ?? '') || address !== (org.address ?? '') || verified !== org.verified || !!reason
    : mode !== 'view' && (!!reason || !!confirmation || agreed);
  useEffect(() => { onGuardChange(dirty, busy); }, [dirty, busy, onGuardChange]);
  useEffect(() => {
    if (mode === 'deactivate' || mode === 'reactivate') cancelRef.current?.focus();
  }, [mode]);

  const begin = (next: typeof mode) => {
    setMode(next); setError(''); setConflict(false); setReason(''); setConfirmation(''); setAgreed(false);
    setName(org.name); setPhone(org.phone ?? ''); setAddress(org.address ?? ''); setVerified(org.verified);
  };
  const loadImpact = async () => {
    setLoadingImpact(true); setError(''); setImpact(null);
    try { setImpact(await getOrganizationDeactivationImpact(org.id)); }
    catch (e) { setError(e instanceof Error ? e.message : '영향 조회에 실패했습니다.'); }
    finally { setLoadingImpact(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setConflict(false);
    try {
      const updated = mode === 'edit'
        ? await patchAdminOrganization(org.id, { name: name.trim(), phone: phone.trim() || null,
          address: address.trim() || null, verified, ...(reason.trim() ? { reason: reason.trim() } : {}) }, org.version)
        : mode === 'deactivate' && impact
          ? await deactivateAdminOrganization(org.id, { reason: reason.trim(), confirmation_value: confirmation.trim() }, impact.version)
          : await reactivateAdminOrganization(org.id, reason.trim(), org.version);
      setMode('view'); setReason(''); setConfirmation(''); setAgreed(false);
      onGuardChange(false, false); onSaved(updated);
    } catch (e) {
      setConflict(e instanceof ApiError && e.status === 412);
      setError(e instanceof Error ? e.message : '저장하지 못했습니다. 다시 시도해주세요.');
      if (mode === 'deactivate' && e instanceof ApiError && e.status === 409) setImpact(null);
    } finally { setBusy(false); }
  };
  const cancel = () => {
    if (dirty && !window.confirm('변경사항을 버리고 편집을 종료할까요?')) return;
    begin('view');
  };

  return <div className="mt-6 border-t pt-5">
    {mode === 'view' ? <div className="flex flex-wrap items-center gap-3">
      {!org.deactivated_at && <button type="button" className={primary} onClick={() => begin('edit')}>정보 수정</button>}
      {org.deactivated_at ? <>
        <span className="text-sm text-red-700">비활성화된 기관입니다.</span>
        <button type="button" className={control} onClick={() => begin('reactivate')}>기관 재활성화</button>
      </> : <>
        <button type="button" className={`${control} text-red-700`} disabled={org.kind !== 'institution'}
          onClick={() => { begin('deactivate'); void loadImpact(); }}>기관 비활성화</button>
        {org.kind !== 'institution' && <span className="text-xs text-slate-600">개인 기관은 비활성화할 수 없습니다.</span>}
      </>}
    </div> : <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <h3 className="font-bold">{mode === 'edit' ? '기관 정보 수정' : mode === 'deactivate' ? '기관 운영 종료(비활성화)' : '기관 재활성화'}</h3>
      <p className="text-sm">{org.name} · {org.org_code ?? '코드 미등록'} · {org.kind === 'institution' ? '일반 기관' : '개인 기관'}</p>
      <fieldset disabled={busy} className="space-y-4">
        {mode === 'edit' && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">기관명<input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={control} /></label>
            <label className="grid gap-1 text-sm">전화<input maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} className={control} /></label>
            <label className="grid gap-1 text-sm sm:col-span-2">주소<input maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className={control} /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />인증됨</label>
          <p className="text-xs text-slate-600">기관 코드·유형·생성일·소유자는 변경되지 않습니다. 인증 상태 변경에는 수동 조정 사유가 필요합니다.</p>
        </>}
        {mode === 'deactivate' && <>
          {loadingImpact && <p role="status">비활성화 영향을 확인하는 중...</p>}
          {!loadingImpact && !impact && <button type="button" className={control} onClick={() => void loadImpact()}>영향 다시 조회</button>}
          {impact && <div className="space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
            <p>소속 계정 {impact.account_count}명 · 활성 연결 {impact.active_link_count}개</p>
            <p>진행·일시정지 세션 {impact.ongoing_session_count}개 · 예정·대기 세션 {impact.scheduled_session_count}개</p>
            <p>기관 세션·확인 후보 {impact.preserved_session_count}개 · 전체 귀속 확인 필요 {impact.unknown_attribution_count}개</p>
            <p>{impact.attribution_note}</p>
            {impact.blockers.length > 0 && <ul className="list-disc pl-5 text-red-700">{impact.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
          </div>}
          <label className="grid gap-1 text-sm">{org.org_code ? '기관 코드 입력' : '기관명 입력'}<input required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className={control} autoComplete="off" /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
            <span>기관 운영을 종료하고 기본 목록에서 숨깁니다. 계정과 기존 상담 기록은 삭제되지 않습니다. 필요 시 재활성화할 수 있습니다. 이 내용을 확인했습니다.</span>
          </label>
        </>}
        <label className="grid gap-1 text-sm">{mode === 'edit' ? '변경 사유 (인증 변경 시 필수)' : '사유 (필수)'}
          <textarea required={mode !== 'edit' || verified !== org.verified} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} className={control} rows={2} />
        </label>
      </fieldset>
      {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}
        {conflict && <button type="button" disabled={busy} className={`${control} ml-2`} onClick={() => {
          if (!dirty || window.confirm('입력한 변경사항을 버리고 최신 정보를 불러올까요?')) { onGuardChange(false, false); onReload(); }
        }}>최신 정보 다시 불러오기</button>}
      </div>}
      <div className="flex gap-2">
        <button ref={cancelRef} type="button" disabled={busy} className={control} onClick={cancel}>취소</button>
        <button type="submit" className={mode === 'deactivate' ? `${control} bg-red-700 text-white` : primary}
          disabled={busy || conflict || (mode === 'edit' && (!name.trim() || (verified !== org.verified && !reason.trim())))
            || (mode !== 'edit' && !reason.trim()) || (mode === 'deactivate' && (!impact?.can_deactivate || loadingImpact || !agreed || confirmation.trim() !== (org.org_code || org.name)))}>
          {busy ? '처리 중...' : mode === 'edit' ? '저장' : mode === 'deactivate' ? '기관 운영 종료(비활성화)' : '재활성화 실행'}
        </button>
      </div>
    </form>}
  </div>;
}
