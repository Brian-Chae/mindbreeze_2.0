// SDD-321 — 기관 관리자 D안 쉘. 공유 AppShell 은 건드리지 않고, 같은 부수 효과(알림 소켓·채팅방·리포트 미읽음)를 같은 훅으로 재사용한다.
// 데스크톱: 기존 사이드바 유지. 모바일: 상단 바(메뉴·락업·알림) + 큰 제목 + 플로팅 하단 내비.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useReportStore } from '../../stores/reportStore';
import { listChatRooms } from '../../lib/api/chat';
import { useNotificationSocket } from '../../hooks/useNotificationSocket';
import { useMobileMenuSwipe } from '../../hooks/use-mobile-menu-swipe';
import SidebarNav from '../layout/SidebarNav';
import MobileDrawer from '../layout/MobileDrawer';
import NotificationToastHost from '../notifications/notification-toast-host';
import AppUpdateBanner from '../update/AppUpdateBanner';
import { UiV2OrgNav } from './ui-v2-org-nav';
import '../../styles/ui-v2.css';
import '../../styles/ui-v2-brand.css';
import '../../styles/ui-v2-org.css';

export interface UiV2OrgShellProps {
  title: string;
  subtitle?: string;
  /** 큰 제목 오른쪽에 놓는 행동(예: 코치 초대). */
  actions?: ReactNode;
  children: ReactNode;
}

export function UiV2OrgShell({ title, subtitle, actions, children }: UiV2OrgShellProps) {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.user?.id);
  const unread = useNotificationStore((s) => s.unread);
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const chatUnread = useChatStore((s) => s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0));
  const reportPendingReview = useReportStore((s) => s.pendingReview);
  const refreshReports = useReportStore((s) => s.refresh);
  const setRooms = useChatStore((s) => s.setRooms);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const swipe = useMobileMenuSwipe('org_admin', drawerOpen, userId);
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useNotificationSocket();
  useEffect(() => { void refreshReports(); }, [refreshReports]);
  useEffect(() => {
    const snapshot = useChatStore.getState().rooms;
    let active = true;
    listChatRooms()
      .then((res) => { if (active) setRooms(res.rooms, snapshot); })
      .catch(() => { /* 조용히 실패 */ });
    return () => { active = false; };
  }, [setRooms]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [title]);

  const menuBadge = sessionInvites.length;
  const bellBadge = unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null;
  return (
    <div className="h-full w-full md:grid md:grid-cols-[240px_1fr] flex flex-col" data-shell-variant="ui-v2">
      <aside className="hidden md:flex bg-[#F5EDFC] border-r border-[#EFEFEF] flex-col">
        <SidebarNav notificationBadge={unread} chatBadge={chatUnread} reportBadge={reportPendingReview} sessionBadge={sessionInvites.length} />
      </aside>
      <div className="ui-v2 u2-shell min-w-0">
        <div className="u2-toolbar u2-org-toolbar">
          <div className="u2-toolbar-left">
            <button type="button" className="u2-icon-btn u2-org-menu-btn" aria-label={menuBadge ? `메뉴 열기 ${menuBadge}건` : '메뉴 열기'} onClick={() => setDrawerOpen(true)}>
              <svg className="u2-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              {menuBadge > 0 && <span className="u2-dot" aria-hidden="true">{menuBadge > 9 ? '9+' : menuBadge}</span>}
            </button>
            <Link to="/dashboard/org" className="u2-logo" aria-label="MIND BREEZE 홈" data-compact={collapsed || undefined}>
              <img className="u2-logo-symbol" src="/mb-design/assets/logo_symbol_dark.svg" alt="" width={26} height={12} />
              <span className="u2-logo-word" aria-hidden="true">MIND&nbsp;BREEZE</span>
            </Link>
          </div>
          <span className="u2-compact-title" data-shown={collapsed} aria-hidden="true">{title}</span>
          <button type="button" className="u2-icon-btn" aria-label={bellBadge ? `알림 ${bellBadge}건` : '알림'} onClick={() => navigate('/notifications')}>
            <svg className="u2-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 16V10a6 6 0 0 1 12 0v6l2 2H4zM10 21h4" /></svg>
            {bellBadge && <span className="u2-dot" aria-hidden="true">{bellBadge}</span>}
          </button>
        </div>
        <div ref={swipe.containerRef} data-mobile-menu-swipe className="mobile-menu-swipe-viewport flex-1 min-h-0">
          <div data-mobile-swipe-page className="mobile-menu-swipe-page u2-scroll">
            <header className="u2-org-heading" data-mobile-swipe-title>
              <div className="u2-org-titles">
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </div>
              {actions && <div className="u2-org-actions">{actions}</div>}
            </header>
            <div ref={sentinel} aria-hidden="true" style={{ height: 1, marginTop: -1 }} />
            <main className="u2-main u2-main--org">{children}</main>
          </div>
          <p className="sr-only" role="status" aria-live="polite">{swipe.message}</p>
        </div>
        <UiV2OrgNav />
      </div>
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <NotificationToastHost />
      <AppUpdateBanner />
    </div>
  );
}
