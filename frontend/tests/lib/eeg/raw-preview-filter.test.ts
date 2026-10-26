import { describe, expect, it } from 'vitest';
import {
  filterEegPreview,
  filterPpgPreview,
  minMaxDecimate,
  smoothAutoScale,
} from '@/lib/eeg/raw-preview-filter';

const sine = (hz: number, fs: number, n: number, amp = 1, dc = 0): number[] =>
  Array.from({ length: n }, (_, i) => dc + amp * Math.sin((2 * Math.PI * hz * i) / fs));
const rms = (v: number[]): number => Math.sqrt(v.reduce((a, b) => a + b * b, 0) / v.length);
const mid = (v: number[]): number[] => v.slice(Math.floor(v.length * 0.25), Math.floor(v.length * 0.75));

describe('filterEegPreview (8–30Hz, 250Hz)', () => {
  const fs = 250, n = 1000;
  const ref = rms(sine(10, fs, n));
  it('10Hz 통과', () => expect(rms(mid(filterEegPreview(sine(10, fs, n)))) / ref).toBeGreaterThan(0.85));
  it('2Hz 감쇠', () => expect(rms(mid(filterEegPreview(sine(2, fs, n)))) / ref).toBeLessThan(0.15));
  it('50Hz 감쇠', () => expect(rms(mid(filterEegPreview(sine(50, fs, n)))) / ref).toBeLessThan(0.15));
  it('가장자리 과도응답 억제', () => {
    const out = filterEegPreview(sine(10, fs, n));
    expect(rms(out.slice(0, 50)) / rms(mid(out))).toBeGreaterThan(0.8);
    expect(rms(out.slice(-50)) / rms(mid(out))).toBeGreaterThan(0.8);
  });
  it('빈/짧은/NaN 안전', () => {
    expect(filterEegPreview([])).toEqual([]);
    expect(filterEegPreview([1, 2, 3])).toHaveLength(3);
    const out = filterEegPreview([1, NaN, 3, Infinity, ...sine(10, fs, 100)]);
    expect(out.every(Number.isFinite)).toBe(true);
  });
});

describe('filterPpgPreview (DC 제거 + 1–5Hz, 50Hz)', () => {
  const fs = 50, n = 200;
  const ref = rms(sine(1.2, fs, n));
  it('DC 제거 후 평균≈0', () => {
    const out = filterPpgPreview(sine(1.2, fs, n, 100, 50000));
    expect(Math.abs(out.reduce((a, b) => a + b, 0) / out.length)).toBeLessThan(3);
  });
  it('맥박 1.5Hz 통과', () => expect(rms(mid(filterPpgPreview(sine(1.5, fs, n)))) / rms(sine(1.5, fs, n))).toBeGreaterThan(0.8));
  it('0.1Hz 드리프트 감쇠', () => expect(rms(mid(filterPpgPreview(sine(0.1, fs, n)))) / ref).toBeLessThan(0.2));
  it('15Hz 노이즈 감쇠', () => expect(rms(mid(filterPpgPreview(sine(15, fs, n)))) / ref).toBeLessThan(0.15));
  it('빈/짧은 안전', () => {
    expect(filterPpgPreview([])).toEqual([]);
    expect(filterPpgPreview([5])).toHaveLength(1);
  });
});

describe('minMaxDecimate', () => {
  it('길이 ≤ count, 스파이크 보존', () => {
    const v = new Array(1000).fill(0); v[503] = 99;
    const out = minMaxDecimate(v, 120);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(Math.max(...out)).toBe(99);
  });
  it('짧으면 그대로', () => expect(minMaxDecimate([1, 2, 3], 120)).toEqual([1, 2, 3]));
});

describe('smoothAutoScale', () => {
  it('정규화 |v|≤1, 급상승 즉시 반영', () => {
    const a = smoothAutoScale([1, -2, 2], 1);
    expect(a.peak).toBe(2);
    expect(a.values.every((x) => Math.abs(x) <= 1)).toBe(true);
    const b = smoothAutoScale([10], a.peak);
    expect(b.peak).toBe(10);
  });
  it('감소는 0.85 감쇠', () => {
    const b = smoothAutoScale([1], 10);
    expect(b.peak).toBeCloseTo(8.5, 5);
  });
});
