// 개인정보 섹션 (성별/생년월일/주소) — SDD-077. 선택 입력이며 미입력 상태로도 이용 가능.

import { useState } from 'react';
import type { CounselorProfile, CounselorProfileUpdate } from '../../lib/api/counselor';
import ConfirmDialog from './ConfirmDialog';

interface PersonalInfoSectionProps {
  profile: CounselorProfile;
  onSave: (data: CounselorProfileUpdate) => Promise<void>;
}

interface PersonalDraft {
  gender: string;
  birth_date: string;
  postal_code: string;
  address_line1: string;
  address_line2: string;
}

const toDraft = (p: CounselorProfile): PersonalDraft => ({
  gender: p.gender ?? '',
  birth_date: p.birth_date ?? '',
  postal_code: p.postal_code ?? '',
  address_line1: p.address_line1 ?? '',
  address_line2: p.address_line2 ?? '',
});

const GENDER_LABELS: Record<string, string> = { male: '남성', female: '여성', other: '기타' };

const FIELD_LABEL = 'text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1';
const INPUT_CLASS =
  'w-full px-3 py-2 text-[14px] border border-[#DDDEE7] rounded-lg focus:outline-none focus:border-[#5F0080]';

export default function PersonalInfoSection({ profile, onSave }: PersonalInfoSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PersonalDraft>(() => toDraft(profile));
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
      // 빈 입력은 null(미입력)로 저장한다 — 임의 기본값을 채우지 않는다
      await onSave({
        gender: draft.gender || null,
        birth_date: draft.birth_date || null,
        postal_code: draft.postal_code.trim() || null,
        address_line1: draft.address_line1.trim() || null,
        address_line2: draft.address_line2.trim() || null,
      });
      setEditing(false);
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof PersonalDraft, value: string): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-bold text-[#1F1F1F] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
          개인정보
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

      <p className="text-[12px] text-[#9B9B9B] mb-4">
        선택 입력 항목입니다. 입력하지 않아도 서비스 이용에 제한이 없으며, 상담 운영·연락 목적으로만 사용됩니다.
      </p>

      {editing ? (
        <div className="space-y-4 text-[14px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className={FIELD_LABEL}>성별</div>
              <select
                className={INPUT_CLASS}
                value={draft.gender}
                onChange={(e) => update('gender', e.target.value)}
              >
                <option value="">응답하지 않음</option>
                <option value="male">남성</option>
                <option value="female">여성</option>
                <option value="other">기타</option>
              </select>
            </div>
            <div>
              <div className={FIELD_LABEL}>생년월일</div>
              <input
                type="date"
                className={INPUT_CLASS}
                value={draft.birth_date}
                onChange={(e) => update('birth_date', e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className={FIELD_LABEL}>우편번호</div>
              <input
                className={INPUT_CLASS}
                value={draft.postal_code}
                onChange={(e) => update('postal_code', e.target.value)}
                maxLength={20}
              />
            </div>
            <div>
              <div className={FIELD_LABEL}>주소</div>
              <input
                className={INPUT_CLASS}
                value={draft.address_line1}
                onChange={(e) => update('address_line1', e.target.value)}
                maxLength={300}
              />
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>상세 주소</div>
            <input
              className={INPUT_CLASS}
              value={draft.address_line2}
              onChange={(e) => update('address_line2', e.target.value)}
              maxLength={200}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[14px]">
          <div>
            <div className={FIELD_LABEL}>성별</div>
            <div className="font-medium text-[#1F1F1F]">
              {profile.gender ? GENDER_LABELS[profile.gender] ?? profile.gender : '미입력'}
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>생년월일</div>
            <div className="font-medium text-[#1F1F1F]">{profile.birth_date || '미입력'}</div>
          </div>
          <div className="md:col-span-2">
            <div className={FIELD_LABEL}>주소</div>
            <div className="font-medium text-[#1F1F1F]">
              {profile.address_line1
                ? `${profile.postal_code ? `(${profile.postal_code}) ` : ''}${profile.address_line1}${profile.address_line2 ? ` ${profile.address_line2}` : ''}`
                : '미입력'}
            </div>
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
