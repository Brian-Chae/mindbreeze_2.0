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

## E. 추가 시나리오 — 회원 셸 누락 수정 (fix, 구현 전 작성)
- E1 ClientShell 렌더 시 `AppUpdateBanner` 가 포함된다(소스 계약 + 렌더 시 `/app` 에서 시트 노출).
- E2 AppShell·ClientShell 둘 다 배너를 포함하되, 한 화면에 두 셸이 동시에 마운트되지 않는다(StructureShell 은 role 로 하나만 선택) → 배너·매니페스트 조회 1회.
- E3 셸별 경로 노출: ClientShell `/app` 노출 / `/app/classes`·`/class/x/enter`·`/sessions/x/player` 미노출. AppShell `/dashboard`·`/dashboard/org` 노출.
- E4 역할 홈 라우트 전수: 회원 `/app`(StructureShell→ClientShell), 코치 `/dashboard`(AppShell), 기관관리자 `/dashboard/org`(AppShell) 가 isUpdateHomePath 와 일치.
- E5 tsc·eslint(변경 파일)·vite build 통과, 전체 vitest 신규 실패 0.
