# fix-1111-audit — plan

## A1 — 수업 종료 lock timeout 500 (+ A9 리포트 partial)

### 원인 (코드 추적)
- 소켓 퇴장·재접속·heartbeat 마다 `class_participation_service.socket_update` → `lock_context` → `lock_class_session`이 강사 `users`(FOR NO KEY UPDATE) → `classes` → `class_members` 전체 → `sessions` 전체 → `session_participants` 전체를 FOR UPDATE로 잠근다.
- 같은 호출 뒤 `session_service._notify_participant_changed`가 `lock_context`를 한 번 더 호출해 같은 잠금을 다시 쥔다(퇴장 1건 = 클래스 전체 잠금 2회).
- 종료(`transition_tx`)도 동일 잠금 체인을 쓴다. 39명이 동시에 퇴장하면 종료 트랜잭션이 이 큐 뒤에서 대기하다 `db_lock_timeout_ms=10000`을 넘겨 `lock_timeout` → 500. `users` 행 잠금 52건과 일치. 종료 후처리(`transition_after_commit`)의 `_notify_participant_changed`도 같은 잠금을 다시 요구해, 실패하면 응답이 500이 되고 audio finalize(outbox 적재)가 건너뛰어질 수 있다 → 리포트 partial 위험(A9).
- 퇴장 저장 실패 21건: leave 실패는 로그 후 무시(TTL 재정리)만 있고 재시도가 없었다.

### 수정 범위
1. `lock_context(..., light=True)` 신설: 퇴장·만료·종료 후 알림용으로 `sessions`(해당 회차 1행) → `session_participants` 순서만 잠근다. 종료 트랜잭션은 users→class→members→sessions→participants 순서이므로 light 경로는 항상 그 부분 순서(sessions→participants)여서 교착이 생기지 않는다.
2. `socket_update(action='leave')`, `expire_due`, `_notify_participant_changed(..., light=True)`(퇴장·종료 후 호출부)에 light 적용. join/heartbeat는 인증·자격 검증이 있어 기존 잠금 유지.
3. `_participation_socket` leave: lock_timeout 등 일시 오류는 짧은 백오프로 최대 3회 재시도, 끝내 실패하면 기존대로 TTL 재정리.
4. `transition_after_commit`: 종료 후처리(알림·finalize)가 lock timeout으로 실패해도 응답은 성공(상태는 이미 completed 커밋). audio finalize는 실패 시 rollback 후 1회 재시도(멱등: outbox upsert). 리포트 enqueue는 종료 커밋 이후에만 일어난다는 계약을 테스트로 고정.

### 남은 위험
- 운영 11/11 회차 995002da의 partial 리포트는 코드 수정으로 복구되지 않는다 → 재생성 필요(대표 승인 후 별도).
- `session_records` lock timeout 일부는 종료 후 finalize와 녹음 상태 갱신 경합일 수 있어 재시도로 흡수하되, 실기기 부하 테스트로 재확인 필요.
