// SDD-333: 기기 블루투스 전원 상태(꺼짐 true / 켜짐 false / 알 수 없음 null).
// 감지 경로 3개: ① JS BleClient.startEnabledNotifications(즉시) ② 앱 AppSettings.isBluetoothEnabled 주기 확인(네이티브가 밴드를 쥔 동안·iOS 보강)
// ③ 네이티브 측정 snapshot 의 blocked_reason === 'bluetooth_off'(nativeBlocked). 웹·구버전 앱은 항상 null(안내 숨김).
// 꺼짐 → 켜짐으로 바뀌면 onTurnedOn 을 불러 빠른 재연결 창(SDD-331)을 바로 연다.
import { useEffect, useRef, useState } from 'react';
import { isNativeApp } from '../lib/native/platform';
import { isBluetoothEnabled } from '../lib/native/app-settings';

const POLL_MS = 2000;

export interface UseBluetoothPowerOptions {
  enabled?: boolean;
  /** 네이티브 snapshot 이 bluetooth_off 이유를 알릴 때 true */
  nativeBlocked?: boolean;
  onTurnedOn?: () => void;
}

export function useBluetoothPower({ enabled = true, nativeBlocked = false, onTurnedOn }: UseBluetoothPowerOptions = {}): boolean | null {
  const [polled, setPolled] = useState<boolean | null>(null); // true = 켜짐
  const prevRef = useRef<boolean | null>(null);
  const cbRef = useRef(onTurnedOn); cbRef.current = onTurnedOn;

  const apply = (on: boolean | null): void => {
    if (on === null) return;
    if (prevRef.current === false && on) cbRef.current?.();
    prevRef.current = on;
    setPolled(on);
  };

  useEffect(() => {
    if (!enabled || !isNativeApp()) return undefined;
    let alive = true;
    const read = (): void => { void isBluetoothEnabled().then((on) => { if (alive) apply(on); }); };
    read();
    const timer = window.setInterval(read, POLL_MS);
    let stop: (() => Promise<void>) | null = null;
    void import('@capacitor-community/bluetooth-le').then(async ({ BleClient }) => {
      try {
        await BleClient.startEnabledNotifications((on) => { if (alive) apply(on); });
        stop = () => BleClient.stopEnabledNotifications();
      } catch { /* 초기화 전·권한 전이면 주기 확인이 맡는다 */ }
    }).catch(() => undefined);
    return () => { alive = false; window.clearInterval(timer); void stop?.().catch(() => undefined); };
    // apply 는 ref·setState 만 쓴다
  }, [enabled]);

  if (!enabled || !isNativeApp()) return null;
  // 직접 읽은 전원 상태가 있으면 그것이 정본(네이티브 이유는 켜진 뒤에도 잠시 남을 수 있다)
  if (polled !== null) return !polled;
  return nativeBlocked ? true : null;
}
