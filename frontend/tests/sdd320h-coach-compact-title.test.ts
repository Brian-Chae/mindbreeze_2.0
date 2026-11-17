// @vitest-environment jsdom
// SDD-320 H — 코치 모바일 스크롤 시 상단 바 제목: 노출·복귀·제목 없음·격리 규칙.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { attachCoachCompactTitle, shouldCollapse, readCoachTitle, COACH_COLLAPSED_CLASS, COMPACT_TITLE_CLASS } from '../src/components/ui-v2/ui-v2-coach-compact-title';

const root = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

function mountShell(title: string | null) {
  document.body.innerHTML = `<div data-shell-variant="default"><header class="mb-shell-topbar"><button>menu</button><button><span class="font-extrabold">Mind Breeze</span></button><button>bell</button></header>
  ${title === null ? '' : `<div data-ui="page-header" class="mb-page-header mb-page-header-mobile"><h1>${title}</h1></div>`}
  <div data-mobile-swipe-page id="page"></div></div>`;
  const page = document.getElementById('page') as HTMLElement;
  Object.defineProperty(page, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(page, 'clientHeight', { value: 600, configurable: true });
  return page;
}
function scrollTo(page: HTMLElement, top: number) { page.scrollTop = top; page.dispatchEvent(new Event('scroll', { bubbles: false })); }

describe('shouldCollapse', () => {
  it('임계값 이하는 펼침, 초과는 접힘', () => {
    expect(shouldCollapse(10, 2000, 600, 56, false)).toBe(false);
    expect(shouldCollapse(80, 2000, 600, 56, false)).toBe(true);
  });
  it('접힌 뒤 맨 위로 오면 복귀, 그 전엔 유지(히스테리시스)', () => {
    expect(shouldCollapse(5, 2000, 600, 56, true)).toBe(true);
    expect(shouldCollapse(0, 2000, 600, 56, true)).toBe(false);
  });
  it('스크롤 여유가 제목 높이보다 작으면 접지 않음', () => {
    expect(shouldCollapse(80, 650, 600, 56, false)).toBe(false);
  });
});

describe('attachCoachCompactTitle', () => {
  let off: () => void;
  beforeEach(() => {
    document.documentElement.className = 'u2-coach';
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => { off?.(); document.body.innerHTML = ''; document.documentElement.className = ''; });

  it('스크롤하면 상단 바에 현재 제목이 나타나고 올리면 사라진다', () => {
    const page = mountShell('명상 클래스');
    off = attachCoachCompactTitle();
    scrollTo(page, 120);
    const node = document.querySelector<HTMLElement>(`.${COMPACT_TITLE_CLASS}`)!;
    expect(node.textContent).toBe('명상 클래스');
    expect(node.dataset.shown).toBe('true');
    expect(document.documentElement.classList.contains(COACH_COLLAPSED_CLASS)).toBe(true);
    scrollTo(page, 0);
    expect(node.dataset.shown).toBe('false');
    expect(document.documentElement.classList.contains(COACH_COLLAPSED_CLASS)).toBe(false);
  });
  it('제목이 없는 화면은 로고를 유지', () => {
    const page = mountShell(null);
    off = attachCoachCompactTitle();
    scrollTo(page, 120);
    expect(document.documentElement.classList.contains(COACH_COLLAPSED_CLASS)).toBe(false);
    expect(document.querySelector<HTMLElement>(`.${COMPACT_TITLE_CLASS}`)?.dataset.shown).not.toBe('true');
  });
  it('PC 폭에서는 접지 않는다', () => {
    const page = mountShell('회원');
    window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
    off = attachCoachCompactTitle();
    scrollTo(page, 120);
    expect(document.documentElement.classList.contains(COACH_COLLAPSED_CLASS)).toBe(false);
  });
  it('해제하면 주입한 노드·클래스를 정리', () => {
    const page = mountShell('설정');
    off = attachCoachCompactTitle();
    scrollTo(page, 120); off();
    expect(document.querySelector(`.${COMPACT_TITLE_CLASS}`)).toBeNull();
    expect(readCoachTitle()).toBe('설정');
  });
});

describe('격리 규칙', () => {
  it('레거시 AppShell 은 수정하지 않았고 스코프 모듈과 CSS 로만 동작', () => {
    expect(read('src/components/layout/AppShell.tsx')).not.toMatch(/compact-title|u2-coach/);
    expect(read('src/components/ui-v2/ui-v2-coach-scope.ts')).toMatch(/attachCoachCompactTitle/);
    expect(read('src/styles/ui-v2-coach.css')).toMatch(/u2-coach-compact-title\[data-shown="true"\]/);
    expect(read('src/styles/ui-v2-coach.css')).toMatch(/u2-coach-collapsed \[data-ui="page-header"\]\.mb-page-header-mobile\{display:none\}/);
  });
  it('운영 번들 검사 스크립트에 규칙이 있다', () => {
    expect(read('scripts/check-ui-v2-off.mjs')).toMatch(/ui-v2-coach-compact-title/);
  });
});
