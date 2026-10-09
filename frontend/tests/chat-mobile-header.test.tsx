// @vitest-environment jsdom
// 모바일 채팅방 상단 통합 헤더 — 뒤로가기·방 이름·안내가 한 블록에 있고 중복 요소가 없다.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatMobileHeader, LUCY_NOTICE } from '../src/components/chat/ChatMobileHeader';

let container: HTMLDivElement | null = null;
afterEach(() => { container?.remove(); container = null; });

function mount(props: Parameters<typeof ChatMobileHeader>[0]): HTMLDivElement {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { createRoot(container!).render(createElement(ChatMobileHeader, props)); });
  return container;
}

it('방 이름·안내·뒤로가기를 한 헤더에 렌더하고 뒤로가기가 동작한다', () => {
  const onBack = vi.fn();
  const el = mount({ title: '루시 (AI)', sub: LUCY_NOTICE, onBack });
  expect(el.querySelector('h1')?.textContent).toBe('루시 (AI)');
  expect(el.textContent).toContain(LUCY_NOTICE);
  const back = el.querySelector('button[aria-label="대화 목록으로"]') as HTMLButtonElement;
  act(() => back.click());
  expect(onBack).toHaveBeenCalledOnce();
  expect(el.querySelectorAll('h1,h2')).toHaveLength(1);
});

it('뒤로가기 터치 영역은 44px, 모바일 전용(md:hidden)이다', () => {
  const el = mount({ title: '방', onBack: vi.fn() });
  expect(el.querySelector('button')?.className).toContain('w-11 h-11');
  expect(el.firstElementChild?.className).toContain('md:hidden');
});

it('우측 액션 슬롯을 표시한다', () => {
  const el = mount({ title: '방', onBack: vi.fn(), rightSlot: createElement('button', { 'data-x': '1' }, '⋯') });
  expect(el.querySelector('[data-x="1"]')).not.toBeNull();
});
