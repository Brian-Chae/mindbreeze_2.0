// BLE 자동 재연결 백오프 정책 (SDD-222 G2)
// 1s → 2s → 4s → 8s → 15s → 30s(상한), ±20% 지터. 성공 시 호출부가 attempt 를 0 으로 리셋한다.

export const RECONNECT_BASE_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000, 30000];
export const RECONNECT_MAX_DELAY_MS = 30000;
const JITTER_RATIO = 0.2;

/**
 * attempt(0부터) 번째 재시도 전 대기 시간(ms).
 * random 은 [0,1) 난수 — 테스트에서 주입. 0.5 면 지터 0.
 * 지터는 여러 기기가 동시에 재연결을 시도하는 쏠림을 막기 위한 것이다.
 */
export function nextReconnectDelay(attempt: number, random: () => number = Math.random): number {
  const index = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const base = RECONNECT_BASE_DELAYS_MS[Math.min(index, RECONNECT_BASE_DELAYS_MS.length - 1)];
  const jitter = 1 + (random() * 2 - 1) * JITTER_RATIO;
  return base * jitter;
}
