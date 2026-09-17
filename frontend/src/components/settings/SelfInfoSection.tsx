// SDD-080: 내 정보 섹션 (이름/전화 + 선택적으로 성별/생년월일) — PATCH /auth/users/me 기반.
// 회원(client) 및 상담사 프로필이 없는 기관 관리자(org_admin)의 자기 정보 수정에 사용한다.

import { useState } from 'react';
import type { UpdateUserMePayload } from '../../lib/api/auth';
import ConfirmDialog from './ConfirmDialog';

export interface SelfInfoValue {
  email: string;
  name: string;
  phone?: string | null;
  gender?: string | null;
  birth_date?: string | null;
}

interface SelfInfoSectionProps {
  value: SelfInfoValue;
  /** 성별/생년월일 필드 노출 여부 — org_admin 기본 정보 폴백에서는 숨긴다 */
  showPersonal: boolean;
  onSave: (data: UpdateUserMePayload) => Promise<void>;
}

interface Draft {
  name: string;
  phone: string;
  gender: string;
  birth_date: string;
}

const toDraft = (v: SelfInfoValue): Draft => ({
  name: v.name ?? '',
  phone: v.phone ?? '',
  gender: v.gender ?? '',
  birth_date: v.birth_date ?? '',
});

const GENDER_LABELS: Record<string, string> = { male: '남성', female: '여성', other: '기타' };

const FIELD_LABEL = 'text-[12px] text-[#6F6F6F] font-mono uppercase tracking-wider mb-1';
const INPUT_CLASS =
  'w-full px-3 py-2 text-[14px] border border-[#DDDEE7] rounded-lg focus:outline-none focus:border-[#5F0080]';

export default function SelfInfoSection({ value, showPersonal, onSave }: SelfInfoSectionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const startEdit = (): void => {
    setDraft(toDraft(value));
    setEditing(true);
  };

  const cancel = (): void => {
    setDraft(toDraft(value));
    setEditing(false);
  };

  const handleConfirm = async (): Promise<void> => {
    setSaving(true);
    try {
      // 빈 입력은 전송하지 않는다 — BE가 미전송 필드를 유지하므로 null(미입력)이 보존된다
      const payload: UpdateUserMePayload = {};
      if (draft.name.trim()) payload.name = draft.name.trim();
      if (draft.phone.trim()) payload.phone = draft.phone.trim();
      if (showPersonal) {
        if (draft.gender === 'male' || draft.gender === 'female' || draft.gender === 'other') {
          payload.gender = draft.gender;
        }
        if (draft.birth_date) payload.birth_date = draft.birth_date;
      }
      await onSave(payload);
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
          내 정보
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

      {showPersonal && (
        <p className="text-[12px] text-[#9B9B9B] mb-4">
          성별·생년월일은 선택 입력 항목입니다. 입력하지 않아도 서비스 이용에 제한이 없습니다.
        </p>
      )}

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
              {value.email}
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
          {showPersonal && (
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
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[14px]">
          <div>
            <div className={FIELD_LABEL}>이름</div>
            <div className="font-medium text-[#1F1F1F]">{value.name || '-'}</div>
          </div>
          <div>
            <div className={FIELD_LABEL}>이메일</div>
            <div className="font-medium text-[#1F1F1F]">{value.email || '-'}</div>
          </div>
          <div>
            <div className={FIELD_LABEL}>전화번호</div>
            <div className="font-medium text-[#1F1F1F]">{value.phone || '미입력'}</div>
          </div>
          {showPersonal && (
            <>
              <div>
                <div className={FIELD_LABEL}>성별</div>
                <div className="font-medium text-[#1F1F1F]">
                  {value.gender ? GENDER_LABELS[value.gender] ?? value.gender : '미입력'}
                </div>
              </div>
              <div>
                <div className={FIELD_LABEL}>생년월일</div>
                <div className="font-medium text-[#1F1F1F]">{value.birth_date || '미입력'}</div>
              </div>
            </>
          )}
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
