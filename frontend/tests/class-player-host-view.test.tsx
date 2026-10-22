// @vitest-environment jsdom
// SDD-208 H1 — 상담사 진행 화면 뷰(지표 띠·타일 라벨·스크롤 그리드·도크·상단 바). 하니스 픽스처 경로로 렌더한다.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playerCases } from '../src/lib/class/fixtures/host-cases';
import { HARNESS_BACKDROP_SRC, type PlayerCaseContext } from '../src/lib/class/player-harness';

let root: Root;
let container: HTMLDivElement;

function ctxFor(query = ''): PlayerCaseContext {
  const params = new URLSearchParams(query);
  return { sheet: params.get('sheet') || null, detail: params.get('detail') || null, backdropSrc: HARNESS_BACKDROP_SRC, params };
}
async function renderCase(id: string, query = ''): Promise<void> {
  const node: ReactNode = playerCases[id].render(ctxFor(query));
  await act(async () => { root.render(node); });
}
async function setViewport(width: number, height: number): Promise<void> {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  await act(async () => { window.dispatchEvent(new Event('resize')); });
}
const all = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const one = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await setViewport(1280, 720);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('상담사 뷰 — C01 기본', () => {
  it('상단 바는 X 없이 제목·함께한 시간/계획 시간·접속 인원·종료를 두고 나가기는 도구에 있다', async () => {
    await renderCase('C01');
    expect(one('[data-pz="top"]')).not.toBeNull();
    expect(one('[data-pz="btn-close"]')).toBeNull();
    expect(one('[data-pz="btn-end"]')?.getAttribute('aria-label')).toBe('클래스 종료');
    const title = text(one('[data-pz="ttl"]'));
    expect(title).toContain('마음챙김 명상수업');
    expect(title).toContain('12:34');
    expect(title).toContain('30:00');
    expect(text(one('.hp-topbar-stats')).replace(/\s/g, '')).toBe('접속7/8');
  });

  it('지표 띠에 지금 보는 지표명(큰 글자)과 그룹 평균이 있다', async () => {
    await renderCase('C01');
    const strip = one('[data-pz="mstrip"]');
    expect(text(strip)).toContain('지금 보는 지표');
    expect(text(strip)).toContain('이완도');
    expect(text(strip)).toContain('그룹 평균');
    expect(text(strip)).toContain('66');
  });

  it('타일 8개의 지표 라벨은 띠 지표 약칭과 같고, 띠·타일이 같은 지표 색을 쓴다', async () => {
    await renderCase('C01');
    const tiles = all('[data-pz="tile"]');
    expect(tiles).toHaveLength(8);
    const labeled = tiles.filter((t) => t.dataset.band === 'on');
    expect(labeled).toHaveLength(5);
    for (const tile of labeled) expect(text(tile.querySelector('.hp-ring-label'))).toBe('이완');
    const strip = one('[data-pz="mstrip"]');
    expect(strip?.getAttribute('data-metric')).toBe('relaxation');
    const colorOf = (el: HTMLElement | null): string => el?.style.getPropertyValue('--mcol') ?? '';
    expect(colorOf(strip)).toBe('var(--m-relax)');
    expect(colorOf(one('[data-pz="gridscroll"] .hp-grid'))).toBe(colorOf(strip));
  });

  it('페이지 버튼(‹ ›)과 페이지 내비게이션이 없다', async () => {
    await renderCase('C01');
    expect(all('[aria-label*="페이지"]')).toHaveLength(0);
    const visible = text(document.body);
    expect(visible).not.toContain('‹');
    expect(visible).not.toContain('›');
  });

  it('도크 5개: 지표 기준·채팅(안읽음)·미디어·체크인·도구', async () => {
    await renderCase('C01');
    const labels = all('[data-pz="dk"]').map((d) => text(d.querySelector('.pz-dk__label')));
    expect(labels).toEqual(['지표 기준', '채팅', '미디어', '체크인', '도구']);
  });

  it('칩 줄에는 연결 5 · 미착용 2 · 끊김 1 요약이 있다', async () => {
    await renderCase('C01');
    const line = text(one('[data-pz="chipline"]'));
    expect(line).toContain('연결 5');
    expect(line).toContain('미착용 2');
    expect(line).toContain('끊김 1');
  });
});

describe('상담사 뷰 — 스크롤 그리드(C18)', () => {
  it('20명이 모두 렌더되고(페이지 분할 없음) 손든 회원 3명이 앞에 온다', async () => {
    await renderCase('C18');
    const tiles = all('[data-pz="tile"]');
    expect(tiles).toHaveLength(20);
    expect(tiles.slice(0, 3).map((t) => t.dataset.participantId)).toEqual(['p10', 'p13', 'p18']);
  });

  it('그리드 영역 CSS 는 세로 스크롤(overflow-y:auto)이고 페이지 버튼 규칙이 없다', () => {
    const css = readFileSync(resolve(__dirname, '../src/components/class/player/host/host-player.css'), 'utf8');
    expect(css).toMatch(/\.hp-gridscroll\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).not.toMatch(/pagination/);
  });

  it('마지막 행 가운데 정렬과 확정 상단바 시간 스타일이 CSS 에 있다', () => {
    const css = readFileSync(resolve(__dirname, '../src/components/class/player/host/host-player.css'), 'utf8');
    expect(css).toMatch(/\.hp-grid\s*\{[^}]*justify-content:\s*center/);
    expect(css).toMatch(/\.hp-time b\s*\{[^}]*font-size:\s*16px/);
    expect(css).toMatch(/\.hp-topbar\s*\{[^}]*border-radius:\s*var\(--r-sheet\)/);
  });
});

describe('상담사 뷰 — 지표 순환(10초)', () => {
  it('순환이 켜져 있으면 10초마다 띠 이름과 모든 타일 라벨이 함께 바뀐다', async () => {
    vi.useFakeTimers();
    await renderCase('C01', 'rotate=1');
    expect(one('[data-pz="mstrip"]')?.getAttribute('data-metric')).toBe('relaxation');
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(one('[data-pz="mstrip"]')?.getAttribute('data-metric')).toBe('emotional');
    expect(text(one('[data-pz="mstrip"]'))).toContain('감정균형도');
    const labels = all('[data-pz="tile"][data-band="on"] .hp-ring-label').map((el) => text(el));
    expect(labels).toHaveLength(5);
    expect(new Set(labels)).toEqual(new Set(['감정']));
  });

  it('참가자 상세 시트가 열려 있는 동안에는 순환이 멈춘다', async () => {
    vi.useFakeTimers();
    await renderCase('C01', 'rotate=1&sheet=detail&detail=p3');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(one('[data-pz="mstrip"]')?.getAttribute('data-metric')).toBe('relaxation');
  });
});

/* ───────── 정적 단언 (verify §5 X2·X3·X5) ───────── */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });
}

describe('정적 단언 — 신규 상담사 소스', () => {
  const srcRoot = resolve(__dirname, '../src');
  const hostDir = join(srcRoot, 'components/class/player/host');
  const files = [...sourceFiles(hostDir), join(srcRoot, 'lib/class/host-player-case.ts'), join(srcRoot, 'lib/class/fixtures/host-cases.ts')];

  it('이모지 문자가 없다(아웃라인 아이콘만) — X2', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('호흡 지시 문구가 없다 — X3·P5', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/);
    }
  });

  it('useBand 를 직접 호출하지 않는다(컨테이너 props 로만 받는다) — X4', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\buseBand\s*\(/);
    }
  });

  it('any 타입을 쓰지 않는다 — X5', () => {
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/:\s*any\b|<any>|as any\b/);
    }
  });
});
