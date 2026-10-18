// 하단 탭바(내담자): 홈 / 세션 / 채팅 / 리포트 / 더보기
// useLocation으로 현재 경로 기반 활성 탭 판단
// 배지: 리포트=미열람(is_read), 채팅=미읽음, 세션=초대 대기 — reportStore/chatStore/notificationStore 구독

import { useAgentStore } from '../../stores/agent-store';
import { useLocation, useNavigate } from 'react-router-dom';
import { ICONS, StrokeIcon } from '../layout/SidebarNav';
import { useChatStore } from '../../stores/chatStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useReportStore } from '../../stores/reportStore';
import { term, type TermKey } from '../../lib/terms';

interface TabItem {
  to: string;
  key: TermKey;
  icon: string[];
}

const TAB_ITEMS: TabItem[] = [
  { to: '/app', key: 'home', icon: ICONS.home },
  { to: '/app/classes', key: 'my-class', icon: ICONS.calendar },
  { to: '/app/counseling', key: 'my-counseling', icon: ICONS.users },
  { to: '/app/reports', key: 'report', icon: ICONS.report },
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
  const notificationUnread = useNotificationStore((s) => s.unread);
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const agentUnread = useAgentStore((s) => s.unread);
  const reportUnread = useReportStore((s) => s.unread);

  const moreActive = ['/app/chat', '/app/notifications', '/app/profile'].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const moreBadge = Math.max(notificationUnread, sessionInvites.length) + chatUnread + agentUnread;

  const isActive = (path: string): boolean => {
    if (path === '/app') return pathname === '/app';
    return pathname === path || pathname.startsWith(`${path}/`);
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#EFEFEF] flex items-stretch justify-around"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {TAB_ITEMS.map((tab) => {
        const active = isActive(tab.to);
        const unread =
          tab.key === 'chat'
            ? chatUnread + agentUnread
            : tab.key === 'report'
              ? reportUnread
              : tab.key === 'class'
                ? 0
                : 0;

        return (
          <button
            key={tab.to}
            type="button"
            onClick={() => navigate(tab.to)}
            aria-current={active ? 'page' : undefined}
            className={`relative flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[12px] flex-1 h-14 ${
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
            <span>{term(tab.key)}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onMoreClick}
        aria-current={moreActive ? 'page' : undefined}
        aria-label={moreBadge > 0 ? `더보기 ${moreBadge}건` : '더보기'}
        className={`relative flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[12px] flex-1 h-14 ${moreActive ? 'text-[#5F0080] font-semibold' : 'text-[#6F6F6F]'}` }
      >
        <StrokeIcon d={ICONS.menu} size={22} />
        <span>{term('more')}</span>
        {moreBadge > 0 && <span className="absolute top-1 right-2 min-w-4 rounded-full bg-[#EF4444] px-1 text-[12px] text-white">{moreBadge > 9 ? '9+' : moreBadge}</span>}
      </button>
    </nav>
  );
}
