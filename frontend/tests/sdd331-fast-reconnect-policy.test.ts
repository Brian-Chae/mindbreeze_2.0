import { describe, expect, it, vi } from 'vitest';
import {
  ATTEMPT_TIMEOUT_MS,
  FAST_WINDOW_MS,
  nextRetryDelay,
  reconnectPhase,
  shouldScanFallback,
  shouldShowWakeHint,
  withAttemptTimeout,
} from '../src/lib/ble/reconnect-policy';

describe('SDD-331 빠른 재시도 창', () => {
  it('끊긴 뒤 120초 동안 2~3초 간격으로 40회 이상 시도한다(시간 진행 모의)', () => {
    let t = 0;
    let attempts = 0;
    while (reconnectPhase(t) === 'fast') {
      attempts += 1;
      t += nextRetryDelay(t, 0, () => 0.5);
    }
    expect(attempts).toBeGreaterThanOrEqual(40);
    expect(attempts).toBe(48);
    expect(t).toBeGreaterThanOrEqual(FAST_WINDOW_MS);
  });

  it('빠른 창 간격은 항상 2~3초 범위이고 백오프로 늘지 않는다', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const d = nextRetryDelay(30_000, 5, () => r);
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(3000);
    }
  });

  it('120초 이후엔 느린 백오프(1·2·4·8·15·30초)로 낮춘다', () => {
    const delays = [0, 1, 2, 3, 4, 5, 9].map((a) => nextRetryDelay(FAST_WINDOW_MS, a, () => 0.5));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 30000, 30000]);
  });

  it('120초 후 직접 연결이 연속 실패하면 스캔으로 전환하고, 빠른 창 안에서는 전환하지 않는다', () => {
    expect(shouldScanFallback(60_000, 10)).toBe(false);
    expect(shouldScanFallback(FAST_WINDOW_MS, 1)).toBe(false);
    expect(shouldScanFallback(FAST_WINDOW_MS, 2)).toBe(true);
  });

  it('깨우기 안내는 120초가 지나서야 나온다', () => {
    expect(shouldShowWakeHint(119_999)).toBe(false);
    expect(shouldShowWakeHint(120_000)).toBe(true);
    expect(shouldShowWakeHint(Number.NaN)).toBe(false);
  });
});

describe('SDD-331 시도당 10초 제한', () => {
  it('10초를 넘기면 정리 콜백을 부르고 거절한다', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const hung = new Promise<void>(() => undefined);
    const p = withAttemptTimeout(hung, ATTEMPT_TIMEOUT_MS, onTimeout);
    const assertion = expect(p).rejects.toThrow('시간이 초과');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await assertion;
    expect(onTimeout).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('제한 안에 성공하면 그대로 결과를 돌려주고 타이머를 남기지 않는다', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    await expect(withAttemptTimeout(Promise.resolve(7), ATTEMPT_TIMEOUT_MS, onTimeout)).resolves.toBe(7);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
