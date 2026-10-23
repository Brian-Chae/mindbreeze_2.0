# SDD-236 — 네이티브 상단 틈 조사·수정 계획

> 실행 방식: 대표의 연속 실행 지시에 따라 원인 측정 → Verify 커밋 → 최소 구현 → 독립 검증. 현재는 시뮬레이터 부팅 장애로 원인 확정 전이다. 임의 수정 없이 재개한다.

**목표:** 실제 앱 상단 빈틈 0, 노치/상태바와 콘텐츠 겹침 없음, 터치 영역 유지.
**기술:** Capacitor iOS/Android 8.5.3, StatusBar 8.0.4, React, Vitest, simctl, Playwright.
**Spec:** [spec.md](spec.md)

## 제약·소유 범위

- 이 워크트리/SDD-236 전용 브랜치에서만 변경. 서버·DB·.env, 스토어·버전 번호·develop 접근/변경 금지.
- 제품 수정 후보는 `frontend/src/lib/native/use-status-bar.ts`, `frontend/capacitor.config.ts`, 필요한 최소 iOS 네이티브 레이아웃/CSS. 원인 측정 전 수정할 파일·방식을 확정하지 않는다.
- Android는 독립 정적 검증에서 동일 iOS frame 계산 경로가 없어 변경 제외. 실제 기기에서는 별도 재검증 필요.
- 실제 로그인 대신 오프라인 픽스처. 클래스는 기존 M01 하니스. fixture 인증/토큰 값은 가짜이며 외부 요청을 차단한다.

## 조사 결과와 미확정 항목

- 기본 iOS contentInset은 이미 never. 설정 추가만으로 해결된다고 볼 수 없다.
- overlay:false에서 statusBarHeight만큼 webView를 이동하는 코드는 확인. 이 이동과 safeArea의 차이가 실제 빈틈인지 아직 측정하지 못했다.
- status bar 단색과 사진/클래스 배경의 경계, CSS safe-area 중복도 가설로 남는다.
- iOS 26.5 17 Pro/17e가 앱 실행 전 Waiting on BackBoard에서 정지. 설치·실행·geometry 수집 불가. SpringBoard sample은 BacklightServicesHost → CAFlipBook → mach_msg 대기. 원인 세부는 미확정.
- CoreSimulatorService·SimLaunchHost 재시작 및 공식 `simctl runtime dyld_shared_cache update --all` 점검 이후에도 동일. 캐시는 usable.

## 실행 태스크

- [x] 규칙/릴리즈 스킬 확인, 브랜치·기준 커밋·추적 파일 확인.
- [x] 오프라인 웹 기준 18개 화면·geometry 저장(2엔진×3크기×3화면).
- [x] 로컬 시뮬레이터 빌드. 미제공 Firebase 리소스 참조만 임시 제외, 제품 소스·버전 번호·SPM 부수 변경은 복원.
- [ ] 부팅 가능한 iOS 환경 확보 후 로그인 전/홈/클래스의 프레임·safe area·env·DOM 및 캡처 수집. 세로→가로→세로 반복.
- [ ] 이미지의 상단 색 행과 native webView.frame/statusBar/safeArea를 함께 비교해 틈의 높이(px와 pt)·원인을 spec/plan에 확정 기록.
- [ ] Verify 구현 전 커밋 존재 확인. 측정 결과에 맞는 실패 테스트를 작성·실패 확인한 뒤 최소 수정.
- [ ] 수정 후 동일 기기·화면·방향 캡처와 geometry 비교. 터치 위치·노치 겹침, 관련 vitest·tsc, 웹 캡처 회귀 비교.
- [ ] 독립 검증자가 diff와 측정 결과 재검증. summary를 최종 결과로 갱신.
- [ ] 제품 수정·검증 완료 후 PR을 Ready로 전환. 현재 생성되는 PR은 차단 상태를 명시한 Draft로 유지.

## 재개 시 함정

- 부팅 실패 스크린샷은 앱의 before가 아니다. `blocked-*`는 환경 증거이며 전후 개선 수치에 사용 금지.
- 캡처는 simctl이 외장 SSD에 직접 저장하지 못해 `/tmp`에 저장 후 `screens/`로 복사한다.
- `cap sync`는 심링크 node_modules의 realpath로 Package.swift를 바꾼다. 해당 부수 변경과 Package.resolved는 복원한다.
- 기존 xcodebuild 빌드 캐시는 `/tmp/sdd236-derived`. 이 App.app은 진단 전용 임시 코드·드라이버를 포함하므로 배포/업로드 금지. 다음 실측도 진단 전용으로 쓰며 제품 빌드 때 반드시 새 build→sync를 수행한다.
- `tools/instrument-ios.py`, `tools/offline-driver.js`, `tools/web-baseline.mjs`에 진단 도구를 보존했다. instrument는 AppDelegate에 진단 코드를 주입하므로 진단 후 해당 파일을 반드시 복원한다. 제품 빌드/배포에 포함하지 않는다.
