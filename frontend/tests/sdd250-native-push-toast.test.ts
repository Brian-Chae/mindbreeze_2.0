// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'android',
  listeners: new Map<string, (event: unknown) => void>(),
  createChannel: vi.fn(async () => {}),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => mocks.platform } }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: vi.fn(async () => ({ version: '1' })), addListener: vi.fn(async () => ({ remove: vi.fn() })) } }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: vi.fn(async (e: string, cb: (x: unknown) => void) => { mocks.listeners.set(e, cb); return { remove: vi.fn(async () => {}) }; }),
  checkPermissions: vi.fn(async () => ({ receive: 'denied' })), requestPermissions: vi.fn(), register: vi.fn(), createChannel: mocks.createChannel,
} }));
vi.mock('../src/lib/api/client', () => ({ apiClient: { post: vi.fn(), delete: vi.fn() } }));
import { revokePushRegistration, startPushRegistration, toastFromForegroundPush } from '../src/lib/native/push';
import { useNotificationStore } from '../src/stores/notificationStore';

beforeEach(async () => {
  await revokePushRegistration(); vi.clearAllMocks(); mocks.listeners.clear(); mocks.platform = 'android';
  useNotificationStore.getState().reset(); window.history.pushState(null, '', '/app');
});

describe('SDD-250 앱 포그라운드 푸시 → 토스트', () => {
  it('TS20 수신 시 토스트 1회, 소켓과 같은 message_id 면 중복 없음', async () => {
    const refresh = vi.fn();
    const session = startPushRegistration(vi.fn(), refresh); await session.ready;
    const push = { title: '새 클래스', body: '입장하세요', data: { message_id: 'm-1', deeplink: '/class/abc/enter' } };
    mocks.listeners.get('pushNotificationReceived')?.(push);
    mocks.listeners.get('pushNotificationReceived')?.(push);
    expect(refresh).toHaveBeenCalledTimes(2);
    const toasts = useNotificationStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].extra).toEqual({ target_type: 'deeplink', params: { path: '/class/abc/enter' } });
    await session.stop();
  });

  it('허용되지 않은 딥링크는 이동 대상에서 뺀다', () => {
    toastFromForegroundPush({ title: 't', data: { message_id: 'm-2', deeplink: '//evil.test' } });
    expect(useNotificationStore.getState().toasts[0].extra).toBeNull();
  });

  it('TS21 Android 에서만 채널 생성', async () => {
    const a = startPushRegistration(vi.fn(), vi.fn()); await a.ready;
    expect(mocks.createChannel).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'mindbreeze_default', importance: 5 }));
    await a.stop(); mocks.createChannel.mockClear(); mocks.platform = 'ios';
    const b = startPushRegistration(vi.fn(), vi.fn()); await b.ready;
    expect(mocks.createChannel).not.toHaveBeenCalled(); await b.stop();
  });
});
