# [MB261026][FIX] Facebook SDK 제거·개인정보 매니페스트 정합 — Verify (구현 전)

요청: APP 창구, Brian 10/26 승인("제출 전 남은 항목 모두 처리"). D7(`docs/reviews/store-review-prep-20261023/07-대표님결정.md`): Facebook SDK 제거, `audio` 백그라운드는 사용 입증 안 되면 제거, 연구 선택 활용은 "기타 목적" 신고.
범위 밖: 실제 심사 제출·스토어 업로드, SDD-246 네이티브 측정 코드(`ios/MeasurementKit`, `android/.../measurement/`, LIVE_PROTOCOL_V2).

## 원인 분석 (수정 전 기준선, 2026-10-26 이 워크트리에서 측정)

### A. Facebook SDK·광고 ID 권한 유입
- 출처: `@capgo/capacitor-social-login@8.5.13`. 앱은 Google·Apple만 쓴다(`frontend/src/lib/native/google.ts:22-33` — `SocialLogin.initialize`에 google·apple만, `src/`에 facebook 참조 0건).
- 플러그인은 공급자 기본값이 전부 활성(`scripts/configure-dependencies.js` `defaultProviders`). 우리 `capacitor.config.ts`에 `plugins.SocialLogin.providers`가 없어 Facebook이 켜진 채로 빌드된다.
- Android 기준선: `./gradlew :app:dependencies --configuration prodReleaseRuntimeClasspath`에 `com.facebook.android:facebook-login/core/common/bolts:18.1.3`. 병합 매니페스트(`processProdReleaseManifest -PallowUnsignedRelease=true`) blame 리포트에서
  `com.google.android.gms.permission.AD_ID`, `ACCESS_ADSERVICES_{AD_ID,ATTRIBUTION,CUSTOM_AUDIENCE,TOPICS}` 5개 모두 `facebook-core:18.1.3`이 추가. facebook 요소(Activity·Receiver·queries) 8개.
- iOS 기준선: 플러그인 `Package.swift`가 `facebook-ios-sdk`(FacebookCore·FacebookLogin)를 직접 의존. 앱 `Package.resolved:41`에 `facebook-ios-sdk` 핀.
- 플러그인 공식 해법(README "Provider configuration"): `plugins.SocialLogin.providers.facebook=false` → `cap sync` 전 훅이 Android `gradle.properties`(`socialLogin.facebook.include=false`)와 iOS `Package.swift`(facebook 의존 주석 처리)를 바꾼다. Android는 `src/facebookDisabled` 스텁을 컴파일해 `com.facebook.*` 클래스가 남지 않는다. iOS 소스는 `#if canImport(FBSDKLoginKit)`로 감싸져 있어 의존 제거 후에도 컴파일된다.
- 함정: 훅은 `node_modules`를 고친다. `npm ci` 직후 `cap sync` 없이 gradle/xcodebuild를 돌리면 기본값(Facebook 켜짐)으로 돌아간다. 우리 빌드 스크립트(`cap:*`, `android:bundle:prod`)는 모두 `cap sync`를 거치지만, 방어선을 하나 더 둔다(아래 수정 2·3).

### B. PrivacyInfo.xcprivacy 불일치
- 현재 11유형, 목적은 전부 AppFunctionality. APP 초안(ASC 저장 13유형, `store-readiness-20261025/privacy-mapping-status.json`)과 코드 수집 경로 대조 결과:
  - 매니페스트에만 있음: `SensitiveInfo` — APP는 EEG/PPG를 "건강"으로 신고하고 민감 정보는 미선택(콘솔 정의가 EEG/PPG를 명시하지 않음).
  - APP에만 있음: 채팅(`EmailsOrTextMessages`, `backend/app/models/chat.py`), 제품 상호작용(`ProductInteraction`, 클래스 참여 기록), 기타 데이터(`OtherDataTypes`, 성별·생년월 — `models/research.py:38-39`, `client_profile.py:18-19` 등).
  - 목적: 선택 연구 활용(연구 동의자) 대상 = 생체신호·성별·생년월·측정 시각·프로그램 정보·가명 참여자 ID·진행자 실명/계정 ID/역할(`backend/app/services/research_export_service.py:85-88`). 이 유형들에 `Other` 목적이 빠져 있다.
- Required Reason API: 앱·로컬 패키지·플러그인 소스(Swift/ObjC) 스캔 결과 `UserDefaults`만 사용(`ios/App/App/Measurement/MeasurementHost.swift:97`, `MeasurementKit/Fencing.swift:10`, social-login Apple/Twitter/Telegram 공급자). 파일 타임스탬프·부팅 시간·디스크 용량·키보드 API 0건 → 기존 `CA92.1` 선언 하나로 충분(변경 없음).

### C. 백그라운드 권한
- iOS `UIBackgroundModes`
  - `bluetooth-central`: `ios/MeasurementKit/Sources/MeasurementKit/BandBLE.swift:84`(복원 식별자 포함 CBCentralManager), WebView 경로 `@capacitor-community/bluetooth-le`. 유지.
  - `audio`: `ios/App/App/AppDelegate.swift:25-33` playback 세션 + 실제 들리는 오디오 — 진행자 BGM·가이드 음원(`src/hooks/useClassAudioPlayer.ts`→`lib/class/audio-engine`), 온라인 수업 음성(`RoomAudioRenderer`: `components/class/player/host/HostLiveKitBridge.tsx:90`, `components/class/player/member/MemberMediaControls.tsx`). 코드상 사용 근거가 있어 유지. 단 SDD-222 실기기 M8(잠금 중 음성 유지)은 미수행 → summary에 Brian 결정 항목으로 남긴다.
- Android FGS
  - `AndroidForegroundService` `connectedDevice|microphone`: `src/lib/native/background-session.ts:99-119`, microphone은 진행자 온라인 수업만(`src/hooks/useBackgroundSession.ts:40-45`, `useHostBackgroundSession.ts:16`).
  - `MeasurementService` `connectedDevice`: `measurement/MeasurementService.kt:147`. `WAKE_LOCK`: `MeasurementManager.kt:76-77` + keep-awake 플러그인(`src/hooks/useWakeLock.ts:36-38`).
  - 앱이 직접 선언한 권한 중 미사용 0건 → 제거 없음.

## 수정 계획
1. `frontend/capacitor.config.ts`: `plugins.SocialLogin.providers = { google: true, facebook: false, apple: true }`.
2. `frontend/android/gradle.properties`: `socialLogin.facebook.include=false`(+`dependencyType=compileOnly`) — `cap sync` 없이 gradle을 돌려도 Facebook이 다시 들어오지 않게 하는 방어선(루트 속성은 하위 프로젝트에 상속).
3. `frontend/android/app/src/main/AndroidManifest.xml`: `AD_ID`·`ACCESS_ADSERVICES_*` 4종 `tools:node="remove"` — 앞으로 다른 SDK가 광고 ID 권한을 몰래 병합해도 빠지게 한다(앱은 광고 ID를 쓰지 않음).
4. iOS: `npx cap sync ios`(훅이 플러그인 Package.swift에서 Facebook 제거) → `xcodebuild -resolvePackageDependencies`로 `Package.resolved` 재생성(`facebook-ios-sdk` 핀 삭제).
5. `frontend/ios/App/App/PrivacyInfo.xcprivacy`: `SensitiveInfo` 제거, `EmailsOrTextMessages`·`ProductInteraction`·`OtherDataTypes` 추가, 연구 대상 유형(Name·UserID·Health·ProductInteraction·OtherDataTypes)에 `Other` 목적 추가. Tracking=false 유지.
6. 정적 가드 테스트 `frontend/tests/fix-store-native-privacy.test.ts`.

## 검증 시나리오
| # | 종류 | 시나리오 | 통과 기준 |
|---|---|---|---|
| V1 | 계약(vitest, RED→GREEN) | capacitor.config의 SocialLogin.providers.facebook=false, google·apple=true | 수정 전 실패 → 수정 후 통과 |
| V2 | 계약 | 루트 gradle.properties에 `socialLogin.facebook.include=false` | 동일 |
| V3 | 계약 | AndroidManifest에 AD_ID·ADSERVICES 4종 `tools:node="remove"` | 동일 |
| V4 | 계약 | Package.resolved에 `facebook-ios-sdk` 0건 | 동일 |
| V5 | 계약 | PrivacyInfo: 13유형 정확히 일치, SensitiveInfo 없음, Tracking=false·도메인 0, 연구 5유형에 Other 목적, 나머지는 AppFunctionality만, UserDefaults CA92.1 유지 | 동일 |
| V6 | 계약 | SDD-222 기존 테스트(UIBackgroundModes 2종, FGS 타입) 그대로 통과 — 백그라운드 설정 무변경 | 통과 |
| V7 | 실측 Android | `cap sync android` 후 `:app:dependencies`(prodReleaseRuntimeClasspath)에 facebook 0건 | 0건 |
| V8 | 실측 Android | `processProdReleaseManifest` 병합 결과에 `AD_ID`·`ADSERVICES` 0건, facebook 문자열 0건, Google 로그인 관련(`USE_CREDENTIALS`, credentials-play-services-auth) 유지 | 0건 / 유지 |
| V9 | 실측 Android | 훅 없이(플러그인 gradle.properties 삭제 상태) 의존성 확인 → 루트 방어선만으로 facebook 0건 | 0건 |
| V10 | 실측 iOS | `-resolvePackageDependencies` 후 resolved 목록에 facebook 0건, GoogleSignIn 유지 | 0건 / 유지 |
| V11 | 실측 iOS | 시뮬레이터 `xcodebuild build CODE_SIGNING_ALLOWED=NO` 성공, 빌드 산출물(앱 바이너리·Frameworks)에 FBSDK/Facebook 심볼·번들 0건, GoogleSignIn 링크됨 | 성공·0건 |
| V12 | 회귀 | `npm run build` 통과, vitest 관련 파일 통과, Android `testDevDebugUnitTest` 통과 | 통과 |
| V13 | 기능 | Google/Apple 로그인 코드 경로 무변경(`src/lib/native/*` diff 0), 플러그인 Google·Apple 공급자 enabled 로그 | 확인 |

미실시 예정(기기 필요): 실기기 Google/Apple 로그인 왕복, Archive Privacy Report, AAB 업로드 후 Play 사전 검사.
