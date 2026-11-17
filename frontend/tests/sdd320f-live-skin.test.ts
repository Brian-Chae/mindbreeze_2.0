// SDD-320 F-5 — 라이브 스킨: CSS·스코프만, HostLiveView·소켓·명령 흐름 무수정(git diff 0) + 스코프 판정
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isLiveScopePath, shouldApplyLiveScope } from '../src/components/ui-v2/ui-v2-coach-scope';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const css = read('src/styles/ui-v2-coach-live.css');

describe('라이브 스코프 판정', () => {
  it('진행·대기실·즉석 시작 경로만', () => {
    for (const p of ['/sessions/abc/player', '/sessions/abc/live', '/classes/now', '/classes/now/']) expect(isLiveScopePath(p)).toBe(true);
    for (const p of ['/classes', '/classes/abc', '/sessions/abc/summary', '/reports', '/dashboard']) expect(isLiveScopePath(p)).toBe(false);
  });
  it('코치에게만 적용', () => {
    expect(shouldApplyLiveScope('counselor', '/sessions/x/player')).toBe(true);
    expect(shouldApplyLiveScope('client', '/sessions/x/player')).toBe(false);
    expect(shouldApplyLiveScope(null, '/classes/now')).toBe(false);
  });
});

describe('라이브 스킨 범위', () => {
  it('규칙은 html.u2-live 하위로만 한정', () => {
    const selectors = css.split('\n').filter((l) => /\{/.test(l)).map((l) => l.trim().split('{')[0]);
    for (const s of selectors) for (const part of s.split(',')) expect(part.trim().startsWith('html.u2-live')).toBe(true);
  });
  it('금지 표현 없음', () => expect(css).not.toMatch(/점수|종합점수|좋음|나쁨|보증|100%/));
  it('스코프 CSS 는 코치 스코프 모듈에서만 import(운영 번들 미포함)', () => {
    expect(read('src/components/ui-v2/ui-v2-coach-scope.ts')).toContain('ui-v2-coach-live.css');
    for (const f of ['src/main.tsx', 'src/App.tsx']) expect(read(f)).not.toContain('ui-v2-coach-live');
  });
});

describe('라이브 로직 무수정(기준 = 이번 작업 이전 커밋 d2fa8920)', () => {
  const guarded = ['src/components/class/player/host', 'src/components/class/flow', 'src/pages/classes/instant-class-page.tsx', 'src/pages/sessions', 'src/hooks', 'src/lib/class', 'src/lib/api/session.ts'];
  it('HostLiveView·소켓·명령 흐름 diff 0', () => {
    const out = execSync(`git diff --name-only d2fa8920 HEAD -- ${guarded.map((g) => `"${g}"`).join(' ')}`, { cwd: fileURLToPath(new URL('..', import.meta.url)) }).toString().trim();
    expect(out).toBe('');
  });
});

describe('F-0/F-4 코치 메뉴 순서 매핑(항목 삭제 0)', () => {
  const pc = read('src/styles/ui-v2-pc.css');
  const nav = read('src/components/layout/SidebarNav.tsx');
  it('시안 순서 7항목에 order 부여, 그 외 항목은 하단 그룹', () => {
    const order: Record<string, number> = { '/dashboard': 1, '/classes': 2, '/clients': 3, '/reports': 4, '/chat': 5, '/counseling': 6, '/settings': 7 };
    for (const [href, n] of Object.entries(order)) expect(pc).toContain(`a[href="${href}"] { order: ${n}; }`);
    // 11/9 대표 지시: 설정 아래 가로선 → 플레이그라운드 · 데이터 현황 · 알림
    expect(pc).toContain('a[href="/playground"] { order: 60;');
    expect(pc).toContain('a[href="/upload-status"] { order: 61;');
    expect(pc).toContain('a[href="/notifications"] { order: 62;');
    expect(pc).toMatch(/a \{ order: 50; \}/);
  });
  it('코치 메뉴 항목은 CSS 로만 정렬(레거시 SidebarNav 항목 목록 그대로)', () => {
    for (const to of ['/dashboard', '/classes', '/clients', '/counseling', '/chat', '/reports', '/upload-status', '/playground', '/notifications', '/settings']) expect(nav).toContain(`to: '${to}'`);
  });
});
