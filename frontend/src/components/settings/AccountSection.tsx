// 계정정보 섹션 (이름/이메일/전화번호/프로필사진/소개글)

import { useState } from 'react';
import type { CounselorProfile, CounselorProfileUpdate } from '../../lib/api/counselor';
import ConfirmDialog from './ConfirmDialog';

interface AccountSectionProps {
  profile: CounselorProfile;
  onSave: (data: CounselorProfileUpdate) => Promise<void>;
}

interface AccountDraft {
  name: string;
  phone: string;
  profile_image: string;
  bio: string;
}

const toDraft = (p: CounselorProfile): AccountDraft => ({
  name: p.name ?? '',
  phone: p.phone ?? '',
  profile_image: p.profile_image ?? '',
  bio: p.bio ?? '',
});

const FIELD_LABEL = 'text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1';
const INPUT_CLASS =
  'w-full px-3 py-2 text-[14px] border border-[#DDDEE7] rounded-lg focus:outline-none focus:border-[#5F0080]';

export default function AccountSection({ profile, onSave }: AccountSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AccountDraft>(() => toDraft(profile));
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
        name: draft.name,
        phone: draft.phone,
        profile_image: draft.profile_image,
        bio: draft.bio,
      });
      setEditing(false);
      setConfirmOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof AccountDraft, value: string): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="bg-white border border-[#EFEFEF] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[15px] font-bold text-[#1F1F1F] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#5F0080]" />
          계정 정보
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
            <div className={FIELD_LABEL}>이름</div>
            <input
              className={INPUT_CLASS}
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <div className={FIELD_LABEL}>이메일 (변경 불가)</div>
            <div className="px-3 py-2 text-[14px] text-[#9B9B9B] bg-[#F8FAFC] rounded-lg">
              {profile.email}
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>전화번호</div>
            <input
              className={INPUT_CLASS}
              value={draft.phone}
              onChange={(e) => update('phone', e.target.value)}
              placeholder="010-0000-0000"
            />
          </div>
          <div>
            <div className={FIELD_LABEL}>프로필 사진 (URL)</div>
            <input
              className={INPUT_CLASS}
              value={draft.profile_image}
              onChange={(e) => update('profile_image', e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div>
            <div className={FIELD_LABEL}>소개글</div>
            <textarea
              className={`${INPUT_CLASS} min-h-[80px] resize-y`}
              value={draft.bio}
              onChange={(e) => update('bio', e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[14px]">
          <div className="flex items-center gap-3 md:col-span-2">
            {profile.profile_image ? (
              <img
                src={profile.profile_image}
                alt={profile.name}
                className="w-14 h-14 rounded-full object-cover bg-[#F5EDFC]"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-[#F5EDFC] flex items-center justify-center text-[#5F0080] font-bold text-[18px]">
                {profile.name?.[0] ?? '?'}
              </div>
            )}
            <div>
              <div className="font-bold text-[#1F1F1F] text-[16px]">{profile.name || '-'}</div>
              <div className="text-[12px] text-[#6F6F6F]">{profile.email}</div>
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>전화번호</div>
            <div className="font-medium text-[#1F1F1F]">{profile.phone || '-'}</div>
          </div>
          <div className="md:col-span-2">
            <div className={FIELD_LABEL}>소개글</div>
            <div className="font-medium text-[#1F1F1F] whitespace-pre-line">{profile.bio || '-'}</div>
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
