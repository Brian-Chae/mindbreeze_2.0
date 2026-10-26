# [MB261026][FIX] Facebook SDK 제거·개인정보 매니페스트 정합 — Summary

기준: `origin/develop` 3bf4c75e(SDD-246 머지본), 브랜치 `fix/store-native-privacy`. 원인 분석·검증 계획: `verify.md`.

## 결론
- 안 쓰는 Facebook SDK를 플러그인 공식 설정(`SocialLogin.providers.facebook=false`)으로 Android·iOS 둘 다에서 뺐다. Android 병합 매니페스트의 `AD_ID`·`ACCESS_ADSERVICES_*` 4종이 0건, AAB dex의 `com/facebook` 참조 0건, iOS 앱 바이너리의 FBSDK 심볼 0건을 빌드 산출물에서 직접 확인했다.
- Google·Apple 로그인 코드는 바꾸지 않았다(`src/lib/native/*` diff 0). 빌드 산출물에 Google·Apple 공급자가 그대로 들어 있다(아래 V13). 실기기 로그인 왕복은 하지 않았다.
- PrivacyInfo.xcprivacy를 APP 창구의 App Store Connect 저장본(13유형)과 맞췄다. 연구 활용 대상 5유형에는 "기타 목적(Other)"을 더했다.
- 백그라운드 권한(iOS `bluetooth-central`·`audio`, Android FGS·WAKE_LOCK)은 모두 실제 사용 코드가 있어 하나도 지우지 않았다. `audio`는 실기기 검증 기록이 없어 Brian 결정 항목으로 남긴다.

## 변경 파일
| 파일 | 변경 |
|---|---|
| `frontend/capacitor.config.ts` | `plugins.SocialLogin.providers = { google: true, facebook: false, apple: true }` |
| `frontend/android/gradle.properties` | `socialLogin.facebook.include=false`, `dependencyType=compileOnly`. cap sync 훅을 거치지 않은 빌드를 막는 방어선 |
| `frontend/android/app/src/main/AndroidManifest.xml` | `AD_ID`, `ACCESS_ADSERVICES_{AD_ID,ATTRIBUTION,CUSTOM_AUDIENCE,TOPICS}`에 `tools:node="remove"` 적용 |
| `frontend/ios/App/App.xcodeproj/.../Package.resolved` | `facebook-ios-sdk` 18.1.1 핀 삭제(`xcodebuild -resolvePackageDependencies` 결과, 다른 핀은 그대로) |
| `frontend/ios/App/App/PrivacyInfo.xcprivacy` | 11유형 → 13유형, 목적 보완(아래 표) |
| `frontend/tests/fix-store-native-privacy.test.ts` | 정적 가드 12건(V1~V5) |

## 제거된 권한·의존성 (전 → 후, 실측)
| 항목 | 수정 전 | 수정 후 | 근거 |
|---|---|---|---|
| Android `prodReleaseRuntimeClasspath`의 facebook | `facebook-login/core/common/bolts 18.1.3` (5줄) | 0 | `./gradlew :app:dependencies` |
| `com.google.android.gms.permission.AD_ID` | 있음(facebook-core가 추가) | 없음 | 병합 매니페스트·blame 리포트 |
| `ACCESS_ADSERVICES_AD_ID` / `_ATTRIBUTION` / `_CUSTOM_AUDIENCE` / `_TOPICS` | 있음(facebook-core) | 없음 | 위와 같음 |
| `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` | 있음(`installreferrer:1.0`, Facebook 전이 의존) | 없음 | 위와 같음 |
| 매니페스트의 facebook 요소(Activity·Receiver·queries) | 8개 | 0 | 위와 같음 |
| AAB(`bundleProdRelease`, 서명 없는 검증용) dex의 `Lcom/facebook/` | (기준선 AAB는 만들지 않음) | 0 | `unzip`+`strings` |
| 훅 없이 루트 방어선만 둔 상태 | — | facebook 0 | 플러그인 gradle.properties를 지우고 의존성 확인 |
| iOS `Package.resolved` | `facebook-ios-sdk` 핀 있음 | 없음 | resolve 결과 |
| iOS 시뮬레이터 Release 앱 | (플러그인이 FacebookCore·FacebookLogin 제품에 직접 의존) | 번들 파일 0, 바이너리 FBSDK 심볼 0, `otool -L` 0 | `xcodebuild build CODE_SIGNING_ALLOWED=NO` |
| iOS IDFA·ATT 참조 | — | `ASIdentifierManager`·`ATTrackingManager`·AppMeasurement 심볼 0 | `nm` |

- 남은 권한은 모두 기존 기능에서 온다. `USE_CREDENTIALS`·`USE_BIOMETRIC`·`USE_FINGERPRINT`는 Google 로그인(credentials-play-services-auth·androidx.biometric), `ACCESS_NETWORK_STATE`·`RECEIVE_BOOT_COMPLETED`·`c2dm.RECEIVE`는 FCM 푸시와 WorkManager에서 온다. 이번 범위에서는 손대지 않았다.
- iOS 바이너리에 있는 `FacebookProvider` 심볼 22개와 `FBLPromises` 번들은 Facebook SDK가 아니다. 앞의 것은 플러그인 자체 스텁 클래스이고(`#if canImport(FBSDKLoginKit)` 밖), 뒤의 것은 Google `promises` 라이브러리다.

## PrivacyInfo.xcprivacy 변경
| 유형 | 수정 전 | 수정 후 | 근거 |
|---|---|---|---|
| Name | AppFunctionality | + Other | 연구 내보내기의 진행자 실명(`research_export_service.py:88`) |
| EmailAddress | AppFunctionality | 변경 없음 | 계정 |
| PhoneNumber | AppFunctionality | 변경 없음 | `models/user.py:122`, `signup_application.py:29` |
| PhysicalAddress | AppFunctionality | 변경 없음 | `models/organization.py:23`(기관 주소). APP 저장본과 같음 |
| Health | AppFunctionality | + Other | EEG·PPG, 연구 내보내기 대상 |
| SensitiveInfo | AppFunctionality | **삭제** | APP 결정: EEG·PPG는 "건강"으로 신고하고 민감 정보는 선택하지 않음(콘솔 정의에 EEG·PPG가 명시되어 있지 않음) |
| EmailsOrTextMessages | 없음 | **추가**(AppFunctionality) | 채팅 `models/chat.py`. APP "이메일 또는 문자 메시지" |
| PhotosorVideos / AudioData / OtherUserContent | AppFunctionality | 변경 없음 | 동의한 녹화·녹음, 사용자 콘텐츠 |
| UserID | AppFunctionality | + Other | 가명 참여자 ID·진행자 계정 ID(`research_export_service.py:85-88`) |
| DeviceID | AppFunctionality | 변경 없음 | 푸시 토큰 `models/device_token.py`, 측정 인스턴스 ID |
| ProductInteraction | 없음 | **추가**(AppFunctionality + Other) | 클래스 참여 기록. 연구에는 측정 시각·프로그램 정보로 들어감 |
| OtherDataTypes | 없음 | **추가**(AppFunctionality + Other) | 성별·생년월(`models/research.py:38-39`, `client_profile.py:18-19`) |
| 전 유형 | Linked=true, Tracking=false | 같음 | — |
| `NSPrivacyTracking` / 도메인 | false / 없음 | 같음 | Facebook 제거 후 추적 SDK 없음(위 실측) |
| Required Reason API | UserDefaults `CA92.1` | 같음 | 앱·MeasurementKit·플러그인 소스 스캔 결과 UserDefaults만 사용(`MeasurementHost.swift:97`, `Fencing.swift:10`). 파일 타임스탬프·부팅 시간·디스크 용량·키보드 API는 0건. 서드파티(Firebase·GoogleSignIn·Capacitor 등)는 각자 PrivacyInfo를 번들에 포함함(빌드 산출물에서 22개 확인) |

### APP 초안과의 남은 불일치
| # | 항목 | 내용 | 처리 |
|---|---|---|---|
| M1 | Play 데이터 보안 "기타 정보"의 목적 | Play 초안은 "사기 예방·보안·규정 준수·계정 관리"이고, Apple 매니페스트는 AppFunctionality+Other(연구) | 스토어 콘솔 입력은 APP 창구 몫. Play의 성별·생년월 목적에 연구가 없는 점은 기존 open point와 같음 |
| M2 | Play "AD_ID 사용 여부 미확정" | 이번 수정으로 AD_ID 권한 0건이 확정됨 | APP 창구가 Play 광고 ID 선언에 "사용 안 함"으로 반영 |
| M3 | ASC 유형별 "추적 여부" 미저장 | 매니페스트는 전 유형 Tracking=false이고 추적 SDK 0건을 실측함 | APP 창구가 ASC에서 "추적 안 함"으로 저장 가능 |

## 백그라운드 권한 정당성 (전부 유지)
| 권한·모드 | 실제 사용 근거 | 판단 |
|---|---|---|
| iOS `bluetooth-central` | `ios/MeasurementKit/Sources/MeasurementKit/BandBLE.swift:84`(복원 식별자 CBCentralManager), WebView 경로 `@capacitor-community/bluetooth-le` | 유지 |
| iOS `audio` | `ios/App/App/AppDelegate.swift:25-33` playback 세션. 실제로 소리가 나는 경로: 진행자 BGM·가이드 음원 `src/hooks/useClassAudioPlayer.ts`→`lib/class/audio-engine`, 온라인 수업 음성 `RoomAudioRenderer`(`components/class/player/host/HostLiveKitBridge.tsx:90`, `components/class/player/member/MemberMediaControls.tsx`) | 유지(코드 근거 있음). 실기기 M8(잠금 중 음성 유지)은 SDD-222에서도 하지 않음 → Brian 결정 |
| Android FGS `connectedDevice`(capawesome) | `src/lib/native/background-session.ts:99-119`, 회원 `pages/class/EntryPage.tsx:228`, 진행자 `pages/sessions/ClassPlayerPage.tsx:861` | 유지 |
| Android FGS `microphone` | 진행자 온라인 수업일 때만(`src/hooks/useBackgroundSession.ts:40-45`, `useHostBackgroundSession.ts:16`) | 유지 |
| Android `MeasurementService` `connectedDevice` | `measurement/MeasurementService.kt:147`(SDD-246, 건드리지 않음) | 유지 |
| `WAKE_LOCK` | `measurement/MeasurementManager.kt:76-77`, keep-awake `src/hooks/useWakeLock.ts:36-38` | 유지 |
| `MODIFY_AUDIO_SETTINGS`·`RECORD_AUDIO`·`CAMERA` | 화상 클래스(WebView WebRTC) | 유지 |

## 테스트 결과
| # | 결과 |
|---|---|
| V1~V5 | 새 가드 12건: 수정 전 10건 실패(RED, 기존 유지 항목 2건은 통과) → 수정 후 12건 통과 |
| V6 | `sdd222-native-config` 통과(백그라운드 설정 변경 없음) |
| V7·V8·V9 | 위 "제거된 권한·의존성" 표 |
| V10·V11 | resolve 성공(facebook 0, GoogleSignIn 9.2.0), 시뮬레이터 Release 빌드 `BUILD SUCCEEDED`, 번들된 PrivacyInfo 13유형 |
| V12 | `npm run build` 통과. Android `testDevDebugUnitTest` 125건 통과(실패·오류 0). `bundleProdRelease -PallowUnsignedRelease=true` 성공. 전체 vitest: 아래 |
| V13 | cap sync 로그 Google·Apple enabled. AAB dex `GoogleProvider` 참조 22, iOS `GIDSignIn` 심볼 228·`AppleProvider` 222·`ASAuthorizationAppleIDProvider` 참조 있음 |

- 전체 vitest: 3282 통과 / 17 실패(8파일) / 1 skip. 실패 파일은 agent-counselor-page, chat-message-deeplink, org-counselor-management-browser, org-management-browser, report-modal-pdf, report-server-pdf, sdd234-a-mobile-home, sdd220-native-release. 앞의 7개는 이번 변경 파일(capacitor.config·PrivacyInfo·gradle.properties·AndroidManifest·Package.resolved)을 읽지 않는다(grep 0건). 다른 FIX 카드에 기록된 기준선(17건/8파일)과 수치가 같다.
- 기존 실패(이번 변경과 무관): `tests/sdd220-native-release.test.ts`의 TS1·TS29가 빌드 번호 `CURRENT_PROJECT_VERSION = 2`와 versionCode `"2"`를 단언하는데, 현재 값은 4·5다(SDD-246 등에서 올림). 이번에 건드리지 않은 `project.pbxproj`·`app/build.gradle` 대상이라 그대로 두었다.

## 디버깅 메모·함정
- 플러그인 훅(`capacitor:sync:before`)은 `node_modules/@capgo/capacitor-social-login`의 `android/gradle.properties`와 `Package.swift`를 직접 고친다. 그래서 `npm ci`를 하면 원래대로 돌아간다. 스토어 빌드는 반드시 `cap sync`를 거쳐야 한다. 기존 `cap:*`·`android:bundle:prod` 스크립트는 이미 그렇게 되어 있다.
  - Android는 루트 `gradle.properties` 방어선이 있어 `cap sync` 없이도 Facebook이 빠진다(V9 실측).
  - iOS는 방어선이 없다. `npm ci` 뒤 `cap sync ios` 없이 Xcode를 열면 플러그인 Package.swift가 facebook을 다시 요구하고, Xcode가 Package.resolved에 facebook 핀을 다시 추가한다. 이때 `tests/fix-store-native-privacy.test.ts` V4가 실패해 알려 준다.
- iOS 로컬 빌드에는 gitignore된 `ios/MeasurementKit/Frameworks/MeasurementCoreFFI.xcframework`(SDD-246, `scripts/build-core-xcframework.sh`)와 `GoogleService-Info.plist`가 필요하다. 이번 검증에서는 빌드 확인용으로 빈 placeholder plist를 잠깐 두었다가 지웠다. 운영 plist는 열지 않았다.
- Android release 작업은 서명 설정이 없으면 막힌다. 매니페스트·AAB 검증은 `-PallowUnsignedRelease=true`(배포 불가 산출물)로 했다.

## 남은 Brian 결정
1. iOS `audio` 백그라운드 모드 유지 여부. 코드상 들리는 오디오(BGM·가이드 음원·수업 음성)가 있어 유지했다. D7은 "입증 안 되면 제거"인데, 실기기 증빙(잠금 중 음성 유지, SDD-222 M8)이 아직 없다. 심사 전에 실기기 확인을 할지, 아니면 진행자 백그라운드 음성 유지를 포기하고 제거할지 정해야 한다.
2. `SensitiveInfo` 미신고 확정. APP 결정(건강으로 신고)을 따랐다. 뇌파를 "생체 데이터"로 보수적으로 신고하려면 매니페스트와 ASC를 함께 되돌려야 한다.

## 미실시
- 실기기 Google·Apple 로그인 왕복, iOS Archive와 Xcode Privacy Report, 서명된 AAB의 Play 사전 검사, 스토어 콘솔 입력(APP 창구 몫), 머지·배포.
