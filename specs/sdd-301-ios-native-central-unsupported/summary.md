# SDD-301 — Summary

## 확정 원인 (코드 근거)
`MeasurementHost.ensureManager()` 가 매 호출마다 `bootstrapped=false` 로 되돌려 `bootstrap()` 을 재실행 → BandLink(CBCentralManager, 고정 restoreIdentifier)·MeasurementManager 를 새로 만들어 기존 것을 덮어씀. `setNativeOwnership`·`adoptBand`·`startMeasurement` 가 모두 이를 호출 → 로그의 central 3·2·2개 동시 생성과 일치. 새 central 이 `.unsupported` 를 보고하면 Manager 가 영구 BLOCKED 로 굳어 연결 시도를 안 함.
- 가설(미확정): 중복 restoreIdentifier central 이 `.unsupported` 를 내는 OS 내부 메커니즘. 실기기 재현으로 확인 필요.

## 변경
- `ManagerBootstrapPolicy`(순수) + `ensureManager`/`bootstrap` 멱등화 → BandLink 1개.
- BandLink 로그: `BandBLE 생성 id= restoreId=`, `central state=`.
- `.unsupported` 는 BLOCKED 로 굳히지 않음(이유 `unsupported_background` 만 기록, subscribed 시 해제). `.unauthorized` 는 현행.
- JS `adoptBand` 는 이미 accepted=true 뒤에만 `releaseJsBand` — 시험(V7·V8)으로 고정.

## 시험
swift 266(기존 261+신규 5, skip 7, 실패 0), vitest sdd293 17 통과, tsc -b 0.
## 미확인
실기기(빌드 금지). 앱 재빌드 필요. vitest 파일에 기존 unhandled rejection 1건(useCloseBiosignalOnEnd, mock 반환형; 본 변경 무관).
