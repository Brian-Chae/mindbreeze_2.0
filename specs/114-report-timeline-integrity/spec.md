# [SDD-114] 리포트 타임라인 데이터 정합 (시간축·감정안정도·정규화)

## Goal
리포트 그래프의 시간축·감정안정도·마음 지표 정규화를 바로잡아 실제 측정 데이터를 정확히 표시한다.

## Context
문제 리포트 `32656e43-4ea6-43e6-a7e8-5122838e8ccd`(세션 `05fbf8f7-ee2a-43f3-b05b-b96886a12056`) 그래프의 데이터 정합 오류 3건을 수정한다.

1. **시간축 10배 과장**: `_build_eeg_content`가 `window_index`(약 10Hz 카운터, 1당 100.9ms)를 `t`(초)로 사용. 실측 186.5초(3.1분)인데 30.2분으로 표시.
2. **감정안정도 프록시 오류**: 타임라인에 `emotional_stability`가 빠져 있어 프론트가 `100 - stress_index`로 근사. stress_index(0.7~4853)를 빼서 음수(-4737) 발생. 실제 컬럼 `emotional_stability`(0.0002~24.8)는 존재하나 미사용.
3. **마음 지표 스케일 불일치**: focus_index(0~100)·relaxation_index(0~1)·stress_index(0.7~4853)·emotional_stability(0.0002~24.8)로 원천 스케일이 제각각. 프론트 `toDisplayScale`(report.ts:237)은 0~1 값만 ×100하는 반쪽 정규화라 raw 값을 못 고침.

## Scope

### ✅ In-scope
- `backend/app/tasks/report_task.py` — `_build_eeg_content` timeline `t`를 `device_timestamp_ms`(상대 초)로, `emotional_stability` 추가, 마음 지표 0-100 정규화
- `backend/app/services/eeg_metrics.py` — per-window 정규화 함수 (기존 `score_*` 재사용)
- `frontend/src/lib/api/report.ts` — `parseTimeline`에 `emotional_stability` 파싱 추가, `toDisplayScale` 정리
- `frontend/src/lib/report/resolve-narrative.ts` — `emotional_stability` halfSeries 프록시 제거
- `frontend/src/components/reports/NarrativeSections.tsx` — `metricValue` 감정안정도 프록시 제거
- 관련 테스트 갱신

### ❌ Out-of-scope
- HRV(SDNN/RMSSD) 재계산 (SDD-115)
- 그래프 시각 디자인(구간 표시·색상)
- 호흡수/심박수 (이미 정상)

## Acceptance Criteria
- [ ] 세션 `05fbf8f7` 리포트 재생성 시 그래프 시간축이 3.1분 내외 (최대 200초 이내)
- [ ] 감정안정도 그래프가 0~100 범위, 음수 없음
- [ ] 마음 지표(집중도·이완도·감정안정도)가 0~100 스케일로 통일
- [ ] `pytest -k report` 통과, `npx tsc -b --noEmit` + `npm run build` 0 errors

## Dependencies
- SDD-088(EEG 집계), 기존 `eeg_metrics.py` `score_*` 함수

## Risks
- `device_timestamp_ms`가 일부 null일 수 있음 → null 보존 + fallback
- 정규화 상수의 프론트/백엔드 이원화 → 백엔드 단일화로 통일
- `relaxation_index`(0~1)가 정규화 후 0~100이 되면 프론트 `toDisplayScale`과 이중 적용 위험 → 프론트 히스토릭 제거
