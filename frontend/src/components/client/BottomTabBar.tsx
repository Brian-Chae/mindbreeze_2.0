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
  const tabs: FloatingTab[] = [
    { to: '/app', label: '홈', icon: ICONS.home },
    { to: '/app/classes', label: '내 클래스', icon: ICONS.calendar },
    counseling ? { to: '/app/counseling', label: '상담', icon: ICONS.users } : { to: '/app/chat', label: '대화', icon: ICONS.message, badge: conversationBadge },
    { to: '/app/reports', label: '리포트', icon: ICONS.report, badge: reportUnread },
  ];
  return <FloatingBottomNav tabs={tabs} moreBadge={invites + (counseling ? conversationBadge : 0)} onMoreClick={onMoreClick} />;
}
