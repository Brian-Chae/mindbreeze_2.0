# SDD-292 Verify (구현 전 QA 체크리스트)

## 운영 불변
- [x] V1 `Release` 구성 빌드 설정 `PRODUCT_BUNDLE_IDENTIFIER` = `com.looxidlabs.mindbreeze2`
- [x] V2 운영 산출물 Info.plist: CFBundleDisplayName=`MIND BREEZE`, URL 스킴=기존 `com.googleusercontent.apps.1087454235919-r2r01n0q2o4s1qmjcoirghvjc24jknn2`
- [x] V3 운영 아이콘 이름 AppIcon, `git diff`에 운영 구성 값 변경 없음(추가만)
## dev
- [x] V4 `Release-Dev` 번들 ID=`com.looxidlabs.mindbreeze2.dev`, 표시 이름 `MB Dev`
- [x] V5 dev 산출물 아이콘 AppIconDev 적용(Assets.car 내 이름 확인)
- [x] V6 `App-Dev` scheme으로 시뮬레이터 빌드 성공, 산출물 CFBundleIdentifier 출력
- [x] V7 `xcodebuild -scheme App-Dev -configuration Release-Dev archive` (서명 없이) 가능 범위 통과
## 위생
- [x] V8 dev plist·`dev.local.xcconfig` 값이 git에 없음(`git status`, `git check-ignore`)
- [x] V9 시크릿 값 출력 없음
- [x] V10 `ios-dev-build.sh` 구문검사(`bash -n`), 종료 시 GoogleService-Info.plist 원복 로직
- [x] V11 Capacitor appId·Android 파일 diff 없음
