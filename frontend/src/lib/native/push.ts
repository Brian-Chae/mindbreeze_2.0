import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiClient } from '../api/client';
import { getPlatform, isNativeApp } from './platform';

/** 외부 URL, 인코딩 우회, 경로 정규화 우회를 허용하지 않는다. */
export function allowedPushDeeplink(value: unknown): string | null {
  if (typeof value !== 'string' || /[\\%\s\u0000-\u001f]/.test(value)) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const path = value.split(/[?#]/, 1)[0];
  if (path.split('/').some((part) => part === '.' || part === '..')) return null;
  return path === '/app' || path.startsWith('/app/') || path === '/agent'
    || path === '/chat' || path.startsWith('/chat/')
    ? value : null;
}

export interface PushSession {
  ready: Promise<void>;
  stop: () => Promise<void>;
}

// 로그아웃은 인증 토큰 폐기 전에 이 함수를 호출한다.
let currentSession: PushSession | null = null;
export async function revokePushRegistration(): Promise<void> {
  const session = currentSession;
  await session?.stop();
}

export function startPushRegistration(
  navigate: (path: string) => void,
  refreshNotifications: () => void,
): PushSession {
  let stopped = false;
  let token: string | null = null;
  let queue = Promise.resolve();
  const handles: PluginListenerHandle[] = [];
  let stopPromise: Promise<void> | null = null;
  const platform = getPlatform();
  const session: PushSession = {
    ready: Promise.resolve(),
    stop: () => {
      stopPromise ??= (async () => {
        stopped = true;
        await session.ready;
        await Promise.all(handles.map((handle) => handle.remove()));
        await queue;
        if (token) {
          const previous = token;
          token = null;
          await apiClient.delete(`/devices/${encodeURIComponent(previous)}`);
        }
      })().finally(() => {
        if (currentSession === session) currentSession = null;
      });
      return stopPromise;
    },
  };
  if (!isNativeApp() || platform === 'web') return session;
  const previousSession = currentSession;
  currentSession = session;
  session.ready = (async () => {
    // StrictMode 재마운트와 계정 전환 시 이전 DELETE가 새 POST를 뒤늦게 해지하지 않도록 한다.
    if (previousSession) await previousSession.stop().catch(() => {});
    if (stopped) return;
    const { version } = await App.getInfo();
    if (stopped) return;
    handles.push(await PushNotifications.addListener('registration', (registration: { value: string }) => {
      if (stopped) return;
      queue = queue.then(async () => {
        if (stopped || token === registration.value) return;
        const previous = token;
        await apiClient.post('/devices', {
          token: registration.value, platform, app_version: version,
        });
        token = registration.value;
        if (previous && previous !== token) await apiClient.delete(`/devices/${encodeURIComponent(previous)}`);
      }).catch(() => { /* 토큰이나 서버 오류 본문을 로그에 남기지 않는다. */ });
    }));
    handles.push(await PushNotifications.addListener('registrationError', () => {}));
    handles.push(await PushNotifications.addListener('pushNotificationReceived', () => {
      if (!stopped) refreshNotifications();
    }));
    handles.push(await PushNotifications.addListener('pushNotificationActionPerformed', (action: { notification: { data?: Record<string, unknown> } }) => {
      const data = action.notification.data as Record<string, unknown> | undefined;
      const path = allowedPushDeeplink(data?.deeplink);
      if (!stopped && path) navigate(path);
    }));
    if (stopped) return;
    let permission = await PushNotifications.checkPermissions();
    if (stopped) return;
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    if (!stopped && permission.receive === 'granted') await PushNotifications.register();
  })().catch(() => { /* 권한·네이티브 초기화 실패가 로그인을 막지 않는다. */ });
  return session;
}
