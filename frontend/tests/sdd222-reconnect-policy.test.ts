import { describe, expect, it } from 'vitest';
import {
  RECONNECT_BASE_DELAYS_MS,
  RECONNECT_MAX_DELAY_MS,
  nextReconnectDelay,
} from '../src/lib/ble/reconnect-policy';

describe('V1 nextReconnectDelay', () => {
  it('지터 없이 1·2·4·8·15·30초로 증가하고 30초 상한을 유지한다', () => {
    const noJitter = () => 0.5; // 0.5 → 지터 0
    const delays = [0, 1, 2, 3, 4, 5, 6, 20].map((a) => nextReconnectDelay(a, noJitter));
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000]);
    expect(RECONNECT_BASE_DELAYS_MS).toEqual([1000, 2000, 4000, 8000, 15000, 30000]);
    expect(RECONNECT_MAX_DELAY_MS).toBe(30000);
  });

  it('지터는 기준값의 ±20% 범위 안이다', () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const base = RECONNECT_BASE_DELAYS_MS[Math.min(attempt, 5)];
      const low = nextReconnectDelay(attempt, () => 0);
      const high = nextReconnectDelay(attempt, () => 1);
      expect(low).toBeCloseTo(base * 0.8, 5);
      expect(high).toBeCloseTo(base * 1.2, 5);
    }
  });

  it('음수·NaN 시도 횟수는 첫 단계로 취급한다', () => {
    expect(nextReconnectDelay(-3, () => 0.5)).toBe(1000);
    expect(nextReconnectDelay(Number.NaN, () => 0.5)).toBe(1000);
  });
});
