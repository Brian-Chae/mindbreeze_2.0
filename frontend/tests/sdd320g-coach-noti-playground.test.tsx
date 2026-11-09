// @vitest-environment jsdom
// SDD-320 G — 코치 알림·플레이그라운드 D안: 역할 분기, 기능 보존, 플래그 off 시 레거시, 금지 표현 0, 격리 규칙.
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listNotifications: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), getPreferences: vi.fn(), updatePreferences: vi.fn(), fetch: vi.fn() }));
vi.mock('../src/lib/api/notifications', async (orig) => ({ ...(await orig<object>()), ...api }));
vi.mock('../src/components/layout/AppShell', () => ({
  default: ({ title, children }: { title: string; children?: ReactNode }) => createElement('div', null, createElement('h1', null, title), children),
}));
vi.mock('../src/pages/notifications/NotificationCenterPage', () => ({ default: () => createElement('div', { 'data-testid': 'legacy-center' }) }));
vi.mock('../src/pages/notifications/ui-v2/ui-v2-org-notifications-page', () => ({ UiV2OrgNotificationsPage: () => createElement('div', { 'data-testid': 'org' }) }));
vi.mock('../src/pages/playground/PlaygroundPage', () => ({ default: () => createElement('div', { 'data-testid': 'legacy-pg' }) }));
vi.mock('../src/pages/playground/ui-v2/ui-v2-coach-playground-page', () => ({ UiV2CoachPlaygroundPage: () => createElement('div', { 'data-testid': 'coach-pg' }) }));

import { UiV2NotificationCenterPage } from '../src/pages/notifications/ui-v2/ui-v2-notification-center-page';
import { UiV2PlaygroundEntry } from '../src/pages/playground/ui-v2/ui-v2-playground-entry';
import { useAuthStore } from '../src/stores/authStore';
import { useNotificationStore } from '../src/stores/notificationStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const FORBIDDEN = /점수|종합점수|좋음|나쁨|완료됐|보증|100%/;
const note = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'session', title: `제목 ${id}`, body: `본문 ${id}`, is_read: false, extra: null, created_at: new Date().toISOString(), ...over });
const withRoom = { schema_version: 1, event_type: 'chat_message', target_type: 'chat_room', target_id: 'room-1' };

let host: HTMLDivElement; let mounted: Root;
function Where() { return createElement('span', { 'data-testid': 'where' }, useLocation().pathname); }
async function mount(el: ReactNode) {
  host = document.createElement('div'); document.body.appendChild(host); mounted = createRoot(host);
  await act(async () => { mounted.render(createElement(MemoryRouter, { initialEntries: ['/notifications'] }, createElement(Routes, null, createElement(Route, { path: '*', element: createElement('div', null, el, createElement(Where)) })))); });
  await act(async () => { await Promise.resolve(); });
}
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); }); };
const byText = (t: string, sel = 'button') => Array.from(host.querySelectorAll(sel)).find((n) => n.textContent?.trim() === t);
const setRole = (role: string) => useAuthStore.setState({ user: { id: 'u', role, name: 'x', email: 'x@example.test' } } as never);

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.markRead.mockResolvedValue(undefined); api.markAllRead.mockResolvedValue({ count: 2 }); api.fetch.mockResolvedValue(undefined);
  useNotificationStore.setState({ fetch: api.fetch } as never);
});
afterEach(() => { act(() => mounted?.unmount()); host?.remove(); useAuthStore.setState({ user: null } as never); });

describe('역할 분기', () => {
  it('알림: counselor → 코치 D안, org_admin → 기관, 그 외 → 레거시', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [], total: 0, unread: 0 });
    setRole('counselor'); await mount(createElement(UiV2NotificationCenterPage));
    expect(host.querySelector('.u2g-noti')).toBeTruthy(); expect(host.querySelector('h1')?.textContent).toBe('필요한 소식만 모았어요');
    act(() => mounted.unmount()); host.remove();
    setRole('org_admin'); await mount(createElement(UiV2NotificationCenterPage)); expect(host.querySelector('[data-testid=org]')).toBeTruthy();
    act(() => mounted.unmount()); host.remove();
    setRole('platform_admin'); await mount(createElement(UiV2NotificationCenterPage)); expect(host.querySelector('[data-testid=legacy-center]')).toBeTruthy();
  });
  it('플레이그라운드: counselor → 코치 D안, client → 회원 D안(코치 화면 재사용), 그 외 → 레거시', async () => {
    setRole('counselor'); await mount(createElement(UiV2PlaygroundEntry)); expect(host.querySelector('[data-testid=coach-pg]')).toBeTruthy();
    act(() => mounted.unmount()); host.remove();
    setRole('client'); await mount(createElement(UiV2PlaygroundEntry)); expect(host.querySelector('[data-testid=coach-pg]')).toBeTruthy();
    act(() => mounted.unmount()); host.remove();
    setRole('platform_admin'); await mount(createElement(UiV2PlaygroundEntry)); expect(host.querySelector('[data-testid=legacy-pg]')).toBeTruthy();
  });
});

describe('코치 알림 기능 보존', () => {
  beforeEach(() => setRole('counselor'));
  it('목록 50건·요약·읽음 처리·뱃지 재조회·딥링크 이동', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [note('a', { type: 'chat', extra: withRoom }), note('b', { is_read: true })], total: 2, unread: 1 });
    await mount(createElement(UiV2NotificationCenterPage));
    expect(api.listNotifications).toHaveBeenCalledWith(false, 50, 0);
    expect(host.querySelectorAll('.u2-notif-item')).toHaveLength(2);
    expect(host.textContent).toContain('읽지 않은 알림 1개');
    await click(host.querySelector('.u2-notif-item[data-unread] button'));
    expect(api.markRead).toHaveBeenCalledWith('a'); expect(api.fetch).toHaveBeenCalled();
    expect(host.querySelectorAll('.u2-notif-item[data-unread]')).toHaveLength(0);
    expect(host.querySelector('[data-testid=where]')?.textContent).toMatch(/chat/);
  });
  it('전체 읽음: 호출·모두 읽음 표시, 실패 시 role=alert', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [note('a'), note('b')], total: 2, unread: 2 });
    await mount(createElement(UiV2NotificationCenterPage));
    await click(byText('전체 읽음'));
    expect(api.markAllRead).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('모든 알림을 읽었습니다');
    expect(byText('전체 읽음')).toBeUndefined();
  });
  it('유형 탭은 화면 필터일 뿐 조회·읽음 API를 추가 호출하지 않는다', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [note('a'), note('b', { type: 'report' }), note('c', { type: 'chat' })], total: 3, unread: 3 });
    await mount(createElement(UiV2NotificationCenterPage));
    expect(host.querySelectorAll('.u2-notif-item')).toHaveLength(3);
    await click(byText('리포트')); expect(host.querySelectorAll('.u2-notif-item')).toHaveLength(1);
    await click(byText('회차')); expect(host.querySelectorAll('.u2-notif-item')).toHaveLength(1);
    await click(byText('전체')); expect(host.querySelectorAll('.u2-notif-item')).toHaveLength(3);
    expect(api.listNotifications).toHaveBeenCalledTimes(1); expect(api.markRead).not.toHaveBeenCalled();
  });
  it('설정 패널: role=switch·낙관적 토글·실패 시 되돌림', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [], total: 0, unread: 0 });
    api.getPreferences.mockResolvedValue({ email: { session_booked: true }, in_app: { session_booked: false } });
    await mount(createElement(UiV2NotificationCenterPage));
    await click(byText('설정'));
    const sw = host.querySelector('[role=switch][aria-label*="이메일"]') as HTMLElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    api.updatePreferences.mockRejectedValue(new Error('저장 실패'));
    await click(sw);
    expect((host.querySelector('[role=switch][aria-label*="이메일"]') as HTMLElement).getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('저장 실패');
  });
  it('로딩 role=status, 빈 상태, 조회 실패 role=alert', async () => {
    api.listNotifications.mockRejectedValueOnce(new Error('서버 오류'));
    await mount(createElement(UiV2NotificationCenterPage));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('서버 오류');
  });
});

describe('분기·격리·금지 표현', () => {
  it('App.tsx: 플레이그라운드 분기는 VITE_UI_V2 상수 뒤, 레거시 경로 유지', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(/const PlaygroundPage = lazy\(\(\) => import\.meta\.env\.VITE_UI_V2 === 'true'\s*\?\s*import\('\.\/pages\/playground\/ui-v2\/ui-v2-playground-entry'\)[\s\S]*?:\s*import\('\.\/pages\/playground\/PlaygroundPage'\)\)/);
  });
  it('레거시 파일은 수정하지 않았다(PlaygroundPage·NotificationCenterPage에 ui-v2 참조 없음)', () => {
    expect(read('src/pages/playground/PlaygroundPage.tsx')).not.toMatch(/ui-v2|u2g/);
    expect(read('src/pages/notifications/NotificationCenterPage.tsx')).not.toMatch(/ui-v2|u2g/);
  });
  it('플레이그라운드 D안은 기존 패널 컴포넌트를 그대로 쓴다', () => {
    const src = read('src/pages/playground/ui-v2/ui-v2-coach-playground-page.tsx');
    for (const n of ['ConnectionPanel', 'EegWaveformPanel', 'SpectrumPanel', 'PpgPanel', 'AccPanel', 'MetricsPanel', 'TrendPanel', 'PlaygroundMeditationSimulator']) expect(src).toContain(`<${n}`);
    expect(src).toContain('useBand(');
  });
  it('신규 화면·CSS에 금지 표현 0', () => {
    for (const p of ['src/pages/notifications/ui-v2/ui-v2-coach-notifications-page.tsx', 'src/pages/playground/ui-v2/ui-v2-coach-playground-page.tsx', 'src/pages/playground/ui-v2/ui-v2-playground-entry.tsx', 'src/styles/ui-v2-coach-noti-pg.css']) expect(read(p), p).not.toMatch(FORBIDDEN);
  });
  it('check-ui-v2-off 규칙에 신규 식별자·CSS 접두사 포함', () => {
    const s = read('scripts/check-ui-v2-off.mjs');
    expect(s).toContain('ui-v2-coach-notifications-page'); expect(s).toContain('ui-v2-playground-entry'); expect(s).toContain('u2g-');
  });
});
