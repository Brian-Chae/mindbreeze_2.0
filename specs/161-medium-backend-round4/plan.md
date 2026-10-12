# SDD-161 — 구현 계획

- 권한/인가: onboarding role 가드, 멤버십 role, verified 검사, 관리자 membership, delete cascade, 세션 PII, 채팅 위조.
- 동시성: 입장/정원/채팅방 race → savepoint+IntegrityError, FOR UPDATE 직렬화.
- 계약/비동기: WS version·snapshot 키, 재발송 계약, outbox 단일 소비, 재생성 승인 보존, 검토 409, expected_count 상한.

## 테스트

- test_mb2_auth4_mid_fixes.py 15건 + test_func_fixes_4th.py 16건.
