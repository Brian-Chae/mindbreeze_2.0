import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { apiClient } from '../api/client';
import { getPlatform, isNativeApp } from './platform';
import { useNotificationStore } from '../../stores/notificationStore';

/** 서버 FCM android.notification.channel_id(backend push_service.ANDROID_CHANNEL_ID)와 같아야 한다. */
export const ANDROID_CHANNEL_ID = 'mindbreeze_default';

interface ForegroundPush { id?: string; title?: string; body?: string; data?: Record<string, unknown> }

/** D3: 앱을 보고 있을 때는 OS 배너 대신 인앱 토스트로 보여준다. 소켓과 같은 알림 id(message_id)로 1회만. */
export function toastFromForegroundPush(push: ForegroundPush): void {
  const data = push.data ?? {};
  const messageId = typeof data.message_id === 'string' && data.message_id ? data.message_id : push.id;
  if (!push.title || !messageId) return;
  const deeplink = allowedPushDeeplink(data.deeplink);
  useNotificationStore.getState().showToast({
    id: messageId, type: 'push', title: push.title, body: push.body ?? '',
    // 푸시에는 표준 extra 가 없어 허용 딥링크만 이동 대상으로 쓴다(소켓이 먼저 오면 이 호출은 dedupe 로 무시).
    extra: deeplink ? { target_type: 'deeplink', params: { path: deeplink } } : null,
  });
}

/** 외부 URL, 인코딩 우회, 경로 정규화 우회를 허용하지 않는다. */
export function allowedPushDeeplink(value: unknown): string | null {
  // eslint-disable-next-line no-control-regex -- 제어문자·공백·% 등 경로 정규화 우회에 쓰일 수 있어 의도적으로 거른다.
  if (typeof value !== 'string' || /[\\%\s\u0000-\u001f]/.test(value)) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const path = value.split(/[?#]/, 1)[0];
  if (path.split('/').some((part) => part === '.' || part === '..')) return null;
  return path === '/app' || path.startsWith('/app/') || path === '/agent'
    || path === '/reports' || path === '/notifications'
    || /^\/(?:sessions|classes)\/[a-zA-Z0-9_-]+$/.test(path)
    || /^\/class\/[a-zA-Z0-9_-]+\/enter$/.test(path)
    || path === '/chat' || path.startsWith('/chat/')
    || /^\/classes\/[a-zA-Z0-9_-]+\/sessions\/[a-zA-Z0-9_-]+$/.test(path)
    ? value : null;
}

export interface PushSession {
  ready: Promise<void>;
  stop: () => Promise<void>;
  requestPermission?: () => Promise<boolean>;
}

// 로그아웃은 인증 토큰 폐기 전에 이 함수를 호출한다.
let currentSession: PushSession | null = null;
export async function revokePushRegistration(): Promise<void> {
  const session = currentSession;
  await session?.stop();
}

/** 설정의 사전 안내 확인 후에만 호출한다. */
export async function requestPushPermission(): Promise<boolean> {
  const session = currentSession;
  if (!session) return false;
  await session.ready;
  return await session.requestPermission?.() ?? false;
}

const ASKED_KEY = 'mb.push.permission-asked';
function wasAsked(): boolean {
  try { return globalThis.localStorage?.getItem(ASKED_KEY) === '1'; } catch { return false; }
}
function markAsked(): void {
  try { globalThis.localStorage?.setItem(ASKED_KEY, '1'); } catch { /* 저장 불가 환경은 매 시작 시 재질문하지 않도록 무시 */ }
}

export function startPushRegistration(
  navigate: (path: string) => void,
  refreshNotifications: () => void,
  requestOnStart = true,
): PushSession {
  let stopped = false;
  let token: string | null = null;
  let queue = Promise.resolve();
  const handles: PluginListenerHandle[] = [];
  let stopPromise: Promise<void> | null = null;
  const platform = getPlatform();
  let permissionRequest: Promise<boolean> | null = null;
  const requestPermission = (): Promise<boolean> => {
    permissionRequest ??= (async () => {
      if (stopped) return false;
      let permission = await PushNotifications.checkPermissions();
      if (stopped) return false;
      if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
        permission = await PushNotifications.requestPermissions();
      }
      if (stopped || permission.receive !== 'granted') return false;
      await PushNotifications.register();
      return true;
    })().finally(() => { permissionRequest = null; });
    return permissionRequest;
  };
  const session: PushSession = {
    requestPermission,
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
      }).catch((error: unknown) => {
        // 토큰·서버 응답 본문은 남기지 않고 상태 코드만 기록한다.
        const status = (error as { response?: { status?: number } })?.response?.status;
        console.warn('[push] 기기 토큰 서버 등록 실패', status ?? 'network');
      });
    }));
    handles.push(await PushNotifications.addListener('registrationError', () => {
      console.warn('[push] 네이티브 토큰 발급 실패(FCM/APNs 설정 확인)');
    }));
    handles.push(await PushNotifications.addListener('pushNotificationReceived', (push: ForegroundPush) => {
      if (stopped) return;
      refreshNotifications();
      toastFromForegroundPush(push);
    }));
    // Android 8+ 는 채널 중요도로 헤드업 여부가 정해진다. 서버 FCM 메시지가 이 채널을 지정한다.
    if (platform === 'android') {
      try {
        await PushNotifications.createChannel({
          id: ANDROID_CHANNEL_ID, name: '일반 알림', description: '클래스 초대·채팅·리포트 알림',
          importance: 5, visibility: 1, vibration: true,
        });
      } catch { console.warn('[push] 알림 채널 생성 실패'); }
    }
    handles.push(await PushNotifications.addListener('pushNotificationActionPerformed', (action: { notification: { data?: Record<string, unknown> } }) => {
      const data = action.notification.data as Record<string, unknown> | undefined;
      const path = allowedPushDeeplink(data?.deeplink);
      if (!stopped && path) navigate(path);
    }));
    handles.push(await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive || stopped) return;
      // 네트워크·인증 오류 후 재시도. 권한 팝업은 사용자 동작에서만 연다.
      void PushNotifications.checkPermissions().then(async (permission) => {
        if (!stopped && permission.receive === 'granted') await PushNotifications.register();
      }).catch(() => {});
    }));
    if (stopped) return;
    // 시작 시에는 이미 허용한 기기만 재등록하고 새 권한 창을 열지 않는다.
    // 허용된 기기는 즉시 등록. 미결정('prompt')이고 한 번도 묻지 않은 기기는 로그인 직후 1회만 요청한다.
    if (requestOnStart) {
      const permission = await PushNotifications.checkPermissions();
      if (stopped) return;
      if (permission.receive === 'granted') await PushNotifications.register();
      else if (permission.receive === 'prompt' && !wasAsked()) {
        markAsked();
        await requestPermission();
      } else console.info('[push] 알림 권한 미허용 — 설정에서 허용 필요', permission.receive);
    } else {
      const permission = await PushNotifications.checkPermissions();
      if (!stopped && permission.receive === 'granted') await PushNotifications.register();
    }
  })().catch((error: unknown) => {
    // 권한·네이티브 초기화 실패가 로그인을 막지 않는다.
    console.warn('[push] 푸시 초기화 실패', error instanceof Error ? error.name : 'unknown');
  });
  return session;
}
