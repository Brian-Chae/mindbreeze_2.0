// 원시 파형 미리보기 필터 — 순수 함수(의존성 없음).
// 뇌파 8–30Hz(250Hz), 맥파 DC 제거 + 1–5Hz(50Hz). filtfilt(영위상) + 홀수 확장 패딩으로 4초 창의 앞뒤 과도응답을 없앤다.

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

const Q_BUTTER = Math.SQRT1_2;
const MIN_FILTER_LEN = 8;
const MAX_PAD = 180;

/** RBJ cookbook 2차 하이패스/로우패스(Butterworth Q) */
function biquad(type: 'hp' | 'lp', fc: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q_BUTTER);
  const a0 = 1 + alpha;
  const b = type === 'hp'
    ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
    : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function applyBiquad(x: readonly number[], f: Biquad): number[] {
  const y = new Array<number>(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    y[i] = v; x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
  }
  return y;
}

/** 홀수 확장: 양 끝을 끝점 기준으로 점대칭 반사해 filtfilt 가장자리 과도를 줄인다 */
function oddExtend(x: readonly number[], pad: number): number[] {
  const n = x.length;
  const out: number[] = [];
  for (let i = pad; i >= 1; i--) out.push(2 * x[0] - x[i]);
  for (let i = 0; i < n; i++) out.push(x[i]);
  for (let i = 1; i <= pad; i++) out.push(2 * x[n - 1] - x[n - 1 - i]);
  return out;
}

/** 비유한값은 직전 유한값으로 치환 */
function sanitize(x: readonly number[]): number[] {
  let last = 0;
  return x.map((v) => { if (Number.isFinite(v)) last = v; return last; });
}

function filtfilt(x: readonly number[], filters: Biquad[]): number[] {
  const pad = Math.min(x.length - 1, MAX_PAD);
  let y = oddExtend(x, pad);
  for (const f of filters) y = applyBiquad(y, f);
  y.reverse();
  for (const f of filters) y = applyBiquad(y, f);
  y.reverse();
  return y.slice(pad, pad + x.length);
}

function bandpass(x: readonly number[], lo: number, hi: number, fs: number): number[] {
  const clean = sanitize(x);
  if (clean.length < MIN_FILTER_LEN) return clean;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  return filtfilt(clean.map((v) => v - mean), [biquad('hp', lo, fs), biquad('lp', hi, fs)]);
}

export const EEG_FS = 250;
export const PPG_FS = 50;

/** 뇌파 8–30Hz 밴드패스(250Hz) */
export function filterEegPreview(x: readonly number[]): number[] {
  // filtfilt 는 응답을 제곱(−3dB→−6dB)하므로 코너를 바깥(6/31Hz)에 둬 8–30Hz 가 통과대역에 들게 한다
  return bandpass(x, 6, 31, EEG_FS);
}

/** 맥파 DC 제거 + 1–5Hz 밴드패스(50Hz) */
export function filterPpgPreview(x: readonly number[]): number[] {
  return bandpass(x, 1, 5, PPG_FS);
}

/** 구간별 최소·최대를 시간순으로 뽑는 min/max decimation(스파이크 보존). 결과 길이 ≤ count */
export function minMaxDecimate(x: readonly number[], count: number): number[] {
  const n = x.length;
  if (n <= count || count < 2) return Array.from(x);
  const buckets = Math.max(1, Math.floor(count / 2));
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor((b * n) / buckets);
    const e = Math.max(s + 1, Math.floor(((b + 1) * n) / buckets));
    let minI = s, maxI = s;
    for (let i = s; i < e; i++) {
      if (x[i] < x[minI]) minI = i;
      if (x[i] > x[maxI]) maxI = i;
    }
    if (minI === maxI) out.push(x[minI]);
    else if (minI < maxI) out.push(x[minI], x[maxI]);
    else out.push(x[maxI], x[minI]);
  }
  return out;
}

const SCALE_DECAY = 0.85;

/** 자동 스케일: 급상승은 즉시, 감소는 0.85 감쇠. values 는 ±1 로 정규화 */
export function smoothAutoScale(x: readonly number[], prevPeak: number): { values: number[]; peak: number } {
  const cur = x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const peak = Math.max(cur, prevPeak * SCALE_DECAY, 1e-9);
  return { values: x.map((v) => v / peak), peak };
}
