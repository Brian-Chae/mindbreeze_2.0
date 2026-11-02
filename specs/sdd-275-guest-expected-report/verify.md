# SDD-275 Verify (구현 전 QA 체크리스트)

| ID | 시나리오 | 기대 | 시험 |
|---|---|---|---|
| V1 | 웹 측정 시작 후 feature 가 쌓이면 outbox 가 IndexedDB 에 영속 | `IdbOutboxStore.listScopes()` 에 `entry:<pid>` scope 존재 | tests/sdd275 |
| V2 | indexedDB 없는 환경 | 메모리 outbox 로 폴백, 예외 없음 | tests/sdd275 |
| V3 | 게스트 scope outbox(pending 3) + 입장 자격 → 앱 셸 훅 | PUT feature=3 final=false, `X-Entry-Credential` 인증 | tests/sdd275 |
| V4 | 완료 마커(pending 0, completedCount=acked) | PUT final=true | tests/sdd275 |
| V5 | 허브에 raw 총량 전달 | PUT 본문에 raw{eeg,ppg,acc}(0 포함) | tests/sdd275 |
| V6 | raw 총량 계산: sealed_chunks pending/dead_letter + ack_receipts, superseded 제외, 신호별 | 합계 일치 | tests/sdd275 |
| V7 | 입장 자격 영속 → sessionStorage 비움(탭 종료 모사) → 훅 재마운트 | 영속 자격으로 PUT 성공(final 포함) | tests/sdd275 |
| V8 | 자격 만료(expiresAt 과거) | PUT 안 함, 값 보존 | tests/sdd275 |
| V9 | 다른 참가자 레코드의 자격 | 사용 안 함 | tests/sdd275 |
| V10 | 회원 `user:` scope | 기존대로 JWT(skipAuth false) | tests/sdd275 |
| V11 | 기존 시험 무회귀 | sdd264/266/267/260/273/274/sdd246-web 통과 | vitest |
| V12 | tsc -b, eslint | 오류 0 | CLI |
| V13 | 서버·네이티브 코드 diff 0 | `git diff --stat` 에 backend/ios/android 없음 | git |
