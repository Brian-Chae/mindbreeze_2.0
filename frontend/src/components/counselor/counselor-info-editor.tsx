// SDD-077 상담사 정보 편집 폼 — 플랫폼/기관 관리자 공용 (기본 정보 / 전문 이력 / 개인정보 패널)

import { useEffect, useRef, useState } from 'react';
import type {
  CounselorInfoDto,
  CounselorInfoUpdatePayload,
} from '../../lib/api/counselor-info';
import type { QualificationItem, CareerItem } from '../../lib/api/counselor';

const control = 'rounded-lg border border-[#DDDEE7] bg-white px-3 py-2 text-sm disabled:opacity-50';
const label = 'block text-xs text-[#6F6F6F]';

interface Draft {
  name: string;
  phone: string;
  profile_image: string;
  bio: string;
  gender: string;
  birth_date: string;
  postal_code: string;
  address_line1: string;
  address_line2: string;
  affiliation_type: string;
  years_of_experience: string;
  specialties: string;
  qualifications: QualificationItem[];
  careers: CareerItem[];
}

const toDraft = (p: CounselorInfoDto): Draft => ({
  name: p.name ?? '',
  phone: p.phone ?? '',
  profile_image: p.profile_image ?? '',
  bio: p.bio ?? '',
  gender: p.gender ?? '',
  birth_date: p.birth_date ?? '',
  postal_code: p.postal_code ?? '',
  address_line1: p.address_line1 ?? '',
  address_line2: p.address_line2 ?? '',
  affiliation_type: p.affiliation_type ?? '',
  years_of_experience: p.years_of_experience != null ? String(p.years_of_experience) : '',
  specialties: (p.specialties ?? []).join(', '),
  qualifications: (p.qualifications ?? []).map((q) => ({ ...q })),
  careers: (p.careers ?? []).map((c) => ({ ...c })),
});

// 문자열 입력 → null(삭제) 또는 값. 빈 문자열은 미입력(null)으로 저장한다.
const optional = (value: string): string | null => value.trim() || null;

function buildPayload(profile: CounselorInfoDto, draft: Draft, reason: string): CounselorInfoUpdatePayload | null {
  const payload: CounselorInfoUpdatePayload = { version: profile.version, reason: reason.trim() };
  let changed = false;
  if (draft.name.trim() && draft.name.trim() !== profile.name) { payload.name = draft.name.trim(); changed = true; }
  const optionalFields = ['phone', 'profile_image', 'bio', 'gender', 'birth_date', 'postal_code', 'address_line1', 'address_line2', 'affiliation_type'] as const;
  for (const field of optionalFields) {
    const next = optional(draft[field]);
    if (next !== (profile[field] ?? null)) { payload[field] = next; changed = true; }
  }
  const years = draft.years_of_experience.trim() === '' ? null : Number(draft.years_of_experience);
  if (years !== (profile.years_of_experience ?? null)) { payload.years_of_experience = years; changed = true; }
  const specialties = draft.specialties.split(',').map((s) => s.trim()).filter(Boolean);
  if (JSON.stringify(specialties) !== JSON.stringify(profile.specialties ?? [])) { payload.specialties = specialties; changed = true; }
  const quals = draft.qualifications.filter((q) => q.name.trim() || q.issuer || q.issued_at);
  if (JSON.stringify(quals) !== JSON.stringify(profile.qualifications ?? [])) { payload.qualifications = quals; changed = true; }
  const careers = draft.careers.filter((c) => c.organization.trim() || c.role || c.started_at);
  if (JSON.stringify(careers) !== JSON.stringify(profile.careers ?? [])) { payload.careers = careers; changed = true; }
  return changed ? payload : null;
}

export default function CounselorInfoEditor({ load, save, onSaved, onCancel, onGuardChange }: {
  load: () => Promise<CounselorInfoDto>;
  save: (payload: CounselorInfoUpdatePayload) => Promise<CounselorInfoDto>;
  onSaved: () => void;
  onCancel: () => void;
  onGuardChange?: (dirty: boolean, busy: boolean) => void;
}) {
  const [profile, setProfile] = useState<CounselorInfoDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    load().then(
      (data) => { if (!cancelled) { setProfile(data); setDraft(toDraft(data)); } },
      () => { if (!cancelled) setLoadError(true); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    onGuardChange?.(true, busy);
    return () => onGuardChange?.(false, false);
  }, [busy, onGuardChange]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const submit = async () => {
    if (!profile || !draft || submitting.current) return;
    if (!reason.trim()) { setError('변경 사유를 입력해주세요.'); return; }
    const payload = buildPayload(profile, draft, reason);
    if (!payload) { setError('변경된 항목이 없습니다.'); return; }
    submitting.current = true;
    setBusy(true); setError('');
    try {
      await save(payload);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장하지 못했습니다. 다시 시도해주세요.');
    } finally {
      submitting.current = false; setBusy(false);
    }
  };

  if (loadError) {
    return <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">
      상담사 정보 조회에 실패했습니다.
      <button type="button" className={`${control} ml-2`} onClick={() => setAttempt((n) => n + 1)}>다시 시도</button>
      <button type="button" className={`${control} ml-2`} onClick={onCancel}>닫기</button>
    </div>;
  }
  if (!profile || !draft) return <p role="status" className="mb-4 text-sm">상담사 정보를 불러오는 중...</p>;

  return <form aria-label={`${profile.name} 정보 수정`} onSubmit={(event) => { event.preventDefault(); void submit(); }}
    className="mb-4 space-y-4 rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm">
    <h3 className="font-bold">{profile.name} · 정보 수정</h3>

    <fieldset disabled={busy} className="space-y-3">
      <legend className="font-semibold">기본 정보</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>이름 (필수)
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={100} className={`${control} mt-1 w-full`} />
        </label>
        <div>
          <span className={label}>이메일 (아이디 — 변경 불가)</span>
          <p className="mt-1 rounded-lg bg-slate-100 px-3 py-2 text-[#6F6F6F]">{profile.email}</p>
        </div>
        <label className={label}>전화번호
          <input value={draft.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} className={`${control} mt-1 w-full`} placeholder="010-0000-0000" />
        </label>
        <label className={label}>프로필 사진 URL
          <input value={draft.profile_image} onChange={(e) => set({ profile_image: e.target.value })} maxLength={500} className={`${control} mt-1 w-full`} />
        </label>
      </div>
      <label className={label}>소개
        <textarea value={draft.bio} onChange={(e) => set({ bio: e.target.value })} rows={2} className={`${control} mt-1 w-full`} />
      </label>
    </fieldset>

    <fieldset disabled={busy} className="space-y-3 border-t border-purple-200 pt-3">
      <legend className="font-semibold">개인정보 (선택 입력 — 미입력 유지 가능)</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>성별
          <select value={draft.gender} onChange={(e) => set({ gender: e.target.value })} className={`${control} mt-1 w-full`}>
            <option value="">응답하지 않음</option><option value="male">남성</option><option value="female">여성</option><option value="other">기타</option>
          </select>
        </label>
        <label className={label}>생년월일
          <input type="date" value={draft.birth_date} onChange={(e) => set({ birth_date: e.target.value })} className={`${control} mt-1 w-full`} />
        </label>
        <label className={label}>우편번호
          <input value={draft.postal_code} onChange={(e) => set({ postal_code: e.target.value })} maxLength={20} className={`${control} mt-1 w-full`} />
        </label>
        <label className={label}>주소
          <input value={draft.address_line1} onChange={(e) => set({ address_line1: e.target.value })} maxLength={300} className={`${control} mt-1 w-full`} />
        </label>
        <label className={`${label} sm:col-span-2`}>상세 주소
          <input value={draft.address_line2} onChange={(e) => set({ address_line2: e.target.value })} maxLength={200} className={`${control} mt-1 w-full`} />
        </label>
      </div>
    </fieldset>

    <fieldset disabled={busy} className="space-y-3 border-t border-purple-200 pt-3">
      <legend className="font-semibold">전문 이력</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={label}>활동 형태
          <input value={draft.affiliation_type} onChange={(e) => set({ affiliation_type: e.target.value })} maxLength={50} className={`${control} mt-1 w-full`} />
        </label>
        <label className={label}>경력 연수
          <input type="number" min={0} value={draft.years_of_experience} onChange={(e) => set({ years_of_experience: e.target.value })} className={`${control} mt-1 w-full`} />
        </label>
      </div>
      <label className={label}>전문분야 (쉼표로 구분)
        <input value={draft.specialties} onChange={(e) => set({ specialties: e.target.value })} className={`${control} mt-1 w-full`} placeholder="임상심리, 최면, 명상" />
      </label>

      <div>
        <div className="flex items-center justify-between">
          <span className={label}>자격</span>
          <button type="button" className={control} onClick={() => set({ qualifications: [...draft.qualifications, { name: '', issuer: '', issued_at: '' }] })}>+ 자격 추가</button>
        </div>
        {draft.qualifications.map((q, idx) => <div key={idx} className="mt-2 flex flex-wrap gap-2">
          <input aria-label={`자격명 ${idx + 1}`} value={q.name} placeholder="자격명" className={`${control} min-w-0 flex-1`}
            onChange={(e) => set({ qualifications: draft.qualifications.map((item, i) => i === idx ? { ...item, name: e.target.value } : item) })} />
          <input aria-label={`발급기관 ${idx + 1}`} value={q.issuer ?? ''} placeholder="발급기관" className={`${control} min-w-0 flex-1`}
            onChange={(e) => set({ qualifications: draft.qualifications.map((item, i) => i === idx ? { ...item, issuer: e.target.value } : item) })} />
          <input aria-label={`취득일 ${idx + 1}`} type="date" value={q.issued_at ?? ''} className={control}
            onChange={(e) => set({ qualifications: draft.qualifications.map((item, i) => i === idx ? { ...item, issued_at: e.target.value } : item) })} />
          <button type="button" className={control} onClick={() => set({ qualifications: draft.qualifications.filter((_, i) => i !== idx) })}>삭제</button>
        </div>)}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className={label}>경력</span>
          <button type="button" className={control} onClick={() => set({ careers: [...draft.careers, { organization: '', role: '', started_at: '', ended_at: '', is_current: false }] })}>+ 경력 추가</button>
        </div>
        {draft.careers.map((c, idx) => <div key={idx} className="mt-2 flex flex-wrap items-center gap-2">
          <input aria-label={`근무지 ${idx + 1}`} value={c.organization} placeholder="근무지" className={`${control} min-w-0 flex-1`}
            onChange={(e) => set({ careers: draft.careers.map((item, i) => i === idx ? { ...item, organization: e.target.value } : item) })} />
          <input aria-label={`직무 ${idx + 1}`} value={c.role ?? ''} placeholder="직무" className={`${control} min-w-0 flex-1`}
            onChange={(e) => set({ careers: draft.careers.map((item, i) => i === idx ? { ...item, role: e.target.value } : item) })} />
          <input aria-label={`시작일 ${idx + 1}`} type="date" value={c.started_at ?? ''} className={control}
            onChange={(e) => set({ careers: draft.careers.map((item, i) => i === idx ? { ...item, started_at: e.target.value } : item) })} />
          <input aria-label={`종료일 ${idx + 1}`} type="date" value={c.ended_at ?? ''} disabled={c.is_current} className={control}
            onChange={(e) => set({ careers: draft.careers.map((item, i) => i === idx ? { ...item, ended_at: e.target.value } : item) })} />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={c.is_current}
              onChange={(e) => set({ careers: draft.careers.map((item, i) => i === idx ? { ...item, is_current: e.target.checked } : item) })} />
            재직중
          </label>
          <button type="button" className={control} onClick={() => set({ careers: draft.careers.filter((_, i) => i !== idx) })}>삭제</button>
        </div>)}
      </div>
    </fieldset>

    <label className="block border-t border-purple-200 pt-3">변경 사유 (필수)
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
