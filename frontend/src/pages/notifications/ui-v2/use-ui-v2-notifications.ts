// SDD-322 — 알림 D안 공용 훅. 구버전(ClientNotificationPage·NotificationCenterPage)과 같은 API·스토어 함수를 호출한다.
// 목록 50건 조회, 읽음 처리 후 전역 뱃지 재조회, 전체 읽음, 딥링크 이동 규칙을 그대로 보존한다.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listNotifications, markRead, markAllRead, resolveNotificationTarget, type NotificationDto } from '../../../lib/api/notifications';
import { useNotificationStore } from '../../../stores/notificationStore';

export interface UseUiV2NotificationsOptions {
  /** 딥링크 해석에 쓰는 역할(내담자는 'client'). */
  role: string | undefined;
  /** 딥링크가 없을 때 본문을 펼칠지(내담자 구버전 동작). */
  expandWhenNoTarget?: boolean;
  /** 읽음 저장 실패를 화면에 알릴지(내담자 구버전은 알리고, 상담 쪽은 조용히 이동을 허용). */
  surfaceReadError?: boolean;
  loadErrorMessage: string;
  readErrorMessage?: string;
  markAllErrorMessage: string;
}

export function useUiV2Notifications(options: UseUiV2NotificationsOptions) {
  const { role, expandWhenNoTarget = false, surfaceReadError = false, loadErrorMessage, readErrorMessage = '읽음 저장에 실패했습니다.', markAllErrorMessage } = options;
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
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error && err.message ? err.message : loadErrorMessage);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reload, loadErrorMessage]);

  const open = useCallback(async (notification: NotificationDto) => {
    if (!notification.is_read) {
      try {
        await markRead(notification.id);
        setNotifications((previous) => previous.map((item) => item.id === notification.id ? { ...item, is_read: true } : item));
        // 상단 헤더·사이드바 뱃지는 전역 unread 를 쓴다 — 읽음 처리 후 재조회한다.
        void useNotificationStore.getState().fetch();
      } catch (err) {
        if (surfaceReadError) setError(err instanceof Error && err.message ? err.message : readErrorMessage);
      }
    }
    const target = resolveNotificationTarget(notification.extra, role);
    if (target) navigate(target.path);
    else if (expandWhenNoTarget) setExpandedId((previous) => previous === notification.id ? null : notification.id);
  }, [navigate, role, expandWhenNoTarget, surfaceReadError, readErrorMessage]);

  const markAll = useCallback(async () => {
    setMarkingAll(true);
    try {
      await markAllRead();
      setNotifications((previous) => previous.map((item) => ({ ...item, is_read: true })));
      void useNotificationStore.getState().fetch();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : markAllErrorMessage);
    } finally {
      setMarkingAll(false);
    }
  }, [markAllErrorMessage]);

  const retry = useCallback(() => setReload((value) => value + 1), []);
  const clearError = useCallback(() => setError(null), []);
  const unreadCount = notifications.filter((item) => !item.is_read).length;

  return { notifications, loading, error, setError, clearError, expandedId, markingAll, unreadCount, open, markAll, retry };
}
