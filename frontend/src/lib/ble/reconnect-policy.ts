// BLE 자동 재연결 정책 (SDD-222 G2 → SDD-331)
//
// 밴드 펌웨어는 연결이 끊긴 뒤 0~2분 안에 sleep 에 들어간다(docs/ble-reconnect-1121).
// 그래서 끊긴 직후 120초(빠른 창)는 2~3초 고정 간격으로 촘촘히 붙이고, 시도마다 10초 안에 끝내지 못하면 취소한다.
// 120초가 지나면 기존 느린 백오프(1·2·4·8·15·30초)로 낮추고, 저장 ID 직접 연결이 연속 실패하면 스캔으로 같은 밴드를 다시 찾는다.
// 성공 시 호출부가 상태를 리셋한다. 네이티브(Android BandGattClient / iOS ReconnectBackoff)도 같은 값을 쓴다.

/** 빠른 재시도 창 길이(끊긴 시각부터) */
export const FAST_WINDOW_MS = 120_000;
/** 빠른 창 동안의 재시도 간격 기준값 — 2.5초 ± 0.5초 지터 = 2~3초 */
export const FAST_RETRY_INTERVAL_MS = 2500;
const FAST_JITTER_MS = 500;
/** 시도 하나의 제한 시간 — 넘으면 취소·정리 후 다음 시도 */
export const ATTEMPT_TIMEOUT_MS = 10_000;
/** 느린 단계에서 직접 연결이 이 횟수만큼 연속 실패하면 스캔으로 다시 찾는다 */
export const SCAN_FALLBACK_AFTER_FAILURES = 2;
/** 깨우기 안내를 보여 주는 시점 — 빠른 창이 끝나도록 못 붙은 때 */
export const WAKE_HINT_AFTER_MS = FAST_WINDOW_MS;

export const RECONNECT_BASE_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000, 30000];
export const RECONNECT_MAX_DELAY_MS = 30000;
const JITTER_RATIO = 0.2;

export type ReconnectPhase = 'fast' | 'slow';

/** 끊긴 뒤 경과 시간으로 단계를 정한다. */
export function reconnectPhase(elapsedMs: number): ReconnectPhase {
  return Number.isFinite(elapsedMs) && elapsedMs < FAST_WINDOW_MS ? 'fast' : 'slow';
}

/**
 * attempt(0부터) 번째 느린 재시도 전 대기 시간(ms).
 * random 은 [0,1) 난수 — 테스트에서 주입. 0.5 면 지터 0.
 * 지터는 여러 기기가 동시에 재연결을 시도하는 쏠림을 막기 위한 것이다.
 */
export function nextReconnectDelay(attempt: number, random: () => number = Math.random): number {
  const index = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const base = RECONNECT_BASE_DELAYS_MS[Math.min(index, RECONNECT_BASE_DELAYS_MS.length - 1)];
  const jitter = 1 + (random() * 2 - 1) * JITTER_RATIO;
  return base * jitter;
}

/**
 * 다음 재시도까지 대기 시간(ms).
 * - 빠른 창(끊긴 뒤 120초 미만): 2~3초 고정 간격(백오프 없음)
 * - 이후: 기존 느린 백오프. slowAttempt 는 느린 단계에 들어온 뒤 몇 번째 시도인지(0부터).
 */
export function nextRetryDelay(elapsedMs: number, slowAttempt: number, random: () => number = Math.random): number {
  if (reconnectPhase(elapsedMs) === 'fast') {
    return FAST_RETRY_INTERVAL_MS + (random() * 2 - 1) * FAST_JITTER_MS;
  }
  return nextReconnectDelay(slowAttempt, random);
}

/** 느린 단계에서 직접 연결이 연속 실패한 횟수가 기준 이상이면 스캔으로 다시 찾는다. */
export function shouldScanFallback(elapsedMs: number, consecutiveFailures: number): boolean {
  return reconnectPhase(elapsedMs) === 'slow' && consecutiveFailures >= SCAN_FALLBACK_AFTER_FAILURES;
}

/** 깨우기 안내를 띄울지 — 빠른 창이 끝나도록 연결이 안 된 경우. */
export function shouldShowWakeHint(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= WAKE_HINT_AFTER_MS;
}

/** 시도 하나에 제한 시간을 건다. 넘으면 onTimeout(취소·정리) 후 거절한다. */
export function withAttemptTimeout<T>(
  run: Promise<T>,
  timeoutMs: number = ATTEMPT_TIMEOUT_MS,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* 정리 실패는 무시 */ }
      reject(new Error('밴드 연결 시도 시간이 초과됐어요'));
    }, timeoutMs);
    run.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}
