// 내담자 프로필정보 섹션 (성별/생년월일/고민분야/관심분야)

import { useState } from 'react';
import type { ClientProfile, ClientProfileUpdate } from '../../lib/api/client-profile';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  profile: ClientProfile;
  onSave: (data: ClientProfileUpdate) => Promise<void>;
}

interface Draft {
  gender: string;
  birth_date: string;
  concerns: string;
  interests: string;
}

const toDraft = (p: ClientProfile): Draft => ({
  gender: p.gender ?? '',
  birth_date: p.birth_date ?? '',
  concerns: (p.concerns ?? []).join(', '),
  interests: (p.interests ?? []).join(', '),
});

const FIELD_LABEL = 'text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1';
const INPUT_CLASS =
  'w-full px-3 py-2 text-[14px] border border-[#DDDEE7] rounded-lg focus:outline-none focus:border-[#5F0080]';

const GENDER_OPTIONS = [
  { value: '', label: '선택 안 함' },
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
  { value: 'other', label: '기타' },
];

const VALUE_LABEL: Record<string, string> = {
  male: '남성',
  female: '여성',
  other: '기타',
};

export default function ClientProfileSection({ profile, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
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
      await onSave({
        gender: draft.gender || undefined,
        birth_date: draft.birth_date || undefined,
        concerns: draft.concerns
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        interests: draft.interests
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setEditing(false);
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof Draft, value: string): void =>
    setDraft((d) => ({ ...d, [key]: value }));

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
            <div className={FIELD_LABEL}>성별</div>
            <select
              className={INPUT_CLASS}
              value={draft.gender}
              onChange={(e) => update('gender', e.target.value)}
            >
              {GENDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className={FIELD_LABEL}>생년월일</div>
            <input
              className={INPUT_CLASS}
              type="date"
              value={draft.birth_date}
              onChange={(e) => update('birth_date', e.target.value)}
            />
          </div>
          <div>
            <div className={FIELD_LABEL}>고민 분야 (쉼표로 구분)</div>
            <input
              className={INPUT_CLASS}
              value={draft.concerns}
              onChange={(e) => update('concerns', e.target.value)}
              placeholder="예: 불안, 우울, 관계"
            />
          </div>
          <div>
            <div className={FIELD_LABEL}>관심 분야 (쉼표로 구분)</div>
            <input
              className={INPUT_CLASS}
              value={draft.interests}
              onChange={(e) => update('interests', e.target.value)}
              placeholder="예: 명상, 운동, 음악"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[14px]">
          <div>
            <div className={FIELD_LABEL}>성별</div>
            <div className="font-medium text-[#1F1F1F]">
              {profile.gender ? VALUE_LABEL[profile.gender] ?? profile.gender : '-'}
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>생년월일</div>
            <div className="font-medium text-[#1F1F1F]">{profile.birth_date || '-'}</div>
          </div>
          <div className="md:col-span-2">
            <div className={FIELD_LABEL}>고민 분야</div>
            <div className="flex flex-wrap gap-1.5">
              {profile.concerns.length === 0
                ? <span className="text-[#9B9B9B]">-</span>
                : profile.concerns.map((c) => (
                    <span
                      key={c}
                      className="px-2 py-0.5 text-[12px] rounded-full bg-[#F5EDFC] text-[#5F0080]"
                    >
                      {c}
                    </span>
                  ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <div className={FIELD_LABEL}>관심 분야</div>
            <div className="flex flex-wrap gap-1.5">
              {profile.interests.length === 0
                ? <span className="text-[#9B9B9B]">-</span>
                : profile.interests.map((i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-[12px] rounded-full bg-[#E0F2FE] text-[#075985]"
                    >
                      {i}
                    </span>
                  ))}
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
