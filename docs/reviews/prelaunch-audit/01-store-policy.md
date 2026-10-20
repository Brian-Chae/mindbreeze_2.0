# 01. 스토어 정책·네이티브 설정 점검 (읽기 전용 감사)

- 대상: MIND BREEZE 2.0 Capacitor 앱 (`frontend/ios`, `frontend/android`), 무료앱으로 App Store / Google Play 출시 가정
- 기준: 스킬 `capacitor-mobile-app-release` + `references/appstore-review-checklist.md`
- 방법: 코드·설정 정적 읽기만 수행. 실기기·시뮬레이터 실행, Play Console / App Store Connect 확인은 **하지 않음**. "추정"은 확인하지 못한 항목.
- 경로는 모두 레포 루트 기준.

## 1. 지적 사항

| 심각도 | 항목 | 근거 파일:라인 | 문제 | 권고 조치 |
|---|---|---|---|---|
| **차단** | 5.1.1(v) 앱 내 계정 삭제 없음 (iOS 필수, Play 계정 삭제 정책도 해당) | `frontend/src/pages/settings/ClientSettingsPage.tsx`(계정정보·프로필·알림·로그아웃만), `frontend/src/pages/SettingsPage.tsx`, `frontend/src/components/settings/*`. `backend/app/api/v1/admin.py:275-281`의 `DELETE /users/{id}`는 플랫폼 관리자 전용. 일반 사용자용 self-delete 엔드포인트 없음(`backend/app/api`에서 `/me` 삭제·탈퇴 라우트 grep 0건). `frontend/src/lib/privacy-policy.ts:47,118-134`는 삭제를 "이메일(admin-mindbreeze@…) 요청"으로만 안내 | 이메일·Google로 계정 생성이 가능한데(`RegisterClientPage`, `LoginPage.tsx`) 앱 안에서 계정을 삭제할 수 없다. 이메일 요청만으로는 5.1.1(v) 불충족으로 거절 사유. Play도 앱 내 삭제 경로 + 웹 삭제 요청 URL을 Data safety에 요구 | 설정 화면에 "계정 삭제" 추가(재인증 → 서버 삭제/익명화 → 로그아웃). 상담 기록 등 법정 보관 데이터는 보관·삭제 범위를 방침에 명시. Play Console에 계정 삭제 URL 등록 |
| **차단** | iOS 카메라·마이크 권한 문구 누락 | `frontend/ios/App/App/Info.plist` — 키는 `NSBluetoothAlwaysUsageDescription`(:69-70) 하나뿐. `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` 없음. 코드는 화상 상담·AI 녹음에 `getUserMedia`·LiveKit 사용(`src/components/session/VideoConference.tsx`, `hooks/useVideoRecorder.ts`, `MemberMediaControls.tsx`). Android는 `RECORD_AUDIO`·`CAMERA` 선언(`AndroidManifest.xml:54-58`) | iOS WKWebView에서 카메라·마이크 요청 시 용도 문구가 없으면 권한이 거부되거나(추정: 앱 크래시/즉시 거부) 심사에서 지적. 핵심 기능(화상·음성 기록) 동작 불가 | `NSCameraUsageDescription`, `NSMicrophoneUsageDescription` 추가(한글 + 영어 병기, 또는 `InfoPlist.strings` 다국어). 문구는 "화상 상담/AI 기록용, 사용자가 켠 경우만" 명시 |
| **차단** | `PrivacyInfo.xcprivacy` 없음 | `frontend/ios/App/App/` 에 파일 없음(`ls`로 확인). `project.pbxproj` grep "xcprivacy" 0건(4곳 등록 불가) | 2024-05 이후 필수. Capacitor·Firebase·`localStorage`/UserDefaults 등 required-reason API 사용 → 업로드 경고/거절 | `PrivacyInfo.xcprivacy` 작성(수집 데이터 유형: 이메일·이름·건강/생체(EEG)·오디오·사용자ID·기기ID(FCM) 등 + required-reason API) 후 pbxproj PBXFileReference·PBXBuildFile·Resources phase·그룹 children 4곳 등록. `.gitignore` 예외로 추적(현재 `project.pbxproj`·`App.entitlements`는 추적 중) |
| **차단** | 4.8 / 로그인 서비스 — Google 로그인만 있고 Sign in with Apple 없음 | `src/pages/LoginPage.tsx:94-187`(Google 버튼), `src/lib/native/google.ts`, `@capgo/capacitor-social-login`(`package.json`). 앱 코드 전체에서 Apple 로그인 구현 없음(`grep Apple`은 이메일/디바이스 스키마만 매칭) | 제3자 소셜 로그인(Google)을 제공하면서 동등한 개인정보 보호 로그인(Apple 또는 4.8 요건을 만족하는 대체)이 없다. 4.8 예외 후보(자사 계정 전용, 교육/기업/기관 계정 등)가 있으나 이 앱은 일반 회원 가입+Google이 모두 열려 있어 예외 입증이 불확실(추정) | (A) iOS에서만 Google 버튼 숨기고 이메일 로그인만 제공(가장 단순) 또는 (B) Sign in with Apple 추가(capability, 서버 검증). 결정 필요 — 아래 "결정 필요" 참조 |
| **높음** | 1.4.1/5.1.3 의료 진단 오인 + 질환명 노출 | 회원 온보딩 `src/pages/onboarding/ClientOnboardingPage.tsx:19-27`(고민 선택: "우울/불안/스트레스" 등 → 건강 정보 수집), 상담사 온보딩 `CounselorOnboardingPage.tsx:19-21`("우울증/트라우마"), placeholder `ClientProfileSection.tsx:155`("예: 불안, 우울, 관계"), `RegisterCounselorPage.tsx:325`, `ProfileSection.tsx:171`("임상심리, 최면, 명상"), 서비스 유형 라벨 "임상심리상담/최면심리상담"(`SessionCard.tsx:8-9`, `class-labels.ts:23-24`, `DashboardPage.tsx:20-21` 외 7곳), `ClientHomePage.tsx:487`("임상·최면심리상담 전문"), 리포트 지표 스트레스/이완/집중 | 자기보고 정신건강 상태 수집 + EEG 기반 "스트레스·이완·집중" 지표를 제시하는 앱은 정신건강/의료 해석으로 간주될 수 있음(1.4.1, 5.1.3, Play 건강 앱 선언). 면책은 일부 존재: 리포트(`ClientReportViewer.tsx:164`, `ReportDetailView.tsx:469`, `ReportViewPage.tsx:167` "의료 진단이 아닌 두뇌건강 관리 목적의 참고 자료"), 내러티브(`NarrativeSections.tsx:306`), 클래스 마법사(`wizard-steps.tsx:462`) | (1) 홈·온보딩·측정 화면에도 상시 면책("의료기기 아님, 진단·치료 아님") 노출. (2) "임상심리상담" 용어는 상담사 자격 보유 전제의 중개 서비스임을 심사 메모에 설명, 앱 설명문에서는 "상담/명상 플랫폼"으로 표현. (3) 지표 문구를 "참고용 신호"로 순화(지적 시 대응안 사전 준비). (4) App Store 카테고리는 Health & Fitness 회피 또는 의료기기 신고 질문에 "아니요" (스킬 기준) — 단 Play는 Health 앱 선언 양식(Health apps declaration)을 작성해야 함 |
| **높음** | 1.2 UGC — 채팅 신고·차단 기능 없음 | `src/components/chat/*`(MessageBubble, RoomActionsMenu, RoomSettingsModal 등)에서 신고/차단 grep 0건. 회원·상담사·타 회원과 채팅(`pages/chat/ChatPage.tsx`, `ClassChatPanel.tsx`, `InviteMemberModal.tsx` — 그룹 채팅방에 회원 초대 가능, 이전 메시지·파일 공유) | 사용자 간 메시지가 오가는 앱은 신고 수단·차단·운영자 연락처·부적절 콘텐츠 필터를 요구(1.2). Play UGC 정책도 인앱 신고 요구 | 메시지/사용자 신고 + 차단 + 운영자 응대 정책 추가. 최소안: 신고 버튼(→ 운영자 이메일/큐) + 사용자 차단 + 이용약관 내 금지행위 조항. 또는 채팅을 "상담사↔내담자 1:1 / 기관 내부 전용"으로 한정하고 심사 메모에 근거 기재(추정: 그룹방 초대가 있어 한정 근거가 약함) |
| **높음** | 4.2 최소 기능 / 웹뷰 래핑 & 심사팀 시연 수단 | `capacitor.config.ts`(webDir=dist, 번들 로컬 로딩 — 원격 URL 래핑은 아님), 네이티브 근거: BLE(`lib/ble/capacitor-ble-adapter.ts`), 푸시(`lib/native/push.ts`), Google 네이티브 로그인. 데모 모드는 `VITE_USE_MOCK_EEG`(빌드 변수, `useBand.ts:245`)만 있어 **운영 빌드에서 심사팀이 켤 수 없음** | 심사팀은 LINK BAND가 없고, 상담사/내담자 계정·세션이 없으면 핵심 기능(밴드 연결, 측정, 리포트)을 볼 수 없다 → 4.2 / 2.1(정보·데모 계정 부족) 거절 위험 | 심사용 데모 계정(상담사·내담자, 사전 생성 세션·리포트 포함) + 밴드 없는 흐름 설명, 가능하면 시연 영상 첨부. 앱 내 데모 모드는 선택(스킬 `references/demo-mode-ble.md` 참고) |
| **높음** | iOS 암호화 수출 규정 선언 누락 | `Info.plist` 에 `ITSAppUsesNonExemptEncryption` 없음 | 업로드마다 수출 규정 질문 발생(차단은 아님) | `ITSAppUsesNonExemptEncryption=false` 추가(HTTPS/표준 암호화만 사용 시) |
| **높음** | Android 릴리스 서명·AAB 파이프라인 미구성 | `android/app/build.gradle:3-9,31-40,49-56`: `keystore.properties` 있으면 서명, **없으면 서명 없이 release 빌드가 조용히 통과**. `keystore.properties`·`*.keystore`·`*.jks`는 gitignore(좋음). `.github/workflows/` 에 Android 빌드/AAB 워크플로 없음(release-build.yml은 웹·백엔드 산출물). `minifyEnabled false`(:52) | 키스토어 보관·백업 절차가 코드에 없음(분실 시 업데이트 불가; Play App Signing 사용 시 업로드 키만 관리) — 보관 위치는 **확인 불가**. 서명 누락 빌드가 통과하는 점도 위험 | Play App Signing 사용, 업로드 키 보관 위치·백업 문서화. `./gradlew bundleProdRelease` 로 AAB 생성 확인(64bit는 Capacitor 기본 AAB로 충족, 네이티브 `.so` 직접 포함 없음 — 추정). 서명 정보 없으면 release 빌드 실패하도록 변경 검토 |
| **높음** | 개인정보 처리방침 ↔ 스토어 신고 정합(Data safety / App Privacy) | `src/lib/privacy-policy.ts`: 제8조 "제3자 제공 없음"(:109-111), 위탁·국외이전 항목 없음(grep `Gemini|LiveKit|Firebase|Google|위탁|국외` → 제3자 제공 문구만 매칭). 실제로는 FCM(푸시), Google 로그인, AI 요약(Gemini, `CLAUDE.md`/AGENTS.md AI 스택), LiveKit(화상), S3 사용 | 방침에 처리위탁·국외이전 고지가 없는데 Data safety/App Privacy는 수집 항목을 상세히 신고해야 함. 불일치 시 정책 위반 | 방침에 위탁사/국외 이전(Firebase·Google·LiveKit·AWS·AI 제공자) 추가 후 스토어 신고를 방침과 일치시킴. 신고 대상 최소 목록: 이름·이메일, 건강/생체(EEG·PPG·ACC), 음성·영상, 앱 활동(채팅), 기기 ID(푸시 토큰), 선택적 개인정보(성별·생년월일·주소 — `PersonalInfoSection.tsx`). 전송 중 암호화 Yes, 삭제 요청 방법 Yes (계정 삭제 구현 후) |
| **중간** | iOS 앱 전체 접근 가능한 웹 전용 안내: "Chrome/Edge로 열기" | `src/components/class/flow/member/BandStepView.tsx:125,151`, `player/member/MemberSheets.tsx:30,309-323`, `player/host/sheets/MybandSheet.tsx:41`, `components/landing/CTASection.tsx`·`FeatureCards.tsx`. `useBand.ts:241` `isWebBluetoothSupported()`→`isBleSupported()`(`lib/ble/index.ts`)이라 네이티브(Capacitor BLE)에서는 supported가 되어 문구가 평소엔 노출되지 않을 것으로 **추정**. 단, BLE 권한 거부·블루투스 꺼짐 등으로 `unsupported`가 되는 경로에서 노출 가능 | 앱 안에서 "다른 브라우저(Chrome/Edge)로 열라"는 안내는 4.2/2.3.1(타 플랫폼 유도) 지적 소지. Bluefy 등 타사 앱 링크는 코드에서 발견되지 않음(grep 0건) | 네이티브에서는 `isNativeApp()`이면 해당 안내 대신 "블루투스 권한/설정 확인" 문구로 분기. 기기에서 `unsupported` 상태가 되는 케이스를 실기기로 확인 필요 |
| **중간** | 웹 푸시 카드가 앱 설정에도 노출 | `src/pages/SettingsPage.tsx:269` `<WebPushCard />`, `components/settings/WebPushCard.tsx:10`("iPhone은 홈 화면에 추가한 뒤 이용해 주세요") — `isNativeApp` 분기 확인되지 않음(grep으로 WebPushCard 내 isNative 0건) | 네이티브 앱 내에서 "홈 화면에 추가" 안내·웹 푸시 UI가 노출될 수 있음(이중 알림 UI, 혼란; 4.2 감점 요인). 상담사용 `SettingsPage`가 대상이라 앱 사용 비중에 따라 노출 빈도 상이 | `!isNativeApp()`일 때만 렌더 |
| **중간** | 랜딩/마케팅 페이지가 앱에 번들 | `App.tsx:111-113` 네이티브는 `RoleRouter`로 진입(랜딩 미노출). `/register/organization`, `/o/:org_code` 등 기관 가입 경로는 앱에서도 접근 가능 | 기관(B2B) 가입 신청이 앱 내에서 가능하면 3.1.1/3.1.3(외부 결제·기업 서비스) 설명이 필요할 수 있음. 앱 내 결제·구독·가격 문구는 **발견되지 않음**(grep 결제·구독·요금·가격 → 소켓 "구독"만 매칭) | 무료앱 + "계정은 기관이 발급하는 서비스" 취지를 심사 메모에 기재. 기관 구독 안내를 앱에 넣지 말 것(넣으면 3.1.3 검토 필요) |
| **중간** | Android 알림 권한 / 푸시 요청 시점 | `AndroidManifest.xml:47` `POST_NOTIFICATIONS`. `lib/native/push.ts:91-96`: 로그인 직후 `requestPermissions()` 자동 호출(`use-push-registration.ts`) | 문맥 없이 즉시 권한 팝업(Android 13+/iOS) → 거절률·심사 UX 지적 가능(정책 위반은 아님) | 설정 화면 토글 또는 첫 알림 맥락에서 사전 안내 후 요청(권고) |
| **중간** | iOS UIBackgroundModes 없음 / 블루투스 백그라운드 | `Info.plist`에 `UIBackgroundModes` 없음. BLE는 포그라운드 전제로 보임 | 화면 잠금·앱 전환 시 BLE 연결 유지가 필요하면 `bluetooth-central` 필요(추가 시 심사 메모에 사유 필요). 푸시는 `remote-notification` 없이도 알림 표시는 가능(무음 푸시 미사용 시) | 제품 요구 확인: 백그라운드 측정 필요 여부 결정. 필요 없으면 현 상태 유지(깨끗) |
| **중간** | Firebase 설정 파일·SPM 정합 | `GoogleService-Info.plist`는 pbxproj에 Resources로 등록(`project.pbxproj:17,29,73`)되나 **gitignore로 미추적**(`frontend/.gitignore`/`ios/.gitignore`) → 새 클론/CI 빌드에서는 파일 없음. `AppDelegate.swift:11-14`는 파일 없으면 Firebase 초기화 생략(푸시 불능). 로컬에는 파일 존재. Android도 `google-services.json` 미추적(`build.gradle:77-83` 없으면 플러그인 생략) | 파일 없는 환경에서 빌드하면 푸시가 조용히 비활성화된 채 출시될 수 있음. 번들 ID `com.looxidlabs.mindbreeze.ios`와 plist의 BUNDLE_ID 일치 여부는 **확인하지 않음**(값 출력 금지 원칙) | 릴리스 빌드 전 plist/json 존재·BUNDLE_ID/패키지명 일치 체크 단계 추가. 운영(prod)용 Firebase 프로젝트·APNs 키 분리 여부 확인 |
| **중간** | Android: dev/prod flavor, 운영 패키지 | `build.gradle:34-47` prod flavor `com.looxidlabs.mindbreeze`, dev는 `.dev` 접미사. `google-services.json`에 두 패키지 클라이언트가 모두 있는지 **확인하지 않음** | prod AAB가 dev Firebase 프로젝트로 푸시 등록될 위험(추정) | 운영 빌드의 `VITE_API_BASE_URL`(기본값 `http://localhost:8000/api/v1`, `src/lib/api/client.ts:37`)과 Firebase 프로젝트가 prod를 가리키는지 릴리스 전 검증. `--mode prod` 스크립트 존재 여부 확인(`package.json`에는 `android:build:dev`만 확인됨) |
| **낮음** | iOS 디바이스 패밀리 iPhone+iPad | `project.pbxproj:324,348` `TARGETED_DEVICE_FAMILY="1,2"` | iPad 13" 스크린샷 필수, iPad 레이아웃 심사 대상 | iPhone 전용(`1`)으로 제출 범위 축소하거나 iPad 스크린샷·레이아웃 검증 |
| **낮음** | iOS 방향·최소 버전 | `Info.plist` 가로 허용, `IPHONEOS_DEPLOYMENT_TARGET=15.0`, `UIRequiredDeviceCapabilities=arm64`(좋음) | 문제 없음. 가로 레이아웃 미검증(추정) | 가로 화면 시각 점검 또는 세로 고정 |
| **낮음** | 버전·빌드 번호 | iOS `MARKETING_VERSION=1.0`, `CURRENT_PROJECT_VERSION=1`(`project.pbxproj:311,318,336,343`). Android는 `-PversionCode/-PversionName` 주입(기본 1 / "1.0", `build.gradle:11-12`), 이를 주입하는 CI 없음 | 업로드마다 증가 필요 | 릴리스 절차에 빌드 번호 증가 단계 명시 |
| **낮음** | `file_paths.xml` 광범위 공유 | `android/app/src/main/res/xml/file_paths.xml`: `external-path path="."` (외부 저장소 전체), cache-path 전체 | FileProvider(`exported=false`, grantUriPermissions)라 직접 위험은 낮지만 정적 점검 도구가 경고 | 필요한 하위 경로로 축소 |
| **낮음** | Android 앱 링크·네트워크 설정 | App Links/intent-filter 없음(`AndroidManifest.xml`은 MAIN/LAUNCHER만) → 초대 링크(`/o/...`, 클래스 입장 링크)가 앱으로 열리지 않음. `network_security_config.xml` 없음, `usesCleartextTraffic` 미지정(targetSdk 28+ 기본 차단 = 좋음), `capacitor.config.ts`에 `server.cleartext` 없음 | 기능 한계(딥링크 불가)일 뿐 정책 문제 아님 | 초대 링크의 앱 열기가 필요하면 assetlinks.json + App Links, iOS는 Associated Domains(`App.entitlements`에 없음) 설계 |

## 2. 결정 필요 (Brian)

1. **4.8**: iOS에서 (A) Google 로그인 숨김(이메일 로그인만) vs (B) Sign in with Apple 추가. → 단순화 우선이면 A, 가입 편의 우선이면 B.
2. **계정 삭제**: 삭제 범위(상담 기록·리포트 보관 여부, 법정 보관기간)와 즉시삭제/유예 방식 결정 → 개발 착수 전 정책 확정 필요(개인정보 처리방침 개정 포함).
3. **채팅 UGC**: 신고·차단 구현 vs 채팅을 상담 관계 내부로 한정(그룹 초대 기능 축소).
4. **카테고리**: Health & Fitness 회피(Utilities/Lifestyle/Medical 제외) 가능 여부. Play는 Health apps declaration 양식을 별도 작성.
5. **iPad 지원 여부**.

## 3. 심사 연락처·데모 계정

- **필요함.** 로그인이 있는 앱이고 핵심 기능(밴드 측정·리포트)은 하드웨어·사전 세션이 필요하므로 App Store Connect "앱 심사 정보"와 Play "앱 액세스 권한"에 계정이 필수.
- 준비물: 상담사 1 + 내담자 1 데모 계정(2FA·이메일 인증 없이 로그인 가능), 사전 생성된 완료 세션·리포트 1건, 밴드 없는 시연 흐름, 심사 연락처(전화+이메일; 처리방침 문의처는 `admin-mindbreeze@looxidlabs.com`, `src/lib/privacy-policy.ts:12`).
- 테스트 계정(`counselor@test.com` / `client@test.com`)은 dev 서버용이므로 **운영 서버에 심사 전용 계정을 따로 만들 것**(비밀번호는 문서에 적지 말고 제출 화면에만 입력).
- 처리방침 URL: `/privacy` 라우트 존재(`App.tsx:159`). 운영 도메인에서 200 응답 확인은 이번 감사에서 **하지 않음**.

## 4. 깨끗한 항목 (확인함)

- **Info.plist**: `UIRequiredDeviceCapabilities=arm64`, Bluetooth 권한 문구 존재(한글; 영어 병기는 없음 → 아래 권고), `UIFileSharingEnabled`·`LSSupportsOpeningDocumentsInPlace` 없음.
- **entitlements**: `aps-environment` = `$(APS_ENVIRONMENT)`, Debug=development / Release=production로 분리(`project.pbxproj:307,332`). 불필요한 capability 없음.
- **서명/번들**: `DEVELOPMENT_TEAM=KWY2GD549F`, `PRODUCT_BUNDLE_IDENTIFIER=com.looxidlabs.mindbreeze.ios`(`.dev` 접미사 없음). 아이콘 1024 RGB PNG(알파 없음).
- **gitignore 예외**: `project.pbxproj`, `App.entitlements`, `Info.plist` 추적 중. `GoogleService-Info.plist`·`google-services.json`·`keystore.properties`·`*.keystore`·`*.jks`·`local.properties` 미추적(시크릿 비추적: 좋음). `ios/App/App/public`·`capacitor.config.json` 생성물 제외.
- **Android 권한**: `BLUETOOTH_SCAN`에 `neverForLocation` 플래그, `ACCESS_FINE_LOCATION`은 `maxSdkVersion=30`, `ACCESS_COARSE_LOCATION`은 `tools:node="remove"`로 제거, `BLUETOOTH`/`BLUETOOTH_ADMIN`은 `maxSdkVersion=30`, BLE·카메라·마이크 `uses-feature required=false`. `FOREGROUND_SERVICE*`·`READ_EXTERNAL_STORAGE`·`READ_CONTACTS`·광고 ID 권한 **없음**.
- **targetSdk/compileSdk 36**(`variables.gradle`), minSdk 24, Java 21. targetSdk 요건 충족.
- **백업**: `android:allowBackup="false"`(`AndroidManifest.xml:6`).
- **네트워크**: cleartext 허용 설정 없음(기본 차단). 원격 URL 래핑이 아닌 번들 로컬 로딩.
- **exported**: MainActivity만 `exported=true`(LAUNCHER), FileProvider `exported=false`.
- **결제(3.1)**: 앱 코드에 결제·구독·가격·외부 결제 링크 없음. 외부 링크는 AI 에이전트 지도 열기(`ai-agent-page.tsx:178`) 정도.
- **타사 앱 유도**: Bluefy 등 링크 없음. PWA 설치 프롬프트(`beforeinstallprompt`)·`manifest` 없음(`public/sw.js`는 웹 푸시용).
- **플랫폼 분기**: 네이티브 진입 시 랜딩 대신 `RoleRouter`(`App.tsx:111-113`). Android 전용 안내 문구 노출 없음(`isAndroid` grep 0건).
- **푸시**: iOS 포그라운드 표시 옵션 설정(`capacitor.config.ts`), Firebase 미구성 환경에서 안전하게 생략(`AppDelegate.swift`).
- **리포트 면책 문구**: 리포트 3종·내러티브·클래스 마법사에 "의료 진단이 아님" 문구 존재(위 높음 항목에서 보강 권고).
- **Google 신규 가입 동의 게이트**: `LoginPage.tsx:44-197`(이용약관·방침·민감정보 동의 체크 후 가입).

## 5. 부록 — 추가 권고(낮은 우선순위)

- Info.plist 권한 문구(Bluetooth) **영어 병기**: 현재 한글만(`Info.plist:69-70`). 기본 언어가 `en`(`CFBundleDevelopmentRegion`)이므로 영어 문구 추가 권장.
- 이 감사의 한계: 실기기 BLE·권한 흐름, 스토어 콘솔 상태, 운영 도메인 응답, Firebase 파일 내용, 키스토어 실제 보관은 **미확인**.
