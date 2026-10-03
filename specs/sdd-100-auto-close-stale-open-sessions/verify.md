# [SDD-100] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: open + 24h 경과 세션은 cancelled 로 전이된다
1. `opened_at = now - 25h`, `status = open` 인 세션 생성
2. `sweep_stale_open_sessions(db)` 호출
- **Expected:** 해당 세션 `status == 'cancelled'`, `state_version` 증가

### TS2: open + 24h 미경과 세션은 유지된다
1. `opened_at = now - 1h`, `status = open` 세션
- **Expected:** `status == 'open'` 유지, 스윕 미대상

### TS3: is_template 세션은 제외된다
1. `is_template=True`, open, 25h 경과 세션
- **Expected:** `status` 불변, 스윕 대상에서 제외

### TS4: open 아닌 상태는 제외된다
1. `status=ready`/`scheduled`/`in_progress` 세션(25h 경과)
- **Expected:** 전이 없음

### TS5: 참가자 session_cancelled 알림이 발화된다
1. 참가자 있는 open 세션을 만료 스윕으로 cancel
- **Expected:** `session_cancelled` 이벤트/알림 생성 (transition_status 재사용으로 검증)

### TS6: host 삭제 등 개별 실패가 전체 스윕을 중단시키지 않는다
1. 유효 세션 + host 없는 세션 혼재
- **Expected:** 유효 세션은 정상 전이, 실패 세션은 건너뛰고 스윕 완료

### TS7: Celery 태스크·beat 등록 검증
1. `celery_app.conf.beat_schedule` 에 `sweep-stale-open-sessions` 존재
2. `include` 에 `app.tasks.session_task` 존재
- **Expected:** 둘 다 등록됨, 태스크 name `tasks.sweep_stale_open_sessions`

## Edge Cases
- [ ] `opened_at` 이 None 인 open 세션(비정상) — 만료 판정 기준 없음 → 안전하게 건너뜀(또는 created_at fallback)
- [ ] 만료 경계(정확히 24h) — `<=` 비교로 포함 여부 명확화
- [ ] 동시성: 스윕 중 사용자가 직접 cancel/start → `transition_status` 가 상태 검증하므로 중복 전이는 400, try/except 로 격리

## Security Review
- [ ] 스윕은 시스템 내부 호출(호스트 검증은 자기 host_id 전달로 통과) — 외부 노출 엔드포인트 없음
- [ ] 알림은 기존 `_notify_participants_event` 채널 재사용(신규 노출 없음)
