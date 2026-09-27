// ClientAppPage의 셸 안에서 렌더링하는 내담자 알림 목록
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotificationCard } from '../../components/notifications/NotificationCard';
import { listNotifications, markRead, markAllRead, resolveNotificationTarget, type NotificationDto } from '../../lib/api/notifications';
import { useNotificationStore } from '../../stores/notificationStore';

export default function ClientNotificationPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<NotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listNotifications(false, 50, 0).then((result) => {
      if (!cancelled) setNotifications(result.notifications);
    }).catch(() => {
      if (!cancelled) setError('알림을 불러오지 못했습니다. 다시 시도해 주세요.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reload]);

  const handleClick = useCallback(async (notification: NotificationDto) => {
    if (!notification.is_read) {
      try {
        await markRead(notification.id);
        setNotifications((previous) => previous.map((item) =>
          item.id === notification.id ? { ...item, is_read: true } : item));
        void useNotificationStore.getState().fetch();
      } catch {
        setError('읽음 저장에 실패했습니다.');
      }
    }
    const target = resolveNotificationTarget(notification.extra, 'client');
    if (target) navigate(target.path);
    else setExpandedId((previous) => previous === notification.id ? null : notification.id);
  }, [navigate]);

  const handleMarkAll = async () => {
    setMarkingAll(true);
    try {
      await markAllRead();
      setNotifications((previous) => previous.map((item) => ({ ...item, is_read: true })));
      void useNotificationStore.getState().fetch();
    } catch {
      setError('전체 읽음 처리에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold">알림</h2>
        <button type="button" onClick={() => void handleMarkAll()} disabled={loading || markingAll}
          className="text-sm text-[#5F0080] disabled:opacity-50">전체 읽음</button>
      </div>
      {error && <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
        {error}
        <button type="button" onClick={() => setReload((value) => value + 1)} className="ml-2 underline">다시 시도</button>
      </div>}
      {loading ? <p role="status">불러오는 중...</p> : notifications.length === 0 ? (
        !error && <p className="rounded-2xl border border-dashed p-12 text-center text-sm text-[#6F6F6F]">아직 알림이 없습니다.</p>
      ) : <div className="space-y-2">
        {notifications.map((notification) => <div key={notification.id}>
          <NotificationCard notification={notification} onClick={() => void handleClick(notification)} />
          {expandedId === notification.id && <p className="whitespace-pre-wrap break-words p-4 text-sm">{notification.body ?? notification.title}</p>}
        </div>)}
      </div>}
    </div>
  );
}
