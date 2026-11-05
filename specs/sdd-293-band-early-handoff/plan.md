# SDD-293 Plan

## 1. 현재 인계 시점/조건 → 변경안
| 항목 | 현재 | 변경 |
|---|---|---|
| 인계 시작 | 라이브 진입(`MemberClassContainer` 마운트 = 클래스 시작) 후 `useNativeMeasurementV2` ready | 밴드 단계 완료 직후 `useNativeBandHold`(EntryPage)가 `adoptBand` 호출 |
| JS 해제 | `startForSession` 안에서 `releaseJsBand` → 같은 순간 네이티브 재연결 | Android: adopt 직전 JS 해제 후 네이티브 connect(대기실에서). iOS: 네이티브 hold 연결 확인 **후** JS 해제(링크 유지) |
| 시작(`startMeasurement`) | JS 해제 + connect 신규 | 보류 중이면 JS 해제 생략, 네이티브가 보류 링크 재사용(구독만 시작) |
| 화면 상태 | native 소유 직후 `'connecting'` | 보류/인계 중 `'connected'`·`everConnected=true` 유지 |
| 이탈 | 라이브에서만 stop | 보류 중 이탈 → `releaseBand`(네이티브 disconnect/cancel) |
| JS 경로 종료 | close intent 기록만 | 기록 후 `band.disconnect()` |

## 2. JS 변경 (파일 소유: 인계 로직)
- `lib/native-measurement/band-hold.ts`(신규): 모듈 스토어 `{held, deviceId}` + `useNativeBandHeld()` 구독 훅.
- `lib/native-measurement/index.ts` + `types.ts`: `adoptBand(platform, deviceId, releaseJsBand)`, `releaseHeldBand()`, `startForSession` 의 `alreadyHeld` 옵션. 플러그인 optional 메서드 `adoptBand?`/`releaseBand?`. 미구현이면 `false` 반환 → 폴백.
- `lib/measurement-web/use-native-band-hold.ts`(신규): 순수 판정 `shouldHoldBand` + 훅.
- `use-native-measurement.ts`: ready 의 `knownDeviceId` 에 보류 ID 추가, `startForSession` 에 `alreadyHeld`, stop/실패 시 보류 해제. **파일 끝 diagnostics/return 불변.**
- `MemberClassContainer.tsx`: `nativeOwnsBand` 표시에 보류 반영(연결됨 유지), JS 경로 종료 후 disconnect.
- `useCloseBiosignalOnEnd.ts`: 기록 후 `after` 콜백.
- `EntryPage.tsx`: 훅 연결(단계 c 에서는 비활성 = 뒤로 가서 재연결 허용).

## 3. 원인 분석 (iOS 지연)
`MeasurementManager.startMeasurement` → `band.connect` → `BandLink.attempt()`: JS 가 방금 `cancelPeripheralConnection` 한 직후라 `retrieveConnectedPeripherals` 가 비어 있고(또는 해제 중), 스캔 → 연결된 밴드는 광고하지 않는 시기 → 5초 `ScanRecheck` 주기 대기. 해제와 재연결이 직렬이라 지연이 누적. 변경: 네이티브가 **먼저** hold 연결(`retrieveConnectedPeripherals`로 JS 연결 링크를 집고 `central.connect`)한 뒤 JS 가 해제 → 시스템 링크 유지(실기기 확인 필요).

## 4. iOS 범위 (별도 표)
| 파일 | 변경 |
|---|---|
| `BandBLE.swift` | `BandLink.hold(expected:ready:)`: 연결+서비스/특성 발견까지만(notify 구독 안 함, 5초 타임아웃 시 `ready(false)`). `connect()` 가 보류 링크(연결·특성 발견 완료)면 재연결 없이 `subscribe` 만. 순수 판정 `HoldReuse.decide`(SwiftPM 시험). |
| `MeasurementManager.swift` | `BandControlling` 에 `hold`/`release` 추가. `holdBand(peripheralId:ready:)`·`releaseHeldBand()` (수집 중이면 무시). `startMeasurement` 가 hold 해제 표시. `seal()`/종료는 기존 `band.disconnect()` 로 해제 유지. |
| `NativeMeasurementPlugin.swift` | `adoptBand`·`releaseBand` 메서드 등록. |
| `ManagerTests.swift`/`BandBLETests.swift` | FakeBand 확장, 보류→시작 시 connect 중복 없음·이탈 시 disconnect, `HoldReuse` 표. |

## 5. Android 범위
| 파일 | 변경 |
|---|---|
| `BandGattClient.kt` | 엔진 nullable + 보류 모드(연결·MTU·서비스 발견까지, 구독 안 함). `attach(engine,onState)` 로 보류 링크에 구독 시작. 콜백 유효성은 자체 `linkEpoch`. |
| `MeasurementManager.kt` | `heldBand` 보유, `holdBand`/`releaseHeldBand`. |
| `MeasurementService.kt` | `startNative` 가 보류 링크가 같은 주소면 `attach`, 아니면 기존 신규 연결. 종료 teardown 은 기존 `gatt.stop()`. |
| `MeasurementPlugin.kt` | `adoptBand`·`releaseBand`. |
| JVM 시험 | `BandHoldPolicyTest`(순수 정책: 같은 주소 재사용/다른 주소 폐기/수집 중 해제 무시). |

앱 재빌드 필요: **예(Android·iOS 네이티브 변경)**. 구 앱 + 새 JS 는 폴백(기존 경로).

## 6. 종료 시 해제 확인
- Android: 서버 `ended` → `onCaptureEnded` → `stop` → `teardown` → `gatt.stop()`(disconnect+close). 확인됨, 불변.
- iOS: `autoSeal` → `seal` → `band.disconnect()`(cancelPeripheralConnection). 확인됨, 불변.
- JS 경로: 누락 → 개선(§2).
