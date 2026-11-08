// SDD-321 — 기관 관리자 D안 하단 내비. 탭·순서는 기존 BottomTabBar 와 같은 출처(getMobileMenuTabs)를 쓴다.
import { Link, useLocation } from 'react-router-dom';
import { getMobileMenuTabs } from '../../lib/mobile-menu-swipe';
import { useChatStore } from '../../stores/chatStore';
import { useReportStore } from '../../stores/reportStore';
import { isCounselingEnabled } from '../../lib/feature-flags';
import { ICONS } from '../layout/SidebarNav';
import '../../styles/ui-v2.css';

export function UiV2OrgNav() {
  const { pathname } = useLocation();
  const chatUnread = useChatStore((s) => s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0));
  const reportBadge = useReportStore((s) => s.pendingReview);
  const tabs = getMobileMenuTabs('org_admin', isCounselingEnabled()).map((tab) => ({
    ...tab,
    icon: ICONS[tab.icon],
    badge: tab.to === '/reports' ? reportBadge : tab.to === '/chat' ? chatUnread : 0,
  }));
  // 가장 구체적인 탭 하나만 활성화한다.
  const activeTo = tabs
    .filter(({ to }) => pathname === to || pathname.startsWith(`${to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;
  return (
    <div className="u2-nav-wrap md:hidden">
      <nav className="u2-nav" aria-label="하단 메뉴">
        {tabs.map((tab) => (
          <Link key={tab.to} to={tab.to} aria-current={activeTo === tab.to ? 'page' : undefined} aria-label={tab.badge ? `${tab.label} ${tab.badge}건` : tab.label}>
            <span className="u2-nav-ico">
              <svg className="u2-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                {tab.icon.map((d, i) => <path key={i} d={d} />)}
              </svg>
              {tab.badge > 0 && <span className="u2-dot" aria-hidden="true">{tab.badge > 9 ? '9+' : tab.badge}</span>}
            </span>
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
