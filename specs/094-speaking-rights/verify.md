# [SDD-094] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 온라인 1:1 상시 송출
1. online + one_on_one 세션, 회원 토큰 호출.
- **Expected:** `can_publish==true` (speaking 무관).

### TS2: 온라인 그룹 기본 뮤트
1. online + group(max 20) 세션, 회원 토큰 호출.
- **Expected:** `can_publish==false`.

### TS3: 손들기 → 발언권 부여 → 송출
1. 회원 `POST raise-hand` → `raise_hand==true`.
2. 상담사 `POST speaking {granted:true}` → `speaking==true`, `raise_hand==false`.
3. 회원 토큰 재호출.
- **Expected:** 3단계에서 `can_publish==true`.

### TS4: 발언권 해제 → 뮤트
1. `POST speaking {granted:false}` → 회원 토큰 재호출.
- **Expected:** `can_publish==false`.

### TS5: WS 이벤트
1. 발언권 부여 시 `speaking_changed` 이벤트가 호스트 룸 + 본인 룸에 발행.
- **Expected:** 이벤트 payload에 `participant_id`·`speaking` 포함.

### TS6: 빌드/테스트
- `pytest` 통과, `npm run build` 0 errors, `npx vitest run` 통과.

## Edge Cases
- [ ] 오프라인/온라인 >20 그룹에서는 발언권 부여해도 `can_publish==false` 유지.
- [ ] 게스트도 손들기/발언권 흐름 동작(participant_id 기반).
- [ ] 발언권 부여 후 회원이 재연결하기 전까지 상담사가 해제하면 최종 상태는 false.
- [ ] speaking 상태는 세션 재접속(pause/resume) 시에도 유지(DB 컬럼).

## Security Review
- [ ] `raise-hand`/`speaking`은 해당 세션 참여자/호스트 권한 검증 후에만 변경 가능.
- [ ] `speaking` 부여/해제는 호스트(상담사)만 가능 — 참여자 권한 확인.
- [ ] `can_publish`는 서버 측 `speaking` 컬럼으로 결정 — 클라이언트 조작 불가.
