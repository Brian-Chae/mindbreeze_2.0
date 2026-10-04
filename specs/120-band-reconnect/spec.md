# [SDD-120] 밴드 연결 끊김 감지 + 재연결 (연결 모니터링)

## Goal
BLE 밴드 연결이 물리적으로 끊겼을 때 이를 감지해 UI에 "연결 끊김"을 표시하고, 사용자가 재연결 버튼으로 밴드를 재연결할 수 있게 한다.

## Context
E2E 클래스 테스트 4에서 밴드 연결이 세션 중(02:10:35) 갑자기 끊겼고, 그 후 EEG 데이터가 중단됐다. 원인 조사 결과 **끊김 감지 코드가 dead code**임을 확인했다.

- `bluetoothService.ts:720` `performConnectionLossHandling()` — cleanup + `connectionLostCallback` + `onError`를 호출하는 메서드지만 **호출처가 없다**.
- 주석(`:716`)이 명시: "이전에는 `gattserverdisconnected` 이벤트에서 호출했으나, Provider 내부 책임으로 이동. 재배선 보류(현재는 보존만)."
- `WebBluetoothProvider.connect()` — `gatt.connect()`만 하고 `gattserverdisconnected` 리스너 등록 없음.
- `BluetoothProvider` 인터페이스 — 연결끊김 콜백 등록 메서드 없음.
- 결과: 밴드가 끊겨도 `connected` 플래그가 stale로 남아 UI가 "연결됨"으로 표시되고, 재연결도 불가.

따라서: (1) 끊김 감지 배선 복구, (2) 재연결 경로(재선택 다이얼로그 회피), (3) 예기치 않은 끊김 시에도 raw/feature 데이터 보존.

## Scope

### ✅ In-scope
- `BluetoothProvider` 인터페이스에 `onConnectionLost(callback)` 추가
- `WebBluetoothProvider` — `gattserverdisconnected` 리스너 등록·발화
- `NativeBluetoothProvider` — 인터페이스 충족용 no-op 스텁
- `bluetoothService.ts` — Provider 콜백 → `performConnectionLossHandling()` 배선, `getCachedDeviceId()` 추가
- `useBand.ts` — 예기치 않은 끊김 시 raw/feature flush, 재연결 시 재스캔 회피
- `ClassPlayerPage.tsx` 호스트 LINK BAND 영역 — "연결 끊김" 상태 문구 + "재연결" 버튼

### ❌ Out-of-scope
- 밴드 물리적 끊김 자체 방지(BLE은 끊김이 정상 이벤트 — 감지·복구만 담당)
- Capacitor 네이티브 BLE(MB 2.0 웹 빌드 제외)
- Gemini STT 타임아웃 개선(별도 이슈)
- Raw 로컬 우선 저장 재설계(이미 SDD-117로 IndexedDB 큐 + 종료/재연결 시 flush 구현됨)

## Acceptance Criteria
- [ ] 밴드가 끊기면 `connectionState`가 `disconnected`로 전환되고 UI에 "연결 끊김"이 표시된다
- [ ] 끊김 상태에서 "재연결" 버튼 클릭 시 **재선택 다이얼로그 없이** 같은 디바이스로 재연결된다
- [ ] 예기치 않은 끊김 시에도 in-memory raw 버퍼가 flush되고 pending 큐가 유지된다
- [ ] 재연결 후 window_index(secondOffset)가 0으로 재시작하지 않고 cursor에서 복원된다 (SDD-116 유지)
- [ ] `npm run build` 0 errors
- [ ] `npx vitest run` 기존 통과 유지

## Dependencies
- SDD-116(window_index 경과시간 기반 — 재연결 시 sequence 연속성)
- SDD-117(raw EEG→S3 + IndexedDB 큐 — flush 경로)
- SDD-110/112(join 단일화 + WS 재전송)

## Risks
- **Web Bluetooth 재연결은 `gattserverdisconnected` 후 같은 `BluetoothDevice.gatt.connect()` 재호출로 가능** — 디바이스 객체는 Provider가 유지. 단, OS가 디바이스를 완전히 제거한 경우 재연결 실패 → 이 경우 `connect()`가 catch로 `error` 상태 전환하고 사용자가 재스캔.
- **재연결 중복 실행**: 연타 시 `connect()`가 동시 실행되면 GATT 충돌. `connectionState === 'connecting'` 가드로 1회만 허용.
