# SDD-030 Plan — 생체신호 처리 고도화 (클라이언트 처리)

> 신호처리는 클라이언트(웹 프론트 `lib/eeg/`)에서 처리. FeatureWorker(logic 서버)는 제외.
> Phase 1(호흡수) → Phase 2(실시간 전달) → Phase 3(리포트) 순.

## 기반 확인 (이미 보유)

- `PPGSignalProcessor`: rrIntervals 추출 + heartRate 계산 ✅
- `AnalysisMetricsService`: RR interval 버퍼(`updateRRIntervalBuffer`) + 재샘플링(`resampleRRIntervals`) + 주파수 도메인(`calculateFrequencyDomainMetrics`, LF/HF) ✅
- 호흡수는 HF 대역(0.15~0.4Hz)의 **지배 주파수** × 60 — 기존 주파수 도메인 인프라 재사용

## Phase 1 — 호흡수 산출 (프론트 `lib/eeg/`)

### T1. 호흡수 계산 추가
- 위치: `AnalysisMetricsService.ts` + `PPGSignalProcessor.ts`
- RR interval 버퍼 → 재샘플링(4Hz) → 0.15~0.4Hz 밴드파워 → FFT 지배 주파수 → ×60 (breaths/min)
- `respiratoryRate` 필드 + `getCurrentRespiratoryRate()` getter
- `getCurrentHRVMetrics()` 스냅샷에 `respiratoryRate` 포함

### T2. 호흡수 품질 검증
- 생리 범위 6~40 bpm 밖은 `null` 처리 (0 치환 금지 원칙)
- RR 버퍼 부족(<30) 시 `null`

## Phase 2 — 몸 지표 실시간 전달

### T3. 1초 feature 확장 (프론트 `useBand.ts`)
- `metricsToFeature`에 `heart_rate`, `respiratory_rate`, `sdnn`, `rmssd`, `lf_power`, `hf_power`, `lf_hf_ratio` 포함 (HRV는 이미 있음, respiratory_rate 추가)

### T4. 백엔드 저장·WS payload 확장
- `EEGFeatureWindow`에 `respiratory_rate`(float nullable) 컬럼 + alembic 마이그레이션
- ingestion 스키마(`EEGFeatureItem`)에 `respiratory_rate` 추가
- WS `/session-live` `eeg_feature` payload에 몸 지표 필드 추가

### T5. 프론트 몸 지표 표시
- 사용자 `GuestMeditationPanel`: 명상 화면에 BPM·호흡수·HRV 패널
- 상담사 `SessionLivePage`: 테이블에 BPM·호흡수 컬럼 (3초 평균·스로틀 재사용)

## Phase 3 — 리포트 상세화 (백엔드)

### T6. 리포트 스키마·요약 확장
- `HRVMotionSummary`에 `respiratory_rate_mean` 추가
- 롤업/리포트에 BPM 평균·최소·최대, 호흡수 평균, HRV 평균 반영

## 구현 순서
1. T1 → T2 (호흡수 계산, 프론트)
2. T3 (1초 feature, 프론트)
3. T4 (백엔드 컬럼·WS)
4. T5 (프론트 표시)
5. T6 (리포트)

## 검증
- 프론트 `npm run build` 0 error
- 백엔드 `pytest` 통과 (기존 328 + 신규)
