// SDD-318 — 내담자 D안 쉘. 상담사 AppShell·기존 ClientShell 은 건드리지 않고, 같은 부수 효과(알림 소켓·미읽음·채팅방)를 그대로 재사용한다.
// 모바일: 상단 바 + 큰 제목(스크롤하면 작은 제목으로 접힘) + 플로팅 하단 내비. 데스크톱: 기존 사이드바 유지.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAgentStore } from '../../stores/agent-store';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useReportStore } from '../../stores/reportStore';
import { getUnreadCount } from '../../lib/api/agent';
import { listChatRooms } from '../../lib/api/chat';
import { isAiEnabled } from '../../lib/feature-flags';
import { useNotificationSocket } from '../../hooks/useNotificationSocket';
import { useMobileMenuSwipe } from '../../hooks/use-mobile-menu-swipe';
import { UiV2MemberSidebar } from './ui-v2-member-sidebar';
import NotificationToastHost from '../notifications/notification-toast-host';
import AppUpdateBanner from '../update/AppUpdateBanner';
import { UiV2BottomNav } from './ui-v2-bottom-nav';
import { UiV2Logo } from './ui-v2-logo';
import '../../styles/ui-v2.css';
import '../../styles/ui-v2-brand.css';
import '../../styles/ui-v2-pc.css';
import '../../styles/ui-v2-mid.css';

export interface UiV2ClientShellProps {
  title: string;
  subtitle?: string;
  /** 큰 제목 영역에 같이 놓는 행동(예: 클래스 신청). */
  children: ReactNode;
  /** 상세 화면: 큰 제목 대신 뒤로가기 줄을 쓴다. */
  back?: { to: string; label: string };
  hideBottomNav?: boolean;
  /** 뒤로가기 화면에서도 큰 제목(h1)을 보일지. 기본은 뒤로가기가 없을 때만 보인다. */
  heading?: boolean;
  /** 채팅처럼 본문이 스스로 스크롤하는 화면: 본문을 남은 높이에 맞추고 하단 여백을 뺀다. */
  fill?: boolean;
  /** 본문 폭 제한(640px)을 풀고 데스크톱 2단을 허용한다. */
  wide?: boolean;
  /** 상단 바 오른쪽 자리를 알림 대신 쓴다(예: 채팅방 메뉴). */
  trailing?: ReactNode;
  /** 상단 바 알림(종) 버튼 바로 왼쪽에 놓는 보조 행동(홈의 코드 입장). */
  toolbarExtra?: ReactNode;
}

export function UiV2ClientShell({ title, subtitle, children, back, hideBottomNav = false, heading, fill = false, wide = false, trailing, toolbarExtra }: UiV2ClientShellProps) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const userId = useAuthStore((s) => s.user?.id);
  const unread = useNotificationStore((s) => s.unread);
  const chatUnread = useChatStore((s) => s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0));
  const agentUnread = useAgentStore((s) => (isAiEnabled() ? s.unread : 0));
  const reportUnread = useReportStore((s) => s.unread);
  const sessionInvites = useNotificationStore((s) => s.sessionInvites);
  const refreshReports = useReportStore((s) => s.refresh);
  const setRooms = useChatStore((s) => s.setRooms);
  const swipe = useMobileMenuSwipe('client', hideBottomNav, userId);
  const sentinel = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useNotificationSocket();
  useEffect(() => { useAgentStore.getState().setUnread(0); }, [userId]);
  useEffect(() => { void refreshReports(); }, [refreshReports]);
  useEffect(() => {
    listChatRooms().then((res) => setRooms(res.rooms)).catch(() => { /* 조용히 실패 */ });
  }, [setRooms]);
  useEffect(() => {
    if (!isAiEnabled() || pathname.startsWith('/app/chat/lucy')) return;
    let cancelled = false;
    const refresh = () => {
      void getUnreadCount().then((r) => { if (!cancelled) useAgentStore.getState().setUnread(r.unread); }).catch(() => { /* 배지 실패는 이용을 막지 않는다 */ });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [pathname, userId]);

  // 큰 제목이 화면 밖으로 나가면 상단 바에 작은 제목을 보여 준다.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [title]);

  const showHeading = heading ?? !back;
  const bellBadge = unread > 0 ? (unread > 9 ? '9+' : String(unread)) : null;
  return (
    <div className="h-full w-full md:grid md:grid-cols-[240px_1fr] flex flex-col" data-shell-variant="ui-v2">
      <aside className="hidden md:flex bg-[#F5EDFC] border-r border-[#EFEFEF] flex-col">
        <UiV2MemberSidebar notificationBadge={unread} chatBadge={chatUnread + agentUnread} reportBadge={reportUnread} sessionBadge={sessionInvites.length} />
      </aside>
      <div className="ui-v2 u2-shell min-w-0">
        <div className="u2-toolbar">
          {back ? (
            <button type="button" className="u2-icon-btn" aria-label={back.label} onClick={() => navigate(back.to)}>
              <svg className="u2-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 5-7 7 7 7" /></svg>
            </button>
          ) : <UiV2Logo compact={collapsed} />}
          <span className="u2-compact-title" data-shown={collapsed || !!back} aria-hidden="true">{title}</span>
          {toolbarExtra}
          {trailing ?? (
            <button type="button" className="u2-icon-btn" aria-label={bellBadge ? `알림 ${bellBadge}건` : '알림'} onClick={() => navigate('/app/notifications')}>
              <svg className="u2-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 16V10a6 6 0 0 1 12 0v6l2 2H4zM10 21h4" /></svg>
              {bellBadge && <span className="u2-dot" aria-hidden="true">{bellBadge}</span>}
            </button>
          )}
        </div>
        <div ref={swipe.containerRef} data-mobile-menu-swipe className="mobile-menu-swipe-viewport flex-1 min-h-0">
          <div data-mobile-swipe-page className={`mobile-menu-swipe-page u2-scroll${fill ? ' u2-scroll--fill' : ''}`}>
            {showHeading && (
              <header className="u2-heading" data-mobile-swipe-title>
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </header>
            )}
            <div ref={sentinel} aria-hidden="true" style={{ height: 1, marginTop: -1 }} />
            <main className={`u2-main${wide ? ' u2-main--wide' : ''}${fill ? ' u2-main--fill' : ''}`}>{children}</main>
          </div>
          <p className="sr-only" role="status" aria-live="polite">{swipe.message}</p>
        </div>
        {!hideBottomNav && <UiV2BottomNav />}
      </div>
      <NotificationToastHost />
      <AppUpdateBanner />
    </div>
  );
}
