// SDD-320 후속 3 — 클래스·회원·리포트 빈 상태 D안: 회원 목록 기본 보기 진리표, CSS 스코프, 보존, 금지 영역 무수정.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defaultClientViewMode } from '../src/lib/clients/overview';

const root = resolve(__dirname, '..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');
const css = read('src/styles/ui-v2-coach-classes.css');

describe('회원 목록 기본 보기 진리표', () => {
  const base = { stored: null, isCoach: true, flag: true, width: 390 };
  it('코치+플래그+모바일+저장 없음 → 카드', () => expect(defaultClientViewMode(base)).toBe('cards'));
  it('데스크톱(768 이상) → 표', () => expect(defaultClientViewMode({ ...base, width: 768 })).toBe('table'));
  it('767px 는 모바일', () => expect(defaultClientViewMode({ ...base, width: 767 })).toBe('cards'));
  it('기관관리자 → 표', () => expect(defaultClientViewMode({ ...base, isCoach: false })).toBe('table'));
  it('플래그 off(운영) → 표', () => expect(defaultClientViewMode({ ...base, flag: false })).toBe('table'));
  it('저장된 선택이 우선(표/카드)', () => {
    expect(defaultClientViewMode({ ...base, stored: 'table' })).toBe('table');
    expect(defaultClientViewMode({ ...base, stored: 'cards', width: 1440, flag: false })).toBe('cards');
  });
});

describe('회원 목록 보존', () => {
  const src = read('src/pages/clients/ClientListPage.tsx');
  it.each(['보기 전환', 'ClientTable', 'ClientCards', 'groupClients', 'saveViewMode', 'member_type', 'counselor', 'days', 'group'])('%s 유지', (t) => expect(src).toContain(t));
  it('플래그·코치 조건으로만 기본값 변경', () => expect(src).toMatch(/VITE_UI_V2 === 'true'/));
});

describe('코치 클래스 CSS 스코프', () => {
  const rules = css.split('}').map((r) => r.trim()).filter((r) => r && !r.startsWith('/*') || r.includes('{'));
  it('모든 규칙 선택자가 html.u2-coach 로 시작', () => {
    const bodies = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
    expect(bodies.length).toBeGreaterThan(20);
    for (const sel of bodies) for (const part of sel.split(',')) expect(part.trim().startsWith('html.u2-coach')).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });
  it('메인 카드는 사진을 덮지 않고 어두운 폴백 배경색을 둔다(SDD-320 후속 4)', () => { expect(css).not.toMatch(/background-image:none!important/); expect(css).toMatch(/background-color:#251038/); });
  it('금지 표현 없음', () => expect(css).not.toMatch(/점수|종합점수|좋음|나쁨|보증|100%/));
});

describe('금지 영역 무수정', () => {
  const changed = execSync('git diff --name-only c785e4b7 HEAD -- . ; git diff --name-only HEAD -- .', { cwd: root }).toString();
  it('실시간 진행·하단 메뉴 관련 파일 diff 0', () => {
    for (const f of ['frontend/src/pages/sessions', 'instant-class', 'structure-shell.css', 'ui-v2.css', 'ui-v2-coach.css', 'app-shell', 'AppShell']) expect(changed).not.toContain(f);
  });
  it('클래스 목록·상세 TSX 무수정(마크업 불변)', () => {
    expect(changed).not.toContain('host-classes-page.tsx');
    expect(changed).not.toContain('host-class-detail-page.tsx');
    expect(changed).not.toContain('host-class-views.tsx');
  });
});
