# SDD-036 Plan — 표준 데이터베이스 모델 이식

## 워커 분할
- **BE (codex)**: Phase A — DB + 집계 + API
- **FE (cursor)**: Phase B + C — 정규화 로직 + 관리자 UX

## Phase A — 백엔드 (BE codex)

정본: `haru_band_app/backend/app/{models,routers,services,schemas}/normalization*`

### T-B1. DB 모델 + 마이그레이션
- `models/normalization_baseline.py` — closed/open(JSON), device_id, pipeline_version, gender, birth_date, user_id, is_active
- `models/normalization_model.py` — version, n_samples, params(JSON), is_active
- Alembic 마이그레이션 2개 (baselines, models)

### T-B2. 집계 서비스
- `services/normalization_distribution.py` — compute_distribution (median + 1.4826·MAD, MIN_BASELINES=5, POSITIVE_ONLY, DIRECTION_DOWN)

### T-B3. API 라우터
- `routers/normalization.py` — `/api/v1/normalization/*`, `require_platform_admin`
- POST /baselines, GET /baselines, DELETE /baselines/{id}
- POST /models/compute, GET /models, GET /models/active, POST /models/{id}/activate

### T-B4. 스키마
- `schemas/normalization.py` + `schemas/normalization_model.py` (DistributionParams, MetricKey 등)

## Phase B — 프론트 로직 (FE cursor)

정본: `haru_band_app/src/utils/{eegSigmoidScore,eegScoreConstants}.ts`, `src/services/normalization-api.ts`

### T-F1. 정규화 로직
- `lib/eeg/eegSigmoidScore.ts` — CALIBRATION_METRIC_KEYS(11), transformRaw, sigmoidScore, paramsFromSamples, SIGMOID_C, MAD_TO_SIGMA
- `lib/eeg/eegScoreConstants.ts` — 코호트 B0 상수 (fallback)

### T-F2. API 클라이언트
- `lib/api/normalization-api.ts` — createBaseline/listBaselines/deleteBaseline/computeModel/listModels/getActiveModel/activateModel

## Phase C — 관리자 UX (FE cursor)

### T-F3. 표준 모델 관리 패널
- `components/playground/NormalizationPanel.tsx` — platform_admin만 표시
  - baseline 목록/삭제 + 눈 감기/뜨기 측정 캡처(현재 지표 스냅샷 저장)
  - "표준 모델 계산" + 모델 목록/활성화

### T-F4. 지표 정규화 연동
- StreamProcessor/useBand: 활성 모델({m,s}) 로드 → sigmoid 정규화, 없으면 코호트 B0 fallback

## 완료 기준
- BE pytest 통과, FE build 0 error
- platform_admin 로그인 시 playground에 표준 모델 관리 패널 표시
- baseline 5개 이상 → 모델 compute → activate → 지표 정규화 반영
