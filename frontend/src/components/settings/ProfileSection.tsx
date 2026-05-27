// 프로필정보 섹션 (소속센터/전문분야/경력연수/자격정보/이력정보)

import { useState } from 'react';
import type {
  CounselorProfile,
  CounselorProfileUpdate,
  QualificationItem,
  CareerItem,
} from '../../lib/api/counselor';
import ConfirmDialog from './ConfirmDialog';

interface ProfileSectionProps {
  profile: CounselorProfile;
  onSave: (data: CounselorProfileUpdate) => Promise<void>;
}

interface ProfileDraft {
  affiliation_type: string;
  specialties: string;
  years_of_experience: string;
  qualifications: QualificationItem[];
  careers: CareerItem[];
}

const toDraft = (p: CounselorProfile): ProfileDraft => ({
  affiliation_type: p.affiliation_type ?? '',
  specialties: (p.specialties ?? []).join(', '),
  years_of_experience: p.years_of_experience != null ? String(p.years_of_experience) : '',
  qualifications: (p.qualifications ?? []).map((q) => ({ ...q })),
  careers: (p.careers ?? []).map((c) => ({ ...c })),
});

const FIELD_LABEL = 'text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1';
const INPUT_CLASS =
  'w-full px-3 py-2 text-[14px] border border-[#DDDEE7] rounded-lg focus:outline-none focus:border-[#5F0080]';

export default function ProfileSection({ profile, onSave }: ProfileSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(() => toDraft(profile));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const startEdit = (): void => {
    setDraft(toDraft(profile));
    setEditing(true);
  };

  const cancel = (): void => {
    setDraft(toDraft(profile));
    setEditing(false);
  };

  const handleConfirm = async (): Promise<void> => {
    setSaving(true);
    try {
      const years = draft.years_of_experience.trim();
      await onSave({
        affiliation_type: draft.affiliation_type,
        specialties: draft.specialties
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        years_of_experience: years ? Number(years) : undefined,
        qualifications: draft.qualifications,
        careers: draft.careers,
      });
      setEditing(false);
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  // 자격정보 동적 리스트 핸들러
  const addQualification = (): void =>
    setDraft((d) => ({
      ...d,
      qualifications: [...d.qualifications, { name: '', issuer: '', issued_at: '' }],
    }));

  const removeQualification = (idx: number): void =>
    setDraft((d) => ({
      ...d,
      qualifications: d.qualifications.filter((_, i) => i !== idx),
    }));

  const updateQualification = (idx: number, key: keyof QualificationItem, value: string): void =>
    setDraft((d) => ({
      ...d,
      qualifications: d.qualifications.map((q, i) => (i === idx ? { ...q, [key]: value } : q)),
    }));

  // 이력정보 동적 리스트 핸들러
  const addCareer = (): void =>
    setDraft((d) => ({
      ...d,
      careers: [
        ...d.careers,
        { organization: '', role: '', started_at: '', ended_at: '', is_current: false },
      ],
    }));

  const removeCareer = (idx: number): void =>
    setDraft((d) => ({ ...d, careers: d.careers.filter((_, i) => i !== idx) }));

  const updateCareer = (
    idx: number,
    key: keyof CareerItem,
    value: string | boolean,
  ): void =>
    setDraft((d) => ({
      ...d,
      careers: d.careers.map((c, i) => (i === idx ? { ...c, [key]: value } : c)),
    }));

  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-bold text-[#1F1F1F] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
          프로필 정보
        </h3>
        {editing ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cancel}
              className="text-[13px] text-[#6F6F6F] hover:text-[#1F1F1F] font-medium px-3 py-1.5"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="text-[13px] text-white bg-[#5F0080] hover:bg-[#3F0055] font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              저장
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="text-[13px] text-[#5F0080] hover:text-[#3F0055] font-medium px-3 py-1.5 rounded-full bg-[#F5EDFC] hover:bg-[#E8D5F8] transition-colors"
          >
            수정
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4 text-[14px]">
          <div>
            <div className={FIELD_LABEL}>소속 센터</div>
            <input
              className={INPUT_CLASS}
              value={draft.affiliation_type}
              onChange={(e) => setDraft((d) => ({ ...d, affiliation_type: e.target.value }))}
            />
          </div>
          <div>
            <div className={FIELD_LABEL}>전문분야 (쉼표로 구분)</div>
            <input
              className={INPUT_CLASS}
              value={draft.specialties}
              onChange={(e) => setDraft((d) => ({ ...d, specialties: e.target.value }))}
              placeholder="임상심리, 최면, 명상"
            />
          </div>
          <div>
            <div className={FIELD_LABEL}>경력연수</div>
            <input
              type="number"
              min="0"
              className={INPUT_CLASS}
              value={draft.years_of_experience}
              onChange={(e) => setDraft((d) => ({ ...d, years_of_experience: e.target.value }))}
            />
          </div>

          {/* 자격정보 동적 리스트 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className={FIELD_LABEL}>자격정보</div>
              <button
                type="button"
                onClick={addQualification}
                className="text-[12px] text-[#5F0080] font-medium hover:text-[#3F0055]"
              >
                + 추가
              </button>
            </div>
            <div className="space-y-3">
              {draft.qualifications.map((q, idx) => (
                <div key={idx} className="border border-[#EFEFEF] rounded-xl p-3 space-y-2 bg-[#FAFAFA]">
                  <div className="flex gap-2">
                    <input
                      className={INPUT_CLASS}
                      value={q.name}
                      onChange={(e) => updateQualification(idx, 'name', e.target.value)}
                      placeholder="자격명"
                    />
                    <button
                      type="button"
                      onClick={() => removeQualification(idx)}
                      className="px-3 text-[13px] text-[#EF4444] font-medium shrink-0"
                    >
                      삭제
                    </button>
                  </div>
                  <input
                    className={INPUT_CLASS}
                    value={q.issuer ?? ''}
                    onChange={(e) => updateQualification(idx, 'issuer', e.target.value)}
                    placeholder="발급기관"
                  />
                  <input
                    type="date"
                    className={INPUT_CLASS}
                    value={q.issued_at ?? ''}
                    onChange={(e) => updateQualification(idx, 'issued_at', e.target.value)}
                  />
                </div>
              ))}
              {draft.qualifications.length === 0 && (
                <div className="text-[13px] text-[#9B9B9B]">등록된 자격정보가 없습니다.</div>
              )}
            </div>
          </div>

          {/* 이력정보 동적 리스트 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className={FIELD_LABEL}>이력정보</div>
              <button
                type="button"
                onClick={addCareer}
                className="text-[12px] text-[#5F0080] font-medium hover:text-[#3F0055]"
              >
                + 추가
              </button>
            </div>
            <div className="space-y-3">
              {draft.careers.map((c, idx) => (
                <div key={idx} className="border border-[#EFEFEF] rounded-xl p-3 space-y-2 bg-[#FAFAFA]">
                  <div className="flex gap-2">
                    <input
                      className={INPUT_CLASS}
                      value={c.organization}
                      onChange={(e) => updateCareer(idx, 'organization', e.target.value)}
                      placeholder="근무지"
                    />
                    <button
                      type="button"
                      onClick={() => removeCareer(idx)}
                      className="px-3 text-[13px] text-[#EF4444] font-medium shrink-0"
                    >
                      삭제
                    </button>
                  </div>
                  <input
                    className={INPUT_CLASS}
                    value={c.role ?? ''}
                    onChange={(e) => updateCareer(idx, 'role', e.target.value)}
                    placeholder="역할/직책"
                  />
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className={INPUT_CLASS}
                      value={c.started_at ?? ''}
                      onChange={(e) => updateCareer(idx, 'started_at', e.target.value)}
                    />
                    <input
                      type="date"
                      className={INPUT_CLASS}
                      value={c.ended_at ?? ''}
                      onChange={(e) => updateCareer(idx, 'ended_at', e.target.value)}
                      disabled={c.is_current}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-[13px] text-[#1F1F1F]">
                    <input
                      type="checkbox"
                      checked={c.is_current}
                      onChange={(e) => updateCareer(idx, 'is_current', e.target.checked)}
                    />
                    재직중
                  </label>
                </div>
              ))}
              {draft.careers.length === 0 && (
                <div className="text-[13px] text-[#9B9B9B]">등록된 이력정보가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-[14px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className={FIELD_LABEL}>소속 센터</div>
              <div className="font-medium text-[#1F1F1F]">{profile.affiliation_type || '-'}</div>
            </div>
            <div>
              <div className={FIELD_LABEL}>경력연수</div>
              <div className="font-medium text-[#1F1F1F]">
                {profile.years_of_experience != null ? `${profile.years_of_experience}년` : '-'}
              </div>
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>전문분야</div>
            {profile.specialties && profile.specialties.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {profile.specialties.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-medium bg-[#F5EDFC] text-[#5F0080]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <div className="font-medium text-[#1F1F1F]">-</div>
            )}
          </div>
          <div>
            <div className={FIELD_LABEL}>자격정보</div>
            {profile.qualifications && profile.qualifications.length > 0 ? (
              <ul className="space-y-1">
                {profile.qualifications.map((q, i) => (
                  <li key={q.id ?? i} className="text-[#1F1F1F]">
                    <span className="font-medium">{q.name}</span>
                    {q.issuer ? <span className="text-[#6F6F6F]"> · {q.issuer}</span> : null}
                    {q.issued_at ? <span className="text-[#9B9B9B]"> ({q.issued_at})</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="font-medium text-[#1F1F1F]">-</div>
            )}
          </div>
          <div>
            <div className={FIELD_LABEL}>이력정보</div>
            {profile.careers && profile.careers.length > 0 ? (
              <ul className="space-y-1">
                {profile.careers.map((c, i) => (
                  <li key={c.id ?? i} className="text-[#1F1F1F]">
                    <span className="font-medium">{c.organization}</span>
                    {c.role ? <span className="text-[#6F6F6F]"> · {c.role}</span> : null}
                    <span className="text-[#9B9B9B]">
                      {' '}
                      ({c.started_at || '?'} ~ {c.is_current ? '재직중' : c.ended_at || '?'})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="font-medium text-[#1F1F1F]">-</div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        message={saving ? '저장 중...' : '변경사항을 저장하시겠습니까?'}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
