// 게스트(비로그인) 채팅 안내 — 채팅방은 회원 전용임을 알리고 회원가입을 유도한다.
// SDD-095 후속: 게스트는 세션 채팅방 접근 권한이 없으므로(백엔드 403), 패널 대신 이 안내를 노출한다.

import { useState } from 'react';

function LockIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

/** 게스트 채팅 안내 — 접힌 알약 버튼(회원 전용)과 펼친 안내 카드(회원가입 유도)를 오간다. */
export function GuestChatNotice() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-label="채팅 안내 열기"
        className="fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-full bg-white/95 px-4 py-3 text-sm font-semibold text-[#5F0080] shadow-lg ring-1 ring-black/5 backdrop-blur transition-colors hover:bg-white"
      >
        <LockIcon />
        <span>채팅은 회원 전용</span>
      </button>
    );
  }

  return (
    <aside
      role="dialog"
      aria-label="채팅 안내"
      className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-white p-5 shadow-2xl ring-1 ring-black/10 md:inset-x-auto md:bottom-4 md:right-4 md:w-[340px] md:rounded-2xl"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-[#5F0080]">
          <LockIcon />
          <h2 className="text-sm font-bold text-[#1F1F1F]">채팅은 회원 전용입니다</h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="닫기"
          className="shrink-0 rounded-lg px-2 py-1 text-sm text-[#6F6F6F] transition-colors hover:bg-[#F2F3F8]"
        >
          닫기
        </button>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[#6F6F6F]">
        채팅방 입장에는 회원가입이 필요합니다. 가입 후 클래스에 다시 참여해 주세요.
      </p>
      <a
        href="/register/client"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 block w-full rounded-xl bg-[#5F0080] py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[#4E0068]"
      >
        회원가입 하기
      </a>
    </aside>
  );
}
