// SDD-250: 공용 인앱 토스트 — 모바일·앱·데스크톱 모두 종 아이콘 아래에 표시한다.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import {
  notePlayerEntry, takePlayerEntry, useNotificationStore, type QueuedToast,
} from '../../stores/notificationStore';
import { getUnreadCount, markRead, resolveNotificationTarget } from '../../lib/api/notifications';
import { MAX_VISIBLE_TOASTS, isPlayerPath } from '../../lib/notification-toast';
import './notification-toast-host.css';

const SWIPE_DISMISS_PX = 40;

function ToastItem({ item, onOpen }: { item: QueuedToast; onOpen: (item: QueuedToast) => void }) {
  const dismiss = useNotificationStore((s) => s.dismissToast);
  const pause = useNotificationStore((s) => s.pauseToast);
  const resume = useNotificationStore((s) => s.resumeToast);
  const startY = useRef<number | null>(null);
  const isClass = item.kind === 'class';
  return (
    <div
      className={`nt-toast nt-toast--${item.kind}`}
      data-testid="notification-toast"
      role="status"
      aria-live={isClass ? 'assertive' : 'polite'}
      onMouseEnter={() => pause(item.id)}
      onMouseLeave={() => resume(item.id)}
      onTouchStart={(e) => { startY.current = e.touches[0]?.clientY ?? null; pause(item.id); }}
      onTouchEnd={(e) => {
        const end = e.changedTouches[0]?.clientY ?? null;
        if (startY.current != null && end != null && startY.current - end > SWIPE_DISMISS_PX) dismiss(item.id);
        else resume(item.id);
        startY.current = null;
      }}
    >
      <button type="button" className="nt-toast__body" onClick={() => onOpen(item)}>
        {isClass && <span className="nt-toast__live"><i aria-hidden="true" />지금 입장 가능</span>}
        <b className="nt-toast__title">{item.title}{item.count > 1 ? ` · ${item.count}건` : ''}</b>
        {item.body && <span className="nt-toast__text">{item.body}</span>}
        {isClass && <span className="nt-toast__go" data-testid="toast-enter">입장하기</span>}
      </button>
      <button type="button" className="nt-toast__close" aria-label="알림 닫기" onClick={() => dismiss(item.id)}>✕</button>
    </div>
  );
}

export default function NotificationToastHost() {
  const toasts = useNotificationStore((s) => s.toasts);
  const dismiss = useNotificationStore((s) => s.dismissToast);
  const role = useAuthStore((s) => s.user?.role);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isClient = role === 'client';

  // D1: 수업 화면으로 나가면 그 시점 읽지 않은 수를 기억하고, 돌아오면 증가분을 '놓친 알림 N건' 1개로 요약한다.
  useEffect(() => {
    const before = takePlayerEntry();
    if (before != null && !isPlayerPath(pathname)) {
      void getUnreadCount().then((r) => {
        const missed = r.unread - before;
        if (missed > 0) useNotificationStore.getState().showMissedSummary(missed);
      }).catch(() => {});
    }
    return () => {
      if (isPlayerPath(window.location.pathname)) notePlayerEntry(useNotificationStore.getState().unread);
    };
  }, [pathname]);

  useEffect(() => {
    if (toasts.length === 0) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toasts.length, dismiss]);

  if (toasts.length === 0) return null;
  const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);
  const hidden = toasts.length - visible.length;

  const open = (item: QueuedToast): void => {
    if (item.kind === 'summary') navigate(isClient ? '/app/notifications' : '/notifications');
    else {
      const target = resolveNotificationTarget(item.extra, role);
      if (target) navigate(target.path);
      // 누르면 읽음 처리(임시 id 는 서버 호출 생략)
      if (/^[0-9a-f-]{36}$/i.test(item.id)) void markRead(item.id).then(() => useNotificationStore.getState().fetch()).catch(() => {});
    }
    dismiss(item.id);
  };

  return (
    <div className="nt-host" data-testid="notification-toast-host">
      {visible.map((item) => <ToastItem key={item.id} item={item} onOpen={open} />)}
      {hidden > 0 && <div className="nt-more" data-testid="toast-more" role="status">+{hidden}건 더 있어요 · 종 아이콘에서 확인하세요</div>}
    </div>
  );
}
