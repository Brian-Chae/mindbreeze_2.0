// SDD-221 — 새 알림 행. 클릭 시 읽음 처리 후 이동 대상이 있으면 이동한다(없으면 읽음만).

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { markRead, resolveNotificationTarget, type NotificationDto } from '../../lib/api/notifications';

interface NotificationRowProps {
  notification: NotificationDto;
  role?: string;
  timeLabel: string;
  /** 읽음 처리 성공 후 호출 (목록에서 제거 등) */
  onRead?: (id: string) => void;
}

export function NotificationRow({ notification: n, role, timeLabel, onRead }: NotificationRowProps) {
  const navigate = useNavigate();

  const handleClick = useCallback(async () => {
    if (!n.is_read) {
      try {
        await markRead(n.id);
        onRead?.(n.id);
      } catch (err) {
        // 읽음 저장 실패해도 이동은 진행한다
        console.warn('알림 읽음 처리 실패', err);
      }
    }
    const target = resolveNotificationTarget(n.extra, role);
    if (target) navigate(target.path);
  }, [n, role, navigate, onRead]);

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      className="flex w-full items-start gap-3 border-b border-[#F0ECF2] py-3.5 text-left last:border-0 hover:bg-[#FAF7FC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5F0080]"
    >
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#5F0080]" />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-[#1F1F1F]">{n.title}</div>
        {n.body && <div className="truncate text-[12px] text-[#6F6F6F]">{n.body}</div>}
        <div className="text-[12px] text-[#767676]">{timeLabel}</div>
      </div>
    </button>
  );
}
