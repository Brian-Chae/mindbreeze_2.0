# [SDD-112] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: transports websocket 단일화
1. `getSessionLiveSocket` 생성 시 `transports: ['websocket']`.
- *검증*: socket.ts 값 확인 + vitest/build 통과.

### TS2: 재전송 in-flight 가드
1. `retransmitPending` 실행 중 두 번째 호출 → 두 번째는 즉시 return(중복 post 없음).
- *검증*: vitest spy로 `postSessionFeatures` 1회 호출 확인(동시 2회 호출 시).

### TS3: 배치 상한
1. pending 큐 150건 → 한 번의 retransmit이 60건만 post, 나머지는 큐에 잔존.
- *검증*: vitest로 slice 상한·잔존 확인.

### TS4: drain/ACK 회귀 없음
1. `drainPendingQueue`·`handleFeatureAck` 정상 동작.
- *검증*: 기존 vitest(255) 통과.
