import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisMetricsService } from '../src/lib/eeg/AnalysisMetricsService';
import { StreamProcessor } from '../src/lib/eeg/StreamProcessor';
import { resolveBodyScale } from '../src/components/reports/NarrativeSections';

// 알려진 RR 열(평균 ~830ms, SDNN ≈ 40ms)로 박동 시각을 만들고, 호흡·기저선 드리프트가 큰 IR/RED 를 합성한다.
const FS = 50;
function makeBeats(seconds: number) {
  const beats: number[] = []; const rr: number[] = [];
  let t = 0.4; let k = 0;
  while (t < seconds + 2) {
    beats.push(t);
    const r = 0.83 + 0.057 * Math.sin(2 * Math.PI * 0.1 * t) + 0.02 * Math.sin(2 * Math.PI * 0.27 * t + k);
    rr.push(r * 1000); t += r; k++;
  }
  return { beats, rr };
}
function pulseAt(t: number, beats: number[]) {
  // 박동마다 수축기 가우시안 + 작은 이중맥파(dicrotic) 가우시안
  let v = 0;
  for (const b of beats) {
    const d = t - b; if (d < -0.3 || d > 0.8) continue;
    v += Math.exp(-(d * d) / (2 * 0.06 ** 2)) + 0.28 * Math.exp(-((d - 0.28) ** 2) / (2 * 0.05 ** 2));
  }
  return v;
}
function sdOf(a: number[]) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(1_000_000_000));
  (AnalysisMetricsService as unknown as { instance: null }).instance = null;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function runSynthetic(seconds: number) {
  const { beats, rr } = makeBeats(seconds);
  const svc = AnalysisMetricsService.getInstance();
  const sp = new StreamProcessor();
  const N = 28;
  for (let s = 0; s < seconds * FS; s += N) {
    await vi.advanceTimersByTimeAsync(N * 20);
    const pts = [];
    for (let k = 0; k < N; k++) {
      const i = s + k; const t = i / FS;
      const p = pulseAt(t, beats);
      const drift = 3500 * Math.sin(2 * Math.PI * 0.02 * t) + 2200 * Math.sin(2 * Math.PI * 0.25 * t);
      pts.push({ timestamp: Date.now() - (N - k) * 20, ir: Math.round(120000 + drift + 1500 * p), red: Math.round(90000 + 0.7 * drift + 1000 * p), leadOff: false });
    }
    sp.processPPGData(pts as never);
  }
  const buf = (svc as unknown as { rrIntervalBuffer: number[] }).rrIntervalBuffer;
  return { svc, buf, trueSdnn: sdOf(rr.slice(0, 120)) };
}

describe('합성 PPG — RR 피크 검출·SDNN', () => {
  it('드리프트·호흡 성분이 있어도 RR 이 박동 누락/가짜 피크 없이 정상 범위이고 SDNN 이 참값 근처다', async () => {
    const { svc, buf, trueSdnn } = await runSynthetic(110);
    process.stdout.write('\nSDNN_REPORT '+svc.getCurrentSDNN()+' true='+trueSdnn+' bad='+buf.filter(r=>r<500||r>1300).length+'/'+buf.length+'\n');
    expect(buf.length).toBeGreaterThanOrEqual(30);
    expect(buf.filter(r => r < 500 || r > 1300)).toEqual([]);
    const sdnn = svc.getCurrentSDNN();
    expect(sdnn).not.toBeNull();
    expect(Math.abs((sdnn as number) - trueSdnn)).toBeLessThan(25);
    expect(sdnn as number).toBeLessThan(100);
  }, 180000);
});

describe('리포트 몸 지표 차트 스케일', () => {
  it('값이 고정 범위 안이면 고정 범위를 유지한다', () => {
    expect(resolveBodyScale([0, 200], [30, 80, 120])).toEqual([0, 200]);
  });
  it('값이 상한을 넘으면 클램프하지 않고 범위를 실제 최대까지 넓힌다', () => {
    const [lo, hi] = resolveBodyScale([0, 200], [280, 300, 325]);
    expect(lo).toBe(0); expect(hi).toBeGreaterThanOrEqual(325);
  });
  it('값이 하한 아래면 하한도 넓힌다', () => {
    const [lo, hi] = resolveBodyScale([40, 120], [30, 80, 150]);
    expect(lo).toBeLessThanOrEqual(30); expect(hi).toBeGreaterThanOrEqual(150);
  });
});
