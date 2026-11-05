# SDD-293 Verify (구현 전 작성)

## 자동 시험 (vitest — 기존 훅 시험 방식: jsdom + facade mock)
| # | 시나리오 | 기대 |
|---|---|---|
| V1 | 밴드 단계 완료(`bandOutcome=connected`, 회원·native·동의) | `adoptBand` 1회, `startMeasurement`/capture 호출 0 |
| V2 | 보류 중 클래스 라이브 진입(useNativeMeasurementV2) | `startForSession` 은 `alreadyHeld=true`, JS `releaseForNative` 추가 호출 0, 호출 순서에 JS disconnect 없음 |
| V3 | 보류 중 화면 표시 | `connectionState='connected'`·`everConnected=true`(connecting 아님). 보류 아님 + native 소유 시는 기존 `connecting` 유지 |
| V4 | 클래스 시작 없이 이탈(훅 비활성/언마운트/단계 c 복귀) | `releaseBand` 1회, 스토어 held=false |
| V5 | 게스트·웹·`bandOptIn=false`·EEG 미동의·단계 c | `adoptBand` 0회 |
| V6 | 구 네이티브(adopt 미지원 → false) | JS 연결 유지(JS 해제 호출 0), 기존 경로로 폴백 |
| V7 | `shouldHoldBand` 순수 표 / `shouldStartNative` 보류 ID 반영 | 표대로 |
| V8 | JS 경로 종료 | close 기록 후 disconnect 호출(순서), native 경로는 호출 안 함 |
| V9 | 회귀 | `tsc -b` 0, sdd246·260·284·286·289 계열 + native 훅 시험 통과, 기준선 외 신규 실패 0 |

## 네이티브 단위 시험
- Swift(`swift test`): 보류→`startMeasurement` 시 `band.connect` 중복 없이 재사용, 수집 중 `holdBand` 무시, 이탈 시 `releaseHeldBand`→disconnect, `HoldReuse.decide` 표. (실행 가능 범위만, 못 돌리면 그대로 보고)
- Kotlin(JVM): `BandHoldPolicyTest`. 컴파일은 가능한 범위에서 `compileDevDebugKotlin` 시도(앱 빌드 아님).

## 실기기 필요(확인 못 하는 것)
- iOS 두 central 의 공유 링크 유지(JS 해제 후 끊김 0), Android hold→attach 구독 정상, 40대 동시 부하.
