# SDD-259 Summary

## 결과
앱이 `https://download.mindbreeze.looxidlabs.com/latest.json` 을 읽어 "새 버전 있음"을 홈 화면에서 알리고, Android 는 앱 안에서 APK 다운로드(진행률)→sha256 검증→시스템 설치 화면까지, iOS 는 TestFlight 링크로 연결한다. 웹은 노출 없음. **vc28 이상 빌드부터 작동**(이전 설치본에는 코드가 없음).

## 변경 파일
- 프런트: `src/lib/update/{update-config,apk-updater,use-app-update}.ts`, `src/components/update/AppUpdateBanner.tsx`, `AppShell.tsx`(마운트), `public/latest.json`(견본, 꺼짐)
- Android: `update/{ApkVerifier,ApkUpdaterPlugin}.kt`, `MainActivity.java`(등록), `src/sideload/AndroidManifest.xml`, `app/build.gradle`(`-PmbSideload=true`)
- 테스트: `tests/sdd259-app-update{,-view}.test.ts(x)`, `ApkVerifierTest.kt`

## 검증 결과 (verify.md 대응)
| 항목 | 결과 |
|---|---|
| A1~A11 vitest | 29건 통과 |
| B1~B3 JVM `ApkVerifierTest` | 통과 |
| B4 `:app:compileDevDebugKotlin` | 통과 |
| B5 매니페스트 | 기본 devDebug·prodRelease: REQUEST_INSTALL_PACKAGES **없음** / `-PmbSideload=true`: **있음** |
| C1 tsc -b · eslint(신규·수정 파일) · `npm run build` | 통과 (dist/latest.json 포함 확인) |
| C2 전체 vitest | 13 실패 = 기준선(변경 전 커밋)과 동일 실패 목록, 신규 실패 0 (통과 3654→3683) |

기준선 실패 13건(sdd220 네이티브 릴리스·sdd234·브라우저 스위트 등)은 이번 변경과 무관.

## 대표 결정 항목 — 스토어 정책
`REQUEST_INSTALL_PACKAGES` 는 Play 정식 출시 심사에서 선언·소명 대상. **안1 구현(권고)**: 권한은 `-PmbSideload=true` 빌드(다운로드 사이트용 APK)에만 포함, Play 제출용 AAB 에는 없음. 권한 없는 빌드는 `installSupported=false` → 시트가 "다운로드 사이트 열기"로 폴백. 안2(상시 포함+소명)는 반려 위험이 커서 비권고. 결정 필요: **사이트 배포용 APK 를 sideload 플래그로 별도 빌드**하는 운영 방식 승인.
- 주의: 같은 서명 키여야 덮어쓰기 설치됨(Play 앱 서명 인증서 c34e3781…). sideload APK 는 Play 업로드 키가 아니라 **앱 서명 키로 서명된 APK**여야 하므로, Play 콘솔 내부 공유/다운로드한 서명 APK 또는 동일 키 보유 여부를 빌드 시 확인.

## 사이트 업로드 (감독 실행)
1. `latest.json`: 신규 버전 공개 시 아래 값을 채워 업로드(`updateBannerEnabled:true`로 켜는 것이 곧 공지 시작)
   ```
   aws s3 cp latest.json s3://mindbreeze-download/latest.json --content-type application/json --cache-control "max-age=60"
   aws s3 cp mindbreeze-android-vc28.apk s3://mindbreeze-download/mindbreeze-android-vc28.apk --content-type application/vnd.android.package-archive
   aws cloudfront create-invalidation --distribution-id E290SJQY3PJKL0 --paths /latest.json
   ```
   sha256·sizeBytes 는 `shasum -a 256`, `stat -f%z` 로 산출. APK 는 버전별 파일명 권장(캐시 무효화 불필요).
2. CORS: CloudFront 응답 헤더 정책에 `Access-Control-Allow-Origin` 허용 출처 `capacitor://localhost`, `https://localhost`, 운영 웹 도메인, 메서드 GET/HEAD. (WebView fetch 는 CORS 적용, APK 다운로드는 네이티브 OkHttp 라 무관)
3. 현재 기본 파일은 `updateBannerEnabled:false` — 업로드해도 알림이 켜지지 않는다.

## 앱 재빌드
- vc28+ 필요. 사이트용: `cd frontend && npm run build:prod && npx cap sync android && cd android && ./gradlew assembleProdRelease -PversionCode=28 -PmbSideload=true`(릴리스 서명 설정 필요). Play용: 플래그 없이 `bundleProdRelease`.

## 실기기 시험 절차 (SM-N971N, 감독 수행 — 본 작업에서는 미실행)
1. vc27 설치본 유지. 시험용 sideload APK 를 vc28(이상)로 빌드해 사이트(또는 시험 경로)에 올리고 sha256 기록.
2. 먼저 vc28 이상을 한 번 설치(이 코드 포함). 이후 vc29 를 추가 빌드·업로드.
3. `latest.json` 에 vc29 정보 + `updateBannerEnabled:true` 업로드 → 앱 홈(`/app`)에서 시트 노출 확인(수업·측정 화면에서는 미노출).
4. [업데이트] → 설치 허용 미설정이면 "설치 허용이 필요해요" → [설정 열기] → 허용 후 복귀 시 자동 이어서 다운로드 진행률 → 설치 화면 → 설치 후 버전 확인.
5. 오류 시험: sha256 을 틀리게 올림 → "내려받은 파일이 올바르지 않아요" + 다시 시도. 비행기 모드 → 다운로드 실패 문구.
6. [나중에] 후 재실행 시 같은 버전 미노출, 더 높은 버전 올리면 다시 노출. `minSupportedVersionCode` 를 설치본 초과로 올리면 [나중에] 없음.
7. 시험 후 `updateBannerEnabled:false` 로 복구.

## 알려진 한계
- 실기기 설치 화면 동작은 미시험(절차만 기술).
- `getInstallCapability` 는 매니페스트 선언 여부로 sideload 빌드를 판별.
- 측정·수업 중 비노출은 홈 경로 한정 렌더로 보장(별도 상태 스토어 의존 없음).
