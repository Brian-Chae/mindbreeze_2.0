// 내담자 앱 전체 레이아웃 셸
// TopBar + 콘텐츠 영역 + BottomTabBar

import type { ReactNode } from 'react';
import BottomTabBar from './BottomTabBar';

interface ClientShellProps {
  children: ReactNode;
}

export default function ClientShell({ children }: ClientShellProps) {
  return (
    <div className="flex flex-col min-h-screen bg-[#FAFAFA]">
      {/* 상단 고정 TopBar */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-white shadow-sm flex items-center justify-between px-4">
        <h1 className="text-lg font-bold text-[#1F1F1F] tracking-tight">
          마인드브리즈
        </h1>
        <button
          type="button"
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#EFEFEF] transition-colors"
          aria-label="알림"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2Zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z"
              fill="#6F6F6F"
            />
          </svg>
        </button>
      </header>

      {/* 콘텐츠 영역 (TopBar 56px + BottomTabBar 56px 여백) */}
      <main className="flex-1 min-h-0 overflow-y-auto pt-14 pb-14">
        {children}
      </main>

      {/* 하단 고정 BottomTabBar */}
      <BottomTabBar />
    </div>
  );
}
