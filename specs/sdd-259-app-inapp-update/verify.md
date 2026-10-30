# SDD-259 Verify (구현 전 QA 체크리스트)

## A. vitest (`frontend/tests/sdd259-app-update.test.ts*`)
- A1 parse: 정상 JSON 정규화 / schemaVersion≠1·비객체 → null
- A2 sha256: 64 hex 아니면 '' , 대문자→소문자
- A3 URL: http·javascript: → '' , apkUrl 호스트가 허용 목록 밖 → ''
- A4 숫자 음수·NaN → 0
- A5 isOutdatedBuild: 설치<최신 true, 같음/높음 false, 최신 0 false, 설치 NaN false
- A6 decideUpdate(조건 분기): web → none / updateBannerEnabled=false → none / android 최신 없음 → none / android·outdated → android / ios·outdated → ios / apkUrl·sha 비면 android 는 site-fallback 아닌 none
- A7 dismiss: 같은 dismissKey 닫음 기억 시 숨김, 새 버전이면 다시 표시, 강제(설치<minSupportedVersionCode)면 닫기 무시
- A8 formatBytes
- A9 fetchUpdateManifest: ok→파싱, !ok·throw·무효 JSON → null, 요청에 `cache:'no-store'`
- A10 홈 경로 가드 `isUpdateHomePath`: /app, /dashboard, /dashboard/org true / /class/x/enter, /sessions/x/player, /login false
- A11 컴포넌트: notice 있으면 배너 문구·[업데이트]·[나중에]; iOS 안내 문구에 TestFlight; 진행률/오류 재시도/설치 허용 단계 렌더

## B. 네이티브 (JVM)
- B1 ApkVerifier.sha256Matches: 동일/불일치/대소문자
- B2 isAllowedApkUrl: https+허용 호스트만
- B3 파일명 정제: 경로 탈출(`../`) 불가
- B4 Gradle 컴파일 통과: `./gradlew :app:compileDevDebugKotlin -PskipMeasurementCore=true`
- B5 기본 빌드 매니페스트에 REQUEST_INSTALL_PACKAGES 없음, `-PmbSideload=true` 시 있음 (processDevDebugManifest 결과 확인)

## C. 정적
- C1 `tsc -b`, `eslint`(신규 파일), `vite build` 통과
- C2 전체 vitest 신규 실패 0 (기준선 대비)

## D. 실기기 절차(감독 수행, 본 작업 미실행)
summary.md 에 절차 기록.
