# SDD-259 Plan

## 1. 구조
```
frontend/src/lib/update/
  update-config.ts     # 타입, parseUpdateManifest, compare/shouldShow, 허용 호스트, formatBytes
  apk-updater.ts       # Capacitor 플러그인 프록시(registerPlugin 'ApkUpdater') + 타입
  use-app-update.ts    # 훅: 매니페스트 조회 → notice, dismiss, 상태머신(idle/downloading/needs-permission/ready/error)
frontend/src/components/update/AppUpdateBanner.tsx   # 배너 + 시트
frontend/public/latest.json                          # 사이트에 올릴 기본(꺼짐) 파일 견본
frontend/android/.../update/ApkUpdaterPlugin.kt      # 다운로드·해시·설치 인텐트
frontend/android/.../update/ApkVerifier.kt           # 순수 로직(해시 비교·호스트 검증·파일명) — JVM 단위 시험
frontend/android/app/src/sideload/AndroidManifest.xml # REQUEST_INSTALL_PACKAGES 오버레이
```
- AppShell에 `<AppUpdateBanner />` 마운트(홈 경로 가드 포함).
- SDD-254 `beta-config.ts`의 `safeHttpsUrl/parse` 패턴·dismissKey를 재사용(파일 복사 후 `update-` 로 개명, 랜딩/QR 부분 제외).

## 2. 스토어 정책 대응안 비교
| | 안1: 변형 분리(채택) | 안2: 권한 상시 + Play 소명 |
|---|---|---|
| 방식 | `-PmbSideload=true` 일 때만 `src/sideload` 매니페스트 오버레이로 권한 포함. 기본(Play 제출용 AAB)엔 권한 없음 | 모든 빌드에 권한 |
| Play 심사 | 선언 불필요 | 앱이 "패키지 설치" 핵심 기능이 아니면 반려 위험 높음 |
| 사이트 APK | sideload 로 별도 빌드(빌드 명령 1개 추가) | 동일 AAB 재사용 |
| 폴백 | 권한 없는 빌드는 `installSupported=false` → "다운로드 사이트 열기" | 불필요 |
| 비용 | 사이트용 APK를 sideload 플래그로 별도 생성해야 함 | 낮음, 정책 위험 |
- 안1은 Gradle 속성 하나(adbtest 선례와 같은 `sourceSets` 방식)로 구현되어 flavor 차원을 늘리지 않는다(CI 태스크명·`merge(Dev|Prod)…` 정규식 불변).
- 대표 결정 항목: 안1 유지 여부(권고 안1).

## 3. Task
1. update-config.ts + vitest (RED→GREEN)
2. apk-updater.ts 프록시 + use-app-update.ts 훅 + 배너/시트 UI + AppShell 마운트
3. ApkVerifier.kt(순수) + JVM 테스트
4. ApkUpdaterPlugin.kt + MainActivity 등록 + sideload 매니페스트 + build.gradle 속성
5. latest.json 견본, 사이트 업로드 안내(summary)
6. tsc·eslint·build·vitest, Gradle 컴파일

## 4. 프런트 상태머신
`hidden → available → (Android installSupported) downloading(progress) → verifying → installing`
오류: `error(retry)`. 설치 허용 없음: `needs-permission(설정 열기) → 복귀 시 재확인`.
iOS: [업데이트] = TestFlight 링크 열기. Android 미지원 빌드: 다운로드 사이트 열기.

## 5. 플러그인 API
- `getInstallCapability(): {installSupported, canInstall}`
- `downloadAndInstall({url, sha256, sizeBytes?})` — 진행률 이벤트 `progress {received,total}`, 결과 `{status:'installing'}` 또는 reject(code)
- `openInstallSettings()`
- 네이티브 재검증: https + 호스트 허용 목록 + sha256 형식.
