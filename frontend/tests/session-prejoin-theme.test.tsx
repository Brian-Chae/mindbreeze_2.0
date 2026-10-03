// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SessionPreJoinPreview } from '../src/components/session/SessionPreJoinPreview';

it.each([false, true])('프리뷰는 dark=%s에 맞춰 카드와 안내 색상을 적용한다', async (dark) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SessionPreJoinPreview, {
      onStart: vi.fn(), starting: false, canStart: true, ...(dark ? { dark } : {}),
    })));
    const section = container.querySelector('section')!;
    expect(section.classList.contains('bg-white')).toBe(!dark);
    expect(section.classList.contains('bg-[#211329]')).toBe(dark);
    expect(container.querySelector('h3')?.classList.contains('text-white')).toBe(dark);
    expect(container.textContent).toContain('프리뷰 없이도 세션은 시작할 수 있습니다');
    if (dark) expect(container.querySelector('[class*="bg-[#F9F9F9]"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
