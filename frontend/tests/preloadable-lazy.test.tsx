// @vitest-environment jsdom
import { createElement, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { preloadableLazy } from '../src/lib/preloadable-lazy';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('preloadableLazy', () => {
  it('preload 후 첫 렌더는 Suspense 폴백 없이 바로 그려진다', async () => {
    const Page = preloadableLazy(async () => ({ default: () => createElement('p', null, '본문') }));
    await Page.preload();
    const el = document.createElement('div');
    await act(async () => createRoot(el).render(createElement(Suspense, { fallback: '폴백' }, createElement(Page))));
    expect(el.textContent).toBe('본문');
  });
  it('preload 없이도 lazy 로 정상 렌더된다', async () => {
    const Page = preloadableLazy(async () => ({ default: () => createElement('p', null, '늦은 본문') }));
    const el = document.createElement('div');
    await act(async () => createRoot(el).render(createElement(Suspense, { fallback: '폴백' }, createElement(Page))));
    expect(el.textContent).toBe('늦은 본문');
  });
});
