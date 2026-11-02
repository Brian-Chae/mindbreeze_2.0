# 요약 — 코드 입장 게스트 앱 실시간 지표 + iOS 재시작 시 밴드 소실

## 원인
- 게스트(user 없음)는 앱에서 네이티브가 시작되지 않고(`accountId` null → `hasIds` false), 웹(WASM) 경로도 앱이면 만들지 않아(`measurement-path.ts` 가 앱이면 무조건 native) 측정 주체가 없었다.
- iOS: 화면 정리(user_left) 뒤 재시작에서 `MeasurementManager` 가 peripheralId 를 nil 로 덮어써 스캔만 하다 밴드를 못 잡았고, effect 재실행이 stop→start 를 즉시 일으켰다.

## 수정
| 파일 | 내용 |
|---|---|
| `frontend/src/lib/measurement-web/measurement-path.ts` | `guest` 입력 추가. 게스트는 앱에서도 web_wasm |
| `frontend/src/lib/measurement-web/use-web-measurement.ts` | `guest` 옵션 전달 |
| `frontend/src/components/class/player/member/MemberClassContainer.tsx` | 웹 훅에 `guest: !user?.id`. `nativeAuto` 는 로그인 회원만 true(게스트의 수동 연결은 JS BLE `band.connect()`) |
| `frontend/src/lib/measurement-web/use-native-measurement.ts` | 게스트는 네이티브 제외. 성공한 deviceId 보관·재전달(`lastGoodDeviceIdRef`). 입력 흔들림 재실행은 stop 2.5초 유예 후 `reconnectBand` 로 제자리 재연결. 언마운트는 즉시 stop. `start_reason`·cleanup 로그 |
| `frontend/ios/MeasurementKit/.../MeasurementManager.swift` | 인자 없는 재시작은 직전 ID 유지(`user_left` 정지 후에만. 사용자 정지는 초기화 → 기존 `testPeripheralIdDoesNotLeakFromPreviousStart` 유지) |
| `backend` | 변경 없음. 서버는 게스트(entry_credential)를 이미 끝까지 지원함을 통합 시험으로 확인 |

## 테스트
- vitest 신규 9건 + 영향 묶음(sdd246-web·band-skip·member-container·archive·bundle) 통과. tsc 통과.
- pytest 신규 2건(`tests/sdd246/ingest/test_guest_entry_live_pg.py`): 게스트 입장 자격 → live actor → capture.start → live:metric 투영(호스트·본인 화면) → REST store_batch → `get_live_metrics` 에 게스트 포함. 통과.
- swift test: 전체 241건 중 1건 실패를 수정해 ManagerTests+ManagerT07bTests 46건 통과(신규 1건 포함).
- 기존 실패(변경 무관, main 17b0b308 에서도 동일): `nav-labels-characterization` 5건.

## 앱 재빌드 범위
Android·iOS 모두 필요(JS 번들 내장). iOS 는 Swift 도 변경. Android Kotlin 변경 없음. 서버 배포 불필요.

## 남은 위험
- 게스트 웹 경로는 JS BLE 라 화면 꺼짐·앱 전환 시 측정이 끊긴다(백그라운드 측정 불가).
- 앱 WebView 에서 WASM 코어 로드는 실기기 확인 필요(코드로는 검증 불가).
- 게스트 Android 에서 live 소켓이 한 번도 안 열린 원인은 코드로 확정하지 못했다(서버는 무토큰 연결·join 지원 확인). 실기기 logcat 확인 필요.
- iOS 재시작 트리거(후보 B)는 로그 보강만 했고 실기기 로그로 확정해야 한다.
