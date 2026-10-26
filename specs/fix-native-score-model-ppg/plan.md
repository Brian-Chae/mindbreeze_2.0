# fix-native-score-model-ppg — 원인 분석 및 수정안

대상: Android 앱 네이티브 측정(Rust measurement-core) 표시 점수 + PPG 미수신. 브랜치 `fix/native-score-model-ppg` (기준 develop a3033796).

## 문제 A — 집중·이완·정서 점수가 표준 분포 기준이 아님

### 원인 (코드 근거)
- `MeasurementCore.kt:82-86` DEFAULT_CONFIG 가 `model_mode=legacy_cohort`, `model_version=b0-cohort-2`, 더미 `model_hash(aaaa…)` 고정.
- `MeasurementCore.setModel()`(:36)은 정의만 있고 호출처가 없다(`grep setModel` → 테스트 외 0건). `NativeRuntime.open`(NativeRuntime.kt:140-148)은 `openOrResume(... configJson 기본값)` 만 쓴다.
- Rust `score.rs` `cohort()`는 TS `eegScore` 의 B0 상수. 웹은 `eegPersonalScore.scoreIndices` 가 서버 활성 표준 모델(GET /normalization/models/active, m=median(z), s=1.4826·MAD, sigmoid)을 우선 쓰고 없을 때만 코호트. 앱만 이 규칙을 안 따른다.
- 코호트 경로는 `ratio_scale()`(raw>10 이면 /100)을 쓴다. 295건 실측 focus_raw 중앙값 24.2 는 이 휴리스틱에서 0.242 로 환산돼 코호트 하한(0.381)보다 낮아 0점이 된다 → focus_display 중앙값 0. sigmoid 경로(`sigmoid_score`)는 ln(raw)를 그대로 써서 이 휴리스틱을 타지 않는다.
- raw 정의 동일성: Rust `eeg.rs raw_indices` ≡ TS `EEGSignalProcessor.calculateRawIndices`(focus=β/(α+θ+EPS), relax=α/(α+β+EPS), stress=(β+γ)/(α+θ+EPS), emotional=(α+θ)/(γ+EPS)). golden fixture(contracts/biosignal-golden)에서 합성 신호 focus≈0.24~0.34 로 웹과 같은 스케일. 즉 정의 불일치는 아니다. 실측 raw(focus 24, relax 0.02)는 β≫α 인 입력(접촉·고주파 잡음 의심)이며 점수 모델로 해결되지 않는다 → 남은 위험으로 보고.

### 수정안
1. JS(`use-native-measurement.ts`)가 시작 전에 활성 표준 모델을 조회(`getActiveModelCache() ?? refreshActiveModel()`)하고, 순수 함수 `buildNativeModelPayload(dto)` 로 `{modelParams(JSON 문자열), modelVersion}` 을 만든다(형식 불량 지표는 제외, direction 정규화). 모델이 없으면 필드를 보내지 않아 기존 코호트 동작 유지.
2. Android `startMeasurement`(MeasurementPlugin) → `MeasurementService.startNative` 인텐트 → `NativeRuntime.open`. 새 순수 클래스 `ModelPin`: 입력 검증, 정규화 JSON, sha256 `model_hash`, `model_version`(`sigmoid-<version>`, 서버 `_VERSION_RE` 통과), core config(`model_mode=active_sigmoid`) 생성.
3. 1회 pin: 세션 디렉터리 `model-pin.json` 이 이미 있으면 그것을 쓰고(프로세스 재생성 복구·도중 교체 금지), 없을 때만 새로 기록. 복구(intent==null)는 파일에서 읽는다.
4. `MeasurementEngine.openOrResume(modelJson)`: create/restore 뒤 재생 전에 `core.setModel`. LiveConfig·BridgeInputs 의 하드코딩 `b0-cohort-2` 를 pin 의 model_version 으로 교체(서버 stream 기록 = 코어 산출 버전).
5. iOS: 같은 결함(`MeasurementHost.coreConfig` legacy 고정, `setModel` 호출처 없음). 계약·JS 인자는 공통이라 JS 가 보내는 `modelParams/modelVersion` 을 iOS 플러그인이 읽어 같은 pin 을 적용하도록 최소 변경(가능한 범위, 빌드 불가 시 summary 에 명시).

## 문제 B — BPM·호흡·HRV 미산출 (PPG·ACC 수신 0)

### 원인 (코드 근거)
- `BandGattClient.kt subscribeNext`(:104-111): `writeDescriptor()` 반환값(false=GATT 바쁨)을 무시하고, 콜백(`onDescriptorWrite`)이 안 오면 영원히 대기하는 직렬 큐. 첫 항목(EEG)만 성공하고 PPG CCCD 쓰기가 드롭되면 큐가 조용히 멈춘다 → ppg/acc 패킷 0, 상태도 `onState(CAPTURING)`(:105)에 도달하지 못해 `NativeRuntime.bandState` 가 초기값 `"connecting"` 에 머문다(NativeRuntime.kt:35, SERVICE onState 콜백 MeasurementService.kt `rt.bandState = …`). 이것이 band_state 가 계속 connecting 인 이유.
- 동시에 JS(`useBand` → `capacitor-ble-adapter.startNotifications`)가 같은 밴드에 연결해 EEG/PPG/ACC 각각 `stopNotifications → startNotifications` 를 수행한다(capacitor-ble-adapter.ts:96-105). 같은 링크에서 CCCD 는 주변기기에 하나뿐이라 JS 의 stop(CCCD=0)이 네이티브 구독을 끄거나, 두 클라이언트의 GATT 요청이 겹쳐 네이티브 쓰기가 BUSY 로 드롭된다. logcat 의 BluetoothLe startNotifications 8회가 이를 뒷받침.
- Android 에는 JS 소유 해제 경로가 없다: `native-measurement/index.ts startForSession` 은 iOS 만 `setJSBandOwnership(false)`. `MeasurementPlugin.kt` 에 해당 메서드도 없다. JS 연결이 그대로 살아 있다.
- UUID 오류는 아님: `BandUuids` ≡ `bluetoothService.ts LINK_BAND_UUIDs` 3쌍 동일, 서비스/특성이 없으면 `onServicesDiscovered` 가 disconnect 하는데 EEG 는 수신됐으므로 발견은 성공.

### 수정안
1. `BandGattClient` 구독 큐를 순수 클래스 `SubscribeSequencer`(주입형 writer/scheduler)로 분리: `writeDescriptor` false 는 짧게(300ms) 최대 5회 재시도, 콜백 무응답 4초 워치독 → 실패 처리(disconnect → 기존 gen fencing 재연결 경로). 매 단계 `Log.i("MBMeas")` 로 진단 로그(실기기에서 어느 단계에서 막히는지 확정 가능).
2. JS 밴드 소유 해제(Android): `bluetoothService.releaseForNative()` — 알림 중지 → GATT 연결 해제 → 장치 ID 를 반환. `use-native-measurement.ts` 가 Android 에서 `startForSession` 전에 호출(주소는 해제 전에 확보). 시작한 뒤에는 useBand 의 stale `connected` 상태 때문에 `ready` 가 풀려 네이티브가 정지하지 않도록 hook 에서 시작 후 `bandConnected` 를 래치한다. 웹/미착용/iOS 경로는 변경 없음.
3. 순서: JS 해제 완료 후 네이티브 시작(동시 연결 구간 제거).

## 범위 밖 / 위험
- 실기기에서만 확정 가능: PPG 수신 복구, JS 해제 후 UI 밴드 상태 표기, β 우세 raw 의 원인.
- 웹 WASM 경로(`WEB_CORE_CONFIG` legacy_cohort)는 이번 범위 아님(웹 표시는 이미 scoreIndices).
