// A11Y-07: div 기반 커스텀 모달 공통 접근성 훅.
// 초기 포커스 · Tab 포커스 트랩 · ESC 닫기 · 닫힐 때 이전 포커스 복원 · 배경 스크롤 잠금을 담당한다.
// 네이티브 <dialog> 대신 오버레이 div 로 렌더하는 모달에서 재사용한다.

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 모달 컨테이너에 연결할 ref 를 돌려준다. 컨테이너에는 tabIndex={-1} 과 role="dialog" 를 함께 지정한다. */
export function useDialogA11y(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 열려 있는 동안 onClose 가 바뀌어도 리스너를 다시 붙이지 않도록 최신 콜백을 ref 로 보관한다.
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusables = (): HTMLElement[] =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.tabIndex >= 0 && element.getClientRects().length > 0,
      );

    // 초기 포커스: 입력 필드를 우선하고, 없으면 첫 포커서블, 마지막으로 컨테이너 자체.
    const elements = focusables();
    const initial = elements.find((element) => element.matches('input, textarea, select')) ?? elements[0] ?? container;
    initial.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [open]);

  return containerRef;
}
