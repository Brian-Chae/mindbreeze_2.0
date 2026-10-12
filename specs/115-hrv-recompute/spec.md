# [SDD-115] HRV(SDNN/RMSSD) 재계산

## Goal
HRV 지표를 30초 이상 윈도우로 재계산하고 피크 검출을 개선해 생리적으로 타당한 값을 산출한다.

## Context
현재 SDNN 114~338ms, RMSSD 173~445ms로 정상(20~50ms) 대비 5~10배 과대.
원인 2건:
1. `PPGSignalProcessor.calculateHRV`의 단순 임계값(max×0.5) 피크 검출이 고조파·이중 피크를 오검출.
2. 약 100ms 단위 윈도우로 SDNN/RMSSD 통계 산출 → 통계적으로 무의미.

## Scope

### ✅ In-scope
- `frontend/src/lib/eeg/PPGSignalProcessor.ts` — 피크 검출(불응기 ~250ms + 적응 임계값), 30~60초 윈도우 SDNN/RMSSD
- `frontend/src/lib/eeg/AnalysisMetricsService.ts` — HRV 버퍼/윈도우 집계 (필요시)
### ❌ Out-of-scope
- 백엔드 HRV 재계산 (현재 프론트가 산출)
- 호흡수/심박수 산출 방식

## Acceptance Criteria
- [ ] HRV(SDNN/RMSSD)가 정상 범위(20~50ms 내외) 산출
- [ ] 30초 미만 데이터는 HRV 미산출(null 보존)
- [ ] `npx tsc -b --noEmit` + `npm run build` 0 errors

## Dependencies
- SDD-114 (타임라인 구조는 그대로, HRV 값만 교정)

## Risks
- 피크 검출 개선이 심박수 산출에도 영향 → 심박수 정상성(54~127 BPM) 회귀 확인
- 윈도우 확대로 HRV 데이터 포인트 수 감소 → 그래프 표시는 스텝/막대 권장(별도 SDD)
