# SDD-261 데이터 저장·업로드 현황 — 디자인 시안

HTML 파일을 브라우저에서 직접 열면 된다. 네트워크·빌드·외부 CSS 없이 동작한다. 데이터와 이름은 모두 가상 예시다. 제품 구현이나 서버 연동 결과가 아니다.

- `01-settings-desktop.html`: 설정 하위 현황. 리포트 반영 가능 여부, feature·원시 진행률, 클래스/회차 선택, 조회 시각.
- `02-class-participants.html`: 코치 클래스 관리 멤버 탭. 40명 전체 표, 검색·상태 필터·그룹핑·행 펼침 동작.
- `03-mobile.html`: 요약 및 먼저 확인할 4명. 각 사람 상세를 펼칠 수 있다.
- `04-states.html`: 빈 상태, 미착용, 영구 거절/격리, 오프라인의 독립 예시.

## 기존 스타일 근거

- `frontend/src/pages/SettingsPage.tsx:8`: AppShell의 설정 페이지 구조.
- `frontend/src/components/settings/settings-content.tsx`: 설정 그룹/한국어 안내 문체, 보라색 계열.
- `frontend/src/components/layout/AppShell.tsx:87`: 240px 사이드바, 배경 `#F7F4F0`, 사이드바 `#F5EDFC`.
- `frontend/src/pages/classes/host-class-detail-page.tsx`: 개요/회차/멤버/설정 탭과 회차 맥락 유지.
- `frontend/src/components/class/structure/class-members-panel.tsx`: 이름을 마스킹하지 않고 `name` 표시, 이름 없으면 ‘이름 미확인’.
- `frontend/src/components/ui/styles.ts`: `#5F0080` 주 버튼, `#F4EDF8` 보조 버튼, 20px 카드 반경, `#E8E2ED` 테두리, 24px 카드 패딩, 44px/48px 컨트롤.
- `frontend/src/components/session/SessionMonitorTable.tsx:177`: 가로 스크롤 표, `#F2F3F8` 헤더, 이름·기기·업로드 열 구조.
- `frontend/src/components/org/counselor-invite-section.tsx:293`: 카드 안 HTML 표와 셀 구분선.
- `design-system/build/outputs/tailwind/preset.cjs:6`: 기존 sans 글꼴 스택. 폰트 파일은 포함하지 않아 로컬 환경의 대체 글꼴이 적용될 수 있다.

React 컴포넌트를 HTML에서 import하지 않는다. 기존 공용 컴포넌트의 시각 규격을 인라인 CSS로 옮긴 정적 시안이다. 새 디자인 시스템을 추가하지 않았다.

## 예시 데이터와 상태 의미

40명 = 완료 35 + 진행 3 + 확인 필요 1 + 미착용 1. 착용 39명만 EEG 분모에 포함한다. 완료는 기대 범위와 서버 저장 대조 완료를 가정한 예시다. 수신율만으로 완료를 선언하지 않는다.

30분 회차의 예시 기대량은 1명당 feature 360창·원시 180청크다. feature 합계 13,974/14,040창(99.5%), 원시 6,894/7,020청크(98.2%). 실제 측정 범위와 원시 청크 계약은 미확정이며 이 시안의 기대량을 제품 계약으로 쓰면 안 된다.

리포트 반영 가능은 EEG feature 범위에 한정한다. 원시 저장은 별도이며 AI 리포트 생성·승인·발송 완료를 뜻하지 않는다. 모든 상태는 아이콘+텍스트+배경색으로 구별한다. 점수나 평가 표현은 없다.

서버 수신 기준과 폰 보고 기준을 분리했다. 폰 로컬 대기량은 현재 조회 경로가 없으므로 ‘미확인’이다. 미착용은 누락이 아니다. 격리는 저장 완료가 아니고 영구 거절은 자동 재시도 대상으로 표현하지 않는다. 오프라인 수치는 과거 조회이며 현재 완료를 보장하지 않는다.

## 확인한 것 / 확인하지 못한 것

- 헤드리스 Google Chrome에서 4개 HTML × 1440×900·390×844 캡처. `screens/qa.json`에 페이지 가로 넘침 검사 기록.
- 40명 전원, 완료 필터 35명, 검색, 그룹핑, 행 펼침, 검색 결과 없음 검증.
- `screens/*-1440x900.png`, `screens/*-390x844.png`: 기본 화면 8개. `*-390-full.png`: 모바일 전체 내용 2개(캡처할 때만 고정 하단 내비게이션을 숨김). `02-class-participants-expanded-1440x900.png`: 영구 거절 상세.
- 실제 API·대조 판정·집계 권한·오프라인 복구·실제 기기·앱 내 배포 경로는 검증하지 않았다.
- 클래스/회차는 1개짜리 선택 예시이며 서버 필터가 아니다. 새로고침은 예시 시각 변경만 수행한다. 상태 화면의 재조회는 연결하지 않은 시안임을 안내한다.

생성: `python3 designs/sdd-261-upload-status/build-mockups.py`

재검증: Playwright가 설치된 환경에서 `node designs/sdd-261-upload-status/verify-mockups.cjs`. 다른 위치의 모듈은 `PLAYWRIGHT_MODULE`로 지정한다. Chrome 경로는 macOS 기본 설치 경로를 사용한다.
