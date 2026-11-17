import { describe, it, expect } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';

/** RR(ms) 시계열 생성: 평균 mean, 주파수 성분 [{f(Hz), amp(ms)}], 선택적 느린 드리프트 */
function makeRR(n: number, comps: { f: number; amp: number }[], mean = 900, drift = 0): number[] {
  const rr: number[] = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    let v = mean + drift * (i / n);
    for (const c of comps) v += c.amp * Math.sin(2 * Math.PI * c.f * t);
    rr.push(v);
    t += v / 1000;
  }
  return rr;
}
function run(rr: number[]) {
  AnalysisMetricsService.resetInstance();
  const s: any = AnalysisMetricsService.getInstance();
  s.rrIntervalBuffer = rr.slice();
  s.rrTimestampBuffer = rr.map((_, i) => i);
  s.calculateFrequencyDomainMetrics(rr.slice());
  return { lf: s.currentLfPower as number, hf: s.currentHfPower as number, ratio: s.currentLfHfRatio as number, s };
}

describe('fix-lfhf-overestimate: 스펙트럼 입력 평균 제거 + cubic 보간', () => {
  it('B1 HF(0.25Hz) 변조만 → LF/HF < 0.2 (DC 누설 없음)', () => {
    expect(run(makeRR(120, [{ f: 0.25, amp: 40 }])).ratio).toBeLessThan(0.2);
  });
  it('B2 LF(0.1Hz) 변조만 → LF/HF > 5', () => {
    expect(run(makeRR(120, [{ f: 0.1, amp: 40 }])).ratio).toBeGreaterThan(5);
  });
  it('B3 같은 진폭 LF+HF → LF/HF 0.7~1.4', () => {
    const r = run(makeRR(120, [{ f: 0.1, amp: 30 }, { f: 0.25, amp: 30 }])).ratio;
    expect(r).toBeGreaterThan(0.7);
    expect(r).toBeLessThan(1.4);
  });
  it('B5 느린 드리프트(+120ms)를 더해도 B3 결과 ±15%', () => {
    const base = run(makeRR(120, [{ f: 0.1, amp: 30 }, { f: 0.25, amp: 30 }])).ratio;
    const dr = run(makeRR(120, [{ f: 0.1, amp: 30 }, { f: 0.25, amp: 30 }], 900, 120)).ratio;
    expect(Math.abs(dr / base - 1)).toBeLessThan(0.15);
  });
  it('B6 재표본 출력에 NaN 없음, 길이 floor(총시간×4), 평균≈0', () => {
    const rr = makeRR(120, [{ f: 0.25, amp: 40 }]);
    const s: any = run(rr).s;
    const y: number[] = s.resampleRRIntervals(rr, 4);
    expect(y.length).toBe(Math.floor((rr.reduce((a, b) => a + b, 0) / 1000) * 4));
    expect(y.every(Number.isFinite)).toBe(true);
    expect(Math.abs(y.reduce((a, b) => a + b, 0) / y.length)).toBeLessThan(1e-6);
  });
});
