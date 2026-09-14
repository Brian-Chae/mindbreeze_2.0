/**
 * EEG raw indices → 0~100 점수 정규화 — SDD-036 (haru SDD-040 §A2 코호트 B0)
 *
 * 모든 점수는 "높을수록 좋음" 방향으로 정렬된다.
 * 상수 출처 및 잠정성(B0)은 ./eegScoreConstants 주석 참조.
 */
import {
  COGNITIVE_LOAD_PERCENTILES,
  EMOTIONAL_STABILITY_PERCENTILES,
  FAA_ABS_P90,
  FOCUS_PERCENTILES,
  RELAXATION_TRAPEZOID,
  STRESS_PERCENTILES,
  TNA_PERCENTILES,
} from './eegScoreConstants';

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** 0~100 정수로 반올림 + 클램프 */
function toScore(ratio01: number): number {
  return Math.round(clamp01(ratio01) * 100);
}

/**
 * mindbreeze EEGSignalProcessor 가 focus/relaxation/stress 에 ×100 한 경우가 있어
 * 코호트 B0(비율 스케일) 입력으로 맞춘다.
 */
export function toRatioScale(raw: number): number {
  if (!Number.isFinite(raw)) return Number.NaN;
  return raw > 10 ? raw / 100 : raw;
}

/** §A2 — 총 신경활동: 방향형 (총파워↑ = 점수↑) */
export function scoreTotalNeuralActivity(tna: number): number {
  const { p5, p95 } = TNA_PERCENTILES;
  if (!Number.isFinite(tna)) return 0;
  return toScore((tna - p5) / (p95 - p5));
}

/** §A2 — 스트레스 지수: 낮을수록 좋음 → 역방향 선형 정규화 */
export function scoreStressIndex(stressIndex: number): number {
  const { p5, p95 } = STRESS_PERCENTILES;
  const v = toRatioScale(stressIndex);
  if (!Number.isFinite(v)) return 0;
  return toScore((p95 - v) / (p95 - p5));
}

/**
 * §A2 — 좌우뇌 균형: FAA = ln(α_fp2) − ln(α_fp1), 0에 가까울수록 좋음.
 * null 이면 0점(측정 불가).
 */
export function scoreHemisphericBalance(faa: number | null): number {
  if (faa === null || !Number.isFinite(faa)) return 0;
  return toScore(1 - Math.abs(faa) / FAA_ABS_P90);
}

/** §A2 — 정서 안정성 (α+θ)/γ: 높을수록 좋음 */
export function scoreEmotionalStability(es: number): number {
  const { p5, p95 } = EMOTIONAL_STABILITY_PERCENTILES;
  if (!Number.isFinite(es)) return 0;
  return toScore((es - p5) / (p95 - p5));
}

/** §A2 — 이완 지수 α/(α+β): 비대칭 사다리꼴 */
export function scoreRelaxationIndex(ri: number): number {
  const { p10: a, p60: b, p95: c, max: d } = RELAXATION_TRAPEZOID;
  const v = toRatioScale(ri);
  if (!Number.isFinite(v) || v <= a) return 0;
  if (v < b) return toScore((v - a) / (b - a));
  if (v <= c) return 100;
  return Math.round(Math.max(0, 100 - 40 * ((v - c) / (d - c))));
}

/** 집중 지수 raw β/(α+θ) 백분위 정규화 (실시간 표시용) */
export function scoreFocusIndexRealtime(focusIndex: number): number {
  const { p5, p95 } = FOCUS_PERCENTILES;
  const v = toRatioScale(focusIndex);
  if (!Number.isFinite(v)) return 0;
  return toScore((v - p5) / (p95 - p5));
}

/** 인지 부하 raw θ/α 백분위 정규화 (낮을수록 좋음 → 역방향) */
export function scoreCognitiveLoadRealtime(cognitiveLoad: number): number {
  const { p5, p95 } = COGNITIVE_LOAD_PERCENTILES;
  if (!Number.isFinite(cognitiveLoad)) return 0;
  return toScore((p95 - cognitiveLoad) / (p95 - p5));
}
