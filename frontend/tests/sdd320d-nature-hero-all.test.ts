// SDD-320 후속 4 — 회원·코치·기관 메인 카드 자연 배경 통일(소스 대조)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { natureHeroStyle, NATURE_HERO_GRADIENT } from '../src/components/ui-v2/nature-hero';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const coach = read('src/styles/ui-v2-coach-classes.css');
const base = read('src/styles/ui-v2.css');

describe('natureHeroStyle', () => {
  it('같은 id 는 같은 사진, 그라데이션 포함', () => {
    expect(natureHeroStyle('abc').backgroundImage).toBe(natureHeroStyle('abc').backgroundImage);
    expect(natureHeroStyle('abc').backgroundImage).toContain(NATURE_HERO_GRADIENT);
    expect(natureHeroStyle('abc').backgroundImage).toMatch(/url\(\/images\/background\d+\.webp\)/);
  });
  it('id 가 없으면 home 고정 사진', () => {
    expect(natureHeroStyle(null).backgroundImage).toBe(natureHeroStyle('home').backgroundImage);
    expect(natureHeroStyle('').backgroundImage).toBe(natureHeroStyle('home').backgroundImage);
  });
  it('그라데이션 stop 에 금지 표현 없음', () => expect(NATURE_HERO_GRADIENT).not.toContain('100%'));
});

describe('적용 대상', () => {
  it('회원 내 클래스 대표 카드', () => {
    const s = read('src/pages/client/ui-v2/ui-v2-classes-page.tsx');
    expect(s).toContain('u2-hero--nature');
    expect(s).toContain('natureHeroStyle(model.id)');
  });
  it('기관 대시보드 기관 코드 카드는 코치 코드 카드와 같은 모양(SDD-321 C)', () => {
    const s = read('src/pages/org/ui-v2/ui-v2-org-dashboard-page.tsx');
    expect(s).toContain('UiV2OrgCodeCard');
    expect(read('src/components/ui-v2/ui-v2-org-code-card.tsx')).toContain('u2-coach-code');
  });
  it('코치 메인 카드: 어두운 폴백 배경색·흰 글자·흰 버튼, 틴트 제거', () => {
    expect(coach).toMatch(/\.ch-hero\{background:#251038/);
    expect(coach).toMatch(/\.cs-open-hero\{background-color:#251038/);
    expect(coach).toMatch(/\.cs-class-hero\{[^}]*background-color:#251038/);
    expect(coach).toMatch(/bg-purple-900"\]\{background-color:#251038/);
    expect(coach).toMatch(/\.sh-hcta\{background:#FFFFFF/);
    expect(coach).not.toMatch(/\.cs-open-hero\{[^}]*var\(--u2-tint\)/);
  });
  it('공용 규칙 폴백 배경색', () => expect(base).toMatch(/\.u2-hero--nature\{background-color:#251038\}/));
});

describe('금지 표현·하단 메뉴', () => {
  it('신규 CSS/TS 에 금지 표현 없음', () => {
    for (const s of [coach, read('src/components/ui-v2/nature-hero.ts'), read('src/styles/ui-v2-org.css').slice(read('src/styles/ui-v2-org.css').indexOf('후속 4')), base.slice(base.indexOf('후속 4'))]) expect(s).not.toMatch(/점수|종합점수|좋음|나쁨|보증|100%/);
  });
  it('하단 메뉴 규칙을 이번 변경에서 건드리지 않음', () => {
    for (const s of [coach, base.slice(base.indexOf('후속 4'))]) expect(s).not.toMatch(/floating-bottom-nav|\.u2-nav/);
  });
});
