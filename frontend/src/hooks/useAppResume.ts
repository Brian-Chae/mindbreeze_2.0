// 앱 복귀/전환 콜백을 선언적으로 등록한다 (SDD-222 T-J5). 언마운트 시 자동 해제.
// 콜백은 ref 로 최신값을 유지하므로 호출부에서 useCallback 으로 감쌀 필요가 없다.

import { useEffect, useRef } from 'react';
import { subscribeAppPause, subscribeAppResume } from '../lib/native/app-lifecycle';

interface AppLifecycleHandlers {
  onResume?: () => void;
  onPause?: () => void;
}

export function useAppLifecycle(handlers: AppLifecycleHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const unsubResume = subscribeAppResume(() => ref.current.onResume?.());
    const unsubPause = subscribeAppPause(() => ref.current.onPause?.());
    return () => {
      unsubResume();
      unsubPause();
    };
  }, []);
}

export function useAppResume(onResume: () => void): void {
  useAppLifecycle({ onResume });
}
