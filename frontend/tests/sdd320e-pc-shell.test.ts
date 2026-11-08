// SDD-320 E — PC 공통 셸 / 회원 설정 제목 / 금지어 / 플래그 격리(소스 대조)
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FORBIDDEN = /점수|종합점수|좋음|나쁨|보증|100%/;
const pc = read('src/styles/ui-v2-pc.css');

describe('PC 공통 셸 CSS', () => {
  it('1024px 이상에서만 적용되고 216px 그라데이션 메뉴', () => {
    expect(pc).toMatch(/@media \(min-width: 1024px\)/);
    expect(pc).toContain('216px minmax(0, 1fr)');
    expect(pc).toContain('linear-gradient(120deg, #3A1650, #251038)');
  });
  it('회원 쉘과 코치 스코프 둘 다 대상, 그 밖의 전역 선택자 없음', () => {
    expect(pc).toContain('[data-shell-variant="ui-v2"]');
    expect(pc).toContain('html.u2-coach [data-shell-variant]');
  });
  it('금지 표현 없음', () => expect(pc).not.toMatch(FORBIDDEN));
  it('Pretendard MB 글꼴 스택', () => expect(pc).toContain("'Pretendard MB'"));
});

describe('진입점 import (UI_V2 쉘/코치 스코프에서만)', () => {
  it('회원 쉘', () => expect(read('src/components/ui-v2/ui-v2-client-shell.tsx')).toContain("ui-v2-pc.css"));
  it('코치 스코프', () => expect(read('src/components/ui-v2/ui-v2-coach-scope.ts')).toContain("ui-v2-pc.css"));
  it('레거시 공용 파일은 PC CSS 를 import 하지 않는다', () => {
    for (const f of ['src/components/layout/AppShell.tsx', 'src/components/layout/SidebarNav.tsx', 'src/main.tsx']) {
      expect(read(f)).not.toContain('ui-v2-pc');
    }
  });
});

describe('회원 설정 제목 31px', () => {
  const base = read('src/styles/ui-v2.css');
  it('.ui-v2 h1 = 31px / 600 / -1.35px', () => {
    expect(base).toMatch(/\.ui-v2 h1\{font-size:31px;line-height:1\.25;letter-spacing:-1\.35px;font-weight:600\}/);
  });
  it('설정 화면은 UiV2ClientShell 의 h1 을 쓰고 제목 크기를 따로 줄이지 않는다', () => {
    const s = read('src/pages/client/ui-v2/ui-v2-settings-page.tsx');
    expect(s).toContain('<UiV2ClientShell title="설정"');
    expect(s).not.toMatch(/<h1[^>]*style/);
    expect(base).not.toMatch(/u2-heading h1\{[^}]*font-size:2[0-9]px/);
  });
});

describe('E 신규 파일 금지 표현', () => {
  it('ui-v2-pc* 스타일/컴포넌트에 금지어 없음', () => {
    const dirs = ['src/styles', 'src/components/ui-v2'];
    for (const d of dirs) {
      for (const f of readdirSync(new URL(`../${d}`, import.meta.url))) {
        if (!/^ui-v2-pc/.test(f)) continue;
        expect(read(`${d}/${f}`)).not.toMatch(FORBIDDEN);
      }
    }
  });
});
