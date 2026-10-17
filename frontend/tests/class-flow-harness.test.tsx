// @vitest-environment jsdom
// SDD-209 T3 — 하니스(/design/class-flow): 쿼리 해석 · 준비 신호 · 인덱스 · 자가검증 픽스처
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ClassFlowCasesPage from '../src/pages/design/ClassFlowCasesPage';

let root: Root;
let container: HTMLDivElement;

async function renderAt(search: string): Promise<void> {
  // MemoryRouter 는 initialEntries 변경을 무시하므로 매번 새로 마운트한다
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: [`/design/class-flow${search}`] }, createElement(ClassFlowCasesPage) as ReactNode));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
const q = <T extends Element = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  delete window.__ready;
  delete window.__flowCases;
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('ClassFlowCasesPage', () => {
  it('미등록 케이스는 안내를 보이고 등록 수를 알려 준다', async () => {
    // 실제 화면 키는 트랙 병합에 따라 등록되므로, 어떤 트랙도 등록하지 않을 키로 확인한다
    await renderAt('?screen=FM99&case=default');
    expect(q('[role="status"]')!.textContent).toContain('케이스 미등록');
    expect(q('[role="status"]')!.textContent).toContain('screen=FM99');
  });

  it('준비 신호와 레지스트리를 window 에 노출한다(실제 픽스처만, 자가검증 제외)', async () => {
    await renderAt('?screen=__selftest&case=wizard');
    expect(window.__ready).toBe(true);
    expect(window.__flowCases).toBeDefined();
    expect([...(window.__flowCases?.member ?? []), ...(window.__flowCases?.host ?? [])].some((ref) => ref.startsWith('__selftest'))).toBe(false);
  });

  it('자가검증 픽스처(wizard): 진행 점 total·step 과 주 버튼 1개', async () => {
    await renderAt('?screen=__selftest&case=wizard&step=2&total=4');
    expect(document.querySelectorAll('[data-pz="flow-steps"] > i')).toHaveLength(4);
    expect(q('[data-pz="flow-steps"] > i[aria-current="step"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-pz="flow-foot"] [data-pz="flow-cta"]')).toHaveLength(1);
    expect(q('[data-pz="flow-top"]')).not.toBeNull();
    expect(q('[data-pz="app"]')!.getAttribute('data-flow')).toBe('true');
    expect(q('[data-pz="app"]')!.className).toContain('fl-root');
  });

  it('wizard + sheet=1: 시트가 열리고 푸터가 inert', async () => {
    await renderAt('?screen=__selftest&case=wizard&sheet=1');
    expect(q('[data-pz="flow-sheet"][role="dialog"]')).not.toBeNull();
    expect(q('.pz-shell__dock')!.hasAttribute('inert')).toBe(true);
  });

  it('상태 의존 픽스처: 카메라 켜짐 ↔ 꺼짐, 트래커 노출 ↔ 미노출', async () => {
    await renderAt('?screen=__selftest&case=av-video');
    expect(q('video')).not.toBeNull();
    expect(q('[data-pz="flow-level"]')).toBeNull();
    await renderAt('?screen=__selftest&case=av-bar');
    expect(q('video')).toBeNull();
    expect(q('[data-pz="flow-level"]')).not.toBeNull();
    await renderAt('?screen=__selftest&case=electrodes-bad');
    expect(q('[data-pz="flow-electrodes"]')).not.toBeNull();
    await renderAt('?screen=__selftest&case=electrodes-good');
    expect(q('[data-pz="flow-electrodes"]')).toBeNull();
  });

  it('?index=1 은 인덱스 표(등록 건수)를 낸다', async () => {
    await renderAt('?index=1');
    expect(q('[data-testid="index-total"]')!.textContent).toMatch(/^등록 \d+건/);
  });

  it('viewport 쿼리는 같은 경로를 iframe 으로 감싼다', async () => {
    await renderAt('?screen=FM04&case=default&viewport=390x844');
    const frame = q<HTMLIFrameElement>('iframe')!;
    expect(frame.getAttribute('width')).toBe('390');
    expect(frame.getAttribute('src')).not.toContain('viewport');
  });
});
