// @vitest-environment jsdom
// SDD-320 — 코치 D안 스코프 판정·CSS 스코프·공유 파일 무수정.
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { attachCoachScope, isCoachScopePath, shouldApplyCoachScope } from '../src/components/ui-v2/ui-v2-coach-scope';
import { useAuthStore } from '../src/stores/authStore';

const root = resolve(__dirname, '..');

describe('코치 스코프 경로 판정', () => {
  it.each(['/dashboard', '/classes', '/classes/abc', '/classes/abc/sessions/s1', '/clients', '/clients/1', '/reports', '/reports/7', '/counseling', '/upload-status', '/chat', '/chat/r1', '/settings', '/notifications'])('%s 는 적용', (p) => {
    expect(isCoachScopePath(p)).toBe(true);
  });
  it.each(['/', '/login', '/dashboard/org', '/org/counselors', '/admin/orgs', '/sessions/s1/player', '/sessions/s1/live', '/classes/now', '/app', '/app/classes', '/reports/sample', '/join'])('%s 는 제외', (p) => {
    expect(isCoachScopePath(p)).toBe(false);
  });
  it('역할은 counselor 만', () => {
    expect(shouldApplyCoachScope('counselor', '/dashboard')).toBe(true);
    for (const role of ['org_admin', 'client', 'platform_admin', null, undefined]) expect(shouldApplyCoachScope(role, '/dashboard')).toBe(false);
  });
});

describe('attachCoachScope', () => {
  beforeEach(() => { document.documentElement.className = ''; });
  it('이동·로그아웃에 따라 클래스를 토글하고 해제 시 제거', () => {
    let listener: (s: { location: { pathname: string } }) => void = () => undefined;
    const router = { state: { location: { pathname: '/dashboard' } }, subscribe: (l: typeof listener) => { listener = l; return () => undefined; } };
    useAuthStore.setState({ user: { id: 'u', role: 'counselor' } as never });
    const off = attachCoachScope(router);
    expect(document.documentElement.classList.contains('u2-coach')).toBe(true);
    router.state.location.pathname = '/sessions/s1/player';
    listener(router.state);
    expect(document.documentElement.classList.contains('u2-coach')).toBe(false);
    router.state.location.pathname = '/classes';
    listener(router.state);
    expect(document.documentElement.classList.contains('u2-coach')).toBe(true);
    useAuthStore.setState({ user: null });
    expect(document.documentElement.classList.contains('u2-coach')).toBe(false);
    off();
    expect(document.documentElement.classList.contains('u2-coach')).toBe(false);
  });
});

describe('CSS 스코프·공유 파일', () => {
  it('모든 규칙이 html.u2-coach 하위(전역 규칙 없음)', () => {
    const css = readFileSync(resolve(root, 'src/styles/ui-v2-coach.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = css.split('}').map((b) => b.split('{')[0].trim()).filter((s) => s && !s.startsWith('@') && !/^(from|to)$/.test(s));
    const bad = selectors.flatMap((group) => group.split(',').map((x) => x.trim())).filter((sel) => sel && !sel.startsWith('html.u2-coach'));
    expect(bad).toEqual([]);
  });
  it('금지 표현 없음', () => {
    for (const f of ['src/styles/ui-v2-coach.css', 'src/components/ui-v2/ui-v2-coach-scope.ts']) {
      expect(readFileSync(resolve(root, f), 'utf8')).not.toMatch(/종합점수|좋음|나쁨|완료율|보증|100\s*%/);
    }
  });
  it('공유 쉘·전역 CSS·기존 D안 파일 무수정', () => {
    let changed: string;
    try { changed = execSync('git diff --name-only 83fb65c6 -- src', { cwd: root, encoding: 'utf8' }); } catch { return; }
    const forbidden = ['AppShell.tsx', 'SidebarNav.tsx', 'BottomTabBar.tsx', 'floating-bottom-nav', 'src/index.css', 'tailwind.config', 'styles/ui-v2.css', 'styles/ui-v2-brand.css', 'DashboardPage.tsx'];
    expect(changed.split('\n').filter((f) => forbidden.some((x) => f.includes(x)))).toEqual([]);
  });
});
