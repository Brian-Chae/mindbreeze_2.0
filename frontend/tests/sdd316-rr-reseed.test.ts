// SDD-316: RR 중앙값 ±25% 게이트 락인 재시드 — Rust 코어(sdd314_hrv_gates.rs)와 같은 합성 시나리오.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';

const T0 = 1_800_000_000_000;
const vitals = (hr: number) => ({ vitals: { heartRate: hr } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T0));
  AnalysisMetricsService.resetInstance();
});
afterEach(() => vi.useRealTimers());

async function feed(svc: AnalysisMetricsService, rr: number, t: { v: number }, hr = 75) {
  t.v += rr;
  vi.setSystemTime(new Date(T0 + t.v));
  await svc.processPPGAnalysisMetrics(vitals(hr), T0 + t.v, undefined, undefined, [rr], [T0 + t.v]);
}

describe('RR 게이트 재시드 (SDD-316)', () => {
  it('가짜 짧은 RR 13개가 버퍼를 선점해도 12창 연속 탈락 후 정상 RR 로 전환된다', async () => {
    const svc = AnalysisMetricsService.getInstance();
    const t = { v: 0 };
    for (let i = 0; i < 13; i += 1) await feed(svc, 380, t, 80);
    for (let i = 0; i < 200; i += 1) await feed(svc, 700, t, 85);
    const avnn = svc.getCurrentAVNN();
    expect(avnn).not.toBeNull();
    expect(Math.abs((avnn as number) - 700)).toBeLessThan(30);
    expect(svc.getCurrentSDNN()).not.toBeNull();
  });

  it('연속 탈락이 12창 미만이면 비우지 않는다', async () => {
    const svc = AnalysisMetricsService.getInstance();
    const t = { v: 0 };
    for (let i = 0; i < 13; i += 1) await feed(svc, 380, t, 80);
    const before = svc.getRRBufferStatus().bufferLength;
    for (let i = 0; i < AnalysisMetricsService.RR_GATE_RESEED_STREAK - 1; i += 1) await feed(svc, 700, t, 85);
    expect(svc.getRRBufferStatus().bufferLength).toBeGreaterThanOrEqual(Math.min(before, 5));
  });

  it('부정맥형(4박 중 1박 ±25% 밖)에서는 재시드로 버퍼가 비워지지 않는다', async () => {
    const svc = AnalysisMetricsService.getInstance();
    const t = { v: 0 };
    let s = 12345;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
    let minLen = Infinity;
    for (let i = 0; i < 400; i += 1) {
      const rr = rnd() < 0.25 ? (rnd() < 0.5 ? 500 : 1100) : 800 + (rnd() - 0.5) * 80;
      await feed(svc, rr, t);
      if (i > 60) minLen = Math.min(minLen, svc.getRRBufferStatus().bufferLength);
    }
    expect(minLen).toBeGreaterThanOrEqual(30);
    expect(svc.getCurrentSDNN()).not.toBeNull();
  });

  it('완전 불규칙 RR 에서도 예외·0 치환이 없다', async () => {
    const svc = AnalysisMetricsService.getInstance();
    const t = { v: 0 };
    let s = 99;
    for (let i = 0; i < 600; i += 1) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      await feed(svc, 300 + (s / 2 ** 32) * 1200, t);
      const v = svc.getCurrentSDNN();
      if (v !== null) expect(Number.isFinite(v) && v > 0).toBe(true);
    }
  });
});
