# fix-ios-native-parity — Android 실기기 검증 수정의 iOS 적용 (plan)

기준: fb21827f (fix/ios-native-parity). Android 쪽 수정(345c1fd5 모델 pin, d3cea549 기기 메뉴, SDNN·두뇌휴식)을 iOS 에 동일 의미로 적용한다.

## 원인 (코드 근거)
- `MeasurementHost.coreConfig` 가 legacy_cohort 고정, `CoreBridge.setModel` 호출처 없음, `MeasurementManager.profile.model`="b0-cohort-2" 하드코딩 → 앱 점수가 웹 활성 표준모델과 다르다.
- JS `doStartWithCredentials` iOS 분기는 `modelParams/modelVersion` 을 보내지 않고, 플러그인도 읽지 않는다.
- iOS 에 `getRawPreview` 없음, JS facade 는 `platform !== 'android'` 면 null.
- 구 xcframework 는 두뇌 휴식 이완도·RR 필터 이전 Rust 코어 → 재빌드 필요.

## 수정
1. `ModelPin.swift`(MeasurementKit): Android ModelPin.kt 와 같은 검증·정규화(키 정렬, direction ±1, s>0), sha256 hash, `sigmoid-<ver>` version, `configJSON(pin)`, 파일 `model-pin.json` 1회 pin(`loadOrCreate`, 손상 시 재기록, hash 불일치 시 무효).
2. `MeasurementEngine`: `modelParamsJSON` 인자 추가 — CoreBridge 생성/복원 직후 재생 전에 `setModel`. envelope `model_version` 은 config 에서 읽으므로 pin 값이 자동 반영.
3. `MeasurementManager`: `startMeasurement(modelParams:modelVersion:)` 로 받아 세션 디렉터리에 pin 파일 기록, `profile.model` 을 세션 단위로 pin 값으로 교체(capture.start·snapshot·envelope 일치). 복구는 pin 파일에서 읽는다. `makeEngine` 클로저에 pin 전달.
4. `MeasurementHost`: `coreConfig` 대신 `ModelPin.configJSON(pin)` 사용.
5. `RawPreviewBuffer.swift`: EEG 1000·PPG 200 링버퍼 + 처음·끝 유지 다운샘플. 엔진 ingest 에서 패킷 파싱(EEG 7B/샘플 24bit→µV, PPG 6B 24bit)해 채움. 응답 {eegFp1,eegFp2,ppgRed,ppgIr}.
6. `NativeMeasurementPlugin`: `getRawPreview` 메서드, `startMeasurement` 가 modelParams/modelVersion 전달.
7. JS: iOS start 에 model 필드 전달, `getRawPreview` 가드를 android|ios 허용.
8. xcframework 재빌드(scripts/build-core-xcframework.sh, 산출물 gitignore).

## 점검 항목 (Android 결함의 iOS 대응)
- 계약 스냅샷 중첩(bridge): iOS `emit(event:payload:snap)` 은 `snapshot()` 을 payload 로 직접 사용 — 중첩 여부 확인.
- PPG/ACC 구독 큐 정지: iOS CoreBluetooth `setNotifyValue` 는 OS 가 직렬 처리 — 3개 모두 호출하고 `subscribed` 는 특성 존재만으로 판단 → 노티파이 확정 여부 확인.
- Capacitor 프록시 truthy 가드: facade 는 platform 으로 거른다. iOS 허용 시 플러그인 메서드 등록 필요.
- TNA raw 필드(2ebdf629): Swift envelope 이 Rust frame JSON 을 그대로 넘기는지 확인.
