# SDD-236 — 조사 결과 및 검증 차단 보고

- 상태: **미완료 — 원인 실측 차단, 제품 코드 수정 없음, Draft PR**.
- 기준: c90ea4cb. Spec/웹 기준 e59e3b75, 구현 전 Verify 4577d471.
- Stage ④ 구현·⑤ 수정 검증은 시작하지 않았다. 이 문서는 완료 선언이 아닌 조사/인계 기록이다.

## 원인과 근거

**앱 최상단 틈의 원인은 아직 확정하지 못했다.** iOS 26.5 시뮬레이터 17 Pro와 17e가 앱 실행 전 `Waiting on BackBoard`에서 반복 정지하여 앱 캡처·프레임 측정이 불가능했다.

- SpringBoard 프로세스 sample: `applicationDidFinishLaunching → _prepareBacklightServices → BLSHFlipbook → CAFlipBook → mach_msg` 대기. 앱 코드 실행 이전이다. 세부 환경 원인은 미확정.
- 기기 재시작, CoreSimulatorService/SimLaunchHost 재시작 이후에도 부팅 정지. `xcrun simctl runtime dyld_shared_cache update --all`은 exit 0, cache usable. 삭제·설정 변경·Mac 재부팅은 수행하지 않았다.
- iOS 실제 소스: Capacitor 8.5.3의 기본 contentInset은 never. 미설정에 따른 자동 inset 원인 주장은 배제할 근거가 있다.
- StatusBar 8.0.4 overlay:false에서 statusBarHeight로 웹뷰를 내리는 경로는 확인. safeArea와의 차이, 별도 단색 상태바와 화면 배경의 경계, CSS 중복 inset은 **가설**이며 원인으로 단정하지 않는다.
- Android는 iOS와 같은 statusBarFrame 기반 웹뷰 frame 이동 경로가 없다. SystemBars의 CSS/native inset 분기와 targetSdk 36을 확인했으나 기기·에뮬레이터가 없어 무증상으로 판단할 수 없다. 변경하지 않았다.

## 변경 파일

- `spec.md`, `plan.md`, `verify.md`, `summary.md`: 조사·구현 전 게이트·재개 절차.
- `screens/`: 웹 기준 캡처 18개 + geometry JSON, 시뮬레이터 부팅 정지 증거 2개.
- `tools/offline-driver.js`, `tools/web-baseline.mjs`, `tools/instrument-ios.py`: 서버 요청을 차단한 로그인/홈/기존 M01 클래스 픽스처, 웹 geometry 캡처 도구.
- 제품 코드 변경 없음. 임시 AppDelegate 계측, 누락 Firebase 리소스 제외, Package.swift realpath 변경, Package.resolved 부수 변경 모두 복원. 앱 버전 번호 변경 없음.

## 전후 측정

| 대상 | 수정 전 | 수정 후 | 판단 |
|---|---|---|---|
| iOS 17 Pro/26.5 세로·가로 앱 상단 틈 | 실측 불가 | 수정 없음 | 앱 실행 전 부팅 차단 |
| iOS 17e/26.5 세로·가로 앱 상단 틈 | 실측 불가 | 수정 없음 | 앱 실행 전 부팅 차단 |
| 웹 Chromium/WebKit, 3크기×3화면 | root y=0, html/body/root 뷰포트 높이 일치(18건) | 수정 없음 | 웹 기준만 확보; 네이티브 개선 증명 아님 |
| Android | 기기·에뮬레이터 없음 | 수정 없음 | 런타임 미검증 |

`blocked-17pro-boot.png`는 검은 부팅 화면, `blocked-17e-boot.png`는 Apple 부팅 화면이다. 실제 앱 수정 전 캡처로 해석하면 안 된다. 네이티브 상단 버튼 터치 위치·회전·노치 겹침도 미검증이다.

## 실행한 검증

- `vite build --mode dev`: 성공(기존 chunk size/dynamic import 경고). 클래스 하니스 측정 번들은 `VITE_DESIGN_ROUTES_ENABLED=true`를 임시 빌드 변수로 명시했다.
- `cap sync ios`: 성공. 심링크 realpath에 따른 SPM 부수 변경은 복원.
- `xcodebuild ... -configuration Debug -sdk iphonesimulator ARCHS=arm64 CODE_SIGNING_ALLOWED=NO`: 성공. 워크트리에 미제공인 GoogleService-Info.plist 리소스 참조만 로컬에서 임시 제외했다. 최초 빌드는 이 파일 누락으로 실패했다. 서명/배포 검증이 아니다.
- `npx vitest run tests/native-bootstrap.test.tsx tests/native-push.test.ts tests/sdd222-native-config.test.ts tests/sdd220-native-release.test.ts`: 4파일, 45개 통과.
- `npx tsc --noEmit -p tsconfig.app.json`: exit 0.
- Playwright Chromium 및 WebKit: 390×844, 844×390, 1440×900에서 로그인·회원 홈·M01 클래스 18개 기준 캡처/geometry 확보. WebKit 실행 파일 부재로 첫 실행은 Chromium 이후 중단되었고, WebKit 캐시 설치 후 전체 재실행 성공.
- 구현자/검증자 분리: 별도 읽기 전용 검증자가 Android 경로와 시뮬레이터 시스템 초기화 차단을 재검토했다. 제품 수정/개선 검증은 수행할 수 없었다.

## 미검증·다음 단계

1. 부팅 가능한 iOS 환경 확보(Mac 재부팅 여부는 사용자 판단 또는 다른 Mac).
2. plan의 진단 드라이버로 2기종×3화면×2방향 실제 앱 전후 캡처·native/DOM geometry 수집.
3. spec/plan에 원인·측정치를 확정하고 실패 테스트 → 최소 수정 → 동일 조건 재검증. Verify는 이미 구현 전 커밋됨.
4. summary를 실제 수정 결과로 갱신한 뒤 독립 리뷰와 PR Ready 전환.

실기기 iOS/Android, 실제 로그인·서버 API·LiveKit·BLE, 네이티브 터치, 회전 모두 미검증이다. 현재 Draft PR은 수정 완료/머지 가능 상태가 아니다.

스토어 업로드·TestFlight export·Play 업로드·develop 푸시·머지·배포·서버/DB/.env 접근·메일은 수행하지 않았다. 기존 Android versionCode 4/iOS 빌드 3을 변경하지 않았다. 릴리스 후속은 감독이 versionCode 5/iOS 빌드 4 이상으로 별도 수행한다.

## 참고

- [Apple Xcode 26.1.1 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-26_1-release-notes): 부팅 전 dyld shared cache 준비 점검 권고.
- [Apple 엔지니어의 시뮬레이터 부팅 답변](https://developer.apple.com/forums/thread/807025): 부팅 대기·캐시 준비. 현재 세부 원인의 확정 근거로 사용하지 않았다.
- [Capacitor Status Bar 문서](https://next.capacitorjs.com/docs/next/apis/status-bar): Android SDK 36의 overlay/background 제한. 실제 설치된 8.5.3/8.0.4 소스와 대조했다.
