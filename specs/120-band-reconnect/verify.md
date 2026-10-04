# [SDD-120] — Verification (Pre-Implementation)

## Test Scenarios

### TS1: 끊김 감지 → disconnected 상태 전환
1. 밴드 연결 후 물리적으로 끊는다(밴드 전원 off / 범위 이탈).
2. `WebBluetoothProvider`의 `gattserverdisconnected`가 발화 → `performConnectionLossHandling()` → `useBand.onConnectionLost()`.
3. UI의 `connectionState`가 `disconnected`로 전환.
- **Expected:** UI 상태 문구가 "연결이 끊어졌습니다"로 바뀌고, 버튼이 "재연결"로 바뀐다.

### TS2: 재연결 (재선택 다이얼로그 없음)
1. TS1 상태에서 "재연결" 버튼 클릭.
2. `useBand.connect()` → `getCachedDeviceId()`가 이전 디바이스 ID 반환 → `scan()`(디바이스 선택 다이얼로그) 건너뜀.
3. `WebBluetoothProvider.connect()`가 보존된 `this.device`로 `gatt.connect()` 재호출.
- **Expected:** 디바이스 선택 팝업 **없이** 재연결되고 `connectionState`가 `connected`로 복귀.

### TS3: 재연결 후 sequence 연속성
1. 끊김 직전 secondOffset(또는 window_index)가 N이었다면.
2. 재연결 후 `connect()`가 `loadStreamCursor()`로 cursor를 복원해 `secondOffsetRef.current = nextSequence`.
- **Expected:** window_index가 0으로 재시작하지 않고 N+1부터 이어진다 (SDD-116 유지).

### TS4: 예기치 않은 끊김 시 raw/feature 보존
1. raw 버퍼에 250샘플 미만(1초 미만)이 남은 상태에서 끊김 발생.
2. `onConnectionLost` 핸들러가 `flushRawChunk()` + `drainPendingQueue()` + `rawDrainRef(15s)` 실행.
- **Expected:** in-memory raw 버퍼가 flush되고, IndexedDB의 pending 큐는 유지되어 재연결/재접속 시 재전송된다.

### TS5: 수동 연결 해제는 캐시 초기화 (재스캔)
1. 연결된 상태에서 "연결 해제" 클릭 → `disconnect()` → `forceCleanup()`.
2. `lastDeviceId`/`scannedDevices`가 null/empty로 초기화.
- **Expected:** 다음 "밴드 연결" 클릭 시 정상적으로 디바이스 선택 다이얼로그가 뜬다.

### TS6: build + 기존 테스트 회귀
- **Expected:** `npm run build` 0 errors, `npx vitest run` 기존 통과 유지.

## Edge Cases
- [ ] 연타 시 `connect()` 중복 실행 → `connectionState === 'connecting'` 가드로 1회만 허용
- [ ] OS가 디바이스를 완전히 제거해 재연결 실패 → `connect()` catch가 `error` 상태 전환 + 재스캔 유도
- [ ] `gattserverdisconnected`가 `disconnect()`(수동) 중에도 발화 → 콜백이 `forceCleanup` 이후 실행돼도 `connectionState`는 이미 `disconnected`라 무해
- [ ] mock EEG(`isMock`) 경로 — `gattserverdisconnected` 미발화, 재연결 로직 미적용

## Security Review
- [ ] 신규 코드는 클라이언트(BLE) 전용 — 서버 API/자격증명 변경 없음
- [ ] `gattserverdisconnected` 리스너는 디바이스 객체 생명주기와 함께 정리되어 리스너 누수 없음
