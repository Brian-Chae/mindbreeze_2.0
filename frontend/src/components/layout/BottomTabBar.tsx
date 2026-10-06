import { NavLink } from 'react-router-dom';
import { ICONS, StrokeIcon } from './SidebarNav';
import type { UserRole } from '../../lib/api/auth';
import { useChatStore } from '../../stores/chatStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useReportStore } from '../../stores/reportStore';

interface TabItem {
  to: string;
  label: string;
  icon: string[];
}

/**
 * NAV-01: 역할별 홈 경로.
 * /dashboard 는 counselor 전용 RoleGuard 라 org_admin·platform_admin 이 탭을 누르면
 * 불일치로 '/'로 리다이렉트된다. 역할이 자기 홈으로 가도록 동적으로 만든다.
 */
function homePathForRole(role: UserRole | null | undefined): string {
  if (role === 'org_admin') return '/dashboard/org';
  if (role === 'platform_admin') return '/admin/orgs';
  if (role === 'client') return '/app';
  return '/dashboard';
}

function tabItemsForRole(role: UserRole | null | undefined): TabItem[] {
  const isClient = role === 'client';
  return [
    { to: homePathForRole(role), label: '홈', icon: ICONS.home },
    { to: isClient ? '/app/sessions' : '/sessions', label: '세션', icon: ICONS.calendar },
    { to: isClient ? '/app/chat' : '/chat', label: '채팅', icon: ICONS.message },
    { to: isClient ? '/app/reports' : '/reports?status=pending', label: '리포트', icon: ICONS.report },
  ];
}

interface BottomTabBarProps {
  onMoreClick: () => void;
  /** 현재 사용자 역할 — 하단 탭 홈 경로·리포트 배지 기준을 역할에 맞춘다(NAV-01) */
  role?: UserRole | null;
}

export default function BottomTabBar({ onMoreClick, role }: BottomTabBarProps) {
  const tabItems = tabItemsForRole(role);
  const chatUnread = useChatStore((s) =>
    s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0),
  );
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const reportUnread = useReportStore((s) => s.unread);
  const pendingReviewCount = useReportStore((s) => s.pendingReview);

  // role별 리포트 배지: 내담자=미열람(is_read), 상담사=검토중(pending_review)
  const reportBadge = role === 'client' ? reportUnread : pendingReviewCount;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-[#EFEFEF] flex items-stretch justify-around"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabItems.map((item) => {
        const unread =
          item.label === '채팅'
            ? chatUnread
            : item.label === '리포트'
              ? reportBadge
              : item.label === '세션'
                ? sessionInvites.length
                : 0;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 text-[11px] flex-1 h-14 ${
                isActive ? 'text-[#5F0080] font-semibold' : 'text-[#6F6F6F]'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[#5F0080]" />
                )}
                <span className="relative">
                  <StrokeIcon d={item.icon} size={22} />
                  {unread > 0 && (
                    <span className="absolute -top-1 -right-1.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
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
