# SDD-292 Plan

## 방식
Xcode **configuration 추가** 방식(타깃 복제 X). 타깃 1개 유지 → SPM·소스 중복 없음.

| 파일 | 변경 |
|---|---|
| `frontend/ios/App/App.xcodeproj/project.pbxproj` | 프로젝트·타깃 구성 `Debug-Dev`, `Release-Dev` 추가. 기존 Debug/Release에 `APP_DISPLAY_NAME="MIND BREEZE"`, `GOOGLE_REVERSED_CLIENT_ID=<현 운영값>` 명시 |
| `frontend/ios/App/App/Info.plist` | `CFBundleDisplayName`→`$(APP_DISPLAY_NAME)`, URL 스킴→`$(GOOGLE_REVERSED_CLIENT_ID)` (운영 치환 결과 불변) |
| `…/xcshareddata/xcschemes/App-Dev.xcscheme` | Archive=Release-Dev, Run=Debug-Dev |
| `…/Assets.xcassets/AppIconDev.appiconset` | 운영 아이콘 + "DEV" 띠 (PIL 생성) |
| `frontend/ios/dev.xcconfig` | dev 구성 공통값(번들 ID `.dev`, 이름 "MB Dev", 아이콘 AppIconDev, GOOGLE_REVERSED_CLIENT_ID는 `dev.local.xcconfig`로 덮어씀) |
| `frontend/ios/dev.local.xcconfig.example` | 값 없는 템플릿. 실제 `dev.local.xcconfig`는 gitignore |
| `frontend/ios/.gitignore` | `dev.local.xcconfig`, `GoogleService-Info.dev.plist` |
| `frontend/package.json` | `ios:dev:sync`, `ios:dev:build`(시뮬레이터), `ios:dev:archive` |
| `~/.hermes/share/app-build/ios-dev-build.sh` | dev plist 주입→cap sync→archive→export(업로드)→복원 |

## 결정
- Google iOS OAuth 클라이언트는 번들 ID에 묶임 → dev 번들용 클라이언트 ID/REVERSED_CLIENT_ID 신규 필요. 값은 `dev.local.xcconfig`(URL 스킴)·`.env.dev`의 `VITE_GOOGLE_NATIVE_IOS_CLIENT_ID`로 주입. 미설정 시 운영 값 유지(로그인만 실패, 앱은 동작).
- `GoogleService-Info.plist`는 gitignore 파일. dev 빌드는 `GoogleService-Info.dev.plist`(레포 밖 보관)를 빌드 중 임시로 교체, 종료 시 원복. AppDelegate가 plist 없으면 Firebase를 건너뛰므로 없어도 빌드·실행 가능(푸시만 비활성).
- APS_ENVIRONMENT: Release-Dev=production(TestFlight는 production APNs).

## 영향 목록
| 항목 | 필요 여부 | 담당 |
|---|---|---|
| entitlements 파일 | 불필요(공용, APS_ENVIRONMENT 변수 재사용) | - |
| Sign in with Apple | dev App ID(`.dev`)에 capability 켜져 있어야 함 | 대표 확인(포털) |
| Push | dev App ID에 Push capability + Firebase iOS dev 앱 + APNs 키 업로드 | 대표 |
| Associated domains | 현재 미사용 → 불필요 | - |
| Google 로그인 | 번들 `.dev`용 iOS OAuth 클라이언트 신규, URL 스킴 교체 | 대표(콘솔) + 코드(변수화) |
| Apple 로그인 서버 aud | dev 서버 `apple_client_ids`에 `com.looxidlabs.mindbreeze2.dev` 추가 | 대표 승인 후 서버 .env.dev |
| Google 서버 aud | iOSServerClientId=웹 클라이언트 → 변경 없음 | 불필요 |
| Firebase iOS 앱 등록 | `.dev` 번들, GoogleService-Info.dev.plist 다운로드 | 대표 |
| 프로비저닝/인증서 | 자동 서명(-allowProvisioningUpdates, ASC 키) → 불필요 | - |
| ASC 앱 레코드 | 신규 생성 필요 | 대표 (`asc-record.md`) |
