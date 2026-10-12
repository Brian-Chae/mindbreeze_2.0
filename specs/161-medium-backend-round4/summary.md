# SDD-161 — 중(중) 백엔드 19건 요약

## 구현 결과

19건 완료.

| 영역 | 변경 |
|---|---|
| 권한/인가 | 온보딩 role, 멤버십 role, verified, 관리자 membership, delete cascade, 세션 PII, 채팅 위조 |
| 동시성 | 입장/정원/채팅방 race 멱등 + row lock |
| 계약/비동기 | WS version·snapshot, 재발송 계약, outbox 단일, 재생성 승인, 검토 409, expected_count 상한 |

## 검증

- 백엔드 `pytest -q` **1133 passed / 12 skipped / 0 failed**
