// 하단 탭바: 오늘 / 채팅 / 세션 / 프로필
// useLocation으로 현재 경로 기반 활성 탭 판단

import { useLocation, useNavigate } from 'react-router-dom';
import { useChatStore } from '../../stores/chatStore';
import type { ReactNode } from 'react';

interface TabItem {
  key: string;
  label: string;
  path: string;
  icon: (active: boolean) => ReactNode;
  badge?: number;
}

const TAB_ITEMS: Omit<TabItem, 'badge'>[] = [
  {
    key: 'home',
    label: '오늘',
    path: '/app',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        {active ? (
          <path
            d="M12 3L4 9v12h5v-7h6v7h5V9L12 3Z"
            fill="currentColor"
          />
        ) : (
          <path
            d="M12 5.69l5 4.5V19h-3v-6H10v6H7v-8.81l5-4.5M12 3L2 12h3v9h6v-6h2v6h6v-9h3L12 3Z"
            fill="currentColor"
          />
        )}
      </svg>
    ),
  },
  {
    key: 'chat',
    label: '채팅',
    path: '/app/chat',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        {active ? (
          <path
            d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z"
            fill="currentColor"
          />
        ) : (
          <path
            d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Zm0 14H5.17L4 17.17V4h16v12Z"
            fill="currentColor"
          />
        )}
      </svg>
    ),
  },
  {
    key: 'sessions',
    label: '세션',
    path: '/app/sessions',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        {active ? (
          <path
            d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm0 16H5V8h14v11Z"
            fill="currentColor"
          />
        ) : (
          <path
            d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm0 16H5V10h14v9Zm0-11H5V5h14v3Z"
            fill="currentColor"
          />
        )}
      </svg>
    ),
  },
  {
    key: 'profile',
    label: '프로필',
    path: '/app/profile',
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        {active ? (
          <path
            d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z"
            fill="currentColor"
          />
        ) : (
          <path
            d="M12 6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2Zm0 10c2.7 0 5.8 1.29 6 2H6c.23-.72 3.31-2 6-2Zm0-12C9.79 4 8 5.79 8 8s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4Zm0 10c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z"
            fill="currentColor"
          />
        )}
      </svg>
    ),
  },
];

export default function BottomTabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const totalUnread = useChatStore((s) =>
    s.rooms.reduce((sum, r) => sum + (r.unread_count || 0), 0)
  );

  const isActive = (path: string): boolean => {
    if (path === '/app') return pathname === '/app';
    return pathname.startsWith(path);
  };

  // 탭별 배지 수 (채팅에만 적용)
  const badgeFor = (key: string): number | undefined => {
    if (key === 'chat' && totalUnread > 0) return totalUnread;
    return undefined;
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#EFEFEF]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        {TAB_ITEMS.map((tab) => {
          const active = isActive(tab.path);
          const badge = badgeFor(tab.key);

          return (
            <button
              key={tab.key}
              type="button"
              className="relative flex flex-col items-center justify-center min-w-0 flex-1 h-full"
              onClick={() => navigate(tab.path)}
            >
              <span
                className={
                  active ? 'text-[#5F0080]' : 'text-[#6F6F6F]'
                }
              >
                {tab.icon(active)}
              </span>
              <span
                className={`text-[10px] mt-0.5 leading-none ${
                  active
                    ? 'text-[#5F0080] font-semibold'
                    : 'text-[#6F6F6F]'
                }`}
              >
                {tab.label}
              </span>
              {badge !== undefined && (
                <span className="absolute top-1 right-1/3 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
