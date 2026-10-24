import { getMobileMenuTabs } from '../../lib/mobile-menu-swipe';
import { ICONS } from './SidebarNav';
import { FloatingBottomNav, type FloatingTab } from './floating-bottom-nav';
import ClientBottomTabBar from '../client/BottomTabBar';
import type { UserRole } from '../../lib/api/auth';
import { useChatStore } from '../../stores/chatStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useReportStore } from '../../stores/reportStore';
import { useCounselorAgentStore } from '../../stores/agent-counselor-store';
import { isAiEnabled, isCounselingEnabled } from '../../lib/feature-flags';

export default function BottomTabBar({ onMoreClick, role }: { onMoreClick: () => void; role?: UserRole | null }) {
  const chatUnread = useChatStore(s => s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0));
  const invites = useNotificationStore(s => s.sessionInvites.length);
  const reportBadge = useReportStore(s => s.pendingReview);
  const agentUnread = useCounselorAgentStore(s => s.unread);
  const risk = useCounselorAgentStore(s => s.openRisk);
  if (role === 'client') return <ClientBottomTabBar onMoreClick={onMoreClick} />;
  const counseling = isCounselingEnabled();
  const chatBadge = chatUnread + (role === 'counselor' && isAiEnabled() ? agentUnread + risk : 0);
  const tabs: FloatingTab[] = role === 'platform_admin' ? [
    { to: '/admin/orgs', label: '홈', icon: ICONS.home },
    { to: '/admin/applications', label: '가입 신청', icon: ICONS.report },
    { to: '/admin/users', label: '사용자', icon: ICONS.users },
    { to: '/chat', label: '대화', icon: ICONS.message, badge: chatBadge },
  ] : getMobileMenuTabs(role === 'org_admin' ? 'org_admin' : 'counselor', counseling).map(tab => ({
    ...tab, icon: ICONS[tab.icon], badge: tab.to === '/reports' ? reportBadge : tab.to === '/chat' ? chatBadge : undefined,
  }));
  return <FloatingBottomNav tabs={tabs} moreBadge={invites + (role !== 'platform_admin' && counseling ? reportBadge : 0)} onMoreClick={onMoreClick} />;
}
