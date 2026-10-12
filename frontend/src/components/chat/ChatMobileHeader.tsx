import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** 한 줄 보조 문구(방 종류·안내). 길면 말줄임. */
  sub?: string;
  onBack: () => void;
  rightSlot?: ReactNode;
}

/**
 * 모바일 채팅방 상단 통합 헤더 — [뒤로] 방 이름 + 한 줄 안내 + 우측 액션을 한 줄 높이로 합친다.
 * (기존: 페이지 타이틀 블록 + '← 대화 목록' 줄 + 안내문 줄이 각각 공간을 차지했다)
 */
export function ChatMobileHeader({ title, sub, onBack, rightSlot }: Props) {
  return (
    <div className="md:hidden flex items-center gap-1 border-b border-[#EFEFEF] bg-white pl-1 pr-3 py-1.5 shrink-0">
      <button
        type="button"
        onClick={onBack}
        aria-label="대화 목록으로"
        className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full text-[#5F0080] active:bg-[#F5EDFC]"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[16px] font-bold leading-[22px] text-[#1F1F1F]">{title}</h1>
        {sub && <p className="truncate text-[12px] leading-[16px] text-[#6F6F6F]">{sub}</p>}
      </div>
      {rightSlot && <div className="shrink-0 flex items-center">{rightSlot}</div>}
    </div>
  );
}

/** 루시(AI) 채널 안내 — 헤더 보조 문구로 쓴다. */
export const LUCY_NOTICE = '상담을 대신하지 않아요 · 피드백은 상담사에게 전달돼요';
export const LUCY_COUNSELOR_NOTICE = '일정과 상담 기록을 확인하고 초안을 정리할 수 있어요';
