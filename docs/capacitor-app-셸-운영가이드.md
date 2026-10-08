# Capacitor 앱 셸 운영 가이드

SDD-190 프론트엔드. 앱 ID는 `com.looxidlabs.mindbreeze`, 표시 이름은 `MIND BREEZE`, 웹 번들 디렉토리는 `frontend/dist`다. LINK BAND 연결은 선택 사항이며 기존 웹 경로도 유지한다.

## 설치와 빌드

참조 SDK와 동일한 Capacitor 8 및 `@capacitor-community/bluetooth-le` 8을 사용한다. 선언 버전은 core/cli/android/ios `8.3.4`, BLE `8.2.0`, app/push-notifications `^8.0.0`이다.

```bash
cd frontend
npm install --legacy-peer-deps
npx tsc -b --noEmit
npm run build
npx vitest run
npm run cap:sync
# 각 IDE 열기: 빌드와 해당 플랫폼 sync를 먼저 실행한다.
npm run cap:android
npm run cap:ios
```

기존 Storybook/Vite의 peer dependency 조합 때문에 `--legacy-peer-deps`를 사용한다. 네트워크가 되는 환경에서 설치 후 생성되는 `package-lock.json`을 확인해야 한다. Capacitor의 플랫폼 폴더는 이미 생성되었으므로 `cap add`를 반복하지 않는다. Android는 Android Studio/SDK/JDK, iOS는 Xcode와 Apple 개발자 서명 설정이 필요하다. 이 프로젝트의 iOS 플랫폼은 Swift Package Manager 방식으로 생성되어 CocoaPods 설치를 요구하지 않는다.

앱용 웹 번들은 `VITE_API_BASE_URL`을 실기기에서 접근 가능한 HTTPS API의 `/api/v1` 주소로 설정해 빌드한다. 기본 localhost 주소는 개발 PC를 가리키지 않는다. 서버 CORS·쿠키 정책이 `capacitor://localhost`(iOS), `https://localhost`(Android)의 인증·refresh 요청을 허용하는지 확인한다. 실제 운영 origin 정책은 백엔드 운영자와 맞춘다. 이 가이드에는 환경변수 이름만 기록하며 값은 저장하지 않는다.

## Firebase와 서버 설정

1. Firebase Console에서 서비스 운영용 프로젝트를 만들고 Cloud Messaging API(HTTP v1)를 활성화한다.
2. Android 앱을 `com.looxidlabs.mindbreeze`로 등록하고 내려받은 설정을 `frontend/android/app/google-services.json`에 배치한다.
3. 같은 Firebase 프로젝트에 iOS 앱을 동일한 Bundle ID로 등록한다. 설정 파일은 `frontend/ios/App/App/GoogleService-Info.plist`에 배치한 뒤 Xcode에서 App 타깃의 리소스로 추가한다. 파일 위치만 복사하면 번들에 포함되지 않을 수 있으므로 Target Membership과 Copy Bundle Resources를 확인한다.
4. 서버 실행 환경에 `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`을 설정한다. 후자는 서비스 계정 JSON 파일 경로 또는 JSON 문자열이다. 서비스 계정에는 필요한 FCM 발송 권한만 부여한다. **서버용 서비스 계정 키를 앱·웹 번들에 넣지 않는다.**
5. 백엔드 푸시 소비 cron과 발송 서비스가 해당 설정을 받도록 배포한다. 실제 발송·DB 처리는 SDD-190 백엔드 담당 범위다.

두 서버 환경변수가 없으면 백엔드 계약상 발송을 비활성화한다. Android의 Google Services Gradle 연동은 생성 템플릿에 포함된다. 자격증명 추가 후 `npx cap sync android`를 다시 실행한다.

## iOS FCM·APNs

서버는 FCM 토큰을 사용한다. 기본 Capacitor iOS 등록 토큰은 APNs 토큰이므로 `AppDelegate.swift`에서 APNs 토큰을 Firebase Messaging에 연결하고 **FCM 토큰**을 Capacitor 등록 이벤트에 전달한다. FCM 토큰 갱신도 동일 이벤트를 사용한다. 자격증명 파일이 번들에 없으면 Firebase 초기화를 생략한다. FirebaseMessaging은 Xcode 프로젝트의 직접 SPM 의존성(12.x)으로 추가되어 `cap sync`가 재생성하는 `CapApp-SPM/Package.swift`와 분리되어 있다. 구현 근거: [Capacitor Firebase 가이드](https://capacitorjs.com/docs/guides/push-notifications-firebase), [Push 플러그인](https://capacitorjs.com/docs/apis/push-notifications).

Apple Developer에서 APNs 인증 키를 발급하고 Firebase Console → 프로젝트 설정 → Cloud Messaging → iOS 앱 설정에 키를 업로드한다. Key ID·Team ID와 Bundle ID를 일치시킨다. 키 파일은 저장소에 넣지 않는다. Xcode의 Signing & Capabilities에서 팀·서명 프로파일과 Push Notifications capability를 확인한다. `App.entitlements`의 `aps-environment`는 Debug에서 development, Release에서 production으로 설정된다. 현재 범위는 일반 알림이며 별도의 silent push/background 작업은 구현하지 않았다.

## 권한과 런타임 동작

Android Manifest에는 `BLUETOOTH_SCAN`(neverForLocation), `BLUETOOTH_CONNECT`, `POST_NOTIFICATIONS`를 선언했다. Android 11 이하를 위해 기존 Bluetooth·위치 권한에 maxSdkVersion 30을 적용했다. BLE 하드웨어는 필수가 아니다. iOS `NSBluetoothAlwaysUsageDescription` 문구는 “선택한 LINK BAND를 연결하고 뇌파 데이터를 수신하기 위해 Bluetooth를 사용합니다.”이다.

`main.tsx`의 `NativeBootstrap`이 인증된 네이티브 사용자에게만 알림 권한을 요청한다. 허용 후 `/api/v1/devices`에 토큰·플랫폼·앱 버전을 등록하고, 명시적 로그아웃에서는 인증 토큰 폐기 전에 디바이스 토큰을 DELETE한다. 권한 거부나 등록 실패는 로그인·상담 이용을 막지 않는다. 네트워크 장애로 DELETE가 실패하면 서버에 등록이 남을 수 있으므로 오프라인 로그아웃의 서버 해지는 보장되지 않는다.

푸시 탭은 `/agent`, `/app`, `/app/` 하위 상대 경로만 허용한다. 외부 URL, 프로토콜 상대 URL, 경로 이동과 인코딩 우회는 무시한다. 포그라운드 수신은 기존 알림 스토어를 갱신한다. 웹에서는 푸시 초기화·권한·API 호출이 없다.

BLE는 기존 EEG Provider·UUID·notify 처리와 `useBand` 재연결 경로를 공유한다. 웹은 기존 WebBluetoothProvider에 위임하고, 앱은 BleClient의 requestDevice/connect/startNotifications를 사용한다. 예기치 않은 연결 해제는 기존 연결 손실 콜백에 전달한다. 미지원 웹 브라우저 안내는 유지한다.

## 생성 파일과 보안

`android/`, `ios/`에는 프로젝트 설정·소스만 관리한다. 각 `.gitignore`는 웹 복사본, 네이티브 빌드 산출물, Google 설정 파일, 서명 키·인증서를 제외한다. `google-services.json`, `GoogleService-Info.plist`, `.p8`, `.p12`, `.jks`, `.keystore`, `.mobileprovision`은 추적하지 않는다. 푸시 토큰과 서비스 계정 내용은 로그에 출력하지 않는다.

## 이번 환경의 실행 결과와 남은 작업

- Android와 iOS `cap add` 성공. iOS는 SPM이므로 CocoaPods 부재로 건너뛴 항목은 없다.
- npm registry DNS 조회가 `ENOTFOUND registry.npmjs.org`로 실패했다. 참조 저장소에 실제 설치된 core/cli/android/ios 8.3.4, BLE 8.2.0을 로컬 `node_modules`에 복사·연결해 플랫폼을 생성했다. 이 로컬 재사용은 정상적인 npm 설치 완료를 의미하지 않는다.
- `@capacitor/app`, `@capacitor/push-notifications`는 로컬 캐시에도 없어 미설치 상태다. `package-lock.json` 갱신도 완료하지 못했다. 네트워크 복구 후 위 설치 명령을 실행하고 lockfile을 갱신해야 한다.
- Android/iOS `cap sync` 명령은 성공했지만 **기존 dist와 BLE만 포함한 부분 동기화**다. App·Push 플러그인과 최신 웹 코드 반영을 위해 정상 설치·빌드 후 다시 sync해야 한다.
- TypeScript와 프로덕션 빌드는 위 두 패키지 미설치로 차단됐다. 완료 또는 배포 가능한 빌드로 간주하지 않는다.
- 모킹 기반 푸시·BLE·웹 회귀 테스트 결과와 전체 기존 실패 목록은 `/tmp/sdd-wave/report-190-fe.md`에 기록한다.
- Firebase 자격증명 배치, APNs 키 업로드, Firebase SPM 다운로드, Xcode/Gradle 네이티브 컴파일·서명, 실기기 로그인/refresh·푸시 권한/수신/탭/로그아웃·BLE 연결/재연결은 아직 검증하지 않았다.
