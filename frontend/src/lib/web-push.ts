// SDD-192: 웹 푸시(VAPID) 구독 관리. 네이티브 앱(Capacitor)에서는 쓰지 않는다 — 앱은 FCM(lib/native/push.ts).
import { apiClient, ApiError } from './api/client';
import { isNativeApp } from './native/platform';
import { allowedPushDeeplink } from './native/push';

export type WebPushState =
  | 'unsupported' // 브라우저가 서비스 워커/푸시/알림을 지원하지 않음(또는 네이티브 앱)
  | 'unavailable' // 서버에 VAPID 가 설정되지 않음
  | 'denied' // 사용자가 알림을 차단
  | 'idle' // 지원되지만 아직 구독 안 함
  | 'subscribed';

const SW_URL = '/sw.js';

export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined' || isNativeApp()) return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** base64url(VAPID 공개키) → applicationServerKey 바이트. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return (await navigator.serviceWorker.getRegistration(SW_URL)) ?? undefined;
}

async function getSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

async function fetchPublicKey(): Promise<string | null> {
  try {
    const res = await apiClient.get<{ public_key: string }>('/devices/web-push/public-key');
    return res.public_key;
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) return null;
    throw error;
  }
}

async function registerOnServer(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const keys = json.keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('구독 키를 읽지 못했습니다');
  await apiClient.post('/devices', {
    token: subscription.endpoint,
    platform: 'web',
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    device_label: navigator.userAgent.slice(0, 100),
  });
}

export async function getWebPushState(): Promise<WebPushState> {
  if (!isWebPushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (await getSubscription()) return 'subscribed';
  return (await fetchPublicKey()) ? 'idle' : 'unavailable';
}

/** 권한 요청 → 구독 → 서버 등록. 결과 상태를 돌려준다. */
export async function enableWebPush(): Promise<WebPushState> {
  if (!isWebPushSupported()) return 'unsupported';
  const publicKey = await fetchPublicKey();
  if (!publicKey) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'idle';

  await navigator.serviceWorker.register(SW_URL);
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  await registerOnServer(subscription);
  return 'subscribed';
}

/** 서버 구독 해지 + 브라우저 구독 해제. 서버 해지 실패가 브라우저 해제를 막지 않는다. */
export async function disableWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  const subscription = await getSubscription();
  if (!subscription) return;
  try {
    await apiClient.delete(`/devices?token=${encodeURIComponent(subscription.endpoint)}`);
  } catch {
    // 서버 해지 실패 시에도 로컬 구독은 해제한다(서버는 410 응답으로 정리).
  }
  await subscription.unsubscribe();
}

/**
 * 로그인 상태에서 이미 구독돼 있으면 서버에 재등록(last_seen 갱신)하고
 * 서비스 워커 메시지(알림 갱신·딥링크 이동)를 받는다. 해제 함수를 돌려준다.
 */
export function startWebPushSync(
  navigate: (path: string) => void,
  refreshNotifications: () => void,
): () => void {
  if (!isWebPushSupported()) return () => {};
  let stopped = false;

  void (async () => {
    try {
      if (Notification.permission !== 'granted') return;
      const subscription = await getSubscription();
      if (subscription && !stopped) await registerOnServer(subscription);
    } catch {
      /* 재등록 실패는 조용히 무시 — 설정 화면에서 다시 켤 수 있다. */
    }
  })();

  const onMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: string; path?: unknown } | null;
    if (data?.type === 'mb-push-received') refreshNotifications();
    if (data?.type === 'mb-push-navigate') {
      const path = allowedPushDeeplink(data.path);
      if (path) navigate(path);
    }
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => {
    stopped = true;
    navigator.serviceWorker.removeEventListener('message', onMessage);
  };
}
