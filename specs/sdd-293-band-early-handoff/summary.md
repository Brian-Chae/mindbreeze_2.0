# SDD-293 Summary

## 결과
- 밴드 단계(c)를 "연결"로 마친 로그인 회원(native·동의·밴드 사용)은 대기실에서 곧바로 네이티브가 밴드를 **보류(hold)** 로 인계받는다. 보류 = 연결·서비스 발견까지만, 구독·capture.start·서버 스트림 없음.
- 클래스 시작 시 `startForSession(alreadyHeld)` 는 JS 해제·소유권 이전 없이 `startMeasurement` 만 호출 → 네이티브가 보류 링크에 구독만 시작(재연결 0회).
- 보류 중 화면은 `connected`/`everConnected` 유지(연결 중 표시 억제). 실제 실패는 기존 경로.
- 클래스 시작 없이 이탈(언마운트·단계 c 복귀) → `releaseBand`(Android `gatt.disconnect/close`, iOS `cancelPeripheralConnection`).
- JS 경로(웹·게스트) 종료 시 close 기록 뒤 `band.disconnect()` 추가. native 경로 종료 해제는 코드상 기존 보장(Android teardown→gatt.stop, iOS seal→band.disconnect).

## iOS 지연 원인 (코드 확정)
JS 가 `cancelPeripheralConnection` 한 직후 `BandLink.attempt()` 가 `retrieveConnectedPeripherals` 로 못 집고(해제 중) 스캔으로 넘어가 연결된 밴드를 5초 `ScanRecheck` 주기에 의존. 변경: 네이티브가 JS 해제 **전에** 링크를 쥐어 시스템 링크가 끊기지 않게 함(실기기 확인 필요).

## 변경 파일
FE: `native-measurement/{band-hold,index,types}.ts`, `measurement-web/{use-native-band-hold,use-native-measurement}.ts`, `MemberClassContainer.tsx`, `EntryPage.tsx`, `useCloseBiosignalOnEnd.ts`.
Android: `BandGattClient/BandHoldPolicy/MeasurementManager/MeasurementService/MeasurementPlugin.kt`.
iOS: `BandBLE.swift`, `MeasurementManager.swift`, `NativeMeasurementPlugin.swift`.
시험: `tests/sdd293-band-early-handoff.test.tsx`(15), `BandHoldPolicyTest`(7), `BandHoldTests.swift`(5).

## 시험 결과
- vitest 신규 15 통과. 전체 23 failed/13 files = 기준선과 동일, 신규 실패 0. `tsc -b` 0.
- Android JVM: BandHoldPolicyTest·FencingTest·LinkWatchdogTest 통과(컴파일 포함).
- SwiftPM: 251건 중 신규 5 통과, 실패 1건(ModelPinTests testA6…)은 변경 전에도 동일한 기준선 실패.

## 미확인(실기기)
iOS 두 central 의 링크 공유(JS 해제 후 끊김 0), Android hold→attach 구독 정상, 40대 동시 부하.
