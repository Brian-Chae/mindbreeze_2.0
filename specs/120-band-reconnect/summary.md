# [SDD-120] — Summary

## What Was Built
| File | Description |
|------|-------------|
| `frontend/src/lib/eeg/bluetooth/BluetoothProvider.ts` | 인터페이스에 `onConnectionLost(callback)` 추가 |
| `frontend/src/lib/eeg/bluetooth/WebBluetoothProvider.ts` | `gattserverdisconnected` 리스너 등록(remove-before-add로 중복 방지) + `onConnectionLost` 콜백 저장/발화 |
| `frontend/src/lib/eeg/bluetooth/NativeBluetoothProvider.ts` | no-op `onConnectionLost` 스텁 (인터페이스 충족) |
| `frontend/src/lib/eeg/bluetoothService.ts` | `connect()`에서 Provider 콜백 → `performConnectionLossHandling()` 배선, `lastDeviceId`/`getCachedDeviceId()` 추가, dead code 주석 갱신 |
| `frontend/src/hooks/useBand.ts` | `onConnectionLost`에 raw flush + pending drain 추가, `connect()` 재연결 시 캐시 디바이스 재사용(재스캔 회피) |
| `frontend/src/pages/sessions/ClassPlayerPage.tsx` | 호스트 LINK BAND 영역에 `disconnected` 상태 문구 + "재연결" 버튼 |

## Root Cause (원인 규명)
`bluetoothService.ts:720` `performConnectionLossHandling()`이 dead code였다 — `gattserverdisconnected` 리스너가 Provider 추상화 리팩토링 때 제거된 뒤 재배선되지 않아, 밴드가 물리적으로 끊겨도 앱이 감지하지 못하고 `connected` 플래그가 stale로 남았다. 이로 인해 UI가 "연결됨"으로 표시되고 재연결도 불가했다.

## Test Results
- ✅ `npm run build` — 0 errors
- ✅ `npx vitest run` — 281 passed (기존 9개 `.test.cjs` "No test suite found"는 vitest 미대상, 사전 존재)
- ⚠️ TS1~TS5(실기기 BLE 끊김/재연결)는 **이 환경에 실제 LINK BAND가 없어 런타임 검증 불가** — 코드 경로·타입·빌드로만 검증.

## Debugging Journey
- 재연결 시 `WebBluetoothProvider.connect()`가 매번 `gattserverdisconnected` 리스너를 중복 등록하는 문제 → `handleDisconnected` 명명 핸들러 + remove-before-add로 해결.

## Notes for Reviewer
- 실기기 왕복(끊김→재연결→sequence 연속성)은 Brian의 실제 LINK BAND로 검증 필요.
- Raw 로컬 우선 저장은 SDD-117에서 이미 구현됨(IndexedDB 큐 + 종료/끊김 시 flush). 본 SDD는 예기치 않은 끊김 경로에도 flush를 추가해 보완.
