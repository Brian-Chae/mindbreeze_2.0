// Screen Wake Lock — 명상·대기 중 화면 꺼짐 방지 (SDD-029 P2)
// 미지원 브라우저는 조용히 무시. 언마운트/비활성 시 release.

import { useEffect, useRef } from 'react';
import { RESUME_ORDER, subscribeAppResume } from '../lib/native/app-lifecycle';
import { isNativeApp } from '../lib/native/platform';

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

  // SDD-222 G3: 네이티브 앱은 keep-awake 플러그인 사용 — 웹 Screen Wake Lock 은 백그라운드·잠금 시
  // 브라우저가 해제하기 때문. 플러그인은 동적 import 라 웹 실행 경로·번들에 들어가지 않는다.
  useEffect(() => {
    if (!enabled || !isNativeApp()) return undefined;

    let cancelled = false;
    const request = async (): Promise<void> => {
      try {
        const { KeepAwake } = await import('@capacitor-community/keep-awake');
        if (cancelled) return;
        await KeepAwake.keepAwake();
      } catch {
        // 미지원·플러그인 오류는 수업 진행에 영향이 없도록 조용히 무시
      }
    };
    void request();
    // 앱 복귀 시 재요청 — OS 가 백그라운드 중 해제했을 수 있다.
    const unsubscribe = subscribeAppResume(request, RESUME_ORDER.screen);

    return () => {
      cancelled = true;
      unsubscribe();
      void import('@capacitor-community/keep-awake')
        .then(({ KeepAwake }) => KeepAwake.allowSleep())
        .catch(() => undefined);
    };
  }, [enabled]);

  // 웹 경로 — 기존 동작 그대로 (네이티브에서는 위 effect 가 담당)
  useEffect(() => {
    if (!enabled || isNativeApp()) return undefined;

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
