# [SDD-129] — Verification

## Test Scenarios
### TS1: guest_state 계약
- by-code/state 응답에 `guest_state` 필드 존재. **Expected:** waiting/meditation/complete 값이 status에 따라 정확.

### TS2: 라벨 단일화
- 모든 화면에서 상태 표기가 '진행 중'/'완료'/'취소'로 동일. **Expected:** 빈칸·영문 없음.

### TS3: 상담사 상세 WS
- 상담사 상세에서 세션 상태 전이. **Expected:** 즉시 반영(5초 폴링 없이).

### TS4: 회원 화면 전환 WS
- 상담사가 시작/종료. **Expected:** 회원이 즉시 명상/완료 화면으로 전환.

### TS5: 빌드·테스트
- `pytest` + `npm run build`. **Expected:** 0 errors.
