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
| Required Reason API | UserDefaults `CA92.1` | 같음 | **정정**: 처음에는 Swift/ObjC 소스만 스캔해 "파일 타임스탬프 API 0건"이라고 썼으나 틀렸다. App 실행 파일(정적 링크된 Rust 측정 코어 포함)에 `_fstat` import가 있다. 바이너리 기준 재검증 결과와 판단은 아래 "Required Reason API 바이너리 재검증"에 있다. 서드파티(Firebase·GoogleSignIn·Capacitor 등)는 각자 PrivacyInfo를 번들에 포함하지만(빌드 산출물에서 22개 확인), 그 선언이 App 바이너리 자체 호출의 근거가 되지는 않는다 |

### Required Reason API 바이너리 재검증 (감독 요청, 2026-10-26)
대상: 시뮬레이터 Release 빌드 `App.app/App`(arm64 simulator). **최종 arm64 iphoneos 배포본은 검증하지 않았다.** 이 결과로 배포본 결과를 대신할 수 없다.

**Required Reason 범주별 바이너리 import (`nm -u`)**
| 범주 | 심볼 | 호출 위치(역어셈블) | 판정 |
|---|---|---|---|
| File timestamp | `_fstat` | Rust std 두 곳(아래 경로 1·2) | API 심볼 있음. 타임스탬프 필드는 읽지 않음(아래) |
| File timestamp | `stat`·`lstat`·`fstatat`·`getattrlist*` | 없음 | — |
| System boot time | `mach_absolute_time`·`systemUptime` | 없음 | — |
| (관찰) | `_clock_gettime_nsec_np` | `MeasurementKit.MonotonicClock.now`, `BandLink.peripheral(_:didUpdateValueFor:error:)` | Apple System Boot Time 목록에 명시돼 있지 않아 **누락으로 확정하지 않고 관찰로만 기록** |
| (관찰) | `_sysctl`(KERN_BOOTTIME) | `KernelBootTimeInNanoseconds` = GoogleDataTransport `GDTCORClock.m:45` | 서드파티 코드. GDT 번들 매니페스트에는 API 선언이 없음. 관찰만 |
| (관찰) | `_sysctlbyname` | GoogleUtilities `GULAppEnvironmentUtil`, GDT `GDTCORDeviceModel` | 서드파티. 관찰만 |
| Disk space / Active keyboards | `statfs`·`volumeAvailableCapacity`·`activeInputModes` | 없음 | — |
| UserDefaults | `NSUserDefaults` | 앱·MeasurementKit·플러그인 | 기존 `CA92.1` 선언 |

**`_fstat` 호출 경로 (crate: Rust 표준 라이브러리 `std`, rustc 1.99.1. measurement-core 자체 코드가 아님)**

App에 정적 링크된 `libmeasurement_core.a` 안의 `std-*.rcgu.o` 멤버에서 온다. 이 멤버에 `_fstat` 미정의 참조와 `lookup_version`·`gimli::mmap`이 함께 들어 있다.

- **경로 1: OS 버전 확인**
  - 호출 경로: `___isPlatformVersionAtLeast`(Rust std의 weak external 정의) → `std::sys::platform_version::darwin::lookup_version` → `std::fs::read::inner` → `open` + `fstat` + `read`
  - 읽는 파일: `/System/Library/CoreServices/SystemVersion.plist`. 시뮬레이터에서는 `$IPHONE_SIMULATOR_ROOT` 아래의 같은 경로다(바이너리 문자열로 확인). 앱 컨테이너 밖의 시스템 파일이다.
  - 실행 여부: **실제로 실행된다.** `___isPlatformVersionAtLeast`는 `weak-def-coalesce`로 바인딩되고(`dyld_info -imports`), App 안에 정의가 Rust std 것 하나뿐이다. 따라서 App 전체의 `@available`/`#available` 검사가 이 구현을 쓴다. 이 검사를 호출하는 함수는 29개다(GoogleUtilities, GIDSignIn, GTMSessionFetcher, GDTCOR 등).
- **경로 2: 패닉 백트레이스 심볼화**
  - 호출 경로: `std::sys::backtrace::__print_fmt` → `backtrace_rs::symbolize::gimli::resolve` → `gimli::mmap` → `fstat` + `mmap`
  - 읽는 파일: `_dyld_get_image_name`이 돌려주는 자기 실행 이미지
  - 실행 여부: 기본 panic hook이 백트레이스를 출력할 때만 실행된다. 즉 Rust panic이 나고, 그때 `RUST_BACKTRACE` 같은 백트레이스 설정이 켜져 있어야 한다. 운영 앱에서는 사실상 실행되지 않는다고 판단한다. 코드는 링크돼 있다.

**타임스탬프 필드 접근 여부 (역어셈블로 판별)**

`struct stat`의 arm64 Darwin 레이아웃은 크기 144다(`offsetof`로 확인).

| 필드 | 오프셋 |
|---|---|
| `st_atimespec` | 32 |
| `st_mtimespec` | 48 |
| `st_ctimespec` | 64 |
| `st_birthtimespec` | 80 |
| `st_size` | 96 |

- 두 함수 모두 같은 패턴이다. `add x21, sp, #0x30`으로 stat 버퍼를 잡고 → 버퍼를 0으로 채운 뒤 → `bl _fstat` → **`ldr x21, [x21, #0x60]`(= `st_size`)만 읽는다.** 그 뒤에는 버퍼를 다시 읽지 않는다.
  - 경로 1(`fs::read::inner`): `st_size`는 읽기 버퍼 용량 힌트로만 쓴다.
  - 경로 2(`gimli::mmap`): `st_size`는 `mmap` 길이로 바로 쓴다(`mov x1, x21` → `bl _mmap`).
- 결론: **"API 심볼 있음 = 예", "타임스탬프 실사용 = 아니오".** 파일 크기 메타데이터만 쓴다.

**Apple 허용 reason 대조 (File timestamp)**
| reason | 내용 | 경로 1 | 경로 2 |
|---|---|---|---|
| DDA9.1 | 기기 사용자에게 타임스탬프 표시 | 해당 없음 | 해당 없음 |
| C617.1 | 앱 컨테이너·앱 그룹·CloudKit 컨테이너 안 파일의 타임스탬프·크기·메타데이터 | **안 맞음**(시스템 파일, 컨테이너 밖) | 불명확(실행 이미지는 데이터 컨테이너가 아니라 앱 번들 안에 있음) → 근거 부족 |
| 3B52.1 | 사용자가 접근을 허락한 파일 | 해당 없음 | 해당 없음 |
| 0A2A.1 | 서드파티 SDK가 앱을 위한 래퍼 제공 | 해당 없음(앱이 호출한 래퍼가 아님) | 해당 없음 |

- **판단: (c) 결정할 수 없어 보고한다.** PrivacyInfo는 바꾸지 않았다(UserDefaults `CA92.1`만 유지).
  - 경로 1은 허용 reason에 맞는 것이 없다. 선언을 넣으면 사실과 다른 선언이 된다.
  - 경로 2는 운영에서 사실상 실행되지 않고, C617.1의 적용 범위도 근거가 부족하다.
  - `C617.1`을 근거 없이 추가하지 않았다. GoogleUtilities 번들의 `C617.1`도 근거로 쓰지 않았다.
- 위험: Apple 업로드 검사는 심볼 존재로 판정할 수 있다. 그러면 `ITMS-91053`(Missing API declaration)이 나올 수 있다. 최종 arm64 배포본과 ASC 진단은 미검증이라 반려가 확정된 것은 아니다.

**호출 제거 제안 — 별도 승인 범위, 소유자 3f0465c1(SDD-246)과 함께. 이 카드에서는 구현하지 않음**
- 감독 지시로 다음은 제출용 해결책에서 뺐다: 심볼 숨기기, archive 멤버 strip, 바이너리 패치, nightly·no_std·panic 전략 변경.
- 실험 기록(원복, 커밋 없음): std 멤버의 weak 심볼을 국소화해 다시 링크해 봤다. 그래도 경로 2 때문에 `_fstat` import가 남았다. 즉 경로 1만 손봐서는 import가 없어지지 않는다.

| # | 제안 | 원인 수정 내용 | 보전·검증 |
|---|---|---|---|
| R1 | App 전체 가용성 검사가 Rust std 구현을 타는 문제 정리(정확성 문제이기도 함) | **원인**: Rust std가 staticlib에 weak `___isPlatformVersionAtLeast`/`___isOSVersionAtLeast`를 내보내고, 링커가 compiler-rt 구현보다 먼저 이것을 고른다. 이 구현은 CoreFoundation `dlopen` 실패 시 panic하는 경로도 있다(문자열 "could not open CoreFoundation.framework").<br>**후보**: ① 측정 코어를 동적 framework(cdylib)로 묶어 std 심볼을 그 이미지 안에 가둔다(패키징 변경, 소유자 결정) ② Rust upstream에 이슈 보고 ③ 해당 동작이 없는 rustc 버전으로 고정할 수 있는지 조사(도입 버전은 미확인) | FFI panic isolation 유지: `panic = "unwind"`·`catch_unwind`(`src/ffi.rs:94-267`)는 건드리지 않는다.<br>검증: `cargo test --features debug-hooks`(panic 격리), `swift test`(MeasurementKit), 앱 `#available` 분기 동작, arm64 `nm -u`에서 경로 1 호출 0 |
| R2 | 경로 2(백트레이스) | stable 툴체인과 `panic=unwind` 유지라는 조건에서는 링크에서 제거할 방법이 없다. 운영 실행은 사실상 없으므로 유지를 권고한다. Apple이 실제로 ITMS-91053을 보내면 그때 소유자와 재검토 | 위와 같음 |

**최종 arm64 배포본 검증 계획 (실행하지 않음 — Archive·서명·업로드는 APP 창구가 승인 후 수행)**

0. 빌드 준비:
   ```
   cd frontend && npm run build:prod && npx cap sync ios
   bash ios/MeasurementKit/scripts/build-core-xcframework.sh
   ```
   `cap sync`를 빼먹으면 Facebook이 다시 들어온다.
1. Archive:
   ```
   xcodebuild archive -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath build/MB.xcarchive
   ```
   서명 설정은 APP 창구가 한다.
2. 재스캔(arm64 iphoneos):
   ```
   APP=build/MB.xcarchive/Products/Applications/App.app; BIN=$APP/App
   lipo -archs $BIN   # arm64 확인
   xcrun nm -u $BIN | grep -E '_(f|l)?stat(at)?$|_getattrlist(bulk|at)?$|_fgetattrlist$|_(f)?statv?fs$|_getfsstat$|_mach_absolute_time$|_clock_gettime(_nsec_np)?$|_sysctl(byname)?$|NSUserDefaults'
   xcrun otool -v -s __TEXT __objc_methname $BIN | grep -E 'systemUptime|activeInputModes|fileModificationDate|creationDate|modificationDate|attributesOfItemAtPath|volumeAvailableCapacity|NSFileSystemFreeSize'
   xcrun otool -tvV $BIN | awk '/^[^\t ].*:$/{fn=$0} /symbol stub for: _(fstat|stat|lstat|fstatat|sysctl|sysctlbyname|clock_gettime_nsec_np)$/{print fn" -> "$NF}' | sort | uniq -c   # 호출 함수(crate) 매핑
   xcrun dyld_info -imports $BIN | grep -i isPlatformVersion   # weak-def-coalesce 여부
   for f in $APP/Frameworks/*.framework; do xcrun nm -u "$f/$(basename $f .framework)" | grep -E '_(f|l)?stat(at)?$|_mach_absolute_time$'; done
   find $APP -name PrivacyInfo.xcprivacy   # App 13유형 + SDK 매니페스트 목록
   ```
3. Xcode Privacy Report: Xcode → Window → Organizer → Archives → 해당 아카이브 우클릭 → "Generate Privacy Report" → PDF 저장. 확인할 것: App 수집 13유형과 목적, API reason, Facebook 항목 0, 추적 도메인 0.
4. ASC 업로드 후 확인 지점(업로드는 승인 후):
   - Organizer·Transporter 업로드 결과 화면
   - App Store Connect가 계정 담당자에게 보내는 처리 결과 메일: `ITMS-91053` Missing API declaration, `ITMS-91061` Missing privacy manifest, `ITMS-91056` Invalid privacy manifest
   - ASC → TestFlight → iOS 빌드의 처리 상태("처리 중"/"유효하지 않은 바이너리")
   - 경고가 오면 메일에 적힌 API 범주·심볼을 2번 재스캔 결과와 대조한 뒤 R1·R2 승인 여부를 정한다.

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
3. Rust std `_fstat`(파일 크기만 사용) 처리: 선언 근거가 없어 PrivacyInfo를 바꾸지 않았다(위 "Required Reason API 바이너리 재검증"). 다음 중 하나를 정해야 한다. (가) arm64 배포본 검증·ASC 진단 결과를 보고 결정 (나) 업로드 전에 R1(소유자 3f0465c1)을 별도 승인.

## 미실시
- 실기기 Google·Apple 로그인 왕복, iOS Archive와 Xcode Privacy Report, 서명된 AAB의 Play 사전 검사, 스토어 콘솔 입력(APP 창구 몫), 머지·배포.
