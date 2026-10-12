/** biquadjs — 타입 선언 없음. 필터 팩토리만 선언. */
declare module 'biquadjs' {
  export class Biquad {
    apply(sample: number): number;
    applyFilter(sample: number): number;
  }

  export function makeNotchFilter(
    frequency: number,
    sampleRate: number,
    Q?: number,
  ): Biquad;

  export function makeBandpassFilter(
    frequency: number,
    sampleRate: number,
    Q?: number,
  ): Biquad;

  export function makeLowpassFilter(
    frequency: number,
    sampleRate: number,
    Q?: number,
  ): Biquad;

  export function makeHighpassFilter(
    frequency: number,
    sampleRate: number,
    Q?: number,
  ): Biquad;
}

/** fft.js — 기본 FFT 클래스 */
declare module 'fft.js' {
  export default class FFT {
    constructor(size: number);
    createComplexArray(): number[];
    realTransform(out: number[], input: number[]): void;
    completeSpectrum(spectrum: number[]): void;
    size: number;
  }
}
