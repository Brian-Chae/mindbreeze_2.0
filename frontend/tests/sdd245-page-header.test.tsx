// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PageHeader } from '../src/components/ui/page-header';
import { headerButtonClass } from '../src/components/ui/styles';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it('명시한 액션 역할로 DOM 순서를 맞추고 native 동작과 접근성 속성을 보존한다', async () => {
 const box = document.createElement('div'); document.body.append(box); const root = createRoot(box); const click = vi.fn(); const menu = vi.fn();
 try {
 await act(async () => root.render(<PageHeader title="페이지" mobile actions={<div><button data-header-action="primary" onClick={click}>저장</button><button disabled aria-label="보조 작업">보조</button><button aria-label="더보기" onClick={menu}><svg /></button></div>} />));
 const buttons = [...box.querySelectorAll('button')];
 expect(buttons.map(button => button.textContent)).toEqual(['보조', '', '저장']);
 expect(buttons[0].disabled).toBe(true); expect(buttons[0].getAttribute('aria-label')).toBe('보조 작업');
 await act(async () => buttons[2].click()); expect(click).toHaveBeenCalledOnce(); await act(async () => buttons[1].click()); expect(menu).toHaveBeenCalledOnce();
 expect(box.querySelector('h1[data-mobile-swipe-title]')?.textContent).toBe('페이지');
 expect(headerButtonClass()).toContain('h-11'); expect(headerButtonClass()).toContain('bg-white'); expect(headerButtonClass()).toContain('border-[#5F0080]');
 expect(headerButtonClass(true)).toContain('bg-[#5F0080]');
 } finally { await act(async () => root.unmount()); box.remove(); }
});
