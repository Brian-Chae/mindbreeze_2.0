# fix-ios-native-parity — 요약

Android 실기기 검증 수정(fb21827f 까지)을 iOS 에 같은 의미로 적용.

## 적용
| 항목 | 내용 |
|---|---|
| 모델 pin | `ModelPin.swift`(Android ModelPin.kt 동일 규칙: 검증·키정렬·sha256·`sigmoid-<ver>`·`model-pin.json` 1회 pin). `MeasurementEngine(modelParamsJSON:)` 가 코어 생성/복원 직후 `setModel`. `MeasurementManager.startMeasurement(modelParams:modelVersion:)` → capture.start·snapshot·envelope 의 model_version 이 pin 값. 복구는 pin 파일에서. `MeasurementHost.coreConfig` 제거, `ModelPin.configJSON(pin)` 사용. 플러그인이 JS 의 modelParams/modelVersion 수신 |
| xcframework | `scripts/build-core-xcframework.sh` 로 재빌드(두뇌 휴식 이완도·RR 필터·SDNN 반영). 산출물은 gitignore |
| 기기 메뉴 | `RawPreviewBuffer.swift`(EEG 1000·PPG 200, 처음·끝 유지 다운샘플), 엔진 ingest 에서 패킷 파싱해 채움, 플러그인 `getRawPreview`(points 2~500, 측정 중 아니면 빈 배열). JS facade 가드 android→android|ios, iOS start 에 model 필드 전달 |
| 신호·접촉 | 이미 `snapshot()` 경로(metrics.sqi·contact, collection.band_state) → `toNativeDevice` 사용. 추가 작업 없음 |

## 점검 결과
- 스냅샷 중첩: iOS `snapshot()` 은 계약 필드를 최상위에 둔다(`bridge` 래핑 없음). 시험 추가.
- PPG/ACC 구독: `subscribe()` 가 3개 notify 특성에 `setNotifyValue` 를 모두 호출(CoreBluetooth 가 직렬 처리, Android 의 CCCD 드롭 구조 없음). 단 `didUpdateNotificationStateFor` 로 확정하지 않고 특성 존재만으로 `.subscribed` 로 간주 → 실기기 확인 항목.
- Capacitor 프록시 truthy: facade 가 platform 으로 거르고, 플러그인에 `getRawPreview` 를 등록해 UNIMPLEMENTED 없음.
- TNA raw(2ebdf629): `MeasurementEngine.envelope` 은 Rust frame JSON(`f.json`) 전체를 복사한 뒤 세션 필드만 덧붙인다 → Rust 가 내는 필드는 그대로 투과. iOS 추가 작업 불필요(단, 계약 envelope 키 수를 17개로 고정하는 EngineTests 가 있어 TNA 필드가 metrics 안에 들어가는지 최상위인지에 따라 이 시험이 깨질 수 있음 — 해당 워커 병합 시 확인).

## 시험
- swift test: 169건 중 7 skip(서버 의존) 실패 0 — 기존 + ModelPinTests 7·RawPreviewTests 4·ManagerTests 3 신규.
- xcodebuild 시뮬레이터(arm64, Debug) BUILD SUCCEEDED.
- vitest 17 fail/8파일(기준선과 동일), 신규 JS 시험 통과, tsc -b 0.

## 실기기에서만 확인
- 3특성 notify 실제 수신(PPG/ACC 패킷 카운트 > 0)
- pin 적용 후 점수 분포(이완도 valid), 백그라운드 복원 시 pin 유지
- 파형 1초 폴링 성능, 서명/업로드 경로는 미실행
