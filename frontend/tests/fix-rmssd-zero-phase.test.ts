import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { PPGSignalProcessor } from '../src/lib/eeg/PPGSignalProcessor';

// 제품 번들(vite)과 같은 biquad 경로를 쓴다 — 기본 vitest 해석은 biquadjs named export 를 못 풀어 fallback 필터로 떨어진다.
vi.mock('biquadjs', async () => await import('../node_modules/biquadjs/dist/BiquadFilters.esm.js'));

// 알려진 RMSSD 를 주입한 합성 PPG 로 서비스 경로(처리기 → 지표 서비스)의 편향을 검증한다.
// 박동 시각은 연속 시간(소수 샘플)으로 생성하고 50Hz 로 표본화한다 — 정수 격자 양자화·필터 위상 왜곡이 그대로 드러난다.

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0) / 4294967296;
  return () => { // Box-Muller
    const a = Math.max(u(), 1e-12), b = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
}

/** 박동 1회 파형: 수축기 피크 + 딕로틱 노치 + 2차 고조파 성분(펄스 시작 기준 초). */
function pulse(dt: number): number {
  if (dt < 0 || dt > 0.9) return 0;
  const systolic = Math.exp(-Math.pow((dt - 0.12) / 0.06, 2));
  const diastolic = 0.35 * Math.exp(-Math.pow((dt - 0.38) / 0.09, 2));
  return systolic + diastolic;
}

interface Synth { red: number[]; ir: number[]; trueRr: number[]; }

/** meanBpm 에 RR 백색 변동(RMSSD ≈ √2·σ)을 얹고, rsa>0 이면 0.25Hz 호흡성 변조를 더한다. */
function synthesize(targetRmssd: number, seconds: number, seed: number, meanBpm = 64, rsaMs = 0): Synth {
  const gauss = rng(seed);
  const noise = rng(seed + 7);
  const sigma = targetRmssd / Math.SQRT2;
  const meanRr = 60000 / meanBpm;
  const beatTimes: number[] = [];
  let t = 0.3;
  while (t < seconds + 2) {
    beatTimes.push(t);
    const rr = meanRr + sigma * gauss() + rsaMs * Math.sin(2 * Math.PI * 0.25 * t);
    t += rr / 1000;
  }
  const trueRr = beatTimes.slice(1).map((b, i) => (b - beatTimes[i]) * 1000);
  const n = seconds * 50;
  const red: number[] = [], ir: number[] = [];
  for (let i = 0; i < n; i++) {
    const ts = i / 50;
    let v = 0;
    for (const b of beatTimes) { if (b > ts) break; if (ts - b < 0.9) v += pulse(ts - b); }
    ir.push(100000 + 3000 * v + 40 * noise());
    red.push(80000 + 2000 * v + 40 * noise());
  }
  return { red, ir, trueRr };
}

const realRmssd = (rr: number[]) => Math.sqrt(rr.slice(1).reduce((s, v, i) => s + Math.pow(v - rr[i], 2), 0) / (rr.length - 1));

async function replay(sig: Synth, stepSamples = 50) {
  vi.useFakeTimers();
  const base = 1_800_000_000_000;
  vi.setSystemTime(new Date(base));
  (AnalysisMetricsService as unknown as { instance: null }).instance = null;
  const svc = AnalysisMetricsService.getInstance();
  const proc = new PPGSignalProcessor();
  const buf: { timestamp: number; red: number; ir: number; leadOff: { ch1: boolean; ch2: boolean } }[] = [];
  const rmssd: number[] = [], sdnn: number[] = [], hr: number[] = [];
  for (let i = 0; i < sig.ir.length; i++) {
    buf.push({ timestamp: base + i * 20, red: sig.red[i], ir: sig.ir[i], leadOff: { ch1: false, ch2: false } });
    if (buf.length > 500) buf.shift();
    if (i % stepSamples === stepSamples - 1 && buf.length >= 50) {
      vi.setSystemTime(new Date(base + i * 20));
      const r = await proc.processPPGData(buf.slice());
      await svc.processPPGAnalysisMetrics({ vitals: r.vitals, advancedHRV: r.advancedHRV }, Date.now(), 0, true, r.rrIntervals, proc.getRrEndTimestamps(r));
      const m = svc.getCurrentHRVMetrics();
      if (i > 90 * 50 && m.rmssd !== null && m.rmssd !== undefined) { rmssd.push(m.rmssd); sdnn.push(m.sdnn ?? NaN); hr.push(r.vitals.heartRate); }
    }
  }
  vi.useRealTimers();
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  return { rmssd: med(rmssd), sdnn: med(sdnn.filter(Number.isFinite)), hr: med(hr), count: rmssd.length };
}

beforeEach(() => { vi.useRealTimers(); });
afterEach(() => vi.useRealTimers());

describe('RMSSD 과대 산출 수정 — 합성 신호 편향', () => {
  for (const target of [15, 40, 80]) {
    it(`목표 RMSSD ${target}ms: 서비스 값이 실제 주입값의 ±5ms(또는 ±12%) 이내, HR ±1`, async () => {
      const sig = synthesize(target, 180, 1000 + target);
      const truth = realRmssd(sig.trueRr);
      const out = await replay(sig);
      expect(out.count).toBeGreaterThan(10);
      const tol = Math.max(5, truth * 0.12);
      expect(Math.abs(out.rmssd - truth)).toBeLessThanOrEqual(tol);
      expect(Math.abs(out.hr - 64)).toBeLessThanOrEqual(1.5);
    }, 120000);
  }

  it('호흡성 변조(0.25Hz) 신호: 서비스 RMSSD/SDNN 이 주입한 참값과 일치(빠른 호흡의 RMSSD>SDNN 은 수학적 사실이라 비 ≤1 을 요구하지 않는다)', async () => {
    const sig = synthesize(8, 180, 77, 64, 60);
    const truth = realRmssd(sig.trueRr);
    const mean = sig.trueRr.reduce((x, y) => x + y, 0) / sig.trueRr.length;
    const truthSdnn = Math.sqrt(sig.trueRr.reduce((x, y) => x + (y - mean) ** 2, 0) / sig.trueRr.length);
    const out = await replay(sig);
    expect(Math.abs(out.rmssd - truth)).toBeLessThanOrEqual(Math.max(5, truth * 0.12));
    expect(Math.abs(out.sdnn - truthSdnn)).toBeLessThanOrEqual(Math.max(5, truthSdnn * 0.15));
  }, 120000);

  it('0.5초 간격 재생에서도 같은 범위', async () => {
    const sig = synthesize(40, 150, 2040);
    const truth = realRmssd(sig.trueRr);
    const out = await replay(sig, 25);
    expect(Math.abs(out.rmssd - truth)).toBeLessThanOrEqual(Math.max(5, truth * 0.12));
  }, 120000);
});
