// 하단 탭바: 홈 / 세션 / 채팅 / 리포트 / 더보기
// useLocation으로 현재 경로 기반 활성 탭 판단

import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ICONS, StrokeIcon } from '../layout/SidebarNav';
import { useChatStore } from '../../stores/chatStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { listReports } from '../../lib/api/reports';

interface TabItem {
  to: string;
  label: string;
  icon: string[];
}

const TAB_ITEMS: TabItem[] = [
  { to: '/app', label: '홈', icon: ICONS.home },
  { to: '/app/sessions', label: '세션', icon: ICONS.calendar },
  { to: '/app/chat', label: '채팅', icon: ICONS.message },
  { to: '/app/reports', label: '리포트', icon: ICONS.report },
];

interface BottomTabBarProps {
  onMoreClick: () => void;
}

export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const chatUnread = useChatStore((s) =>
    s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0),
  );
  const unread = useNotificationStore((s) => s.unread);
  const [reportUnread, setReportUnread] = useState(0);

  // 신규(미확인) 리포트 수 — 알림(리포트 도착) 변화 시 재계산
  useEffect(() => {
    let cancelled = false;
    listReports({ limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setReportUnread(res.reports.filter((r) => !r.is_read).length);
      })
      .catch(() => {
        /* 조용히 실패 */
      });
    return () => {
      cancelled = true;
    };
  }, [unread]);

  const isActive = (path: string): boolean => {
    if (path === '/app') return pathname === '/app';
    return pathname.startsWith(path);
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#EFEFEF] flex items-stretch justify-around"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {TAB_ITEMS.map((tab) => {
        const active = isActive(tab.to);
        const unread = tab.label === '채팅' ? chatUnread : tab.label === '리포트' ? reportUnread : 0;

        return (
          <button
            key={tab.to}
            type="button"
            onClick={() => navigate(tab.to)}
            aria-current={active ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-[11px] flex-1 h-14 ${
              active ? 'text-[#5F0080] font-semibold' : 'text-[#6F6F6F]'
            }`}
          >
            {active && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[#5F0080]" />
            )}
            <span className="relative">
              <StrokeIcon d={tab.icon} size={22} />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onMoreClick}
        className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-[11px] flex-1 h-14 text-[#6F6F6F]"
      >
        <StrokeIcon d={ICONS.menu} size={22} />
        <span>더보기</span>
      </button>
    </nav>
  );
}
