# SDD-236 — 네이티브 앱 화면 최상단 미세 틈 제거

- 상태: Stage ① 원인 측정 중
- 기준: `origin/develop c90ea4cb`, 브랜치 `sdd/236-native-top-safe-area`
- 승인: 2026-10-23 대표 지시. Spec → Plan → Verify(구현 전 커밋) → 구현 → 테스트 → Summary 연속 진행, PR 생성까지 승인.

## 문제와 목표

iPhone Capacitor 앱 최상단에 보이는 미세 빈틈을 실제 픽셀·네이티브 프레임·웹 geometry로 구분해 제거한다. Android에도 같은 문제가 있는지 확인한다. 빈틈 0, 상태바·노치·Dynamic Island와 콘텐츠 겹침 없음, 헤더 터치 영역 유지가 목표다.

## 검증 범위

- iOS 26.5: iPhone 17 Pro(Dynamic Island), iPhone 17e(비 Dynamic Island). 로그인 전, 로그인 후 홈, 클래스 플레이어, 세로/가로.
- 서버·DB·.env 접근 금지에 따라 로그인 후 홈은 오프라인 API 픽스처, 클래스는 기존 `/design/class-player?role=member&case=M01` 하니스. 실제 인증·LiveKit 수업 검증과 구분한다.
- 웹: Chromium/WebKit의 390×844, 844×390, 1440×900 전후 캡처·geometry 비교.
- Android: 기기·에뮬레이터가 없으면 정적 분석만 수행하고 런타임 미검증을 명시한다.
- 캡처·측정: `screens/`. 기기 실측을 확보하기 전 원인을 확정하지 않는다.

## 조사로 확인한 사실

- Capacitor iOS 8.5.3 `CAPInstanceDescriptor.m:45`의 기본 contentInset은 `never`. 미설정 자체가 자동 contentInset 적용 원인이라는 가설은 근거 없음.
- StatusBar 8.0.4 `resizeWebView()`의 `overlay:false`는 webView y를 statusBarFrame.height로 변경하고 상태바 배경 뷰를 별도로 그린다. 실제 safeArea와의 차이는 실측 필요.
- html/body/root는 h-full, viewport-fit=cover. 앱 로그인 전 화면은 사진/그라데이션이므로 상태바 단색과의 경계도 구분해야 한다.
- Android targetSdk 36. Capacitor Android SystemBars는 WebView 버전·viewport-fit에 따라 CSS inset 또는 네이티브 padding을 전달한다. iOS처럼 statusBarFrame으로 webView 프레임을 이동하는 경로는 없다. Android 무증상으로 단정하지 않는다.

## 경계

- 앱 버전·빌드 번호 변경/커밋 금지. Play versionCode 4 / TestFlight build 3 보존.
- 스토어 업로드·export·머지·develop 푸시·배포·메일·서버/DB 접근·범위 밖 수정 금지.
- 시뮬레이터 UI 클릭 없이 simctl 및 임시 오프라인 드라이버로 측정. 임시 AppDelegate 진단과 누락 Firebase 리소스 제외는 복원하고 제품 변경에 포함하지 않는다.
- node_modules는 원본 저장소 심링크를 사용하고 작업 종료 시 해당 링크만 제거한다.
