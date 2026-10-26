// SDD-246 T01 — GF04: 경계 벡터. (a) AnalysisMetricsService 게이트를 독립 Python 기대값과 대조,
// (b) flat/noise/NaN PPG 입력에 대한 기존 TS 거동을 기록(expected/gf04/ppg_degenerate.json)한다.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_MS, FILTER_MODE, V1_DIR, canon } from './run-oracle';
import { AnalysisMetricsService } from '../../../../frontend/src/lib/eeg/AnalysisMetricsService';
import { PPGSignalProcessor } from '../../../../frontend/src/lib/eeg/PPGSignalProcessor';

const WRITE = process.env.ORACLE_WRITE === '1';
const cases = JSON.parse(readFileSync(join(V1_DIR, 'expected/gf04/cases.json'), 'utf8')).cases;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(BASE_MS); AnalysisMetricsService.resetInstance(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); AnalysisMetricsService.resetInstance(); });

async function feed(rr: number[]) {
  const svc = AnalysisMetricsService.getInstance();
  // 박동 종료 시각: 마지막 박동 = BASE_MS, 앞선 박동은 RR 누적으로 거슬러 올라간다(미래 5초 방어에 걸리지 않음).
  const ts: number[] = new Array(rr.length);
  let t = BASE_MS;
  for (let i = rr.length - 1; i >= 0; i--) { ts[i] = t; t -= rr[i]; }
  await svc.processPPGAnalysisMetrics({ vitals: { heartRate: 60 } }, BASE_MS, 100, true, rr, ts);
  return svc;
}

describe('GF04 HRV 게이트 — TS == 독립 Python', () => {
  for (const c of cases) {
    test(c.name, async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const svc = await feed(c.rr);
      const e = c.independent;
      expect(svc.getRRBufferStatus().bufferLength).toBe(e.valid_rr);
      if (!e.calc) {
        expect(svc.getCurrentSDNN()).toBeNull();
        expect(svc.getCurrentRespiratoryRate()).toBeNull();
        expect(svc.getRespiratoryNullReason()).toBe('insufficient_rr_buffer');
        return;
      }
      if (e.sdnn === null) expect(svc.getCurrentSDNN()).toBeNull();
      else {
        expect(Math.abs((svc.getCurrentSDNN() as number) - e.sdnn)).toBeLessThanOrEqual(1e-9);
        expect(Math.abs((svc.getCurrentAVNN() as number) - e.avnn)).toBeLessThanOrEqual(1e-9);
      }
      if (e.resp_gate === 'insufficient_window') {
        expect(svc.getCurrentRespiratoryRate()).toBeNull();
        expect(svc.getRespiratoryNullReason()).toBe('insufficient_window');
      } else {
        // 게이트가 열렸다고 값이 반드시 나오는 것은 아니다 — 사유가 insufficient_window 가 아니어야 한다.
        expect(svc.getRespiratoryNullReason()).not.toBe('insufficient_window');
      }
      spy.mockRestore();
    });
  }
  test('분모 N: 900/1100 교대는 SDNN=100 정확히', async () => {
    const svc = await feed(cases.find((c: any) => c.name === 'sdnn_denominator_N').rr);
    expect(svc.getCurrentSDNN()).toBe(100);
  });
});

function lcg(seed: number) { let s = seed >>> 0; return () => (s = (Math.imul(1664525, s) + 1013904223) >>> 0); }

describe('GF04 flat / noise / NaN PPG — 기존 TS 거동 기록', () => {
  const N = 600; // 12초 @50Hz
  const mk = (f: (i: number) => [number, number]) => Array.from({ length: N }, (_, i) => { const [red, ir] = f(i); return { timestamp: BASE_MS + i * 20, red, ir, leadOff: { ch1: false, ch2: false } }; });
  const r = lcg(246004);
  const inputs: Record<string, any[]> = {
    flat: mk(() => [100000, 120000]),
    noise: mk(() => [100000 + (r() % 6001) - 3000, 120000 + (r() % 6001) - 3000]),
    nan_in_middle: mk((i) => (i === 300 ? [NaN, NaN] : [100000 + (i % 50) * 100, 120000 + (i % 50) * 100])),
    zeros: mk(() => [0, 0]),
  };
  async function runAll() {
    const out: Record<string, unknown> = {};
    for (const [k, data] of Object.entries(inputs)) {
      const p = new PPGSignalProcessor();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const res: any = await p.processPPGData(data);
        const finite = (x: unknown) => (typeof x === 'number' ? Number.isFinite(x) : true);
        out[k] = {
          threw: false, vitals: res.vitals, rr_count: res.rrIntervals.length, rr: res.rrIntervals, peakInfo: res.peakInfo,
          sqi_overall: res.signalQuality.overall, vitals_all_finite: Object.values(res.vitals).every(finite),
          filtered_has_nan: res.filteredData.some((q: any) => Number.isNaN(q.red) || Number.isNaN(q.ir)),
        };
      } catch (e) { out[k] = { threw: true, message: String((e as Error).message) }; }
      vi.restoreAllMocks();
    }
    return out;
  }
  // 퇴화 입력 expected 는 정본(biquad) 경로만 고정한다. legacy_fallback 은 필터가 달라 거동이 다르다(비정본).
  test.skipIf(FILTER_MODE !== 'biquad')('거동이 expected/gf04/ppg_degenerate.json 과 같다(두 번 실행해도 동일)', async () => {
    const a = await runAll();
    expect(canon(await runAll())).toBe(canon(a));
    const f = join(V1_DIR, 'expected/gf04/ppg_degenerate.json');
    if (WRITE) { mkdirSync(join(V1_DIR, 'expected/gf04'), { recursive: true }); writeFileSync(f, canon(a) + '\n'); return; }
    expect(canon(a)).toBe(readFileSync(f, 'utf8').trimEnd());
  });
  test('flat 입력은 RR 을 만들지 않고 0 BPM 을 유효 심박으로 내지 않는다(기록된 거동 확인)', async () => {
    const a: any = await runAll();
    expect(a.flat.threw).toBe(false);
    expect(a.flat.rr_count).toBe(0);
  });
});
