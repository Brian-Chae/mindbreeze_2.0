# fix-native-score-model-ppg — 구현 요약

## 원인
**A (점수)** 앱 네이티브 코어가 `legacy_cohort` 고정(`MeasurementCore.kt:82-86`)이고 `setModel` 호출처가 없었다(`MeasurementCore.kt:36`, `NativeRuntime.open`). 웹은 `scoreIndices`(`eegPersonalScore.ts:157`)가 활성 표준 모델 > 코호트. raw 정의는 Rust `eeg.rs raw_indices` ≡ TS `EEGSignalProcessor.calculateRawIndices`로 동일(정의 불일치 아님). 실측 raw(focus 24·relax 0.02)는 β 우세 입력이라 모델 적용만으로는 분포가 완전히 정상화되지 않을 수 있다(남은 위험).
**B (PPG)** ① `BandGattClient.subscribeNext`가 `writeDescriptor` 반환값(false=GATT 바쁨)을 무시하고 콜백 무응답 시 무한 대기 → EEG만 붙고 큐 정지, `CAPTURING` 미도달 → `bandState`가 초기값 `connecting`에 머문 것도 같은 원인(`NativeRuntime.kt` `bandState`). ② Android는 JS 밴드 소유 해제 경로가 없어 `capacitor-ble-adapter.startNotifications`(stop→start)가 같은 링크 CCCD를 건드림(`index.ts` iOS만 `setJSBandOwnership`). UUID는 TS와 동일해 원인 아님.

## 변경
- Android: `ModelPin.kt`(신규: 검증·정규화·sha256·`model-pin.json` 1회 pin), `SubscribeSequencer.kt`(신규: 재시도·워치독 직렬 구독), `BandGattClient.kt`(시퀀서 적용+MBMeas 진단 로그), `MeasurementEngine.kt`(`modelParamsJson` 주입), `NativeRuntime.kt`(pin→코어 설정·`model_version`), `SealedTokenStore.kt`(RuntimeConfig에 모델 필드), `MeasurementService.kt`, `MeasurementPlugin.kt`(모델 인자 전달).
- JS: `native-measurement/index.ts`(`buildNativeModelPayload`, `releaseJsBand`), `types.ts`, `eeg/bluetoothService.ts`(`releaseForNative`), `measurement-web/use-native-measurement.ts`(활성 모델 조회·Android JS 해제·시작 후 래치).
- 테스트: Kotlin `SubscribeSequencerTest`(6), `ModelPinTest`(7), `NativeScoreModelTest`(2, 실제 Rust 코어), JS `tests/fix-native-score-model-ppg*.test.ts`(11).

## 시험
- `./gradlew testDevDebugUnitTest`: 168 통과 / 0 실패 / 스킵 0 (신규 15 포함)
- `cargo test`(measurement-core): 전부 통과(코어 변경 없음)
- vitest 전체: 17 fail/8파일 = 기준선과 동일, 신규 실패 0 (신규 11 통과)
- `tsc -b`: 오류 0

## 남은 위험 / 후속
- **iOS 미수정**: 같은 결함(`MeasurementHost.coreConfig` legacy 고정, `CoreBridge.setModel` 미호출, `MeasurementManager.profile.model` 하드코딩 `b0-cohort-2`). `MeasurementKit/Frameworks` xcframework가 없어 빌드·시험 불가라 검증 불가능한 Swift 변경은 하지 않음. 후속: 플러그인 start에서 `modelParams/modelVersion` 수신 → pin 파일 → `MeasurementEngine` 코어 생성 직후 `setModel` + manager profile.model 일치.
- 실기기 확인 필요: PPG/ACC 수신 복구(logcat `MBMeas` 의 `cccd write … accepted=` / `cccd written … status=` / `all subscribed`), JS 해제 후 화면 밴드 상태 표기, β 우세 raw 분포, 서버가 `model_version=sigmoid-<ver>` 를 받는지.
- JS 해제 뒤 useBand 가 자동 재연결(`autoReconnectRef`)을 시도하면 다시 밴드를 잡을 수 있음: `disconnect()`가 `forceCleanup`으로 캐시 ID를 지우고 수동 해제는 재연결을 끄므로 막히지만 실기기에서 재확인.
- 모델 pin은 세션 디렉터리 단위: 같은 세션 재시작은 첫 모델 유지(의도).
