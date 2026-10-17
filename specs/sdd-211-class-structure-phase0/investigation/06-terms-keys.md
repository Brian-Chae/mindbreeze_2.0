# 06 — 용어 사전·키 기반 배지·가드 분리 (Phase 0 항목 1) 조사

> 작성 2026-10-18 · 읽기 전용 조사(코드·DB·git 미변경). 근거는 `파일:줄`, 확인 못 한 것은 `미확인`. 기준 커밋 `3b93f692`(develop, 작업 트리 clean).
> 원칙: Phase 0 은 **문구 변경 없음**. D-62 확정 값(지도사 / 상담 N회차·상담 세션 / 내담자 메뉴 흡수 / 구성원)은 Phase 2 에서 적용하며 이 문서의 어떤 제안도 사용자에게 보이는 글자를 바꾸지 않는다.
> 입력 문서: `docs/class-session-restructure/조사/R8-용어IA.md`(전체), `영향도.md §6`, `기획.md §4.1·§9`, `결정-필요.md` D-62·D-64.

## 0. 요약

| 항목 | 결과 |
|---|---|
| 라벨 비교 사이트 | 문서상 "3곳"은 파일 단위이고, 실제로는 **3개 파일에 비교식 10개**(SidebarNav 4 + layout/BottomTabBar 3 + client/BottomTabBar 3). `클래스`뿐 아니라 `채팅`·`알림`·`리포트`도 같은 방식(§1.1) |
| 라벨 문자열에 의존하는 로직 | 위 3개 파일뿐. `label ===`·`.label ==` grep 은 이 3개 파일 + `host-shell-data.ts:98`(섹션 묶음 키, 용어와 무관)만 적중 |
| 배지 대상 | `채팅`·`알림`·`리포트`·`클래스` 4종. `클래스` 배지 = `notificationStore.sessionInvites.length`(읽지 않은 세션 초대 수) |
| 가드 | (a) `frontend/tests/class-flow-shell-terms.test.ts`(vitest, `세션` 한 단어만, 경로 10개) (b) `frontend/e2e/class-flow/lib.mjs:272` `BANNED_COPY`(브라우저 DOM + 소스 스캔, **CI 미연결 수동 하니스**) — 다른 ESLint 규칙·CI grep·pre-commit 훅은 **없음** |
| 서버 문구 | 중앙 템플릿 없음. 알림 제목·본문은 호출부(`session_service.py`)에 리터럴, 유형 라벨은 **4곳 중복**(R8 은 3곳이라 했으나 `report_comment_service.py` 포함 4곳이고 **값이 서로 다름**) |
| `session_terms.py` 골격 | 출력 0 변경으로 도입 **가능**. 단 현재 세션 알림 제목을 고정하는 백엔드 테스트가 **없으므로** 리팩터 전에 특성화(characterization) 테스트를 먼저 추가해야 함 |
| 현재 상태 | `class-flow-shell-terms.test.ts`, `agent-counselor-sidebar.test.tsx` 로컬 실행 **3 passed**(§2.4) |

---

## 1. 라벨 비교 사이트 (정확한 현황)

### 1.1 사이트와 내비 항목 자료구조

| # | 파일:줄 | 자료구조 | 비교식 |
|---|---|---|---|
| S1 | `frontend/src/components/layout/SidebarNav.tsx:209-229` | `interface NavItem { to; label; icon; badge?; end? }`(`:10-16`) — **`key` 필드 없음** | `getBadge(label)` 안 `label === '채팅'`(`:212`) / `'알림'`(`:214`) / `'리포트'`(`:216`) / `'클래스'`(`:218`) |
| S2 | `frontend/src/components/layout/BottomTabBar.tsx:59-67` | `interface TabItem { to; label; icon }`(`:8-12`), `tabItemsForRole(role)`(`:26-34`)가 함수로 4개 생성 | `item.label === '채팅'`(`:61`) / `'리포트'`(`:63`) / `'클래스'`(`:65`) |
| S3 | `frontend/src/components/client/BottomTabBar.tsx:49-58` | `TAB_ITEMS: TabItem[]`(`:18-23`), 같은 필드 구성 | `tab.label === '채팅'`(`:52`) / `'리포트'`(`:54`) / `'클래스'`(`:56`) |

정정: R8·기획·브리프는 "`label === '클래스'` 3곳"이라 적었다. 실제로는 **3개 파일에 비교식이 10개**(4+3+3)이고, `클래스` 한 개만이 아니라 `채팅`·`알림`·`리포트`도 같은 방식이다. 키 기반 전환은 4종 모두 해야 한다(`클래스`만 바꾸면 라벨 변경 시 나머지가 같은 위험을 가진다).

### 1.2 항목별 라벨·경로 (현행, 글자 그대로)

**SidebarNav.tsx**

| 목록 | 줄 | 순서대로 (label → to) |
|---|---|---|
| `NAV_ITEMS`(상담사) | `:90-99` | 대시보드→`/dashboard` · 클래스→`/sessions` · 내담자→`/clients` · 채팅→`/chat` · 리포트→`/reports` · 플레이그라운드→`/playground` · 알림→`/notifications` · 설정→`/settings` |
| `ORG_ADMIN_NAV_ITEMS` | `:101-111` | 기관 대시보드→`/dashboard/org` · 클래스→`/sessions` · 내담자→`/clients` · 채팅→`/chat` · 상담사→`/org/counselors` · 리포트→`/reports` · 알림→`/notifications` · 설정→`/settings` |
| `CLIENT_NAV_ITEMS`(회원) | `:113-120` | 홈→`/app`(`end`) · 클래스→`/app/sessions` · 채팅→`/app/chat` · 리포트→`/app/reports` · 알림→`/app/notifications` · 설정→`/app/profile` |
| `ADMIN_NAV_ITEMS` | `:122-128` | 기관 관리→`/admin/orgs` · 가입 신청→`/admin/applications` · 상담사 관리→`/admin/users` · 회원 관리→`/admin/clients` · 플레이그라운드→`/playground` |

**layout/BottomTabBar.tsx:26-34** (역할에 따라 경로만 분기): 홈→`homePathForRole(role)` · 클래스→`/app/sessions`(client) 또는 `/sessions` · 채팅→`/app/chat` 또는 `/chat` · 리포트→`/app/reports` 또는 `/reports?status=pending`. 이 파일은 상담사·기관·플랫폼 관리자용이다(`AppShell.tsx:243`). 회원은 `client/BottomTabBar.tsx` 를 쓴다(`ClientShell.tsx:259`).

**client/BottomTabBar.tsx:18-23**: 홈→`/app` · 클래스→`/app/sessions` · 채팅→`/app/chat` · 리포트→`/app/reports`. 더보기는 별도 버튼(`:85-92`).

참고(키가 이미 있는 선례): `components/class/flow/shell/ShellFrame.tsx:10-28` 는 `NavEntry { key; label; icon }` 에 키 `home·class·client·chat·report·alarm·setting·more` 를 이미 쓴다. 하니스 전용이며 이번에 건드리지 않되, **키 이름은 이것과 맞추는 것이 안전**하다(§4.2).

### 1.3 배지 계산 — 어디서, 무엇을

| 배지 | SidebarNav(`:209-220`) | layout/BottomTabBar(`:44-52,60-67`) | client/BottomTabBar(`:32-38,51-58`) |
|---|---|---|---|
| 채팅 | `(chatBadge ?? 0) + (user.role==='counselor' && role!=='client' ? counselorUnread + openRisk : agentBadge ?? 0)` | `chatUnread`(채팅방 `unread_count` 합) 만 | `chatUnread + agentUnread` |
| 알림 | `notificationBadge ?? 0` | **없음**(탭에 알림 없음) | 없음 |
| 리포트 | `reportBadge ?? 0` | `role==='client' ? reportUnread : pendingReviewCount` | `reportUnread` |
| 클래스 | `sessionBadge ?? 0` | `sessionInvites.length` | `sessionInvites.length` |
| 표시 | 9 초과 `9+`, 빨간 18px 원(`:221-227`) | 9 초과 `9+`, 16px(`:85-89`) | 동일(`:75-79`) |

- `클래스` 배지의 값은 한 곳에서 나온다: `useNotificationStore.sessionInvites`(`stores/notificationStore.ts:25,41,72-86`; 서버 `listUnreadSessionInvites` 로 갱신). 사이드바는 부모가 `sessionBadge={sessionInvites.length}` 로 내려준다(`AppShell.tsx:91`, `ClientShell.tsx:114`). 하단 탭 두 파일은 스토어를 직접 구독한다(`layout/BottomTabBar.tsx:47`, `client/BottomTabBar.tsx:35`).
- **셋이 계산식이 서로 다르다**(특히 채팅). 키 기반 전환은 "한 곳으로 합치기"가 아니라 "비교 기준만 라벨→키"여야 동작이 보존된다. 합치면 회귀(예: 상담사 하단 탭에 루시·위험 카운트가 갑자기 더해짐).
- **모바일 드로어**(`MobileDrawer.tsx:42`)는 `SidebarNav` 에 `notificationBadge` 만 넘긴다 → 드로어에서는 채팅·리포트·클래스 배지가 **현재도 0 으로 보인다**. 이 동작을 보존해야 한다(고치면 동작 변경).
- `NavItem.badge`(정적 숫자, `SidebarNav.tsx:14,271-275`)는 어떤 목록에서도 쓰지 않는 죽은 필드다. 키 전환 때 건드리지 않거나 제거 여부를 plan 에서 결정(제거는 동작 불변이나 범위 확대 → 권장: 그대로 둠).
- `ClientShell` 사이드바는 `role="client"` 를 넘긴다(`ClientShell.tsx:109`). 상담사가 아닌 계정이 `role` prop 으로 분기되는 경로이므로 §3 테스트 매트릭스에 포함한다.

### 1.4 그 밖에 라벨·한국어 문자열을 로직에 쓰는 곳

grep: `label ?===`, `\.label ?==`, `===/!== '한글'`, `.includes('한글')`, `case '한글'` (frontend/src 전체).

| 결과 | 판정 |
|---|---|
| 위 3개 파일 10개 비교식 | **이번 범위** |
| `components/class/flow/shell/host-shell-data.ts:98` `last.label === label` | 목록 섹션 묶음용 내부 비교. 용어 사전 대상 아님(키 비교가 아니라 직전 섹션과 같은 제목인지 비교) — 범위 밖 |
| `PermissionHelpSheet.tsx:14` `device === '카메라'`, `class-media.ts:101` `device === '마이크'`, `SessionMonitorTable.tsx:127,129` `=== '연결됨'`/`'미사용'` | 한국어 문자열이 로직 값인 다른 사례. 용어(세션/클래스) 무관 — **범위 밖, 후속 부채로만 기록** |
| `'클래스'` 가 조건식에 쓰이는 곳 | 위 3개 파일 외 **없음**. 나머지 `'클래스'` 리터럴(`SessionListPage.tsx:56` title, `ClientAppPage.tsx:313` shellTitle, `ClassPlayerPage.tsx:1166`, `class-labels.ts:31` fallback 등)은 표시용 |

### 1.5 라벨 텍스트에 의존하는 테스트·E2E

| 파일 | 의존 | 영향 |
|---|---|---|
| `frontend/tests/agent-counselor-sidebar.test.tsx:15-21` | `a[href="/chat"]` 의 `textContent === '채팅9+'` → `'채팅'` | 라벨 `채팅` 과 배지 규칙(채팅)에 의존. **키 전환 후에도 통과해야 하는 회귀 기준**. 이 테스트는 `authStore`·`notificationStore` 를 vi.mock 하므로(`:8-9`) `sessionInvites` 는 `undefined` — 키 전환 후에도 SidebarNav 는 `sessionInvites` 를 직접 읽지 않으니 영향 없음(부모가 주는 prop). **하단 탭은 `s.sessionInvites.length` 를 직접 읽으므로** 하단 탭 테스트는 스토어 mock 에 `sessionInvites: []` 필요 |
| `frontend/tests/class-flow-shell-terms.test.ts:24-25` | SWEPT 경로에 `SidebarNav.tsx`·`BottomTabBar.tsx` 포함 → 이 두 파일의 `세션` 리터럴 0 검사 | 라벨이 `lib/terms.ts` 로 이동하면 이 두 파일은 검사할 문구가 사라져 **가드가 무력화**. 사전 값 자체를 검사하는 가드 추가 필요(§5) |
| 그 외 `frontend/tests/**` | `SidebarNav`·`BottomTabBar`·`MobileDrawer` 를 import 하는 파일은 위 2개뿐. `AppShell`/`ClientShell` 은 7개 테스트가 vi.mock 으로 대체(`chat-invite-ui`, `agent-counselor-page`, `class-flow-host-mail-invites`, `class-flow-shell-detail`, `class-flow-shell-host-detail`, `class-flow-shell-host-list`, `agent-checkin-ui`, `agent-page`, `client-report-modal`) → 영향 없음 | **하단 탭·사이드바 `클래스` 배지를 직접 검증하는 기존 테스트는 0개**(갭) |
| `frontend/e2e/journeys.mjs:8,11,57,66-67,72,74,109`, `full-journey.mjs:60` | `expectText(page, path, ...texts)` 는 **본문 전체 텍스트 `includes`**(`e2e/lib.mjs:54-60`) 로 `클래스`·`내담자` 등을 찾음. 내비 요소 선택자(`nav`, `aside`, role=link name)는 사용하지 않음(grep `aside|'nav|a[href|name: '홈…` 결과: `explore.mjs:62` 의 `a[href^="/"]` 수집뿐) | Phase 0 은 글자 불변이므로 **영향 0**. Phase 2 에서 라벨이 바뀔 때 `journeys.mjs` 기대 문구 갱신 필요(이번 범위 아님) |
| `getByRole('button', { name: /클래스 만들기/ })`(`journeys.mjs:72`) 등 | 페이지 본문 버튼 라벨 | 내비와 무관 |

E2E 는 CI 의 `e2e-smoke.yml`(deploy-dev 후 호출, `deploy-dev.yml:307-309`)에서 `smoke/journeys/regressions/full-journey` 를 돌린다. `class-flow` 하니스(`fit.mjs`·`selftest.mjs`)는 **CI 에 연결돼 있지 않다**(`e2e-smoke.yml:58-79` 에 없음).

---

## 2. 용어 가드 현황

### 2.1 `BANNED_COPY` 정의·사용 (전수)

grep `BANNED_COPY` 전 저장소(node_modules·out 제외): **코드는 `frontend/e2e/class-flow/lib.mjs` 한 파일**, 나머지는 문서.

| 위치 | 내용 |
|---|---|
| `lib.mjs:272` 정의 | `'세션\|수업\|오픈\|참여하기\|그래도 시작\|LB \|1:N\|대시보드로\|6자리\|게스트\|인증 코드\|OTP\|\\bQR\\b\|귀 뒤\|귀뒤\|귀에\|연결해야 입장\|30일 보관\|관리자가 삭제를 지시하기 전까지\|표시 이름만\|정원 10 고정\|그룹은 최대 10명'` — 앞 3개(`세션\|수업\|오픈`)가 **용어 금지어**(영역 의존), 나머지 19개는 **SDD-209 UX 문구 금지**(P7·P8, 영역 무관) |
| `lib.mjs:296,303` `scanSources` | `new RegExp(BANNED_COPY,'g')` 로 **주석 제거한 소스**에서 검색 → `srcBanned` |
| `lib.mjs:324-326` `copyConfig()` → `{ glyph, banned, eyebrowAllow }` | `measureFlowCopy(cfg)`(`:184-207`)가 DOM 보이는 글자 + `aria-label·title·placeholder` + `document.title` 에서 검색 → "금지어 …" |
| 호출 | `fit.mjs:23`(케이스마다 DOM), `fit.mjs:153`(`sourceRows(SOURCE_ROOTS)`), `selftest.mjs:117-143` |
| `SOURCE_ROOTS` `fit.mjs:128-131` | `src/components/class/flow`, `src/lib/class/flow` — **2개 디렉터리만** |
| 같은 파일의 자매 상수 | `BANNED_IDENT`(`:274`), `SRC_GLYPH`(`:270`), `EYEBROW_ALLOW`(`:275`) — 용어와 무관, 분리 대상 아님 |
| selftest 가 의존하는 값 | `selftest.mjs:122` `['금지 용어(세션)', '<p>세션을 시작해요</p>', /금지어/]`, `:123` `6자리`, `:135-137` 소스 주입 케이스에서 `세션`·`6자리 게스트`·`by-code` 사용 → `BANNED_COPY` 의 **합성 결과가 `세션`과 `6자리`를 계속 포함**해야 통과 |
| 문서 | `specs/sdd-209-class-flow-redesign/verify.md:47-48,61`(P7·P8·FR4) |

### 2.2 `class-flow-shell-terms.test.ts` (vitest, 49줄)

- 스캔 경로 `SWEPT`(`:15-26`) 10개: `components/class/flow/shell`(디렉터리), `components/client`(디렉터리), `pages/client/{ClientHomePage,ClientSessionListPage,ClientSessionDetailPage,ClientAppPage}.tsx`, `pages/sessions/{SessionListPage,SessionDetailPage}.tsx`, `components/layout/{SidebarNav,BottomTabBar}.tsx`. 디렉터리는 `.ts/.tsx` 재귀(`:8-13`).
- 금지어: **`세션` 한 단어만**(`:30` `t.includes('세션')`). `수업`·`오픈` 은 이 vitest 에서 검사하지 않음 → BANNED_COPY 와 범위가 다르다.
- 리터럴 추출: 주석 제거 후 따옴표 문자열(`'"\``) + JSX 텍스트(`>…<`)(`:28-31`). R8 §11 의 "동일 정규식" 근거.
- 예외: 없음(허용 목록·`상담 세션` 예외 없음). 파일 안 `세션` 리터럴이 하나라도 나오면 실패.
- 추가 테스트 1건: `CLASS_CHIP_KEYS` 8개와 `CLASS_CHIP_LABELS` 존재(`:44-49`) — **상태 칩 키**이며 내비 배지와 무관(이름이 "배지 키 상수"여서 혼동 주의).
- 영역 개념: **없음**. 모든 경로가 하나의 정책(`세션` 금지)을 받는다.

### 2.3 다른 가드·린트·CI

| 후보 | 결과 |
|---|---|
| `class-flow-*.test.*` 중 금지어를 단언하는 것 | `class-flow-shell-terms.test.ts` 하나. `class-flow-shell-no-calendar.test.ts`·`class-flow-case-key.test.ts` 는 용어와 무관(파일 삭제 확인 / 정본 json 파싱) |
| `class-player-*` 테스트 | `수업` 문구를 **기대값으로** 단언(`class-player-host-sheets.test.tsx:176` `허용하지 않아도 수업은 계속돼요`, `class-player-member-case.test.ts:71,204`). 즉 `components/class/player` 에는 `수업` 이 **존재하며 가드 대상 아님**(BANNED_COPY 스캔 범위 밖). 영역 분리 때 이 문구를 건드리면 이 테스트가 깨짐 — Phase 2 이후 주의사항 |
| ESLint | `frontend/eslint.config.js` 에 한국어/문구 제한 규칙 없음. `react-refresh/only-export-components` 는 `error`(allowConstantExport) → **컴포넌트 파일에서 함수 export 금지**(상수는 허용). 새 모듈은 별도 `.ts` 로 둘 것 |
| CI(`ci-feature.yml`, `deploy-dev.yml`, `e2e-smoke.yml`) | 문구 grep 단계 없음. 프론트 `Test` 단계는 `continue-on-error: true`(`ci-feature.yml:56-62`) |
| `.claude/hooks/lint-after-edit.sh` | ESLint --fix 만 |

### 2.4 현재 통과 여부

- 실행: `cd frontend && npx vitest run tests/class-flow-shell-terms.test.ts tests/agent-counselor-sidebar.test.tsx` → **Test Files 2 passed, Tests 3 passed**(0.9s). `node_modules` 존재.
- 전체 스위트는 실행하지 않음. 문서상 "프론트 기존 실패 16건 상존·비차단"(`docs/개발운영_환경분리_기획.md:51`, `docs/reviews/env-split/00-조사브리프.md:31` — 리포트 목록·모달, 브라우저 `.cjs` 등)이 있으나 **파일명 목록은 `미확인`**. 이번 작업이 건드리는 파일의 테스트(위 2개)는 통과. `client-report-list.test.tsx`·`client-report-modal.test.tsx` 가 실패 후보라는 점은 추정(`미확인`).
- E2E 하니스(`class-flow/selftest.mjs`)는 Playwright + vite 서버가 필요해 실행하지 않음 → 현재 통과 여부 `미확인`.

### 2.5 "명상 영역"과 "상담 영역"이 오늘 공유하는 화면

영역 개념이 코드에 없다(`frontend/src/lib/class` grep `area` 0건). 현재 모든 `SessionType`(`clinical`/`hypnosis`/`meditation`/`custom`)이 **같은 화면에서 "클래스"** 로 표시된다.

- `lib/class/class-labels.ts:21-32` `CLASS_TYPE_LABELS`: `임상심리상담`·`최면심리상담`·`명상 클래스`·`기타`, fallback `클래스`.
- 가드 SWEPT 10개 경로(`pages/sessions/*`, `pages/client/*`, `components/client`, `shell`)는 **전부 공유 화면**이다. 즉 오늘의 가드는 사실상 "통합 화면용 단일 정책 = 명상(클래스) 정책"이다.
- 따라서 Phase 0 의 영역 분리는 **정책 정의의 분리**이지 파일 경로 분리가 아니다. Phase 0 에서 `meditation` 정책을 오늘 SWEPT 10개 + `e2e` 소스 루트 2개에 그대로 적용하고, `counseling` 정책은 **정의만 하고 적용 경로 0개**로 둔다(상담 전용 경로는 Phase 2/6 에서 생김). 이것이 "영역별 가드 분리 + 문구·동작 불변"을 동시에 만족하는 유일한 형태다.

---

## 3. 서버 문구 (`backend/app`)

### 3.1 문구가 생성되는 중앙 위치

중앙 템플릿 모듈은 **없다**. 알림은 호출부가 제목·본문 문자열을 직접 만든다.

| 위치 | 생성 문구 | 비고 |
|---|---|---|
| `services/session_service.py:1148-1219` `_notify_participants_event` | 제목·본문을 인자로 받아 `notification_service.notify_event` 로 전달(템플릿 없음) | 모든 세션 이벤트 알림의 단일 경유점 |
| `session_service.py:431-432` | `새 세션 예약` / `새 세션이 열렸습니다`, 본문 `session.title or "세션"` | 호출 1곳 |
| `:886-887` | `세션 정보가 변경되었습니다` | |
| `:915-916` | `세션이 취소되었습니다` | |
| `:1051-1063` | 딕셔너리 `_action_title`: `세션이 오픈되었습니다`/`시작되었습니다`/`종료되었습니다`/`취소되었습니다` | `_action_event` 와 짝 |
| `:1417` | 제목 `대기열에서 참여자로 승격되었습니다`(`:1416`), 본문 `or "세션"` | |
| `:1512-1513`, `:1545-1546` | `세션에 초대되었습니다` ×2 | |
| `:1593-1594` | `세션에서 제외되었습니다` | |
| `services/session_invite_service.py:87-88` | `클래스에 입장해 주세요`, 본문 `or "클래스"` | 이 파일은 이미 "클래스" |
| `services/report_service.py:937-938` | `리포트가 도착했습니다` / `세션 리포트가 승인되었습니다` | |
| `api/v1/client_portal.py:247` | fallback `상담 세션` | 이미 정식 명사 사용 |
| `services/notification_service.py:186-192` `_build_email_content` | 이메일 제목 = `[MIND BREEZE] {title}` (제목 비면 `[MIND BREEZE] 알림`) | 즉 **알림 제목이 곧 메일 제목** → 제목 문구가 바뀌면 메일 제목도 바뀐다(Phase 2 에서 의식해야 함) |
| `services/reminder_service.py:99-107,138-193` | 사전 안내 메일: 제목 `[MIND BREEZE] {title} 클래스 안내 ({label})`, 본문 `예약하신 클래스가 {label} 남았습니다.` 등(텍스트+HTML 이중) | 유형 라벨은 `명상수업` |
| `services/session_email_invite_service.py:211-236` | 비회원 초대 메일 `…에 초대했어요`, `진행자가 클래스에 초대했어요`, `- 클래스: …` | |
| `tasks/email.py:675,685` | 리포트 메일 본문 `세션에 함께해 주셔서 감사합니다.`, 제목 `[MIND BREEZE] 세션 리포트가 도착했습니다` | |
| `services/report_email_service.py:412,423,430` | `나를 위한 세션 리포트`, `02 · 세션 인사이트`, `세션에서 기록한 지표입니다…` | |
| 푸시 | `push_service.py`·`web_push_service.py`·`outbox_worker.py` 에는 `세션`/`클래스` 문구 **없음**(grep 0). 푸시 제목·본문은 `Notification.title/body` 를 그대로 전달하는 것으로 보이나 앱(Capacitor) 쪽 변환 여부는 `미확인`(R8 §10-2 와 동일) |

R8 수치 검증(직접 확인): `backend/app` `클래스` 231줄·`세션` 534줄 ✓. `frontend/src` `클래스` 443줄·`세션` 272줄 ✓(grep 전 확장자). `or "세션"` 은 R8 의 8곳이 `session_service.py` 8줄로 맞고, 그 외 `chat_service.py:686` 1곳이 더 있다(총 9). `detail=…세션` 48 ✓. 문자열 리터럴 기준 45/106 등 R8 의 휴리스틱 분류 수치는 **재현하지 않음**(`미확인`, 위 줄 수만 검증).

### 3.2 유형 라벨 중복 — R8 보다 하나 더 많고 값이 다르다

| # | 위치 | 명상 값 | custom | fallback |
|---|---|---|---|---|
| 1 | `services/reminder_service.py:99-107` `_session_type_label` | `명상수업` | `custom_type_name or "클래스"` | `클래스` |
| 2 | `services/agent_policy.py:45-49,61-64` `SESSION_TYPE_LABELS`/`session_type_label` | `명상수업` | `custom_type_name or "클래스"` | `클래스` |
| 3 | `agent_policy.py:212` | (세션 없을 때 리터럴) `"클래스"` | | |
| 4 | `services/report_comment_service.py:24-28,102-105` `_SESSION_TYPE_LABELS`/`_session_type_label` | **`명상 수업`(공백 있음)** | `custom and custom_type_name` 일 때만 | **`상담`** |
| 5 | `session_service.py` 알림 본문 fallback 8곳 `"세션"` + `session_invite_service.py:88` `"클래스"` + `chat_service.py:686` `"세션"` | | | |

→ 제로 변경 골격은 `명상수업`(reminder/agent)과 `명상 수업`(report_comment, LLM 프롬프트에 들어감)을 **별도 키로 보존**해야 한다. 하나로 합치면 출력이 바뀐다. (`수업` 이 금지어이므로 Phase 2 에서 `명상 클래스` 로 통일하는 것이 맞지만 그건 문구 변경이라 Phase 0 범위 아님.)

### 3.3 기존 백엔드 테스트가 이 문구를 고정하는가

- `test_sdd097_session_reminders.py:154-166`: 리마인더 본문의 코드·준비물·`하루 전`만 확인. `클래스 안내`/`명상수업` 직접 단언 **없음**.
- `test_notification_outbox.py:120,142`: `[MIND BREEZE] 클래스 안내` 문자열은 **테스트가 직접 만든 payload**(서비스 출력 검증 아님).
- `세션이 취소되었습니다` 등 `session_service` 알림 제목을 단언하는 테스트: **grep 0건**. `test_sdd093_*`·`test_notification.py` 는 이벤트 종류/발화 여부를 본다.
- 결론: **서버 문구 출력은 현재 테스트로 보호되지 않는다.** 리팩터 *전에* 특성화 테스트를 추가해 현재 문자열을 못 박아야 "문구 변경 없음"을 기계적으로 증명할 수 있다.

### 3.4 `session_terms.py` 골격의 제로 출력 변경 가능성 — 판단: 가능

조건:
1. 사전 키는 "지금 코드가 쓰는 문구 단위"로만 만든다(§4.3). 영역(`meditation`/`counseling`)별 값은 Phase 0 에서 **모두 현행 문자열과 동일**하게 둔다. 서버에는 아직 `session.area` 가 없으므로(Phase 1 에서 추가) 호출부는 영역 인자 기본값을 쓴다.
2. 포함 범위는 **(a) `session_service.py` 알림 제목 11개 + 본문 fallback `세션` 8개, (b) `session_invite_service.py:87-88`, (c) 유형 라벨 4곳**으로 한정. 메일 본문(`reminder_service`·`session_email_invite_service`·`report_email_service`·`tasks/email.py`)은 텍스트·HTML 이중 구조와 f-string 변수가 얽혀 있어 Phase 0 에서 건드리지 않는다(Phase 2 문구 작업 때 이전). 에러 `detail` 문구는 R8-D7 기본값(프론트 코드 매핑, 서버 유지)이므로 사전 대상 아님.
3. 변경 전 특성화 테스트(§6 `BT-T01`~)를 먼저 커밋 → 리팩터 후 같은 테스트 통과.
4. 서버 호출 순서·DB·응답 스키마는 불변(문자열 상수 치환만).

위험: `or "세션"` 은 *제목이 비었을 때만* 쓰는 fallback 이라 `body=(s.title or term(...))` 형태로 두면 동작 동일. `_action_title.get(action, event_type)`(`:1062`)의 두 번째 인자(`event_type` 문자열)도 보존해야 한다(액션이 4종 외일 때 fallback 은 `event_type` 이지만 `event_type` 이 None 이면 호출 자체를 안 하므로 사실상 도달 불가 — 그래도 동일하게 유지).

---

## 4. 최소 설계 제안

### 4.1 원칙

1. 글자는 **한 글자도** 바꾸지 않는다. 사전 값 = 현행 리터럴의 복사본, 이를 기계로 증명한다(§5).
2. 사전은 Phase 0 에 필요한 키만 만든다(내비 라벨 + 서버 알림·유형 라벨). 지도사·`상담 N회차`·구성원 등 D-62 값은 **키도 만들지 않는다**(Phase 2 가 추가).
3. 구조는 확장 가능하게(영역 차원, 키 타입) 하되 영역별 값은 Phase 0 에서 동일.

### 4.2 프론트 — 키 스키마와 파일

**`frontend/src/lib/terms.ts` (신규)**
```ts
export type TermArea = 'meditation' | 'counseling';
export type NavKey =
  | 'home' | 'class' | 'client' | 'chat' | 'report' | 'playground' | 'notification' | 'setting'
  | 'org-dashboard' | 'org-counselors'
  | 'admin-orgs' | 'admin-applications' | 'admin-users' | 'admin-clients';
export type TermKey = `nav.${NavKey}`;           // Phase 0 은 nav.* 만
export function term(key: TermKey, area: TermArea = 'meditation'): string
```
- 값 표: `nav.home`은 **사용 컨텍스트마다 글자가 다르다** — 상담사 사이드바 `대시보드`, 회원 `홈`, 상담사/회원 하단 탭 `홈`, 기관 `기관 대시보드`. 따라서 "같은 키에 같은 글자"가 아니다. 안전한 방법: **NavKey 를 화면 위치별 항목 정체성**으로 정의하고(예: `home` 라벨은 컨텍스트별로 `대시보드`/`홈`을 갖는 서로 다른 키 `dashboard`/`home`), 라벨 불일치가 생기지 않게 한다. 제안 키(현행 글자 → 키):
  - `dashboard`=`대시보드`, `home`=`홈`, `org-dashboard`=`기관 대시보드`, `class`=`클래스`, `client`=`내담자`, `chat`=`채팅`, `report`=`리포트`, `playground`=`플레이그라운드`, `notification`=`알림`, `setting`=`설정`, `org-counselors`=`상담사`, `admin-orgs`=`기관 관리`, `admin-applications`=`가입 신청`, `admin-users`=`상담사 관리`, `admin-clients`=`회원 관리`, `more`=`더보기`.
  - `ShellFrame.tsx` 키(`home·class·client·chat·report·alarm·setting·more`)와 겹치는 `class·client·chat·report·setting·more` 는 같은 이름, `alarm`↔`notification` 만 다름 → 하니스는 건드리지 않으므로 충돌 없음(통일은 후속).
- 영역 차원: `TERMS: Record<TermKey, Record<TermArea, string>>`. Phase 0 에서 모든 키의 `meditation` 과 `counseling` 값은 동일(주석 `// Phase 2: D-62 값으로 교체`). `class` 키는 Phase 2 에서 `meditation: '명상 클래스'` / `counseling` 키는 별도 `counseling` NavKey 추가 → 키 추가는 가산적이라 Phase 0 스키마와 호환.
- 대안(더 단순): 영역 차원 없이 `Record<TermKey,string>` 만. 단 브리프가 "영역별 사전"을 요구하므로 위 안을 기본값으로 제안(기술 결정은 plan).

**내비 항목에 안정 키 부여 (렌더 글자 불변)**

| 파일 | 변경 |
|---|---|
| `SidebarNav.tsx` | `NavItem` 에 `key: NavKey` 추가, `label: string` 제거(또는 `term(key)` 로 계산). 4개 배열의 항목에 `key` 부여. `getBadge(label)` → `getBadge(key)`, 비교식을 `switch(key)`. `navItems.map` 의 React `key={it.to}` 유지(변경 없음, 동일 목록 내 `to` 중복 없음) |
| `layout/BottomTabBar.tsx` | `TabItem` 에 `key`, `tabItemsForRole` 이 `key` 포함, 비교식 3개를 키로 |
| `client/BottomTabBar.tsx` | 동일 |
| 렌더 | `<span>{term(it.key)}</span>` — 출력 글자는 현행과 동일 |

**배지 결합 방식**: 키 → 개수 매핑을 *각 컴포넌트 안에서* 유지한다(계산식이 달라 합칠 수 없음, §1.3). 공통으로는 타입만 공유: `NavBadgeKey = Extract<NavKey, 'chat'|'notification'|'report'|'class'>` 와 순수 헬퍼 `formatBadge(count): string|null`(9+ 처리) 정도. 합치기는 하지 않는다. 배지는 이후 `class` 키에 붙어 있으므로 Phase 2 에서 라벨이 `명상 클래스`로 바뀌어도, `상담` 키가 추가돼도 배지가 따라 움직이지 않는다.

### 4.3 서버 — `services/session_terms.py` 골격

```python
# 영역 인자는 Phase 1 의 session.area 가 생기기 전까지 기본값을 쓴다.
Area = Literal["meditation", "counseling"]
def notification_title(event: str, area: Area = "meditation") -> str
def notification_body_fallback(area: Area = "meditation") -> str    # "세션"
def invite_remind_title(area=...) -> str                              # "클래스에 입장해 주세요"
def invite_remind_body_fallback(area=...) -> str                      # "클래스"
def session_type_label(session_type: str, custom_name: str | None, *, variant: Literal["reminder","report_comment"]) -> str
```
- 키 도출 근거(코드가 실제 요구): `session_opened/started/completed/cancelled`(`_action_title`), `session_booked`(2변형: scheduled/opened), `session_updated`, `session_cancelled`(직접 취소), `session_invited`, `session_participant_removed`, `session_waitlist_promoted`(대기 승격 — 현재 제목에 `세션` 없음, 그래도 호출부이므로 포함 여부는 plan), 본문 fallback.
- 유형 라벨은 `variant` 로 `명상수업`/`명상 수업`, fallback `클래스`/`상담` 차이를 보존.
- 반환 문자열은 현행 리터럴과 **동일**. 테스트가 이를 증명(§5.2).

### 4.4 가드 분리 설계

**데이터 파일 (영역별 금지어 목록, 단일 정본)** — 위치 제안 `frontend/e2e/class-flow/banned/`:
- `common.json` — `["참여하기","그래도 시작","LB ","1:N","대시보드로","6자리","게스트","인증 코드","OTP","\\bQR\\b","귀 뒤","귀뒤","귀에","연결해야 입장","30일 보관","관리자가 삭제를 지시하기 전까지","표시 이름만","정원 10 고정","그룹은 최대 10명"]` (현행 22개 중 19개)
- `meditation.json` — `["세션","수업","오픈"]`
- `counseling.json` — `["클래스","수업","오픈","(?<!상담 )세션"]` (D-62/기획.md §4.1 근거; **Phase 0 에서는 어떤 경로에도 적용하지 않음**)
- 각 항목은 정규식 소스 문자열. `|` 로 join 하면 현행 `BANNED_COPY` 와 **바이트 단위로 같게** 재구성 가능하도록 meditation 을 앞에 둔다(`세션|수업|오픈|참여하기|…`).
- JSON 로 두는 이유: `.mjs`(Node, TS 불가) 와 vitest(TS) 가 모두 읽어야 한다. `lib.mjs` 에서는 `fs.readFileSync`, vitest 에서는 `readFileSync`(선례: `class-flow-case-key.test.ts:15-17` 이 `../../designs/.../case-keys.json` 을 읽음).

**`lib.mjs` 변경**: `export const BANNED_COPY = composeBanned('meditation')` 로 유지(기존 import·selftest 불변), `composeBanned(area)` 신규 export, `copyConfig(area='meditation')`, `scanSources(roots, exts, area='meditation')`. `fit.mjs`·`selftest.mjs` 는 **수정 불필요**(기본값이 현행).

**`class-flow-shell-terms.test.ts` 변경**: 
- `SWEPT: readonly {path:string; area:TermArea}[]` 로 구조화(10개 모두 `meditation`), 금지 검사는 `세션` 하드코딩 대신 `banned/meditation.json` 의 `세션` 규칙을 사용하되 **현행처럼 `세션` 단독 검사를 유지**(검사 범위 확대 금지 — `수업`·`오픈` 을 추가하면 현재 통과하는 파일이 실패할 수 있고 이는 동작 변경에 준하는 게이트 변경이므로 Phase 0 에서 하지 않음. `수업` 위반 여부는 `미확인`).
- 신규 describe "사전 값 가드": `TERMS` 의 모든 값이 해당 영역 금지어 정규식에 걸리지 않음(Phase 0 는 `meditation` 만 `세션|수업|오픈` 0건, `counseling` 영역은 `(?<!상담 )세션|클래스…` 에 **현행 값이 `클래스`를 포함하므로 걸린다** → 이 검사는 Phase 0 에서 `counseling` 에 적용 불가. 따라서 `counseling` 사전 검증은 "적용 경로 0개, 규칙 정의만"으로 두고 Phase 2 에서 활성화.)
- 신규 단위 테스트: `counseling` 정규식이 `상담 세션`은 통과시키고 `세션 예약`·`클래스 열기`는 잡는지(규칙 자체 검증, 소스 스캔 없음).

### 4.5 영역 범위 요약 (오늘 기준)

| 구분 | 오늘의 범위 | Phase 0 처리 |
|---|---|---|
| 명상 클래스(meditation) 정책 | SWEPT 10개 + `e2e` 소스 루트 2개 + DOM 케이스 전체 | 파일 목록을 `area: 'meditation'` 으로 태깅, 규칙은 불변 |
| 상담(counseling) 정책 | 없음(전용 화면 없음, 모든 세션 유형이 "클래스" 화면 공유) | 규칙 파일만 신설, 적용 경로 0, 규칙 자체 단위 테스트만 |

---

## 5. "문구 변경 없음"의 기계적 증명

### 5.1 프론트

1. **특성화 먼저(구현 전 커밋)**: 현행 코드에서 통과하는 라벨 스냅샷 테스트 — 역할 4종(counselor, org_admin, client, platform_admin)의 `SidebarNav` 렌더 `nav a` 의 `[href, textContent(배지 제외)]` 배열, `layout/BottomTabBar`(counselor/org_admin/platform_admin/client role 인자), `client/BottomTabBar` 의 `[버튼 텍스트]` 배열을 **하드코딩 골든 배열**로 단언. 키 전환 후 **같은 테스트가 수정 없이 통과**해야 함(테스트 파일을 구현 커밋에서 수정하면 안 됨).
2. **사전 값 정확 일치**: `terms.test.ts` 가 골든 객체(현행 리터럴 복사본)와 `term(key,area)` 를 모든 키·모든 영역에 대해 `toBe` 비교. 키 개수도 단언(키 추가 시 의도적으로 갱신).
3. **키-배지 결합 증명**: `vi.mock('../src/lib/terms')` 로 `class` 라벨을 임의 값(예 `XYZ`)으로 바꿔 렌더해도 배지가 `class` 항목에 붙고 다른 항목에는 안 붙음 — 라벨이 아니라 키로 결합했음을 증명(3개 컴포넌트 각각).
4. **배지 값 회귀**: `sessionInvites` 길이 0/3/10 에 대해 `없음/3/9+`, 채팅·리포트·알림 케이스, 드로어 경로(`SidebarNav` 에 `notificationBadge` 만 줄 때 나머지 0) 유지.
5. **라벨 비교식 잔존 0**: 소스 정적 테스트 `/\blabel\s*===\s*['"]/` 가 3개 파일에서 0건(재도입 방지).
6. 기존 `class-flow-shell-terms.test.ts` 와 `agent-counselor-sidebar.test.tsx` 무수정 통과.

### 5.2 서버

1. **특성화 먼저**: `session_service` 액션(open/start/end/cancel), 생성(scheduled/open), 수정, 취소, 초대(2경로), 제외, 대기 승격, `session_invite_service` 리마인드 에서 `notification_service.notify_event` 를 monkeypatch 해 `data["title"]`, `data["body"]`(제목 없는 세션 포함) 를 캡처 → 골든 리터럴과 `==`.
2. 유형 라벨: `reminder_service._session_type_label`, `agent_policy.session_type_label`, `report_comment_service._session_type_label` 를 type ∈ {clinical, hypnosis, meditation, custom(이름 있음/없음), 알 수 없음} 로 호출해 골든 비교(특히 `명상수업` vs `명상 수업`, fallback `클래스` vs `상담`).
3. 골격 단위 테스트 `test_session_terms.py`: 모든 키에 대해 `session_terms.*` 반환 == 같은 골든 리터럴, 영역 인자 두 값 모두 동일(Phase 0 불변 조건), 알 수 없는 키 → `KeyError`(조용한 fallback 금지).
4. 기존 `test_sdd097_session_reminders.py`, `test_sdd209_b7_invite_remind.py`, `test_notification_outbox.py` 무수정 통과.

---

## 6. 위험·함정

| # | 내용 | 대응 |
|---|---|---|
| T1 | 비교식이 3곳이 아니라 **10개/3파일**이고 `채팅·알림·리포트` 도 라벨 의존 | 4종 모두 키 전환 |
| T2 | 세 컴포넌트의 배지 **계산식이 다름**(채팅: 루시·위험 합산은 사이드바만, client 하단 탭은 `agentUnread` 합산). 공통화하면 동작 변경 | 비교 기준만 키로. 통합 금지 |
| T3 | `MobileDrawer` 는 `notificationBadge` 만 전달 → 드로어 배지 동작 보존 | 4번 회귀 테스트 |
| T4 | 같은 `home` 의미가 `대시보드`/`홈`/`기관 대시보드` 로 글자가 다름 | 키를 화면 위치별로 분리(`dashboard`/`home`/`org-dashboard`) |
| T5 | 라벨이 `lib/terms.ts` 로 이동하면 SWEPT 의 `SidebarNav`/`BottomTabBar` 검사가 공회전 | 사전 값 자체를 검사하는 테스트 추가 |
| T6 | `수업` 이 금지어인데 서버 유형 라벨에 `명상수업`/`명상 수업` 존재, `components/class/player` 테스트는 `수업` 을 기대값으로 단언 | Phase 0 에서 건드리지 않음. Phase 2 때 함께 정리 |
| T7 | `ESLint react-refresh/only-export-components: error` | 새 코드는 `.ts` 모듈(비컴포넌트)로. 컴포넌트 파일에서 헬퍼 함수 export 금지. `ICONS` 이동 금지(여러 파일이 `SidebarNav` 에서 import) |
| T8 | 알림 제목 = 이메일 제목(`_build_email_content`) | 서버 사전 도입은 제목 불변 증명 필수, Phase 2 문구 변경 시 메일 제목도 같이 바뀜을 명시 |
| T9 | 서버 문구 출력이 현재 테스트로 미보호 | 특성화 테스트를 리팩터 커밋 *앞에* 둠 |
| T10 | `lib.mjs` `BANNED_COPY` 를 합성으로 바꿀 때 순서·이스케이프 변경으로 `\\bQR\\b` 등이 달라질 위험 | 합성 결과 `===` 현행 리터럴(테스트에 원문 복사) |
| T11 | e2e 하니스(`selftest.mjs`)는 CI 미연결·Playwright 필요 → 변경 후 자동 감지 안 됨 | `BANNED_COPY` 합성 동치는 **vitest 로** 검증(브라우저 불필요). selftest 실행은 구현 단계 수동 `미확인` |
| T12 | 프론트 CI `Test` 단계 `continue-on-error` + 기존 실패 16건 → 신규 테스트가 회귀를 잡아도 CI 가 막지 않음 | verify 에 "로컬/CI 로그에서 해당 파일 pass 확인" 합격 기준을 명시 |
| T13 | `class-flow-shell-terms.test.ts` 에서 `수업`·`오픈` 검사를 추가하고 싶은 유혹 | 금지(현재 통과/실패 미확인, 게이트 변경). 별도 이슈 |
| T14 | `NavItem.badge` 죽은 필드, `host-shell-data.ts:98` 등 | 건드리지 않음 |
| T15 | 영역 차원의 값이 Phase 0 에서 동일 → "영역별" 이 형식적일 수 있음 | spec 에 "Phase 0 은 구조(스키마·키·가드 분리)만, 값 분화는 Phase 2" 명시 |

---

## 7. 파일 목록과 소유자 (파일당 소유자 1명)

| 트랙/Task | 파일 | 소유 |
|---|---|---|
| **T0-FE-A** 특성화 테스트(구현 전) | `frontend/tests/nav-labels-characterization.test.tsx`(신규) | A |
| **T0-BE-A** 특성화 테스트(구현 전) | `backend/tests/test_session_terms_characterization.py`(신규) | B |
| **T1-FE** 용어 사전 | `frontend/src/lib/terms.ts`(신규), `frontend/tests/terms.test.ts`(신규) | A |
| **T2-FE** 내비 키 전환 | `frontend/src/components/layout/SidebarNav.tsx`, `frontend/src/components/layout/BottomTabBar.tsx`, `frontend/src/components/client/BottomTabBar.tsx`, `frontend/tests/nav-badge-by-key.test.tsx`(신규) | A (T1 이후, 같은 워커) |
| **T3-FE** 가드 분리 | `frontend/e2e/class-flow/banned/{common,meditation,counseling}.json`(신규), `frontend/e2e/class-flow/lib.mjs`, `frontend/tests/class-flow-shell-terms.test.ts`, `frontend/tests/terms-guard.test.ts`(신규) | C |
| **T4-BE** 서버 골격 | `backend/app/services/session_terms.py`(신규), `backend/tests/test_session_terms.py`(신규), 호출부 치환: `backend/app/services/session_service.py`, `session_invite_service.py`, `reminder_service.py`, `agent_policy.py`, `report_comment_service.py` | B (**호출부 5개 파일의 다른 Phase 0 항목과 충돌 주의**: 항목 2 `authorize_session` 단일화가 `session_service.py` 등을 같이 수정하므로 같은 워커가 순차 처리하거나 병합 순서 지정 필요) |

변경하지 않는 것: `ShellFrame.tsx`, `notification-format.ts`(이미 이벤트 키 기반, Phase 2), `class-labels.ts`, `reminder_service.py` 메일 본문 문구, `ICONS`.

## 8. Task 분해 (규모)

| ID | Task | 규모 | 선행 | 테스트 ID |
|---|---|---|---|---|
| T0-FE | 현행 라벨/배지 특성화 테스트 작성(4역할 사이드바·3종 하단 탭) — **구현 전 커밋** | S | — | `FE-NAV-01`~`04`(라벨 골든), `FE-NAV-05`(배지 값 현행) |
| T1-FE | `lib/terms.ts` + 골든 일치 테스트 | S | — | `FE-TERM-01`(모든 키·영역 값 == 골든), `FE-TERM-02`(키 수 고정), `FE-TERM-03`(알 수 없는 키 타입 오류는 컴파일 타임, 런타임 방어 시 throw) |
| T2-FE | 3개 파일 키 전환 + `label ===` 제거 | M | T0, T1 | `FE-NAV-01`~`05` 무수정 통과, `FE-NAV-06`(라벨 mock 변경에도 배지 유지, 3컴포넌트), `FE-NAV-07`(드로어 경로 배지 0 유지), `FE-NAV-08`(`label ===` 정적 0건) |
| T3a-FE | 금지어 JSON 3종 + `lib.mjs` 합성 | S | — | `FE-GUARD-01`(`composeBanned('meditation') === 현행 BANNED_COPY 원문`), `FE-GUARD-02`(common+meditation 항목 합 == 22개), `FE-GUARD-03`(`BANNED_COPY` export 유지) |
| T3b-FE | `class-flow-shell-terms.test.ts` 영역 구조화 + counseling 규칙 단위 테스트 | S | T3a | 기존 `SH7 용어 치환` 통과(무수정 동작), `FE-GUARD-04`(`상담 세션` 허용), `FE-GUARD-05`(`세션 예약`·`클래스 열기` 적발), `FE-GUARD-06`(TERMS 값이 meditation 금지어 0) |
| T0-BE | 서버 문구 특성화 테스트 — **구현 전 커밋** | M | — | `BE-TERM-C01`~`C12`(알림 제목/본문: open/start/end/cancel, 생성 2변형, 수정, 직접 취소, 초대 2경로, 제외, 승격, 리마인드), `BE-TERM-C13`(유형 라벨 3함수 × 5유형) |
| T4-BE | `session_terms.py` + 호출부 치환 | M | T0-BE | `BE-TERM-01`(키별 값 == 골든), `BE-TERM-02`(영역 두 값 동일), `BE-TERM-03`(미지 키 `KeyError`), `C01`~`C13` 무수정 통과, 기존 `test_sdd097_*`·`test_sdd209_b7_*`·`test_notification_outbox` 통과 |
| T5 | 통합 확인: `npx vitest run` 대상 파일, `pytest` 대상 파일, `npx eslint src/`, `npx tsc --noEmit` | S | 전부 | 합격 기준은 verify.md 로 |

합계: FE 5개 Task(S3·M1 + 특성화 S1), BE 2개 Task(M2), 통합 1(S).

## 9. 결정 필요 / 미확인

**사용자(비즈니스) 결정 필요: 0개** — Phase 0 은 값 확정을 요구하지 않는다(D-62 는 Phase 2 전까지). plan 이 정할 기술 결정만 남음: ① 영역 차원을 Phase 0 스키마에 넣을지(권장: 넣음) ② `NavItem.badge` 죽은 필드 처리(권장: 유지) ③ 서버 골격 범위를 알림 제목·유형 라벨로 한정(권장) vs 메일 본문 포함 ④ 가드 JSON 위치.

**미확인**
1. 프론트 기존 실패 16건의 파일 목록 — 전체 스위트 미실행.
2. `class-flow/selftest.mjs`·`fit.mjs` 현재 통과 여부 — Playwright·vite 서버 필요, 실행하지 않음.
3. 소스 스캔 경로 외 `수업`·`오픈` 현재 위반 여부 — `class-flow-shell-terms.test.ts` 가 `세션`만 검사하므로 SWEPT 경로의 `수업`·`오픈` 존재 여부는 조사하지 않음.
4. Capacitor 앱의 푸시 제목 변환 여부(R8 §10-2).
5. R8 §3.2 의 문자열 리터럴 기준 수치(프론트 288/75, 백엔드 45/106 등) — 줄 수(443/272/231/534)만 재현 검증.
6. `chat_service.py:686` 의 `or "세션"`(채팅방 표시 이름)이 사용자 노출인지 — Phase 0 범위 밖으로 둠.
