# ASC 앱 레코드 생성 입력값 (대표 작업)

ASC 웹 로그인이 필요해 에이전트가 생성하지 않음. App Store Connect → 앱 → "+ 신규 앱":

| 항목 | 값 |
|---|---|
| 플랫폼 | iOS |
| 이름 (후보 순) | `MB Dev` → 사용 중이면 `MIND BREEZE Dev` → `MINDBREEZE 개발` |
| 기본 언어 | 한국어 |
| 번들 ID | `com.looxidlabs.mindbreeze2.dev` (등록됨, 드롭다운에서 선택) |
| SKU | `mindbreeze2-dev` |
| 사용자 액세스 | 제한 없음 |

생성 후:
1. 앱 Apple ID(숫자) 알려주기 → `ios-dev-build.sh`의 `DEV_APP_ID`에 기록
2. TestFlight 내부 테스터 그룹 생성(기존 테스터 추가), 수출 규정 문서: 암호화 사용 안 함(Info.plist ITSAppUsesNonExemptEncryption=false)
3. 개인정보·스크린샷은 TestFlight 내부 테스트엔 불필요
