// SDD-320 J — 코치 PC 설정·데이터 현황 폭 정합: 항목 전부 유지, 홀수 마지막 카드 전체 폭, 모바일 미적용, 레거시 미수정.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const pc = read('src/styles/ui-v2-coach-pc.css');
const classes = read('src/styles/ui-v2-pc.css');
const settings = read('src/pages/coach/ui-v2/ui-v2-coach-settings-page.tsx');

/** 마지막 "SDD-320 J" 주석 이후의 @media(≥1024) 블록 본문 */
function jBlock(css: string): string {
  const at = css.lastIndexOf('SDD-320 J');
  const rest = css.slice(at);
  const m = rest.match(/@media \(min-width: 1024px\) \{([\s\S]*?)\n\}/);
  expect(m).not.toBeNull();
  return m![1];
}

describe('설정 항목 유지', () => {
  it('7개 항목 제목이 모두 렌더 코드에 있다', () => {
    for (const t of ['내 계정', '데이터 현황', '알림', '차단한 사용자', '기기 · LINK BAND', '개인정보 · 약관', '앱 정보']) {
      expect(settings).toContain(`title="${t}"`);
    }
    expect(settings).toContain('리포트 · 운영 설정');
    expect(settings).toContain('로그아웃');
  });
  it('pc 스타일을 import 한다', () => {
    expect(settings).toContain("styles/ui-v2-coach-pc.css");
  });
});

describe('PC 전용 규칙', () => {
  const block = jBlock(pc);
  it('설정 2열 그리드와 홀수 마지막 카드 전체 폭', () => {
    expect(block).toMatch(/\.u2-setlist \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    expect(block).toMatch(/\.u2-setgroup:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
  });
  it('래퍼 폭은 .u2f 와 같은 규칙(좌우 48px, 최대 1600px)', () => {
    expect(block).toMatch(/\.ui-v2\.u2c-settings \{ padding: 0 48px 72px; max-width: 1600px; \}/);
  });
  it('데이터 현황 규칙은 html.u2-coach 스코프 + PC 미디어쿼리 안에만 있다', () => {
    const b = jBlock(classes);
    expect(b).toContain('html.u2-coach .max-w-6xl:has(> [data-testid="upload-overview"])');
    expect(b).toContain('max-width: 1600px');
  });
  it('모바일(<1024)에는 J 규칙이 새지 않는다', () => {
    const outsidePc = pc.slice(0, pc.lastIndexOf('SDD-320 J'));
    expect(outsidePc).not.toContain('grid-column: 1 / -1; }\n  .ui-v2.u2c-settings');
    const outsideClasses = classes.slice(0, classes.lastIndexOf('SDD-320 J'));
    expect(outsideClasses).not.toContain('upload-overview');
  });
  it('레거시 데이터 현황 페이지는 수정하지 않았다', () => {
    expect(read('src/pages/upload-status/overview-page.tsx')).toContain('mx-auto max-w-6xl space-y-4');
  });
});
