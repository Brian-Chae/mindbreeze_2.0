// @vitest-environment jsdom
// SDD-322 — 알림 D안: 기능 보존(C1~C7), 분기·스코프·금지 표현·검사 스크립트(A3/A4/D1~D3).
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — 순수 JS 검사 모듈(타입 선언 없음)
import { checkUiV2Off } from '../scripts/check-ui-v2-off.mjs';

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), getPreferences: vi.fn(), updatePreferences: vi.fn(), fetch: vi.fn(),
}));
vi.mock('../src/lib/api/notifications', async (orig) => ({ ...(await orig<object>()), listNotifications: api.listNotifications, markRead: api.markRead, markAllRead: api.markAllRead, getPreferences: api.getPreferences, updatePreferences: api.updatePreferences }));
vi.mock('../src/components/ui-v2/ui-v2-client-shell', () => ({
  UiV2ClientShell: ({ title, children }: { title: string; children?: ReactNode }) => createElement('div', { className: 'ui-v2' }, createElement('h1', null, title), children),
}));
vi.mock('../src/components/ui-v2/ui-v2-org-shell', () => ({
  UiV2OrgShell: ({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children?: ReactNode }) =>
    createElement('div', { className: 'ui-v2' }, createElement('h1', null, title), subtitle && createElement('p', { 'data-testid': 'sub' }, subtitle), actions, children),
}));
vi.mock('../src/pages/notifications/NotificationCenterPage', () => ({ default: () => createElement('div', { 'data-testid': 'legacy-center' }, 'legacy') }));

import { UiV2NotificationsPage } from '../src/pages/client/ui-v2/ui-v2-notifications-page';
import { UiV2OrgNotificationsPage } from '../src/pages/notifications/ui-v2/ui-v2-org-notifications-page';
import { UiV2NotificationCenterPage } from '../src/pages/notifications/ui-v2/ui-v2-notification-center-page';
import { useAuthStore } from '../src/stores/authStore';
import { useNotificationStore } from '../src/stores/notificationStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const note = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'chat', title: `제목 ${id}`, body: `본문 ${id}`, is_read: false, extra: null, created_at: new Date().toISOString(), ...over });
const withRoom = { schema_version: 1, event_type: 'chat_message', target_type: 'chat_room', target_id: 'room-1' };

let host: HTMLDivElement; let mounted: Root;
function Where() { return createElement('span', { 'data-testid': 'where' }, useLocation().pathname); }
const here = () => host.querySelector('[data-testid=where]')?.textContent;
async function mount(el: ReactNode, path = '/') {
  host = document.createElement('div'); document.body.appendChild(host); mounted = createRoot(host);
  await act(async () => { mounted.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null, createElement(Route, { path: '*', element: createElement('div', null, el, createElement(Where)) })))); });
  await act(async () => { await Promise.resolve(); });
}
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); await Promise.resolve(); }); };
const byText = (text: string, sel = 'button') => Array.from(host.querySelectorAll(sel)).find((n) => n.textContent?.trim() === text);

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.markRead.mockResolvedValue(undefined); api.markAllRead.mockResolvedValue({ count: 2 }); api.fetch.mockResolvedValue(undefined);
  useNotificationStore.setState({ fetch: api.fetch } as never);
});
afterEach(() => { act(() => mounted?.unmount()); host?.remove(); useAuthStore.setState({ user: null } as never); });

describe('내담자 알림 (C1~C4)', () => {
  it('C1 목록 50건 조회·읽음 처리·뱃지 재조회·딥링크 이동', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [note('a', { extra: withRoom }), note('b', { is_read: true })], total: 2, unread: 1 });
    await mount(createElement(UiV2NotificationsPage));
    expect(api.listNotifications).toHaveBeenCalledWith(false, 50, 0);
    expect(host.querySelectorAll('.u2-notif-item')).toHaveLength(2);
    expect(host.querySelectorAll('.u2-notif-item[data-unread]')).toHaveLength(1);
    expect(host.textContent).toContain('읽지 않은 알림 1개');
    await click(host.querySelector('.u2-notif-item[data-unread] button'));
    expect(api.markRead).toHaveBeenCalledWith('a');
    expect(api.fetch).toHaveBeenCalled();
    expect(host.querySelectorAll('.u2-notif-item[data-unread]')).toHaveLength(0);
    expect(here()).toBe('/app/chat/room-1');
  });
  it('C2 딥링크 없으면 본문 펼침(다시 누르면 접힘), 읽음 저장 실패 시 role=alert', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [note('a', { body: '긴 본문 내용' })], total: 1, unread: 1 });
    await mount(createElement(UiV2NotificationsPage));
    await click(host.querySelector('.u2-notif-row'));
    expect(host.querySelector('.u2-notif-expanded')?.textContent).toBe('긴 본문 내용');
    await click(host.querySelector('.u2-notif-row'));
    expect(host.querySelector('.u2-notif-expanded')).toBeNull();
    api.markRead.mockRejectedValue(new Error('저장 오류'));
    api.listNotifications.mockResolvedValue({ notifications: [note('z')], total: 1, unread: 1 });
    act(() => mounted.unmount()); host.remove();
    await mount(createElement(UiV2NotificationsPage));
    await click(host.querySelector('.u2-notif-row'));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('저장 오류');
  });
  it('C3 전체 읽음: markAllRead 호출·모두 읽음 표시, 실패 시 메시지', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [note('a'), note('b')], total: 2, unread: 2 });
    await mount(createElement(UiV2NotificationsPage));
    await click(byText('전체 읽음'));
    expect(api.markAllRead).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll('.u2-notif-item[data-unread]')).toHaveLength(0);
    expect(host.textContent).toContain('모든 알림을 읽었습니다');
    api.markAllRead.mockRejectedValue(new Error('x'));
    await click(byText('전체 읽음'));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('x');
  });
  it('C4 로딩 role=status, 빈 상태 문구, 오류 + 다시 시도', async () => {
    let resolveList: (v: unknown) => void = () => undefined;
    api.listNotifications.mockReturnValueOnce(new Promise((r) => { resolveList = r; }));
    await mount(createElement(UiV2NotificationsPage));
    expect(host.querySelector('[role=status]')?.textContent).toBe('불러오는 중...');
    await act(async () => { resolveList({ notifications: [], total: 0, unread: 0 }); await Promise.resolve(); });
    expect(host.textContent).toContain('아직 알림이 없습니다.');
    api.listNotifications.mockRejectedValueOnce(new Error('서버 오류')).mockResolvedValueOnce({ notifications: [note('a')], total: 1, unread: 1 });
    act(() => mounted.unmount()); host.remove();
    await mount(createElement(UiV2NotificationsPage));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('서버 오류');
    expect(host.textContent).not.toContain('아직 알림이 없습니다.');
    await click(byText('다시 시도'));
    expect(api.listNotifications).toHaveBeenCalledTimes(3);
    expect(host.querySelectorAll('.u2-notif-item')).toHaveLength(1);
  });
});

describe('기관 알림 (C5~C6)', () => {
  beforeEach(() => { useAuthStore.setState({ user: { id: 'u', role: 'org_admin', name: 'x', email: 'x@example.test' } } as never); });
  it('C5 요약줄·읽음·딥링크(역할 기준)·전체 읽음 버튼은 읽지 않은 것이 있을 때만', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [note('a', { extra: withRoom })], total: 1, unread: 1 });
    await mount(createElement(UiV2OrgNotificationsPage));
    expect(host.querySelector('[data-testid=sub]')?.textContent).toBe('읽지 않은 알림 1개');
    expect(byText('전체 읽음')).toBeTruthy();
    await click(host.querySelector('.u2-notif-row'));
    expect(api.markRead).toHaveBeenCalledWith('a');
    expect(here()).toBe('/chat/room-1');
    expect(host.querySelector('[data-testid=sub]')?.textContent).toBe('모든 알림을 읽었습니다');
    expect(byText('전체 읽음')).toBeUndefined();
  });
  it('C6 설정 패널: 로드·role=switch·낙관적 토글·실패 시 되돌림', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [], total: 0, unread: 0 });
    api.getPreferences.mockResolvedValue({ email: { session_booked: true }, in_app: { session_booked: false } });
    await mount(createElement(UiV2OrgNotificationsPage));
    await click(byText('설정'));
    expect(api.getPreferences).toHaveBeenCalled();
    const sw = host.querySelectorAll('[role=switch]');
    expect(sw).toHaveLength(2);
    expect(sw[0].getAttribute('aria-checked')).toBe('true');
    expect(sw[0].getAttribute('aria-label')).toBe('세션 예약 이메일 알림');
    api.updatePreferences.mockRejectedValue(new Error('저장 실패'));
    await click(sw[0]);
    expect(host.querySelectorAll('[role=switch]')[0].getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('저장 실패');
    api.updatePreferences.mockImplementation(async (p: unknown) => p);
    await click(host.querySelectorAll('[role=switch]')[1]);
    expect(api.updatePreferences).toHaveBeenLastCalledWith({ email: { session_booked: true }, in_app: { session_booked: true } });
    expect(byText('닫기')).toBeTruthy();
  });
});

describe('C7 /notifications 진입점', () => {
  it('org_admin 은 D안 기관 화면, 플랫폼 관리자는 기존 NotificationCenterPage(코치는 SDD-320 G 에서 D안)', async () => {
    api.listNotifications.mockResolvedValue({ notifications: [], total: 0, unread: 0 });
    useAuthStore.setState({ user: { id: 'u', role: 'platform_admin', name: 'x', email: 'x@example.test' } } as never);
    await mount(createElement(UiV2NotificationCenterPage));
    expect(host.querySelector('[data-testid=legacy-center]')).toBeTruthy();
    act(() => mounted.unmount()); host.remove();
    useAuthStore.setState({ user: { id: 'u', role: 'org_admin', name: 'x', email: 'x@example.test' } } as never);
    await mount(createElement(UiV2NotificationCenterPage));
    expect(host.querySelector('[data-testid=legacy-center]')).toBeNull();
    expect(host.querySelector('.ui-v2 h1')?.textContent).toBe('알림');
  });
});

describe('분기·보존·스코프 (A5/A6/C8/D1/D3)', () => {
  it('D1 진입점 분기는 빌드 상수 삼항이고 off 쪽은 기존 import 와 같은 경로', () => {
    expect(read('src/App.tsx')).toContain("const NotificationCenterPage = lazy(() => import.meta.env.VITE_UI_V2 === 'true'\n  ? import('./pages/notifications/ui-v2/ui-v2-notification-center-page').then((module) => ({ default: module.UiV2NotificationCenterPage }))\n  : import('./pages/notifications/NotificationCenterPage'));");
    expect(read('src/App.tsx')).toContain('<Route path="/notifications" element={<RoleGuard><NotificationCenterPage /></RoleGuard>} />');
    const client = read('src/pages/client/ClientAppPage.tsx');
    expect(client).toMatch(/const UiV2NotificationsPage = lazy\(\(\) => import\.meta\.env\.VITE_UI_V2 === 'true'\s*\? import\('\.\/ui-v2\/ui-v2-notifications-page'\)/);
    expect(client).toContain("if (import.meta.env.VITE_UI_V2 === 'true' && pathname.startsWith('/app/notifications'))");
    expect(client).toContain("return <ClientNotificationPage />;");
  });
  it('공유·구버전 파일에 알림 D안 흔적이 없다', () => {
    for (const f of ['src/pages/client/ClientNotificationPage.tsx', 'src/pages/notifications/NotificationCenterPage.tsx', 'src/components/notifications/NotificationCard.tsx', 'src/lib/notification-format.ts', 'src/lib/api/notifications.ts', 'src/stores/notificationStore.ts', 'src/components/layout/AppShell.tsx', 'src/components/layout/SidebarNav.tsx', 'src/index.css', 'tailwind.config.cjs']) {
      expect(read(f), f).not.toMatch(/ui-v2|UiV2|u2-notif/);
    }
    for (const f of ['src/styles/ui-v2.css', 'src/styles/ui-v2-brand.css', 'src/styles/ui-v2-org.css']) expect(read(f), f).not.toContain('u2-notif');
  });
  it('D3 ui-v2-notifications.css 모든 선택자는 .ui-v2 로 시작, ui-v2-coach.css 의 알림 규칙은 html.u2-coach 로 시작', () => {
    const selectorsOf = (css: string) => {
      const out: string[] = [];
      const walk = (text: string) => {
        let i = 0;
        while (i < text.length) {
          const open = text.indexOf('{', i); if (open < 0) break;
          const head = text.slice(i, open).trim(); let depth = 1; let j = open + 1;
          while (j < text.length && depth > 0) { if (text[j] === '{') depth += 1; else if (text[j] === '}') depth -= 1; j += 1; }
          if (head.startsWith('@media')) walk(text.slice(open + 1, j - 1)); else if (!head.startsWith('@keyframes')) out.push(head);
          i = j;
        }
      };
      walk(css.replace(/\/\*[\s\S]*?\*\//g, '')); return out;
    };
    const mine = selectorsOf(read('src/styles/ui-v2-notifications.css'));
    expect(mine.length).toBeGreaterThan(30);
    for (const g of mine) for (const s of g.split(',').map((x) => x.trim())) expect(s.startsWith('.ui-v2'), s).toBe(true);
    const coach = selectorsOf(read('src/styles/ui-v2-coach.css'));
    for (const g of coach) for (const s of g.split(',').map((x) => x.trim())) expect(s.startsWith('html.u2-coach'), s).toBe(true);
    expect(read('src/styles/ui-v2-notifications.css')).toContain('prefers-reduced-motion');
    expect(read('src/styles/ui-v2-coach.css')).toContain('u2-notif-legacy');
  });
  it('B5 신규 소스 문구에 금지 표현이 없다', () => {
    const files = ['src/pages/notifications/ui-v2', 'src/pages/client/ui-v2'].flatMap((d) => readdirSync(resolve(root, d)).map((f) => `${d}/${f}`)).filter((f) => /notification/.test(f) && /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const text = read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      expect(text, f).not.toMatch(/점수|종합점수|좋음|나쁨|완료율|보증|100\s*%/);
    }
  });
});

describe('check-ui-v2-off 확장 (A3/A4)', () => {
  const mk = (files: Record<string, string>) => {
    const dir = mkdtempSync(resolve(tmpdir(), 'sdd322-')); mkdirSync(resolve(dir, 'assets'), { recursive: true });
    for (const [n, c] of Object.entries(files)) writeFileSync(resolve(dir, n), c);
    return dir;
  };
  it('깨끗한 번들은 통과, 알림 D안 청크명·CSS 가 있으면 실패', async () => {
    const ok = mk({ 'assets/index.js': 'console.log(1)', 'assets/index.css': '.a{color:red}' });
    try { await expect(checkUiV2Off(ok)).resolves.toBeTruthy(); } finally { rmSync(ok, { recursive: true, force: true }); }
    for (const bad of [
      { 'assets/a.js': 'import("./ui-v2-notifications-page-abc.js")' },
      { 'assets/a.js': 'import("./ui-v2-org-notifications-page-abc.js")' },
      { 'assets/a.js': 'import("./ui-v2-notification-center-page-abc.js")' },
      { 'assets/a.js': 'import("./use-ui-v2-notifications-abc.js")' },
      { 'assets/a.css': '.ui-v2 .u2-notif-row{color:red}' },
    ]) {
      const dir = mk(bad);
      try { await expect(checkUiV2Off(dir)).rejects.toThrow(); } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
});
