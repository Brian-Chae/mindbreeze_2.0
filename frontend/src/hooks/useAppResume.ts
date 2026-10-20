// 앱 복귀/전환 콜백을 선언적으로 등록한다 (SDD-222 T-J5). 언마운트 시 자동 해제.
// 콜백은 ref 로 최신값을 유지하므로 호출부에서 useCallback 으로 감쌀 필요가 없다.

import { useEffect, useRef } from 'react';
import { subscribeAppPause, subscribeAppResume } from '../lib/native/app-lifecycle';

/** 백그라운드 전환 처리 순서 — 메모리 버퍼를 큐에 적재한 뒤 큐를 flush 한다 */
export const PAUSE_ORDER = { bufferFlush: 10, rawFlush: 20 } as const;

interface AppLifecycleHandlers {
  onResume?: () => void | Promise<void>;
  onPause?: () => void | Promise<void>;
  /** 복귀 처리 순서(RESUME_ORDER) — 작을수록 먼저 실행 */
  order?: number;
  /** 지정하면 pause 구독에만 적용(없으면 order 와 동일) */
  pauseOrder?: number;
}

export function useAppLifecycle(handlers: AppLifecycleHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const order = ref.current.order;
    const unsubResume = subscribeAppResume(() => ref.current.onResume?.(), order);
    const unsubPause = subscribeAppPause(() => ref.current.onPause?.(), ref.current.pauseOrder ?? order);
    return () => {
      unsubResume();
      unsubPause();
    };
  }, []);
}

export function useAppResume(onResume: () => void | Promise<void>, order?: number): void {
  useAppLifecycle({ onResume, order });
}
