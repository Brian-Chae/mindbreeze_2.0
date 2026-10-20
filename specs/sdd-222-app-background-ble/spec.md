# SDD-222 — 앱 백그라운드 BLE·서버 통신 유지

- 상태: Stage ① Spec — Brian go/no-go 대기 (결정 D1·D2 확정 반영)
- 브랜치: `sdd/222-app-background-ble`
- 작성일: 2026-10-20
- 범위: `frontend/` (Capacitor iOS/Android 앱) + 네이티브 프로젝트(`frontend/ios`, `frontend/android`). **백엔드·웹 동작 변경 없음.**

## 1. 문제

회원이 앱에서 명상 클래스에 참여하는 도중 화면이 꺼지거나 앱이 백그라운드로 가면 다음이 끊긴다.

- LINK BAND BLE 수신(EEG 250Hz) — 앱 프로세스가 중단/스로틀되면 notify 콜백이 멈춘다.
- 서버 통신 — Socket.IO(`useSessionLiveSocket`, 30초 heartbeat)와 EEG raw 업로드(`useEegRawUpload`, `setInterval` flush)는 WebView JS 타이머에 의존한다. 백그라운드에서 타이머가 스로틀·정지된다.

결과: 수업 중 뇌파 기록이 빈 구간으로 남고, 참여 상태(출석·실시간 평균)가 끊겨 리포트 품질이 떨어진다.

**대상은 앱(Capacitor)만이다. 웹은 제외하며 기존 동작을 바꾸지 않는다.**

## 2. 현황 (코드 조사)

| 영역 | 현재 상태 | 근거 |
|---|---|---|
| iOS | `Info.plist` 에 `UIBackgroundModes` 없음 | `ios/App/App/Info.plist` |
| Android | Foreground Service·`FOREGROUND_SERVICE*` 권한 없음. `MainActivity` 는 빈 `BridgeActivity` | `AndroidManifest.xml`, `MainActivity.java` |
| 화면 꺼짐 방지 | `useWakeLock` 은 웹 Screen Wake Lock 전용. 백그라운드·잠금 시 브라우저가 해제 | `src/hooks/useWakeLock.ts` (호출: `EntryPage`, `ClassPlayerPage`) |
| BLE 재연결 | 어댑터는 끊김 시 `connectionLost` 콜백만 호출. `useBand` 에 고정 1.5초 1회 재시도가 있으나 실패하면 `connect()` 의 catch 가 `disconnect()` → `autoReconnectRef=false` 로 **재시도가 멈춘다** | `capacitor-ble-adapter.ts`, `useBand.ts` 986-996·1166-1185 |
| 앱 생명주기 | `@capacitor/app` 설치됨, `push.ts` 에서만 사용. `appStateChange` 처리 없음 | `src/lib/native/push.ts` |
| 소켓 | `reconnection: Infinity`(500ms~5s 백오프) 설정은 있으나, 백그라운드 복귀 직후 즉시 재연결·재join 보장 없음. 타이머는 백그라운드에서 멈춤 | `src/lib/socket.ts` 417-426 |
| raw 업로드 | IndexedDB 큐 + `setInterval` flush. 복귀 시 즉시 flush 트리거 없음 | `useEegRawUpload.ts` 328-351 |
| 데이터 유실 특성 | 밴드는 자체 저장소가 없어 **BLE 가 끊긴 구간은 영구 유실**. 복구 가능한 것은 이미 영속화된(클라이언트 큐·서버) 데이터의 시스템 오류 처리뿐 | 제품 제약 |

## 3. 확정 결정 (Brian)

| ID | 결정 |
|---|---|
| D1 | **Android 는 Foreground Service 사용.** 알림 문구 `명상 클래스 진행 중`, 탭하면 앱 복귀, 알림이 떠도 무방, 채널 중요도 낮음(LOW) |
| D2 | **iOS `UIBackgroundModes` 에 `bluetooth-central` 과 `audio` 둘 다 추가.** 온라인 수업은 음성 전달이 필수. `AVAudioSession` 카테고리는 `playback` |

## 4. 목표 / 비목표

### 목표 (In)
1. **G1 재개 처리**: `appStateChange`(포그라운드 복귀) 시 소켓 재연결·재join, 미전송 raw 청크 즉시 flush, BLE 연결 상태 확인.
2. **G2 BLE 자동 재연결**: 지수 백오프로 끊긴 밴드를 재연결. 끊김 구간(시작·종료·길이)을 로그로 남긴다.
3. **G3 화면 꺼짐 방지(네이티브 한정)**: 앱에서는 keep-awake 플러그인 사용. 웹은 기존 `useWakeLock` 유지.
4. **G4 iOS 백그라운드**: `bluetooth-central` + `audio` + `AVAudioSession(playback)`.
5. **G5 Android Foreground Service**: `connectedDevice` 타입. 권한 `FOREGROUND_SERVICE`·`FOREGROUND_SERVICE_CONNECTED_DEVICE`. 클래스 시작 시 켜고 종료 시 끈다. 배터리 최적화 제외 안내.
6. **G6 타이머 스로틀 대비**: BLE 콜백 시점에도 flush 를 병행(타이머가 멈춰도 데이터 수신이 살아 있는 한 업로드 진행).

### 비목표 (Out)
- 웹(브라우저) 백그라운드 유지, PWA 백그라운드 동기화.
- BLE 끊긴 구간 데이터 복구(밴드 저장소 없음 — 불가).
- 호스트(상담사) 측 송출 화면 백그라운드 유지. **회원 앱 수업 참여 경로만** 대상(호스트 화면은 후속 판단).
- 백엔드/API/DB 변경. 네이티브 푸시 변경.
- LINK BAND 펌웨어 변경.

## 5. 사용자 시나리오

1. 회원이 앱에서 수업 입장 → 밴드 연결 → 명상 시작. 화면이 자동으로 꺼지지 않는다(G3).
2. 전원 버튼으로 화면을 꺼도 BLE 수신·업로드·소켓이 유지된다(G4/G5). Android 는 상단에 `명상 클래스 진행 중` 알림이 낮은 중요도로 표시되고, 탭하면 앱으로 돌아온다.
3. 다른 앱으로 전환했다가 복귀하면 즉시 소켓이 재연결되고 미전송 데이터가 올라간다(G1).
4. 밴드가 잠깐 끊기면 앱이 알아서 재연결하고 끊김 구간이 기록된다(G2).
5. 수업 종료/이탈 시 Foreground Service 가 반드시 종료되고 알림이 사라진다(G5).
6. 밴드 미착용(opt-in 안 함) 회원도 영향 없이 수업 참여. Foreground Service 는 밴드 연결 여부와 무관하게 **수업 진행 중**에 켠다(소켓·업로드 유지 목적). 단 EEG 관련 로직은 기존대로 `if (bandConnected)` 가드 내에서만 실행한다.

## 6. 플랫폼 제약·위험

| ID | 내용 | 대응 |
|---|---|---|
| R1 | iOS WKWebView 는 백그라운드에서 JS 가 중단될 수 있음. `bluetooth-central`/`audio` 모드가 있어도 보장 수준은 기기·OS 별로 다름 | 실기기 20분 검증(verify M 항목)으로 확정. 미달 시 BLE 콜백 flush(G6) 의존도를 높이고 결과를 summary 에 기록 |
| R2 | LiveKit 음성(WebRTC)이 iOS 백그라운드에서 유지되는지 | `audio` 모드 + AVAudioSession playback 설정 후 실기기 확인. 유지 안 되면 후속 SDD 로 분리 |
| R3 | Android 14+ Foreground Service 타입 선언·권한(`FOREGROUND_SERVICE_CONNECTED_DEVICE`)은 BLE 권한(`BLUETOOTH_CONNECT`) 보유 시에만 시작 가능 | 서비스 시작 전 BLE 권한 확인. 알림 권한(`POST_NOTIFICATIONS`)은 이미 선언됨 — 거부 시에도 서비스 동작은 유지되나 알림 노출만 제한 |
| R4 | 제조사별 배터리 최적화(삼성·샤오미 등)가 서비스를 죽일 수 있음 | 배터리 최적화 제외 안내 UX(설정 화면 이동) 제공 |
| R5 | 스토어 심사: iOS `audio` 모드는 실제 오디오 재생 목적이 입증돼야 하고, Android `connectedDevice` 타입 사용 사유 신고 필요 | 사유 문구를 plan §8 에 정리. 제출은 Brian 승인 후 |
| R6 | 개인정보: 백그라운드에서도 뇌파 수집이 이어짐 | 기존 LINK BAND opt-in 동의 범위 내에서만 동작. 동의 안 한 경우 수집 경로 불가동. 안내 문구에 백그라운드 수집 포함 여부는 plan 에서 확인 |

## 7. QA 요약 (상세는 `verify.md`)

| # | 수락 기준 | 구분 |
|---|---|---|
| Q1 | 화면을 끄고 5분·20분 후에도 서버에 EEG raw·참여 상태가 이어서 기록된다 | 실기기 |
| Q2 | 앱 전환·복귀 시 소켓 재연결, 미전송 청크 flush 가 즉시 일어난다 | vitest + 실기기 |
| Q3 | 비행기 모드 후 복귀하면 큐에 쌓인 데이터가 유실 없이 전송된다 | vitest + 실기기 |
| Q4 | BLE 끊김 시 지수 백오프로 재연결하고 끊김 구간이 기록된다 | vitest + 실기기 |
| Q5 | Android 알림 탭으로 앱에 복귀하고, 수업 종료 시 서비스·알림이 사라진다 | 실기기 |
| Q6 | 웹 빌드는 동작·번들 의존성 회귀가 없다 | vitest + 빌드 + 수동 |

## 8. 확인 필요(Brian)

- 호스트(상담사) 화면 백그라운드 유지는 이번 범위에서 제외해도 되는지 (제안: 제외, 후속).
- 스토어 제출 시 iOS `audio`·Android `connectedDevice` 사유 문구 승인.
