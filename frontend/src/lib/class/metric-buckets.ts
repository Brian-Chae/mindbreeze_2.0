/** 1Hz 링버퍼를 최근 시점부터 25초씩 나눈다. 아직 없는 구간은 null로 유지한다. */
export function averageMetricBuckets(values: readonly number[]): (number | null)[] {
  const recent = values.slice(-300);
  return Array.from({ length: 12 }, (_, index) => {
    const end = recent.length - (11 - index) * 25;
    if (end <= 0) return null;
    const bucket = recent.slice(Math.max(0, end - 25), end).filter(Number.isFinite);
    return bucket.length === 0 ? null : bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
  });
}
