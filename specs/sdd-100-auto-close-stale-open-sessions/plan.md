# [SDD-100] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현 진행. 백엔드 단일 변경(컬럼 없음, 마이그레이션 불필요).

**Goal:** open 상태로 24h 방치된 세션을 Celery beat 스윕이 자동 `cancelled` 처리.

**Architecture:**
```
Celery beat (300초)
  └→ tasks.sweep_stale_open_sessions
       └→ session_service.sweep_stale_open_sessions(db, max_age_hours=24)
            └→ transition_status(session_id, host_id, 'cancel', db)  (open→cancelled)
```

## Files to Change

| Action | File | Description |
|--------|------|-------------|
| Edit | `backend/app/services/session_service.py` | `sweep_stale_open_sessions` 함수 추가 |
| Create | `backend/app/tasks/session_task.py` | `sweep_stale_open_sessions_task` Celery 진입점 |
| Edit | `backend/app/core/celery_app.py` | include + beat_schedule 등록 |
| Create | `backend/tests/test_stale_open_session.py` | 만료/미만료/템플릿/전이 테스트 |

## Tasks

### Task 1: 서비스 스윕 함수 추가
**Objective:** `sweep_stale_open_sessions(db, max_age_hours=24)` — open+24h 경과 세션을 cancel 전이, 개별 격리
**Files:** `backend/app/services/session_service.py`
**Estimate:** 15min

### Task 2: Celery 태스크 + beat 등록
**Objective:** `session_task.py` 신규 + celery_app include/beat_schedule 등록
**Files:** `backend/app/tasks/session_task.py`, `backend/app/core/celery_app.py`
**Estimate:** 10min

### Task 3: 테스트 작성
**Objective:** 만료/미만료/템플릿 제외/취소 전이·알림 검증
**Files:** `backend/tests/test_stale_open_session.py`
**Estimate:** 15min

## Testing Strategy
- `cd backend && venv/bin/python -m pytest tests/test_stale_open_session.py -q` — 신규 테스트
- `cd backend && venv/bin/python -m pytest -q` — 전체 무회귀
