# SDD-041 Plan — 리포트 표준 모델 정규화 적용

## 워커: BE (codex)

### T1. sigmoid 정규화 모듈 이식
- `app/services/normalization_score.py` 신규 — 프론트 `eegSigmoidScore.ts` 수식 동일 이식
  - transformRaw, sigmoidScore, faa 편차형, CALIBRATION_METRIC_KEYS(11), POSITIVE_ONLY, DIRECTION_DOWN

### T2. 리포트 적용
- `eeg_metrics.compute_session_metrics`(또는 report_task)에 활성 표준 모델 조회 + sigmoid 적용
- 표준 모델 없으면 기존 코호트 상수 fallback

### T3. normalization_source 명시
- 리포트 계약/스키마에 normalization_source(standard_model|cohort) 추가

## 완료 기준
- BE pytest 통과
- 활성 표준 모델 있으면 sigmoid 점수, 없으면 코호트
