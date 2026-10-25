# SDD-245 페이지 헤더 누락 보완 — 구현 근거

## 이관과 규칙

- 제품 페이지 파일 34개와 공용 회차 상세 뷰 1개, 소스 단위 총 35개의 셸 헤더를 이관했다. 상태별 중복 JSX는 중복 집계하지 않았다. 실제 역할·라우트 표본 집계는 `header-measurements.json`에 별도 보존한다. 전체 목록은 `header-inventory.md`.
- AppShell·ClientShell이 PageHeader를 직접 사용하며 StructureShell도 이를 재사용한다. 기존 PageHeading은 PageHeader에 위임한다.
- 제목 22px/700. 오른쪽 액션 슬롯은 제목과 세로 중심을 맞춘다. 모바일에서는 아래 행으로 내려 같은 폭으로 배치한다. 선택 오버라인은 모바일 본문 하한에 맞춰 13px로 제목 위에 유지하며 리포트의 영문 REPORTS/AI REPORTS만 제거했다.
- 헤더 sm은 모바일·데스크톱 모두 44px. primary는 진보라 채움 pill, secondary는 흰 배경·보라 1px 테두리 pill. 색/hover/focus/disabled는 기존 buttonClass를 재사용한다.
- primary를 문자열이나 CSS에서 추론하지 않고 호출부에서 `data-header-action`으로 명시한다. 보조→주를 DOM 순서에서도 보장한다. 새 클래스는 주, 지금 바로 시작은 보조. 기존 문구·링크·클릭 핸들러·disabled·aria 속성을 보존한다.
- 아이콘만 있는 더보기 버튼은 분해하지 않고 그대로 보존한다. 레이아웃 wrapper의 속성·핸들러는 유지하면서 display:contents로 슬롯 레이아웃을 연결한다. 전역 button/div 스타일 덮어쓰기는 하지 않는다.

## 원인과 실측으로 보완한 항목

- 기존 홈 액션은 390에서 48px, 클래스는 높이44/radius12px이며 역할·순서 반대, 리포트는 연보라 배경이었다. 합성 Chrome 기준의 실측이며 Brian의 iPhone 관찰값과 구별한다.
- 새 헤더 모바일 flex grow가 본문과 남은 높이를 나누는 문제를 초기 측정에서 검출해 mobile flex:none으로 분리했다.
- 상담사 홈의 폐기된 ch-header-actions 클래스가 legacy :has CSS와 매칭되어 nowrap을 강제했다. 해당 클래스 연결을 제거하고 최종 빌드로 전수 재측정했다. 중간 산출물은 최종 증거에 포함하지 않았다. 이후 전체 테스트가 검출한 오버라인 12px 하한 위반도 13px로 수정하고 최종 final3 빌드로 재측정했다.
- 클래스 생성 버튼의 역할·순서 변경으로 기존 첫 링크 단언이 충돌했다. 문구별 href 단언과 보조→주 순서를 모두 검사하도록 강화했다.
- 기존 SDD-234 테스트의 모바일 헤더48 단언은 신규44 계약과 충돌하므로 헤더 개수·44를 검사하고 본문 hero CTA의48 검증은 별도로 유지했다. 기존 데스크톱 기준선 단언은 수정하지 않았다.
- 클래스 상세의 이전 border 색 단언은 aria-current와 공용 탭의 활성 배경·글자색·pill 규격을 함께 검사하도록 강화했다.

## 필터

- 클래스 목록 검색·상태, 상담사/회원 클래스 상세 탭, 리포트 검색·탭·select를 공용 토큰으로 이관했다.
- 기존 관리자·회원관리 fieldClass와 세션 목록 공용 shell-kit 토큰 사용은 grep으로 확인했다. 리포트 select 3개 구성/순서/세로 배치는 바꾸지 않았다.

## 캡처

- `dashboard-390-{before,after,compare}.png`
- `classes-390-{before,after,compare}.png`
- `reports-390-{before,after,compare}.png`
- compare 3개 모두 도구로 직접 열어 제목·액션·본문 시작 위치·폭·순서를 확인했다.
- before는 제품 소스 수정 전 빌드(구현 전 verify 커밋 3f7fc641, 제품 소스는 9e6aae1a와 동일), after는 최종 final3 빌드다.

## 재현과 범위

감사 전용 빌드는 환경파일/실서버를 사용하지 않는다. 기존 synthetic fixture와 네트워크 차단을 재사용한다.

```bash
AUDIT_BUILD_INFO=/tmp/header-build.json node specs/sdd-245-ui-unification/audit/build.cjs
AUDIT_BUILD_INFO=/tmp/header-build.json AUDIT_OUT=/tmp/header-audit node specs/sdd-245-ui-unification/audit/measure.cjs
node specs/sdd-245-ui-unification/audit/assert-page-headers.cjs /tmp/header-audit
```

최종 전수 실행은 AUDIT_SKIP_HOVER=1로 이전 감사의 일반 본문 컨트롤 hover 표본만 생략했다. 요청한 헤더 geometry/배경/테두리/순서/제목 대비 위치·전체 캡처는 모두 수집했다.

독립 검사기는 제목22/700, 액션44/pill/배경/테두리/최대 주1개/DOM순서/같은 행 중심±1px/아래 행 동일폭을 검사하며 AppShell 헤더 측정 누락도 실패 처리한다. 모바일 채팅방은 기존 hideMobileTitle 명시 예외다. 공개 독립 화면·로그인·플레이어는 정본 헤더 대상이 아니지만 전체 라우트 측정 결과에 남긴다.

실제 iPhone·dev 서버·운영 API/DB 검증은 수행하지 않았다. 커밋·push·PR·CI 및 전체 vitest/tsc/eslint/build 결과는 감독의 summary에 기록한다.

## 집중 테스트

- `sdd245-page-header`, `class-create-action`, `sdd245-ui-primitives`, `host-class-structure`: 4파일 32건 통과.
- PageHeader 회귀 테스트는 disabled·aria·onClick·아이콘 더보기 onClick·DOM 보조→주 순서·모바일 스와이프 제목 훅을 확인한다.
- 구현 담당의 tsc 및 신규 UI 관련 ESLint도 통과했다. 최종 전체 검사 결과가 이 집중 검사보다 우선한다.

## 최종 전수 결과

- 390: 162표본, 헤더81, 액션 헤더32, 액션41, 불일치0.
- 1440: 162표본, 헤더89, 액션 헤더32, 액션41, 불일치0.
- manifest109개, 역할별162×2=324개 전부 완료, id 중복0. 헤더 없는154표본도 사유를 개별 저장했다.
- 상세 metrics·판정·manifest·최종3 소스/번들 hash는 같은 디렉터리 JSON 4종으로 저장했다.
