/**
 * Sigmoid + median/MAD 정규화 — SDD-036 (haru SDD-042 정본 이식)
 *
 * 포화 없는 매핑: score = 100 · σ(d · c · t)
 * 표준화: t = (z − m) / s
 * 표준 모델: m = median(z), s = 1.4826 · MAD(z) (서버 집계 params)
 */

/** 캘리브레이션·정규화 대상 지표 키 (API 계약 11종) */
export const CALIBRATION_METRIC_KEYS = [
  'focusIndex',
  'relaxationIndex',
  'stressIndex',
  'totalNeuralActivity',
  'faa',
  'cognitiveLoad',
  'emotionalStability',
  'autonomicStability',
  'sdnn',
  'avgHeartRate',
  'breathingStability',
] as const;

export type CalibrationMetricKey = (typeof CALIBRATION_METRIC_KEYS)[number];

/** 한 단계(눈 감기/눈 뜨기) 측정의 지표별 중앙값 */
export type CalibrationBaseline = Record<CalibrationMetricKey, number | null>;

/** ln(9) / Φ⁻¹(0.9) ≈ 1.714 — 표준정규 p10/p50/p90 → 10/50/90점 */
export const SIGMOID_C = Math.log(9) / 1.2815515655446004;

/** MAD → σ 환산 계수 */
export const MAD_TO_SIGMA = 1.4826;

/** 두 분위(대략 p25/p75) 간격 → σ: Φ⁻¹(0.75) − Φ⁻¹(0.25) ≈ 1.349 */
export const QUARTILE_TO_SIGMA = 1.3489795003921634;

const LN_EPS = 1e-9;

export type ScoreDirection = 1 | -1;

/** 값↑ = 점수↑ */
export const DIRECTION_UP: ReadonlySet<CalibrationMetricKey> = new Set([
  'relaxationIndex',
  'emotionalStability',
  'focusIndex',
  'autonomicStability',
  'sdnn',
  'breathingStability',
]);

/** 값↑ = 점수↓ (웰니스: 스트레스·부하·FAA 편차·평균 심박) */
export const DIRECTION_DOWN: ReadonlySet<CalibrationMetricKey> = new Set([
  'stressIndex',
  'cognitiveLoad',
  'faa',
  'avgHeartRate',
]);

export function sigmoid(x: number): number {
  if (!Number.isFinite(x)) return 0.5;
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

/**
 * 0 이 물리적으로 무효한 지표 — ln(0+eps) ≈ -20.7 이 분포를 오염시키지 않게 제외.
 * 백엔드 normalization_distribution.POSITIVE_ONLY 와 동일해야 한다.
 */
export const POSITIVE_ONLY: ReadonlySet<CalibrationMetricKey> = new Set([
  'autonomicStability',
  'sdnn',
  'avgHeartRate',
]);

/** raw → z 변환 (비율·TNA·HRV: ln, FAA: 절댓값, breathingStability: 그대로) */
export function transformRaw(key: CalibrationMetricKey, raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  if (key === 'faa') return Math.abs(raw);
  if (key === 'breathingStability') return raw; // 이미 0~100, ln 없음
  if (raw < 0) return null;
  if (POSITIVE_ONLY.has(key) && raw <= 0) return null;
  return Math.log(raw + LN_EPS);
}

export function scoreDirection(key: CalibrationMetricKey): ScoreDirection {
  return DIRECTION_DOWN.has(key) ? -1 : 1;
}

/** 0~100 점수 (개구간 — 반올림해도 0/100 포화는 극단에서만) */
export function toPercentScore(ratio01: number): number {
  if (!Number.isFinite(ratio01)) return 0;
  return Math.round(Math.min(99.5, Math.max(0.5, ratio01 * 100)));
}

export interface SigmoidParams {
  m: number;
  s: number;
  direction: ScoreDirection;
}

/**
 * 방향형: score = 100 · σ(d · c · t)
 * 좌우뇌 균형(faa): 0 기준 편차형 exp(−ln2 · (|faa|/s)²) — 균형=100, 치우침→0
 * params 는 표준 모델(또는 코호트)의 {m,s,direction}.
 */
export function sigmoidScore(
  key: CalibrationMetricKey,
  raw: number,
  params: SigmoidParams,
): number | null {
  if (!(params.s > 0) || !Number.isFinite(params.m) || !Number.isFinite(params.s)) {
    return null;
  }
  const z = transformRaw(key, raw);
  if (z === null) return null;

  if (key === 'faa') {
    // 좌우뇌 균형: |faa|=0 → 100점, 한쪽 치우칠수록 0점 (0 기준, m 미사용)
    const t = z / params.s;
    if (!Number.isFinite(t)) return null;
    const ratio = Math.exp(-Math.LN2 * t * t);
    return toPercentScore(ratio);
  }

  const t = (z - params.m) / params.s;
  if (!Number.isFinite(t)) return null;

  const ratio = sigmoid(params.direction * SIGMOID_C * t);
  return toPercentScore(ratio);
}

/** median + 1.4826·MAD 로 파라미터 구성 (분포 표본용 / 클라이언트 보조) */
export function paramsFromSamples(
  key: CalibrationMetricKey,
  samples: readonly number[],
): SigmoidParams | null {
  const zs = samples
    .map((v) => transformRaw(key, v))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  if (zs.length < 2) return null;
  const mid = zs.length >> 1;
  const m = zs.length % 2 === 1 ? zs[mid]! : (zs[mid - 1]! + zs[mid]!) / 2;
  const absDev = zs.map((z) => Math.abs(z - m)).sort((a, b) => a - b);
  const madMid = absDev.length >> 1;
  const mad =
    absDev.length % 2 === 1
      ? absDev[madMid]!
      : (absDev[madMid - 1]! + absDev[madMid]!) / 2;
  const s = MAD_TO_SIGMA * mad;
  if (!(s > 0) || !Number.isFinite(s)) return null;
  return { m, s, direction: scoreDirection(key) };
}
