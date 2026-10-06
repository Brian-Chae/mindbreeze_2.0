import type { NotificationDto } from '../../lib/api/notifications';
import { TYPE_ICONS, TYPE_LABELS, timeAgo } from '../../lib/notification-format';

export function NotificationCard({
  notification,
  onClick,
}: {
  notification: NotificationDto;
  onClick: () => void;
}) {
  const icon = TYPE_ICONS[notification.type] ?? '🔔';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white border border-[#EFEFEF] rounded-2xl p-4 hover:shadow-sm transition-all ${
        !notification.is_read ? 'border-l-[3px] border-l-[#5F0080]' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-[20px] mt-0.5 shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span
              className={`text-[14px] ${notification.is_read ? 'text-[#1F1F1F] font-medium' : 'text-[#1F1F1F] font-bold'}`}
            >
              {notification.title}
            </span>
            <span className="text-[11px] text-[#9B9B9B] font-mono shrink-0">
              {timeAgo(notification.created_at)}
            </span>
          </div>
          {notification.body && (
            <div className="text-[13px] text-[#6F6F6F] line-clamp-2">{notification.body}</div>
          )}
          <div className="mt-1.5">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F5EDFC] text-[#5F0080]">
              {TYPE_LABELS[notification.type] ?? notification.type}
            </span>
          </div>
        </div>
        {!notification.is_read && (
          <div className="w-2 h-2 rounded-full bg-[#5F0080] shrink-0 mt-1.5" />
        )}
      </div>
    </button>
  );
}
