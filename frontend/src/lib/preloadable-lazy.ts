import { createElement, lazy, type ComponentType } from 'react';

type Page = ComponentType<Record<string, never>>;

/**
 * 라우트 페이지용 lazy. preload()로 모듈을 미리 받아 두면 첫 렌더가 Suspense 없이 바로 그려진다.
 * (lazy 청크가 렌더 중 풀리면 폴백 노출 후 React 가 공개를 최대 ~300ms 늦춘다.)
 */
export function preloadableLazy(loader: () => Promise<{ default: Page }>): Page & { preload: () => Promise<unknown> } {
  let loaded: Page | null = null;
  const load = () => loader().then((module) => { loaded = module.default; return module; });
  const Lazy = lazy(load);
  const Component: Page = () => (loaded ? createElement(loaded) : createElement(Lazy));
  return Object.assign(Component, { preload: () => load().catch(() => undefined) });
}
