// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn(async () => ({ receive: 'granted' })), check: vi.fn(async () => ({ receive: 'prompt' })), register: vi.fn(async () => {}) }));
vi.mock('../src/lib/native/platform', () => ({ isNativeApp: () => true, getPlatform: () => 'ios' }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: async () => ({ version: '1.0.0' }), addListener: async () => ({ remove: async () => {} }) } }));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: { addListener: async () => ({ remove: async () => {} }), checkPermissions: mocks.check, requestPermissions: mocks.request, register: mocks.register } }));
vi.mock('../src/lib/api/client', () => ({ apiClient: { post: vi.fn(), delete: vi.fn() } }));
vi.mock('../src/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ isAuthenticated: true, user: { id: 'fixture' } }) }));
vi.mock('../src/stores/notificationStore', () => ({ useNotificationStore: { getState: () => ({ fetch: vi.fn() }) } }));
import { NativeBootstrap } from '../src/lib/native/use-push-registration';
import { startPushRegistration, requestPushPermission } from '../src/lib/native/push';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); vi.clearAllMocks(); });
it('TS26 시작 시 OS 요청 0회, 설정의 명시적 요청에서만 1회', async () => {
 const session = startPushRegistration(vi.fn(), vi.fn(), false);
 await session.ready;
 expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.register).not.toHaveBeenCalled();
 await requestPushPermission();
 expect(mocks.request).toHaveBeenCalledOnce(); expect(mocks.register).toHaveBeenCalledOnce();
 await session.stop();
});
it('TS26 안내 취소 시 요청 0회, 확인 후에만 기능 시작', async () => {
 const { PermissionGuide } = await import('../src/components/native/permission-guide');
 const div = document.createElement('div'); const root = createRoot(div); roots.push(root);
 const onContinue = vi.fn();
 await act(async () => root.render(createElement(PermissionGuide, { kind: 'bluetooth', onContinue, children: request => createElement('button', { onClick: request }, '연결') })));
 expect(div.querySelector('[role=dialog]')).toBeNull(); expect(onContinue).not.toHaveBeenCalled();
 await act(async () => (div.querySelector('button') as HTMLButtonElement).click());
 expect(div.textContent).toContain('밴드 없이'); expect(onContinue).not.toHaveBeenCalled();
 await act(async () => (Array.from(div.querySelectorAll('button')).find(b => b.textContent === '나중에') as HTMLButtonElement).click());
 expect(onContinue).not.toHaveBeenCalled();
 await act(async () => (div.querySelector('button') as HTMLButtonElement).click());
 await act(async () => (Array.from(div.querySelectorAll('button')).find(b => b.textContent === '확인하고 계속') as HTMLButtonElement).click());
 expect(onContinue).toHaveBeenCalledOnce(); expect(div.querySelector('[role=dialog]')).toBeNull();
});

it('TS27 앱 설정에서는 브라우저 설치 안내가 없다', async () => {
 const { default: WebPushCard } = await import('../src/components/settings/WebPushCard');
 const div = document.createElement('div'); const root = createRoot(div); roots.push(root);
 await act(async () => root.render(createElement(WebPushCard)));
 expect(div.textContent).toContain('앱 알림');
 expect(div.textContent).not.toMatch(/홈 화면|Chrome|브라우저 알림/);
});

it('로그인 부트스트랩은 미결정 기기에 권한을 최초 1회만 요청한다(설정 화면 의존 제거)', async () => {
 localStorage.removeItem('mb.push.permission-asked');
 const div = document.createElement('div'); const root = createRoot(div); roots.push(root);
 await act(async () => root.render(createElement(NativeBootstrap)));
 await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
 expect(mocks.check).toHaveBeenCalled();
 expect(mocks.register).toHaveBeenCalledOnce();
});

it('TS27 앱의 밴드 미지원 안내는 Bluetooth 설정을 안내하고 연결 전 확인을 거친다', async () => {
 const { MybandSheet } = await import('../src/components/class/player/host/sheets/MybandSheet');
 const { HOST_SELF_BAND_NONE } = await import('../src/lib/class/host-player-case');
 const div = document.createElement('div'); const root = createRoot(div); roots.push(root);
 const onConnect = vi.fn();
 await act(async () => root.render(createElement(MybandSheet, { band: { ...HOST_SELF_BAND_NONE, state: 'unsupported' }, onConnect, onDisconnect: vi.fn() })));
 expect(div.textContent).toContain('Bluetooth');
 expect(div.textContent).not.toMatch(/Chrome|Edge|브라우저/);
 await act(async () => root.render(createElement(MybandSheet, { band: HOST_SELF_BAND_NONE, onConnect, onDisconnect: vi.fn() })));
 await act(async () => (div.querySelector('button') as HTMLButtonElement).click());
 expect(onConnect).not.toHaveBeenCalled();
 expect(div.querySelector('[role=dialog]')).not.toBeNull();
 await act(async () => (Array.from(div.querySelectorAll('button')).find(b => b.textContent === '확인하고 계속') as HTMLButtonElement).click());
 expect(onConnect).toHaveBeenCalledOnce();
});
