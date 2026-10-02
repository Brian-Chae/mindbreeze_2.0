import { describe, expect, it } from 'vitest';
import { averageMetricBuckets } from '../src/lib/class/metric-buckets';

describe('지표 25초 구간 평균', () => {
  it('최근 300개만 사용하고 12개의 평균을 반환한다', () => {
    const values = Array.from({ length: 325 }, (_, i) => i + 1);
    expect(averageMetricBuckets(values)).toEqual([38, 63, 88, 113, 138, 163, 188, 213, 238, 263, 288, 313]);
    expect(values).toHaveLength(325);
    expect(values[0]).toBe(1);
  });
  it('초기 부분 구간은 오른쪽에 정렬하고 빈 구간은 0으로 위장하지 않는다', () => {
    expect(averageMetricBuckets([10, 30])).toEqual([null, null, null, null, null, null, null, null, null, null, null, 20]);
    expect(averageMetricBuckets([...Array<number>(25).fill(10), 30])).toEqual([null, null, null, null, null, null, null, null, null, null, 10, 10.8]);
  });
  it('빈 입력과 비유한 값은 데이터 없는 구간으로 처리한다', () => {
    expect(averageMetricBuckets([])).toEqual(Array(12).fill(null));
    expect(averageMetricBuckets([NaN, Infinity])).toEqual(Array(12).fill(null));
    expect(averageMetricBuckets([0, NaN, 20]).at(-1)).toBe(10);
  });
});
