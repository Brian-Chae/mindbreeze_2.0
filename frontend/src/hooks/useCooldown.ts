// 재요청 쿨다운 카운트다운 훅 (서버 OTP 쿨다운 60초와 맞춘다)

import { useCallback, useEffect, useState } from 'react';

export const OTP_RESEND_COOLDOWN_SEC = 60;

export function useCooldown(): { remaining: number; start: (seconds?: number) => void; reset: () => void } {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const start = useCallback((seconds: number = OTP_RESEND_COOLDOWN_SEC) => setRemaining(seconds), []);
  const reset = useCallback(() => setRemaining(0), []);
  return { remaining, start, reset };
}
