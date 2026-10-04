# [SDD-115] — Implementation Plan

**Goal:** HRV(SDNN/RMSSD)를 30초 윈도우로 재계산 + 피크 검출 개선

**Tech Stack:** React/TS (프론트 PPG 파이프라인)

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Modify | `frontend/src/lib/eeg/PPGSignalProcessor.ts` | `calculateHRV` 피크 검출 + 윈도우 재설계 |
| Modify | `frontend/src/lib/eeg/AnalysisMetricsService.ts` | HRV 집계 윈도우 (필요시) |

## Tasks

### Task 1: 피크 검출 개선
**Objective:** 단순 임계값(max×0.5) → 불응기(~250ms) + 적응 임계값.
**Files:** PPGSignalProcessor.ts
- 연속 피크 간 최소 간격(불응기) 적용으로 이중 피크 제거.
- 잡음 대응 적응 임계값(국소 진폭 기반).
**Estimate:** 20min

### Task 2: 30~60초 윈도우 SDNN/RMSSD
**Objective:** 100ms 단위 산출 → 30~60초 윈도우로 재집계.
**Files:** PPGSignalProcessor.ts, AnalysisMetricsService.ts
- 윈도우 내 NN 간격으로 SDNN(표준편차)/RMSSD(연속차 제곱평균 제곱근) 산출.
- 30초 미만은 null.
**Estimate:** 25min

## Testing Strategy
- `cd frontend && npx tsc -b --noEmit && npm run build`
- (선택) 기존 vitest PPG 테스트 갱신
