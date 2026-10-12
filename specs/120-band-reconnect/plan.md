# [SDD-120] — Implementation Plan

> **For Hermes:** 7-Stage SDD — Stage ③ Verify 작성 후 구현. Brian "즉시 실행" 원칙에 따라 Stage ①~⑥ 연속 진행.

**Goal:** 밴드 끊김 감지 배선 + 재연결 + 데이터 보존.

**Architecture:**
```
BLE 밴드 ──(gattserverdisconnected)──▶ WebBluetoothProvider.onConnectionLost()
                                            │
                                            ▼
                              bluetoothService.performConnectionLossHandling()
                                            │ cleanup + connectionLostCallback
                                            ▼
                              useBand.onConnectionLost() ── setConnectionState('disconnected')
                                                            + flushRawChunk + drainPending
                              ──(UI "연결 끊김" + "재연결" 버튼)──▶ band.connect()
                                            │ getCachedDeviceId()로 재스캔 회피
                                            ▼
                              bluetoothService.connect(cachedId) → WebBluetoothProvider.gatt.connect()
```

**Tech Stack:** React + TypeScript (Web Bluetooth API)

## Files to Change
| Action | File | Description |
|--------|------|-------------|
| Modify | `frontend/src/lib/eeg/bluetooth/BluetoothProvider.ts` | interface에 `onConnectionLost(callback)` 추가 |
| Modify | `frontend/src/lib/eeg/bluetooth/WebBluetoothProvider.ts` | `gattserverdisconnected` 리스너 등록 + 콜백 저장/발화 |
| Modify | `frontend/src/lib/eeg/bluetooth/NativeBluetoothProvider.ts` | no-op `onConnectionLost` 스텁 |
| Modify | `frontend/src/lib/eeg/bluetoothService.ts` | Provider 콜백 배선 + `getCachedDeviceId()` + 주석 갱신 |
| Modify | `frontend/src/hooks/useBand.ts` | onConnectionLost에 flush 추가 + connect 재스캔 회피 |
| Modify | `frontend/src/pages/sessions/ClassPlayerPage.tsx` | "연결 끊김" 문구 + "재연결" 버튼 |

## Tasks

### Task 1: Provider 인터페이스 + Web/Native 구현
**Objective:** `onConnectionLost(callback)` 추가 + `gattserverdisconnected` 리스너 등록.
**Files:** `BluetoothProvider.ts`, `WebBluetoothProvider.ts`, `NativeBluetoothProvider.ts`
**Estimate:** 10min
- `BluetoothProvider`에 `onConnectionLost(callback: () => void): void;` 추가.
- `WebBluetoothProvider`: `private onConnectionLostCb` 필드 + `onConnectionLost()` 메서드. `connect()`에서 `this.device.addEventListener('gattserverdisconnected', () => this.onConnectionLostCb?.())` 등록.
- `NativeBluetoothProvider`: `onConnectionLost(_cb) {}` no-op.

### Task 2: bluetoothService 배선 + 캐시 디바이스
**Objective:** 끊김 콜백을 `performConnectionLossHandling()`에 배선하고 재연결용 디바이스 ID 보존.
**Files:** `bluetoothService.ts`
**Estimate:** 10min
- `ensureProvider()` 후 `provider.onConnectionLost(() => this.performConnectionLossHandling())` 등록(connect 시점).
- `private lastDeviceId` 추가: `connect()`에서 설정, `cleanup()`에서 유지, `forceCleanup()`에서만 null.
- `getCachedDeviceId(): string | null` 추가.
- `performConnectionLossHandling()` 주석 갱신(이제 배선됨).

### Task 3: useBand — 끊김 시 데이터 flush + 재연결 재스캔 회피
**Objective:** 예기치 않은 끊김에도 raw/feature 보존, 재연결 시 재선택 다이얼로그 회피.
**Files:** `useBand.ts`
**Estimate:** 10min
- `onConnectionLost` 핸들러에 `flushRawChunk()` + `void drainPendingQueue()` + `void rawDrainRef.current(15_000)` 추가.
- `connect()`의 `bluetoothService.scan()` 호출부를 `getCachedDeviceId()` 우선으로 교체.

### Task 4: 호스트 LINK BAND UI — 끊김/재연결 표시
**Objective:** disconnected 상태 문구 + 재연결 버튼.
**Files:** `ClassPlayerPage.tsx`
**Estimate:** 10min
- 상태 문구에 `connectionState === 'disconnected'` 분기("연결이 끊어졌습니다 · 재연결하세요").
- 버튼 라벨: disconnected면 "재연결", 아니면 기존 "밴드 연결".

## Testing Strategy
- `npm run build` — 전체 빌드
- `npx vitest run` — 기존 테스트 회귀 확인
