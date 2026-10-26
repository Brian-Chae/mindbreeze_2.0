# SDD-233 — 홈 상태 카드 위치 정리와 플로팅 하단 메뉴

- 상태: Stage ②~⑥ 진행 승인 — Brian 2026-10-22 확정.
- 브랜치: `sdd/233-home-stats-floating-nav`
- 작성일: 2026-10-22
- 범위: 상태 카드 위치 정리, 모바일 하단 메뉴 시안·역할별 구성 제안.
- 근거: Brian 10/22 요청, AGENTS.md, DESIGN.md, `.claude/rules/taskbox.md`, `.claude/rules/branch-management.md`, SDD-232 spec/summary/verify, 현재 소스.
- 동기화: 미커밋 spec을 stash(-u) → git fetch → git rebase origin/develop → stash apply. 최신 기준 동일 확인. 삭제 금지에 따라 복원용 stash는 유지.

## 1. 문제와 목표

회원 홈의 상태 카드 4개가 모바일에서 리포트 뒤까지 밀려 오늘 상태를 빠르게 읽기 어렵다. 양쪽 홈에서 상태 카드 바로 다음에 ‘내 클래스’ 제목이 오도록 통일한다. 카드 문구·집계·클릭 목적지는 그대로 유지한다. 모바일 2×2, 데스크톱 4열이다.

모바일 하단 메뉴는 화면 가장자리에 붙은 흰 막대에서 여백이 있는 pill로 바꾼다. 알림 전용 탭은 만들지 않고 우상단 종 아이콘을 유지한다. 상담 공개 여부와 관계없이 하단은 정확히 5개이며, 기존 권한 안에서 모든 기능의 접근 경로를 보존한다.

이번 단계는 Spec과 독립 HTML 디자인 시안까지만. 제품 코드·백엔드·API·권한·계산 로직 변경, plan/verify 사후 생성, 푸시·PR·머지·배포·서버·DB·.env·메일·삭제는 범위 밖이다. 승인 후 다음 단계에서 plan과 구현 전 verify를 작성한다.

## 2. 현재 구조 — 소스로 확인

### 회원 홈

- `frontend/src/App.tsx:192`: `/app` → `RoleGuard client` → `MemberStructureHomePage`. `/app/*`의 기존 `ClientAppPage`와 구분한다.
- `pages/client/member-structure-home-page.tsx`: `StructureShell role="member"` → 히어로 → 내 클래스 → 상담 공개 시 내 상담 → `ClientHomePage hideHero`.
- `ClientHomePage.tsx`: 초대·이번 주 클래스·내 리포트가 있는 `mh-main` → `summaryTiles` → 담당 상담사· 대화·알림 등의 `mh-rail`. 상태 카드 원본은 페이지 로컬 `SummaryTiles`와 기존 집계·콜백이다.
- `components/client/home/member-home-layout.css`: **1024px 이상에서는 CSS grid로 이미 히어로 → 상태 카드 4열 → 내 클래스 순서**이다. 문제의 핵심은 모바일 DOM 순서다. 상담 섹션 공개 시 명시적 grid-row와 자동 배치의 충돌도 다음 구현에서 확인해야 한다.
- `StructureShell`은 `ClientShell`을 선택한다. 별도 셸을 중첩하지 않는다.

### 상담사 홈

- `/dashboard` → `DashboardPage.tsx` → `AppShell`.
- 현재 순서: 조건부 안내/브리핑 → 사진 히어로 → 검토 대기 배너 → `ch-tiles` → 내 클래스 → 일정·지난 회차·상담사 코드·최근 대화·새 알림.
- **이미 타일과 내 클래스가 인접**한다. `counselor-home.css`도 <768 2열, ≥768 4열이다. 불필요하게 배너를 옮기거나 타일 행동을 바꾸지 않는다.
- SDD-232 PR #49 후속 타일→player 변경과 충돌하지 않도록 진행 타일 링크는 이번 범위에서 수정하지 않는다. origin/develop 조회 시점의 소스를 기준으로 추후 리베이스 후 다시 확인한다. 이번 작업에서 PR 상태를 원격 조회하지 않았다.

### 메뉴와 권한

- 회원 `components/client/BottomTabBar.tsx`: 상담 공개 시 홈·내 클래스·상담·리포트·더보기(5), 비공개 시 상담 제거(4).
- 상담사/기관 `components/layout/BottomTabBar.tsx`: 공개 시 홈·클래스·상담·대화·더보기(5), 비공개 시 상담 제거(4).
- 플랫폼 현재 탭: 홈(`/admin/orgs`)·클래스(`/classes`)·대화(`/chat`)·리포트(`/reports?status=pending`)·더보기. App.tsx의 클래스·리포트 RoleGuard는 counselor/org_admin만 허용한다. 이 두 탭의 대체가 필요하다. 권한 확대는 하지 않는다.
- **더보기와 상단 햄버거는 동일한 `MobileDrawer`를 연다.** Drawer는 `SidebarNav`의 역할별 메뉴를 재사용한다. 별도 더보기 전용 메뉴 파일은 없다.
- `SidebarNav`: 회원=홈·내 클래스·상담·대화·리포트·알림·설정(프로필); 상담사=홈·클래스·회원·상담·대화·리포트·플레이그라운드·알림·설정; 기관=기관 홈·클래스·회원·상담·대화·상담사 관리·리포트·알림·설정; 플랫폼=기관·가입 신청·사용자·내담자·플레이그라운드. 로그아웃과 프로필/기존 AI 조건부 메뉴도 유지한다.
- 상담은 `isCounselingEnabled`가 false이면 탭·Drawer에서 숨긴다. AI는 기존 SDD-220 조건을 유지한다.
- 상단 종: 회원 `/app/notifications`, 나머지 `/notifications`. 알림은 기존 Drawer 접근도 남긴다. ‘알림 제외’는 하단 5개 슬롯에서 제외한다는 뜻이다.

## 3. 제안 배치와 기능 보존

회원: 히어로 → **상태 카드 4 → 내 클래스** → 상담(공개 시) → 기존 초대·이번 주 클래스·리포트·담당 상담사·대화·알림. 카드 4개의 DOM 위치를 올리되 기존 데이터 소유와 콜백을 안전하게 재사용한다. CSS order만으로 시각·키보드 순서를 다르게 만들지 않는다. `ClientHomePage` 집계를 복제하거나 API 조회를 중복 추가하지 않는다. 추출/슬롯 등 구체 방식은 다음 plan에서 확정한다. 부분 실패/로딩 시 기존 데이터 미조회 상태를 임의 0으로 바꾸지 않는다.

회원 카드: 다음 클래스까지→기존 `openHeroDetail`, 새 리포트→`/app/reports`, 이번 주 클래스→`/app/classes`, 완료 클래스→`/app/reports`. 기존 dDay/newReportCount/weekClassCount/completedCount 계산 그대로.

상담사: 현재 배치 유지. 진행 중 회차·검토 대기 리포트·오늘 예정 회차·총 참여자의 값과 `home-links` 목적지 보존. 검토 배너/프로필 안내/루시 브리핑이 타일과 클래스 사이로 들어오지 않게 한다.

## 4. 역할별 5개 탭 — 확정(10/22)

| 역할 | 상담 | 하단 5개(왼쪽부터) | 하단에서 빠지거나 남는 기능의 위치 |
|---|---|---|---|
| 회원 | 비공개 | 홈 · 내 클래스 · 대화 · 리포트 · 더보기 | 프로필은 더보기/햄버거, 알림은 종+기존 Drawer |
| 회원 | 공개 | 홈 · 내 클래스 · 상담 · 리포트 · 더보기 | 대화는 더보기/햄버거(현재와 동일), 프로필·알림 접근 유지 |
| 상담사 | 비공개 | 홈 · 클래스 · 리포트 · 대화 · 더보기 | 회원·설정·플레이그라운드·조건부 AI는 더보기/햄버거 |
| 상담사 | 공개 | 홈 · 클래스 · 상담 · 대화 · 더보기 | 리포트는 더보기/햄버거(현재와 동일), 회원·설정 등 유지 |
| 기관관리자 | 비공개 | 홈 · 클래스 · 리포트 · 대화 · 더보기 | 회원·상담사 관리·설정은 더보기/햄버거 |
| 기관관리자 | 공개 | 홈 · 클래스 · 상담 ·대화 · 더보기 | 리포트·회원·상담사 관리·설정은 더보기/햄버거 |
| 플랫폼관리자 | 공통 | 홈(기관) · 가입 신청 · 사용자 · 대화 · 더보기 | 내담자 관리·플레이그라운드는 기존 Drawer 유지. 알림·설정은 종/각 기존 경로, Drawer에도 추가 제안. 권한 없는 클래스·리포트 대체 |

역할별 목적지: 회원 `/app`, `/app/classes`, `/app/chat`, `/app/reports`, `/app/counseling`; 상담사 `/dashboard`; 기관 `/dashboard/org`; 두 역할 공통 `/classes`, `/chat`, `/reports`, `/counseling`; 플랫폼 `/admin/orgs`, `/admin/applications`, `/admin/users`, `/chat`. 더보기는 URL 이동 없이 기존 Drawer 열기.

플랫폼 Drawer에는 현재 없는 대화·알림·설정도 추가하여 직접 탭과 전체 메뉴의 접근을 일치시키는 안을 권장한다. 신규 페이지/권한을 만들지 않는다. 기존 내담자 관리(`/admin/clients`)와 플레이그라운드는 제거하지 않는다.

## 5. 디자인 시안

- 진입: `designs/home-stats-floating-nav/index.html`(file://로 열어도 동작). 현재/제안 회원·상담사 비교 및 A/B×아이콘/작은 라벨 4조합, 역할별 표 포함.
- 개별 화면: `?view=home&role=member|counselor&mode=current|proposed&style=A|B&labels=0|1&counsel=0|1&safe=34`.
- A 밝은 반투명: 흰 유리, 보라 활성 inset, 얇은 테두리·절제된 그림자. **DESIGN.md의 glassmorphism 금지에 대한 이번 하단 바 한정 예외 제안**이다. 제품 전역 토큰 변경 아님. blur 미지원 시 불투명 흰 배경 fallback 필요.
- B 어두운 pill: #201427 배경, #563365 inset, 밝은 아이콘. 밝은 홈과 대비가 크고 내비게이션 존재감이 강함.
- 추천: **A + 아이콘/작은 라벨(12px)**. 새 사용자의 기능 발견에 유리. 아이콘만은 4px 낮고 간결하지만 상담/클래스 구분 학습이 필요.
- 아이콘은 시안 내 SVG, 배경·로고는 `assets/`에 복사한 저장소 자산. 시스템 한글 폰트 사용(외부 폰트 요청 없음). 외부 URL·CDN·빌드 도구 없이 폴더만 복사 가능.
- 현재 화면은 제품 캡처가 아닌 소스 기반 샘플 재구성. 예시 수치/인물은 실제 사용자 데이터가 아니다. 사진·예시 카드는 배치 판단용. 기존 홈 디자인 전체를 교체하는 제안이 아니다.

## 6. 모바일·접근성 계약

- 하단 노출 범위는 기존 `md:hidden`, 즉 <768px만. ≥768px 데스크톱 사이드바와 기존 홈 배치 유지.
- 좌우 16px, 아래 `12px + env(safe-area-inset-bottom,0px)`. 라벨 바 높이 66px, 아이콘 바 62px. 각 클릭 영역 최소 44×44px.
- 콘텐츠 하단 예약: **100px + safe-area**(66px 바+12px 하단+최소22px 간격), 실제 스크롤 소유자에 적용. 마지막 CTA가 최종 스크롤에서 바 위로 충분히 올라와야 한다. 가로/세로 iOS와 200% 텍스트 확대는 구현 QA 대상.
- `frontend/index.html:7`의 viewport-fit=cover 유지, 100dvh/visual viewport와 iOS 하단 툴바 확장/축소·홈 인디케이터·회전·키보드 검증 필요. safe-area 모의값은 실기기 증거가 아니다.
- 기존 `hideBottomTab`, `noBottomPad`, `noScroll` 계약 보존. 클래스 player 등 독립 몰입형 셸에는 새 바를 삽입하지 않는다. 기존 대화방 hideBottomTab 유지. 바가 없는 페이지에는 추가 여백을 강제하지 않는다.
- 아이콘만/라벨 모두 aria-label, 활성 항목 aria-current=page, 키보드 포커스 가시성. 더보기는 현재 Drawer의 열기/닫기·스크롤 잠금 유지. 아이콘은 aria-hidden.
- 리포트/대화 배지는 해당 아이콘 위에 숫자(9+ 상한)/작은 점. 회원 AI 배지는 기존 공개 조건 유지. 알림은 종 아이콘으로 분리하여 더보기 합산에서 제외하는 안을 제안한다. 초대는 기존 의미 유지(더보기 또는 클래스에서 한 곳만), 중복 합산 금지.
- 직접 탭으로 승격한 대화/리포트 경로를 `moreActive`에서 제외하여 직접 탭과 더보기가 동시에 활성화되지 않게 한다. 쿼리 필터·하위 경로의 활성 상태도 확인한다.

## 7. 예상 구현 영향 — 확정 plan 아님

| 파일 | 예상 작업 |
|---|---|
| `pages/client/member-structure-home-page.tsx` | 상태 카드 슬롯을 내 클래스 직전으로 |
| `pages/client/ClientHomePage.tsx` | 기존 집계·카드 출력의 안전한 분리/재사용 |
| `components/client/home/member-home-layout.css` | 모바일/데스크톱 순서·4열 유지 |
| `components/client/BottomTabBar.tsx` | 회원 5개, pill/활성/배지/접근성 |
| `components/layout/BottomTabBar.tsx` | 역할별 5개, 동일 표현·활성 상태 |
| `components/client/ClientShell.tsx` | 모바일 하단 예약·기존 숨김 조건 |
| `components/layout/AppShell.tsx` | 동일 하단 예약 |
| `components/layout/SidebarNav.tsx` | 플랫폼 전체 메뉴 보강 제안 |
| 공통 nav 스타일/표현 또는 회원 요약 추출 1~2개 | 중복 방지, plan에서 필요성 결정 |

예상 **제품 소스 8~10개**, 관련 회귀 테스트 약 3~5개 별도. `DashboardPage.tsx`/`counselor-home.css`는 읽기·회귀 확인 대상이며 현재 상태에서 변경 불필요. 백엔드 변경 0, API/DB 마이그레이션 0. 클래스 진행 화면 수정은 예상하지 않는다. SDD-232/#49 링크 변경은 보존한다.

## 8. 다음 단계 수락 기준 후보 — Stage ③ Verify 아님

1. 회원 390/430/1440에서 카드 4개 바로 다음은 내 클래스. 모바일 DOM 순서와 포커스 순서 일치, 데스크톱 4열.
2. 상담사 조건부 배너 유무와 관계없이 타일→내 클래스 인접, 기존 4개 값·링크 동일.
3. 4역할×상담 공개/비공개에서 정확히 5개, 알림 슬롯 없음, 권한 없는 목적지 없음.
4. 기존 메뉴 전부 동일 역할/플래그에서 접근 가능. 상담/AI 비공개 기능을 우회 노출하지 않음.
5. 활성 탭 하나, 미읽음/초대·검토 배지 중복 없음, 종 알림 기능 유지.
6. 390/430 가로 넘침 없음, 끝까지 스크롤 시 마지막 요소 가림 없음, safe-area 0/34 비교, ≥768 바 없음.
7. 몰입형 player/대화방 기존 숨김, 스크롤 소유자·키보드·Drawer 충돌 없음.
8. 실제 iOS Safari와 Chrome/Edge 동작 확인. 정적 시안 결과를 제품 동작 검증으로 대체하지 않음.

## 9. Brian 결정 — 확정(2026-10-22)

- B + 작은 라벨 확정. `nav-B-labels-*` 그대로: #201427 배경, #563365 활성 타원, 채워진 활성 아이콘, 빨간 배지.
- §4 역할별 추천안 확정. 알림은 우상단 종 및 기존 Drawer 접근 유지.
- 회원 상태 카드 4개를 내 클래스 직전으로 이동. 집계·내용·링크 불변. 상담사 배치는 유지.
- Stage ②~⑥ 연속 진행 승인. 구현 전 plan·verify 커밋 후 구현, 테스트, API mock Chrome 캡처, summary, 브랜치 push 및 develop 대상 PR 생성.
- 백엔드·서버·DB·.env·메일·삭제·PR 머지·develop push·배포 금지. 임시 node_modules 심링크만 종료 시 제거 승인.
- 앞 절의 미승인/다음 단계/시안만이라는 표현은 최초 시안 작성 당시 기록이며, 현재 결정은 이 절이 우선한다.

## 10. 시안 검증 자료

`designs/home-stats-floating-nav/README.md`, `fit-results.json`, `screenshots/` 참조. HTML 검증은 Chrome headless 로컬 파일만 사용. 실제 API/서버/DB·로그인·메일·iOS 실기기 검증은 수행하지 않는다. 이번 산출물을 SDD 전체 완료로 표시하지 않는다.

## 11. TASK BOX 추가 확정 — 2026-10-22

홈 내 클래스 목록은 회원·상담사 모두 최대 4개만 표시한다. `HOME_CLASS_LIMIT` 한 곳의 상수를 공유한다. 상담사는 기존 정렬·전체 보기 총수 표시를 유지한다. 회원은 회원용 기존 정렬이 있으면 유지한 뒤 자르고, 없으면 기존 순서를 유지해 자른다. 4개 초과 시 회원도 `전체 보기 (N)`에 전체 총수를 표시한다. 전체 클래스 페이지·API에는 제한을 추가하지 않는다. 같은 PR에 포함한다.
