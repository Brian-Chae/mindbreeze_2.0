# [SDD-100] open 상태 방치 세션 자동 취소 (스테일 클래스 정리)

## Goal
상담사가 열어 둔 채 방치된 open 상태 세션을 일정 시간 경과 후 자동으로 `cancelled` 처리해, 회원 화면 "즉시 클래스" 목록에 영구히 노출되는 것을 막는다.

## Context
- **실측 사례**: `MXFU8Y` 세션이 2026-09-21 open 이후 11일간 시작·종료 없이 방치되어 회원 화면에 계속 노출됨(host·org는 유효하므로 참조 무결성 고아는 아니나 "운영상 고아").
- **원인**: 코드에 open 상태 세션의 자동 만료·정리 로직이 없다. 현재 DB 전체에서 open 방치 세션은 이 1건.
- **기존 패턴 재사용**: Celery beat 5분 주기 스윕(`sweep-session-reminders`, `sweep-stale-reports`)과 동일 구조. 상태 전이는 `transition_status('cancel')` 재사용(`TRANSITIONS["cancel"]`이 이미 `open→cancelled` 허용).

## Scope

### ✅ In-scope
- `backend/app/services/session_service.py` — `sweep_stale_open_sessions(db, max_age_hours=24)` 추가
  - `status == 'open'` + `is_template == False` + `opened_at <= now - max_age_hours` 인 세션을 `cancelled`로 전이
  - 전이는 `transition_status(session_id, host_id, 'cancel', db)` 재사용(알림·이벤트·state_version 일관성)
  - 개별 세션 실패는 try/except 로 격리(한 건 실패가 전체 스윕 중단시키지 않음)
- `backend/app/tasks/session_task.py` 신규 — `sweep_stale_open_sessions_task` (Celery 진입점)
- `backend/app/core/celery_app.py` — `include`에 `app.tasks.session_task` 추가 + `beat_schedule`에 `sweep-stale-open-sessions`(300초) 등록
- `backend/tests/test_stale_open_session.py` 신규 — 만료/미만료/템플릿 제외/전이 일관성 테스트

### ❌ Out-of-scope
- 기존 방치 세션(`MXFU8Y`)의 즉시 수동 정리는 별도(자동 스윕이 배포 후 첫 실행에서 처리할 수도 있음 — 24h 경과했으므로).
- open 외 상태(ready/scheduled/in_progress 등)의 자동 정리.
- 만료 시간의 DB/설정 저장(우선 코드 상수 24h, 필요 시 settings로 확장).

## Acceptance Criteria
- [ ] open 상태 + 24h 경과 세션이 스윕에서 `cancelled`로 전이됨
- [ ] open 상태 + 24h 미경과 세션은 유지됨
- [ ] `is_template=True` 세션은 스윕 대상에서 제외됨
- [ ] `transition_status('cancel')` 재사용으로 참가자 `session_cancelled` 알림·`state_version` 증가가 동작
- [ ] `backend` `pytest` 전체 통과 (신규 테스트 포함 무회귀)
- [ ] `alembic` 마이그레이션 불필요(컬럼 변경 없음)

## Dependencies
- 없음. 기존 `transition_status`, Celery beat 인프라 재사용.

## Risks
- **전이 격리**: `transition_status`가 host 검증(`_get_session_as_host`)을 거치므로 host가 삭제된 세션은 404로 실패할 수 있음 → 개별 try/except 격리로 스윕 중단 방지.
- **알림 과발송**: 자동 취소 시 참가자에게 `session_cancelled` 알림이 감 — 의도된 동작(방이 닫혔음을 고지).
- **beat 스케줄 등록 누락**: `include`에 태스크 모듈 미등록 시 태스크가 로드되지 않음 → include + beat_schedule 양쪽 모두 등록.
