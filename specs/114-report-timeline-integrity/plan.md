# [SDD-114] — Implementation Plan

**Goal:** 리포트 타임라인 시간축·감정안정도·정규화 정합

**Architecture:** `report_task._build_eeg_content` → timeline dict → 프론트 `report.ts parseTimeline` → `resolve-narrative.ts` → `NarrativeSections.tsx`

**Tech Stack:** FastAPI(Python) + React/TS

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Modify | `backend/app/tasks/report_task.py` | timeline `t`/`emotional_stability`/정규화 |
| Modify | `backend/app/services/eeg_metrics.py` | per-window 정규화 함수 |
| Modify | `frontend/src/lib/api/report.ts` | `parseTimeline` emotional_stability 파싱, `toDisplayScale` 정리 |
| Modify | `frontend/src/lib/report/resolve-narrative.ts` | emotional_stability halfSeries |
| Modify | `frontend/src/components/reports/NarrativeSections.tsx` | `metricValue` |
| Modify | `backend/tests/test_sdd088_open_flow.py` | timeline `t` 검증 갱신 |

## Tasks

### Task 1: X축 `device_timestamp_ms`
**Objective:** timeline `t`를 `window_index`(10Hz 카운터) 대신 `device_timestamp_ms`(상대 초)로.
**Files:** report_task.py
- 현재(uncommitted) `base_index`(window_index 최소값) 재조정 로직을 `device_timestamp_ms` 기준으로 교체.
- `t = (w.device_timestamp_ms - base_ts) / 1000`, null이면 기존 fallback.
**Estimate:** 10min

### Task 2: 감정안정도 타임라인 추가
**Objective:** timeline에 `emotional_stability` 추가, 프론트 프록시(`100-stress`) 제거.
**Files:** report_task.py, report.ts, resolve-narrative.ts, NarrativeSections.tsx
- backend: timeline dict에 `"emotional_stability": w.emotional_stability` 추가.
- frontend: `parseTimeline`이 `emotional_stability` 파싱, `metricValue`/`halfSeries`가 `point.emotional_stability` 직접 사용.
**Estimate:** 15min

### Task 3: 마음 지표 per-window 정규화
**Objective:** focus/relaxation/stress/emotional_stability를 0-100으로 정규화.
**Files:** eeg_metrics.py, report_task.py, report.ts
- backend: `eeg_metrics.py`에 per-window 정규화 함수 추가(기존 `score_*` 재사용), `report_task.py` timeline이 정규화된 0-100 값 사용.
- frontend: `toDisplayScale`의 0~1×100 히스토릭 제거(백엔드가 0-100 보장).
**Estimate:** 20min

## Testing Strategy
- `cd backend && source venv/bin/activate && pytest -k report`
- `cd frontend && npx tsc -b --noEmit && npm run build`
