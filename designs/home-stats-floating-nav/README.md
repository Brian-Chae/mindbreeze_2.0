# SDD-233 홈 상태 카드·플로팅 메뉴 시안

Stage ① Spec 검토용 정적 시안. 제품 구현이나 실제 dev 화면 캡처가 아니다.

## 열기

`index.html`을 Chrome에서 열면 현재/제안 회원·상담사 390px 비교와 A/B×아이콘/라벨 4조합, 역할별 탭 표를 볼 수 있다. 폴더 전체를 복사해도 동작한다. 서버·CDN·외부 폰트가 필요 없다. 시스템 한글 폰트와 `assets/background5.webp`, `assets/logo.svg`(기존 저장소 자산 복사)만 사용한다.

개별 화면 쿼리 예:

- `index.html?view=home&role=member&mode=proposed&style=A&labels=1`
- `index.html?view=home&role=counselor&mode=current`
- `index.html?view=home&style=B&labels=0&safe=34`
- `role=org|platform`, `counsel=0|1`로 역할·상담 공개 메뉴 비교 가능. 회원/상담사 외 홈 본문은 해당 역할 제품 홈을 재현하지 않으며 메뉴 점검용이다.

시안의 더보기와 햄버거는 역할별 샘플 메뉴를 열고, 나머지 버튼은 제품 연결 없이 이동 안내만 표시한다. 예시 이름·수치는 샘플 데이터다. 현재 재구성은 핵심 배치만 비교하며 초대·모든 조건부 배너·하단 부가 기능 전체를 동일 재현하는 제품 회귀 자료는 아니다. 데스크톱 회원의 상태 카드가 이미 위에 있다는 현재 CSS 특성을 유지했다.

## 결과

- Chrome headless, 로컬 file URL. 390×844 / 430×844 / 1440×1000.
- 홈 2역할×현재/제안×3폭 = 12개. 가로 넘침 0, JS 오류 0. 제안 상태 카드→클래스 간격 20px(모바일)/24px(데스크톱), 모바일 2열·데스크톱 4열. 데스크톱 실제 하단 바 숨김.
- 내비 2폭×A/B×아이콘/라벨×safe-area 0/34 = 16개. 마지막 요소와 바 사이 최소 약 21.9px, 가림 0. 5개 탭과 모든 aria-label 확인.
- 4역할×상담 공개/비공개 8개 메뉴 검사. 5개 유지, 알림 하단 슬롯 없음, 상담 비공개 메뉴 제외, 회원에게 관리 메뉴 미노출.
- 1440px 비교 페이지의 내비 4조합 모두 보임. 독립 읽기 전용 검토 후 갤러리 숨김·역할 메뉴 오류를 수정하고 재검토했다.
- PNG 총 33개: 홈 전체 12개 + 모바일 제안 첫 화면 4개 + 하단 끝/스타일 16개 + 전체 비교 1개.
- 상세 기하·역할 기록: `fit-results.json`.

주요 PNG:

- `screenshots/comparison-1440.png`: 현재↔제안 및 A/B 전체 비교.
- `screenshots/member-proposed-390-viewport.png`, `counselor-proposed-430-viewport.png`: 모바일 첫 화면.
- `screenshots/member-current-1440.png`, `member-proposed-1440.png`, `counselor-proposed-1440.png`: 홈 데스크톱.
- `screenshots/nav-A-labels-390-safe34.png`, `nav-B-labels-390-safe34.png`: 끝까지 스크롤한 밝은/어두운 바.
- `screenshots/nav-A-icons-430-safe34.png`, `nav-B-icons-430-safe34.png`: 아이콘만 비교.

## 재현

`node capture.cjs` (이 워크트리에서 실행 시 경로 포함). Playwright와 로컬 Chrome 설치가 필요하다. capture.cjs 기본 Playwright 경로는 인접 메인 저장소의 기존 의존성이다. 다른 PC에서는 `SDD233_PLAYWRIGHT`에 설치된 playwright 모듈 경로를 지정한다. HTML 열기에는 이 도구가 필요 없다. 실행은 캡처 PNG와 JSON만 생성한다. 제품 서버·DB·.env를 읽지 않는다.

## 한계·다음 단계

실제 iOS Safari의 툴바 확장·축소/키보드/회전/홈 인디케이터는 확인하지 않았다. safe-area 34px은 Chrome에서 CSS 변수 모의다. 실제 API·로그인·권한 실행·메일·EEG·제품 동작은 이번 검증 대상이 아니다. 제품 코드를 바꾸지 않았으므로 제품 테스트/빌드를 실행하지 않았다.

추천은 A + 작은 라벨. A의 유리 효과는 DESIGN.md 금지 규칙에 대한 하단 바 한정 예외 결정이 필요하다. Spec의 역할별 구성과 스타일 승인 후 Plan·구현 전 Verify로 진행한다.
