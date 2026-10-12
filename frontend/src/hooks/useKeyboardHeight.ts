// visualViewport API로 키보드 높이 감지
import { useEffect, useState } from 'react';
import { isNativeApp } from '../lib/native/platform';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    // 네이티브 앱은 키보드가 웹뷰 영역을 직접 줄이므로 추가 보정이 필요 없다(이중 적용 방지).
    if (isNativeApp()) return;
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
