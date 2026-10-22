// @vitest-environment jsdom
// SDD-219 A1~A9, A11 — 상담 비공개 플래그(VITE_COUNSELING_ENABLED) off/on 양쪽 검증
import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarNav from '../src/components/layout/SidebarNav';
import HostTabs from '../src/components/layout/BottomTabBar';
import MemberTabs from '../src/components/client/BottomTabBar';
import { resolveLegacySessionPath } from '../src/components/routing/legacy-session-path';
import { dashboardSessionPath } from '../src/lib/class-structure/dashboard-navigation';
import { counselingListPath, counselingPath, counselingSessionPath, sessionPath } from '../src/lib/class-structure/navigation';
import { resolveNotificationTarget } from '../src/lib/api/notifications';
import { WIZARD_TYPES, wizardTypeOptions } from '../src/lib/class/class-wizard';
import { MemberStructureHomePage } from '../src/pages/client/member-structure-home-page';
import { useAuthStore } from '../src/stores/authStore';

const api = vi.hoisted(() => ({ getClasses: vi.fn(), getCounseling: vi.fn() }));
vi.mock('../src/lib/api/class-structure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api/class-structure')>()),
  getClasses: api.getClasses,
  getCounseling: api.getCounseling,
}));
vi.mock('../src/components/class/structure/structure-shell', () => ({ StructureShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../src/pages/client/ClientHomePage', () => ({ default: ({ classSections }: { classSections?: React.ReactNode }) => <>{classSections}</> }));
vi.mock('../src/hooks/use-client-counselors', () => ({ useClientCounselors: () => undefined }));

let cleanup: (() => void) | undefined;
function render(node: ReactNode, path = '/') {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(MemoryRouter, { initialEntries: [path] }, node)));
  cleanup = () => { flushSync(() => root.unmount()); container.remove(); };
  return container;
}
const setRole = (role: 'counselor' | 'org_admin' | 'client') => useAuthStore.setState({
  isInitialized: true, isAuthenticated: true,
  user: { id: role, role, name: '사용자', counselors: [] } as unknown as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>,
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.getClasses.mockResolvedValue({ classes: [], total: 0 });
  api.getCounseling.mockResolvedValue({ relationships: [], total: 0 });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.unstubAllEnvs(); });

describe.each([
  { label: '플래그 off(기본)', value: undefined, open: false },
  { label: '플래그 off(false)', value: 'false', open: false },
  { label: '플래그 on', value: 'true', open: true },
])('$label', ({ value, open }) => {
  beforeEach(() => { if (value !== undefined) vi.stubEnv('VITE_COUNSELING_ENABLED', value); else vi.stubEnv('VITE_COUNSELING_ENABLED', ''); });

  it.each([['counselor', '/counseling'], ['org_admin', '/counseling']] as const)('A1 %s 사이드바 상담 항목', (role, to) => {
    setRole(role);
    expect(render(<SidebarNav />) .querySelector(`a[href="${to}"]`) !== null).toBe(open);
  });
  it('A2 회원 사이드바 내 상담', () => {
    setRole('client');
    const view = render(<SidebarNav role="client" />);
    expect(view.querySelector('a[href="/app/counseling"]') !== null).toBe(open);
    expect(view.querySelector('a[href="/app/classes"]')).not.toBeNull();
  });
  it('A3 하단 탭(상담사·회원)', () => {
    const host = render(<HostTabs onMoreClick={() => undefined} role="counselor" />);
    expect(host.querySelector('a[href="/counseling"]') !== null).toBe(open);
    expect(host.querySelector('a[href="/classes"]')).not.toBeNull();
    const member = render(<MemberTabs onMoreClick={() => undefined} />, '/app');
    const memberText = member.textContent ?? '';
    expect(memberText.includes('상담')).toBe(open);
    // 균등 배치: 모든 탭이 flex-1
    const nav = member.querySelector('nav')!;
    for (const el of Array.from(nav.children)) expect(el.className).toContain('flex-1');
    const hostNav = host.querySelector('nav')!;
    for (const el of Array.from(hostNav.children)) expect(el.className).toContain('flex-1');
    expect(hostNav.children.length).toBe(5);
  });
  it('A6 회원 홈 내 상담 영역·조회', async () => {
    setRole('client');
    const view = render(<MemberStructureHomePage />, '/app');
    await vi.waitFor(() => expect(api.getClasses).toHaveBeenCalled());
    expect(view.querySelector('[aria-label="내 상담"]') !== null).toBe(open);
    expect(api.getCounseling).toHaveBeenCalledTimes(open ? 1 : 0);
    if (!open) expect(view.textContent).not.toContain('내 상담');
  });
  it('A7 알림 대상', () => {
    const counseling = { target_type: 'counseling', target_id: 'r1' };
    expect(resolveNotificationTarget(counseling, 'counselor')?.path).toBe(open ? '/counseling/r1' : '/classes');
    expect(resolveNotificationTarget(counseling, 'client')?.path).toBe(open ? '/app/counseling/r1' : '/app/classes');
  });
  it('A8 레거시·대시보드·네비게이션 경로', () => {
    const response = { area: 'counseling', counseling_relationship_id: 'r1' };
    expect(resolveLegacySessionPath('s1', response)).toBe(open ? '/counseling/r1/sessions/s1' : '/classes');
    const row = { id: 's1', class_id: null, counseling_relationship_id: 'r1', area: 'counseling' };
    expect(dashboardSessionPath(row)).toBe(open ? '/counseling/r1/sessions/s1' : '/classes');
    expect(counselingListPath('host')).toBe(open ? '/counseling' : '/classes');
    expect(counselingListPath('member')).toBe(open ? '/app/counseling' : '/app/classes');
    expect(counselingPath('member', 'r1')).toBe(open ? '/app/counseling/r1' : '/app/classes');
    expect(counselingSessionPath('host', 'r1', 's1')).toBe(open ? '/counseling/r1/sessions/s1' : '/classes');
    expect(sessionPath('member', 's1', { area: 'counseling', relationshipId: 'r1' })).toBe(open ? '/app/counseling/r1?sessionId=s1' : '/app/classes');
    // 명상 경로는 플래그와 무관하다.
    expect(resolveLegacySessionPath('s1', { area: 'meditation', class_id: 'c1' })).toBe('/classes/c1/sessions/s1');
  });
  it('A9 마법사 유형 선택지', () => {
    const ids = wizardTypeOptions().map((t) => t.id);
    expect(ids.includes('clinical')).toBe(open);
    expect(ids.includes('hypnosis')).toBe(open);
    expect(ids).toContain('meditation');
    // 라벨 조회용 전체 목록은 유지된다.
    expect(WIZARD_TYPES.length).toBe(4);
  });
});

describe('A11 /counseling 경로 문자열 전수 검사', () => {
  const root = join(__dirname, '../src');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
  // 상담 페이지 자체·상담 API·라우트 정의(App.tsx, CounselingGate 로 감쌈)는 게이트 대상이 아니다.
  const exempt = (file: string): boolean => file.startsWith('pages/counseling/') || file === 'App.tsx'
    || file === 'components/class/structure/counseling-views.tsx' || file === 'lib/api/class-structure.ts';
  const files = walk(root).map((full) => ({ file: relative(root, full), text: readFileSync(full, 'utf8') }));
  const users = files.filter(({ file, text }) => !exempt(file) && /['"`]\/(app\/)?counseling/.test(text));

  it('게이트 밖 직접 사용은 플래그 판정 파일에만 존재한다', () => {
    for (const { file, text } of users) expect(text, file).toContain('isCounselingEnabled');
  });
  it('App.tsx 의 상담 라우트는 전부 CounselingGate 로 감싼다', () => {
    const app = files.find(({ file }) => file === 'App.tsx')!.text;
    const routes = app.split('\n').filter((line) => /<Route path="\/(app\/)?counseling/.test(line));
    expect(routes.length).toBeGreaterThan(0);
    for (const line of routes) expect(line).toContain('<CounselingGate');
  });
});
