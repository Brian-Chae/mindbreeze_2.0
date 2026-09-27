import type { NotificationDto } from '../../lib/api/notifications';

export const TYPE_ICONS: Record<string, string> = {
  session: '📅',
  chat: '💬',
  report: '📄',
  verification: '✅',
  system: '🔔',
};

export const TYPE_LABELS: Record<string, string> = {
  session: '세션',
  chat: '채팅',
  report: '리포트',
  verification: '검증',
  system: '시스템',
};

export const EVENT_LABELS: Record<string, string> = {
  session_booked: '세션 예약',
  session_updated: '세션 변경',
  session_cancelled: '세션 취소',
  chat_message: '채팅 메시지',
  report_ready: '리포트 발행',
  verification_result: '검증 결과',
};

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

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

