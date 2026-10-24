import { useEffect, useRef } from 'react';
import { notifyMobileSwipeProtection, registerMobileSwipeProtection } from '../lib/mobile-menu-swipe-protection';

/** 녹음·측정·통화·수업·편집의 실제 수명주기에 연결한다. */
export function useMobileSwipeProtection(shouldProtect: () => boolean): void {
  const current = useRef(shouldProtect);
  current.current = shouldProtect;
  useEffect(() => registerMobileSwipeProtection(() => current.current()), []);
  useEffect(() => { notifyMobileSwipeProtection(); });
}
