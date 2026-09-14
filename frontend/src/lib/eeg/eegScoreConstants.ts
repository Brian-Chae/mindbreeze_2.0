/**
 * EEG 지표 정규화 상수 — SDD-036 (haru SDD-040 §A2 B0 정본 이식)
 *
 * 출처: haru specs/040-meditation-metrics-redesign/cohort/constants_v2.json
 *   - version: 2, pipeline_version: "v2-morlet7-linear-geomean"
 *   - bootstrap_stage: "B0" (provisional: true) — 코호트 n=37 세션 / 6명 기반 잠정값
 *   - percentile_basis: session-level, user-weighted
 *
 * ⚠️ B0 잠정 상수이므로 코호트 확장 시 재산출 필요.
 */

/** §A2 — 총 신경활동(TNA) 사다리꼴 정규화 파라미터 (단위 μV²) */
export const TNA_PERCENTILES = {
  /** a — P05 */ p5: 18.512342,
  /** b — P25 */ p25: 110.555984,
  /** c — P75 */ p75: 804.139473,
  /** d — P95 */ p95: 9298.234459,
} as const;

/** §A2 — 스트레스 지수 (β+γ)/(α+θ), 낮을수록 좋음 */
export const STRESS_PERCENTILES = { p5: 0.461857, p95: 8.720813 } as const;

/** §A2 — 좌우뇌 균형: FAA = ln(α_fp2) − ln(α_fp1), |FAA|의 P90 */
export const FAA_ABS_P90 = 0.799637;

/** §A2 — 정서 안정성 (α+θ)/γ, 높을수록 좋음 */
export const EMOTIONAL_STABILITY_PERCENTILES = { p5: 0.235214, p95: 7.241375 } as const;

/** §A2 — 이완 지수 α/(α+β) 비대칭 사다리꼴 (a=P10, b=P60, c=P95, d=1.0) */
export const RELAXATION_TRAPEZOID = {
  /** a */ p10: 0.098243,
  /** b */ p60: 0.259726,
  /** c */ p95: 0.428846,
  /** d — 이론상 최대값 */ max: 1.0,
} as const;

/**
 * §A2 — 집중 지수 raw β/(α+θ) 백분위.
 * 실시간 윈도우에서는 세션 내 SD 기반 최종 점수 대신 raw 백분위 정규화를 사용한다.
 */
export const FOCUS_PERCENTILES = { p5: 0.381252, p95: 5.608388 } as const;

/**
 * 인지 부하 raw θ/α 백분위.
 * ⚠️ 최종 점수(SD 기반)가 아니며, 코호트 분포 기반 잠정 스케일이다.
 */
export const COGNITIVE_LOAD_PERCENTILES = { p5: 1.6066, p95: 4.8083 } as const;
