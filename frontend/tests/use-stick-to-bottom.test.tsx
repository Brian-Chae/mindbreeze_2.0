// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStickToBottom } from '../src/hooks/useStickToBottom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let resizeCallback: (() => void) | null = null;

class FakeResizeObserver {
  constructor(callback: () => void) { resizeCallback = callback; }
  observe() {}
  disconnect() {}
}

function List() {
  const ref = useRef<HTMLDivElement>(null);
  useStickToBottom(ref);
  return <div ref={ref} data-testid="list" />;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  resizeCallback = null;
});

const metrics = { scrollHeight: 2000, clientHeight: 600, scrollTop: 0 };
const protoDescriptors = ['scrollHeight', 'clientHeight', 'scrollTop'].map(
  (key) => [key, Object.getOwnPropertyDescriptor(Element.prototype, key)] as const,
);

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => metrics.clientHeight });
  Object.defineProperty(Element.prototype, 'scrollTop', {
    configurable: true,
    get: () => metrics.scrollTop,
    set: (v: number) => { metrics.scrollTop = v; },
  });
});
afterEach(() => {
  for (const [key, descriptor] of protoDescriptors) {
    if (descriptor) Object.defineProperty(Element.prototype, key, descriptor);
    else delete (Element.prototype as unknown as Record<string, unknown>)[key];
  }
});

it('입력창이 커져 목록이 줄어도 맨 아래에 있던 경우 맨 아래를 유지한다', async () => {
  Object.assign(metrics, { scrollHeight: 2000, clientHeight: 600, scrollTop: 1000 });
  await act(async () => root.render(<List />));
  const el = container.querySelector<HTMLElement>('[data-testid="list"]')!;
  // 스크롤 이벤트로는 "위쪽"으로 기록됐지만(키보드 전환 중 어긋난 플래그), 실제로는 맨 아래로 이동한 상태를 흉내
  el.dispatchEvent(new Event('scroll'));
  metrics.scrollTop = 1400;
  // 입력창이 커져 목록이 120px 줄어듦
  metrics.clientHeight = 480;
  await act(async () => { resizeCallback?.(); });
  expect(metrics.scrollTop).toBe(2000);
});

it('위로 스크롤해 과거 대화를 보던 경우에는 위치를 건드리지 않는다', async () => {
  Object.assign(metrics, { scrollHeight: 2000, clientHeight: 600, scrollTop: 300 });
  await act(async () => root.render(<List />));
  const el = container.querySelector<HTMLElement>('[data-testid="list"]')!;
  el.dispatchEvent(new Event('scroll'));
  metrics.clientHeight = 480;
  await act(async () => { resizeCallback?.(); });
  expect(metrics.scrollTop).toBe(300);
});
