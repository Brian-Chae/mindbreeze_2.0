# 오프라인 측정 재개

제품 빌드에 넣지 않는 진단 도구다. 실제 앱 초기 실행 전 네트워크 차단이 필요하므로 **계측 스크립트만 실행한 상태로 앱을 설치/실행하지 않는다.**

1. 지정 워크트리에서 제품 파일 diff가 없는지 확인한다. 원본 저장소 frontend/node_modules 심링크를 연결한다. .env/자격증명은 읽거나 복사하지 않는다.
2. `python3 specs/sdd-236-native-top-safe-area/tools/instrument-ios.py`로 AppDelegate에 일시적인 geometry 수집 타이머를 주입한다.
3. frontend에서 `VITE_DESIGN_ROUTES_ENABLED=true npx vite build --mode dev` → `npx cap sync ios`. Firebase plist가 없으면 pbxproj의 해당 리소스 참조만 임시 제외한다(자격증명 생성/복사 금지).
4. 시뮬레이터 Debug arm64/서명 없이 xcodebuild한다. **아직 설치/실행하지 않는다.** 빌드된 App.app/public/index.html의 `</head>` 바로 앞에 `offline-driver.js` 전체를 인라인 script로 삽입한다. 이 스크립트가 React 모듈 실행 전에 가짜 인증·fetch 응답을 설정하고 WebSocket/XHR를 차단한다. 수정된 번들은 진단 전용이다.
5. 이제 simctl install/launch한다. 기본은 로그인 화면이다. 앱 컨테이너 Documents의 `sdd236-metrics.json`에 native frame·safe area·DOM 값이 기록된다.
6. 화면/회전은 Documents의 `sdd236-command.json`을 작성해 제어한다. 예: `{"id":"home-1","js":"localStorage.setItem('sdd236-screen','home');location.reload()"}`, class는 `class`, 로그인은 `login`. 회전은 고유 id와 `"orientation":"landscape"` 또는 `"portrait"`. UI 클릭은 사용하지 않는다.
7. 각 화면 안정 후 simctl screenshot을 /tmp에 저장하고 screens로 복사한다. 기기별 native/DOM JSON도 함께 저장한다. 실제 앱 화면이 아닌 Apple 부팅 화면은 환경 차단 증거로만 분류한다.
8. 종료 후 AppDelegate.swift·pbxproj·Package.swift·Package.resolved의 **본 작업이 만든 진단/부수 변경만** 복원하고 버전 번호 diff 0을 확인한다. node_modules 심링크만 제거한다. 진단 번들은 업로드하지 않는다. 제품 빌드에서는 다시 build→cap sync로 임시 드라이버를 제거한다.

웹 기준 재현: frontend에서 Vite preview를 `127.0.0.1:5236`에 띄운 후 `node specs/sdd-236-native-top-safe-area/tools/web-baseline.mjs before`. 기존 before 캡처를 덮어쓰므로 새로운 측정은 다른 라벨을 전달한다. Chromium/WebKit 18개 화면을 캡처하고 root geometry를 검증한다. 웹의 네트워크 차단/geometry 검증을 네이티브 또는 보안 검증 완료로 해석하지 않는다.
