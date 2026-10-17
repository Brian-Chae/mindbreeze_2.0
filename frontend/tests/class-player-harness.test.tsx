// @vitest-environment jsdom
// SDD-208 T3 — 케이스 하니스(/design/class-player): 픽스처 수집 · 쿼리 해석 · 준비 신호
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ClassPlayerCasesPage from '../src/pages/design/ClassPlayerCasesPage';
import {
  collectPlayerCases,
  parseViewport,
  type PlayerCaseEntry,
} from '../src/lib/class/player-harness';

const entry = (role: PlayerCaseEntry['role'], text: string): PlayerCaseEntry => ({
  role,
  render: () => createElement('p', { 'data-testid': 'case' }, text),
});

describe('collectPlayerCases — fixtures/*.ts 모듈에서 playerCases 를 모은다', () => {
  it('여러 모듈의 케이스를 합치고 playerCases 가 없는 모듈은 무시한다', () => {
    const cases = collectPlayerCases({
      '/a/member-cases.ts': { playerCases: { M01: entry('member', 'm1') }, OTHER: 1 },
      '/a/host-cases.ts': { playerCases: { C01: entry('host', 'c1') } },
      '/a/types-only.ts': { SOMETHING: 'x' },
      '/a/null.ts': null,
    });
    expect(Object.keys(cases).sort()).toEqual(['C01', 'M01']);
    expect(cases.M01?.role).toBe('member');
  });

  it('role 이 잘못됐거나 render 가 함수가 아닌 항목은 버린다', () => {
    const cases = collectPlayerCases({
      '/a/x.ts': {
        playerCases: {
          OK: entry('member', 'ok'),
          BAD_ROLE: { role: 'admin', render: () => null },
          NO_RENDER: { role: 'host', render: 'nope' },
        },
      },
    });
    expect(Object.keys(cases)).toEqual(['OK']);
  });
});

describe('parseViewport', () => {
  it.each([
    ['390x844', { width: 390, height: 844 }],
    ['1280x720', { width: 1280, height: 720 }],
    ['834X1194', { width: 834, height: 1194 }],
  ])('%s → %o', (raw, expected) => {
    expect(parseViewport(raw)).toEqual(expected);
  });

  it.each([null, '', 'abc', '390', '390x', 'x844', '0x844', '390x0', '99999x10'])('%s → null', (raw) => {
    expect(parseViewport(raw)).toBeNull();
  });
});

describe('ClassPlayerCasesPage', () => {
  let root: Root;
  let container: HTMLDivElement;

  async function renderAt(search: string): Promise<void> {
    await act(async () => {
      root.render(
        createElement(MemoryRouter, { initialEntries: [`/design/class-player${search}`] }, createElement(ClassPlayerCasesPage) as ReactNode),
      );
    });
    // 폰트 준비 후 setTimeout 으로 준비 신호를 올린다
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    delete window.__ready;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('등록되지 않은 케이스는 "케이스 미등록"과 등록된 ID 목록을 보여 준다', async () => {
    await renderAt('?role=member&case=M99');
    expect(container.textContent).toContain('케이스 미등록');
    expect(container.textContent).toContain('M99');
    expect(container.textContent).toContain('__selftest');
  });

  it('쿼리가 없어도 오류 없이 안내를 보여 주고 준비 신호를 올린다', async () => {
    await renderAt('');
    expect(container.textContent).toContain('케이스 미등록');
    expect(window.__ready).toBe(true);
  });

  it('등록된 케이스는 role·case 로 찾아 렌더하고 준비 신호를 올린다', async () => {
    await renderAt('?role=member&case=__selftest');
    expect(container.querySelector('[data-pz="app"]')).not.toBeNull();
    expect(container.textContent).not.toContain('케이스 미등록');
    expect(window.__ready).toBe(true);
  });

  it('role 이 다르면 같은 ID 라도 미등록으로 본다', async () => {
    await renderAt('?role=host&case=__selftest');
    expect(container.textContent).toContain('케이스 미등록');
  });

  it('sheet 쿼리가 케이스 컨텍스트로 전달돼 시트가 열린다', async () => {
    await renderAt('?role=member&case=__selftest');
    expect(container.querySelector('[data-pz="sheet"]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderAt('?role=member&case=__selftest&sheet=status');
    expect(container.querySelector('[data-pz="sheet"]')).not.toBeNull();
  });

  it('viewport 쿼리가 있으면 같은 주소를 viewport 없이 iframe 으로 감싸 보여 준다(수동 미리보기)', async () => {
    await renderAt('?role=member&case=__selftest&sheet=status&viewport=390x844');
    const frame = container.querySelector('iframe');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('width')).toBe('390');
    expect(frame?.getAttribute('height')).toBe('844');
    const src = frame?.getAttribute('src') ?? '';
    expect(src).toContain('role=member');
    expect(src).toContain('case=__selftest');
    expect(src).toContain('sheet=status');
    expect(src).not.toContain('viewport=');
    expect(container.querySelector('[data-pz="app"]')).toBeNull();
  });

  it('등록 현황을 window.__playerCases 로 노출한다(측정 스크립트가 미등록 케이스를 건너뛴다)', async () => {
    await renderAt('?role=member&case=__selftest');
    expect(window.__playerCases?.member).toContain('__selftest');
    expect(window.__playerCases?.host).toContain('__selftest_host');
  });
});
