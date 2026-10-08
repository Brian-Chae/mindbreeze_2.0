// @vitest-environment jsdom
// SDD-192 TS8 — 웹 푸시 클라이언트(구독 흐름) + 서비스 워커 동작
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: false,
  get: vi.fn(),
  post: vi.fn(async () => ({})),
  del: vi.fn(async () => {}),
}));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => mocks.native, getPlatform: () => 'web' }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }));
vi.mock('@capacitor/app', () => ({ App: {} }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {} }));
vi.mock('../src/lib/api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number) { super('api'); this.status = status; }
  }
  return { ApiError, apiClient: { get: mocks.get, post: mocks.post, delete: mocks.del } };
});

import {
  disableWebPush,
  enableWebPush,
  getWebPushState,
  isWebPushSupported,
  startWebPushSync,
  urlBase64ToUint8Array,
} from '../src/lib/web-push';
import { ApiError } from '../src/lib/api/client';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

interface FakeSub {
  endpoint: string;
  toJSON: () => { keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

function installBrowser(opts: { permission?: NotificationPermission; subscribed?: boolean } = {}) {
  const sub: FakeSub = {
    endpoint: ENDPOINT,
    toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
  let current: FakeSub | null = opts.subscribed ? sub : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => { current = sub; return sub; }),
  };
  const registration = { pushManager };
  const listeners: Array<(e: MessageEvent) => void> = [];
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn(async () => (opts.subscribed ? registration : undefined)),
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
      addEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.push(l),
      removeEventListener: vi.fn(),
    },
  });
  vi.stubGlobal('PushManager', class {});
  const notification = Object.assign(function Notification() {}, {
    permission: opts.permission ?? 'default',
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
  });
  vi.stubGlobal('Notification', notification);
  Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
  return { sub, pushManager, listeners, notification };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = false;
  mocks.get.mockResolvedValue({ public_key: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' });
  // 이전 테스트가 심은 브라우저 API 제거
  Reflect.deleteProperty(navigator, 'serviceWorker');
  Reflect.deleteProperty(window, 'PushManager');
  vi.unstubAllGlobals();
});

describe('지원 감지', () => {
  it('서비스 워커/푸시가 없으면 unsupported 이고 구독을 시도하지 않는다', async () => {
    expect(isWebPushSupported()).toBe(false);
    expect(await getWebPushState()).toBe('unsupported');
    expect(await enableWebPush()).toBe('unsupported');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('네이티브 앱에서는 웹 푸시를 쓰지 않는다', () => {
    installBrowser();
    mocks.native = true;
    expect(isWebPushSupported()).toBe(false);
  });
});

describe('구독 흐름', () => {
  it('권한 허용 → 구독 → /devices 에 platform=web 으로 등록', async () => {
    const b = installBrowser();
    expect(await getWebPushState()).toBe('idle');

    expect(await enableWebPush()).toBe('subscribed');

    expect(b.notification.requestPermission).toHaveBeenCalledOnce();
    expect(b.pushManager.subscribe).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledWith('/devices', expect.objectContaining({
      token: ENDPOINT, platform: 'web', keys: { p256dh: 'p', auth: 'a' },
    }));
  });

  it('서버에 VAPID 가 없으면(503) unavailable — 권한 요청도 하지 않는다', async () => {
    const b = installBrowser();
    mocks.get.mockRejectedValue(new (ApiError as unknown as new (s: number) => Error)(503));
    expect(await getWebPushState()).toBe('unavailable');
    expect(await enableWebPush()).toBe('unavailable');
    expect(b.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('권한이 차단돼 있으면 denied', async () => {
    installBrowser({ permission: 'denied' });
    expect(await getWebPushState()).toBe('denied');
  });

  it('이미 구독 중이면 subscribed, 해제하면 서버 해지(쿼리) 후 unsubscribe', async () => {
    const b = installBrowser({ permission: 'granted', subscribed: true });
    expect(await getWebPushState()).toBe('subscribed');

    await disableWebPush();

    expect(mocks.del).toHaveBeenCalledWith(`/devices?token=${encodeURIComponent(ENDPOINT)}`);
    expect(b.sub.unsubscribe).toHaveBeenCalledOnce();
  });

  it('서버 해지가 실패해도 브라우저 구독은 해제한다', async () => {
    const b = installBrowser({ permission: 'granted', subscribed: true });
    mocks.del.mockRejectedValueOnce(new Error('offline'));
    await disableWebPush();
    expect(b.sub.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('startWebPushSync', () => {
  it('구독돼 있으면 재등록하고 SW 메시지로 갱신·이동한다(허용 경로만)', async () => {
    const b = installBrowser({ permission: 'granted', subscribed: true });
    const navigate = vi.fn();
    const refresh = vi.fn();

    const stop = startWebPushSync(navigate, refresh);
    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());

    const emit = (data: unknown) => b.listeners.forEach((l) => l({ data } as MessageEvent));
    emit({ type: 'mb-push-received' });
    emit({ type: 'mb-push-navigate', path: '/app/ai' });
    emit({ type: 'mb-push-navigate', path: 'https://evil.example.com' });
    emit({ type: 'mb-push-navigate', path: '//evil.example.com' });

    expect(refresh).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/app/ai');
    stop();
  });

  it('권한이 허용되지 않았으면 재등록하지 않는다', async () => {
    installBrowser({ permission: 'default', subscribed: true });
    startWebPushSync(vi.fn(), vi.fn())();
    await Promise.resolve();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});

describe('urlBase64ToUint8Array', () => {
  it('base64url 65바이트 VAPID 공개키를 디코딩한다', () => {
    const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const out = urlBase64ToUint8Array(key);
    expect(out.length).toBe(65);
    expect(out[0]).toBe(4); // 비압축 EC 포인트
  });
});

// ── 서비스 워커 ────────────────────────────────────────────
type Handler = (event: Record<string, unknown>) => void;

function loadSw() {
  const handlers: Record<string, Handler> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const state = { clients: [] as Array<Record<string, unknown>>, opened: [] as string[] };
  const self = {
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(),
      matchAll: vi.fn(async () => state.clients),
      openWindow: vi.fn(async (p: string) => { state.opened.push(p); }),
    },
    registration: {
      showNotification: vi.fn(async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      }),
    },
    addEventListener: (name: string, fn: Handler) => { handlers[name] = fn; },
  };
  const src = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf-8');
  new Function('self', src)(self);
  const run = async (name: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers[name]({ ...event, waitUntil: (p: Promise<unknown>) => { pending = p; } });
    await pending;
  };
  return { run, shown, state };
}

describe('sw.js', () => {
  const pushEvent = (payload: unknown) => ({ data: { json: () => payload } });

  it('앱 창이 포커스 중이면 시스템 알림 대신 창에 갱신 메시지를 보낸다', async () => {
    const sw = loadSw();
    const postMessage = vi.fn();
    sw.state.clients = [{ focused: true, postMessage }];
    await sw.run('push', pushEvent({ title: 't', body: 'b', data: {} }));
    expect(sw.shown).toHaveLength(0);
    expect(postMessage).toHaveBeenCalledWith({ type: 'mb-push-received' });
  });

  it('백그라운드면 알림을 표시하고 허용 딥링크만 data 에 싣는다', async () => {
    const sw = loadSw();
    sw.state.clients = [{ focused: false }];
    await sw.run('push', pushEvent({ title: '새 알림', body: '확인해 주세요', data: { deeplink: '/app/ai', message_id: 'm1' } }));
    expect(sw.shown[0].title).toBe('새 알림');
    expect(sw.shown[0].options).toMatchObject({ body: '확인해 주세요', tag: 'm1', data: { deeplink: '/app/ai' } });

    await sw.run('push', pushEvent({ title: 'x', data: { deeplink: 'https://evil.example.com' } }));
    expect(sw.shown[1].options).toMatchObject({ data: { deeplink: null } });
  });

  it('클릭: 열린 창이 있으면 포커스+이동 메시지, 없으면 허용 경로로 새 창, 위험 경로는 /', async () => {
    const sw = loadSw();
    const postMessage = vi.fn();
    const focus = vi.fn(async () => {});
    sw.state.clients = [{ focus, postMessage }];
    await sw.run('notificationclick', { notification: { close: vi.fn(), data: { deeplink: '/chat/room-1' } } });
    expect(postMessage).toHaveBeenCalledWith({ type: 'mb-push-navigate', path: '/chat/room-1' });
    expect(focus).toHaveBeenCalled();

    sw.state.clients = [];
    await sw.run('notificationclick', { notification: { close: vi.fn(), data: { deeplink: '/app/../admin' } } });
    await sw.run('notificationclick', { notification: { close: vi.fn(), data: { deeplink: '/agent' } } });
    expect(sw.state.opened).toEqual(['/', '/agent']);
  });

  it('잘못된 payload(JSON 아님)에도 기본 제목으로 알림을 띄운다', async () => {
    const sw = loadSw();
    sw.state.clients = [];
    await sw.run('push', { data: { json: () => { throw new Error('bad'); } } });
    expect(sw.shown[0].title).toBe('MIND BREEZE');
  });
});
