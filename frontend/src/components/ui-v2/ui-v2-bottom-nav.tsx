// SDD-318 — D안 하단 내비. 메뉴 순서·배지는 기존 BottomTabBar 와 같은 출처(getMobileMenuTabs)를 쓴다.
import { Link, useLocation } from 'react-router-dom';
import { getMobileMenuTabs } from '../../lib/mobile-menu-swipe';
import { useAgentStore } from '../../stores/agent-store';
import { useChatStore } from '../../stores/chatStore';
import { useReportStore } from '../../stores/reportStore';
import { isAiEnabled, isCounselingEnabled } from '../../lib/feature-flags';
import { ICONS } from '../layout/SidebarNav';
import '../../styles/ui-v2.css';

export function UiV2BottomNav() {
  const { pathname } = useLocation();
  const chatUnread = useChatStore((s) => s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0));
  const agentUnread = useAgentStore((s) => s.unread);
  const reportUnread = useReportStore((s) => s.unread);
  const conversationBadge = chatUnread + (isAiEnabled() ? agentUnread : 0);
  const tabs = getMobileMenuTabs('client', isCounselingEnabled()).map((tab) => ({
    ...tab,
    icon: ICONS[tab.icon],
    badge: tab.to === '/app/chat' ? conversationBadge : tab.to === '/app/reports' ? reportUnread : 0,
  }));
  // 가장 구체적인 탭 하나만 활성화한다.
  const activeTo = tabs
    .filter(({ to }) => pathname === to || (to !== '/app' && pathname.startsWith(`${to}/`)))
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
