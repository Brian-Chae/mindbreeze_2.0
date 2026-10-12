# [SDD-126] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 게스트 멱등 — 같은 토큰 재참여 시 유령 방지
1. 게스트로 클래스 참여 → `participant_token` 수신.
2. 같은 `participant_token`으로 재참여 호출.
- **Expected:** 참여자 행이 1개 유지(신규 생성 없음). `participant_id` 동일.

### TS2: 게스트 무효 토큰 → 신규 생성 폴백
1. 잘못된 `participant_token`으로 참여.
- **Expected:** 403 없이 신규 게스트 행 생성(기존 동작 유지).

### TS3: 대기열 회원 입장 시 관제 반영
1. 정원 초과로 회원이 대기열(`is_waitlisted=True`)로 진입.
2. 코드로 자발 입장.
- **Expected:** `is_waitlisted=False`, `waitlist_position=None`, 관제·좌석·인원 집계에 포함.

### TS4: 로그인 회원 멱등(기존 동작 유지)
1. 로그인 회원 재참여.
- **Expected:** 기존 행 재사용, 새 행 없음.

### TS5: 빌드·테스트 통과
1. `cd backend && pytest`
2. `cd frontend && npm run build`
- **Expected:** 0 errors.

## Edge Cases
- [ ] 게스트 토큰의 `sub`가 다른 세션 참여자를 가리키면? → 세션 불일치 시 신규 생성(필터에 session_id 포함).
- [ ] 대기열 해제 후 `waitlist_position`이 남은 대기열 재정렬? → 이번 범위는 자발 입장 해제만, `_promote_waitlist`는 제외.
- [ ] host 상담사 참여(no-op)는 토큰·대기열과 무관하게 유지.

## Security Review
- [ ] `_decode`는 유효 JWT·타입 검증을 거치므로 위조 토큰으로 타인 행 탈취 불가.
- [ ] 게스트 토큰 재사용은 같은 세션(session_id 필터) 내로 한정.
