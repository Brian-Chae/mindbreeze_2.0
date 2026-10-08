import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  native: false,
  platform: 'android',
  listeners: new Map<string, (event: unknown) => void>(),
  remove: vi.fn(async () => {}),
  info: vi.fn(async () => ({ version: '1.0.0' })),
  check: vi.fn(async () => ({ receive: 'prompt' })),
  request: vi.fn(async () => ({ receive: 'granted' })),
  register: vi.fn(async () => {}),
  post: vi.fn(async () => ({})),
  delete: vi.fn(async () => {}),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: {
  isNativePlatform: () => mocks.native, getPlatform: () => mocks.platform,
} }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: mocks.info } }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  addListener: vi.fn(async (event: string, callback: (event: unknown) => void) => {
    mocks.listeners.set(event, callback);
    return { remove: mocks.remove };
  }),
  checkPermissions: mocks.check, requestPermissions: mocks.request, register: mocks.register,
} }));
vi.mock('../src/lib/api/client', () => ({ apiClient: { post: mocks.post, delete: mocks.delete } }));
import { allowedPushDeeplink, revokePushRegistration, startPushRegistration } from '../src/lib/native/push';
import { getPlatform, isNativeApp } from '../src/lib/native/platform';

beforeEach(async () => {
  await revokePushRegistration();
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.native = true;
  mocks.platform = 'android';
  mocks.check.mockResolvedValue({ receive: 'prompt' });
  mocks.request.mockResolvedValue({ receive: 'granted' });
});

describe('푸시 허용 경로', () => {
  it.each(['/app', '/app/ai', '/app/ai?message_id=123', '/app/sessions/123#record', '/agent'])('%s를 허용한다', (path) => {
    expect(allowedPushDeeplink(path)).toBe(path);
  });
  it.each(['/agent/settings', '/agents', '/application', '/login', '//example.com/app', 'https://example.com/app', 'javascript:alert(1)', '/app/../agent', '/app/%2e%2e/login', '/app\\evil', '/app/\nabc', null, {}])('허용 외 경로 %s를 거절한다', (path) => {
    expect(allowedPushDeeplink(path)).toBeNull();
  });
});

it('웹에서는 네이티브와 API 호출이 없다', async () => {
  mocks.native = false;
  mocks.platform = 'web';
  expect(isNativeApp()).toBe(false);
  expect(getPlatform()).toBe('web');
  const session = startPushRegistration(vi.fn(), vi.fn());
  await session.ready;
  await session.stop();
  expect(mocks.info).not.toHaveBeenCalled();
  expect(mocks.check).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.delete).not.toHaveBeenCalled();
});

it('권한 허용 후 토큰과 버전을 등록하고 로그아웃 시 해지한다', async () => {
  const session = startPushRegistration(vi.fn(), vi.fn());
  await session.ready;
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.register).toHaveBeenCalledOnce();
  mocks.listeners.get('registration')?.({ value: 'fixture/token' });
  await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/devices', {
    token: 'fixture/token', platform: 'android', app_version: '1.0.0',
  }));
  await revokePushRegistration();
  expect(mocks.delete).toHaveBeenCalledWith('/devices/fixture%2Ftoken');
  expect(mocks.remove).toHaveBeenCalledTimes(4);
  await session.stop();
  expect(mocks.delete).toHaveBeenCalledOnce();
});

it('권한 거부는 등록 없이 종료한다', async () => {
  mocks.request.mockResolvedValue({ receive: 'denied' });
  const session = startPushRegistration(vi.fn(), vi.fn());
  await session.ready;
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
  await session.stop();
});

it('허용된 탭만 이동하고 포그라운드는 기존 알림 갱신을 호출한다', async () => {
  const navigate = vi.fn();
  const refresh = vi.fn();
  const session = startPushRegistration(navigate, refresh);
  await session.ready;
  const tap = mocks.listeners.get('pushNotificationActionPerformed');
  tap?.({ notification: { data: { deeplink: '/app/ai' } } });
  tap?.({ notification: { data: { deeplink: '//external.test' } } });
  expect(navigate).toHaveBeenCalledExactlyOnceWith('/app/ai');
  mocks.listeners.get('pushNotificationReceived')?.({});
  expect(refresh).toHaveBeenCalledOnce();
  await session.stop();
  tap?.({ notification: { data: { deeplink: '/agent' } } });
  expect(navigate).toHaveBeenCalledOnce();
});

it('토큰 갱신 시 이전 토큰을 해지한다', async () => {
  const session = startPushRegistration(vi.fn(), vi.fn());
  await session.ready;
  mocks.listeners.get('registration')?.({ value: 'old-fixture' });
  await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  mocks.listeners.get('registration')?.({ value: 'new-fixture' });
  await vi.waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/devices/old-fixture'));
  await session.stop();
  expect(mocks.delete).toHaveBeenLastCalledWith('/devices/new-fixture');
});

it('등록 요청 중 로그아웃하면 요청 완료 후 해지한다', async () => {
  let finish: () => void = () => {};
  mocks.post.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({}); }));
  const session = startPushRegistration(vi.fn(), vi.fn());
  await session.ready;
  mocks.listeners.get('registration')?.({ value: 'pending-fixture' });
  await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
  const stopping = session.stop();
  finish();
  await stopping;
  expect(mocks.delete).toHaveBeenCalledWith('/devices/pending-fixture');
});

it('초기화 직후 정리하면 권한을 요청하지 않는다', async () => {
  const session = startPushRegistration(vi.fn(), vi.fn());
  await session.stop();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.register).not.toHaveBeenCalled();
});

it('동일 토큰의 중복 네이티브 이벤트는 한 번만 등록한다', async () => {
  const session = startPushRegistration(vi.fn(), vi.fn());
  await session.ready;
  mocks.listeners.get('registration')?.({ value: 'same-fixture' });
  mocks.listeners.get('registration')?.({ value: 'same-fixture' });
  await vi.waitFor(() => expect(mocks.post).toHaveBeenCalled());
  await session.stop();
  expect(mocks.post).toHaveBeenCalledOnce();
});

it('세션 재마운트는 이전 해지가 끝난 다음 등록을 시작한다', async () => {
  const first = startPushRegistration(vi.fn(), vi.fn());
  await first.ready;
  mocks.listeners.get('registration')?.({ value: 'remount-fixture' });
  await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
  let release: () => void = () => {};
  mocks.delete.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const stopping = first.stop();
  await vi.waitFor(() => expect(mocks.delete).toHaveBeenCalledOnce());
  const second = startPushRegistration(vi.fn(), vi.fn());
  await Promise.resolve();
  expect(mocks.info).toHaveBeenCalledOnce();
  release();
  await stopping;
  await second.ready;
  expect(mocks.info).toHaveBeenCalledTimes(2);
  await second.stop();
});

it('권한 확인 중 로그아웃하면 뒤늦은 권한 팝업을 열지 않는다', async () => {
  let resolvePermission: (value: { receive: string }) => void = () => {};
  mocks.check.mockImplementationOnce(() => new Promise((resolve) => { resolvePermission = resolve; }));
  const session = startPushRegistration(vi.fn(), vi.fn());
  await vi.waitFor(() => expect(mocks.check).toHaveBeenCalled());
  const stopping = session.stop();
  resolvePermission({ receive: 'prompt' });
  await stopping;
  expect(mocks.request).not.toHaveBeenCalled();
});
