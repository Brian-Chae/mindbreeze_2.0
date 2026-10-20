# SDD-222 Plan — 앱 백그라운드 BLE·서버 통신 유지

- 상태: Stage ② Plan (구현은 Stage ③ Verify 승인 후)
- 선행: `spec.md` (D1·D2 확정)
- 원칙: 앱(Capacitor) 한정. 웹 경로는 `isNativeApp()` 분기로 기존 동작 100% 유지. 백엔드 변경 없음.

## 1. 아키텍처 개요

```text
[Android]  Foreground Service(connectedDevice, 알림 LOW) ──┐
[iOS]      UIBackgroundModes(bluetooth-central, audio)     ├─ 프로세스·BLE·WebView 를 살려 둠
           + AVAudioSession(playback)                      ┘
[공통 JS]  appStateChange ─▶ 소켓 재연결/재join · raw flush · BLE 상태 확인   (G1)
           BLE 끊김 ─▶ 지수 백오프 재연결 + 끊김 구간 로그                    (G2)
           KeepAwake(네이티브) / Wake Lock(웹)                               (G3)
           BLE 데이터 콜백 ─▶ throttle flush (타이머 스로틀 대비)             (G6)
```

네이티브 설정(FGS·UIBackgroundModes)은 프로세스 생존을, 공통 JS 는 "살아 있는 동안/복귀 직후"의 정합성을 담당한다. 둘 다 있어야 한다.

## 2. 플러그인 선택과 근거

`package.json` 확인 결과 현재 Capacitor 8.3.4, `@capacitor/app ^8.0.0`, `@capacitor-community/bluetooth-le 8.2.0`. keep-awake·foreground-service 계열 의존성은 **없음**. npm 레지스트리 조회(2026-10-20) 기준:

| 용도 | 선택 | 근거 |
|---|---|---|
| 화면 꺼짐 방지 (iOS·Android) | `@capacitor-community/keep-awake@8.0.1` | MIT, peer `@capacitor/core >=8`, 최근 갱신(2026-09). 이미 쓰는 `@capacitor-community` 계열이라 유지보수 관점 일관. 웹 구현도 포함하지만 **네이티브에서만 호출**하고 웹은 기존 `useWakeLock` 유지 |
| Android Foreground Service | `@capawesome-team/capacitor-android-foreground-service@8.1.0` | MIT, peer core `>=8`. JS 에서 시작/종료/알림 갱신, 알림 채널·중요도, 알림 탭 이벤트를 제공해 D1 요구(문구·LOW·탭 복귀)를 직접 충족. 직접 Java 서비스 작성 대비 코드량·유지보수 부담이 작음 |
| 앱 생명주기 | `@capacitor/app` (기존) | 이미 설치. `appStateChange` 만 추가 사용 |
| iOS AVAudioSession | **플러그인 없음 — `AppDelegate.swift` 에서 직접 설정** | 앱 시작 시 `playback` 카테고리를 1회 설정하면 충분. 별도 플러그인은 과함 |
| 배터리 최적화 안내 | 플러그인 API 가 있으면 사용, 없으면 **설정 화면으로 보내는 인텐트만** 사용 | `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 권한은 Play 정책상 제한적이라 쓰지 않는다. `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` 화면 이동은 권한이 필요 없다 |
| iOS BLE 상태 복원(State Restoration) | **이번 범위 제외** | `bluetooth-le` 8.2.0 이 `CBCentralManagerOptionRestoreIdentifierKey` 를 노출하는지 미확인. 앱이 종료(kill)된 뒤 복원은 비목표. 필요 시 후속 |

### 2.1 설치 직후 스파이크 (T-J0 에서 확인, 결과를 plan 부록에 기록)
- capawesome 플러그인이 자체 `AndroidManifest` 에 `<service android:foregroundServiceType="connectedDevice">` 를 병합하는지, 아니면 앱 Manifest 에 직접 선언해야 하는지. (Android 14+ 에서 타입 미선언 시 `startForeground` 가 예외)
- 플러그인이 `foregroundServiceType` 인자를 지원하는지, 배터리 최적화 API 유무.
- 위 항목이 불충분하면 **대안: 앱 내 최소 커스텀 Capacitor 플러그인**(Java, `android/app/src/main/java/com/looxidlabs/mindbreeze/`)으로 교체. 이 경우 Track A 의 담당 파일이 늘어나지만 JS 인터페이스(`background-session.ts`)는 그대로라 Track J 는 영향 없음.

## 3. 변경 설계 (공통 JS)

### 3.1 앱 생명주기 (G1)
- 신규 `src/lib/native/app-lifecycle.ts`: `isNativeApp()` 일 때만 `App.addListener('appStateChange')` 등록. `subscribeAppResume(cb)` / `subscribeAppPause(cb)` 구독 API. 웹은 no-op(웹은 기존 `visibilitychange` 경로 유지).
- 신규 `src/hooks/useAppResume.ts`: 컴포넌트에서 resume 콜백을 선언적으로 등록(언마운트 시 해제).
- **복귀 시 순서**: ① 소켓 `connected` 가 아니면 `socket.connect()` 후 `onConnect` 의 기존 재join 경로 이용 ② `useEegRawUpload.flush()` 즉시 호출 ③ BLE 연결 상태 확인(§3.2) ④ 화면 켜짐 재요청(§3.3). 각 단계는 독립 try/catch — 한 단계 실패가 나머지를 막지 않는다.
- 적용 지점: `useSessionLiveSocket.ts`(resume 시 재연결·재join), `useEegRawUpload.ts`(resume 시 flush), `useBand.ts`(resume 시 연결 확인).

### 3.2 BLE 자동 재연결 + 끊김 로그 (G2)
- 신규 `src/lib/ble/reconnect-policy.ts`: 순수 함수 `nextReconnectDelay(attempt)` — 1s → 2s → 4s → 8s → 15s → 30s(상한), ±20% 지터, 성공 시 attempt 0 리셋. 최대 재시도 시간 상한(수업 종료까지 계속, 단 사용자 수동 해제 시 중단).
- `useBand.ts`: 기존 고정 1.5초 1회 재시도를 정책 기반 루프로 교체. **재시도 중 `connect()` 실패가 `autoReconnectRef=false` 로 루프를 끊지 않도록** 수동 해제와 자동 재시도 실패를 구분한다. `bandConnectInFlight` 가드와 `FE-BAND-001` 동작 유지.
- 신규 `src/lib/eeg/ble-gap-log.ts`: 끊김 구간 `{ startedAt, endedAt, durationMs, reason, attempts }` 기록. 메모리 + `logger`(`createLogger`) 출력 + 최근 N건 `localStorage` 링버퍼(진단용). **서버 전송은 이번 범위 제외**(백엔드 무변경 원칙). 연결 복구 시 구간을 닫는다.
- 어댑터: `capacitor-ble-adapter.ts` 의 `isConnected` 가 로컬 Set 만 본다 → 복귀 시 실제 연결 확인용 `verifyConnection(deviceId)`(플러그인의 연결 조회 API 또는 가벼운 read 프로브)를 추가. 실패 시 `connectionLost` 와 동일 경로로 재연결 트리거.
- 가드: 모든 재연결·로그 경로는 밴드 opt-in 으로 연결된 경우에만 동작(`bandConnected` 가드, 미착용 회원 영향 0).

### 3.3 화면 꺼짐 방지 (G3)
- `src/hooks/useWakeLock.ts`: `isNativeApp()` 이면 `KeepAwake.keepAwake()` / 해제 시 `allowSleep()`. 앱 resume 시 재요청. **웹 분기 코드는 그대로 유지**(회귀 방지). 호출부(`EntryPage`, `ClassPlayerPage`) 변경 없음.

### 3.4 백그라운드 세션 (Android FGS 제어) (G5)
- 신규 `src/lib/native/background-session.ts`: `startBackgroundSession()` / `stopBackgroundSession()`. Android 에서만 FGS 플러그인 호출(문구 `명상 클래스 진행 중`, 채널 중요도 LOW, `foregroundServiceType: connectedDevice`, 알림 탭 → 앱 복귀). iOS·웹은 no-op. 멱등(중복 시작·종료 안전).
- 신규 `src/hooks/useBackgroundSession.ts`: `active` 가 true 인 동안 서비스 유지, `false`/언마운트 시 종료. 시작 전 BLE 권한(`BLUETOOTH_CONNECT`) 확인, 알림 권한 거부 시에도 서비스 시작(알림만 제한).
- 적용: 회원 수업 참여 경로 `EntryPage.tsx` 의 기존 `useWakeLock(machine.phase === 'wait' || 'live')` 와 같은 조건. 수업 종료·이탈·언마운트·로그아웃 시 반드시 종료.
- 배터리 최적화 제외 안내: 첫 수업 입장 시 1회 안내 모달(건너뛰기 가능, 이후 설정에서 다시 열기). 설정 화면 이동은 `background-session.ts` 가 래핑. 문구는 한글, 비전문가가 이해할 수 있게.

### 3.5 JS 타이머 스로틀 대비 (G6)
- `useBand.ts` 의 raw 수신 콜백(`handleRawEegData`)에서 `flush` 를 **throttle(최소 5초 간격)** 로 병행 호출 — 타이머가 멈춰도 BLE 콜백이 오는 동안 업로드가 진행된다. `flushingRef` 가드로 중복 전송 방지, 기존 주기 flush 는 유지.
- 하트비트(30초)는 타이머 의존이므로 resume 시 즉시 1회 발송.

## 4. 변경 설계 (네이티브)

### 4.1 Android (Track A)
- `AndroidManifest.xml`: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE` 권한 추가. 서비스 선언에 `android:foregroundServiceType="connectedDevice"`(§2.1 결과에 따라 플러그인 병합 여부 확인). `POST_NOTIFICATIONS` 는 기존 선언 재사용.
- 알림 아이콘 리소스(`res/drawable`), 알림 문구·채널 이름 `strings.xml` (`명상 클래스 진행 중`).
- `MainActivity.java`: Capacitor `Bridge` 가 액티비티 pause 시 WebView 타이머를 멈추는지 확인(스파이크). 멈춘다면 `onPause` 후 `getBridge().getWebView().resumeTimers()` 를 호출해 FGS 동안 JS 타이머를 유지한다. 그렇지 않으면 변경 없음.
- `app/build.gradle` / `variables.gradle`: `targetSdk`≥34 인지 확인, 필요 시에만 수정.

### 4.2 iOS (Track I)
- `Info.plist`: `UIBackgroundModes` = `bluetooth-central`, `audio`.
- `AppDelegate.swift`: `didFinishLaunching` 에서 `AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])` + `setActive(true)` (실패는 로그만, 앱 시작을 막지 않음). **`mixWithOthers` 옵션 사용 여부**는 실기기에서 다른 앱 음성과의 충돌 확인 후 결정(기본 미사용).
- `NSBluetoothAlwaysUsageDescription` 은 기존 문구 유지. 백그라운드 수집 사실을 고지하려면 문구 보강 가능(Brian 확인, spec §6 R6).
- Xcode 프로젝트의 Background Modes capability 체크가 `Info.plist` 와 일치하는지 확인(`App.xcodeproj` 직접 수정은 최소화).

## 5. 구현 Task (병렬 트랙 + 담당 경로)

> 브랜치 규칙(`.claude/rules/branch-management.md` §1): 트랙별 `sdd/222-android`, `sdd/222-ios`, `sdd/222-js` 로 분기 → `sdd/222-integrate` 에서 합쳐 **PR 1개**. **같은 파일을 두 트랙이 수정하지 않는다.** 워커마다 워크트리 분리.

### 5.1 담당 경로 표 (겹침 없음)

| 트랙 | 담당 경로 (수정 가능) | 수정 금지 |
|---|---|---|
| **J0 선행(공통 JS, 1명)** | `frontend/package.json`, `frontend/package-lock.json`, `frontend/capacitor.config.ts`, `cap sync` 가 생성하는 `android/capacitor.settings.gradle`·`android/app/capacitor.build.gradle`·`ios/App/CapApp-SPM/Package.swift` | 그 외 모두 |
| **A Android** | `frontend/android/app/src/main/AndroidManifest.xml`, `.../java/com/looxidlabs/mindbreeze/MainActivity.java`, `frontend/android/app/src/main/res/**`, `frontend/android/app/build.gradle`, `frontend/android/variables.gradle` | `frontend/src/**`, `frontend/ios/**`, `package*.json` |
| **I iOS** | `frontend/ios/App/App/Info.plist`, `frontend/ios/App/App/AppDelegate.swift`, `frontend/ios/App/App.xcodeproj/**`(capability 일치 확인 시에만) | `frontend/src/**`, `frontend/android/**`, `package*.json` |
| **J 공통 JS** | `frontend/src/lib/native/app-lifecycle.ts`(신규), `.../background-session.ts`(신규), `frontend/src/hooks/useAppResume.ts`(신규), `.../useBackgroundSession.ts`(신규), `.../useWakeLock.ts`, `.../useSessionLiveSocket.ts`, `.../useEegRawUpload.ts`, `.../useBand.ts`, `frontend/src/lib/ble/reconnect-policy.ts`(신규), `.../capacitor-ble-adapter.ts`, `frontend/src/lib/eeg/ble-gap-log.ts`(신규), `frontend/src/lib/socket.ts`, `frontend/src/pages/class/EntryPage.tsx`, 해당 테스트 파일 | `frontend/ios/**`, `frontend/android/**`, `package*.json` |

> `useBand.ts`(1500줄)는 J 트랙 내 **한 명이** 맡는다. 여러 트랙이 자주 만지는 백엔드 파일(`branch-management.md` §3)은 이번 SDD 에서 건드리지 않는다.

### 5.2 Task 목록

| Task | 트랙 | 내용 | 선행 | 테스트 |
|---|---|---|---|---|
| **T-J0** | J0 | 의존성 2종 설치(`keep-awake@8.0.1`, `capacitor-android-foreground-service@8.1.0`), `cap sync`, §2.1 스파이크 결과를 plan 부록에 기록 | — | `npm run build` 통과 |
| **T-A1** | A | Manifest 권한·서비스 타입, 알림 아이콘·문구 리소스 | T-J0 | `./gradlew assembleDevDebug` 빌드 |
| **T-A2** | A | `MainActivity` WebView 타이머 스파이크 → 필요 시 `resumeTimers` 처리 | T-A1 | 실기기 verify M3·M4 |
| **T-A3** | A | `targetSdk`/`compileSdk`가 FGS 타입 요건 충족하는지 확인 | T-A1 | 빌드 |
| **T-I1** | I | `UIBackgroundModes` 추가 | T-J0 | 실기기 verify M7 |
| **T-I2** | I | `AppDelegate` AVAudioSession playback 설정 | T-I1 | 실기기 verify M8 |
| **T-J1** | J | `reconnect-policy.ts` + 단위 테스트(RED→GREEN) | T-J0 | vitest |
| **T-J2** | J | `ble-gap-log.ts` + 단위 테스트 | T-J0 | vitest |
| **T-J3** | J | `useBand` 재연결 루프 교체(정책 적용, 실패 시에도 지속, 수동 해제 시 중단), 갭 로그 연동 | T-J1, T-J2 | vitest(훅 테스트, BLE 서비스 목) |
| **T-J4** | J | `capacitor-ble-adapter` `verifyConnection` + 복귀 시 연결 확인 | T-J3 | vitest(BleClient 목) |
| **T-J5** | J | `app-lifecycle.ts`, `useAppResume.ts` | T-J0 | vitest(`@capacitor/app` 목) |
| **T-J6** | J | resume 처리: `useSessionLiveSocket`(재연결·재join·즉시 heartbeat), `useEegRawUpload`(즉시 flush), `useBand`(연결 확인) | T-J5 | vitest |
| **T-J7** | J | `useBand` BLE 콜백 throttle flush(G6) | T-J6 | vitest(fake timers) |
| **T-J8** | J | `useWakeLock` 네이티브 분기(KeepAwake), 웹 경로 불변 | T-J0 | vitest(플랫폼 목, 웹 회귀 테스트 포함) |
| **T-J9** | J | `background-session.ts`, `useBackgroundSession.ts`, `EntryPage` 연결, 배터리 최적화 안내 모달 | T-A1(플러그인 인터페이스), T-J5 | vitest(플랫폼·플러그인 목, 멱등·종료 보장) |
| **T-X** | 통합 | `sdd/222-integrate` 병합, `npm test && npm run build`, 실기기 verify 수행 | 전 트랙 | verify.md 전체 |

의존 그래프: `T-J0` → {A1→A2/A3, I1→I2, J1·J2→J3→J4, J5→J6→J7, J8, J9} → `T-X`. A·I·J 트랙은 T-J0 이후 **병렬 가능**(담당 경로가 겹치지 않음). T-J9 는 Android 플러그인 호출 인터페이스(T-J0 스파이크 결과)에 의존.

## 6. 테스트 전략

- **TDD**: J 트랙 Task 는 RED(테스트 먼저) → GREEN → REFACTOR. `verify.md` 의 V 항목(vitest)이 곧 테스트 케이스.
- 자동화 가능: 백오프 계산, 갭 로그, resume 시 호출 순서·독립성, 재연결 루프의 실패 후 지속·수동 해제 중단, throttle flush 중복 방지, 플랫폼 분기(웹에서 네이티브 플러그인 미호출), FGS start/stop 멱등·언마운트 종료.
- 실기기 필수: 화면 꺼짐 5분·20분, 앱 전환, 비행기 모드, 알림 탭, 서비스 종료, iOS 백그라운드 모드(Xcode 로 빌드·서명 필요). 에뮬레이터·시뮬레이터는 BLE·잠금 동작이 부정확하므로 **인정하지 않는다.**
- 웹 회귀: `npm test`, `npm run build`, `test:browser` 중 관련 항목, 웹에서 `useWakeLock` 기존 동작 유지 확인.

## 7. 구현 전 선결 사항 (Brian)

1. `spec.md` §8 두 질문(호스트 화면 제외, 스토어 사유 문구) 확인.
2. `verify.md` 승인 → 승인 전 구현 착수 금지(AGENTS.md Stage ③).
3. 실기기 테스트용 장비 확보: Android 1대 이상(가능하면 삼성 + 타 제조사 1대), iOS 1대, LINK BAND 2.0, TestFlight/내부 테스트 배포 경로.

## 8. 스토어 제출 사유 문구 (초안, 승인 대상)

- **iOS `audio`**: "온라인 명상 수업의 음성 안내를 화면이 꺼지거나 다른 앱을 사용하는 중에도 끊김 없이 전달하기 위함." / **`bluetooth-central`**: "수업 중 착용한 뇌파 측정 기기(LINK BAND)와의 BLE 연결을 유지하기 위함."
- **Android `connectedDevice`**: "수업 중 착용한 뇌파 측정 기기와의 블루투스 연결 및 실시간 데이터 전송을 화면이 꺼진 상태에서도 유지하기 위함."

## 9. 롤백

- 네이티브 설정은 모두 추가 항목이므로 되돌리기 쉽다(Manifest 권한·서비스, Info.plist 키, AppDelegate 블록). JS 는 `isNativeApp()` 분기 뒤에 있어 웹 영향이 없고, `useBackgroundSession` 호출 한 줄을 제거하면 FGS 가 비활성화된다.

---

## 부록 A. T-J0 스파이크 결과

> 2026-10-20, `node_modules` 소스(Java·`definitions.d.ts`·README)를 직접 확인한 결과. 설치 버전: `@capacitor-community/keep-awake@8.0.1`, `@capawesome-team/capacitor-android-foreground-service@8.1.0`. 설치는 CI 와 같은 `npm install --legacy-peer-deps`(storybook ↔ vite 8 peer 충돌은 기존 이슈).

### A.1 결론: capawesome 플러그인 **사용 가능** (커스텀 플러그인 대안 불필요). 단 아래 3가지는 앱이 직접 처리한다.

| # | 항목 | 확인 결과 | 조치 |
|---|---|---|---|
| 1 | **Manifest `<service>` 병합** | 플러그인 자체 Manifest 는 `POST_NOTIFICATIONS` 권한 1줄뿐. **서비스는 병합되지 않는다.** README 도 앱 Manifest 에 직접 선언하라고 안내 | **Track A 가 앱 Manifest 에 선언** (A.2) |
| 2 | **`connectedDevice` 타입** | TS enum `ServiceType` 은 `Location=8`, `Microphone=128` 만 정의. 하지만 Java 가 `Integer` 를 `startForeground(id, n, serviceType)` 에 **그대로 전달**(`AndroidForegroundService.java:67`, SDK≥29 && ≠0). 따라서 `16`(=`FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE`)을 숫자로 넘기면 동작 | JS 에서 `serviceType: 16 as ServiceType` 캐스트 + 상수 `FGS_TYPE_CONNECTED_DEVICE = 16` (Track J, `any` 금지) |
| 3 | **알림 중요도 LOW** | `startForegroundService` 옵션에는 중요도가 없고, `notificationChannelId` 미지정 시 기본 채널이 `IMPORTANCE_DEFAULT`(소리 가능). 채널은 한 번 만들면 중요도를 바꿀 수 없음 | `createNotificationChannel({ id, name, description, importance: Importance.Low })` 를 **start 전에 호출**하고 `notificationChannelId` 로 지정 |

### A.2 Track A 가 앱 `AndroidManifest.xml` 에 직접 넣을 항목

```xml
<!-- application 태그 바깥 -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<!-- POST_NOTIFICATIONS 는 플러그인 Manifest 에서 병합됨(앱에 이미 있으면 중복 무방) -->

<!-- application 태그 안 -->
<service
    android:name="io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService"
    android:foregroundServiceType="connectedDevice"
    android:exported="false" />
```

- README 예시의 `FOREGROUND_SERVICE_LOCATION` / `foregroundServiceType="location"` / `SYSTEM_ALERT_WINDOW` 는 **넣지 않는다**(위치·오버레이 불필요, 스토어 심사 사유 증가). `moveToForeground()` 는 오버레이 권한이 필요하므로 쓰지 않는다.
- Android 14+(targetSdk 34+)는 `FOREGROUND_SERVICE_CONNECTED_DEVICE` 권한 + 타입 선언이 없으면 `startForeground` 가 예외를 던진다. 또한 `connectedDevice` 타입은 런타임에 `BLUETOOTH_CONNECT`(등) 권한 보유가 요구되므로, **FGS 시작은 BLE 권한이 허용된 뒤**에만 호출해야 한다(Track J `useBackgroundSession` 가드).
- 알림 아이콘: `smallIcon` 은 `res/drawable` 리소스명(확장자 없음). Track A 가 `ic_stat_*` 리소스를 추가하고 그 이름을 Track J 와 합의(제안: `ic_stat_mindbreeze`).
- 플러그인 `AndroidForegroundService` 의 `.setPriority(PRIORITY_HIGH)` 는 API 26+ 에서 무시되고 채널 중요도가 우선하므로 LOW 채널이면 조용하다.
- 소스에 배터리 최적화 API 는 **없다**. §2 의 계획대로 설정 화면 이동 인텐트가 필요하면 별도 처리(후속/Track A 판단).

### A.3 JS API 시그니처 (Track J 가 `background-session.ts` 에서 사용)

```ts
import {
  ForegroundService, Importance, ServiceType,
} from '@capawesome-team/capacitor-android-foreground-service';

createNotificationChannel(o: { id: string; name: string; description?: string; importance?: Importance }): Promise<void>
//   Importance: Min=1 Low=2 Default=3 High=4 Max=5  → Low(2) 사용
startForegroundService(o: {
  id: number;                    // 알림 ID (탭 이벤트의 notificationId 와 동일)
  title: string; body: string;
  smallIcon: string;             // res/drawable 리소스명
  serviceType?: ServiceType;     // 숫자 16 을 캐스트해 전달
  notificationChannelId?: string;
  silent?: boolean;              // true: 업데이트 시 재알림 안 함 (setOnlyAlertOnce)
  buttons?: { title: string; id: number }[];  // 불필요(미사용)
}): Promise<void>
updateForegroundService(o: 위와 동일 타입): Promise<void>   // 문구 갱신
stopForegroundService(): Promise<void>
checkPermissions(): Promise<{ display: PermissionState }>   // 알림 권한(Android 13+)
requestPermissions(): Promise<{ display: PermissionState }>
addListener('notificationTapped', (e: { notificationId: number }) => void): Promise<PluginListenerHandle>
removeAllListeners(): Promise<void>
```

- **시작/종료**: `startForegroundService` 는 내부에서 기존 서비스를 먼저 `stop` 한 뒤 시작(중복 호출 안전). 이미 실행 중 문구만 바꿀 땐 `updateForegroundService`. 종료는 `stopForegroundService`.
- **탭 시 앱 복귀**: 별도 코드 불필요. 알림 `contentIntent` 가 `getLaunchIntentForPackage` + `NEW_TASK|SINGLE_TOP` 으로 앱을 앞으로 가져온다. 탭 이벤트는 `notificationTapped` 로 수신(8.1.0+) — 필요 시 라우팅에 사용.
- **iOS**: 이 플러그인은 Android 전용(`cap sync` 가 iOS Package.swift 에 추가하지 않음, 정상). iOS 에서 호출하면 미구현 오류이므로 **반드시 `Capacitor.getPlatform() === 'android'` 가드 + 동적 import** 후 호출. `keep-awake` 는 iOS·Android 모두 `cap sync` 에 포함됨.
- **keep-awake**: `import { KeepAwake } from '@capacitor-community/keep-awake'` → `KeepAwake.keepAwake()` / `allowSleep()` / `isSupported()` / `isKeptAwake()`. 웹 구현도 있으나 네이티브에서만 호출(§2).

### A.4 `cap sync` 산출물 (T-J0 커밋에 포함)

- `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`: keep-awake + foreground-service 프로젝트 2개 추가.
- `ios/App/CapApp-SPM/Package.swift`: `CapacitorCommunityKeepAwake` 추가(foreground-service 는 Android 전용이라 없음).
- `capacitor.config.ts`: 변경 없음(플러그인 설정 불필요).

---

## 부록 B. Track A (Android) 결과 — T-A1 ~ T-A3

> 2026-10-20, `node_modules/@capacitor/android@8.3.4` 소스와 실제 `assembleDevDebug` 병합 Manifest 로 확인. 실기기 검증 전 단계.

### B.1 T-A1 — Manifest·리소스 (적용 완료)

- `AndroidManifest.xml`: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `WAKE_LOCK` 추가. `<service …AndroidForegroundService foregroundServiceType="connectedDevice" exported="false"/>` 선언. `location` 타입·`SYSTEM_ALERT_WINDOW` 는 넣지 않음. `POST_NOTIFICATIONS` 는 기존 선언 재사용.
- `res/drawable/ic_stat_mindbreeze.xml`: 24dp 벡터, 단색 흰색(물결 두 줄). **JS 의 `smallIcon` 값은 `'ic_stat_mindbreeze'`**.
- `res/values/strings.xml`: `bg_session_title`(명상 클래스 진행 중), `bg_session_channel_name`(수업 진행 알림) 추가. 플러그인은 JS 에서 문자열을 받으므로 현재는 참고용이며, Track J 가 문구를 하드코딩해도 무방(두 값은 일치시킬 것).
- 확인: 병합 Manifest(`merged_manifests/devDebug`)에 권한 3종과 서비스(`connectedDevice`)가 반영됨. 병합 후 `SYSTEM_ALERT_WINDOW`·`FOREGROUND_SERVICE_LOCATION` 없음.

### B.2 T-A2 — Capacitor 의 WebView 타이머 정지 여부 (소스 분석)

- 호출 경로: `BridgeActivity.onPause()` → `Bridge.onPause()` → `cordovaWebView.handlePause(keepRunning)`. `keepRunning = shouldKeepRunning() || activityResultCallback != null`.
- `Bridge.shouldKeepRunning()` 는 `preferences.getBoolean("KeepRunning", true)` — **기본 true**. 이 앱의 `capacitor.config.ts`·Manifest·리소스 어디에도 `KeepRunning=false` 설정이 없다.
- `MockCordovaWebViewImpl.handlePause`: `keepRunning` 이 false 일 때만 `setPaused(true)`(= `webView.onPause()` + `pauseTimers()`). **즉 Capacitor 는 액티비티 pause/stop 시 WebView 타이머를 멈추지 않는다.** `BridgeActivity` 의 다른 어디에서도 `pauseTimers`/`WebView.onPause` 를 호출하지 않음.
- `onResume` 에서는 `setPaused(false)`(= `onResume()`+`resumeTimers()`)를 항상 호출하므로 복귀 시 타이머는 확실히 재개된다.
- **결론: `MainActivity` 변경 없음(코드 수정 안 함).** `onPause` 후 `resumeTimers()` 를 추가해도 Capacitor 경로상 멈춘 적이 없으므로 효과가 없고, `resumeTimers` 는 앱 내 모든 WebView 에 영향을 주는 전역 호출이라 부작용만 남는다.
- **남은 위험(실기기에서만 확인 가능)**: Capacitor 가 아닌 **Chromium 렌더러 자체의 백그라운드 타이머 스로틀링**(화면 꺼짐/백그라운드 시 페이지 hidden → 타이머 1초 정렬, 5분 이후 intensive throttling 으로 분 단위 지연 가능). 오디오 재생·WebRTC(LiveKit) 연결이 있으면 완화되지만 보장되지 않는다. FGS 는 프로세스 우선순위만 올릴 뿐 이를 해제하지 못한다. 대응은 이미 plan §3.5(G6, BLE 콜백 기반 throttle flush)로 설계됨.
  - **실기기 판정(verify M3·M4)**: 화면 끄고 20분간 서버 raw 수신 간격이 주기 flush 간격(원래 값)을 유지하는지 확인. 분 단위로 늘어나면 스로틀링 확정 → G6 경로가 실제로 채우는지 확인하고, 부족하면 후속으로 `WebView` 가시성 유지(예: `webView.onResume()` 주기 호출은 비권장) 대신 **네이티브 쪽 flush 버퍼링**을 검토.

### B.3 T-A3 — SDK 버전 요건 (변경 없음)

| 항목 | 현재 | 요건 | 판정 |
|---|---|---|---|
| `compileSdkVersion` | 36 | `FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE`(API 29+)·Android 14 권한 상수 참조 가능 = 34+ | 충족 |
| `targetSdkVersion` | 36 | 34+ 이면 타입 선언 필수 정책이 적용되므로 선언이 **반드시** 필요(적용 완료). Play 신규 앱 요건도 충족 | 충족 |
| `minSdkVersion` | 24 | 플러그인은 SDK≥29 에서만 `serviceType` 전달(API 24~28 은 타입 없이 시작) | 문제 없음 |

- `build.gradle`·`variables.gradle` **수정 없음**.
- 참고(Android 15, targetSdk 35+): `connectedDevice` 타입은 `dataSync`/`mediaProcessing` 과 달리 **런타임 시간 제한(timeout)이 없다.** 단 Android 12+ 는 **앱이 백그라운드일 때 FGS 시작이 금지**되므로 반드시 수업 입장(포그라운드) 시점에 시작해야 한다(Track J: `EntryPage` 의 `wait|live` 진입 시 호출 — 계획과 일치).
- 런타임 선행조건(Track J): `connectedDevice` FGS 는 `BLUETOOTH_CONNECT` 등 런타임 권한이 허용돼 있어야 시작된다. 미허용 시 `SecurityException` → `startForegroundService` 호출부에서 try/catch 후 서비스 없이 계속(웹과 동일 동작) 처리 권장.

### B.4 배터리 최적화 설정 화면 이동 — 제안만 (구현 안 함)

- 기존 의존성(`@capacitor/app`, `bluetooth-le`, `capacitor-android-foreground-service`, `keep-awake`, `push-notifications` 등)에는 **Android 설정 인텐트를 여는 API 가 없다.** `App.openUrl` 은 URL 스킴용이라 `android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS` 를 안정적으로 열지 못한다.
- 필요하다고 Brian 이 판단하면(= 실기기 M3 에서 제조사 절전으로 서비스가 죽는 경우) **최소 구현안**: `MainActivity.java` 에 `@CapacitorPlugin(name="BatterySettings")` 내부 클래스 1개를 두고 `onCreate` 에서 `registerPlugin()`, 메서드 `openBatterySettings()` 가 `Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)`(권한 불필요, 실패 시 `ACTION_APPLICATION_DETAILS_SETTINGS` 로 폴백) 를 `startActivity`. JS 는 `registerPlugin<{openBatterySettings():Promise<void>}>('BatterySettings')` 로 호출. 이 경우 Track A 담당 파일(`MainActivity.java`) 안에서 끝나 다른 트랙과 겹치지 않는다.
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` 권한(다이얼로그 직접 요청)은 Play 정책 심사 위험으로 **쓰지 않는다**(plan §2 유지).
- 현 시점 판단: FGS(connectedDevice) 만으로 대부분 기기에서 유지될 것으로 예상되므로 **실기기 결과가 나오기 전까지 구현하지 않는다.** T-J9 의 안내 모달은 우선 문구 안내만(설정 앱 수동 이동) 두고, 버튼 동작은 이 제안이 승인되면 연결.

### B.5 빌드 검증 기록

- `frontend` 에서 `npm install --legacy-peer-deps` 후, 빌드를 위해 `dist/index.html` 더미와 `npx cap sync android` 를 실행(생성물은 모두 gitignore 대상, 추적 파일 변경 없음). `cd frontend/android && ./gradlew assembleDevDebug` → **BUILD SUCCESSFUL**, `app/build/outputs/apk/dev/debug/app-dev-debug.apk` 생성.

### B.6 실기기 필요 항목 (Track A 관련)

1. Android 14 이상 실기기에서 `startForegroundService(serviceType=16)` 가 예외 없이 시작되고 알림이 **조용히**(LOW) 표시되는지 — verify V22/M 계열.
2. 화면 끄고 5분·20분: BLE 유지, WebView 타이머 스로틀링 여부(B.2) — M3·M4.
3. 제조사 절전(삼성 등)에서 서비스가 죽는지 → 죽으면 B.4 구현 여부 결정.
4. `BLUETOOTH_CONNECT` 거부 상태에서 FGS 시작 실패 처리 — Track J 가드 확인.
