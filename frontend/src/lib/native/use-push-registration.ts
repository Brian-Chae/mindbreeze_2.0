import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { isNativeApp } from './platform';
import { startPushRegistration } from './push';
import { startWebPushSync } from '../web-push';

export function usePushRegistration(): void {
  const userId = useAuthStore((state) => state.isAuthenticated ? state.user?.id : null);
  useEffect(() => {
    if (!userId) return;
    // App의 데이터 라우터가 수신하는 브라우저 이동 이벤트를 사용한다.
    const navigate = (path: string): void => {
      window.history.pushState(null, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };
    const refresh = (): void => { void useNotificationStore.getState().fetch(); };
    if (!isNativeApp()) {
      // SDD-192: 웹 — 이미 구독한 브라우저는 재등록하고 서비스 워커 메시지를 받는다(no-op if 미지원).
      return startWebPushSync(navigate, refresh);
    }
    const session = startPushRegistration(navigate, refresh);
    return () => { void session.stop().catch(() => {}); };
  }, [userId]);
}

export function NativeBootstrap(): null {
  usePushRegistration();
  return null;
}
