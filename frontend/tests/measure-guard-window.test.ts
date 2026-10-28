// 측정 가드(웹) — 코어 guard.rs / guard-contract.md 와 같은 규칙 1~5 검증.
// 정상 신호는 무효로 판정되지 않아야 하고, 불량 신호는 reason 코드로 명시적 무효가 된다.
import { describe, expect, it } from 'vitest';
import {
  GAP_SAMPLES_LIMIT,
  GUARD_REASONS,
  GUARD_WINDOW,
  LEADOFF_RATIO_LIMIT,
  OUTLIER_TNA_LIMIT,
  SATURATION_FRACTION,
  SATURATION_RATIO_LIMIT,
  STEP_COUNT_LIMIT,
  STEP_UV,
  EegGapTracker,
  GUARD_ENFORCE,
  checkEegWindow,
  isOutlierTna,
  saturationThresholdUv,
} from '../src/lib/eeg/measureGuard';
import { EEGSignalProcessor } from '../src/lib/eeg/EEGSignalProcessor';
import type { EEGDataPoint } from '../src/lib/eeg/SimpleCircularBuffer';

function pt(i: number, fp1: number, fp2: number, lo1 = false, lo2 = false): EEGDataPoint {
  return { timestamp: i * 4, fp1, fp2, signalQuality: 1, leadOff: { ch1: lo1, ch2: lo2 } };
}
function clean(n: number): EEGDataPoint[] {
  return Array.from({ length: n }, (_, i) => pt(i, Math.sin(i * 0.3) * 50, Math.cos(i * 0.2) * 40));
}

describe('계약 상수 = 코어 guard.rs', () => {
  it('상수 값', () => {
    expect(GUARD_WINDOW).toBe(1000);
    expect(SATURATION_FRACTION).toBe(0.98);
    expect(SATURATION_RATIO_LIMIT).toBe(0.005);
    expect(STEP_UV).toBe(3000);
    expect(STEP_COUNT_LIMIT).toBe(3);
    expect(LEADOFF_RATIO_LIMIT).toBe(0.05);
    expect(GAP_SAMPLES_LIMIT).toBe(2);
    expect(OUTLIER_TNA_LIMIT).toBe(1000);
    expect(GUARD_REASONS).toEqual(['saturated', 'step', 'leadoff', 'gap', 'outlier']);
  });
  it('포화 임계 ≈ 329,361µV (풀스케일 98%)', () => {
    expect(Math.abs(saturationThresholdUv() - 329_361)).toBeLessThan(100);
  });
});

describe('checkEegWindow 규칙 1~3', () => {
  it('정상 신호는 통과', () => {
    expect(checkEegWindow(clean(1000))).toBeNull();
    expect(checkEegWindow(clean(1250))).toBeNull();
  });
  it('포화: 5개(0.5%)는 통과, 6개는 saturated(계단보다 우선)', () => {
    const w = clean(1000);
    for (let k = 0; k < 5; k++) w[100 + k * 10] = pt(100 + k * 10, 0, 0); // 자리만 확보
    const sat = clean(1000);
    // 연속 포화 5개: 진입+이탈 계단이 2회뿐이라 step 규칙(≥3)에 안 걸린다
    for (let k = 0; k < 5; k++) sat[100 + k] = pt(100 + k, 336_083, 0);
    expect(checkEegWindow(sat)).toBeNull();
    sat[300] = pt(300, 0, -336_083);
    expect(checkEegWindow(sat)).toBe('saturated');
  });
  it('계단: 스파이크 1개(2회)는 통과, 2개(4회)는 step', () => {
    const w = clean(1000);
    w[200] = pt(200, 5000, 0);
    expect(checkEegWindow(w)).toBeNull();
    w[500] = pt(500, 5000, 0);
    expect(checkEegWindow(w)).toBe('step');
  });
  it('직류 계단(DC 이동) 3회 이상은 step', () => {
    const w = clean(1000);
    for (let i = 300; i < 1000; i++) w[i] = pt(i, w[i].fp1 + 4000, w[i].fp2);
    expect(checkEegWindow(w)).toBeNull(); // 1회
    for (let i = 500; i < 600; i++) w[i] = pt(i, w[i].fp1 + 4000, w[i].fp2); // +2회
    expect(checkEegWindow(w)).toBe('step');
  });
  it('lead-off: 정확히 5%는 통과, 초과는 leadoff', () => {
    const w = clean(1000);
    for (let i = 0; i < 50; i++) w[i] = pt(i, w[i].fp1, w[i].fp2, true, false);
    expect(checkEegWindow(w)).toBeNull();
    w[60] = pt(60, w[60].fp1, w[60].fp2, false, true);
    expect(checkEegWindow(w)).toBe('leadoff');
  });
  it('판정은 링 끝의 최근 1000샘플만 본다', () => {
    const w = clean(1250);
    for (let i = 0; i < 200; i++) w[i] = pt(i, 336_083, 336_083, true, true);
    expect(checkEegWindow(w)).toBeNull();
  });
});

describe('규칙 5 outlier', () => {
  it('TNA>1000 또는 비유한이면 outlier', () => {
    expect(isOutlierTna(1000)).toBe(false);
    expect(isOutlierTna(1000.5)).toBe(true);
    expect(isOutlierTna(Number.NaN)).toBe(true);
    expect(isOutlierTna(Number.POSITIVE_INFINITY)).toBe(true);
  });
});

describe('규칙 4 갭 — 장치 tick 기준(도착 시각 사용 금지)', () => {
  const SEC = (samples: number) => samples / 250;
  it('연속 패킷은 갭 0, 누락 2샘플까지 허용, 3샘플부터 갭', () => {
    const t = new EegGapTracker();
    expect(t.observe(100, 10)).toBe(0); // 첫 패킷
    expect(t.observe(100 + SEC(10), 10)).toBe(0);
    expect(t.observe(100 + SEC(10) + SEC(12), 10)).toBe(2); // 2샘플 누락
    expect(t.isGap(2)).toBe(false);
    expect(t.observe(100 + SEC(10) + SEC(12) + SEC(13), 10)).toBe(3);
    expect(t.isGap(3)).toBe(true);
  });
  it('500샘플 누락도 갭', () => {
    const t = new EegGapTracker();
    t.observe(10, 10);
    expect(t.isGap(t.observe(10 + SEC(510), 10))).toBe(true);
  });
  it('시각이 되돌아가면(리셋) 갭이 아니라 구간 리셋 신호', () => {
    const t = new EegGapTracker();
    t.observe(100, 10);
    expect(t.observe(50, 10)).toBe(0);
    expect(t.observe(50 + SEC(10), 10)).toBe(0); // 리셋 이후 다시 정상 추적
  });
  it('도착 지터만 있고 장치 tick 이 연속이면 갭 0', () => {
    const t = new EegGapTracker();
    t.observe(0, 10);
    for (let i = 1; i <= 20; i++) expect(t.observe(SEC(10 * i), 10)).toBe(0);
  });
});

describe('EEGSignalProcessor — 불량 윈도는 기록만(지표 유지, 사유 기록)', () => {
  const synth = (n: number): EEGDataPoint[] =>
    Array.from({ length: n }, (_, i) =>
      pt(i, 20 * Math.sin((2 * Math.PI * 10 * i) / 250) + 5 * Math.sin((2 * Math.PI * 20 * i) / 250), 18 * Math.sin((2 * Math.PI * 10 * i) / 250 + 0.4)),
    );

  it('정상 윈도는 validity=valid, indices 유한', async () => {
    const r = await new EEGSignalProcessor().processEEGData(synth(1250));
    expect(r.validity).toBe('valid');
    expect(r.reason).toBeNull();
    expect(Number.isFinite(r.indices.relaxationIndex)).toBe(true);
  });
  it('기록만 모드: 포화 윈도도 지표를 정상 산출하고 reason=saturated 만 남긴다', async () => {
    expect(GUARD_ENFORCE).toBe(false);
    const d = synth(1250);
    for (let i = 600; i < 640; i++) d[i] = pt(i, 336_083, -336_083);
    const r = await new EEGSignalProcessor().processEEGData(d);
    expect(r.validity).toBe('valid');
    expect(r.reason).toBe('saturated');
    expect(Number.isFinite(r.indices.focusIndex)).toBe(true);
    expect(Number.isFinite(r.indices.relaxationIndex)).toBe(true);
    expect(r.bandPowers).not.toBeNull();
  });
  it('기록만 모드: 계단 윈도 reason=step, 지표 유지', async () => {
    const d = synth(1250);
    for (const k of [400, 600, 800]) d[k] = pt(k, 9000, 0);
    const r = await new EEGSignalProcessor().processEEGData(d);
    expect(r.reason).toBe('step');
    expect(r.validity).toBe('valid');
    expect(r.indices).not.toBeNull();
  });
  it('기록만 모드: lead-off 윈도 reason=leadoff, 지표 유지', async () => {
    const d = synth(1250).map((p, i) => (i % 5 === 0 ? { ...p, leadOff: { ch1: true, ch2: false } } : p));
    const r = await new EEGSignalProcessor().processEEGData(d);
    expect(r.reason).toBe('leadoff');
    expect(r.indices).not.toBeNull();
  });
});
