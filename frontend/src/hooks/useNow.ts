// SDD-231 — 지정한 주기로 현재 시각을 갱신한다(대기 화면 남은 시간 실시간 표시용). enabled=false 면 멈춘다.
import { useEffect, useState } from 'react';

export function useNow(enabled: boolean, intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}
