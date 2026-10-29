# Verify (구현 전 QA 체크리스트)

| # | 시나리오 | 기대 | 검증 |
|---|---|---|---|
| V1 | ack_raw 가 S3 검증을 호출하는 시점 | 그 시점에 해당 DB 세션이 트랜잭션 밖(커넥션 반환됨), 검증 후 결과가 정상 반영(uploaded/failed·file_count) | pytest (verify 함수 안에서 `db.in_transaction()` 확인) |
| V2 | artifacts ack 동일 | 동일 | pytest |
| V3 | ack 검증 결과 반영 회귀 | 기존 sdd244 ack 테스트 전부 통과 | pytest tests/test_sdd244_* |
| V4 | presign 전용 S3 client | 같은 설정에서 재사용(생성 1회), 설정 변경 시 재생성, timeout 설정 적용 | pytest (boto3.client 패치 카운트) |
| V5 | slot 한도 | 동시 6건 통과, 7번째는 1.5s 후 429 + Retry-After, 해제 후 재통과 | pytest |
| V6 | **풀 고갈 재현**: presign/ack 가 느린 S3(sleep)에 걸린 동시 N(>풀) 요청 중 일반 엔드포인트(/api/v1/sessions 등) 응답 유지 | 일반 요청 200, 일부 archive 요청 429 | pytest (작은 풀 엔진 + 스레드) |
| V7 | outbox poll 이 풀 고갈 중에도 이벤트 루프를 막지 않음 | DB 접근 대기 중에도 다른 코루틴(sleep tick) 진행 | pytest (asyncio, 지연 SessionLocal) |
| V8 | outbox 기존 동작 | 전달 성공/실패 재시도/행 커밋 회귀 테스트 통과 | pytest test_notification_outbox·test_mb2_low_fixes_7th |
| V9 | postgres 연결 옵션 | `build_engine_kwargs(postgresql…)` 에 lock/statement timeout 포함, sqlite 는 없음, 0 이면 생략 | pytest |
| V10 | iOS 중복 presign | 같은 pending 항목에 pump 를 연속 3회 호출해도 presign POST 1건, 동시 상한 2 초과 없음 | swift test (FakeHTTP) |
| V11 | 복귀 시 연결 표시 | net down + 브라우저 online → 라벨 '서버 재연결 중', 카드 문구에 밴드 유지 안내; 브라우저 offline → 기존 '연결 끊김' | vitest |
| V12 | 복귀 재연결 | visibilitychange(visible) 시 retryNetwork 호출·downSince 리셋 | vitest |
| V13 | 전체 회귀 | pytest·vitest·tsc·swift test green, CI 통과 | CI |
