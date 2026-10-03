# [SDD-107] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 토큰 refresh 시 소켓 유지 (auth 갱신)
1. `getSessionLiveSocket("old-token")`으로 소켓 생성.
2. `getSessionLiveSocket("new-token")` 재호출.
3. 기존 소켓 객체가 `disconnect()`되지 않고 동일 객체가 반환되며 `socket.auth`가 새 토큰으로 갱신됨.
- **Expected:** `sessionLiveSocket` 동일 객체 유지, `socket.auth.token === "new-token"`, disconnect 호출 없음.

### TS2: connect_error → 토큰 재발급 → 재연결
1. 소켓 `connect_error`를 `"token_expired"` 사유로 발화.
2. `refreshAccessToken()`이 호출되고, 성공 시 `socket.auth` 갱신 + `connect()` 재시도.
3. 같은 사유로 2회 연속 실패 시 무한 루프 없이 중단(1회 가드).
- **Expected:** 재발급 1회 후 재시도. 연속 실패 시 재시도 중단 + UI 상태 노출.

### TS3: WS 핸들러 비블로킹
1. feature 저장·join 해석·시그널 해석 경로가 `asyncio.to_thread`를 경유.
2. 동기 DB 호출이 이벤트 루프에서 직접 실행되지 않음(코드 정적 확인 + 기존 pytest 통과).
- **Expected:** 핸들러가 `await asyncio.to_thread(...)` 사용, 이벤트 루프 블로킹 제거.

### TS4: 신호 버퍼 유실·중복 없음
1. 단절 중 같은 유형 신호를 3회 클릭 → 버퍼에 1건만 유지.
2. 리렌더(cleanup) 후에도 버퍼가 유지됨.
3. 재join 확정 시 최신 1건만 emit.
- **Expected:** 유형별 최신 1건, cleanup에도 유실 없음, 재join 시 1회 emit.

## Edge Cases
- [ ] 토큰이 `null`(게스트) ↔ jwt(회원) 혼재 시 소켓이 서로 끊기지 않음
- [ ] `refreshAccessToken()` 실패 시 재시도 중단 + 사용자 안내(침묵 방지)
- [ ] connect 거부 사유가 토큰 외(예: 세션 미개방)일 때 재발급 미동작
- [ ] 신호 버퍼에 서로 다른 유형이 섞였을 때 유형별 1건씩 보존

## Security Review
- [ ] connect 거부 reason이 내부 정보(세션 ID 등)를 노출하지 않음
- [ ] 토큰 재발급이 인가된 사용자에게만 수행(서버 거부 사유 기반)
- [ ] cors 화이트리스트가 `main.py`와 일치(와일드카드 제거)
