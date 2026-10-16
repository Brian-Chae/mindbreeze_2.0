// SDD-208 — 요소의 콘텐츠 영역 크기를 ResizeObserver 로 추적한다(타일 격자 크기 계산용). ResizeObserver 가 없으면 한 번만 읽는다.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

export function useElementSize<T extends HTMLElement>(): { ref: (node: T | null) => void; size: ElementSize; node: T | null } {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const lastRef = useRef<ElementSize>({ width: 0, height: 0 });

  const ref = useCallback((el: T | null) => setNode(el), []);

  useLayoutEffect(() => {
    if (!node) return undefined;
    const read = (): void => {
      const next = { width: node.clientWidth, height: node.clientHeight };
      if (next.width === lastRef.current.width && next.height === lastRef.current.height) return;
      lastRef.current = next;
      setSize(next);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { ref, size, node };
}
