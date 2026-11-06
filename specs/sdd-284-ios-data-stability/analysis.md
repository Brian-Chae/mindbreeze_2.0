# SDD-284 분석 — 11/4 iOS 측정 데이터가 서버에 도착하지 않은 원인

- 작성: 2026-11-04 / 대상 회차 `1a74e4c9-a54e-4454-8505-22840922811c` (KST 10:12~11:27)
- 조사 방식: 운영 DB·nginx **읽기 전용**(SSM), iOS 앱·웹 코드 정독. 앱 빌드·실기기 시험은 하지 않음.
- 분류: **확정** = 쿼리·코드로 직접 확인 / **가설** = 정황은 맞으나 직접 증거 없음 / **모름**
- 증거 스크립트: `evidence/a0~a7.sh` (`ssmrun.py`로 실행, 전부 `set transaction read only`). 개인정보는 참가자 ID 앞 6자리만 사용.

## 0. 한 줄 결론

**iOS 앱은 "측정 시작(capture.start)까지는 갔지만, 그 다음 단계(스트림 확정 → 밴드 패킷 수신 → 분석 → `features/batch`)가 사실상 한 번도 완주하지 못했다.** 서버 쪽 거절은 아니다(iOS 앱 `features/batch`는 15건 전부 200, 5xx 0). 가장 앞에서 끊기는 지점은 "스트림 확정(adopt)"이며, 그 뒤에는 이를 감지·복구하는 장치가 iOS 앱과 웹 훅 양쪽에 없다.

## 1. 서버 증거 — iOS 사용자가 어디까지 갔나

### 1-1. 푸시 등록이 iOS인 회원 7명 (단계별)

| 단계 | 인원 | 비고 |
|---|---|---|
| 입장(`entry.enter`)·대기 준비(`waiting.set_ready`) | 7 / 7 | 전원 applied |
| 뇌파 동의 | 6 / 7 | `3095b4`만 미동의 |
| `capture.start` applied (측정 시작 서버 기록) | **3 / 7** (`59a1ea`·`bc2d99`·`94234b`) | 나머지 4명은 시작 명령 자체가 없음 |
| `capture.renew` 1회 이상 (앱이 스트림을 확정하고 살아 있음) | **1 / 7** (`94234b`, 8회) | `59a1ea`·`bc2d99`는 **0회** |
| `band_connected=true` (`live:device` 보고 수신) | **1 / 7** (`94234b`) | |
| `eeg_feature_windows` 행 (분석 데이터) | **0 / 7** | 합계 0행 |
| `eeg_raw_chunks` (원시) | 1 / 7 (`94234b` 1,517) | 아래 1-3 참조 |

같은 회차 회원 24명의 플랫폼별 합계 (`a1.sh`):

| 플랫폼(푸시 기준) | 인원 | 밴드 연결 | 스트림 있음 | 분석 있음 | 원시 있음 |
|---|---|---|---|---|---|
| android | 13 | 7 | 11 | 7 | 11 |
| **ios** | **7** | **1** | **3** | **0** | **1** |
| 푸시 없음 | 4 | 1 | 2 | 1 | 2 |

→ **확정**: iOS 푸시 회원 7명 중 분석 데이터가 1행이라도 도착한 사람은 0명.

### 1-2. `features/batch`를 iOS가 한 번도 안 보냈나? → **아니다, 한 명 몫은 정상 도착**

nginx(UTC 01~02시, `a3.sh`·`a4.sh`) UA 분류:

| UA | `features/batch` | `eeg-raw/presign` | `biosignal-raw/presign` | 소켓 |
|---|---|---|---|---|
| Android 앱(okhttp) | 200 8,792 / 499 70 | — | 200 8,956 | 101 216 |
| Android 웹뷰 | 200 427 | 200 158 / **403 8,295** | 200 519 | 88 |
| **iOS 앱 네이티브(`App/39 CFNetwork`)** | **200 15 / 그 외 0** | — | 200 31 | 101 18 |
| **iOS 웹뷰(`iPhone … Mobile/15E148`)** | **0** | 200 1,433 / **403 2,975** | 200 1,441 | 101 64 |

- **확정**: iOS 네이티브의 `features/batch`는 **15건, 전부 200, 같은 IP 하나**에서 11:25:49~11:28:12 KST에만 발생. 거절(4xx)·5xx 없음. → "iOS가 보냈는데 서버가 거절했다"는 가설은 **기각**.
- **확정**: iOS 웹뷰 UA에서는 `features/batch`가 **0건**. 웹뷰 요청은 전부 원시(`eeg-raw`/`biosignal-raw`)·인증·소켓뿐.
- **강한 정황(추정)**: 그 15건은 `bc8a88`의 분석 141행(생성 11:25:47~11:28:11, 요청 시각과 일치)과 맞는다. `bc8a88`은 푸시 등록이 없어 "iOS 푸시 7명" 집합 밖이다. → **iOS 네이티브 파이프라인은 스트림이 확정된 경우 끝까지 동작함을 보여 주는 유일한 사례**(분석 141행 + `biosignal-raw/artifacts/summary` 호출까지 정상 200). 단 매핑은 시각·IP 정황이므로 확정이 아님.
- iOS 네이티브 UA의 `audio/chunk`(음성 녹음) 700여 건은 별도 기능이며 측정과 무관.
- 403: `eeg-raw/presign` 403 합계는 iOS 웹뷰 2,975 + Android 웹뷰 8,295(+기타). 사유는 대기열·뇌파 거부(SDD-282 F12·F13). iOS만의 문제가 아님.

### 1-3. `94234b` (iOS, 유일하게 밴드 연결·원시 도착) — 분석만 0

| 시각(KST) | 사건 | 출처 |
|---|---|---|
| 10:16:05 | `capture.start` applied (gen1), 직후 renew·reanchor applied | ledger |
| 10:16:26 | `capture.close` (final_sequences 전부 0) | ledger — 20초 만에 닫음, 지표 창 0 |
| 10:21:05 | `capture.start` applied (gen2), reanchor 1회, renew 5회 | ledger |
| **10:21:59 이후** | **renew·reanchor·close 전부 없음 — 11:57 종료까지 1시간 36분 침묵** | ledger |
| 10:22:53~11:37 | 원시 1,517청크 도착: v1 레거시 `raw-1779` 742(eeg), v2 `eeg` 39·`acc` 33·`ppg` 703 | `eeg_raw_chunks` |

- **확정**: 네이티브 분석 경로(renew/features)는 10:22 이후 서버에 흔적이 없고, 원시는 그 뒤에도 올라왔다. v2 원시(ppg 703청크의 `chunk_index`가 전부 0, 1개 distinct)는 SDD-282 H4의 "별도 확인 가치"와 동일 현상 — 원인 모름.
- **가설**: 웹뷰(JS) BLE가 밴드를 다시 잡아 원시를 올리는 동안 네이티브 manager는 멈춘 상태(소유권 전환 후 재시작 실패 또는 소켓 미복구). **원시를 올린 쪽이 JS 경로이므로**, 네이티브가 살아 있었다면 같은 시각에 renew가 있어야 하는데 없다.
- 회원 앱 경로(`decideMeasurementPath`)는 `native=true && !guest`면 항상 `native`이고 `web_wasm`(JS 분석)으로 **되돌아가는 분기가 없다** → 네이티브가 죽어도 JS는 원시만 올리고 분석은 아무도 만들지 않는다. (코드 확정, `measurement-path.ts`)

### 1-4. `59a1ea`·`bc2d99` (iOS) — 시작 명령은 갔는데 이후 서버에 아무 흔적이 없음

- `capture.start` applied 1건씩(10:13:04 / 10:18:15), 그 뒤 **renew·device·features·raw 전부 0**. 스트림은 수업 종료(11:57:53)에 서버가 `ended` 처리.
- `band_connected=false` → `live:device`가 한 번도 수락되지 않음. 코드상 스트림을 확정(adopt)하면 곧바로 `reportDevice()`와 renew 타이머가 켜지므로(`MeasurementManager.adopt`), **두 사람은 앱이 스트림을 확정하지 못한 것으로 보인다.**
- 이는 SDD-282 H1′(Android 4명: `capture.start`만 적용, renew 0)와 **같은 서버 지문**이다. 같은 회차에서 Android 4명(`de8312`·`6a2172`·`518675`·`ac1a78`)과 iOS 2명이 renew 0건 패턴을 공유 → 플랫폼 공통의 "시작 ACK/스트림 확정 실패 + 복구 없음" 가능성.

### 1-5. 시작 명령조차 없는 4명

`0632cf`·`3095b4`·`accf1b`·`f671b7`: `entry.enter`/`waiting.set_ready`만 있고 `capture.start` 없음. `3095b4`는 뇌파 미동의. 나머지 3명(동의함)이 시작하지 않은 이유는 **모름**(수업 시작 전 이탈, 네이티브 시작 실패 `credentials_unavailable`/BLE 권한, `enabled=false` 상태 등 후보).

## 2. iOS 코드 지도 — 분석 지표(feature)가 서버에 가는 경로

```
[LINK BAND] ─BLE─▶ BandLink(BandBLE.swift) ─bandLink(didReceive)─▶ MeasurementManager
   └ guard state == .capturing/.reconnecting, engine != nil, anchor != nil   ← 스트림 확정 전엔 패킷 폐기
        ▶ MeasurementEngine.ingest: raw.journal(fsync) → Rust 코어(CoreBridge) → feature.journal → MetricOutbox(metric-outbox.journal)
              ├─ [정본 저장] FeatureUploader (REST POST /sessions/{sid}/features/batch, ≤60창, 5초 주기+kick, 오래된 순)
              │      응답 accepted/duplicate만 acked. 격리 4코드 외 실패는 jitter 무한 재시도
              ├─ [실시간 방송] LiveSession.pump → 소켓 live:metric (최신 5창, best-effort, 저장과 무관)
              └─ [원시] 종료(seal) 후 RawChunker → ArchiveQueue → ArchiveUploader(background URLSession) → biosignal-raw presign/ack
   SessionSync(세션당 1개): FeatureUploader + ArchiveUploader + 종료 후 summary 대조(FeatureReconciler/RawReconciler) + scope.json
   MeasurementHost: bootstrap(앱 시작) → recoverOnLaunch → drainPendingArchives(포그라운드·네트워크 복귀)
```

스트림 확정 순서 (`MeasurementManager.startMeasurement`):
`state=.arming` → `LiveSession.start()`(소켓 연결) → `capture.start` dispatch → `band.connect()` → **ACK(result.stream_id 등)를 받아야 `adopt()`** → engine 생성·`onSessionReady`(여기서 비로소 `SessionSync.start()` = FeatureUploader 가동) → renew/clock 타이머·`reportDevice`.

핵심 사실(코드 확정):
1. `bandLink(didReceive:)`는 `engine`이 없으면(= 스트림 확정 전) 패킷을 **버린다**. 확정이 안 되면 BLE가 붙어도 raw journal조차 안 쌓인다. (Android는 "귀속 전 창을 보관만 하고 전송하지 않는" 쪽 — 결과는 같지만 보관 여부가 다르다.)
2. `adopt()`는 ACK `applied/duplicate` + `result`의 `stream_id`/`participant_id`/`owner_generation`이 전부 있을 때만 호출. 보조 경로는 `handleLiveEvent`의 본인 member audience `device.changed`(active)뿐 — **snapshot 재생으로 받은 device 정보로는 채택하지 않음**.
3. `state == .arming`에서 오래 머물러도 **타임아웃·재시작·사용자 알림이 없다** (`retryable`일 때만 같은 명령 재전송). 소켓이 `terminal`/`revoked`가 아니면 계속 기다린다.
4. JS 쪽 `use-native-measurement.ts`는 `startForSession`(= `startMeasurement` 호출)이 **반환되면 곧바로 `status='running'`** 으로 둔다. 이 시점 native는 `arming`일 뿐이다. 스트림이 확정됐는지·renew가 도는지 확인하는 코드는 없고, 재시도(`RETRY_MAX=5`)는 `startMeasurement`가 **예외**를 던질 때만 작동한다.
5. `FeatureUploader`는 소켓과 독립(좋음)이지만 `sessionReady`(= adopt) 이후에만 켜진다. 즉 **adopt가 안 되면 REST 저장도 안 시작**한다.

## 3. Android와 다른 지점

| 항목 | Android (okhttp, 정상 6명 존재) | iOS (이번 회차 0/7) | 영향 |
|---|---|---|---|
| 스트림 확정 전 BLE 패킷 | 창으로 만들어 outbox에 **보관**(귀속 전 창은 전송 안 함) | `guard engine != nil`로 **폐기** | iOS는 확정 지연 동안 데이터가 영구 유실. Android는 보관하지만 전송 못 해 같은 결과 |
| `features/batch` 가동 시점 | 같은 구조(SDD-260 이식) | `onSessionReady`(adopt) 이후 | 공통 의존: 스트림 확정 |
| 분석 대신 원시 | Android 웹뷰도 JS 경로 존재 | 네이티브 실패 시 JS가 원시만 올림, 분석 만들 주체 없음 | 두 플랫폼 공통 구조(회원 앱 = native 고정) |
| 장치 시작 조건 | 주소(MAC) 필요 → JS 연결 또는 캐시 ID 필요 | iOS는 ID 없이도 시작(`shouldStartNative`: `platform==='ios'`면 true) → **밴드 없이도 capture.start가 먼저 나감** | iOS가 더 이른 시점에 시작 → 스트림은 열리는데 밴드 없는 상태가 길어짐 |
| JS→native 밴드 인계 | `releaseJsBand` 실패해도 계속 | iOS는 `setJSBandOwnership(false)`가 거절되면 `js_band_release_failed`로 시작 중단 | 인계 실패 시 재시도 5회 후 포기(`latched=false`) |
| 백그라운드 | foreground service(`FeatureUploader.kt` 등) | `UIBackgroundModes: bluetooth-central, audio`, 소켓은 URLSession WebSocket(앱 정지 시 끊김), 원시는 background URLSession | 화면 잠금 시 소켓 지연은 있을 수 있으나 BLE+journal은 유지될 것(미검증) |
| 진단 | logcat | `os.Logger` subsystem `com.looxidlabs.mindbreeze2` category `measurement` | 현장 로그 수집 절차 없음(아래 5절) |
| UA | okhttp | `App/39 CFNetwork/…` (서버가 구분 가능) | 입장 시 플랫폼 기록 없음(SDD-282 F16) |

## 4. 원인 후보 분류

### 확정
- C1. iOS 푸시 회원 7명 분석 도착 0명, 밴드 연결 1명, 스트림 확정 흔적(renew) 1명. (§1-1)
- C2. 서버 거절이 원인이 아니다: iOS 앱 `features/batch` 15/15 200, 5xx 0. (§1-2)
- C3. 앱 스트림 확정(adopt) 실패 시 데이터가 쌓이지도, REST 저장이 시작되지도 않는 구조이며, 이를 감지·복구하는 코드가 없다(`arming` 무한 대기, JS 'running' 오표시). (§2)
- C4. 회원 앱 경로에는 native 실패 시 JS 분석(`web_wasm`)으로 대체하는 분기가 없다. (`measurement-path.ts`)
- C5. 네이티브 파이프라인 자체는 동작 가능하다(11:25 이후 1명 분석 141행·15 batch·원시/artifacts/summary 200).

### 가설 (재현 필요)
- H-A. `59a1ea`·`bc2d99`: capture.start ACK가 앱에 도달하지 못했거나 소켓이 READY를 못 회복해 adopt 안 됨 (Android H1′과 동일 지문). 후보 원인: 현장 Wi-Fi 혼잡·소켓 `ackTimeout 2s` 반복 실패·`intentValiditySeconds 30s` 만료→ `result_unknown`.
- H-B. `94234b`: 10:22 이후 네이티브 manager 정지 또는 소켓 미복구(+ JS 소유권 복귀). 원시는 JS가 업로드.
- H-C. 현장 40+명이 동시에 시작할 때 단일 소켓 서버/네트워크 부하로 ACK 지연(SDD-283과 연계).
- H-D. 3명(동의했는데 시작 명령 없음): 수업 전 이탈 또는 네이티브 시작 실패(`credentials_unavailable`, BLE 권한, `js_band_release_failed`).

### 모름
- M1. 기기 안에 남은 데이터(iOS는 adopt 전 패킷을 폐기하므로 기기에 없을 가능성이 높음 — 코드상). 복구 가능 여부는 기기 확인 필요.
- M2. `94234b` v2 ppg `chunk_index` 전부 0의 원인.
- M3. iOS 사용자 중 네이티브 빌드(TestFlight 39)로 실제 측정을 시도한 인원 — 서버가 플랫폼을 기록하지 않아 7명(푸시 기준) 외 iOS 사용자(푸시 미등록) 전체를 알 수 없음. nginx로 보면 iOS 웹뷰 소켓 101이 서로 다른 24개 IP.
- M4. 앱 로그(`os.Logger`)가 필요한 모든 항목: ACK 수신 여부, 소켓 상태 전이, `band_state`.

## 5. 재현·로그 수집 절차 (실기기, dev)

1. dev 서버·dev 앱(TestFlight 또는 Xcode 직접 설치)으로 회차 생성, iPhone에 로그인한 회원 + LINK BAND 1개.
2. **Mac에 iPhone 연결 → Console.app** → 기기 선택 → 검색창에 `subsystem:com.looxidlabs.mindbreeze2 category:measurement` (또는 터미널 `log stream --device --predicate 'subsystem == "com.looxidlabs.mindbreeze2"' --level info`). 추적 키워드: `capture.start 송신`, `capture.start ACK status=…`, `live 상태 … -> …`, `live 소켓 끊김`, `band_state … -> …`, `다른 회차 수집이 남아`, `세션 복구 거부`.
3. 시나리오:
   - S1 정상: 대기 → 밴드 연결 → 입장 → 30분. 기대: `capture.start ACK status=applied` 후 `live 상태 … -> ready`, 서버 `capture.renew` 10초 주기.
   - S2 ACK 유실: 서버 측에서 `capture.start`만 지연(dev 프록시 지연)하거나 앱을 비행기 모드 3초 → 해제로 `live:command` ACK 유실 재현. 기대(현행 결함): `arming` 정체, renew 0.
   - S3 소켓 단절: 측정 중 Wi-Fi 끄기 2분 → 켜기. 기대: 소켓 재연결, 미전송 창 재전송, 서버 행 연속.
   - S4 백그라운드/잠금: 10분 잠금, 다른 앱 전환.
   - S5 강제 종료 후 재실행: `recoverOnLaunch` 동작.
4. 서버 대조: `capture_stream`, `live_command_ledger`(kind/status), `eeg_feature_windows` 행 수, nginx 로그.
5. 앱 `getMeasurementSnapshot`의 `state`, `streamId`, `uploadCounts`를 화면 진단 패널로 노출(plan 참조) — 현장에서도 확인 가능하게.

## 6. 확인하지 못한 것
- 실기기에서 `arming` 정체를 재현하지 못했다(빌드·시험 금지). H-A/H-B는 서버 지문과 코드 구조에서 도출한 가설이다.
- iOS `swift test`는 `MeasurementCoreFFI.xcframework` 부재 및 `RawChunker.swift` 타입검사 스텁 오류로 불가 → 코드 정독만. vitest(웹 번들)는 이번 조사에서 실행하지 않았다.
- `bc8a88`과 iOS 네이티브 15건 요청의 대응은 시각·IP 정황.
- 비회원 iOS 앱 사용자(웹 경로)는 분리해서 보지 않았다(SDD-282 H2′ 소관).
