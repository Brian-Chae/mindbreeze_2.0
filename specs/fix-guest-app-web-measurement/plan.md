# [FIX] 코드 입장 게스트 앱 실시간 지표 + iOS 재시작 시 밴드 소실 — 계획

## 원인
1. 게스트(코드 입장, user 없음)는 앱에서 네이티브 측정이 시작되지 않는다. `MemberClassContainer.tsx` 가 `accountId: user?.id ?? null` 을 넘겨 `use-native-measurement.ts` 의 `hasIds` 가 false 가 된다.
   웹 측정도 만들지 않는다. `measurement-path.ts` 가 앱이면 무조건 `'native'` 를 돌려줘서 `use-web-measurement` 의 `canStart`(path==='web_wasm')가 영원히 false 다. 남는 구형 JS 경로는 `v1FeatureUpload:false` 라 feature 를 올리지 않는다.
2. iOS: 클래스 진입 후 stop(user_left)→재start 때 밴드 식별자를 잃는다.
   - `MeasurementManager.swift:159` 가 nil 인자로 `peripheralId` 를 덮어쓴다.
   - `bluetoothService.releaseForNative()` 가 캐시 ID 를 지운다.
   - effect 재실행(bandSkipped 토글 등)이 stop→start 를 유발한다.

## 수정 (A안)
| # | 파일 | 내용 |
|---|---|---|
| 1 | `lib/measurement-web/measurement-path.ts` | 입력 `guest?: boolean` 추가. `native && !guest` 일 때만 `'native'`. 게스트+앱은 web_wasm(JS BLE: `isBleSupported()` 는 앱에서 true) |
| 2 | `use-web-measurement.ts` | `guest` 옵션을 path 판정에 전달 |
| 3 | `use-native-measurement.ts` | 게스트(accountId 없음)는 path 에서 native 제외. 성공한 deviceId 를 ref 로 보관해 재시작 때 전달. cleanup 의 stop 을 유예(grace)하고 같은 회차 재실행이면 stop→start 대신 `reconnectBand`. 시작 사유·cleanup 원인 로그 |
| 4 | `MemberClassContainer.tsx` | `guest = !user?.id` 를 web 훅에 전달. `nativeAuto` 는 로그인 회원만 true(게스트의 '수동 연결'은 JS BLE `band.connect()`) |
| 5 | `MeasurementManager.swift` | `peripheralId = parsed ?? self.peripheralId`(직전 ID 유지) + swift test |
| 6 | 서버 | 게스트 live join(entry_credential)→live:metric 방송→live-metrics 조회 통합 pytest 로 확인. 부족하면 같은 PR 에서 보강 |

## 앱 재빌드 범위
JS 번들(Android·iOS 모두) + iOS Swift(MeasurementKit). Android Kotlin 변경 없음. 서버 배포는 서버 보강이 생길 때만.

## 남은 위험
- 게스트 웹 경로는 JS BLE 라 백그라운드(화면 꺼짐·앱 전환) 측정 불가.
- 앱 WebView 에서 WASM 코어 로드는 실기기 확인 필요.
- 게스트 Android live 소켓 미개설 원인은 코드로 확정하지 못했다. 진단 로그를 보강한다.
