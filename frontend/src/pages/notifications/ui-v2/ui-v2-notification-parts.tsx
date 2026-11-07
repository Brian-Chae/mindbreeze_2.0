// SDD-322 — 알림 D안 소품: 알림 행, 오류/빈/로딩 블록. 표시 문구(제목·본문)는 서버 값 그대로, 유형 라벨·시간은 기존 포맷터를 쓴다.
import type { ReactNode } from 'react';
import { Bell, CalendarDays, FileText, MessageCircle, ShieldCheck } from 'lucide-react';
import type { NotificationDto } from '../../../lib/api/notifications';
import { TYPE_LABELS, timeAgo } from '../../../lib/notification-format';
import '../../../styles/ui-v2.css';
import '../../../styles/ui-v2-notifications.css';

const TYPE_ICON: Record<string, ReactNode> = {
  session: <CalendarDays size={20} aria-hidden="true" />,
  chat: <MessageCircle size={20} aria-hidden="true" />,
  report: <FileText size={20} aria-hidden="true" />,
  verification: <ShieldCheck size={20} aria-hidden="true" />,
  system: <Bell size={20} aria-hidden="true" />,
};

export function UiV2NotificationRow({ notification, onOpen, expanded }: { notification: NotificationDto; onOpen: () => void; expanded?: boolean }) {
  const unread = !notification.is_read;
  return (
    <li className="u2-notif-item" data-unread={unread || undefined}>
      <button type="button" className="u2-notif-row" onClick={onOpen} aria-expanded={expanded === undefined ? undefined : expanded}>
        <span className="u2-notif-ico" aria-hidden="true">{TYPE_ICON[notification.type] ?? TYPE_ICON.system}</span>
        <span className="u2-notif-body">
          <span className="u2-notif-top">
            <strong className="u2-notif-title">{notification.title}</strong>
            <small className="u2-notif-time">{timeAgo(notification.created_at)}</small>
          </span>
          {notification.body && <span className="u2-notif-text">{notification.body}</span>}
          <span className="u2-notif-meta">
            <span className="u2-chip">{TYPE_LABELS[notification.type] ?? notification.type}</span>
            {unread && <span className="u2-notif-unread"><span className="u2-notif-dot" aria-hidden="true" />읽지 않음</span>}
          </span>
        </span>
      </button>
      {expanded && <p className="u2-notif-expanded">{notification.body ?? notification.title}</p>}
    </li>
  );
}

export function UiV2NotificationError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="u2-notif-error">
      <span>{message}</span>
      {onRetry && <button type="button" className="u2-textlink" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}

export function UiV2NotificationList({ children, loading, empty, hideEmpty }: { children: ReactNode; loading: boolean; empty: boolean; hideEmpty?: boolean }) {
  if (loading) return <p role="status" className="u2-empty">불러오는 중...</p>;
  if (empty) {
    if (hideEmpty) return null;
    return (
      <div className="u2-card u2-notif-empty">
        <span className="u2-notif-ico" aria-hidden="true"><Bell size={22} /></span>
        <p>아직 알림이 없습니다.</p>
        <small>세션·채팅·리포트 관련 알림이 여기에 표시됩니다.</small>
      </div>
    );
  }
  return <ul className="u2-notif-list">{children}</ul>;
}
