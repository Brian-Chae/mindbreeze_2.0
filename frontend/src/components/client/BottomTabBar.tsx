// 하단 탭바: 홈 / 채팅 / 세션 / 리포트 / 더보기 (상담사와 동일 패턴)
// useLocation으로 현재 경로 기반 활성 탭 판단

import { useLocation, useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import { ICONS, StrokeIcon } from '../layout/SidebarNav';

interface TabItem {
  to: string;
  label: string;
  icon: string[];
}

const TAB_ITEMS: TabItem[] = [
  { to: '/app', label: '홈', icon: ICONS.home },
  { to: '/app/chat', label: '채팅', icon: ICONS.message },
  { to: '/app/sessions', label: '세션', icon: ICONS.calendar },
  { to: '/app/reports', label: '리포트', icon: ICONS.report },
];

interface BottomTabBarProps {
  onMoreClick: () => void;
}

export default function BottomTabBar({ onMoreClick }: BottomTabBarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const totalUnread = useChatStore((s) =>
    s.rooms.reduce((sum, r) => sum + (r.unread_count || 0), 0)
  );

  const isActive = (path: string): boolean => {
    if (path === '/app') return pathname === '/app';
    return pathname.startsWith(path);
  };

  // 채팅 탭에만 안 읽은 배지 표시
  const badgeFor = (path: string): number | undefined => {
    if (path === '/app/chat' && totalUnread > 0) return totalUnread;
    return undefined;
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#EFEFEF] flex items-stretch justify-around"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {TAB_ITEMS.map((tab) => {
        const active = isActive(tab.to);
        const badge = badgeFor(tab.to);

        return (
          <button
            key={tab.to}
            type="button"
            onClick={() => navigate(tab.to)}
            className={`relative flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-[11px] flex-1 h-14 ${
              active ? 'text-[#5F0080] font-semibold' : 'text-[#6F6F6F]'
            }`}
          >
            {active && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[#5F0080]" />
            )}
            <StrokeIcon d={tab.icon} size={22} />
            <span>{tab.label}</span>
            {badge !== undefined && (
              <span className="absolute top-0.5 right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
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
