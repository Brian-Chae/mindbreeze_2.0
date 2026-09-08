// Screen Wake Lock — 명상·대기 중 화면 꺼짐 방지 (SDD-029 P2)
// 미지원 브라우저는 조용히 무시. 언마운트/비활성 시 release.

import { useEffect, useRef } from 'react';

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
  removeEventListener: (type: 'release', listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
};

/**
 * enabled=true 일 때 screen wake lock을 요청한다.
 * 탭이 다시 visible 되면 재요청한다.
 */
export function useWakeLock(enabled: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock?.request) return undefined;

    let cancelled = false;

    const release = async (): Promise<void> => {
      const current = sentinelRef.current;
      sentinelRef.current = null;
      if (!current || current.released) return;
      try {
        await current.release();
      } catch {
        // release 실패는 무시
      }
    };

    const request = async (): Promise<void> => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const sentinel = await nav.wakeLock!.request('screen');
        if (cancelled) {
          await sentinel.release().catch(() => undefined);
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
          }
        });
      } catch {
        // 권한 거부·미지원·보안 컨텍스트 아님 — 조용히 무시
      }
    };

    void request();

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void request();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void release();
    };
  }, [enabled]);
}
