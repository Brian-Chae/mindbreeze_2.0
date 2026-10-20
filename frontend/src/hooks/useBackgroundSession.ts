// 수업 진행 중 백그라운드 세션 유지 (SDD-222 G5, T-J9)
// active 인 동안 Android Foreground Service 를 켜 두고, false 전환·언마운트 시 반드시 종료한다.
// iOS·웹은 background-session 이 no-op 이므로 호출해도 영향이 없다.
// 첫 입장 시 1회 배터리 최적화 안내 상태도 함께 제공한다(제조사 절전이 서비스를 죽일 수 있음, R4).

import { useCallback, useEffect, useState } from 'react';
import { startBackgroundSession, stopBackgroundSession } from '../lib/native/background-session';
import { getPlatform } from '../lib/native/platform';
import { subscribeAppResume } from '../lib/native/app-lifecycle';

export const BATTERY_GUIDE_STORAGE_KEY = 'mb_battery_guide_seen';

interface UseBackgroundSessionResult {
  /** 배터리 최적화 안내 모달 노출 여부 (Android 앱, 첫 수업 입장 1회) */
  batteryGuideOpen: boolean;
  dismissBatteryGuide: () => void;
}

function hasSeenBatteryGuide(): boolean {
  try {
    return localStorage.getItem(BATTERY_GUIDE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useBackgroundSession(active: boolean): UseBackgroundSessionResult {
  const [batteryGuideOpen, setBatteryGuideOpen] = useState(false);

  useEffect(() => {
    if (!active) return undefined;
    // 실패는 background-session 이 삼킨다 — 수업 화면은 서비스 없이도 정상 동작해야 한다.
    void startBackgroundSession();
    return () => {
      void stopBackgroundSession();
    };
  }, [active]);

  // 복귀 시 재시도: 설정에서 BLE 권한을 허용하고 돌아온 경우 등 아직 시작되지 않았을 수 있다.
  // 이미 실행 중이면 background-session 이 no-op 처리한다(멱등).
  useEffect(() => {
    if (!active) return undefined;
    return subscribeAppResume(() => startBackgroundSession());
  }, [active]);

  useEffect(() => {
    if (active && getPlatform() === 'android' && !hasSeenBatteryGuide()) {
      setBatteryGuideOpen(true);
    } else {
      setBatteryGuideOpen(false);
    }
  }, [active]);

  const dismissBatteryGuide = useCallback((): void => {
    setBatteryGuideOpen(false);
    try {
      localStorage.setItem(BATTERY_GUIDE_STORAGE_KEY, '1');
    } catch {
      // 저장 실패 시 다음 입장에 다시 안내될 수 있을 뿐 — 무시
    }
  }, []);

  return { batteryGuideOpen, dismissBatteryGuide };
}
