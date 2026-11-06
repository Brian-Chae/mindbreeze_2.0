# SDD-301 — iOS 클래스 시작 시 네이티브 밴드 연결 실패 (central unsupported)

- 상태: Stage ① Spec
- 브랜치: `sdd/301-ios-native-central-unsupported`
- 작성일: 2026-11-05

## 증상
iOS MB Dev 빌드 3 실기기(11/5 13:05·13:13 회차): 대기실에서 연결한 밴드가 클래스 시작 때 끊기고 재연결도 계속 실패. 서버 기록 = capture.start 1건·분석 0건·`band_connected=false`.

## 확정 원인 (코드 + 실기기 로그)
`MeasurementHost.ensureManager()` 가 **manager 가 이미 있어도** `bootstrapped=false` 로 되돌리고 `bootstrap()` 을 다시 호출한다.
`bootstrap()` 은 `BandLink`(= `CBCentralManager`, 고정 `restoreIdentifier`) 와 `MeasurementManager` 를 새로 만들어 `manager`/`band` 를 덮어쓴다.
`setNativeOwnership`·`adoptBand`·`startMeasurement` 가 모두 `ensureManager()` 를 부르므로 호출 때마다
(1) 보류(hold)·연결 중이던 BandLink/Manager 가 버려지고 (2) 같은 restoreIdentifier 의 CBCentralManager 가 중복 생성된다
(로그: 13:13:36 에 central 3개, 43 에 2개, 47 에 2개 동시 생성). 새 CBCentralManager 가 `.unsupported` 를 보고하고,
Manager 는 이를 영구 `BLOCKED` 로 굳혀 `attempt()` 를 하지 않는다.
- 확정: 중복 생성 경로(코드). 
- 가설(실기기 재확인 필요): 중복 restoreIdentifier 가 `.unsupported` 를 유발하는 직접 메커니즘 — iOS 는 이를 문서화하지 않는다. 그래서 원인 제거(단일 인스턴스)와 `.unsupported` 비영구화를 함께 한다.

## 범위
1. ensureManager 멱등화: manager 가 없을 때만 생성. BandLink/CBCentralManager 는 앱 전체에서 1개.
2. 진단 로그: `BandBLE 생성 id=… restoreId=…`, `central state=…` (개인정보·기기 ID 제외).
3. `.unsupported` 를 영구 BLOCKED 로 굳히지 않는다: Manager 상태는 유지, 이유만 기록, 이후 `.poweredOn` 이 오면 재시도.
4. JS 해제 안전장치 확인: 보류 인계(`accepted=true`)가 확인된 경우에만 `releaseJsBand` (현행 `adoptBand` 구현이 이미 보장 — 시험으로 고정).

## 비범위
앱 빌드·배포, Android, 293 인계 로직 재설계.
