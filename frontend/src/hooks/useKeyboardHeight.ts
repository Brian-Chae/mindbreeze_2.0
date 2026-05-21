// visualViewport API로 키보드 높이 감지
import { useEffect, useState } from 'react';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const handler = (): void => {
      // 키보드가 올라오면 visualViewport.height가 줄어듦
      const keyboardH = window.innerHeight - vv.height - vv.offsetTop;
      setHeight(Math.max(0, keyboardH));
    };

    handler();
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
    };
  }, []);

  return height;
}
