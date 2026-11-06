# SDD-292 Summary — iOS dev 전용 앱 분리

## ⚠️ 대표 작업 목록 (코드로 못 하는 것)
| # | 작업 | 위치 | 비고 |
|---|---|---|---|
| 1 | ASC 앱 레코드 생성 (`MB Dev`, 번들 `.dev`, SKU `mindbreeze2-dev`) | App Store Connect | 입력값: `asc-record.md`. 생성 후 앱 Apple ID 전달 |
| 2 | Firebase 콘솔에 iOS 앱 `com.looxidlabs.mindbreeze2.dev` 추가 → `GoogleService-Info.dev.plist` 를 `~/.hermes/share/app-build/secrets/` 에 저장 | Firebase | 푸시·Google 로그인 |
| 3 | APNs 인증 키(.p8)를 Firebase에 업로드(운영과 같은 키 재사용 가능) | Firebase | dev 푸시 |
| 4 | `.dev` App ID에 Push·Sign in with Apple capability 확인 | Apple 개발자 포털 | 자동 서명이 대부분 처리 |
| 5 | dev 번들용 Google iOS OAuth 클라이언트 → REVERSED_CLIENT_ID 를 `frontend/ios/dev.local.xcconfig` 에, CLIENT_ID 를 `.env.dev` `VITE_GOOGLE_NATIVE_IOS_CLIENT_ID` 에 | Google/Firebase | 없으면 dev 앱 Google 로그인만 실패 |
| 6 | dev 서버 `apple_client_ids` 에 `com.looxidlabs.mindbreeze2.dev` 추가 | 서버 `.env.dev` | 서버 설정 변경 → 건별 승인 필요 |

## 결과
- Xcode 구성 `Debug-Dev`/`Release-Dev` + scheme `App-Dev` 추가(타깃 1개 유지). 운영 `Debug`/`Release`는 값 동일(표시 이름·URL 스킴만 변수로 명시).
- dev: 번들 `com.looxidlabs.mindbreeze2.dev`, 표시 이름 `MB Dev`, 아이콘 `AppIconDev`(빨간 DEV 띠).
- `package.json`: `ios:dev:sync`, `ios:dev:sim`, `ios:dev:archive`.
- `~/.hermes/share/app-build/ios-dev-build.sh` (`DEV_BUILD_NO` 필수, `UPLOAD=1` 일 때만 export 업로드; dev plist 임시 주입 후 원복).
- Capacitor appId·Android·entitlements 파일 변경 없음.

## 검증 (verify.md 대응)
| 항목 | 결과 |
|---|---|
| V1·V2 운영 Release archive(서명 없음) | 번들 `com.looxidlabs.mindbreeze2`, 이름 `MIND BREEZE`, URL 스킴 기존값 ✅ |
| V4·V7 dev Release-Dev archive | 번들 `…mindbreeze2.dev`, 이름 `MB Dev` ✅ |
| V5 아이콘 | 산출물에 `AppIconDev*.png` ✅ |
| V6 시뮬레이터 빌드 | App-Dev(Debug-Dev)·App(Debug) 모두 성공 ✅ |
| V8 위생 | `dev.local.xcconfig`·`GoogleService-Info.dev.plist` gitignore ✅ |
| V10 스크립트 | `bash -n` 통과, EXIT trap으로 plist 원복. **실제 실행(서명 archive·업로드)은 안 함** |

## 확인 못 한 것 / 함정
- 서명된 archive·TestFlight 업로드: ASC 레코드가 없어 미실행.
- GoogleService-Info.plist(gitignore)가 없으면 빌드가 "Build input file cannot be found"로 실패 — 검증 때 스텁을 임시로 넣고 삭제함. 일반 빌드는 기존처럼 plist가 있어야 함.
- dev URL 스킴은 대표 작업 5 전까지 운영 값(로그인 불가 상태 아님, 단 dev 번들용 클라이언트는 아님).
- 새 워크트리 빌드 전제: `npm ci --legacy-peer-deps`, `ios/MeasurementKit/scripts/build-core-xcframework.sh` (Rust).
- 시험 중 Xcode가 패키지 해석 단계에서 한 번 Abort(SPM 크래시) → 재실행으로 해결.
