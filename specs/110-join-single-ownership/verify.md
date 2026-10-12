# [SDD-110] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 재연결 시 join 1회
1. 소켓 connect → 4개 훅이 `joinSessionLive` 호출.
2. `socket.emit('join', ...)`이 1회만 호출된다(나머지 3개는 dedup skip).
- *검증*: vitest에서 `emit('join')` 호출 횟수 spy로 확인.

### TS2: disconnect 후 재연결 시 join 재발동
1. disconnect 이벤트 → `liveCurrentSession` 클리어.
2. 재connect → 첫 `joinSessionLive`가 다시 emit.
- *검증*: disconnect 후 connect에서 join emit이 1회 발생.

### TS3: late-subscriber snapshot 재배달
1. `useBand`가 먼저 join(스냅샷 캐시 생성).
2. 이후 `useSessionLiveSocket`이 `subscribeSessionLiveJoined` 구독.
3. 캐시된 snapshot이 즉시 1회 재배달된다.
- *검증*: vitest에서 구독 시점에 캐시 핸들러 호출 확인.

### TS4: leave 후 캐시/상태 클리어
1. `leaveSessionLive` → `liveCurrentSession`/`liveSnapshotCache` null.
2. 다음 세션 join이 정상 emit.
- *검증*: leave 후 캐시가 비어 후발 구독자가 stale snapshot을 받지 않음.
