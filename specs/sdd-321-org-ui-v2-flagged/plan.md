# SDD-321 — Plan

## 1. 분기 방식 (SDD-318 과 동일: 신규 파일 + 진입점에서 빌드 상수로 선택)
`import.meta.env.VITE_UI_V2 === 'true'` 만 쓴다(운영 빌드는 `vite.config.ts` define 이 `'false'` 고정 → 죽은 분기 제거). 플래그 함수·define·dev 워크플로는 **이미 318 이 넣었으므로 수정 없음**.

| 분기 지점 | 방법 | 기존 파일 수정량 |
|---|---|---|
| `/dashboard/org` | `App.tsx` 의 `OrgDashboardPage` lazy 선언 1줄을 318 방식 삼항으로 교체 | 1줄 |
| `/org/counselors`, `/org/:org_id`, `/org/search`, `/org/requests` | `App.tsx` 의 lazy 선언 4줄을 같은 방식으로 교체 | 4줄 |
| 쉘 | 신규 `UiV2OrgShell`. 기존 `AppShell`(코치 공유) **무수정** | 0 |
| 상세 화면(코치 이력, 정보 수정) | 같은 페이지 안의 패널·다이얼로그로 유지 → 라우트 추가 없음 | 0 |

`route-pages.ts` 는 건드리지 않는다(기관 라우트는 첫 화면 preload 대상이 아님). 코치 쪽 워커(SDD-320)가 `App.tsx`·`route-pages.ts` 를 수정하므로 **내 변경은 org 5개 lazy 선언 줄에만 국한**한다.

## 2. 신규 파일(`frontend/src/`)
| 파일 | 역할 |
|---|---|
| `styles/ui-v2-org.css` | `.ui-v2` 스코프 기관 전용 규칙(표·필터 바·통계 칸·다이얼로그·배지). 전 규칙이 `.ui-v2` 하위. 공용 `ui-v2.css` 는 import 만 하고 수정하지 않는다 |
| `components/ui-v2/ui-v2-org-shell.tsx` | 데스크톱: 기존 `SidebarNav` 유지(brand 스코프 CSS 는 318 `ui-v2-brand.css` 재사용). 모바일: 상단 바(메뉴 버튼 + 락업 로고 + 알림) + 큰 제목 + 플로팅 하단 내비(`getMobileMenuTabs('org_admin')`) + 기존 `MobileDrawer` 재사용. 알림 소켓·채팅 목록·리포트 미읽음 로드는 `AppShell` 과 동일 훅 재사용 |
| `components/ui-v2/ui-v2-org-nav.tsx` | 기관용 하단 내비(318 `UiV2BottomNav` 와 같은 모양, 탭·배지 출처만 org_admin) |
| `pages/org/ui-v2/ui-v2-org-dashboard-page.tsx` | 기관 대시보드 |
| `pages/org/ui-v2/ui-v2-org-counselors-page.tsx` | 코치 관리 |
| `pages/org/ui-v2/ui-v2-org-management-page.tsx` | 센터 관리 |
| `pages/org/ui-v2/ui-v2-org-search-page.tsx` | 센터 검색·가입 신청 |
| `pages/org/ui-v2/ui-v2-org-requests-page.tsx` | 내 가입 신청 내역 |
| `pages/org/ui-v2/ui-v2-org-parts.tsx` | 공용 소품: 상태 칩, 통계 칸, 표 래퍼, 대화상자 래퍼(`useDialogA11y`) |
| `tests/sdd321-*.test.ts(x)` | 플래그·보존·접근성 시험 |
| `e2e/sdd321-capture.mjs` | 합성 API 캡처·측정 |

## 3. 수정 파일(최소)
`App.tsx` 5줄(lazy 선언)만. `scripts/check-ui-v2-off.mjs` 의 D안 화면 청크 정규식에 `org-(dashboard|counselors|management|search|requests)` 와 `UiV2Org` 식별자 검사를 **추가**(318 검사는 그대로 유지). 그 외 기존 파일 수정 0.

## 4. 데이터·로직 재사용 원칙
- API 호출·상태·핸들러는 현행 페이지의 것을 **그대로 복사하지 않고 같은 모듈 함수를 호출**한다(`getOrgDashboard`, `listCounselors`, `suspendCounselor`, `unsuspendCounselor`, `getCounselorActivity`, `getOrgCounselorProfile`, `patchOrgCounselorProfile`, `updateCounselor`, `removeCounselor`, `getOrg`, `searchOrgs`, `joinOrg`, `getMyRequests`). 새 API·백엔드 변경 없음.
- 정보 수정은 `CounselorInfoEditor`, 초대는 `CounselorInviteSection`, 퇴직 안내는 `OrgRemovedNoticeDialog`, 다이얼로그 접근성은 `useDialogA11y` 를 **그대로 재사용**하고 `.ui-v2 .u2-legacy` 스킨 래퍼로 D 토큰에 맞춘다(마크업·검증·저장 로직 diff 0). 이메일 불변·성별/생년월일/전화/주소 수정은 이 컴포넌트가 이미 보장한다.
- 상태 라벨은 `sessionStatusLabel` 단일 출처, 코치 상태 라벨(활성/대기/정지)은 현행 문구 그대로.

## 5. 화면 → 기존 기능 보존표(요약, 상세 단언은 verify G)
| 화면 | 보존 항목 |
|---|---|
| 대시보드 | 데이터 현황 링크(`data-upload-status-shortcut`, → `/upload-status`), 기관 코드 표시·복사 + 성공/실패 메시지, 코치 초대 섹션(+ 초대 현황 목록·오류), 퇴직 안내 팝업, 통계 5종(활성 코치/총 클래스/총 회원/종료한 클래스/진행중), 소속 코치 실적 표(활성만) + 빈 문구, 기관 전체 클래스 표(제목→`/sessions/:id`, 유형·상태 배지, 코드, 참여자(+게스트), 시작·종료, 기록 보기→`/sessions/:id/record`) + 모바일 카드 + 빈 문구, 로딩 문구, 오류 배너 |
| 코치 관리 | 헤더 액션 2개(기관관리자 초대/코치 초대), 오류 `role=alert`, 로딩 `role=status`, 정보 수정 패널, 검색+역할/상태 필터(aria-label 동일), 표 6열(이름·이메일·코드·역할·상태·관리), 개인 상담소 배지, 정보 수정(코치만, 편집 중 비활성, 기관관리자 title 안내)/이력/비활성화·활성화(대기 행 제외), 이력 패널(프로필 4항목, 탭 2개 방향키·aria, 세션/리포트 표, 빈 문구, 닫기), 초대 대화상자, 정지/해제 대화상자(사유 필수, busy 문구) |
| 센터 관리 | 제목·기관명, 오류, 비관리자 안내, 가입 요청 관리 "준비 중" 안내, 소속 코치 N명 + 정보 수정 + 검색·상태 필터, 표(이름·이메일·상태·역할 select(확인 창)·정보 수정/소속 해제(확인 창)), 센터 정보 7항목 |
| 센터 검색 | 센터명/지역 검색, 결과 카드(센터 링크·인증 배지·주소), 가입 신청 버튼 상태(신청 완료/신청 중/가입 신청), 코치 외 역할 안내(`ROLE_LABELS`), 기관 가입 상담 신청 링크, 오류·메시지, 인증 리다이렉트 |
| 내 신청 | 로그인 리다이렉트, 로딩, 빈 문구, 카드(기관명·신청일), 상태 배지, 거절 사유 |

## 6. 결정 사항(시안에 없는 기존 요소)
- D1 시안 D 는 모바일 내담자 앱 기준이라 기관 데스크톱 표는 시안이 없다. 표는 흰 카드(반경 24) 안 행 구분선(`--u2-line`), 머리글 `--u2-muted` 12px, 행 높이 ≥ 52, 호버 `--u2-canvas` 로 D 토큰만으로 구성한다. 390px 에서는 가로 스크롤 대신 카드형 행(대시보드는 현행처럼 카드 목록, 코치 관리·센터 관리는 `data-label` 스택 행)으로 전환한다.
- D2 대시보드 클래스 표에 검색·상태/유형 필터를 추가한다(대표 선호: 목록 = 테이블+검색·필터·그룹핑). 순수 클라이언트 필터이며 표시만 달라진다. 기본값은 전체라 off 와 같은 건수가 보인다.
- D3 통계 "완료" → "종료한 클래스" 라벨. 값·집계는 동일.
- D4 `/org/search`·`/org/requests`·`/org/:org_id` 는 현행에 쉘이 없는 단독 페이지(`min-h-screen`)다. D안에서도 쉘 없이 같은 단독 구조를 유지하되(동작 보존) `.ui-v2` 캔버스 위에 D 카드로 그린다. 쉘을 새로 씌우면 라우팅 의미가 바뀌므로 하지 않는다.
- D5 기관 공개 페이지(`/o/:org_code`)는 범위 밖(랜딩 공유 컴포넌트, 비로그인) — 기록만.

## 7. 단계 순서·난이도·위험
| 순 | 작업 | 난이도 | 위험 |
|---|---|---|---|
| 1 | `ui-v2-org.css` + 쉘 + 내비 + 소품 | 중 | `AppShell` 훅 누락 → 동일 훅 재사용·시험으로 고정 |
| 2 | 대시보드 | 중 | 초대 섹션·팝업 보존 → 컴포넌트 재사용 |
| 3 | 코치 관리 | 상 | 정보 수정·이력 탭·정지 대화상자 보존 → 로직 호출 동일, 시험 |
| 4 | 센터 관리·검색·신청 | 중 | `confirm()` 문구·분기 보존 |
| 5 | App.tsx 분기, 검사 스크립트 확장, 시험, 캡처, summary | 중 | SDD-320 과 `App.tsx` 충돌 → 5줄만, 줄 단위 국소 |

핵심 위험: 공유 쉘 무수정 / CSS 누출 → 전 규칙 `.ui-v2` 하위 + 시험 / 운영 번들에 D안 유입 → define 고정 + 검사 스크립트 / 기존 금지 표현 시험(`sdd318` 금지 표현 테스트는 `components/ui-v2/*.tsx` 를 스캔하므로 거기 넣는 신규 파일도 금지어 0).

## 기관 정합(11/9)
대표 지시: 회원·코치 확정 디자인에 기관(org_admin) 화면을 맞춘다.

### 차이표 (변경 전, 1440 실측)
| 항목 | 코치 | 기관(전) | 조치 |
|---|---|---|---|
| 사이드바 | 216 보라, 로고 y33, 첫 메뉴 y74 | 홈·알림·구성원만 216(자체 셸), 나머지 7개 화면 레거시 240 연보라 | 기관도 공유 AppShell + html.u2-coach 스코프 |
| h1 | x264 y25 31px | 홈 x252 y118(별도 상단 바 + 큰 제목), 나머지 22px | AppShell 제목으로 통일 |
| 본문 x범위 | 240→1401 | 280→1385 / 497→1169(설정) / 560→1440(채팅) | 코치 래퍼(.u2f) 재사용 |
| 768~1023 | 모바일 레이아웃 | 기관 셸 240 aside 노출 | ui-v2-mid.css(코치 스코프 import) 적용 |
| 메뉴 순서·가로선 | 설정 아래 ::before 가로선 | 없음 | ui-v2-org-side.css (데이터 센터 앞 ::before) |
| 하단 로그아웃·서버연결 | 동일 구조 | 레거시 | 코치 스코프로 동일 |

### 설계
- `shouldApplyCoachScope`: org_admin + 기관 업무 경로(`isOrgScopePath`)에도 html.u2-coach 부착 → 사이드바·모바일 하단 메뉴·제목 규칙을 코치와 동일 코드로 공유.
- `UiV2OrgShell` = AppShell + `.ui-v2 u2f u2f-org`. 자체 사이드바/상단 바/하단 내비 제거(ui-v2-org-nav.tsx 는 미사용, 파일만 유지).
- App.tsx: 설정·채팅·클래스·리포트 목록/상세·플레이그라운드를 org_admin 도 코치 D안 화면으로. 회원(/clients)은 기관 필터(코치·회원유형)가 레거시에만 있어 `orgLegacy` 로 기존 화면 유지(껍데기만 코치 스코프).
- 알림은 SDD-322 D안(기관) 유지.
### 남은 차이
- /clients, /upload-status, /org/data-center 본문은 레거시 마크업(껍데기·폭은 정합). 본문 재디자인은 별도 결정.
- 코치 코드 카드·코치 코드 줄은 기관에 해당 없음.
