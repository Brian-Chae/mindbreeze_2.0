import { getMobileMenuTabs } from '../../lib/mobile-menu-swipe';
import { useAgentStore } from '../../stores/agent-store';
import { ICONS } from '../layout/SidebarNav';
import { FloatingBottomNav, type FloatingTab } from '../layout/floating-bottom-nav';
import { useChatStore } from '../../stores/chatStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useReportStore } from '../../stores/reportStore';
import { isAiEnabled, isCounselingEnabled } from '../../lib/feature-flags';

export default function BottomTabBar({ onMoreClick }: { onMoreClick: () => void }) {
  const chatUnread = useChatStore(s => s.rooms.reduce((sum, r) => sum + (r.unread_count ?? 0), 0));
  const invites = useNotificationStore(s => s.sessionInvites.length);
  const agentUnread = useAgentStore(s => s.unread);
  const reportUnread = useReportStore(s => s.unread);
  const conversationBadge = chatUnread + (isAiEnabled() ? agentUnread : 0);
  const counseling = isCounselingEnabled();
  const tabs: FloatingTab[] = getMobileMenuTabs('client', counseling).map(tab => ({
    ...tab, icon: ICONS[tab.icon], badge: tab.to === '/app/chat' ? conversationBadge : tab.to === '/app/reports' ? reportUnread : undefined,
  }));
  return <FloatingBottomNav tabs={tabs} moreBadge={invites + (counseling ? conversationBadge : 0)} onMoreClick={onMoreClick} />;
}
