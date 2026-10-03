// 초대된 클래스 강조 카드 — 내담자 홈/세션 화면 상단에 신규 세션 초대를 표시한다.
// 일반 세션 카드보다 강한 브랜드 강조(보라 테두리 + "초대된 클래스" 배지)로 시선을 끈다.

import type { SessionDto } from '../../lib/api/session';
import { StatusBadge } from '../session/StatusBadge';

interface Props {
  session: SessionDto;
  /** 표시할 상담사 이름 */
  counselorName?: string;
  /** "클래스 확인" 클릭 시 호출 (확인 처리 + 상세 이동) */
  onConfirm: () => void;
}

export function InvitedSessionCard({ session, counselorName, onConfirm }: Props) {
  return (
    <div className="bg-white border-2 border-[#5F0080] rounded-2xl p-[22px] shadow-[0_0_0_4px_rgba(95,0,128,0.08)]">
      <div className="flex items-center justify-between mb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#5F0080] px-2.5 py-1 text-[11px] font-bold text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" aria-hidden />
          초대된 클래스
        </span>
        <StatusBadge status={session.status} />
      </div>
      <h3 className="text-[17px] font-bold text-[#1F1F1F] mb-1 truncate">
        {session.title || '제목 없음'}
      </h3>
      {counselorName && (
        <p className="text-[13px] text-[#6F6F6F] mb-3">{counselorName}</p>
      )}
      <button
        type="button"
        onClick={onConfirm}
        className="mb-btn w-full justify-center text-sm"
      >
        클래스 확인
      </button>
    </div>
  );
}
