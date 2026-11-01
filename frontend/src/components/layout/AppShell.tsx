import { PageHeader } from '../ui/page-header';
import { useMobileMenuSwipe } from '../../hooks/use-mobile-menu-swipe';
import { useState, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import SidebarNav, { ICONS, StrokeIcon } from './SidebarNav';
import MobileDrawer from './MobileDrawer';
import BottomTabBar from './BottomTabBar';
import { isCounselingEnabled } from '../../lib/feature-flags';
import { useNotificationStore } from '../../stores/notificationStore';
import { useChatStore } from '../../stores/chatStore';
import { useReportStore } from '../../stores/reportStore';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationSocket } from '../../hooks/useNotificationSocket';
import { listChatRooms } from '../../lib/api/chat';
import NotificationToastHost from '../notifications/notification-toast-host';
import AppUpdateBanner from '../update/AppUpdateBanner';

export interface AppShellProps {
  children: ReactNode;
  /** 새 읽기 화면에서만 적용하는 셸 스타일. */
  variant?: 'default' | 'structure';
  title: string;
  sub?: string;
  rightSlot?: ReactNode;
  contentPad?: string;
  noScroll?: boolean;
  noBottomPad?: boolean;
  hideBottomTab?: boolean;
  /** 모바일 페이지 타이틀 블록 숨김(채팅방처럼 화면이 자체 헤더를 가질 때). */
  hideMobileTitle?: boolean;
  /** 목록·대시보드형 본문을 1200px(mb-content) 가운데 정렬로 감싼다. */
  wide?: boolean;
}

export default function AppShell({
  children,
  variant = 'default',
  title,
  sub,
  rightSlot,
  contentPad = 'px-4 py-4 md:px-8 md:py-6 lg:px-10 lg:pt-8 lg:pb-10',
  noScroll = false,
  noBottomPad = false,
  hideBottomTab = false,
  hideMobileTitle = false,
  wide = false,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const unread = useNotificationStore((s) => s.unread);
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  // NAV-01: 하단 탭 홈 경로를 역할에 맞춘다(org_admin → /dashboard/org).
  const userRole = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.id);
  const swipe = useMobileMenuSwipe(userRole, drawerOpen || hideBottomTab, userId);
  const chatUnread = useChatStore((s) =>
    s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0),
  );
  const reportPendingReview = useReportStore((s) => s.pendingReview);
  const menuBadge = sessionInvites.length + (userRole !== 'platform_admin' && isCounselingEnabled() ? reportPendingReview : 0);
  const refreshReports = useReportStore((s) => s.refresh);

  // Socket.IO 실시간 알림 리스너 + 최초 fetch
  useNotificationSocket();

  // 채팅방 목록 불러오기 (사이드바 뱃지용)
  const setRooms = useChatStore((s) => s.setRooms);
  useEffect(() => {
    const snapshot = useChatStore.getState().rooms;
    let active = true;
    listChatRooms()
      .then((res) => { if (active) setRooms(res.rooms, snapshot); })
      .catch(() => { /* 조용히 실패 */ });
    return () => { active = false; };
  }, [setRooms]);

  // 리포트 미읽음 수 초기 로드 (사이드바·하단 탭 공용 배지)
  useEffect(() => {
    void refreshReports();
  }, [refreshReports]);


  const handleBellClick = () => {
    navigate('/notifications');
  };

  return (
    <div data-shell-variant={variant} className="h-full w-full bg-[#F7F4F0] font-sans text-[#1F1F1F] md:grid md:grid-cols-[240px_minmax(0,1fr)] flex flex-col">
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex bg-[#F5EDFC] border-r border-[#EFEFEF] flex-col">
        <SidebarNav
          notificationBadge={unread}
          chatBadge={chatUnread}
          reportBadge={reportPendingReview}
          sessionBadge={sessionInvites.length}
        />
      </aside>

      {/* 모바일 헤더 */}
      <header className="mb-shell-topbar md:hidden h-14 flex items-center justify-between px-4 border-b border-[#EFEFEF] bg-white shrink-0">
        <button
          type="button"
          aria-label={menuBadge ? `메뉴 열기 ${menuBadge}건` : '메뉴 열기'}
          onClick={() => setDrawerOpen(true)}
          className="relative min-w-11 min-h-11 flex items-center justify-center -ml-2 text-[#1F1F1F]"
        >
          <StrokeIcon d={ICONS.hamburger} size={22} />
          {menuBadge > 0 && <span aria-hidden="true" className="absolute top-0 right-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#B3264B] text-white text-[10px] font-bold">{menuBadge > 9 ? '9+' : menuBadge}</span>}
        </button>
        <button
          type="button"
          aria-label="홈으로 이동"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2"
        >
          <img
            src="/mb-design/assets/logo_symbol_dark.svg"
            width={30}
            height={14}
            alt=""
          />
          <span className="font-extrabold text-[18px] text-[#5F0080] tracking-tight">
            Mind&nbsp;Breeze
          </span>
        </button>
        <button
          type="button"
          aria-label="알림"
          onClick={handleBellClick}
          className="w-10 h-10 flex items-center justify-center -mr-2 text-[#1F1F1F] relative"
        >
          <StrokeIcon d={ICONS.bell} size={22} />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </header>

      <section className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* 데스크톱 헤더 */}
        <header className="hidden md:flex h-[76px] px-8 items-center justify-between border-b border-[#EFEFEF] shrink-0">
          <PageHeader title={title} sub={sub} actions={rightSlot} />
          <div className="flex items-center gap-3 relative ml-3">
            <button
              type="button"
              aria-label="알림"
              onClick={handleBellClick}
              className="w-11 h-11 rounded-full bg-[#F2F3F8] flex items-center justify-center text-[#1F1F1F] hover:bg-[#E6E7EE] transition-colors relative"
            >
              <StrokeIcon d={ICONS.bell} />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* 모바일 페이지 타이틀 */}
        {!hideMobileTitle && (title || sub || rightSlot) && (
          <PageHeader title={title} sub={sub} actions={rightSlot} mobile className="md:hidden px-4 pt-4 pb-2" />
        )}

        <div ref={swipe.containerRef} data-mobile-menu-swipe className="mobile-menu-swipe-viewport flex-1 min-h-0">
        <div data-mobile-swipe-page
          className={`mobile-menu-swipe-page flex-1 min-h-0 bg-[#F7F4F0] ${noScroll ? '' : 'overflow-auto'} ${contentPad} ${noBottomPad || hideBottomTab ? '' : 'pb-[calc(100px+env(safe-area-inset-bottom,0px))]'} md:pb-0`}
        >
          {wide ? <div data-ui="page-wide" className="mx-auto w-full max-w-mb-content">{children}</div> : children}
        </div>
        <p className="sr-only" role="status" aria-live="polite">{swipe.message}</p>
        </div>
      </section>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {!hideBottomTab && <BottomTabBar role={userRole} />}
      <NotificationToastHost />
      <AppUpdateBanner />
    </div>
  );
}
