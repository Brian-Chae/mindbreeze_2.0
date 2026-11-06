# SDD-318 — Plan

## 1. 분기 방식(원칙: 신규 파일 + 진입점에서 선택, 기존 파일 수정 최소)
플래그 함수 `isUiV2Enabled()`(`lib/feature-flags.ts`에 추가, `VITE_UI_V2 === 'true'`).
운영 빌드(`--mode prod`)는 `vite.config.ts` 의 `define` 에서 `'false'` 로 **고정**(SDD-286 방식과 동일) → 환경변수로 켤 수 없고, 죽은 분기는 번들러가 제거한다.
dev 는 `.github/workflows/deploy-dev.yml` 의 `.env` 생성에 `VITE_UI_V2=true` 한 줄 추가.

| 분기 지점 | 방법 | 기존 파일 수정량 |
|---|---|---|
| `/app` 홈, `/app/classes`, `/app/classes/:id` | `App.tsx` 라우트 element 를 신규 `ui-v2/ui-v2-routes.tsx` 의 선택 컴포넌트로 교체(`isUiV2Enabled() ? <V2/> : <기존/>`) | App.tsx 3줄 |
| `/app/reports` | `ClientAppPage.tsx` 의 `renderTabContent`/쉘 선택에서 내담자 리포트 탭만 V2 분기 | ClientAppPage 소폭 |
| 리포트 상세 | `ClientReportListPage` 가 쓰는 모달을 V2 일 때 `UiV2ReportSheet` 로 교체(목록 V2 컴포넌트가 직접 사용) | 기존 파일 0(신규 목록이 신규 시트 사용) |
| 쉘 | 신규 `UiV2ClientShell`. 기존 `ClientShell`/`AppShell`(상담사 공유) **무수정**. V2 화면이 자체 쉘을 감쌈 | 0 |

`AppShell`·`ClientShell` 은 건드리지 않는다. 훅(알림 소켓·미읽음 로드·스와이프)은 신규 쉘에서 **기존 훅을 그대로 재사용**한다(동작 동등).

## 2. 신규 파일(`frontend/src/`)
| 파일 | 역할 |
|---|---|
| `styles/ui-v2.css` | `.ui-v2` 스코프 변수·클래스(전 규칙이 `.ui-v2` 하위). 전역 규칙 없음 |
| `components/ui-v2/ui-v2-arc-ring.tsx` | 공용 라이트 아크 링(고정 장식, `aria-hidden`) |
| `components/ui-v2/ui-v2-client-shell.tsx` | 접히는 큰 제목 헤더 + 알림 버튼 + 하단 예약 + 플로팅 내비 |
| `components/ui-v2/ui-v2-bottom-nav.tsx` | `getMobileMenuTabs` 순서·배지 재사용, D 내비 모양 |
| `pages/client/ui-v2/ui-v2-home-page.tsx` | 홈 |
| `pages/client/ui-v2/ui-v2-classes-page.tsx` | 클래스 목록 |
| `pages/client/ui-v2/ui-v2-class-detail-page.tsx` | 클래스 상세 |
| `pages/client/ui-v2/ui-v2-reports-page.tsx` | 리포트 목록 |
| `components/ui-v2/ui-v2-report-sheet.tsx` | 리포트 상세 시트(dialog) |
| `pages/client/ui-v2/ui-v2-routes.tsx` | 라우트 선택 컴포넌트 |
| `scripts/check-ui-v2-off.mjs` | 운영 번들 검사 |
| `tests/sdd318-*.test.ts(x)` | 플래그·컴포넌트 시험 |
| `e2e/sdd318-capture.mjs` | 캡처·측정 |

## 3. 수정 파일(최소)
`lib/feature-flags.ts`(함수 1개), `vite.config.ts`(define 1줄), `.github/workflows/deploy-dev.yml`(1줄), `scripts/check-release-bundle.mjs`(V2 활성 검사 1줄), `App.tsx`(3줄), `pages/client/ClientAppPage.tsx`(리포트 탭 분기).

## 4. 결정 사항(시안에 없는 기존 요소)
D1 초대 카드·코드 입장·담당 코치·상담 섹션은 홈 하단에 D 카드(흰 표면, 반경 24)로 배치한다. D2 클래스 신청·코드 가입은 목록 상단 보조 버튼/하단 카드로 둔다. D3 진행바는 아크가 대체하지 않고 "전체 회차 n/m" 숫자(46px)로 표시(완료율 문구 금지). D4 상세의 나가기/대기 `MemberOperations` 는 커버 아래에 그대로 둔다.

## 5. 단계 순서·난이도·위험
| 순 | 작업 | 난이도 | 위험 |
|---|---|---|---|
| 1 | 플래그·토큰·아크·쉘·내비 | 중 | 쉘 훅 누락 → 기존 훅 재사용으로 완화 |
| 2 | 홈 | 중 | 홈의 데이터 로직(`ClientHomePage`) 복제 위험 → 데이터는 기존 훅/API 재사용, 표현만 신규 |
| 3 | 클래스 목록·상세 | 중 | 멤버 작업 보존 |
| 4 | 리포트 목록·상세 | 상 | dialog 접근성·검토 중 비노출 보존 |
| 5 | 검사 스크립트·시험·캡처·summary | 중 | |

핵심 위험: **AppShell 공유** → 무수정. CSS 누출 → 모든 규칙을 `.ui-v2` 하위로, 검사 스크립트로 확인. 운영 번들에 V2 경로 → `define` 고정 + 번들 검사.
