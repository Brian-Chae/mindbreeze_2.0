// SDD-321 기관 정합(11/9) — 기관관리자도 코치 셸/스킨/화면 부품을 쓴다. 레거시(플래그 off)·코치·회원 동작은 불변.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isOrgScopePath, shouldApplyCoachScope, isCoachUiRole } from '../src/components/ui-v2/ui-v2-coach-scope';

const read = (p: string): string => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('기관 스코프 판정', () => {
  it('기관관리자는 기관 업무 경로에서 코치 스코프(html.u2-coach)를 받는다', () => {
    for (const path of ['/dashboard/org', '/classes', '/clients', '/org/counselors', '/org/data-center', '/reports', '/chat', '/settings', '/upload-status', '/notifications', '/playground']) {
      expect(shouldApplyCoachScope('org_admin', path)).toBe(true);
    }
  });
  it('라이브·샘플·공개 경로와 다른 역할은 제외한다', () => {
    expect(isOrgScopePath('/sessions/abc/player')).toBe(false);
    expect(isOrgScopePath('/classes/now')).toBe(false);
    expect(isOrgScopePath('/org/search')).toBe(false);
    expect(shouldApplyCoachScope('platform_admin', '/dashboard/org')).toBe(false);
    expect(shouldApplyCoachScope('client', '/classes')).toBe(false);
    expect(shouldApplyCoachScope(null, '/classes')).toBe(false);
  });
  it('코치 판정은 그대로(기관 홈은 코치 경로가 아님)', () => {
    expect(shouldApplyCoachScope('counselor', '/dashboard')).toBe(true);
    expect(shouldApplyCoachScope('counselor', '/dashboard/org')).toBe(false);
    expect(isCoachUiRole('org_admin')).toBe(true);
    expect(isCoachUiRole('client')).toBe(false);
  });
});

describe('기관 셸·스타일 구조', () => {
  const shell = read('src/components/ui-v2/ui-v2-org-shell.tsx');
  it('기관 셸은 공유 AppShell + 코치 본문 래퍼(.u2f)를 쓰고 자체 사이드바·상단 바를 만들지 않는다', () => {
    expect(shell).toContain("import AppShell from '../layout/AppShell'");
    expect(shell).toContain('ui-v2 u2f u2f-org');
    expect(shell).not.toContain('<aside');
    expect(shell).not.toContain('u2-org-toolbar');
  });
  it('사이드바 순서·가로선은 ::before 로 그리고 border-top 을 쓰지 않는다', () => {
    const css = read('src/styles/ui-v2-org-side.css');
    expect(css).toContain('a[href="/org/data-center"]::before');
    expect(css).not.toMatch(/border-top/);
    expect(css).toContain('@media (min-width: 1024px)');
  });
  it('코치 스코프가 기관 사이드바 스타일을 불러온다', () => {
    expect(read('src/components/ui-v2/ui-v2-coach-scope.ts')).toContain("ui-v2-org-side.css");
  });
  it('회원 목록은 기관 쪽에서 기존 화면 유지(orgLegacy)', () => {
    expect(read('src/App.tsx')).toMatch(/LegacyClientsPage\} orgLegacy \/>/);
  });
});
