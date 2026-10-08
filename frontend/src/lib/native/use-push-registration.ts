import { useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { isNativeApp } from './platform';
import { startPushRegistration } from './push';

export function usePushRegistration(): void {
  const userId = useAuthStore((state) => state.isAuthenticated ? state.user?.id : null);
  useEffect(() => {
    if (!isNativeApp() || !userId) return;
    const session = startPushRegistration(
      (path) => {
        // App의 데이터 라우터가 수신하는 브라우저 이동 이벤트를 사용한다.
        window.history.pushState(null, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      },
      () => { void useNotificationStore.getState().fetch(); },
    );
    return () => { void session.stop().catch(() => {}); };
  }, [userId]);
}

export function NativeBootstrap(): null {
  usePushRegistration();
  return null;
}
