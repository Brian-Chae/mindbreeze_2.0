# SDD-041 — 리포트 표준 모델 정규화 적용 (화면·리포트 정합성)

> 관리자가 playground에서 활성화한 표준 분포 모델이 화면(프론트)에는 적용되지만,
> 백엔드 리포트는 정적 코호트 상수(normalization_constants.json)만 사용한다.
> 백엔드 리포트가 활성 표준 모델(normalization_models)을 조회해 동일한 sigmoid 정규화를 적용하게 한다.

## 1. 배경·원인

- 프론트: `eegPersonalScore.scoreIndices` → 표준 모델(sigmoid {m,s,direction}) > 코호트 B0 fallback (SDD-036/039)
- 백엔드: `eeg_metrics.compute_session_metrics` → 정적 `normalization_constants.json`(B0) 백분위/trapezoid 점수만 사용
- 결과: 관리자가 표준 모델을 업데이트해도 리포트는 반영 안 됨. 화면·리포트 정규화 기준 불일치.

## 2. 개선 방향

### T1. 백엔드 sigmoid 정규화 이식
- `backend/app/services/`에 sigmoid 정규화 모듈 신규 (프론트 `eegSigmoidScore.ts` 수식 동일 이식)
  - transformRaw(ln/abs), sigmoidScore(100·σ(d·c·t)), faa 편차형
  - CALIBRATION_METRIC_KEYS(11종), POSITIVE_ONLY, DIRECTION_DOWN
  - SIGMOID_C=ln9/1.28155, MAD_TO_SIGMA=1.4826

### T2. 리포트에 활성 표준 모델 적용
- `report_task.py`/`eeg_metrics.compute_session_metrics`에서:
  - 활성 표준 모델(`NormalizationModel.is_active=true`) 조회 → params {m,s,direction}
  - 있으면 sigmoid 정규화로 0~100 점수 산출
  - 없으면 기존 코호트 상수(normalization_constants.json) fallback

### T3. 리포트에 정규화 기준 명시
- 리포트 계약에 `normalization_version`/`normalization_source`(standard_model vs cohort) 표기
  (관리자가 어떤 기준으로 점수가 나왔는지 알 수 있게)

## 3. 주의
- 기존 코호트 상수 기반 점수 로직은 fallback으로 유지 (회귀 방지)
- raw 1초 feature 저장은 그대로 (정규화는 리포트 시점 적용)
- 프론트 eegSigmoidScore와 수식 일치 (동일 입력 → 동일 점수)

## 4. 완료 기준
- 백엔드 리포트가 활성 표준 모델 적용 (있으면 sigmoid, 없으면 코호트)
- 프론트 화면과 백엔드 리포트가 동일 정규화 기준
- BE pytest 통과, 리포트 스키마에 normalization_source 포함
