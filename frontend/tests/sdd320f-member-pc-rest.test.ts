// SDD-320 F-3 — 회원 PC 잔여(내 클래스 2열, 대화 목록+방) 소스 대조
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('회원 내 클래스 PC 2열', () => {
  const src = read('src/pages/client/ui-v2/ui-v2-classes-page.tsx');
  const css = read('src/styles/ui-v2-pc.css');
  it('참여 중은 좌열, 그 밖의 상태는 우열', () => {
    expect(src).toContain("g.label === '참여 중'");
    expect(src).toContain("g.label !== '참여 중'");
    expect(src).toContain('u2-pc-cols u2-pc-cols--classes');
  });
  it('기존 동작(신청·코드 입장·코드 가입·상태 그룹) 유지', () => {
    for (const k of ['openApply', 'CodeEntryButton', 'CodeJoinCard', 'ReadStateView', 'classPath']) expect(src).toContain(k);
  });
  it('2열 CSS 는 1024 이상에서만, 우열이 없으면 전체 폭', () => {
    expect(css).toMatch(/@media \(min-width: 1024px\)[\s\S]*u2-pc-cols--classes \{ grid-template-columns/);
    expect(css).toContain('.u2-pc-main:only-child { grid-column: 1 / -1; }');
  });
  it('대화 목록 320 + 대화창 (기존 ui-v2.css 규칙 재사용, PC 에서 여백만 보정)', () => {
    expect(read('src/styles/ui-v2.css')).toContain('.ui-v2 .u2-chat-list{display:flex;width:320px');
    expect(css).toContain('[data-shell-variant="ui-v2"] .ui-v2 .u2-chat-list { width: 320px; }');
  });
  it('금지 표현 없음', () => expect(css).not.toMatch(/점수|종합점수|좋음|나쁨|보증|100%/));
});
