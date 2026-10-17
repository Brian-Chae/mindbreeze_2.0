# I1 입장 모델 제거(A7) — 코드 조사

> 기준: develop `32fa5533`, 조사일 2026-10-17. 읽기 전용 조사(코드 열람·grep). 실행 검증(서버 기동·테스트 실행)은 하지 않았다 — 그런 항목은 "코드 읽기로 확인"이라고 표기한다.
> 경로 표기: 프론트 `frontend/src/` 기준, 백엔드 `backend/app/` 기준, 그 밖(`tests/`, `e2e/`, `.github/`, `docs/`)은 저장소 루트 기준.

## 0. 한 줄 결론

- 회원은 이미 "초대받은 참가자 행(`SessionParticipant`)"을 갖고 있어서(생성 시 `participant_ids` 또는 `invite`), 코드 없이 입장하려면 서버에 **회원 전용 입장 엔드포인트와 세션 id 기반 LiveKit 토큰**이 필요하다. 현행 회원용 LiveKit 토큰과 참가자 생성·동의 기록(`consent_eeg=True`)은 `by-code` 경로에만 있다. (필수 백엔드 변경 3건)
- `/join` 코드 경로는 단일 페이지(`class-join-page.tsx`, 767줄)가 5개 step 으로 다 처리한다. 신규 흐름은 **한 개 오케스트레이터 페이지 + 라우트 `/app/sessions/:id/enter`** 로 대체한다(준비~대기 사이 BLE·미리보기 상태를 보존해야 해서 단계별 라우트 분리는 비권장).
- 프론트만으로 가능한 최소안은 있다(상세의 `access_code` 를 숨은 키로 써서 by-code 호출 유지). 하지만 **비초대 회원이 코드로 자가 참여하는 구멍**과 코드 노출이 그대로 남아 "초대 방식" 결정(결정 1)을 서버가 강제하지 못한다. 권장은 **2단계 제거**(① 신규 엔드포인트 추가 + 프론트 전환, 구 엔드포인트 유지 ② 유예 후 게스트·비초대 차단 → 410/404).
- 클라이언트 로그인 복귀(returnTo)는 **현재 구현돼 있지 않다**(`RoleGuard`·`LoginPage`·`resolvePostLoginPath` 모두 client 에서 `next` 무시). "클래스 링크 = 로그인 필요한 상세 딥링크"(결정 1)를 지키려면 프론트 변경이 필요하다.
- 푸시 딥링크는 `/join` 을 쓰지 않는다(화이트리스트가 `/app`·`/chat`·`/agent` 만 허용). `/join?code=` 를 만드는 곳은 프론트 2곳(상세 버튼, AI 비서 CTA)뿐이고, 메일(리마인더)은 `/join` + 본문에 코드 텍스트를 넣는다. 외부로 퍼진 `?code=` 링크는 코드상 생성 경로가 없다.

## 1. 현재 코드 상태 (판정표)

판정: 있음 = 그대로 재사용 가능 / 일부 = 있으나 수정 필요 / 없음 = 신규.

| 항목 | 판정 | 근거 |
|---|---|---|
| 회원 입장 확인 페이지(FM05) | 없음 | `pages/class-join-page.tsx:598-646` 의 `details` step 이 유사(로그인 회원은 자동 join) |
| 사전 확인 마법사(FM06) | 일부 | `ClassWaitingRoom.tsx`(656줄) 3단 탭(설문·밴드·기기) + 닉네임 게이트(`:112-131`,`:320-336`) — 동의 단계 없음 |
| 시작 대기(FM07) | 일부 | 같은 `ClassWaitingRoom` 안에 통합(`components/player/MemberWaitingScene.tsx:1-6`, `class-join-page.tsx:533-553`) |
| 진행 화면 | 있음 | `MemberSessionScene` → `MemberClassContainer`(SDD-208). 단 `classCode`/`participantToken`/게스트 분기를 들고 있음(`MemberClassContainer.tsx:36-38,75,115-117,157-175,316`) |
| 종료(FM09) | 일부 | `MemberEndScene` — 게스트 라벨(`:41,:50`), `relaxationIndex` prop 은 선언만 있고 destructure 하지 않아 **쓰이지 않음**(`MemberEndScene.tsx:25,33-35`) |
| 로그인 회원 세션 조회 | 있음 | `GET /sessions/{id}` — host 또는 참가자만(`services/session_service.py:656-671,690-696`), 응답에 `participants[].participant_id/user_id/is_waitlisted/consent_*` 포함(`:85-148`) |
| 회원 목록 | 있음 | `GET /sessions` — 내가 host 이거나 참가자인 것만(`session_service.py:624-653`) |
| 회원이 로그인으로 입장(참가자 행 생성·상태 검사) | **없음** | 유일한 로그인 기반 `POST /sessions/{id}/join`(`api/v1/session.py:483-498`, `session_service.py:1445-1487`)은 참가자 행을 만들지 않고, host 만 `scheduled→in_progress` 전이, `in_progress` 가 아니면 400 |
| 회원용 LiveKit 토큰(세션 id 기반) | **없음** | `POST /sessions/{id}/livekit-token` 은 host 전용(`api/v1/session.py:459-480`). 회원용은 `by-code/{code}/livekit-token` 뿐(`:113-134`, `session_service.py:1685-1752`) |
| 회원 EEG 업로드 동의(`consent_eeg`) 기록 | **by-code join 에만 있음** | `session_service.py:1586-1594,1614,1618`(by-code join 이 `consent_eeg=True`). 초대 참가자는 `consent_eeg=False` 로 남고(`:347`,`:1293-1300`) 업로드는 403(`:2507-2517`) |
| 참가자 `consent_audio` 기록 | 없음(어디서도 참가자 값을 세팅하지 않음) | `grep consent_audio` — `audio_service.py:69-90`(host 가 body 로 넘김)만 있음. I7 과 겹침 |
| 비로그인 접근 후 로그인 복귀(returnTo) | **없음** | `components/auth/RoleGuard.tsx:26`(next 없이 `/login?role=...`), `pages/LoginPage.tsx:36`(`next` 는 platform_admin 만), `lib/auth-routing.ts:4-24`(client 는 `/app` 또는 온보딩 고정), `pages/ClientLoginPage.tsx:3-5`(search 버림) |
| 푸시 딥링크의 `/join` | 없음(허용 안 됨) | `lib/native/push.ts:8-17` 화이트리스트 |
| Capacitor 외부 딥링크(앱링크·유니버설링크) | 없음 | `frontend/capacitor.config.ts` 에 설정 없음, `AndroidManifest.xml` 의 intent-filter 는 LAUNCHER 하나, `appUrlOpen` 리스너 grep 0건 |
| 레이트리밋 | 없음 | `grep -ri "rate.?limit|slowapi|limiter" backend/app` 0건 → by-code 조회·join 은 무제한(코드 36^6) |

## 2. 상세 조사

### 2.1 `class-join-page.tsx` 구조 (767줄)

| 영역 | 줄 | 내용 |
|---|---|---|
| step 정의 | 25 | `'code' \| 'details' \| 'waiting' \| 'meditation' \| 'complete'` |
| 상수 | 27-45 | `TYPE_LABELS`, `isPreOpen`(`ready`·`scheduled`), `PARTICIPANT_STORAGE_KEY='mb_join_participant'`, `WAITLIST_POLL_MS=5000`, `BIRTH_YEARS`(게스트 생년) |
| 오류 문구 | 61-77 | 404→"클래스 코드를 찾을 수 없습니다", 409/410/400(종료·취소)→"이미 종료되었거나 취소…", 400(오픈 전)→"아직 열지 않았습니다" |
| sessionStorage 복원 | 79-109, 126-132 | `{code, participantId, participantToken}` 저장·복원·삭제 |
| 상태 | 116-139 | `step, code, guestName/Gender/BirthDate, session(by-code 응답), participantId, participantToken, waitlisted, durationMin, relaxationIndex, error, isLoading` |
| WS | 144-163 | `useSessionLiveSocket({ skipAuth: !isLoggedIn })`(`:147`). `session_state_changed` → `session.status` 만 갱신(`step` 은 안 바꿈, 우회 방지), 대기·상세 중 `cancelled` → `code` step 복귀(`:157-161`) |
| 쿼리 자동 조회 | 165-190 | `?code=` 6자리면 `getSessionByCode` → 종료면 오류, 아니면 `details` |
| Wake Lock | 193 | waiting/meditation 중 |
| 오픈 전 폴링 | 195-212 | `details` 에서 `ready/scheduled` 면 3초마다 `getSessionByCode` |
| 대기실 입장 콜백 | 215-225 | 게스트 닉네임 반영, `in_progress` 면 `meditation` |
| waiting 폴링 | 227-296 | 3초마다 `getSessionByCodeState(code, participantId)` → `guest_state==='meditation'` 이면 `in_progress` 로 간주, `completed` → `complete`, `cancelled` → `code`(오류). state 실패 시 `getSessionByCode` 폴백 |
| meditation 폴링 | 298-338 | 4초마다 state → `relaxation_index` 저장(종료 화면에서 미사용), `completed/cancelled` → `complete` |
| 대기열 재join | 340-365 | `waitlisted && step==='meditation'` 이면 5초마다 `joinSessionByCode`(멱등) 로 자리 확인(`:357` 에서 `isParticipantWaitlisted`) |
| 코드 제출 | 367-390 | 6자리 확인 후 `getSessionByCode` |
| join 수행 | 392-451 | `joinStartedRef` 이중 방지(`:393-398`), 게스트면 이름 필수(`:401-405`), `joinSessionByCode` → `participant_id`·`participant_token`·waitlist 반영 → `persistParticipant` → `waiting` |
| 회원 자동 join | 458-469 | `details` + 로그인 + 열림이면 `performJoin()` |
| reset | 471-490 | BLE 해제(`bluetoothService.disconnect`), 상태 전부 초기화, 닉네임·sessionStorage 삭제 |
| 렌더 | 493-553 | `meditation`→`MemberSessionScene`(`:495-511`, `classCode`·`participantToken` 전달), `complete`→`MemberEndScene`(`:515-530`), `waiting`→`MemberWaitingScene`(`:534-552`) |
| 코드/상세 UI | 555-764 | `code` 폼(`:563-596`), `details` 회원 분기(`:611-646`)·게스트 폼(이름·성별·생년, `:647-757`) |

`participant_token`·`skipAuth` 사용: `:50,93-95,130-131,147,421,425-427,504,523,543-544`(토큰), `:147`(skipAuth). 게스트 전용 코드는 `:44-45,121-124,343-356,401-405,410-423,555-596,647-757`.

**신규 화면 대응과 분해안**

| 신규 | 현행 대응 | 분해 |
|---|---|---|
| FM04 | `code` step | 삭제 |
| FM05 입장 확인 | `details`(`:598-646`) + 오픈 전 폴링(`:195-212`) | 신규 `phase='enter'`. 클래스 요약은 `GET /sessions/{id}`(회원은 이미 호출 중: `pages/client/ClientSessionDetailPage.tsx:48-62`). 진행자 이름은 `SessionDto` 에 없음(`host_name` 은 by-code 응답에만, `schemas/session.py:237`) → 현재 상세 화면은 `user.counselors` 에서 host_id 로 찾음(`ClientSessionDetailPage.tsx:123-128`). |
| FM06a~e | `waiting`(`MemberWaitingScene`→`ClassWaitingRoom`) | `phase='prep'`(내부 단계 상태). 닉네임 입력·게이트 삭제 |
| FM07 | 같은 씬의 시작 대기 | `phase='waiting'` |
| FM08 대기열 | `meditation` step 안의 `waitlisted`(`:359-365`, `:509`) | 서버 응답(`participants[].is_waitlisted`)으로 판정 |
| 진행 화면 | `meditation` | `MemberSessionScene` 유지, `classCode`·`participantToken` prop 제거 |
| FM09 | `complete` | `MemberEndScene` 유지(게스트 라벨 제거) |
| FM10 | `setError(...)` + step `code` 복귀 | 전체 화면 상태로 대체 |

**라우트 제안**: 기존 패턴은 `App.tsx:163-164` 가 `/app`·`/app/*` 를 `RoleGuard role="client"` + `ClientAppPage` 로 받고, `ClientAppPage` 가 `pathname` 을 수동 매칭한다(`pages/client/ClientAppPage.tsx:256,294,299`). 상세 URL 은 이미 `/app/sessions/:id`(알림·AI 비서 CTA·푸시가 사용). 따라서 **`/app/sessions/:id/enter`** 를 `App.tsx` 에서 `/app/*` 보다 앞에 정적 라우트로 추가한다(React Router v6 은 구체 경로 우선). 용어는 "클래스"지만 URL 은 기존 `sessions` 계열을 유지해 알림 해석(`lib/api/notifications.ts:154-156`)·푸시 화이트리스트(`push.ts:14`)를 깨지 않는다. 단계별(`/enter/prep/...`) 분리는 하지 않는다: 현행도 "준비와 시작 대기는 하나의 씬으로 유지해 설문·BLE·미리보기 상태를 보존"(`class-join-page.tsx:533`)하고, 단계 라우트는 언마운트로 BLE·미리보기 스트림을 잃는다. 단계 표시는 컴포넌트 내부 상태(필요하면 `history.pushState` 로 뒤로가기만 연동).

신규 오케스트레이터가 이어받아야 할 동작 목록(회귀 방지): WS 상태 수신(`:144-163`), 오픈 전 대기→자동 전이(`:195-212`,`:458-469`), 시작 감지·종료·취소 수신(`:227-338`), 대기열 자동 입장(`:340-365`), Wake Lock(`:193`), reset 시 BLE 해제(`:475`), 이중 join 방지(`:393-398`). 기존 테스트가 이 동작을 검증한다: `tests/class-join-waiting.test.ts:44-74`, `tests/class-join-waitlist.test.ts:62-95`.

### 2.2 프론트 전수 grep (코드·게스트 관련)

**API 레이어** (`lib/api/`)

| 파일:줄 | 내용 |
|---|---|
| `session.ts:54`, `:143` | `SessionDto.access_code`, `SessionByCodeResponse.access_code` |
| `session.ts:169,177,185` | `JoinByCodePayload`/`JoinByCodeResponse`/`ReportEmailRequest` 의 `participant_token` |
| `session.ts:285-306` | `GuestState`·`SessionByCodeStateResponse`(이완·집중·신호 지표 포함) |
| `session.ts:315-316` | `getSessionByCode`(`skipAuth`) |
| `session.ts:318-331` | `joinSessionByCode`(토큰 있으면 인증, 없으면 `skipAuth` 게스트) |
| `session.ts:401-420` | `getMemberLiveKitToken(code, pid, token)` → `/sessions/by-code/{code}/livekit-token` |
| `session.ts:440-452` | `raiseHand(sessionId, pid, token)` — `/sessions/{id}/participants/{pid}/raise-hand`(경로는 세션 id 기반이지만 게스트용 `participant_token` 분기) |
| `session.ts:488-496` | `getSessionByCodeState` → `/sessions/by-code/{code}/state` |
| `session.ts:498-507` | `requestReportEmail`(`skipAuth` 분기) |
| `checkin.ts:39,186-216` | `participant_token`, `skipAuth` 분기 |
| `token-expiry.ts:3` | 주석("by-code join" 언급) |

**컴포넌트·훅·페이지**

| 파일:줄 | 내용 | 조치 |
|---|---|---|
| `pages/class-join-page.tsx` | 위 2.1 전부 | 신규 페이지로 대체 후 삭제(또는 리다이렉트 전용으로 축소) |
| `components/player/MemberSessionScene.tsx:15-18,40,57` | `classCode`, `participantToken` | prop 삭제 |
| `components/player/MemberEndScene.tsx:17,34,56,64` | `participantToken`, `isLoggedIn`, 게스트 라벨(`:41,50`) | prop 삭제 |
| `components/class/player/member/MemberClassContainer.tsx:12,36-38,75,105-127,129-175,178,301,316,383-399` | `getSessionByCode`/`getSessionByCodeState`, `skipAuth: !isAuthenticated`, `guestChatEnabled`, `useMemberLiveKit({code,...})` | 게스트·by-code 분기 제거, LiveKit 훅을 sessionId 기반으로 |
| `hooks/useMemberLiveKit.ts:24,34,60,82,140,147` | `code`, `participantToken` | `getMemberLiveKitToken(sessionId)` 로 교체(백엔드 B2) |
| `components/class/CounselorLiveTile.tsx:16,78,100` | `participantToken` 전달 | prop 삭제 |
| `components/class/ClassWaitingRoom.tsx:41-48,65-66,74,111-135,320-336,411,437,599` | 게스트 닉네임·토큰·`skipAuth`, 화면의 `참여 코드 · {classCode}`(`:599`) | FM06 마법사로 교체되며 제거(I6/I7 과 겹침) |
| `components/class/PreCheckinPanel.tsx:26,50,93-95`, `SelfCheckinPanel.tsx:21-22,137,172-174`, `ReportEmailRequestPanel.tsx:13,34,43,88-90`, `WaitingRoomBandCheck.tsx:36-41`, `WaitingRoomReminder`(`waiting-room-reminder.tsx:5-14`) | `participantToken`/`skipAuth` 분기 | 분기 제거 |
| `hooks/useBand.ts:169,327,413,492-603,1240`, `useEegRawUpload.ts:67,97-171`, `useSessionLiveSocket.ts:62,114,242-244,433`, `useWaitingRoomPresence.ts:34,48,66,108`, `useWaitingRoomCount.ts:26,50,76,135` | `skipAuth`(게스트 소켓·업로드 무토큰) | 옵션 제거(2단계 정리) |
| `components/class/GuestMeditationPanel.tsx`(819줄), `GuestCompletePanel.tsx`(421줄), `components/chat/GuestChatNotice.tsx`(77줄) | **import 하는 곳이 없음**(grep 결과 주석 언급만: `MemberSessionScene.tsx:2`, `MemberClassContainer.tsx:1`, `MemberEndScene.tsx:2`, `ReportEmailRequestPanel.tsx:1`, `useBand.ts:77`, `lib/class/class-onboarding.ts:28`) | **죽은 코드 — 삭제**. `GuestChatNotice` 는 `GuestMeditationPanel` 만 사용 |
| `components/chat/ClassChatPanel.tsx:80,139` | 게스트 403 주석 | 주석 정리 |

**`/join` 링크 생성·참조** (3.5 에서 전수)

**access_code 표시(회원)**: `pages/client/ClientHomePage.tsx:82-110,393-395,586`(히어로의 코드 칩+복사), `components/session/SessionCard.tsx:63-67`(회원 목록 카드, `ClientSessionListPage.tsx:12` 가 사용), `ClientSessionDetailPage.tsx:137-176`(코드 없으면 입장 불가 문구).

**access_code 표시(상담사/기관, 참고 — I3/I4/I8 영역과 겹침)**: `pages/DashboardPage.tsx:123,367-373`, `OrgDashboardPage.tsx:213,261`, `records/SessionRecordPage.tsx:108-110`, `sessions/SessionCreatePage.tsx:186-221`, `sessions/SessionDetailPage.tsx:248-254,405-410`, `sessions/ClassPlayerPage.tsx:1399-1445,1816,1909`, `components/session/SessionCodeBanner.tsx`(전체), `SessionListTable.tsx:149,176`, `class/player/host/HostLiveContainer.tsx:70,331`, `HostLiveView.tsx:79,155`, `sheets/ToolsSheet.tsx:16,31,64-65`, `HostCaseHarness.tsx:121,126,173`, `lib/class/host-player-case.ts:552`, `lib/class/fixtures/host-cases.ts:221`, `lib/api/dashboard.ts:12`, `lib/api/orgPublic.ts:16`(백엔드는 공개 응답에 코드를 넣지 않는데 프론트 타입·`OrgPublicPage.tsx:88` 은 `cls.access_code` 를 참조 — 사실상 죽은 참조).

### 2.3 백엔드 전수

**by-code 라우터** (`api/v1/session.py`, 라우트 순서 주석 `:73`,`:100`,`:112`)

| 엔드포인트 | 줄 | 인증 | 서비스 | 비고 |
|---|---|---|---|---|
| `GET /sessions/by-code/{code}` | 74-78 | 없음 | `session_service.py:1506-1533` | 제목·유형·진행자명·상태·정원·`access_code` 반환. 레이트리밋 없음 |
| `POST /sessions/by-code/{code}/join` | 80-98 | 선택(`get_current_user_optional`) | `:1536-1682` | 회원·게스트 공용(아래 상세) |
| `GET /sessions/by-code/{code}/state?participant_id=` | 101-110 | **없음** | `:2179-2253` | 코드+participant_id(UUID)만 알면 그 참가자의 `band_connected/battery`, 최신 이완·집중·스트레스 지표·`last_eeg_at` 반환(코드 읽기로 확인, 실행 미검증) |
| `POST /sessions/by-code/{code}/livekit-token` | 113-134 | 선택 | `:1685-1752` | 게스트는 `participant_token`(JWT `report_participant`) 검증(`:1714-1722`), 회원은 `current_user_id == participant.user_id`(`:1723-1725`), 대기열은 403(`:1730-1733`), `_compute_can_publish`(`:1755-1770`) |

`join_session_by_code` 규칙(`session_service.py:1536-1682`):
- 종료 상태 400(`:1553-1555`), 오픈 전(`ready/scheduled`)이면 host 가 아니면 400 "아직 오픈 전인 클래스입니다…"(`:1556-1563`).
- host 는 참가자로 등록하지 않음(`participant_id: None`, `:1564-1568`).
- 세션 행 잠금(`_lock_session_for_capacity`, `:1570-1573`; `:1234-1244`).
- 회원: 기존 행 없으면 **새 행 생성**, `consent_eeg=True`, 정원 초과면 `is_waitlisted=True`+순번(`:1575-1627`). 기존 행(초대 포함)이면 `consent_eeg=True` 로 덮어쓰고, 대기열이었고 정원 여유가 있으면 해제(`:1616-1621`). 응답 `is_guest=False`.
- 게스트: 이름 필수(`:1629-1631`), `participant_token` 으로 기존 행 재사용(`:1633-1647`), 없으면 `user_id=NULL`+`guest_name`+성별·생년으로 새 행(`:1649-1662`), 응답에 `participant_token` 발급(`:1678-1682`; `services/report_email_service.py:29-31` — 7일 JWT `:19-22`).

→ **누구나(비초대 회원 포함) 코드만 알면 참가자 행이 생긴다.** 참가자 행 생성 경로는 4곳뿐이다: 클래스 생성(`session_service.py:347`), 초대(`:1293,1300`), by-code 회원(`:1591`), by-code 게스트(`:1655`).

**`access_code` 생성·유일성·노출**

| 항목 | 줄 |
|---|---|
| 컬럼 `String(6)`, `unique=True`, `index=True`, nullable | `models/session.py:44-45` |
| 최초 추가 마이그레이션(컬럼+유니크 인덱스) | `alembic/versions/881a08fbe584_sdd_015_class_code_lite_org_code_access_.py:40-43` (같은 파일이 `session_participants.user_id` nullable·`guest_name` 도 도입) |
| 발급: 6자리 대문자+숫자, 최대 5회 재시도 | `services/code_service.py:16-48`, `session_service.py:215-217` |
| 발급 시점 | 클래스 생성 `session_service.py:315`, 복제 `:490`(템플릿은 `None`, `:426`) |
| 응답 노출 | `_serialize` `:97`(→ `SessionResponse` `schemas/session.py:155` — **회원도 받는다**), `SessionByCodeResponse`(`:232`), 호스트 live-metrics(`:395`, 서비스 `session_service.py:2163`), `schemas/dashboard.py:16`/`dashboard_service.py:41`, 리마인더(`reminder_service.py:139,267`) |
| 공개 기관 페이지 | 노출하지 않음(SEC-10: `schemas/org_public.py:22`, `org_public_service.py:104`) |

**게스트 참가자 모델·검증**
- 모델: `models/session.py:91-125` — `user_id` nullable(`:103`), `guest_name`(`:105`), `gender`·`birth_date`(`:106-107`), `report_email*`(`:109-111`).
- 토큰: `participant_token()` 생성 `report_email_service.py:29-31`, 검증 `_decode(token, "report_participant")`(`:34-42`).
- 검증 함수 `_authorize_participant_access`(`session_service.py:1794-1815`): 회원이면 `user_id` 일치, 게스트면 토큰 `sub == participant.id`. 사용처: `raise_hand`(`:1818-`), `record_service._resolve_checkin_participant`(`record_service.py:274-`).

**게스트(비로그인)를 받는 엔드포인트 — `participant_token` 이냐 `participant_id` 만이냐**

| 엔드포인트 | 줄 | 게스트 식별 | 비고 |
|---|---|---|---|
| `POST /sessions/{id}/checkin` | `api/v1/records.py:49-71`, `record_service.py:274-` | `participant_id`+`participant_token` | 종료 후 상태 남기기·사전 설문 |
| `POST /sessions/{id}/participants/{pid}/raise-hand` | `api/v1/session.py:313-335` | `participant_token` | |
| `POST /sessions/{id}/report-email` | `:501-509`, `report_email_service.py:66-72` | `participant_token` | OTP 는 I2 |
| `POST /sessions/{id}/features` | `:370-385`, `session_service.py:2740-` | **`participant_id` 만**(토큰 없음) | `resolve_upload_participant` 의 게스트 분기(`:2553-2563`) |
| `POST /sessions/{id}/eeg-raw/presign`·`/ack` | `:416-444`, `eeg_raw_service.py:83,189` | **`participant_id` 만** | 동일 함수 |
| WS `/session-live` connect | `ws/session_live_namespace.py:389-433` | 토큰 없으면 `user_id=None` 로 연결 허용(`:391-392,399-401,432`) | |
| WS `join` | `:440-`, `session_service.py:2338-2352`(`resolve_live_join` 게스트 분기) | **`participant_id` 만**(`user_id IS NULL` 행) | |
| WS `feature` / `class:signal` | `:587-`, `:696-`; `session_service.py:1972-1982`(`resolve_signal_sender`), `:2553-2563` | `participant_id` 만 | |
| 호스트 전용(게스트 무관) | `live-metrics`(`:447-454`), `audio_sync`(`session_service.py:2009-2033`), 채팅(REST·WS 모두 인증 필요 — `ClassChatPanel.tsx:80,139` 주석의 백엔드 403) | | |

→ `participant_token` 은 by-code join 이 유일한 발급처다. 토큰이 없는 `participant_id` 만의 게스트 경로가 EEG 업로드·WS 에 남아 있어, 게스트 행이 존재하는 한 UUID 만 알면 대리 업로드가 가능하다(코드 읽기로 확인, 실행 미검증). 게스트가 더 생기지 않으면 이 분기들은 과거 데이터용으로만 의미가 있다.

**읽기 호환이 필요한 게스트 데이터 소비처**: `services/report_service.py:153,183,275,342,500,623-631,716,777,894`, `report_comment_service.py:121`, `dashboard_service.py:34-44,64`(`guest_count`), `schemas/report.py:85`, `session_service.py:127-133,1164-1170,2086,2129`(`is_guest`·`guest_name` 직렬화). 게스트 컬럼·`is_guest` 직렬화는 **삭제 금지**.

**스키마 노출**(`schemas/session.py`): `ParticipantInfo`(`:123-142` `guest_name`, `is_guest`, `consent_*`), `SessionResponse.access_code`(`:155`), `JoinByCodeRequest/Response`(`:271-285`, `participant_token` `:277,281`), `MemberLiveKitTokenRequest`(`:288-291`), `RaiseHandRequest`(`:313-315`), `ReportEmailRequest`(`:488`), `schemas/record.py:113-122`(`CheckinRequest.participant_token`).

### 2.4 로그인 기반 join 경로 / 초대 참가자 레코드

- **회원이 쓰는 로그인 기반 입장 경로는 없다.** `POST /sessions/{id}/join`(`api/v1/session.py:483-498`)은 상담사 플레이어(`hooks/useLiveKit.ts:6,23`, `ClassPlayerPage.tsx:607`)가 쓴다. `_get_session_for_participant`(`session_service.py:1426-1442`)는 host·참가자를 허용하지만 참가자 행을 만들지 않고, `in_progress` 가 아니면 400(`:1473-1474`), 토큰을 `generate_livekit_token(room, name, uid)`(기본 `can_publish=True`, `:1398-1425`)로 발급해 응답에 담는다(`:1481`). **발견**: 참가자(회원)가 이 엔드포인트를 호출하면 발언권(SDD-094 `_compute_can_publish`)을 우회하는 송출 가능 토큰을 받을 수 있다 — `POST /sessions/{id}/livekit-token` 은 같은 이유로 host 전용으로 막았다(`api/v1/session.py:459-480`, SEC-LIVEKIT-PUBLISH-BYPASS 주석)는 점과 모순. 코드 읽기로 확인, 실행·테스트 미검증. 별도 Fix 카드 권장(본 SDD 범위 밖이지만, 신규 입장 엔드포인트가 이 경로를 재사용하면 안 되는 이유).
- **초대로 생성되는 행**: `POST /sessions/{id}/invite`(`api/v1/session.py:292-299`, `session_service.py:1267-1322`) — `SessionParticipant(session_id, user_id)` 만 채움(`consent_eeg=False`, `consent_audio=False`, 정원 초과면 `is_waitlisted=True`+순번). 종료·취소 클래스는 거부(`:1269-1271`), 중복은 409. 알림 `session_invited`(`:1313-1319`). 클래스 생성 시 `participant_ids` 도 같은 행(`:347`).
- **"입장했음"을 나타내는 필드는 없다.** `joined_at` 은 행 생성 시각(`models/session.py:112` server_default). 대기실 존재는 WS `waiting_room` presence 로만(`session_live_namespace.py:752-790`).
- **by-code join 과의 차이**: ① 행 생성(비초대 허용) ② `consent_eeg=True` 일괄 세팅 ③ 오픈 전 400 게이트 ④ 정원·대기열 해제 ⑤ `chat_room_id` 포함 응답(`_with_chat_room`, `:1627`). 신규 입장 엔드포인트가 이 중 ③④⑤ 를 이어받고 ①은 막고 ②는 FM06a 동의(I7)와 묶어야 한다.
- **업로드 게이트**: `consent_eeg=False` 이면 `features`/`eeg-raw`/WS `feature` 모두 403(`session_service.py:2507-2517` → `resolve_upload_participant` `:2520-2568`). 즉 by-code join 이 없어지면 **동의를 기록하는 서버 경로가 반드시 새로 필요하다.**
- **회원 쪽에서 participant_id 얻는 법**: `GET /sessions/{id}` 의 `participants[]` 에서 `user_id === 내 id` 인 행의 `participant_id`(`session_service.py:121-148`, 프론트 타입 `lib/api/session.ts:26-60`). 다른 참가자의 `user_id`·`guest_name`·`consent_*` 도 회원에게 내려가는 현행 노출은 이 조사 범위 밖(보류).
- **상담사 연결 게이트**: `ClientAppPage` 는 상담사가 연결되지 않은 회원에게 `/app/notifications` 외 모든 `/app/*` 에서 상담사 코드 화면을 보여 준다(`pages/client/ClientAppPage.tsx:267-291`). 초대 서비스는 상담사–회원 연결을 검사하지 않으므로(`session_service.py:1267-1322`) 연결 없는 초대 회원은 상세 딥링크(`:299-301`)에서 막힐 수 있다 — 결정 충돌 가능성(아래 5.4).

### 2.5 `/join` 링크 사용처 전수

| 구분 | 위치 | 내용 | 변경 |
|---|---|---|---|
| 프론트 링크 생성 | `pages/client/ClientSessionDetailPage.tsx:147-149` | `navigate('/join?code=${access_code}')` | `/app/sessions/${id}/enter` 로 |
| 프론트 링크 생성 | `pages/client/ai-agent-page.tsx:179-183` | `join` CTA — 열림이면 `/join?code=...`, 아니면 상세 | `/app/sessions/${id}/enter`(서버 CTA 의 `payload.url` 은 이미 `/app/sessions/{id}`, `agent_service.py:501-505`) — 백엔드 변경 없음 |
| 프론트 정적 링크 | `components/landing/Nav.tsx:31`, `Hero.tsx:48-51`, `pages/LandingPage.tsx:46`, `pages/OrgPublicPage.tsx:262-270`(+`:243` 안내문) | `/join`("클래스 참여/코드로 참여/바로 참여/코드 입력") | 삭제 또는 회원 로그인(`/login/client`)으로 교체 |
| 프론트 문구 | `components/landing/CTASection.tsx:7` | FAQ "클래스 코드를 입력하세요" | 문구 수정 |
| 프론트 스크립트 | `scripts/verify-landing.cjs:35,73` | `['클래스 바로 참여','/join']` 검증 | 갱신 |
| 라우트 | `App.tsx:76,153` | `ClassJoinPage` lazy + `/join` | 제안 2.8 |
| 백엔드 메일/알림 | `services/reminder_service.py:139-153,167-175` | 본문에 `참여코드: {code}`·"{join_url} 에서 참여코드를 입력하고 입장"·HTML 버튼 `join_url`(= `{frontend_base_url}/join`, **`?code=` 없음**) | 코드 문구 삭제, 링크를 `{base}/app/sessions/{id}`(로그인 필요 상세)로 — 필수(문구가 사라질 경로를 안내) |
| 백엔드 알림 extra | `reminder_service.py:265-268` | `params.access_code` | 제거(과거 알림 행의 `extra` 는 DB 에 남음, 무해) |
| 백엔드 푸시 | `tasks/push_task.py:165`, `chat_service.py:1452`, `agent_service.py:304-331` | 딥링크는 채팅·AI 비서뿐. 세션 이벤트(`_notify_participants_event` `session_service.py:1057-1108`)는 `target_type='session'` 표준 extra 만 — `/join` 없음 | 변경 없음 |
| 푸시 화이트리스트 | `lib/native/push.ts:8-17` | `/app`·`/chat`·`/agent` 만 허용 → `/join` 은 푸시로 열 수 없음 | 변경 없음 |
| 알림 해석 | `lib/api/notifications.ts:113-175` | `session` → `/app/sessions/{id}`(상세) | 2.7·5.5 참조 |
| 이메일 기타 | `report-email/view?token=`(`api/v1/session.py:512-516`)은 `report_view` 토큰 — `/join`·`participant_token` 과 무관 | 유지 |
| Capacitor | `frontend/capacitor.config.ts`, `android/app/src/main/AndroidManifest.xml`, `ios/` | 앱링크·유니버설링크·`appUrlOpen` 없음. 앱은 `dist` 번들을 내장(`webDir`) | 변경 없음. 단 구 번들이 구 경로를 계속 호출(2.6) |
| E2E | `e2e/full-journey.mjs:165-205`(`access_code` 로 `/join?code=`), `e2e/class-player/live.mjs:2,81,99-105,147-163,181-216,243,282`(by-code 스텁·`/join` 화면 단언), `e2e/explore.mjs:15`(SKIP 정규식) | | 신규 경로 스모크로 교체(`.github/workflows/e2e-smoke.yml:75-79` 가 `full-journey.mjs` 실행 — dev 배포 직후 CI 영향) |
| 브라우저 테스트 | `tests/waiting-room-checkin.browser.cjs:26-28,52-54`(by-code 목킹·`/join?code=`·'클래스 참여하기') | | 교체 |
| 문서 | `docs/class-entry-start-end-player-기획.md:138`, `docs/notification-system/02-frontend-기획.md:82,116`(현행 사양처럼 `/join?code=` 서술), `docs/클래스-개선-루프-아이디어.md:29` 외 | | 02-frontend 기획의 2곳은 갱신 |

**결론**: 외부로 배포되는 `?code=` 링크를 코드가 만들어 내는 곳은 없다(메일은 `/join` 만, 푸시는 불가). 기존 공유 링크 호환의 실질 대상은 (a) 구 번들이 만든 앱 내부 이동, (b) 상담사가 코드를 직접 알려 준 흐름(링크 아님) 뿐이다.

### 2.6 기존 데이터·구/신 클라이언트 혼재

**남길 것(스키마 삭제 금지, 읽기 호환)**
- `sessions.access_code` 컬럼·유니크 인덱스: 유지(PostgreSQL 유니크 인덱스는 NULL 다중 허용 → 신규 클래스에서 발급 중단해도 안전).
- `session_participants.user_id`(nullable)·`guest_name`·`gender`·`birth_date`·`report_email*`: 유지. 과거 게스트 리포트·대시보드·직렬화는 그대로 읽는다(2.3 소비처 목록).
- `ParticipantInfo.is_guest/guest_name`·`SessionResponse` 직렬화: 유지(과거 세션 상세·리포트가 사용).
- 이메일 리포트 열람 `GET /sessions/{id}/report-email/view?token=`: 유지(기존 발송 메일의 7일 링크).

**막을 것(단계별)**: by-code 게스트 join, 비초대 회원 by-code join, 게스트용 `participant_token` 분기(checkin·raise-hand·report-email·livekit), 토큰 없는 게스트 업로드·WS(`resolve_*` 의 `user_id IS NULL` 분기), WS 무토큰 연결의 참가자 join, by-code GET/state/livekit-token(최종).

**혼재 시 깨지는 지점**

| 상황 | 결과 | 근거 |
|---|---|---|
| 신 프론트 + 구 백엔드 | 신규 엔드포인트 404/405 → 입장 불가(치명) | 신규 엔드포인트 필요(3 장 B1·B2) |
| 구 프론트 + 신 백엔드(추가만) | 정상 | by-code 유지 |
| 구 프론트 + 백엔드가 by-code 404/410 | 구 번들 `errorMessage` 가 404→"입력한 클래스 코드를 찾을 수 없습니다", 409/410→"이미 종료되었거나 취소되어…"(**잘못된 안내**), 그 외→일반 실패문(`class-join-page.tsx:61-77`) | 410 은 오해를 부르므로 구 번들 대상 응답은 400/403 + 명확한 `detail` 이 낫다(그래도 구 번들은 일반 문구로 표시) |
| 구 프론트 + 신 클래스에 `access_code` 미발급 | 구 상세 화면이 "참여 코드가 아직 발급되지 않아 입장할 수 없습니다. 상담사에게 문의해 주세요." 표시(`ClientSessionDetailPage.tsx:137-176`) → **구 앱은 신규 클래스에 입장 못 함** | 유예 기간에는 코드 발급·응답 노출을 유지해야 함 |
| 앱(Capacitor) 구 번들 | 번들 내장(`webDir: 'dist'`, `package.json:17-23` 의 `cap sync`) — 서버 배포와 무관하게 구 경로를 호출. **강제 업데이트 장치 없음**(`grep min_version|force.?update` 0건, `app_version` 은 푸시 토큰 메타 `device_service.py:38-69` 뿐) | 스토어 배포 여부·분포는 **미확인** |
| 웹 열려 있는 탭(구 JS) | 새로고침 전까지 구 경로 호출 | 해시 번들이라 짧은 창 |
| 이미 발송된 리마인더 메일의 "클래스 입장하기" | `/join`(코드 없음) 클릭 → 구: 코드 입력 화면 → 신: 리다이렉트 페이지가 로그인/목록으로 안내 | `reminder_service.py:140,170-175` |
| 이미 저장된 알림(`extra.params.access_code`) | 무해(프론트가 읽지 않음: `notifications.ts:154-156` 은 `target_id` 만 사용) | |
| 과거 게스트 행이 있는 진행 중 클래스 | 신 백엔드가 게스트 분기를 즉시 막으면 진행 중 게스트가 끊김(LiveKit 재발급·checkin 403) | 유예 필요(5.2) |

**배포 순서**: `deploy-dev.yml` 은 한 워크플로에서 프론트 `dist` + 백엔드 소스를 같이 SCP → `alembic upgrade` → `systemctl restart`(`deploy-dev.yml:6,95,138-141,147,201`)하므로 dev 는 사실상 동시. 운영(main) 배포 파이프라인은 저장소에 없다(**미확인**). 원칙: 백엔드 추가(신규 엔드포인트) → 프론트 전환 → (유예) → 백엔드 차단. 신규 마이그레이션은 필요 없다(컬럼 삭제 없음).

### 2.7 회원 입장 CTA 3곳 + 알림의 변경 파일, 접근 권한 검사

| CTA | 현행 | 변경 |
|---|---|---|
| 홈 히어로 | `ClientHomePage.tsx:131-135`(`onEnter`→`navigate('/app/sessions/{id}')` `:433`), 버튼 라벨 `isLive` 가 `ready`(오픈 전)도 포함(`:78`) | 입장 가능(`open`/`in_progress`)이면 `/enter`, 아니면 상세. 코드 칩 제거 |
| 목록 카드 | `ClientSessionListPage.tsx:288,338,389` → 상세 | 입장 가능 카드에 입장 버튼(I8 과 합침) |
| 상세 | `ClientSessionDetailPage.tsx:133-178`(`canEnter` + `access_code` 필수 → `/join?code=`) | `canEnter` 만으로 `/enter` |
| 알림 | `ClientNotificationPage.tsx:46-47`, `ClientShell.tsx:94`, `AppShell.tsx:73`, `NotificationCenterPage.tsx:75` → `resolveNotificationTarget` → 상세 | 5.5 |

접근 권한(검토 결과): 클래스 상세는 host·참가자만 조회(`session_service.py:656-671`) → 비초대 회원은 403. 회원이 목록에서 보는 클래스도 참가자 행이 있는 것뿐(`:624-653`). 공개 기관 페이지(`/o/:org_code`)의 클래스 목록은 제목·유형·상태·정원만 보이고 코드는 없다. 따라서 코드가 사라지면 비초대 회원의 입장 수단은 **by-code join 이 막히는 시점에 전부 사라진다** — 즉 B5(또는 B6)가 곧 초대 강제의 서버측 보증이고, 그 전에는 코드를 아는 회원이 자가 참여할 수 있다.

### 2.8 라우트 제거/리다이렉트 제안, returnTo 확인
- `/join`: 웹에서 리다이렉트 전용 유지(유예 후 삭제), 앱 번들 안의 `/join` 은 구 번들이 가진 것이라 영향 없음. 신규 `/app/sessions/:id/enter` 추가. `App.tsx:153` 의 `ClassJoinPage` lazy(`:76`)는 신규 `ClassEnterPage` + 얇은 `JoinRedirectPage` 로 교체.
- 비로그인 `/app/sessions/:id`(+`/enter`): `RoleGuard`(`RoleGuard.tsx:26`)가 `/login?role=client` 로 보내지만 복귀 경로가 없음 → 3.1 의 returnTo 변경(`RoleGuard`·`LoginPage`·`resolvePostLoginPath`) 필요. `ClientLoginPage.tsx:4` 는 `search` 를 버리므로 deep link 에 `/login?role=client&next=…` 형태를 직접 쓰거나 이 컴포넌트가 search 를 전달하게 고친다.

## 3. 변경 목록

### 3.1 프론트

| 파일 | 변경 | 규모 |
|---|---|---|
| `pages/class-enter-page.tsx`(신규) + `App.tsx`(라우트) | `/app/sessions/:id/enter` 오케스트레이터(phase: enter→prep→waiting→live→end/closed). 2.1 의 이어받을 동작 목록 이식. participantId 는 `GET /sessions/{id}` 의 내 행에서, 대기열은 `is_waitlisted` 폴링/WS | L |
| `pages/class-join-page.tsx` | 리다이렉트 전용으로 축소(제안 2.8) 후 유예 뒤 삭제 | M(축소) → S(삭제) |
| `lib/api/session.ts` | `enterSession(id,{…동의})`, `getMemberLiveKitToken(sessionId)`, 1단계 유지 후 2단계에 by-code·게스트 payload·`participant_token`·`GuestState` 삭제 | M |
| `hooks/useMemberLiveKit.ts` | `code` → `sessionId`, `participantToken` 제거 | S |
| `components/class/player/member/MemberClassContainer.tsx` | 게스트·by-code 분기 제거(`:105-127,129-175,316`), `isAuthenticated` 분기 단순화 | M |
| `MemberSessionScene.tsx`, `MemberEndScene.tsx`, `MemberWaitingScene.tsx`, `CounselorLiveTile.tsx` | `classCode`·`participantToken`·`isLoggedIn` prop 제거 | S 각 |
| `ClassWaitingRoom.tsx`·`PreCheckinPanel.tsx`·`SelfCheckinPanel.tsx`·`ReportEmailRequestPanel.tsx`·`WaitingRoomBandCheck.tsx`·`waiting-room-reminder.tsx`·`lib/api/checkin.ts` | 닉네임·`participantToken`·`skipAuth` 분기 제거(FM06/FM09 구현과 같은 커밋 단위로 처리 권장) | M 합계 |
| `hooks/useBand.ts`·`useEegRawUpload.ts`·`useSessionLiveSocket.ts`·`useWaitingRoomPresence.ts`·`useWaitingRoomCount.ts` | `skipAuth` 옵션 제거(2단계) | S 각 |
| `components/class/GuestMeditationPanel.tsx`·`GuestCompletePanel.tsx`·`components/chat/GuestChatNotice.tsx` | **삭제**(import 0건) | S |
| `pages/client/ClientSessionDetailPage.tsx` | `:137-176` 코드 의존 제거, 입장 CTA → `/enter`(열림 여부만 판단) | S |
| `pages/client/ClientHomePage.tsx`, `ClientSessionListPage.tsx`, `components/session/SessionCard.tsx` | 히어로 코드 칩·복사 제거(`:82-110,393-395,586`), 카드 코드 행 제거(`SessionCard.tsx:63-67`), 입장 가능 상태의 CTA 를 `/enter` 로 직행(현행은 `/app/sessions/{id}` 상세 이동: `ClientHomePage.tsx:433`, `ClientSessionListPage.tsx:288,338,389`). 상세 외 CTA 는 I8 과 합쳐 처리 | M |
| `pages/client/ai-agent-page.tsx:179-183` | `/join?code=` 제거 → `/enter`(또는 상세) | S |
| `lib/api/notifications.ts` | (선택) `event_type` 이 `session_opened/started/waitlist_promoted` 면 `/enter` 직행 — `extra.event_type` 은 이미 내려옴(`notification_service.py:86-106`) | S |
| `components/landing/Nav.tsx`·`Hero.tsx`·`CTASection.tsx`, `pages/LandingPage.tsx`, `pages/OrgPublicPage.tsx`, `scripts/verify-landing.cjs` | `/join` 링크·문구 정리 | S |
| `RoleGuard.tsx:26`, `LoginPage.tsx:36`, `lib/auth-routing.ts:4-24`, `ClientLoginPage.tsx` | client returnTo: 가드가 `?next=` 부착, 로그인 성공 시 안전 검증(`/app/` 시작·`//`·공백 제외, 기존 admin 정규식 패턴 재사용) 후 이동. 온보딩 미완료 회원은 온보딩 후 `/app` | M |
| `pages/client/ClientAppPage.tsx:289` | 상담사 연결 게이트에서 `/app/sessions/:id`·`/enter` 예외 처리 여부(5.4) | S |
| 테스트 | 삭제·대체: `tests/class-join-waiting.test.ts`, `class-join-waitlist.test.ts`; 수정: `class-player-member-container.test.tsx:283,302,371`, `member-end-scene.test.tsx:80`, `member-session-scene.test.tsx`, `pre-checkin-panel.test.ts`, `self-checkin.test.ts`, `report-email-request-panel.test.tsx`, `class-waiting-room*.test.ts`; `tests/waiting-room-checkin.browser.cjs`; `e2e/full-journey.mjs`, `e2e/class-player/live.mjs`, `e2e/explore.mjs:15` | M |
| 상담사측 `access_code` UI(2.2 말미 목록) | 본 조사 범위 밖(I3/I4/I8). 단 코드 제거와 같은 릴리스에서 정리하지 않으면 상담사가 사용 불가 코드를 안내하게 됨 | — |

### 3.2 백엔드

분류 기준: **필수** = 없으면 신규 흐름 불가/안내 불일치, **권장** = 보안·정리, **보류** = 별도 SDD/Fix.

| # | 엔드포인트/모델/마이그레이션 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트(기존 위치) |
|---|---|---|---|---|---|
| B1 | `POST /sessions/{id}/enter`(신규, 로그인 필수) | 참가자 행이 **있어야** 함(없으면 403 — 초대 강제). 상태 게이트는 by-code join 과 동일(종료 400, 오픈 전 400, host 는 `participant_id: None`). 정원·대기열 해제 로직 재사용(`session_service.py:1616-1621`), 잠금(`:1234-1244`). `consent_eeg` 는 body(FM06a 동의)에서만 True 로(I7 와 설계 공유: 별도 동의 엔드포인트로 분리해도 무방). 응답 = `SessionResponse`+`chat_room_id`(`_with_chat_room`)+`participant_id`. 멱등. `join_session_by_code` 의 회원 분기를 공통 함수로 추출 | **필수** | 행 스키마 불변 | 신규 `tests/test_session_enter.py`; 참고: `test_func_fixes_4th.py:45-74`(멱등), `test_func_fixes.py:116-136`(정원·대기열), `test_sdd088_open_flow.py`(오픈 전 게이트) |
| B2 | `POST /sessions/{id}/member-livekit-token`(신규) 또는 by-code 함수를 세션 기준으로 리팩터 | 회원 본인 참가자 행(`user_id`) 확인, 대기열 403, `_compute_can_publish` 유지(`:1755-1770`), 종료 400, 룸 없으면 400(`:1695-1699`) — **host 전용 `POST /sessions/{id}/livekit-token` 은 건드리지 말 것**(`api/v1/session.py:459-480`) | **필수** | 불변 | `tests/test_member_livekit_token.py`(4곳 by-code) 이식, `test_sdd094_speaking_rights.py` |
| B3 | 리마인더 메일/알림 본문(`reminder_service.py:133-175,265-268`) | `참여코드` 줄·"코드를 입력" 문구 제거, 링크 `{base}/app/sessions/{id}`, `params.access_code` 제거 | **필수**(프론트 `/join` 제거와 동시) | 과거 발송분 영향 없음 | `tests/test_sdd097_session_reminders.py:139-165`(코드 포함 단언 수정) |
| B4 | by-code join 게스트 분기 차단(`session_service.py:1629-1682`, 라우터 `:80-98`) | 400/403 + 명확한 detail. 즉시 vs 유예는 5.2 | 권장(2단계) | 과거 게스트 행 불변(읽기만) | `test_sdd015_class_code.py`(11), `test_sdd062_guest_gender_birth.py`, `test_func_fixes.py:130`, `test_mb2_low_fixes_4th.py:265-333`, `test_mb2_test_quality_fixes.py:331`, `test_member_livekit_token.py:36` 등 — 게스트 케이스는 "차단됨" 단언으로 전환 |
| B5 | by-code 회원 join 을 "초대된 회원만"으로(`:1575-1627` 의 신규 행 생성 제거) | 비초대 → 403 | 권장(1단계에서 구 번들을 위해 유지할지 5.2) | 불변 | `test_sdd015_class_code.py`, `test_class_audio_sync.py:140`, `test_class_quiet_signal.py:47`, `test_live_metric_profile.py:22,54`, `test_mb2_high_severity_fixes_2.py:144` 등 24개 파일이 by-code join 으로 참가자를 만듦 → 초대 헬퍼(`invite`)로 픽스처 교체 필요(대규모) |
| B6 | by-code GET/state/livekit-token 비활성(404 또는 410) | 최종 단계 | 권장(2단계 말) | — | `test_sdd015_class_code.py:237-248`, `test_sdd021_session_class_flow.py`(13), `test_sdd088_open_flow.py`(8), `test_sdd026_live_session_p0.py`(8) |
| B7 | 게스트 무토큰 경로 제거: `resolve_live_join`(`:2338-2352`), `resolve_signal_sender`(`:1972-1982`), `resolve_upload_participant`(`:2553-2563`), `features`/`eeg-raw` 의 `get_current_user_optional`→`get_current_user`(`api/v1/session.py:374,420,437`), WS `connect` 무토큰 허용(`session_live_namespace.py:391-432`), `_authorize_participant_access` 게스트 분기(`:1794-1815`), `report_email_service.py:69-72`, `record_service._resolve_checkin_participant` | 보안 정리(게스트가 더 생기지 않으면 UUID 만으로 되는 대리 업로드 면 축소) | 권장(2단계) | 과거 게스트 행은 로그인 수단이 없으므로 이후 쓰기 불가(읽기 보존) | `test_sdd026_live_session_p0.py`, `test_sdd024_session_live_ws.py`, `test_mb2_ws_mid_fixes.py`, `test_rest_feature_live_fallback.py`, `test_sdd096_subjective_checkin.py`, `test_report_email.py` — 42개 파일이 `guest`/`participant_token` 언급 |
| B8 | `access_code` 발급 중단(`session_service.py:315,490`)·`SessionResponse`/live-metrics/dashboard 노출 제거(`:97,2163`, `schemas/session.py:155,395`, `dashboard_service.py:41`) | 컬럼·인덱스 유지(NULL) | 권장(2단계 말, 구 앱 소진 후) | 과거 세션 값 유지 | `test_sdd015_class_code.py:194-200`(발급·유일성 단언 삭제) |
| B9 | `SessionResponse.host_name` 추가(`_serialize`) | FM05 진행자 표기(현재는 `user.counselors` 매칭 → 연결 안 된 호스트면 '상담사') | 권장 | 불변 | `test_session.py` |
| B10 | `POST /sessions/{id}/join` 의 회원 토큰 발급 정리(2.4 발견) | 참가자에게는 토큰 미발급 또는 `can_publish=False` | **보류**(별도 Fix 카드; 신규 엔드포인트가 재사용 금지) | — | 신규 |
| B11 | by-code 조회·join 레이트리밋, `SessionResponse.participants` 의 타 참가자 정보 노출 축소 | | **보류** | — | — |
| B12 | 컬럼 삭제 마이그레이션(`access_code`·`guest_name` 등) | **하지 않음**(결정 8·비범위: 과거 데이터 보존) | — | — | — |

**집계**: 필수 3(B1·B2·B3), 권장 6(B4~B9), 보류 2(B10·B11). 신규 Alembic 마이그레이션 0건.

### 3.3 프론트만으로 가능한 대체안 vs 단계적 제거안

| | 최소안(백엔드 무변경) | 단계적 제거(권장) |
|---|---|---|
| 방식 | 신규 `/enter` 페이지가 `GET /sessions/{id}`(회원 접근 가능)로 `access_code` 를 읽어 `joinSessionByCode`·`getMemberLiveKitToken(code)`·`getSessionByCodeState(code)` 를 **내부에서** 호출. 코드 UI·`/join` 만 제거 | ① B1·B2·B3 추가 + 프론트 전환(by-code 유지) ② 유예 후 B4~B8 차단 |
| 동작 | 가능(회원 흐름 전부 기존 호출로 가능) | 가능 |
| `consent_eeg` | by-code join 이 계속 `True` 로 기록 — FM06a 동의가 서버에 안 남음(동의 UI 가 형식뿐) | 동의가 서버에 기록(I7 정책에 따름) |
| "초대 방식" 강제 | **안 됨**(비초대 회원도 코드로 행 생성, 코드는 회원 응답에 계속 노출) | B5 로 강제 |
| 게스트·무토큰 업로드 면 | 그대로 | B7 로 축소 |
| 비용 | 프론트 L, 백엔드 0, 보안 부채 유지 | 프론트 L + 백엔드 필수 3 + 권장 6, 구 번들 유예 필요 |
| 롤백 | 호출부 교체 커밋 1개 되돌림 | ①은 같은 방식, ②는 서버 되돌림 필요 |

## 4. 위험·주의

1. **동의 기록 공백**: by-code join 을 안 쓰면 `consent_eeg=False` 인 채 업로드 403 으로 EEG 가 조용히 안 쌓인다(`session_service.py:2516`). 신규 입장/동의 엔드포인트가 반드시 같은 릴리스에 들어가야 한다(I7 와 설계 합의).
2. **회원 LiveKit**: 세션 id 기반 회원 토큰이 없으면 상담사 영상·음성 수신이 불가(`MemberClassContainer.tsx:316`).
3. **테스트 부채**: 백엔드 테스트 24개 파일이 by-code join 으로 참가자를 만들고(`grep -c by-code`: sdd021 13, sdd015 11, sdd088 8, sdd026 8, sdd023 6 …), 42개 파일이 `guest`/`participant_token` 을 언급한다. 프론트는 `tests/` 의 11개 파일(`class-join-*`, `member-*`, `pre-checkin`, `self-checkin`, `report-email-request-panel`, `class-waiting-room*`, `class-player-member-container`)과 e2e 3개가 영향을 받는다.
4. **CI**: `e2e-smoke.yml:75-79` 의 `full-journey.mjs`(`:165-205` 가 `/join?code=`)는 dev 배포 직후 자동 실행 — 프론트 전환 커밋에서 같이 갱신하지 않으면 스모크가 실패한다.
5. **구 앱 번들**: 강제 업데이트 장치가 없고 배포 분포를 모른다(미확인). 코드 발급·by-code 회원 join 을 유예 기간 유지해야 구 앱이 신규 클래스에 입장한다(2.6).
6. **returnTo 부재**: 지금 클래스 링크를 비로그인으로 열면 로그인 후 `/app` 홈으로 떨어진다. 새 문구("링크 = 로그인 필요한 상세 딥링크")가 사실이 되려면 3.1 의 returnTo 변경이 필요하다. 로그아웃 만료 시의 `terminateSession`(`lib/api/client.ts:91-108`)도 복귀 경로를 붙이지 않는다.
7. **상담사 연결 게이트**(`ClientAppPage.tsx:289`): 연결 없는 초대 회원은 상세 딥링크에서 상담사 코드 입력 화면을 본다.
8. **보안(이미 존재, 본 SDD 로 일부 해소)**: by-code 조회·join·state 가 무인증·무레이트리밋, state 가 참가자 지표를 노출(코드 읽기로 확인), 회원 응답의 `access_code`, `POST /sessions/{id}/join` 의 송출 토큰(B10).
9. **대기열 재join 의존**: 현행 대기열 자리 확인은 by-code join 재호출(`class-join-page.tsx:340-365`). 새 흐름은 `GET /sessions/{id}` 의 내 행 `is_waitlisted` 폴링(또는 B1 멱등 재호출)으로 바꿔야 한다. 승격 알림은 `remove_participant` 경로뿐(`session_service.py:1325-1375`); 클래스 나가기는 행을 지우지 않아 자동 승격 트리거가 없다 — FM08("자리가 나면 자동 입장")의 서버 트리거는 I9 에서 확인 필요.
10. **죽은 코드 삭제 영향**: `GuestMeditationPanel`·`GuestCompletePanel`·`GuestChatNotice` 는 import 0건이지만 `useBand.ts:77`·`class-onboarding.ts:28` 주석이 이름을 언급한다(삭제 시 주석만 정리).

## 5. 사용자 결정 필요 (비즈니스·정책만)

### 5.1 기존 공유 링크(`/join`, `/join?code=`) 처리
- 옵션 A: `/join` 을 웹에서 **리다이렉트 전용 얇은 페이지**로 유예 유지(로그인 회원: `?code=` 가 있으면 `listSessions()` 에서 `access_code` 일치 세션을 찾아 `/app/sessions/{id}`, 없으면 `/app`+안내; 비로그인: `/login?role=client`(+returnTo)). 서버 조회 엔드포인트 불필요.
- 옵션 B: 즉시 삭제(404).
- **기본값 A**, 유예 8주(구 번들·구 메일 소진 판단 후 삭제). 근거: 비용 ≈ 30줄, 이미 발송된 리마인더 메일이 `/join` 을 가리킴(`reminder_service.py:140`), 코드 조회 엔드포인트를 살리지 않아도 됨. 영향: B 는 구 메일 클릭 시 404.

### 5.2 게스트 경로 즉시 차단 vs 유예, 비초대 회원 코드 참여
- 옵션 A: 프론트 전환 배포와 같은 릴리스에 by-code 게스트·비초대 join 차단(B4·B5).
- 옵션 B: 유예(구 앱 번들 소진까지, 예: 8주) 후 차단.
- **기본값 B**, 단 **게스트 신규 생성은 프론트에서 이미 노출 불가**이므로 구 번들만 영향. 유예 중에도 서버에서 로그를 남겨(게스트 join 건수) 0 에 가까워지면 차단. 영향: A 는 진행 중 게스트 세션·구 앱 회원 입장이 끊길 수 있음, B 는 비초대 회원 자가 참여 구멍과 코드 노출이 유예 기간 동안 유지.

### 5.3 코드 조회 엔드포인트(`GET /sessions/by-code/{code}`) 존속 기간
- 옵션 A: 즉시 제거. 옵션 B: 유예(5.2 와 같은 기간) 후 404. 옵션 C: 영구 유지.
- **기본값 B**. 영향: C 는 무인증·무레이트리밋 조회와 6자 코드 열거 면이 영구 유지된다(코드 읽기 근거: 2.3).

### 5.4 상담사 미연결 초대 회원의 클래스 접근
- 옵션 A: `/app/sessions/:id`·`/enter` 를 상담사 연결 게이트에서 제외(초대만으로 입장). 옵션 B: 현행 유지(연결 필수).
- **기본값 A**. 근거: 결정 1("클래스는 초대 방식, 링크 = 로그인 필요한 상세 딥링크")과 `ClientAppPage.tsx:289` 가 충돌할 수 있음(초대 서비스는 연결 여부를 보지 않음, `session_service.py:1267-1322`). 결정 충돌 가능성이므로 기존 확정 결정과 별개로 사용자 확인 필요.

### 5.5 알림 탭에서의 입장 방식
- 옵션 A: 알림 탭 → 상세(현행) → 입장하기(2탭). 옵션 B: `session_opened`/`session_started`/`session_waitlist_promoted` 알림 탭 → `/enter` 직행(프론트만 변경, `extra.event_type` 사용).
- **기본값 B**("알림에서 입장하기 한 번"과 부합). 영향: 오픈 전 알림을 눌러도 FM05 의 "열리면 자동으로 입장해요" 대기 카드로 처리되므로 안전.

### 5.6 신규 서버 입장 엔드포인트의 "초대 강제"
- 옵션 A: 참가자 행 없으면 403(초대 방식 강제). 옵션 B: 행 없으면 생성(공개 클래스 가능성 열어 둠).
- **기본값 A**(결정 1). 공개/자가신청 클래스는 코드상 존재하지 않는다 — 공개 기관 페이지는 제목·상태만 노출하고 코드는 숨김(`org_public_service.py:104`), 클래스 상세·WS·LiveKit·업로드 모두 참가자 행으로만 통과(2.3, 2.7).

## 6. 확인하지 못한 것

1. 운영(main) 배포 파이프라인과 앱 스토어 배포 여부·구 번들 분포 — 저장소에 dev 배포(`deploy-dev.yml`)만 있음. 구 앱 유예 기간 산정 불가.
2. 위 보안 관련 서술(by-code state 의 무인증 지표 노출, `POST /sessions/{id}/join` 의 송출 토큰, 게스트 UUID 만으로 업로드)은 **코드 읽기 결과**이며 실제 호출로 재현하지 않았다.
3. 초대된 회원이 상담사 미연결인 사례가 실데이터에 존재하는지(`/client/counselors` 와 초대 UI 의 후보 필터) — 초대 선택 UI(`SessionCreatePage`/I3)를 읽지 않았다.
4. FM06a 동의 항목(녹음 동의 `consent_audio`·뇌파 `consent_eeg`)의 저장 정책 — I7 소관. 본 문서의 B1 은 `consent_eeg` 기록 위치만 가정함.
5. 대기열 자동 승격 서버 트리거(나가기 시 행 유지 → 승격 안 됨)는 `remove_participant` 외 경로를 전수 확인하지 못함(I9 소관).
6. 푸시 payload 에서 세션 이벤트의 `deeplink` 키 유무 — `push_task.py:165` 는 `payload.get("deeplink","")` 를 읽지만 세션 이벤트가 이를 넣는 코드는 찾지 못함(`grep deeplink` 결과 채팅·AI 비서뿐). 웹푸시(`lib/web-push.ts:171-173`)가 받는 `mb-push-navigate` 의 발신 측은 열람하지 않음.
7. `docs/` 의 나머지 `by-code`·`participant_token` 언급(`AI-에이전트-양방향-채널-기획.md`, `회원-세션-대기-진행-화면-전수조사-기획서.md`)의 정확한 줄과 갱신 필요 여부.
8. 백엔드 테스트 24개/42개 파일 각각의 수정 규모(픽스처 공통 헬퍼 유무) — 파일 목록·건수만 파악.
