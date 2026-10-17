# I8 셸형 화면(회원 FM01~FM03·신청 시트, 상담사 FH01·FH04) — 코드 조사

- 기준: develop `32fa5533` + 미커밋 변경(무관: `SidebarNav.tsx` 로그아웃 버튼 위치 이동 — 아래 줄 번호는 이 변경 반영본 기준, 영향 없음 확인). 조사 일자 2026-10-17. 코드·시안 수정 없음.
- 경로 표기: 프론트 `frontend/src/` 기준, 백엔드 `backend/app/` 기준. 시안은 `designs/class-flow-redesign/` 기준.
- 시안 근거는 `member-a.html`(FM01 `:257-288`, FM02 `:290-332`, FM03 `:334-366`), `host-a.html`(FH01 `:333-395`, FH04 `:397-445`), `flow-base.css`(`sh-*` `:84-104`, `fl-*` `:15-82`).

---

## 0. 한 줄 결론

1. **백엔드 변경 없이 셸형 화면 대부분을 만들 수 있다.** 시작 예정 시각(`scheduled_at`)·방식(`location_type`·`participant_mode`·`linkband_mode`)·장소(`location_address`)·소요 시간·참여자 수는 `GET /sessions`·`GET /sessions/{id}` 응답에 이미 있다(`schemas/session.py:146-184`, `services/session_service.py:85-148`). 부족한 것은 **호스트 이름(`host_name`)·참여자 이름(`user_name`)·대기실 인원(서버 미저장, WS 전용)·참석 여부** 4가지이며 모두 프론트 대체안이 있다.
2. **입장 CTA 불일치의 뿌리는 3곳**: 홈 `isLive` 가 `ready` 를 포함(`ClientHomePage.tsx:78`, `:263`), 히어로 `onEnter` 가 항상 상세로 이동(`:433`), `pickUpcomingClass` 가 시작 시각이 지난 `scheduled` 를 버림(`lib/class/reminder.ts:86,89`). 이 셋을 **단일 판정 함수 + 단일 진입 함수**(`getClassEnterState`·`useEnterClass`)로 모으면 홈·목록·상세·알림이 같은 규칙을 쓴다.
3. **`PlayerSheet` 는 셸형에 재사용할 수 없다.** `.pz-shell` 그리드 안에서만 자리를 잡고(`player-shared.css:182-192`) 다크 전용이다. 셸형 전용 시트(포털 + 스크림 + `useDialogA11y`)를 새로 만들어야 한다. 탭바 가림 원인은 모달과 탭바가 같은 `z-50` 이고 탭바가 DOM 뒤에 있기 때문이다(`ClientSessionListPage.tsx:451` vs `components/client/BottomTabBar.tsx:46`).
4. **시안 `sh-*` 를 토큰째로 가져오면 안 된다.** 플레이어 토큰(`--tx-*`·`--sheet-*`)은 `.pz-root` 안에서만 정의되고(`player-tokens.css:3`) 그 루트는 글자색을 밝게(`--tx-hi`) 지정한다. 라이트 셸 위에는 **라이트 토큰 블록을 따로 두고, 다크 면(히어로·시트)에만 `.pz-root` 를 씌우는** 2단 구조를 제안한다.
5. **용어 치환의 함정**: 내비 라벨 `'세션'` 문자열이 배지 계산의 **키**로도 쓰인다(`SidebarNav.tsx:218`, `components/client/BottomTabBar.tsx:56`, `components/layout/BottomTabBar.tsx:65`). 라벨만 `클래스` 로 바꾸면 초대 배지가 조용히 사라진다.
6. **시안 자체의 불일치 2건**: 셸 위 시트 톤이 회원(라이트 흰 시트, `member-a.html:104`)과 상담사(다크 소프트, `host-a.html:194`)에서 다르다. 상담사 목록 카드의 `시작하기` 는 결정 8(시작 전 확인 시트 FH07)과 충돌할 수 있다(§5 D5, §2.7).

---

## 1. 현재 코드 상태 (판정표)

| 항목 | 판정 | 근거 |
|---|---|---|
| 시작 예정 시각 A3 (`scheduled_at`) 응답 포함 | **있음** | `schemas/session.py:154`, `session_service.py:96`, FE `lib/api/session.ts` `SessionDto.scheduled_at` |
| 방식·인원·밴드 모드 A2 서버 저장·응답 | **있음(신규 데이터)** / 레거시 일부 오염 | DTO `location_type`·`participant_mode`·`linkband_mode` (`schemas/session.py:164,167,168`). 예약 모달은 이를 보내지 않고 `notes` 태그만 붙여(`SessionListPage.tsx:76-88`) 서버 기본값(`offline`·`one_on_one`·`none`, `schemas/session.py:29,33,34`)으로 저장됨 |
| 오프라인 장소 필드 | **있음** | `location_address` (`schemas/session.py:166`), 미입력 시 기관→상담사 주소로 서버가 채움(`session_service.py:61-82`). 온라인이면 항상 null |
| 호스트(상담사) 이름 | **없음** | `SessionResponse` 에 `host_name` 없음(`schemas/session.py:146-184`; by-code 응답에만 있음 `:237`, 제거 대상). FE 는 `user.counselors` 로 찾고 못 찾으면 `'상담사'` 폴백(`ClientSessionDetailPage.tsx:123-127`) |
| 참여자 이름(상담사 상세) | **없음(REST)** | `ParticipantInfo` 에 이름 필드 없음(`schemas/session.py:123-143`). FE 라벨은 `user_name‖user_email‖guest_name‖user_id.slice(0,8)`(`SessionDetailPage.tsx:64-68`); WS `participant_changed` 이벤트가 올 때만 `display_name` 으로 채움(`:71-83`, `:102-134`). 원인 조사는 I3 소관 |
| 대기실 인원·준비 현황 | **WS 전용(서버 미저장)** | `useWaitingRoomCount.ts:1-4`(서버에 대기 상태 저장 안 함, 45초 TTL), `readiness{surveyDone,bandDone,deviceDone}` `lib/socket.ts:236-240`, 호스트 룸 전용 브로드캐스트 `ws/session_live_namespace.py:1078-1091`. 목록 응답(REST)에는 없음 |
| 초대 인원 | **있음** | `participants.length`(`invite_participant` 가 행을 만든다 `session_service.py:1292-1300`), 대기열 인원 `waitlist_count`(`schemas/session.py:182`)는 **정원 초과 대기열**이며 대기실 인원이 아님 |
| 참석 여부(완료 상세 "참여함/불참") | **없음** | DTO 에 `joined_at` 미노출. 모델 컬럼은 `server_default=func.now()`(`models/session.py:112`)라 초대 시각일 가능성 → 참석 판정 불가(미확인: 운영 DB 상태) |
| 상담사 전문분야(회원 화면) | **없음** | 회원이 받는 `CounselorInfo` = id·name·profile_image·org_name·status(`schemas/client.py:64-69`). 홈의 "임상·최면심리상담 전문"은 하드코딩(`ClientHomePage.tsx:604`) |
| 홈 히어로 선정 규칙 | **버그 있음** | `sessions.find(live)`(`ClientHomePage.tsx:261-266`)는 정렬 없이 첫 항목 — 서버 정렬이 `coalesce(scheduled_at, created_at)` 내림차순(`session_service.py:589-598`)이라 가장 임박한 것이 아니라 **가장 나중 것**이 잡힘. live 판정에 `ready` 포함(`:263`) |
| `pickUpcomingClass` | **일부** | `status==='scheduled'` 만, 시작이 지난 것은 제외(`reminder.ts:86,89`) → 호스트가 아직 안 연 지각 클래스는 히어로에서 사라짐. 단위 테스트가 이 동작을 고정(`tests/session-reminder.test.ts:66-76`) |
| 카운트다운 | **일부** | `formatCountdown`(`reminder.ts:62-74`)은 렌더 시점 1회 계산, 재계산 타이머 없음(`ClientHomePage.tsx` 의 `setTimeout` 은 `:86` 복사 표시용 1건뿐). 테스트가 문구를 고정(`tests/session-reminder.test.ts:59-63`) |
| D-day 요약 타일 | **버그** | `Math.ceil(diff/24h)`(`ClientHomePage.tsx:291-293`) → 오늘 3시간 뒤여도 `D-1`, `D-DAY` 는 이미 지난 경우에만 나옴. `NOW`(영문) 노출 `:290,293` |
| 이번 주 일정 배지 | **하드코딩** | 상태와 무관하게 `예정`(`:553-555`). 필터는 `cancelled` 만 제외(`:282`)라 진행 중·완료도 "예정" |
| 입장 CTA 상태 규칙 | **불일치** | 홈 `ready`→"지금 입장하기"(`:135`) vs 상세 `ready/scheduled`→비활성(`ClientSessionDetailPage.tsx:135-136,165-171`). 입장 경로 = `/join?code=`(`:146-149`) |
| 목록 이중 렌더 | **있음** | `md:hidden`(`ClientSessionListPage.tsx:347`) + `hidden md:grid`(`:363`)가 같은 `SessionCard` 를 DOM 에 2번 |
| 목록 정렬·그룹 | **없음** | 선택일 필터(`:163-171`)와 "즉시 클래스" 섹션(`:172-176,325-344`)뿐. 입장 가능 우선·지난 클래스 구분 없음 |
| 카드 약어 칩 | **있음** | `1:N`(`SessionCard.tsx:22`), `LB 필수/선택`(`:23`), `none` 이면 칩 없음(`:82`) |
| 신청 모달 탭바 가림 | **있음** | `z-50`(`ClientSessionListPage.tsx:451`) = 탭바 `z-50`(`components/client/BottomTabBar.tsx:46`), 탭바가 DOM 뒤(`ClientShell.tsx:259`) |
| 신청 후 상태 | **없음** | `session_request` 시스템 메시지 1통 전송(`ClientSessionListPage.tsx:222-239`)이 전부. 백엔드에 `session_request` 처리 코드 0건(`grep -rn session_request backend/app` → 0). 토스트 3초 후 끝 |
| 상담사 목록 즉시 표 필터 | **버그** | `!scheduled_at && (ready‖in_progress)`(`SessionListPage.tsx:692-694`) — `open` 누락. 모바일 중복 표 필터도 같음(`:614-616`) |
| 캘린더 색 맵 `open` 누락 | **있음** | `CalendarView.tsx:55-62`, `MobileTimetable.tsx:28-37` (배지 `StatusBadge.tsx:6-13` 는 `open` 있음) |
| 상담사 목록 갱신 | **마운트 1회** | `refreshSessions` 는 마운트 때만(`SessionListPage.tsx:645-659`). WS·폴링·온라인 복귀 재조회 없음 |
| 상담사 상세 취소 | **확인 없음 + 진행 중 노출** | `ACTIONS_BY_STATUS.in_progress=['cancel']`(`SessionDetailPage.tsx:34-41`), 즉시 실행(`:175-187,353-362`). 백엔드는 `in_progress→cancel` 허용(`session_service.py:39`) |
| 삭제 | **`window.confirm` + 모바일 숨김 + 서버 상태 가드 없음** | `confirm`(`:191`), `!hidden sm:!inline-flex`(`:330,338,368`). 서버 `delete_session` 은 상태 검사 없이 미디어까지 삭제(`session_service.py:817-832`) |
| 코드 박스 | **있음** | `SessionDetailPage.tsx:405-417`, `handleCopyCode :247-256` |
| 네트워크 끊김 훅 | **분산** | `useBrowserOnline` 이 `HostLiveContainer.tsx:105-116`·`MemberClassContainer.tsx:505-510` 에 각각 로컬 구현. 셸에는 `wsConnected`(알림 소켓)만 있고 사이드바 문구로만 표시(`SidebarNav.tsx:185,305-309`) |
| 셸형 공용 컴포넌트 | **없음** | `components/class/flow/` 디렉터리 없음. 플레이어용 `shared/`(`PlayerSheet` 등)는 다크·그리드 전용 |
| TanStack Query | **미설치** | `package.json` 에 없음, `useQuery` 0건. 목록은 각 페이지가 `useState/useEffect` 로 직접 로드 |

---

## 2. 상세 조사

### 2.1 회원 홈 히어로 (FM01)

**현행 구조**: `HeroCard`(`ClientHomePage.tsx:67-140`) — 코드 칩 `:105-118`, 코드 복사 상태 `:76,81-90`, 고정 문구 "LINK BAND 선택 착용 · Chrome/Edge 권장" `:120`, 카운트다운 칩 `:125-129`, CTA `:130-136`. 빈 상태 `EmptyHero`(`:144-163`)의 CTA 는 `/app/sessions` 이동(`:436`).

**시안 4상태 + 빈 상태가 요구하는 판정(현재 코드로는 불가)**

| 시안 키 | 의미 | 필요한 판정 | 히어로 CTA(시안 `member-a.html:259-262`) |
|---|---|---|---|
| `upcoming` | 예정, 아직 멀다 | `scheduled` 이고 시작까지 > 임계 | `클래스 보기`(라인 버튼) → FM03 |
| `soon` | 곧 열림 | `scheduled`/`ready` 이고 시작까지 ≤ 임계(또는 시작 시각 경과·시각 없음) | `입장 대기하기` → FM05 대기 |
| `open` | 입장 가능 | `status==='open'` | `입장하기` → FM05 |
| `live` | 진행 중 | `status==='in_progress'` | `입장하기` → FM05 |
| `empty` | 없음 | 후보 없음 | `클래스 신청하기` → 신청 시트(`:273`) |

`soon` 임계값은 시안·기획 어디에도 숫자가 없다("30분 뒤" 예시만 `:260`). 제안 기본값 60분(리마인더 옵션 `1시간 전`과 동일, `reminder.ts:20`). → §5 D2.

**선정 규칙 제안**(`lib/class/pick-hero-class.ts`, 순수 함수 + vitest):
1. `in_progress`·`open` 이 있으면 그중 `started_at/opened_at` 최신 1건(`live`/`open`).
2. 없으면 `scheduled`·`ready` 중 **끝나지 않은 것**(`scheduled_at` 없음 = 즉시 클래스, 또는 `scheduled_at + duration_min > now`)을 `scheduled_at` 오름차순(없는 것 먼저)으로 1건 → 임계 이내면 `soon`, 아니면 `upcoming`.
3. 없으면 `empty`.
`pickUpcomingClass` 는 테스트(`tests/session-reminder.test.ts:66-76`)가 고정하므로 **삭제하지 말고 남기거나**, 새 함수 추가 후 테스트를 함께 옮긴다.

**데이터 존재 여부(A3·A2)**: 위 표 §1 참조. 시안 히어로가 쓰는 값 → `title`, `scheduled_at`, `duration_min`(`50분`), 호스트 이름(**`host_name` 없음 → `counselors` 폴백**), 방식 3칩(DTO 3필드), 진행 중 `12분째`(`started_at` ✔ `SessionDto.started_at`), `오늘 오후 2:48 시작`(`started_at`). 날짜 문구("화요일 오후 3:00", "내일 오전 10:00", "10월 22일 (목) 오후 7:00")와 D-day(`D-3`), "시작까지 3일 2시간"은 **새 포매터** 필요(`formatCountdown` 의 "N일 N시간 후" 와 문구가 다르고 테스트가 현 문구를 고정하므로 별도 함수로 추가). D-day 는 `Math.ceil(24h)` 가 아니라 **로컬 자정 기준 일수 차**로 계산해야 한다(현행 `:291-293` 오표기, §1).

**실시간성**: 홈은 마운트 시 1회 `listSessions()` 만 호출(`:233-243`). `upcoming→soon→open` 전이가 새로고침 없이는 반영되지 않는다. 필요: ① 1분 단위 `now` 틱(카운트다운·임계 전이) ② 목록 재조회 트리거(포커스 복귀·30초 폴링·`session_opened/started` 알림 수신). TanStack Query 가 없으므로 `hooks/useClassList.ts`(공용, 홈·목록 공유)를 직접 만든다.

**"참여코드 복사" 제거 범위**(전부 한 파일 `ClientHomePage.tsx`):
- `HeroCard`: `copied` state `:76`, `handleCopy` `:81-90`, 코드 칩+복사 버튼 블록 `:105-118`
- `SummaryTiles`: 타일 1의 `action:'참여코드 복사'`·`onClick:onCopyCode`(`:181`), 프롭 `onCopyCode`(`:172,178`), 사용처 `:586`
- 상위 핸들러 `handleCopyHeroCode` `:393-396`
- 연관: 리마인더 옵션 안내문 "참여코드·준비물을 안내합니다"(`reminder.ts:19`, 상담사 생성 폼 노출)와 이메일 리마인더 본문의 참여코드·`/join` 안내(`services/reminder_service.py:139-153,167`)도 코드 제거(결정 1)와 충돌 → **I1/A7 영향, §범위 밖 발견 2·3**.

**`이번 주 일정` 배지 수정 위치**: `ClientHomePage.tsx:553-555`. `StatusChip` 에 파생 키(`scheduled|soon|open|live|done|cancelled`)를 넘겨 `sessionStatusLabel`(`lib/session-status.ts:4-11`)과 같은 단일 소스를 쓰게 한다. 필터(`:279-285`)는 주 시작 요일도 목록 페이지와 다르다(홈 월요일 `:46-56` vs 목록 일요일 `ClientSessionListPage.tsx:20-25`). 시안은 "이번 주 클래스" 행 목록(`member-a.html:284-285`) — 시안 그대로면 `completed` 는 제외하는 편이 맞다.

**"임상·최면심리상담 전문" 하드코딩(S-M01 ⑦, `:604`)의 범위 판단**: spec 범위(`spec.md:24`)는 "FM01~FM03(홈·목록·상세, 입장 CTA 정합)", 기획 FM01 핵심 변경(`기획.md:85`)은 "상태별 CTA 정합·참여코드 노출 제거·카운트다운"이다. **담당 상담사 카드는 범위에 명시가 없고, 시안 홈에는 이 카드(와 요약 타일·내 리포트·최근 대화·새 알림)가 아예 없다**(`member-a.html:265-288`은 히어로 + 이번 주 클래스 + 빈 상태의 받은 초대뿐). 따라서 하드코딩 문구는 **범위 밖 발견**으로 분리하고, 홈 보조 섹션의 존폐는 §5 D1 로 올린다.

### 2.2 입장 CTA 정합 (단일 진입 함수)

**현재 CTA 위치**
| 화면 | 위치 | 동작 |
|---|---|---|
| 홈 히어로 | `ClientHomePage.tsx:130-136`, `onEnter` `:433` | `navigate('/app/sessions/{id}')` — 상태 무관 상세 이동 |
| 홈 초대 카드 | `InvitedSessionCard.tsx:31-37`, `handleConfirmInvite :379-391`(`:388`) | 읽음 처리 후 상세 이동 |
| 목록 카드 | `ClientSessionListPage.tsx:284-291,334-340`(`SessionCard onClick`) | 상세 이동(카드 전체 클릭). 입장 버튼 없음 |
| 상세 | `ClientSessionDetailPage.tsx:143-154` | `open/in_progress` + `access_code` 있을 때만 활성, `/join?code=` 이동(`:146-149`) |
| 알림 | `lib/api/notifications.ts:154-157`(`session`→`/app/sessions/{id}`), 호출처 `ClientShell.tsx:94`, `ClientNotificationPage.tsx:46`, `NotificationCenterPage.tsx:75` | 상세 이동 |

**시안 규칙(상태 × 화면)**
| 판정 | 홈 히어로 | 목록 카드 | 상세 하단 CTA | 비고 |
|---|---|---|---|---|
| `upcoming` | `클래스 보기`(라인) | 카드 클릭=상세, 버튼 없음 | 비활성 `입장하기`(`mute`, `member-a.html:341-342,361`) + 안내 "클래스가 열리면 알려드려요" | |
| `soon` | `입장 대기하기` → FM05 대기 | (시안 없음) | **시안 없음** — FM03 4상태에 `soon` 이 없어 홈과 어긋남 | §5 D2 |
| `open` | `입장하기` → FM05 | 입장 가능 카드에 `입장하기` 버튼(`:297`) | 활성 `입장하기`(`:343-345`) | |
| `live` | `입장하기` → FM05 | 입장 가능 섹션 | 활성 | `in_progress` |
| `done` | — | 지난 클래스 카드 | `리포트 보기` | |
| `cancelled` | — | 지난 클래스 | `클래스 목록 보기` | |
| 초대 | — | `클래스 확인`(라인) → **상세**(`:304`) | — | 카드 본문 클릭은 시안이 FM05 로 지정(`:300`)해 버튼과 불일치 → 상세로 통일 권장 |

**단일 진입 함수 제안**(라우트는 I1 이 확정 — 여기서는 자리표시자 `enterRoute(id)`)
- `lib/class/enter-action.ts`(순수): `getClassEnterAction(session, now)` → `{ state:'view'|'wait'|'enter'|'done'|'closed', label, enabled, hint }`. 홈·목록·상세가 **같은 함수의 결과**로 라벨·활성을 정한다.
- `hooks/useEnterClass.ts`: `navigateToEnter(sessionId)` 한 곳에서만 라우트를 안다(`ClientHomePage:433`·`SessionCard`·`ClientSessionDetailPage:146-149`·알림 해석기 모두 이것만 호출). 상세의 `access_code` 의존(`:139,155-178`)은 제거 대상(결정 1).
- 알림: 기본은 상세 유지(`notifications.ts:154-157`). `extra.event_type` 이 `session_opened`/`session_started` 인 토스트·알림 행만 입장 단축(§5 D8).

**변경 파일**: `ClientHomePage.tsx`, `ClientSessionListPage.tsx`, `ClientSessionDetailPage.tsx`, `components/client/InvitedSessionCard.tsx`, `components/session/SessionCard.tsx`, `lib/api/notifications.ts`, `components/client/ClientShell.tsx`(`:94`), `pages/client/ClientNotificationPage.tsx`(`:46`), 신규 `lib/class/enter-action.ts`·`hooks/useEnterClass.ts`·`lib/class/pick-hero-class.ts`.

### 2.3 회원 목록 FM02

**두 트리**: 모바일 `md:hidden` `:347-360`(월 달력 + 선택일 + 목록), 데스크톱 `hidden md:grid` `:363-446`(좌 달력+선택일 목록 / 우 일간·주간 타임라인). 같은 `SessionCard` 가 `renderSessionList()`(`:255-293`)와 `:384-392` 에서 두 번 만들어진다.

**시안 `list`(`member-a.html:306-332`) — 캘린더 없음.** 섹션: `지금 입장할 수 있어요`(1) → [초대받은 클래스] → `예정된 클래스` → `지난 클래스`, 전부 한 줄기 내부 스크롤. 달력(`MonthCalendar`)·타임라인(`CalendarView`)은 시안에 없으므로 **존치하지 않는 것이 시안 정본**. 존치하면 이중 렌더가 그대로 남는다(§5 D3). `MonthCalendar` 는 회원·상담사 목록에서만 쓰여 제거 시 고아가 된다(`import` 검색: `ClientSessionListPage.tsx:11`, `SessionListPage.tsx:10`).

**그룹·정렬 규칙 제안**(한 트리, 한 번 렌더)
| 섹션 | 포함 | 정렬 | 비고 |
|---|---|---|---|
| 지금 입장할 수 있어요 | `open`·`in_progress` | `in_progress` 먼저 → `opened_at/started_at` 내림차순 | 비면 섹션 숨김(시안은 항상 1건 시연) |
| 초대받은 클래스 | 읽지 않은 `session_invited` 알림(`notificationStore.sessionInvites`, `InvitedSessionCard` 현행 로직 `:127-149`) ∩ 위 두 섹션이 아닌 것 | 알림 도착 순 | **중복 방지**: 같은 클래스는 한 번만(우선순위 입장 가능 > 초대 > 예정). 현행은 즉시 클래스와 초대 카드에 중복 노출 |
| 예정된 클래스 | `scheduled`·`ready` | `scheduled_at` 오름차순, 없는 것(`ready`) 먼저 | `ready`=상담사 준비 중. 시안 상 `곧 열림` 칩 |
| 지난 클래스 | `completed`·`cancelled` | `ended_at ?? scheduled_at ?? created_at` 내림차순 | 서버는 전량 반환(FE 가 `page/limit` 미사용 `lib/api/session.ts:309`, 서버는 지원 `api/v1/session.py:50-61`). 20건 초과 시 "더 보기" |

**`SessionCard` 정보 축소**(`SessionCard.tsx:47-98`): 시안 카드(`member-a.html:291-298`)는 `유형(텍스트)·상태 칩 / 제목 / 시각 / 방식 칩 3개 / [입장하기]`. 제거: 클래스 코드 `:63-68`, `N분 · 참여자 n/max` `:70-73`, 상담사 줄 `:93-95`, 유형 색 칩 `:51-55`(→ 텍스트). 약어 치환: `1:N`→`그룹`(`:22`), `LB 필수/선택`→`LINK BAND 필수/선택`, `none` 은 `LINK BAND 사용 안 함` 칩으로 **표시**(`:23,82` — 시안은 3칩 항상 노출, `member-a.html:221-227`). `SessionCard` 의 `Link to=/sessions/{id}`(`:109`) 폴백은 상담사 경로라 회원 카드에서 쓰이지 않음(항상 `onClick` 전달).

**목록 갱신**: 홈과 같은 `useClassList`(재조회 트리거)를 공유. 목록에서 `open` 으로 바뀐 클래스가 "맨 위"로 올라오려면 필수.

### 2.4 신청 모달 (S-M20) → 바텀 시트

- **탭바 가림 원인**: 모달 래퍼 `fixed inset-0 z-50 flex items-end sm:items-center p-4`(`ClientSessionListPage.tsx:451`) — 모바일은 `items-end` 라 하단 버튼이 탭바 영역(`h-14` + 안전영역, `BottomTabBar.tsx:46,66`)에 놓이는데 탭바도 `z-50` 이고 DOM 순서상 뒤(`ClientShell.tsx:259`)라 위로 그려진다. 상담사 쪽 `layout/BottomTabBar.tsx:56` 은 `z-30` 이라 같은 문제가 없다. 같은 `z-50` 사용처: 토스트 `ClientSessionListPage.tsx:300`, 벨 팝오버 `ClientShell.tsx:199`, `MobileDrawer.tsx:37`.
- **재사용 판단**: `PlayerSheet`(`components/class/player/shared/PlayerSheet.tsx`)는 ① `.pz-sheet[data-mode]` 가 `.pz-shell` 그리드의 `grid-column/row` 로 자리를 잡고(`player-shared.css:182-192`) ② 다크 소프트 톤 ③ 사이드 시트 분기(`sheet-mode.ts`, 폭≥1000 가로)를 내장 → **셸형에 쓸 수 없음**. 접근성 로직(포커스 이동·복귀·Esc·바깥 포인터다운 `PlayerSheet.tsx:28-60`)과 `useDialogA11y`(`hooks/useDialogA11y.ts`, 포커스 트랩·Esc·복귀)는 재사용 가능한 선례. 셸형은 시안대로 **전 뷰포트 하단 중앙 바텀 시트**(`member-a.html:103-104` `align-items:flex-end`, `min(100%,640px)`).
- **제안**: `ShellSheet`(포털 `document.body` + 스크림 + `useDialogA11y` + `z-[60]`). 포털 선례 `ClientReportDetailModal.tsx`(`createPortal`+`<dialog>`), `InviteMemberModal.tsx`. `useDialogA11y` 는 `body.overflow` 를 잠그는데 셸 스크롤러는 `ClientShell.tsx:252` 의 div 라 **스크롤 잠금이 실질적으로 안 먹는다** → 시트 열린 동안 스크롤러에 `overflow:hidden` 을 거는 보완 필요.
- **신청 트리거 결합**: 헤더 버튼이 `CustomEvent('open-session-request')`(`ClientAppPage.tsx:343-345`)로 목록 페이지 리스너(`ClientSessionListPage.tsx:85-90`, 마운트 시 클로저 고정)를 부른다. 시안은 홈 빈 상태 CTA 도 같은 시트를 연다(`member-a.html:273`) → 시트를 `ClientAppPage` 로 올리고 컨텍스트/스토어로 연다(이벤트 제거).
- **시안이 보여주는 것**(`member-a.html:321-329`): 제목 `클래스 신청하기`, 문구 "신청 메시지를 상담사에게 보내요. **답을 받으면 알림으로 알려드려요.**", 상담사 라디오 목록(이름 + 전문분야 줄 "임상·최면심리상담"), `신청 메시지 보내기`, `닫기`. **보낸 뒤의 상태 화면은 시안에 없다.** 현행도 토스트뿐(`:230`).
  - 시안 문구가 약속하는 "답 알림"에 해당하는 서버 기능은 없다(`session_request` 처리 0건). 실제로 받을 수 있는 건 상담사가 클래스를 만들어 초대할 때의 `session_invited` 알림(`session_service.py:1318`)과 채팅 답장뿐 → 문구를 사실에 맞게 바꿔야 한다(§5 D4).
  - 시안의 전문분야 줄은 데이터가 없다(§1). 상담사 라디오는 `listChatRooms()` 의 `direct` 방(`ClientSessionListPage.tsx:206-219`)을 상담사로 간주하며, 색상 매핑은 이름 일치(`:478-486`)라 취약 — 시안은 색을 쓰지 않으므로 제거.
  - 현행은 방을 누르는 즉시 전송(`:499`)하지만 시안은 선택 → 전송 2단계(라디오). 방이 없을 때(`:481-485`)·조회 실패(`:469-480`)·전송 중 상태는 시안에 없으므로 시트 내부 상태로 plan 에서 정의.

### 2.5 회원 상세 (FM03)

**DTO 보유**(`ClientSessionDetailPage` 가 쓰는 `SessionDto`, `lib/api/session.ts`): 방식 3종 ✔, `location_address` ✔, `scheduled_at` ✔, `duration_min` ✔, `max_participants`·`participants`(인원) ✔, `started_at/ended_at` ✔, 상담사 이름 ✘(폴백, §1). 현행 화면이 보여주는 것은 유형·제목·상담사·날짜·소요 시간·메모뿐(`:247-280`).

**시안 FM03 요소 → 만드는 방법**(`member-a.html:335-366`)
| 시안 요소 | 데이터 | 비고 |
|---|---|---|
| 방식 칩 3개 | `location_type`·`participant_mode`·`linkband_mode` | 공용 `MethodChips`. 레거시 예약 클래스는 값이 틀릴 수 있음(§4) |
| "시작까지 3일 2시간" 박스 | `scheduled_at − now` | 새 포매터 + 1분 틱. `soon` 구간 문구 필요(시안 없음) |
| 준비물 3줄 | 정적 규칙: 온라인=조용한 곳·이어폰·(밴드 선택/필수 줄 또는 휴대폰 무음), 오프라인=장소(`location_address`)·휴대폰 무음·(밴드 줄 또는 10분 전 도착) (`:335-339`) | 서버 불필요. 문구 원천은 `reminder_service.py:112-130` 과 유사하나 별도 FE 상수 |
| 하단 CTA 1개 | §2.2 | 시안은 `w-foot` 고정 푸터(탭바 위 `:363-364`). `ClientShell` 은 푸터 슬롯이 없어(콘텐츠 `pb-[calc(4rem+…)]` `:252`) `sticky bottom` 컨테이너 또는 `footer` 슬롯 추가 필요 |
| 완료: "50분 진행"·"8명이 함께했어요"·"리포트가 준비됐어요" (`:346-347`) | `started_at/ended_at` ✔ / **참석 인원 ✘**(초대 인원은 `participants.length` — "함께했어요"로 쓰면 오표기) / 리포트 유무는 `listReports()` 로 확인 가능(`ClientReportDetailModal.tsx:32-36`) | 인원 줄은 `초대 N명` 으로 바꾸거나 제외 |
| 취소: 3줄 안내 | 정적 | |
| `리포트 보기` | **모달 유지**(`ClientReportDetailModal`, 포털+`<dialog>`) | 현행은 리포트가 없어도 버튼이 항상 활성이고 눌러야 "리포트를 찾을 수 없습니다"(`ClientReportDetailModal.tsx:41-44`)가 뜸 → 리포트 유무로 활성/문구 분기 권장(프론트만) |

헤더: 시안은 뒤로 버튼 + 중앙 제목 `클래스 상세`(`:255`), 영문 부제 없음. 현행 `ClientShell title="세션 상세" sub="SESSION DETAIL"`(`ClientSessionDetailPage.tsx:215`) 과 `← 세션 목록으로`(`:224`)는 교체 대상.

### 2.6 상담사 목록 (FH01)

**즉시 표 필터**: `SessionListPage.tsx:692-694` 에 `open` 없음 → 열린 클래스가 `listedSessions`(`:695-696`, "전체 목록" 토글에서만 노출 `:786-801`)로 빠져 기본 화면에서 사라진다. 모바일은 같은 누락이 `:614-616` 에 한 번 더 있고, 즉시 표(`:706-713`)와 하단 표(`:610-629`)가 이중이다.

**열린 클래스 상단 카드(`liveCard`, `host-a.html:361-374`)**
| 시안 문구 | 데이터 원천 | 판정 |
|---|---|---|
| `마음챙김 명상 4회차`·칩 `온라인/그룹/LINK BAND 선택` | `title`·DTO 3필드 | 있음 |
| `초대 8명` | `participants.length`(대기열 제외 시 `!is_waitlisted`) | 있음(REST) |
| `입장 3명`·`준비 2명`(`LIVE.open.wait`) | **대기실 presence — WS 전용**(`useWaitingRoomCount`, `readiness.{surveyDone,bandDone,deviceDone}` 전부 true 인 수) | REST 없음 → 프론트 훅(상단 카드 1건만 구독) |
| 진행 중 `12분째`(`:337`) | `started_at` | 있음 |
| 진행 중 `접속 7/8명` | 접속 여부 REST 필드 없음(`live-metrics` 는 활성 참가자 전원 `metrics`, `device_status` 는 밴드 상태라 접속이 아님 `schemas/session.py:342-375`) | **미확인/없음** → 프론트 대체: `12분째 · 초대 8명` |
| 버튼 `이어서 열기`(주)·`시작하기`·`클래스 닫기` | 라우트 `/sessions/:id/player`(`SessionListTable.tsx:113`), `transitionSession(...,'cancel')` | 아래 주의 |

- **훅**: `useWaitingRoomCount({sessionId, enabled: status==='open'})`(`hooks/useWaitingRoomCount.ts:47-141`)는 내부에서 `joinSessionLive`(호스트 룸 join, `:83`)를 호출한다. 목록 페이지에서 쓰면 이후 플레이어 진입 때 같은 세션 join 이 중복 emit 되지 않는지(`joinSessionLive` 의 세션 dedup 주석 `:80-82`)는 구현 시 확인 필요. 서버가 저장하지 않는 값이라 새로고침 직후 ~15초(heartbeat `useWaitingRoomPresence.ts:22`)는 0명으로 보일 수 있다.
- **N개일 때 규칙**: 백엔드는 한 호스트의 동시 `open` 을 막지 않는다(`session_service.py:36-39` 전이 허용 집합에 상호 배타 규칙 없음; 방치 `open` 은 24시간 뒤 자동 취소 `:980-1015`). 제안: 시안과 같이 카드 1장 = `in_progress` 우선 → `opened_at` 최신, 나머지는 목록 최상단 "지금 열려 있어요" 섹션에 일반 행으로(§5 D6).
- **`시작하기` 주의**: 시안 카드의 `시작하기`(`host-a.html:367`)는 목록에서 바로 시작처럼 보이나, 결정 8 은 **시작 전 확인 시트(FH07, 녹음 동의)** 를 요구한다. API 직접 호출(`transitionSession('start')`)이 아니라 플레이어 로비로 이동해 FH07 을 여는 진입(`?start=1` 류)이어야 한다 — 구현 방식은 FH06/07 조사(host-b)와 맞춰야 함.
- **`클래스 닫기`**: 현행은 `window.confirm` 후 `transitionSession(...,'cancel')`(`SessionListTable.tsx:40-53`). 시안 FH04 `close` 시트(`host-a.html:318`)와 같은 확인 시트 컴포넌트를 목록·상세가 공유.

**나머지 항목**
- **캘린더·목록 중복 제거**: 시안 FH01 은 달력·타임그리드 없이 `[예정|지난 클래스]` 탭 + 날짜 섹션(오늘·내일·어제…) 목록뿐(`host-a.html:387-395`). 제거 시 고아: `MonthCalendar`, `CalendarView`, `MobileTimetable`, `DaySchedule`(이미 미사용), 목록의 `SessionListTable`(카드로 교체), `useSessionStore` 의 `viewMode/currentDate`. `CreateSessionModal`(`SessionListPage.tsx:47-511`, 예약 모달)은 FH02 마법사로 대체되며 A2 버그(`:76-88`)도 함께 사라진다(host-b/FH02 조사와 조율).
- **캘린더 색 맵 `open` 누락**(`CalendarView.tsx:55-62`, `MobileTimetable.tsx:28-37`): 캘린더를 존치하면 `open` 추가가 필요하고, 제거하면 해당 없음 → §5 D3 결과에 종속. 어느 쪽이든 `StatusBadge`(`:6-13`)와 같은 색 단일 소스로.
- **좁은 열 표 → 카드**(`SessionListTable.tsx:80-89,144-168` 6열 그리드, 동작열 `10rem` 고정): 시안 행(`itemHTML`, `host-a.html:352-355`)은 `아이콘 + 제목/상태 칩 + 시각·방식 한 줄` 카드 + md 이상에서만 `클래스 열기` 미니 버튼. 코드 열(`:84,148-150`)·복제/닫기 인라인 버튼(`:119-137`)은 제거(복제·삭제는 상세 더보기 시트).
- **지난 클래스 탭**: 서버가 전량 반환(§1)이므로 FE 분할로 충분.
- **`net`(네트워크 끊김) 구현 훅**: `hooks/useBrowserOnline.ts`(공용, 현재 `HostLiveContainer.tsx:105-116`·`MemberClassContainer.tsx:505-510` 2벌 중복을 승격) + 알림 소켓 `wsConnected`(`stores/notificationStore.ts:23,40`, `SidebarNav.tsx:185`) → 둘 중 하나가 끊기면 `fl-banner` 형 배너(`flow-base.css:81`, "연결이 끊겼어요. 다시 연결되면 자동으로 새로 고쳐요.") + **복귀 시 자동 `refreshSessions`**(현재 마운트 1회뿐 `:657-659`). 배너는 레이아웃을 밀지 않는 오버레이(`position:absolute`)여야 한다(시안 계약).

### 2.7 상담사 상세 (FH04)

| 시안 요소 | 현행 | 변경 |
|---|---|---|
| 취소 확인 시트(`cancel`/`close`/`delete`, `host-a.html:312-331`) | 확인 없이 즉시(`SessionDetailPage.tsx:175-187,353-362`), 삭제는 `confirm`(`:191`) | 확인 시트 1종(문구 `n` 인자). **진행 중에는 취소 행 자체를 숨김**(시안은 `ready/scheduled/open` 만 `:436`): `ACTIONS_BY_STATUS.in_progress`(`:38`) 제거. 서버는 `in_progress→cancel` 을 계속 허용(`session_service.py:39`)하므로 FE 가드만으로 충분 |
| 더보기 시트(복제·템플릿 저장·삭제, `:321-325`) | 헤더 우측 버튼 5개, 모바일에서 복제·삭제·템플릿 숨김(`:326-371`) | 헤더 `⋯`(lucide) → 시트. 전 뷰포트 접근 |
| 코드 박스 | `:405-417` | 삭제(+`handleCopyCode :247-256`, `copied` state `:92`). 대신 시안의 `링크 복사`(`host-a.html:432`)는 **회원 상세 딥링크**(`{origin}/app/sessions/{id}`) 복사 — 결정 1 과 일치, 로그인 복귀 처리는 I1 |
| 방식 칩 | 없음(`:418-435`) | `MethodChips`(DTO) |
| 준비 현황·다음 할 일(`NEXT`, `host-a.html:400-407`) | 없음 | 히어로 내 카드 + 주 CTA. `ready/scheduled`→`클래스 열기`(열기 전이면 `클래스 열러 가기` 문구 요구 → 시안은 `클래스 열기`), `open`→`이어서 열기`, `progress`→`이어서 열기`, `completed`→`기록 보기`(`/sessions/{id}/record` 존재 `App.tsx:194`), `cancelled`→`복제해서 만들기`. 이동 = `/sessions/:id/player`(`:343-347` 현행 `입장`과 동일 목적지) |
| 대기 인원 문구 "회원 3명이 대기 중이에요 / 2명은 준비를 마쳤어요" | 없음 | `open` 일 때만 `useWaitingRoomCount`(§2.6 훅) |
| 참여자 이름 | `participantLabel`(`:64-68`) + WS 보정(`toSessionParticipant :71-83`) | **표시 코드 위치는 이 두 곳**. REST 이름 부재(§1)는 I3. 프론트 우회: 호스트 전용 `GET /sessions/{id}/live-metrics`(`lib/api/session.ts:470`) 가 `display_name` 을 모든 비대기 참여자에 채워 준다(서버 `session_service.py:2061-2086` 이름 일괄 조회) |
| 참여자 상태 칩(`초대됨/준비 완료/접속 중/미접속/참여함/불참`, `PST` `:399`) | 초록 점 + 이름뿐(`:491-498`) | 초대됨=기본, 준비 완료/준비 중=대기실 presence(`open`), 접속 중/미접속=**REST 없음**, 참여함/불참=**참석 필드 없음**(§1) → 프론트: `open` 에서만 준비 현황 칩, 그 외 상태는 `초대됨` 만 표시(또는 §3 권장 백엔드) |
| `초대` 버튼(정원 차면 비활성) | `+ 참여자 초대` 인라인 피커(`:477-484,546-571`) | 시안은 `초대` 버튼 유지. 피커를 시트로 옮길지는 시안에 명시 없음(plan 결정). 정원 계산 `max − activeParticipants`(`:551`) 재사용 |
| 정보 행(초대·방식·장소·기록, `host-a.html:431-437`) | 일시/소요/참여자/장소/메모(`:418-463`) | `기록` 행 = `record_audio/record_video`(DTO ✔ `schemas/session.py:171-172`). `장소 수정`(`session-location-editor.tsx`)은 시안 `수정` 버튼으로 유지(`ready/scheduled` 한정 `:450`) |
| 헤더 | `title="세션 상세" sub="DETAIL"`(`:289,310,377-378`), `← 목록으로`(`:390`) | 시안: 뒤로 버튼 + `클래스 상세`, 영문 부제 제거 |
| 삭제 노출 | 모든 상태에서 노출(`:364-371`) | 서버가 상태 검사 없이 미디어까지 삭제(`session_service.py:817-832`) → 진행 중·완료 삭제는 데이터 손실. FE 에서 `open/in_progress/completed` 숨김, 서버 가드는 권장(§3) |
| `net` 케이스 | 없음 | §2.6 훅 재사용 |

### 2.8 셸형에서 진행 화면 언어 쓰기 — 토큰·컴포넌트 설계

**시안 CSS 분류**(`flow-base.css`)
- `fl-*`(`:15-82`): 몰입형(자연 배경·다크 소프트). **셸형에서는 다크 면에서만** 쓰인다 — 상담사 히어로·시트 안 버튼(`host-a.html:363,366,371`의 `fl-chip`·`fl-btn`).
- `sh-*`(`:84-104`): 셸형. `sh-root/side/main/head/scroll/tabbar` 는 **시안이 앱 셸을 흉내 낸 레이아웃**이라 가져오지 않는다(실제 앱은 `ClientShell`·`AppShell` 이 이미 제공 `ClientShell.tsx:209-259`). 가져올 것은 면·칩·버튼: `sh-card`, `sh-hero`, `sh-btn`(+`line`/`mute`/`ghost`), `sh-chip`(+`live`/`ok`/`warn`/`mute`/`dash`/`line`).
- 페이지 전용 `w-*`(`member-a.html:47-120`, `host-a.html:40-109,192-204`)는 컴포넌트로 승격: 히어로 구성(`w-hc/w-hbox/w-hcta/w-hchip`), 카드·행(`w-ccard/w-row/w-item`), 준비물(`w-prep`), 키-값 행(`w-kv`), 참여자 행(`w-p`), 시트(`w-scrim/w-sheet`).

**토큰 충돌 지점**
1. **스코프**: 플레이어 토큰은 `.pz-root` 안에서만 정의(`player-tokens.css:3`). 시안 `sh-*` 는 `:root` 전역 토큰을 가정(`flow-base.css` 가 `../class-player-redesign/tokens.css` import). 라이트 셸에 `.pz-root` 를 씌우면 **글자색이 `--tx-hi`(#F7F4F0)로 바뀐다**(`:62`) → 셸 루트에는 쓰지 말고 **다크 면(히어로·시트)에만** 씌운다.
2. **라이트 전용 토큰은 정의가 없다**: `--ink/--ink-mid/--ink-lo/--shell-bg/--shell-card/--shell-line`·`--sp-1..6`·`--ok/--warn/--warn-bg`(`flow-base.css:6-13`)는 앱 어디에도 없다(`mb-tokens.css`·design-system `tokens.css` 검색 0건 — 이름 충돌 없음, 신규 파일로 정의 가능).
3. **이름 불일치**: 플레이어는 `--mb-purple`(`player-tokens.css:5`), 앱 전역은 `--mb-purple-100`(`mb-tokens.css:17`). `--mb-purple-90/lavender/pale/purple-cream/mint` 는 전역·플레이어 양쪽에 같은 값으로 존재(충돌 없음). 라이트 토큰 블록에서 `--mb-purple` 을 정의해 `sh-*` 를 그대로 옮긴다.
4. **전역 요소 스타일 누수**: `mb-tokens.css:187-230` 의 `h1/h2/h3/p` 가 크기·색(`p` 는 `--mb-fg-muted`)·폰트(`p` 는 Noto)를 지정한다. 클래스 없는 제목·문단이 시안과 다르게 나온다 → `player-shared.css:5-10` 과 같은 방어 규칙(`:is(h1,h2,h3,p){font-family:inherit;letter-spacing:normal}`)을 셸 스코프에도 둔다.
5. **Tailwind**: 프리셋이 `theme.colors` 를 **통째로 교체**(`design-system/build/outputs/tailwind/preset.cjs:116`, 기본 팔레트 → mb 팔레트), `text-sm`=15px 재정의(`tailwind.config.cjs:11-16`). 새 컴포넌트는 Tailwind 색 유틸 대신 **CSS 파일 + 토큰**(SDD-208 선례 `plan.md:53,489`)으로 만들면 충돌이 없다. 클래스 접두어 `sh-`/`fl-` 는 기존 CSS·TSX 에 사용처 0건(검색 확인).
6. **`.mb-btn` 전역**(`mb-tokens.css:256-276`)이 Tailwind 유틸 뒤에 로드되어 `hidden` 이 안 먹는 문제(`SessionDetailPage.tsx:321-323` 주석) — 새 버튼은 `.mb-btn` 을 쓰지 않는다.
7. **z-index**: 클라이언트 탭바·토스트·벨·드로어가 `z-50`. 시트·스크림은 포털 + `z-[60]` 이상.
8. **배경 이미지**: 시안 `assets/bg/background{n}.webp` ↔ 앱 `public/images/background1..10.webp` 존재(`WaitingForStart` 가 사용). 크기 27~438KB(`background6` 438KB, `10` 395KB) — 히어로용으로는 `8`(27KB)·`3`(35KB)·`2`(40KB) 등 가벼운 것 위주로 클래스 id 해시로 고정 선택(랜덤 교체는 깜박임).

**컴포넌트 목록 제안** — `frontend/src/components/class/flow/`
```
flow/
├─ flow-tokens.css        # 라이트 토큰(.fsh-scope: --ink*, --shell-*, --sp-*, --ok/--warn, --mb-purple 등) + 다크 면은 .pz-root 재사용
├─ shell/                 # 셸형 전용(라이트 위)
│  ├─ shell.css           # .sh-card/.sh-hero/.sh-btn/.sh-chip + 요소 방어 규칙
│  ├─ ClassHero.tsx       # 다크 히어로(.pz-root 내부): 칩줄·제목·메타·방식 칩·안내 박스·CTA
│  ├─ ClassCard.tsx       # 목록 카드(유형 텍스트·StatusChip·제목·시각·MethodChips·[입장하기])
│  ├─ ClassRow.tsx        # 한 줄 행(홈 이번 주·상담사 FH01 목록)
│  ├─ KvRow.tsx / ParticipantRow.tsx / PrepList.tsx
│  ├─ StatusChip.tsx      # 파생 키 7종(scheduled·soon·open·live·done·cancelled·invited) + 호스트 ready
│  ├─ MethodChips.tsx     # 온라인/오프라인 · 1:1/그룹 · LINK BAND 사용 안 함/선택/필수 (lucide video·map-pin·users·user·activity)
│  ├─ ActionButton.tsx    # primary/line/mute/ghost/danger, 최소 48px, pill
│  └─ ShellSheet.tsx      # 포털+스크림+useDialogA11y, 하단 중앙 시트, ConfirmSheet 변형(취소/닫기/삭제/더보기)
└─ shared/                # 몰입형과 공용(다른 I번호와 합의 필요)
   └─ NetBanner.tsx, useBrowserOnline.ts(hooks/ 로 승격)
```
`StatusChip`·`MethodChips` 의 라벨은 `lib/session-status.ts`(`SESSION_STATUS_LABELS`)와 신규 `lib/class/class-labels.ts`(방식·밴드 라벨 단일 소스)에서만 가져와, `SessionCard`(`:21-24`)·`StatusBadge`(`:6-13`)·`CalendarView`·`MobileTimetable` 의 중복 맵을 없앤다. 기존 `StatusBadge`/`SessionCard` 는 호출처가 모두 이 SDD 범위(`InvitedSessionCard`·`ClientSessionListPage`)라 교체 후 삭제 가능.

### 2.9 용어 치환 범위 (`세션`→`클래스`) — 현재 기준 수치

**방법**: 테스트 파일(`*.test.*`·`*.spec.*`·`__tests__`)·주석 줄(`//`·`*`·`/*`·`{/*`로 시작) 제외, 문자열·JSX 텍스트·aria-label·식별자 라벨의 줄 수. 줄 수이며 한 줄 여러 회 등장은 1로 센다. **줄 끝 주석(`코드; // …세션…`)은 걸러지지 않아 소수 포함될 수 있다**(게이트 비교용 기준선이므로 같은 스크립트로 전후를 비교할 것). 스크립트 전문은 부록.

| 범위 | `세션` 줄 수 | 파일 수 |
|---|---|---|
| `frontend/src` 전체(비테스트) | **165** | 57 |
| 셸형 범위(§부록 A 23개 파일) | **49** | 9 |
| 사전 흐름 범위(부록 B 24개 파일) | 17 | 6 |

**파일별 상위 20**(전체 기준)
| 줄 | 파일 | 비고 |
|---|---|---|
| 13 | `pages/client/ClientHomePage.tsx` | 셸형(`:96,98,147,149,152,159,181,183,184,547,564,565,571`) |
| 10 | `lib/notification-format.ts` | 알림 센터 라벨(`:12,21-31`) — 회원·상담사 알림 화면 노출 |
| 9 | `pages/design/OperatorAppPage.tsx` | 디자인 쇼케이스(범위 밖) |
| 9 | `pages/client/ClientSessionListPage.tsx` | 셸형 |
| 8 | `pages/sessions/SessionListPage.tsx` | 셸형(+예약 모달 `:93,220,224,232,453`) |
| 7 | `pages/DashboardPage.tsx` | 상담사 대시보드(범위 밖 발견) |
| 6 | `pages/client/ClientSessionDetailPage.tsx` | 셸형 |
| 6 | `components/session/SessionPreJoinPreview.tsx` | 호스트 세팅(몰입형 조사 몫) |
| 6 | `pages/reports/ReportListPage.tsx` | 리포트(범위 밖) |
| 5 | `pages/design/ReportPage.tsx` | 쇼케이스 |
| 5 | `components/chat/RoomSettingsModal.tsx` | 채팅(범위 밖) |
| 4 | `components/layout/SidebarNav.tsx` | `:92,103,115` 라벨 + `:218` **키** |
| 4 | `pages/sessions/SessionCreatePage.tsx` | 몰입형(마법사로 대체) |
| 3 | `pages/sessions/SessionDetailPage.tsx` | 셸형(`:289,310,377`) |
| 3 | `pages/design/DocsPage.tsx` | 쇼케이스 |
| 3 | `components/session/SessionParticipantDetailPanel.tsx` | 호스트 진행 중(범위 밖) |
| 3 | `components/reports/EegQualityBanner.tsx` | 범위 밖 |
| 3 | `components/playground/PlaygroundMeditationPanel.tsx` | 범위 밖 |
| 3 | `components/session/ReportProgressStepper.tsx` | 몰입형(FH09) |
| 3 | `components/reports/ReportDetailView.tsx` | 범위 밖 |

**항목별**
- **내비 라벨**: `SidebarNav.tsx:92`(상담사)·`:103`(org_admin)·`:115`(회원), `components/client/BottomTabBar.tsx:20`, `components/layout/BottomTabBar.tsx:30`. **키 사용 3곳**: `SidebarNav.tsx:218`, `components/client/BottomTabBar.tsx:56`, `components/layout/BottomTabBar.tsx:65` (`label === '세션'` 으로 초대 배지 판정). 라벨 상수화(`NAV_KEY.class`) 없이 문자열만 치환하면 배지 소실. 시안 내비는 `홈·클래스·채팅·리포트·더보기`(회원 `member-a.html:243`), `대시보드·클래스·내담자·채팅·리포트·알림·설정`(상담사 `host-a.html:295`).
- **`document.title`**: 페이지별 설정 코드 **0건**(검색: `document.title|Helmet|useDocumentTitle` → 0). 정적 `index.html:10` 에 `세션` 없음.
- **aria-label**: `세션` 포함 2건 — `SessionListPage.tsx:224`(`세션 생성 닫기`, 예약 모달 → 마법사 교체로 소멸), `ReportListPage.tsx:603`(범위 밖).
- **토스트·오류 문구**: `ClientSessionListPage.tsx:226,230,234`(신청), `SessionListPage.tsx:93`.
- **백엔드 문구**(푸시 콘텐츠는 비범위 — 건수만): `detail=` 에 `세션` 42줄(예: `session_service.py:660,678,1474`), 알림 제목 `title=` 6줄(`:365`×2·`:810`·`:823`·`:1318`·`:1363`) + 상태 전이 알림 `_action_title` 4건(`:960-965`), 본문 폴백 `or "세션"` 8줄(예: `:366,1319`). 백엔드 테스트가 이 문구를 단언하는지 검색(`backend/tests` — `세션을 찾을|세션에 초대|새 세션|세션이 취소|세션 정보가|세션에서 제외`) → **0건**(변경 시 테스트 회귀 없음). 회원 알림 화면에 그대로 노출되는 문구라 푸시와 분리해 다룰지는 §5 D9.
- **라우트·URL 슬러그**: `/app/sessions`·`/sessions` 참조 FE 92곳(`/app/sessions` 23 + `/sessions` 비-API 69), 백엔드가 만드는 딥링크 `agent_service.py:504`(`/app/sessions/{id}`)·`agent_briefing.py:360`(`/sessions/{id}`), 알림 해석기 `notifications.ts:154-157`, e2e·네이티브 푸시 payload. **URL 은 유지 권장**(사용자에게 URL 은 거의 보이지 않고, 바꾸면 알림·이메일·북마크·e2e 가 깨짐). 필요하면 별칭 라우트만 추가.
- **금지 용어 현황(셸형 23개 파일, 줄 수)**: `세션` 49 · `수업` 4(`SessionListPage.tsx`·`ClientSessionDetailPage.tsx`·`SessionDetailPage.tsx`·`SessionCard.tsx`) · `오픈` 2(`SessionDetailPage.tsx`·`SessionListTable.tsx`) · `참여하기` 0 · `\bLB\b` 1 · `1:N` 1(`SessionCard.tsx:22-23`) · 영문 대문자 부제 `sub=` 10(`ClientAppPage.tsx:306,314,317,320,323`, `ClientSessionDetailPage.tsx:215`, `SessionListPage.tsx:703`, `SessionDetailPage.tsx:289,310,378`) · 참여코드/클래스 코드/`access_code` 25줄.
- **영문 부제 렌더 위치**: `ClientShell.tsx:164,239`·`AppShell.tsx:141,216`(`font-mono uppercase`). 전체 `sub=` 대문자 32건(셸형 10, 사전 흐름 `SessionCreatePage.tsx:202,267` 2, 나머지 20은 리포트·관리자·기관 등 범위 밖). 홈은 한글 날짜 부제를 쓴다(`ClientAppPage.tsx:23-32,311`). 범위 밖 20건은 `범위 밖 발견`.
- **12px 미만 글자(셸 크롬)**: `text-[8..11px]` 10줄(`AppShell.tsx` 3·`ClientShell.tsx` 3·`SidebarNav.tsx` 2·`components/client/BottomTabBar.tsx` 1·`components/layout/BottomTabBar.tsx` 1 — 배지·닫기 글리프). 완료 기준 "12px 미만 0"에 걸리는 공용 셸 파일이므로 셸 변경 범위에 포함 여부 확인 필요.

### 2.10 이모지·문자 글리프 현재 기준선

범위 = 셸형 23개 + 사전 흐름 24개(부록 A·B). 주석 줄 제외, 개수(출현 횟수).

| 범주 | 셸형 | 사전 흐름 | 합계 |
|---|---|---|---|
| 이모지(`U+1F300-1FAFF`,`U+2600-26FF` 등) | 1 | 20 | **21** |
| 딩뱃(`✓ ✔ ✕ ✖ ✗ ✘ ✧`) | 3 | 8 | **11** |
| 화살표(`→ ←` U+2190-21FF) | 7(1건은 줄 끝 주석 `ClientAppPage.tsx:128`) | 1 | **8** |
| 꺾쇠(`‹ ›`) | 13 | 0 | **13** |
| 도형(`● ○ ■ ▲` U+25A0-25FF) | 0 | 3 | **3** |
| `×`(U+00D7) | 1 | 0 | **1** |
| 가운뎃점 `·`(참고 — 시안도 텍스트 구분자로 사용) | 13 | 48 | 61 |

셸형 상세: 이모지 `ClientHomePage.tsx:562`(📅) · 딩뱃 `ClientShell.tsx`·`AppShell.tsx`·`SessionListPage.tsx:227`(✕) · 화살표 `ClientHomePage.tsx` 4(`:135`×2·`:159`·`:201`)·`ClientAppPage.tsx` 1(`:128` 줄 끝 주석)·`SessionDetailPage.tsx:390`·`ClientSessionDetailPage.tsx:224` · 꺾쇠 `ClientHomePage.tsx` 5(`:464,501,595,615,661`)·`SessionListPage.tsx` 4(`:586,595,828,839`)·`ClientSessionListPage.tsx` 2(`:421,432`)·`MonthCalendar.tsx` 2 · `×` `ParticipantPicker.tsx:145`. 사전 흐름 상세: `SessionPreJoinPreview.tsx` 12·`SpeakingRightsPanel.tsx` 4·`LobbyBgmBar.tsx` 2·`ClassWaitingRoom.tsx` 2(이모지), `ClassWaitingRoom.tsx` 4·`waiting-room-readiness-panel.tsx` 2·`PreCheckinPanel.tsx` 1·`ReportProgressStepper.tsx` 1(딩뱃).

게이트 목표값(시안 계약 "이모지·문자 글리프 아이콘 0")은 `·`(구분자) 제외 5범주 모두 0. `aria-hidden` 글리프도 센다(현행 `→ ›` 대부분이 `aria-hidden`이지만 아이콘 역할이므로 lucide 로 교체 대상).

---

## 3. 변경 목록

### 프론트

| 파일 | 변경 | 규모 |
|---|---|---|
| `components/class/flow/flow-tokens.css`·`shell/shell.css` (신규) | 라이트 토큰 + `sh-*` 이식 + 요소 방어 규칙 | M |
| `components/class/flow/shell/{ClassHero,ClassCard,ClassRow,StatusChip,MethodChips,ActionButton,KvRow,ParticipantRow,PrepList,ShellSheet}.tsx` (신규) | §2.8 컴포넌트 | L |
| `lib/class/class-labels.ts`·`enter-action.ts`·`pick-hero-class.ts`·`class-when.ts` (신규) + vitest | 라벨 단일 소스·입장 판정·히어로 선정·상대 날짜/D-day/남은 시간 포매터 | M |
| `hooks/useEnterClass.ts`·`useClassList.ts`·`useNow.ts`·`useBrowserOnline.ts` (신규) | 단일 진입·공용 목록 로드(30초 폴링/포커스/알림 트리거)·1분 틱·온라인 상태 | M |
| `pages/client/ClientHomePage.tsx` | 히어로 재작성(4상태+빈), 코드 칩·복사·타일 제거(§2.1 줄 범위), `isLive` 제거, 이번 주 배지, 이모지·글리프 → lucide | L |
| `pages/client/ClientSessionListPage.tsx` | 단일 트리 4섹션, 달력·타임라인 제거, 신청 모달 제거(시트로 이전), 약어·글리프 제거 | L |
| `pages/client/ClientSessionDetailPage.tsx` | 히어로+준비물+고정 CTA, `access_code`·`/join` 제거, 영문 부제·`←` 제거, 리포트 유무 분기 | M |
| `pages/client/ClientAppPage.tsx` | 시트 상태 상향·`CustomEvent` 제거, 타이틀 `클래스`, 영문 부제 제거, 헤더 `+ 클래스 신청`, 입장 라우트 등록(I1) | M |
| `components/client/ClientShell.tsx`·`components/layout/AppShell.tsx` | `sub` 영문 렌더 정리(`:164,239`/`:141,216`), 푸터 슬롯(고정 CTA), 12px 미만 요소 | M |
| `components/client/BottomTabBar.tsx`·`components/layout/BottomTabBar.tsx`·`components/layout/SidebarNav.tsx` | 라벨 `클래스` + **배지 키 상수화**(`:56`/`:65`/`:218`) | S |
| `components/client/InvitedSessionCard.tsx`·`components/session/SessionCard.tsx`·`StatusBadge.tsx` | `ClassCard`/`StatusChip` 으로 교체 후 삭제 | M |
| `lib/class/reminder.ts` | `pickUpcomingClass`·`formatCountdown` 유지(테스트 고정) 또는 테스트와 함께 이전, 힌트 문구 `참여코드` 제거(`:19`) | S |
| `lib/api/notifications.ts`·`ClientShell.tsx:94`·`ClientNotificationPage.tsx:46` | 입장 단축 분기(D8) | S |
| `pages/sessions/SessionListPage.tsx` | 열린 클래스 상단 카드 + 예정/지난 탭 + 카드 목록, 즉시 표·이중 모바일 표·달력·타임라인·`CreateSessionModal` 제거, 자동 재조회·`net` 배너 | L |
| `components/session/SessionListTable.tsx` | 카드 행으로 교체(코드 열·`window.confirm`·인라인 복제/닫기 제거) | M |
| `pages/sessions/SessionDetailPage.tsx` | 히어로·다음 할 일·정보 행·참여자 행(이름·상태), 취소/닫기/삭제 확인 시트, 더보기 시트, 코드 박스 제거, 진행 중 취소 숨김, 삭제 상태 가드, `링크 복사`, `net` 배너 | L |
| `components/session/{MonthCalendar,CalendarView,MobileTimetable,DaySchedule}.tsx` | D3 결과에 따라 삭제(또는 존치 시 `open` 색 추가) | S |
| `tests/session-reminder.test.ts`, `e2e/journeys.mjs:59-62`, `e2e/class-player/live.mjs` | 문구·경로 단언 갱신(`예약 만들기`·`즉시 클래스`·`전체 목록` 등) | S |

### 백엔드

| 엔드포인트/모델 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 |
|---|---|---|---|---|
| `SessionResponse`(`schemas/session.py:146`)·`_serialize`(`session_service.py:85`) | `host_name: str \| None` 추가(회원이 연결되지 않은 상담사 클래스도 이름 표시, FM05 요약 `진행` 줄 포함) | **권장** | 신규 옵셔널 필드 — 호환 | `tests/test_session.py` 계열에 응답 필드·참여자 조회 권한 케이스 |
| `ParticipantInfo`(`schemas/session.py:123`)·`_serialize` | `user_name`(및 선택 `user_email`) 추가 — `session_service.py:2061-2086` 의 이름 일괄 조회 패턴 재사용. **I3 가 원인·방식 확정**(여기서는 FH04 요구만 기록) | **권장** | 옵셔널 필드 | PII 가드: 비호스트 응답에서는 이메일 제외(`include_participant_pii` 패턴 `:128-131`) |
| `delete_session`(`session_service.py:817`) | `in_progress`/`completed`(리포트·미디어 보유) 삭제 거부 또는 `ready/scheduled/cancelled` 한정 | **권장** | 기존 행 삭제 정책만 변경, 데이터 변경 없음 | 상태별 삭제 허용/거부 테스트 |
| 레거시 예약 데이터 보정(`SessionListPage.tsx:76-88` 이 만든 행) | `notes` 가 `[온라인]` 으로 시작하고 `location_type='offline'` 인 행을 보정하는 1회성 스크립트(또는 FE 가 태그를 읽어 표시) | **권장**(데이터 위생) | **기존 행 수정** — 스크립트는 dry-run·로그 필수, 삭제 금지. 프론트 대체: 표시 시 `notes` 접두 태그 폴백 | 보정 로직 단위 테스트 |
| 대기실 인원·준비 현황 REST 노출 | (서버 미저장 구조 — 구현하려면 Redis 등 신규 저장 필요) | **보류** | — | 프론트 대체: `useWaitingRoomCount` 를 상단 카드 1건에만 구독 |
| 참석 여부(`attended`) | `joined_at` 의미 확정(`models/session.py:112` 기본값 `now()`) 또는 입장 시점 기록 컬럼 | **보류** | 과거 행은 알 수 없음 → 완료 상세에 "참석" 단정 금지 | 프론트 대체: 완료 상세는 `초대 N명` 만 |
| 클래스 신청 엔티티(`session_request`) 상태·응답 알림 | 신청 목록·승인/거절·알림 | **보류** | — | 프론트 대체: 시트 문구를 현 동작(메시지 전송 + 상담사가 초대 시 알림)에 맞춤 |
| `GET /sessions` 페이지네이션 사용 | 서버는 `page/limit` 지원(`api/v1/session.py:50-61`) — 필요 시 FE 가 사용 | **보류** | — | 프론트 대체: 전량 로드 후 지난 클래스 20건 슬라이스 |
| 회원용 `CounselorInfo.specialties`(`schemas/client.py:64`) | 신청 시트·홈 전문분야 줄 | **보류** | — | 프론트 대체: 줄 제거(또는 `org_name`) |
| 알림 템플릿 문구 `세션`→`클래스`(`session_service.py:365,810,823,960-965,1318,1363`) | 문구 치환(푸시와 동일 문자열) | **보류**(§5 D9) | 이미 저장된 알림 행은 옛 문구 유지 | 테스트 단언 0건이라 회귀 없음 |

필수 0 · 권장 4 · 보류 6.

### 프론트만으로 가능한 대체안(요약)
- 호스트 이름 → `user.counselors` + 폴백 문구 `진행자`(현행 `'상담사'` 폴백은 이름 없이 직함만 보임).
- 참여자 이름 → `GET /sessions/{id}/live-metrics` 1회 조회의 `display_name` 으로 매핑(호스트 전용 엔드포인트, `lib/api/session.ts:470`).
- 대기실 인원·준비 현황 → `useWaitingRoomCount`(상단 카드·`open` 상세 한정).
- 진행 중 접속 인원 → 표시하지 않고 `12분째 · 초대 N명`.
- 상담사 상세 참여자 상태 → `open` 에서만 준비 현황 칩, 그 외 `초대됨`.
- 완료 상세 인원 → `초대 N명`.
- 레거시 예약 방식 → `notes` 접두 `[온라인]/[오프라인]` 폴백 표시.

---

## 4. 위험·주의

1. **레거시 방식 오표기**: 예약 모달로 만든 기존 클래스는 서버 기본값(오프라인·1:1·밴드 사용 안 함)으로 저장돼 있어(§1) 새 칩 3개가 **틀린 정보**를 보여 줄 수 있다. 회원이 "오프라인" 클래스로 보고 이동하는 사고 가능 → 보정 또는 FE 폴백 필수.
2. **초대 배지 소실**: 내비 라벨 치환 시 `label === '세션'` 키 비교 3곳 동기화(§2.9).
3. **시작하기 우회**: 목록 카드 `시작하기` 가 확인 시트를 건너뛰면 결정 8(시작 전 녹음 동의 확인) 위반.
4. **삭제 데이터 손실**: 서버 가드 없음(`session_service.py:817-832`). FE 숨김만으로는 API 직접 호출을 못 막는다.
5. **캘린더 제거 회귀**: 상담사가 주간 타임그리드로 일정 충돌을 눈으로 확인하던 흐름이 사라진다(서버는 충돌을 409 로 막음 `session_service.py:289,536,721`). e2e `journeys.mjs:59-62` 가 `예약 만들기·즉시 클래스·전체 목록` 텍스트를 단언.
6. **WS join 부수효과**: 목록에서 `useWaitingRoomCount` 가 호스트 룸 join(`useWaitingRoomCount.ts:83`) — 플레이어 진입과의 중복·`getActiveSessionLiveSocket` 공유 여부 구현 시 확인.
7. **presence 지연**: 대기 인원은 15초 heartbeat·45초 TTL(`useWaitingRoomCount.ts:19`, `useWaitingRoomPresence.ts:22`)이라 새로고침 직후 0명 → "대기실이 비어 있어요" 오안내 가능(문구는 단정 대신 "아직 입장한 회원이 없어요").
8. **배포 순서**: 프론트 단독 배포 가능(백엔드 권장 4건은 모두 옵셔널 필드/가드). 단 `host_name`·`user_name` 은 **백엔드 먼저** 배포해야 프론트가 그 필드를 우선 사용하도록 분기할 수 있다(없으면 폴백).
9. **`useDialogA11y` 스크롤 잠금**: 셸 스크롤러(`ClientShell.tsx:252`)가 body 가 아니어서 시트 뒤 스크롤이 계속된다.
10. **TanStack Query 미설치**: 기획·CLAUDE.md 는 사용을 가정하나 코드에 없다. 공용 로딩 훅을 직접 짜야 하며, 이 선택은 다른 조사(I번호)의 데이터 훅 설계와 맞춰야 한다.

---

## 5. 사용자 결정 필요 (비즈니스·정책)

| # | 결정 | 옵션 | 기본값 제안 | 영향 |
|---|---|---|---|---|
| D1 | 홈 보조 섹션 존폐(요약 타일·내 리포트·담당 상담사·최근 대화·새 알림) — 시안 홈은 히어로 + 이번 주 클래스뿐 | ① 시안대로 삭제 ② 히어로·이번 주 클래스를 시안으로 바꾸고 리포트·대화·알림 카드는 `sh-card` 로 재스타일해 유지, 타일·담당 상담사(하드코딩)만 삭제 | ② | ①은 리포트·대화 진입점이 홈에서 사라짐(탭으로만 접근). ②는 시안과 다른 홈 |
| D2 | `곧 열림` 임계와 FM03 반영 | 시작 N분 전부터 `soon`: 30/60/120분. 상세에도 `입장 대기하기` 적용 여부 | 60분, 상세도 동일 판정 | 시안 FM03 에는 `soon` 상태가 없음 → 목업 추가 필요 가능 |
| D3 | 캘린더·타임라인(회원·상담사 목록) | ① 시안대로 제거 ② 보조 `달력` 탭으로 존치 | ① | ①: 코드 정리 크나 상담사 일정 한눈 보기 상실. ②: 이중 렌더 재도입 위험, `open` 색 보정 필요 |
| D4 | 클래스 신청 문구·상태 | ① 시안 문구("답을 받으면 알림") 유지 + 백엔드 신청 상태 신설 ② 문구를 현 동작에 맞춤("상담사가 클래스를 만들면 알림으로 알려드려요") | ② | ①은 백엔드 신규 기능(보류 항목) |
| D5 | 셸 위 시트 톤(시안 불일치) + `시작하기` 진입 | 시트: ① 다크 소프트(상담사 시안 5종과 일치, 진행·몰입 화면과 동일) ② 라이트(회원 시안 1종). 목록 `시작하기`: 플레이어 로비로 이동해 FH07 | ① 다크, 로비 이동 | ①이면 회원 신청 시트 시안 수정 필요 |
| D6 | 열린 클래스 N개 규칙 | 카드 1장 + 나머지 목록 최상단 / 카드 N장 스택 | 1장 + 나머지 행 | 서버가 동시 `open` 을 막지 않음 |
| D7 | 삭제 정책 | `ready/scheduled/cancelled` 만 / 완료 포함 / 서버 가드 | `ready/scheduled/cancelled` 만, 서버 가드 | 완료 클래스는 삭제 불가가 됨(리포트 보호) |
| D8 | 알림 입장 단축 | 모든 클래스 알림→상세 / `session_opened·started` 만 FM05 직행 | 후자 | 알림 문구가 `입장` 의미일 때만 클릭 1회 절감 |
| D9 | 알림 템플릿 문구 `세션`→`클래스`(백엔드) | 변경 / 푸시와 분리 / 비범위 유지 | 변경(동일 문자열, 푸시도 함께) | spec 은 푸시 콘텐츠 비범위 — 푸시·인앱이 같은 문자열을 공유 |

(`결정 충돌`: 확정 8결정과 직접 충돌 없음. 다만 시안 `시작하기` 직결 표현과 결정 8, 시안 내 시트 톤 불일치는 위 D5 로 올림.)

---

## 6. 확인하지 못한 것

1. **참석 여부 필드의 실제 의미** — `session_participants.joined_at` 이 초대 시각인지 입장 시각인지. 모델 기본값은 `now()`(`models/session.py:112`)이나 마이그레이션 이력이 `drop_column`(`881a08fbe584...py:107`)·`add`(`30c1bfbc724f...py:27`)로 엇갈려 운영 DB 확인 불가.
2. **진행 중 "접속 N/M명"의 REST 원천** — 접속 여부를 나타내는 필드를 찾지 못함(LiveKit 참가자 수나 WS 스냅샷이 후보, 코드로 확인 안 함).
3. **`useWaitingRoomCount` 를 목록 페이지에서 쓸 때 소켓 join 중복 영향** — 호출 구조만 읽음, 실행 검증 안 함.
4. **실제 브라우저 렌더·z-index 겹침**: 코드 읽기 근거만(S-M20 탭바 가림은 survey 실측 `회원-화면조사.md:146` 에 의존). 시안·구현 비교는 하지 않음.
5. **레거시 예약 클래스 수**: 운영/dev DB 조회 없음 — `[온라인]` 태그 행이 몇 건인지 미확인.
6. **세션 상세 `SessionPreJoinPreview` 의 영문 아이브로우(`PRE-JOIN PREVIEW`)**: survey 는 `:297-298` 를 지목하나 이번 grep(`PRE-JOIN|A MOMENT|…`)에서 해당 파일 결과가 없었음(세팅·몰입형 조사 몫).
7. **Tailwind 프리셋 `theme.colors` 교체의 정확한 줄 범위**: `preset.cjs:2-4` 주석과 `:116` 이후 일부만 확인(전체 파일 미정독).
8. **알림 센터 호스트 경로** `NotificationCenterPage.tsx:75` 의 입장 단축 적용 여부(상담사 알림은 입장 개념이 달라 시안 없음).

### 범위 밖 발견
1. **홈 "임상·최면심리상담 전문" 하드코딩**(`ClientHomePage.tsx:604`) — spec 범위 밖(담당 상담사 카드), D1 결과에 따라 삭제/유지.
2. **이메일 리마인더가 참여코드·`/join` 입력을 안내**(`services/reminder_service.py:139-153,167`) — 결정 1(코드 전면 제거)과 충돌. I1/A7 소관, 푸시 콘텐츠가 아니라 이메일이므로 비범위로 둘 수 없을 가능성 → 확인 요청.
3. **리마인더 옵션 안내문 "참여코드·준비물을 안내합니다"**(`lib/class/reminder.ts:19`) — 상담사 생성 폼(몰입형 FH02c 조사)과 함께 문구 정리.
4. **`GET /client/home`·`NextSessionInfo`**(`api/v1/client_portal.py:213`, `schemas/client.py:74`)는 프론트 사용처 0건 — 죽은 API(정리 후보).
5. **`sub` 영문 부제 20건**(리포트·관리자·기관·채팅 등 비클래스 화면, 예: `ReportListPage.tsx:521`, `NotificationCenterPage.tsx:119`)과 클래스 외 화면의 `세션` 문구(`DashboardPage.tsx` 7, `ReportListPage.tsx` 6 등) — 이번 SDD 범위 밖, 공용 `sub` 렌더를 바꾸면 영향이 퍼지므로 클래스 화면에서만 `sub` 를 제거하는 방식 권장.
6. **`ClientAppPage.tsx` 주석과 실제 불일치**: "ClientShell 없이 풀스크린"(`ClientAppPage.tsx:298`)이라 쓰였으나 상세 페이지가 자체 `ClientShell` 을 렌더(`ClientSessionDetailPage.tsx:215`).
7. **`useDialogA11y` 스크롤 잠금 무효**(§4-9) — 다른 모달에도 동일.

---

## 부록 — 게이트 기준선 재현 명령

기준: 2026-10-17, develop `32fa5533` + 미커밋 변경. 모든 명령은 `frontend/src` 에서 실행. 주석 줄 제외는 첫 비공백 토큰이 `//`·`*`·`/*`·`{/*` 인 줄. (BSD grep 은 `-P` 불가 → 한글·유니코드 범주는 `perl`.)

**A. 셸형 범위 23개 파일** (`/tmp/i8_scope.txt` 내용)
```
pages/client/ClientHomePage.tsx            pages/client/ClientSessionListPage.tsx     pages/client/ClientSessionDetailPage.tsx
pages/client/ClientAppPage.tsx             components/client/InvitedSessionCard.tsx   components/client/BottomTabBar.tsx
components/client/ClientShell.tsx          components/session/SessionCard.tsx         components/session/StatusBadge.tsx
components/session/MonthCalendar.tsx       components/session/CalendarView.tsx        components/session/MobileTimetable.tsx
lib/session-status.ts                      lib/class/reminder.ts                      pages/sessions/SessionListPage.tsx
pages/sessions/SessionDetailPage.tsx       components/session/SessionListTable.tsx    components/session/session-location-editor.tsx
components/session/ParticipantPicker.tsx   components/layout/SidebarNav.tsx           components/layout/BottomTabBar.tsx
components/layout/AppShell.tsx             components/layout/MobileDrawer.tsx
```
**B. 사전 흐름 범위 24개 파일** (`/tmp/i8_preflow.txt`)
```
pages/class-join-page.tsx                  pages/sessions/SessionCreatePage.tsx       components/class/ClassWaitingRoom.tsx
components/class/WaitingForStart.tsx       components/class/WaitingRoomBandCheck.tsx  components/class/PreCheckinPanel.tsx
components/class/SelfCheckinPanel.tsx      components/class/ReportEmailRequestPanel.tsx components/class/LobbyBgmBar.tsx
components/class/waiting-room-readiness-panel.tsx components/class/WaitingRoomCheckinList.tsx components/class/CheckinSummary.tsx
components/class/SensorTracker.tsx         components/class/waiting-room-reminder.tsx components/class/LeadOffModal.tsx
components/session/SessionPreJoinPreview.tsx components/session/SpeakingRightsPanel.tsx components/session/ConsentModal.tsx
components/session/ReportProgressStepper.tsx components/session/SessionCodeBanner.tsx components/player/LeaveGuardModal.tsx
components/player/EndSessionModal.tsx      components/player/MemberEndScene.tsx       components/player/MemberWaitingScene.tsx
```
전체 비테스트 파일 목록(431개): `find . \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' ! -name '*.spec.*' ! -path '*/__tests__/*' ! -path '*/node_modules/*' | sed 's|^\./||' | sort`

**C. 용어 줄 수 카운터** (`/tmp/i8_count.pl`)
```perl
use strict; use warnings; use utf8; binmode(STDOUT, ':utf8');
my ($pat, @files) = @ARGV; utf8::decode($pat); my $re = qr/$pat/; my ($total, %per) = (0);
for my $f (@files) {
  open(my $fh, '<:encoding(UTF-8)', $f) or next; my ($inblock, $n) = (0, 0);
  while (my $l = <$fh>) {
    my $t = $l; $t =~ s/^\s+//;
    if ($inblock) { $inblock = 0 if $t =~ m{\*/}; next; }
    if ($t =~ m{^/\*}) { $inblock = 1 unless $t =~ m{\*/}; next; }
    next if $t =~ m{^(//|\*|\{/\*)};
    $n++ if $l =~ $re;
  }
  close $fh; if ($n) { $per{$f} = $n; $total += $n; }
}
print "TOTAL=$total\n"; print "  $per{$_}\t$_\n" for sort { $per{$b} <=> $per{$a} } keys %per;
```
실행 예 및 **현재 수치**
```
perl i8_count.pl '세션' $(cat i8_all.txt)                         # TOTAL=165 (57 files)
perl i8_count.pl '세션' $(cat i8_scope.txt)                       # TOTAL=49  (셸형)
perl i8_count.pl '세션' $(cat i8_preflow.txt)                     # TOTAL=17  (사전 흐름)
perl i8_count.pl '수업' $(cat i8_scope.txt)                       # 4
perl i8_count.pl '오픈' $(cat i8_scope.txt)                       # 2
perl i8_count.pl '참여하기' $(cat i8_scope.txt)                   # 0
perl i8_count.pl '\bLB\b' $(cat i8_scope.txt)                     # 1
perl i8_count.pl '1:N' $(cat i8_scope.txt)                        # 1
perl i8_count.pl '클래스 코드|참여코드|참여 코드|세션코드|access_code' $(cat i8_scope.txt)   # 25
perl i8_count.pl 'text-\[(8|9|10|11)px\]|text-mb-8|font-size:\s*(8|9|10|11)px' $(cat i8_scope.txt)   # 10
```
영문 대문자 부제(`sub` 슬롯):
```
grep -rnE "sub=\"[A-Z][A-Z /·-]+\"|shellSub(: string \| undefined)? = '[A-Z]" . --include='*.tsx' --include='*.ts' --exclude='*.test.*' | wc -l   # 32 (전체)
grep -nE  "sub=\"[A-Z][A-Z /·-]+\"|shellSub(: string \| undefined)? = '[A-Z]" $(cat i8_scope.txt) | wc -l                                              # 10 (셸형)
```
(영문 대문자 문자열 일반형 `["'>`][A-Z][A-Z0-9 ·/-]{3,}["'<`]` 은 SVG path·`D-DAY`·`NOW` 등 오탐이 섞여 게이트에는 쓰지 않는다. `ClientHomePage.tsx:290,293` 의 `NOW`·`D-DAY` 는 별도로 0 이어야 함.)

**D. 이모지·문자 글리프 카운터** (`/tmp/i8_glyph.pl`) — 범주별 정규식
```perl
emoji   => qr/[\x{1F300}-\x{1FAFF}\x{2600}-\x{26FF}\x{2B50}\x{2B55}\x{2705}\x{274C}\x{2728}]/,
dingbat => qr/[\x{2713}\x{2714}\x{2715}\x{2716}\x{2717}\x{2718}\x{2727}]/,   # ✓ ✔ ✕ ✖ ✗ ✘ ✧
arrow   => qr/[\x{2190}-\x{21FF}]/,  chevron => qr/[\x{2039}\x{203A}]/,       # → ←  /  ‹ ›
shape   => qr/[\x{25A0}-\x{25FF}]/,  times   => qr/\x{00D7}/,  middot => qr/\x{00B7}/
```
(주석 줄 제외 로직은 C 와 동일, 범주마다 줄이 아니라 **출현 횟수**를 센다.) 현재: 셸형 emoji 1·dingbat 3·arrow 7·chevron 13·shape 0·times 1 / 사전 흐름 emoji 20·dingbat 8·arrow 1·chevron 0·shape 3·times 0 / 합 emoji 21·dingbat 11·arrow 8·chevron 13·shape 3·times 1 (middot 61 은 참고).

**E. 백엔드 문구**
```
cd backend/app
grep -rnE "detail=.*세션" --include='*.py' . | grep -vE ':\s*#' | wc -l              # 42
grep -rnE "title=.*(세션|수업|오픈)" --include='*.py' . | grep -vE ':\s*#' | wc -l   # 6  (+ session_service.py:960-965 _action_title 4건은 title= 형식이 아니라 별도)
grep -rnE 'or "세션"' --include='*.py' . | wc -l                                      # 8
grep -rlE "세션을 찾을|세션에 초대|새 세션|세션이 취소|세션 정보가|세션에서 제외" ../tests | wc -l   # 0 (테스트 단언 없음)
```
**F. URL 슬러그 참조**
```
grep -rn "/app/sessions" frontend/src frontend/e2e frontend/tests --include='*.ts' --include='*.tsx' --include='*.mjs' | wc -l   # 23
grep -rnE "['\"\`](/app)?/sessions(/|['\"\`])" frontend/src --include='*.ts' --include='*.tsx' | grep -v "lib/api/" | wc -l      # 69
```
