# SDD-259 — 앱 내 업데이트 알림과 다운로드 사이트 설치

- 상태: Stage ① Spec
- 브랜치: `sdd/259-app-inapp-update`
- 작성일: 2026-10-30
- 승인 근거: 대표 "업데이트 있음 알리고, 업데이트 버튼 누르면 우리 다운로드 사이트에서 설치까지"

## 1. 목표
앱이 "새 버전 있음"을 스스로 알리고, [업데이트]를 누르면 다운로드 사이트(`https://download.mindbreeze.looxidlabs.com`)의 최신 설치 파일로 설치 화면까지 이어 준다.

| 플랫폼 | 동작 |
|---|---|
| Android | 앱 안에서 APK 다운로드(진행률) → sha256 검증 → 시스템 패키지 설치 화면. 최초 1회 "이 앱의 설치 허용" 안내·설정 이동. 같은 서명 키(Play 앱 서명)라 덮어쓰기 업데이트 |
| iOS | 사이트 직접 설치 불가(애플 정책) → TestFlight 공개 링크(`https://testflight.apple.com/join/QjQGu3pG`)를 연다. 안내 문구로 구분 |
| 웹 | 노출 안 함 |

## 2. 범위
- 버전 매니페스트 `/latest.json`(다운로드 사이트, 앱 재배포 없이 파일만 교체)
- 프런트: 매니페스트 파싱·비교·표시 조건, 배너 + 업데이트 시트(진행률/오류/설치 허용 단계)
- 네이티브(Android): Capacitor 플러그인 `ApkUpdater`(다운로드·해시 검증·설치 인텐트·설치 허용 확인)
- 사이트 파일(`latest.json`, CORS·캐시 설정 안내) — 업로드는 감독이 수행

범위 밖: SDD-254(PR #178) 전체 머지, 사이트 S3 업로드, 앱 빌드·스토어 제출, 강제 업데이트 운영(옵션만 둠).

## 3. 설계 결정과 근거
1. **ApkUpdater 플러그인**: OkHttp(이미 의존성) 스트리밍으로 앱 캐시 폴더(`cache/updates`)에 받고 SHA-256 검증(불일치 시 삭제·오류). FileProvider(기존 `${applicationId}.fileprovider`, `cache-path` 이미 선언) URI로 `ACTION_VIEW`(`application/vnd.android.package-archive`). `canRequestPackageInstalls()` 거짓이면 `ACTION_MANAGE_UNKNOWN_APP_SOURCES` 설정 화면으로 안내. DownloadManager 대신 OkHttp: 진행률·해시 검증·취소를 앱이 직접 통제.
2. **스토어 정책 위험**: `REQUEST_INSTALL_PACKAGES`는 Play 심사에서 선언·소명 대상. 하나의 AAB로 스토어·사이트 APK를 모두 만들고 있으므로 변형 분리가 필요 → plan §2 비교, **기본 구현 = 안1(권한을 `-PmbSideload=true` 빌드에만 포함)**. 플러그인은 권한이 없으면 `installSupported=false`를 보고하고 프런트는 "다운로드 사이트 열기" 폴백으로 동작 → 스토어 빌드에서도 안전.
3. **표시 조건**: 네이티브 && `updateBannerEnabled=true` && 설치 빌드번호 < 매니페스트 최신. 같은 버전 닫기 기억(dismissKey). `minSupportedVersionCode` 이상 설치본이 미만이면 닫기 불가(기본 0=꺼짐).
4. **기본 꺼짐**: 11/4 현장 프로그램 중 알림 끄기 결정 → `updateBannerEnabled` 기본 false. 켜는 것은 사이트 `latest.json` 한 파일.
5. **측정·수업 중 비노출**: 배너는 홈 경로(`/app`, `/dashboard`, `/dashboard/org`)에서만 렌더. 클래스 입장·플레이어·측정 화면은 경로가 달라 노출되지 않는다. 설치 화면으로 이탈하는 동작은 사용자가 [업데이트]를 누른 경우에만.
6. **문구**: 한국어, "코치" 용어 유지.

## 4. 매니페스트 형식 (`/latest.json`, schemaVersion 1)
```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-10-30",
  "updateBannerEnabled": false,
  "minSupportedVersionCode": 0,
  "android": { "versionName": "", "versionCode": 0, "apkUrl": "", "sha256": "", "sizeBytes": 0, "publishedAt": "", "notes": "" },
  "ios": { "testflightUrl": "https://testflight.apple.com/join/QjQGu3pG", "latestBuild": 0 }
}
```
검증: https 주소만, sha256 64 hex, 숫자 음수 불가, apkUrl 호스트는 `download.mindbreeze.looxidlabs.com` 허용 목록(네이티브에서도 재검증).

## 5. 비기능
- CORS: 사이트가 `capacitor://localhost`, `https://localhost`, 운영 웹 도메인에서 `latest.json` 읽기 허용(CloudFront 응답 헤더 정책).
- 캐시: `latest.json`은 `Cache-Control: max-age=60`(+ 쿼리 `?t=` 우회), APK는 파일명 불변이면 무효화 필요 → 버전별 파일명(`mindbreeze-android-vcNN.apk`) 권장.
- 오류는 조용히 무시(알림 생략), 다운로드 오류는 시트에서 재시도.
- 개인정보·시크릿 없음.

## 6. 성공 기준
verify.md 시나리오 전부 통과, 기존 테스트 신규 실패 0, 이 기능은 vc28 이상 빌드부터 동작.
