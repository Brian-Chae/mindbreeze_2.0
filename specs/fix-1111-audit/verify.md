# fix-1111-audit — verify

## A1 — 검증 시나리오 (구현 전 작성)
1. light 잠금: `lock_context(light=True)`가 `classes`·`class_members`·`users`를 잠그지 않고 `sessions`+`session_participants`만 FOR UPDATE 한다(쿼리 캡처 단위 테스트).
2. leave 경로(`socket_update('leave')`, `expire_due`)가 light 잠금을 쓰고 결과 스냅샷·participation_version 증가가 기존과 같다.
3. 종료와 39명 동시 퇴장: 종료 트랜잭션이 lock_timeout 없이 커밋되고 세션 status=completed, 모든 lease 삭제(PG 있으면 tests/pg, 없으면 호출 순서 단위 테스트).
4. `_participation_socket` leave가 일시 lock_timeout(OperationalError)에서 최대 3회 재시도 후 성공/무시한다.
5. `transition_after_commit`: 알림 단계가 예외여도 종료 응답 성공, audio finalize 1회 재시도, 리포트 enqueue(publish_pipeline)는 종료 커밋 이후에만 호출.
6. 회귀: 기존 test_sdd217_participation(PG) 및 test_class_waiting_room_join_race, test_sdd224_refresh_throttle 통과.
