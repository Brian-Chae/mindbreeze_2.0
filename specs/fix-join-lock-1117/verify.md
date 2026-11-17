# fix-join-lock-1117 — verify (구현 전 체크리스트)
- [ ] socket_update join/heartbeat/leave, snapshot 이 lock_context(light=True) 사용
- [ ] light 잠금이 FOR NO KEY UPDATE(key_share) 이며 users/classes/members 를 잠그지 않음; 비light 는 기존 FOR UPDATE
- [ ] join 이 DeadlockDetected/LockNotAvailable 시 최대 3회 재시도, 그 외 예외는 즉시 전파
- [ ] 최근 15초 내 feature 가 있으면 band_connected False→True 투영, 없으면 저장값 유지, 조회 실패 시 저장값 유지
- [ ] 기존 fix1111·sdd308·live-v2 테스트 통과
