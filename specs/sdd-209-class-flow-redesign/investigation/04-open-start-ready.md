# I4 열림·시작·준비 현황(A5·A9·S6) — 코드 조사

> 조사 기준: develop `32fa5533`(작업 트리 미커밋 변경은 무시). 읽기 전용 조사 — 코드·시안 수정 없음.
> 표기: 프론트 `파일:줄` = `frontend/src/` 기준, 백엔드 = `backend/app/` 기준. `미확인`은 이유를 §6에 적었다.
> 시안 근거: `designs/class-flow-redesign/host-b.html`(FH05 L370-419, FH06 L421-496, FH06a L498-577, FH07 L579-608, FH08 L610-625), `member-b.html`(`startedSheet` L337-343). 현행 근거: `survey/상담사-화면조사.md` S-H14~S-H20·S-H22·S-H27, `survey/회원-화면조사.md` S-M10~S-M16.

---

## 0. 한 줄 결론

**"초대 N명 · 대기실 M명 · 준비 완료/준비 중" 집계와 "준비 중 회원 이름·미완 단계"는 백엔드 변경 없이 만들 수 있다** (초대 인원·이름 = 4초 폴링 `live-metrics`, 대기실·3단계 완료 = WS `waiting_room_changed.readiness`). 서버는 start 시 최소 인원을 요구하지 않는다(그룹 0명 단독 시작이 이미 허용·테스트됨) → 시작하기 비활성 조건은 프론트(`canStart`)에만 있고 지우면 끝이다. 반면 **FH06/FH06a 의 `다시 알림`(아직 입장 안 한 초대 회원에게)은 현행에 없다**(WS 리마인더는 대기실에 접속한 회원에게만 닿음) → 신규 엔드포인트 1개가 필요하다. 시작 후 입장(A9)은 서버가 이미 허용하지만, 회원 프론트는 **준비가 끝나기 전에는 `in_progress` 가 와도 강제 입장도·준비 건너뛰기도 없다**(입장 버튼 비활성 유지) — `지금 입장하기`/`준비 이어서 하기` 시트, 입장 후 이어서 하는 경로(설문 시트 신설), 건너뛴 준비 상태 보관소가 모두 신규 프론트 작업이다.

---

## 1. 현재 코드 상태 (있음/일부/없음)

| 항목 | 판정 | 근거 |
|---|---|---|
| 시작 전 구간 판정 `isSetup`(ready·scheduled)/`isLobby`(open) | 있음 | `pages/sessions/ClassPlayerPage.tsx:967-968` |
| 세팅·로비 화면 = 구형 `HostClassWorkspace` + `host-class-player.css`, 진행 중만 신규 `HostLiveContainer` | 있음(교체 대상) | `ClassPlayerPage.tsx:1831`(워크스페이스), `:1482-1533`(컨테이너 선례), `:70`(css import) |
| 헤더 컨트롤(클래스 오픈 / 클래스 닫기 / 시작하기 / 채팅 토글) | 있음 | `ClassPlayerPage.tsx:1538-1598` |
| open/start/cancel 전이 API | 있음 | `lib/api/session.ts:374`(`transitionSession`), 서버 `api/v1/session.py:209-224` |
| 서버 전이 규칙: open {ready,scheduled}, start {ready,scheduled,open}, cancel {ready,scheduled,open,in_progress} | 있음 | `services/session_service.py:35-40` |
| 서버 start 최소 인원 요구 | **없음(요구하지 않음)** | `session_service.py:871-877`(그룹 0명이어도 로그만), 테스트 `tests/test_sdd021_session_class_flow.py::test_01_그룹_클래스_참가자0명_단독시작허용`, `test_04_1대1_...` |
| 예약 시각 이전 오픈 제한 | 없음(제한 없음) | `session_service.py:854-979` 에 `scheduled_at` 비교 없음. 프론트 `openClass` 도 검사 없음(`ClassPlayerPage.tsx:1033-1047`) |
| 시작하기 활성 판정 = 초대 인원 기준 | 있음(제거 대상) | `ClassPlayerPage.tsx:1322-1331` |
| 대기실 인원 집계(presence) | 있음(휘발성, 클라이언트 TTL) | `hooks/useWaitingRoomCount.ts:19,61,83,108-123`, 단 구독이 `isLobby` 에서만 켜짐 `ClassPlayerPage.tsx:995` |
| 사람별 설문·밴드·기기 3단계 완료 플래그 중계 | 있음(boolean 3개만) | 회원 `hooks/useWaitingRoomPresence.ts:69-80`, 서버 `ws/session_live_namespace.py:753-788`, `:1412-1417` |
| 준비 현황 패널 | 있음(구형 UI, 데이터 형태는 재사용 가능) | `components/class/waiting-room-readiness-panel.tsx:9-14,34-45` |
| 초대 인원 이름 데이터(호스트) | 있음 | `GET /sessions/{id}/live-metrics` → `display_name`(`session_service.py:2086`), 호스트 4초 폴링 `ClassPlayerPage.tsx:956-964` |
| `session.participants[].user_name` | **없음**(서버가 안 내려줌 → fallback 이 "참가자"로 표시) | `session_service.py:121-146`, `schemas/session.py:123-141`, 소비 `ClassPlayerPage.tsx:139` |
| 대기실 미입장 초대 회원에게 다시 알림 | **없음** | §2-5 |
| 초대 추가 | 있음(`POST invite`, open/in_progress 에서도 허용) | `session_service.py:1267-1322`, `api/v1/session.py:292-299`, `lib/api/session.ts:377` |
| 입장 후(in_progress) 서버 join | 있음(by-code join 허용) | `session_service.py:1552-1565` |
| 시작 후 입장 시 대기실 건너뛰는 경로 | 없음(항상 대기실 3단계 게이트를 지남) | `pages/class-join-page.tsx:444`, `components/class/ClassWaitingRoom.tsx:324-343,571-584` |
| 준비 중 `in_progress` 수신 시 `지금 입장하기`/`준비 이어서 하기` 시트 | 없음 | `ClassWaitingRoom.tsx`(분기 없음), 현행 동작 §2-4 |
| 입장 후 미완 준비를 이어서 하는 경로(기기 시트·밴드 시트) | 일부(밴드·소리 시트 있음 / 설문 없음) | `components/class/player/member/MemberSheets.tsx:223-326`(기기), `MemberClassContainer.tsx:569`(체크인 생략 주석) |
| 사전 설문 API 가 in_progress 에서 허용되는가 | 있음 | `services/record_service.py:320-331`(cancelled 만 409) |
| 닫기 시 회원에게 닫힘 전달 | 있음(WS + 알림) | `session_service.py:951,946-974`, `ws/session_live_namespace.py:1005-1015` |
| 클래스 닫기 확인 | 없음(헤더 X 가 즉시 cancel) | `ClassPlayerPage.tsx:1556,1085-1101` |
| 나가기 가드 | 있음(open/in_progress 호스트) | `hooks/useLeaveGuard.ts`, `components/player/LeaveGuardModal.tsx`, `ClassPlayerPage.tsx:1025-1030,1459-1479` |
| 마이크 OFF/거부 경고가 `클래스 오픈` 에서 우회됨(P0-6) | 있음(확인됨) | `ClassPlayerPage.tsx:1543`, 프리뷰의 확인 다이얼로그는 compact 라 숨은 자기 버튼에만 연결 `components/session/SessionPreJoinPreview.tsx:235-247,498-499` |
| 오프라인에서도 시작 시 LiveKit 호출 | 있음(호출은 장소 무관, 렌더만 온라인 한정) | `ClassPlayerPage.tsx:1058`, `hooks/useLiveKit.ts:18-24`, 렌더 `components/class/player/host/HostLiveContainer.tsx:128,364` |

---

## 2. 상세 조사

### 2-1. `ClassPlayerPage` 시작 전 구간

**구조**
- 상태 판정: `isSetup = ready||scheduled`, `isLobby = open`, `isRunning = in_progress`(`ClassPlayerPage.tsx:966-971`). 세션은 5초 폴링(`:106,946-953`) + WS `session_state_changed` 로 갱신(`:715-729`, 소켓 `:906-918`).
- 시작 전 렌더: `isHost && (isSetup || isLobby)` → `HostClassWorkspace`(`:1831`). 좌 레일 = 세팅이면 `SessionPreJoinPreview dark compact`(`:1888-1897`), 로비면 미디어 컨트롤·내 영상·**클래스 코드 박스**(`:1909`)·타이머·녹화 상태 details(`:1898-1912`). `readinessPanel`(`:1886`)·BGM 패널(`:1887`, 온라인만)은 props 로 넘김. 하단 `tools` 슬롯에 `SessionMonitorSummary`·`SpeakingRightsPanel`·호스트 밴드 박스(`:1834-1884`).
- 진행 중 선례: `isRunning && isHost` 면 `HostLiveContainer` 에 **값·핸들러만** 넘기고 조기 return(`:1482-1533`). 훅(`useLiveKit :607`, `useAudioRecorder :611`, `useVideoRecorder :617`, `useBand :631`, `useSessionLiveSocket :906`, `useWaitingRoomCount :995`, `useLeaveGuard :1025`)은 페이지가 한 번만 만든다. 컨테이너 props 계약은 `HostLiveContainer.tsx:69-100`.
- `HostClassWorkspace` 호출처는 `ClassPlayerPage.tsx:1831` **한 곳뿐**(코드 grep: 외부 import 는 `tests/host-class-workspace.test.tsx` 뿐). 세팅·로비를 신규로 바꾸면 이 컴포넌트와 `host-class-player.css`(`:70` import; 같은 파일 `:1799` 에서 `<main>` 에 `host-class-player` 클래스 부여)는 **완료·취소·오류 씬이 공유하는 셸 클래스만 남기고** 정리 가능. 단 완료(`:1949-1980`)·취소(`:1983-1994`)·오류(`:1411-1435`) 씬이 같은 `<main>`/헤더를 쓰므로 FH09/FH10 교체(I-타조사)와 함께 삭제 순서를 맞춰야 한다.

**핸들러가 부르는 API·전이**

| 핸들러 | 줄 | 호출 | 후속 |
|---|---|---|---|
| `openClass(prefs)` | `:1033-1047` | `setMediaPrefs(prefs)` → `transitionSession(id,'open')` → `refreshMetrics()` | 서버: `opened_at` 최초 1회 기록(`session_service.py:883-884,904`), 채팅방 보장(`:924`), `session_state_changed` WS(`:951`), 참여자 알림 `session_opened`(`:954-974`) |
| `startClass()` | `:1050-1082` | `transitionSession(id,'start')` → `liveKit.connect()` → (마이크 OFF) `startAudio(id,false)` → 녹음 동의 모달 `setConsentOpen(true)` 또는 영상만 즉시 녹화 | 서버: 그룹 0명 허용(`:871-877`), `started_at` 기록, 알림 `session_started` |
| `closeClass(leaveAfter)` | `:1085-1101` | `transitionSession(id,'cancel')` → 상태 반영, `leaveAfter` 면 `bypassGuardRef`+`navigate('/sessions')` | 서버: 미디어 마감(`session_service.py:835-852,946-948`), WS, 알림 `session_cancelled`(대기열 포함, `:970`) |
| 헤더 `나가기` | `:1805` | `navigate('/sessions')` → `useLeaveGuard` 가 open/in_progress 호스트만 가로챔(`:1025-1030`) | `LeaveGuardModal`(open: 오픈 유지/닫고 나가기/계속) |
| 헤더 `클래스 닫기`(X) | `:1554-1563` | `closeClass(false)` **확인 없음** | 목록의 `닫기` 는 confirm 있음(survey P0-7) |

**서버 전이 규칙 (`session_service.py:35-40`, `:854-979`)**
- `open`: `ready`·`scheduled` 에서만. **예약 시각과 무관**(`scheduled_at` 비교 코드 없음). `scheduled` 라고 자동 오픈하는 태스크도 없음(전이 호출처는 `api/v1/session.py:215` 와 스테일 스윕 `session_service.py:1015` 뿐).
- `start`: `ready`·`scheduled`·`open` 에서 가능(오픈 생략하고 바로 시작도 서버는 허용).
- `cancel`: `ready·scheduled·open·in_progress` 에서 가능. 한 번 cancelled 면 `open` 으로 되돌릴 수 없다(출발 집합에 없음) → FH08 시안 문구 "닫은 클래스는 다시 열 수 없어요" 와 일치.
- 최소 인원: 그룹 `active` 0명이어도 `logger.info` 만 남기고 통과(`:867-877`, SDD-101 Brian 요청 주석). 1:1·그룹 모두 인원 조건 없음.
- 안전망: `open` 상태로 24시간 방치되면 스윕이 자동 cancel(`session_service.py:979-1030`, `STALE_OPEN_SESSION_MAX_AGE_HOURS=24`, 테스트 `tests/test_stale_open_session.py`) — FH08 문구 "클래스는 열린 채로 두어요"와 충돌하지 않으나 사용자 안내에는 없음(§5-6).

**신규 호스트 컴포넌트가 재사용해야 할 것** (`HostLiveContainer` 선례처럼 "페이지가 훅을 만들고 컨테이너는 props 만 받음")
- 상태/집계 입력: `session`(status·location_type·participant_mode·linkband_mode·record_audio/video·scheduled_at·opened_at·access_code·participants), `displayMetrics`(초대 인원 이름·밴드), `waitingRoom.entries`(대기실 presence), `liveSocket.isConnected`, `quietSignals`/`groupAggregate` 는 시작 전에 불필요.
- 핸들러: `openClass(prefs)`·`startClass()`·`closeClass(leaveAfter)`·`handleToggleChatEnabled`(`:838-854`)·`handleCopyCode`(`:1398-1409`; 코드 제거 결정 1 이후엔 링크 복사로 교체)·`blocker`(`useLeaveGuard`)·`audioPlayer`(`:984-989`, BGM 시트)·`band`+`hostParticipantId`(`:624-635`, 내 밴드 시트)·`handleSetSpeaking`(`:814-829`)·`mediaPrefs`/`setMediaPrefs`(`:592`)·`recordConsent`(신규).
- 부수 훅: `useWakeLock(isLobby||isRunning)`(`:992`), `useLeaveGuard`. 로비 경과 타이머(`:1241-1254`, `lobbyElapsedSec`)는 FH06 에 없으므로 제거 가능.
- 호스트 본인 밴드: `hostParticipantId` 는 live-metrics 행의 `user_id === currentUserId` 로만 찾는데(`:624-629`) 호스트는 참가자 행이 아니다(`join_session_by_code` 가 호스트를 참가자로 등록하지 않음 `session_service.py:1564-1566`) → **FH06a `내 밴드` 연결 버튼이 코드상 항상 비활성**(`:1857-1861` `!hostParticipantId`). 실측 안 함(§6) — I5(밴드·전극)와 겹침.

### 2-2. 시작 가능 판정(A5)

**현행**
- `activeCount = session.participants.filter(!is_waitlisted).length`(`ClassPlayerPage.tsx:1322-1325`) = **초대·참가 등록 인원**(invite 시점부터 `SessionParticipant` 행이 생김 `session_service.py:1293-1300`).
- `canStart = isLobby && !transitioning && (participant_mode !== 'group' || activeCount >= 1)`(`:1328-1331`). 헤더 버튼 `disabled={!canStart}` + 툴팁 "참가자 1명 이상 입장 후 시작할 수 있습니다"(`:1567-1573`).
- 표시 불일치의 뿌리: 카드 `참가자 N`은 `participantsToMetrics`(`:133-153`) = 초대 인원, 준비 현황 `x / 전체 N명`은 대기실 presence(`waiting-room-readiness-panel.tsx:34-37`). 서로 다른 모집단.

**확정 결정 5 적용 — 제거할 조건**

| # | 제거 대상 | 위치 |
|---|---|---|
| 1 | `participant_mode !== 'group' \|\| activeCount >= 1` | `ClassPlayerPage.tsx:1331` |
| 2 | `activeCount` 훅(시작 판정 용도에 한해) | `:1322-1325` (다른 용도 없음 — grep 결과 `:1323,1331` 만) |
| 3 | 비활성 툴팁 "참가자 1명 이상…" | `:1569-1573` |
| 4 | (서버) 해당 없음 — 이미 제약 없음 | `session_service.py:871-877` |

남는 조건: `isLobby && !transitioning`(중복 클릭 방지)만. 시작 버튼은 로비에서 **항상 활성**(0명 포함). 시안 FH06 은 하단 `시작하기` CTA 를 항상 활성으로 그리고(L490) 안내는 상태줄 문구(`statusLine` L464-468)로만 한다.

**대기실 presence 기준으로 바꾸는 법 (집계 데이터 원천)**

| 표시 | 원천 | 비고 |
|---|---|---|
| 초대 N명 | `displayMetrics.length`(= `live-metrics.metrics`, 대기열 제외 활성 참가자, `session_service.py:2061`) | 4초 폴링, 입장(by-code join) 시 `participant_changed` 로 즉시 갱신(`:1139-1190`, `ClassPlayerPage.tsx:731-739`). fallback(`participantsToMetrics`)은 이름이 "참가자"로 나오는 버그가 있으므로 이름은 `display_name` 만 신뢰 |
| 대기실 M명 | `waitingRoom.count`/`entries.length`(`useWaitingRoomCount.ts:61,108-123`) | 휘발성: 회원 15초 heartbeat, 호스트 TTL 45초(`:19`, `useWaitingRoomPresence.ts:22,89`). 서버 저장 없음 |
| 준비 완료 / 준비 중 | `entries[].readiness` 의 3 boolean 전부 true 여부(`waiting-room-readiness-panel.tsx:12-14,35-36`) | 없으면 `surveyDone=Boolean(checkin)`, 나머지 false 로 취급(`:12-14`) |
| 아직 입장 안 한 N명 | `초대 N − 대기실 중 초대 명단에 있는 수` | **조인 키가 같다**: 대기실 이벤트의 `participant_id` 는 서버가 소켓 컨텍스트로 채운 `SessionParticipant.id`(`session_live_namespace.py:782`)이고 live-metrics 행의 `participant_id` 도 `str(p.id)`(`session_service.py:2127`) → 이름 매칭 없이 id 로 조인 가능. 시안의 "away = inv − ms.length"(L474)를 그대로 구현할 수 있음 |
| 이름 | 초대 명단은 `display_name`(서버 User.name, `session_service.py:2086`), 대기 중 회원은 `entry.nickname`(회원은 `memberName` 고정, `ClassWaitingRoom.tsx:131`) | 두 값이 다를 일 없음. 호스트가 이름을 보여줄 때는 `display_name` 우선 |
| 오프라인 `기기` na / 밴드 사용 안 함 `밴드` na | 호스트가 세션의 `location_type`·`linkband_mode` 로 클라이언트 계산 | 시안 `members()` L438-440 규칙. 현행 3단계 boolean 은 오프라인·밴드 none 이어도 회원이 건너뛰기를 눌러야 true 가 됨(회원 쪽 문제는 I-회원 소관) |

**주의**: 구독 범위. `useWaitingRoomCount` 는 `enabled: isLobby` 라서(`ClassPlayerPage.tsx:995`) 호스트가 시작하는 순간 구독이 꺼지고 `entries` 가 비어 버린다(`useWaitingRoomCount.ts:138-140` 파생값). 반면 회원 쪽 presence 는 그 회원이 대기실을 벗어날 때까지 계속 heartbeat 를 보낸다(서버는 상태와 무관하게 호스트 룸으로 중계, `ws:753-788`). **시작 후에도 "준비 중이라 아직 입장 못 한 회원"을 호스트에게 보여주려면 구독 조건을 `isLobby || isRunning` 으로 넓혀야 한다**(한 줄 변경, `HostLiveContainer` 는 이미 `waitingEntries` prop 을 받는다 `HostLiveContainer.tsx:82`).

### 2-3. 대기실 presence (회원 → 서버 → 호스트)

**이벤트·payload (코드 전수)**

| 방향 | 이벤트 | payload | 근거 |
|---|---|---|---|
| 회원→서버 | `join`(룸 입장) | `{session_id, participant_id?}` | `lib/socket.ts:468-496`, 서버 `ws:441-557` |
| 회원→서버 | `waiting_room`(heartbeat 겸용) | `{session_id, action:'join'\|'leave', nickname?, checkin?:{arousal,valence,emotion,note}, readiness?:{surveyDone,bandDone,deviceDone}}` | `lib/socket.ts:255-262`, 회원 훅 `hooks/useWaitingRoomPresence.ts:69-80` |
| 서버→호스트 룸 | `waiting_room_changed` | `{session_id, participant_id, action, nickname, checkin, readiness}` | `ws:779-788,1078-1091`. 호스트 룸에만 발행(공용 룸·참가자 룸 제외) |
| 호스트→서버 | `waiting_room_remind` | `{session_id, participant_ids[]}` → ack `{ok,sent}` | `lib/socket.ts:769-778`, 서버 `ws:791-825` |
| 서버→회원 본인 룸 | `waiting_room_reminder` | `{session_id, message}` 고정 문구 | `ws:818-821`, 회원 수신 `components/class/waiting-room-reminder.tsx` |

- **별도 leave·TTL·heartbeat 이벤트는 서버에 없다.** 서버는 상태를 저장하지 않고(`ws:760-761` docstring) 중계만 한다. heartbeat = 회원이 15초마다 `waiting_room(join)` 을 반복(`useWaitingRoomPresence.ts:22,89`), 호스트가 45초 TTL 로 청소(`useWaitingRoomCount.ts:19,88`). 회원이 대기실을 벗어나면 cleanup 에서 `leave` 1회(`useWaitingRoomPresence.ts:95`), 실패해도 TTL 로 수렴.
- 서버 sanitize: `readiness` 는 **정확히 boolean 3개가 모두 있을 때만** 통과, 그 외 키는 버림(`ws:1412-1417`). `checkin` 은 SAM 3축 1~5 + note 200자(`ws:288-313`). 닉네임 20자(`ws:272-281`). → payload 에 전극·건너뜀 여부를 실으려면 서버 sanitize 도 바꿔야 한다.
- 신원: 클라이언트가 보낸 participant_id 는 신뢰하지 않고 소켓에 저장된 `join` 컨텍스트로만 판정(`ws:769-777`). 컨텍스트가 없으면 이벤트를 **조용히 버림**(로그만 `waiting_room 무시 — join 불일치`).

**회원이 단계별로 보내는 값** (`ClassWaitingRoom.tsx`)
- 마운트 즉시 presence 시작(`:128-136`): `readiness` 초기값 `{false,false,false}`(`:81`).
- 설문 제출/건너뛰기 → `surveyDone=true`(`:87-90`, `:437-439`: 제출 시 `setCheckin(value)` + `completeSurvey()`, 건너뛰기는 `completeSurvey()` 만 — **제출 vs 건너뜀을 구분하는 값이 payload 에 없다**, 단 제출이면 `checkin` 이 함께 실림).
- 밴드 연결 후 `기기 테스트로`/`밴드 없이 진행` → `bandDone=true`(`:91-94`, `components/class/WaitingRoomBandCheck.tsx`; 건너뛰기·연결 구분 없음).
- 기기 `확인 완료`/`건너뛰기` → `deviceDone=true`(`:95`, `:556-559`).
- 변경 즉시 재전송: `readinessKey`/`checkinKey` 가 바뀌면 heartbeat 를 기다리지 않고 join+waiting_room 재emit(`useWaitingRoomPresence.ts:104-119`).

**시안이 요구하는 필드 대비 (필드 단위 사실)**

| 시안 요구 | payload 에 있나 | 비고 |
|---|---|---|
| 회원 이름 | 있음 `nickname` | + live-metrics `display_name` |
| 설문/밴드/기기 완료 여부 | 있음 `readiness.{surveyDone,bandDone,deviceDone}` | 시안 `wait/ok` 에 해당 |
| 설문 체크인 칩(집중·편안함·감정·전할 말) | 있음 `checkin` | |
| `skip`(건너뜀) 구분 — 시안 `CELL_WORD.skip='건너뜀'`(host-b L448-449) | **없음** | 완료와 건너뜀이 같은 `true`. 설문은 `checkin` 유무로 추정 가능, 밴드·기기는 불가 |
| `na`(해당 없음: 오프라인 기기·밴드 사용 안 함) | 없음 → **호스트가 세션 속성으로 계산** | 위 표 |
| `bad`(밴드 접촉 불량) + 전극 L/R | **없음** | `waiting_room` payload 에 필드 없음. 라이브 `eeg_feature` 서버 중계는 `data["feature"]` 만 사용하므로(`ws:602-609,680-687`) 최상위 `lead_off` 도 버려짐(`EEGFeatureItem` 에 `lead_off` 필드 없음 `schemas/session.py`, grep 상 서버에서 `lead_off` 는 `DeviceStatus` 파생(`session_service.py:2424-2439`)뿐). 전극별 접촉은 I5 소관 |
| 알림 전달 여부(FH06a) | 없음 | §2-5 |

### 2-3b. 설문 응답 전에는 상담사 목록에 안 뜨는 원인 (survey §9-5)

**결론: 코드만으로 근본 원인을 확정하지 못했다(`미확인`).** 확인된 사실과 후보:
1. 호스트 목록 = `waiting_room_changed` 만으로 채워진다(`useWaitingRoomCount.ts:108-121`). 이벤트가 안 오면 목록은 비어 있다.
2. 회원 쪽 첫 알림은 `onConnect → announce('join')` 에서 `joinSessionLive`(emit `join`) 직후 곧바로 `emitWaitingRoomPresence`(emit `waiting_room`)를 **연달아** 보낸다(`useWaitingRoomPresence.ts:69-80,82-87`). 서버 `join` 핸들러는 소켓 컨텍스트 저장 전에 스레드 호출을 2번 await(`ws:451-476`→저장 `:510-519`)하고, `waiting_room` 핸들러는 컨텍스트에 session_id 가 없으면 이벤트를 버린다(`ws:769-773`). 서버 소켓 생성 시 `async_handlers` 옵션을 지정하지 않으므로(`ws/__init__.py:80-81`) python-socketio 기본값(핸들러 병렬 실행, 라이브러리 소스는 로컬 미설치로 확인 못 함)이면 **첫 알림은 레이스로 유실될 수 있다**. 실제로는 컨텍스트 저장 순서 이벤트(재입장 시 `leave`→`join`→`waiting_room`, `useSessionLiveSocket.ts:406-408` 의 `releaseSessionLiveRoom`)까지 얽혀 있다.
3. 설문 응답 후 3초 내 표시되는 이유는 설명된다: `checkin`/`readiness` 변경이 `useWaitingRoomPresence.ts:104-119` 의 즉시 재전송을 유발하는데 이때는 `join` 이 이미 끝나 있다(dedup 되어 재emit 없음 `lib/socket.ts:480-482`).
4. **그러나** 15초 heartbeat 는 같은 경로로 `join`(dedup)+`waiting_room` 을 다시 보내므로 후보 2 의 레이스는 ≤15초 안에 스스로 복구되어야 한다. survey 의 "코드로만 입장한 회원을 60초 관찰, 0명 유지"는 후보 2 로 설명되지 않는다. `join_denied`(서버가 참가자 행을 못 찾음, `ws:483-489`; 초대 없이 코드 입장 직후 레이스, 또는 게스트 `skipAuth` 경로)나 호스트 쪽 구독 시점(`enabled: isLobby`, `ClassPlayerPage.tsx:995`) 후보도 남는다.
5. 결정적 확인법(미수행): dev 서버 로그에서 `waiting_room 무시 — join 불일치` / `join 거부` 라인 카운트, 또는 회원·호스트 소켓 트레이스.

**설계 함의**: 호스트 화면은 presence 에만 의존하지 말고, **초대 명단(live-metrics)을 기준 행으로 두고 presence 를 덮어쓰는** 방식(= 시안 `초대 N명 · 대기실 M명` 카드)으로 만든다. 그러면 presence 유실이 "행이 사라짐"이 아니라 "아직 입장 안 함"으로 안전하게 강등된다. 서버 측 보강은 §3 B4(권장).

### 2-4. 시작 후 입장하는 회원(A9)

**서버**
- by-code join: `completed/cancelled` 만 거부하고(`session_service.py:1552-1553`) 오픈 전(`ready/scheduled`)만 차단(`:1556-1561`). **`in_progress` 는 로그인 회원·게스트 모두 허용**. 로그인 회원은 기존 참가자 행이 있으면 재사용하고 `consent_eeg=True` 로 갱신(`:1585-1620`), 정원이 차면 대기열(`:1590-1601`).
- 로그인 join `POST /sessions/{id}/join`(`api/v1/session.py:483-498`, `session_service.py:1445-1480`)은 별개 경로: 참가자 행이 있어야 하고(`_get_session_for_participant` 403, `:1426-1442`), **`in_progress` 일 때만** 통과(`:1473-1474`, `open` 이면 400 "현재 세션에 입장할 수 없는 상태입니다"), `consent_eeg` 를 건드리지 않는다. 현행 프론트에서 이 경로는 호스트의 `useLiveKit.connect()` 만 쓴다(`hooks/useLiveKit.ts:19-21`). → **결정 1(코드 제거)로 코드 없는 회원 입장 엔드포인트가 필요해지면 `open` 과 `in_progress` 를 모두 허용하고 `consent_eeg` 를 기록하도록 만들어야 한다**(I-입장·동의 조사와 겹침).
- LiveKit 토큰: 회원 구독 토큰 `POST /sessions/by-code/{code}/livekit-token`(`api/v1/session.py:113-134`, `session_service.py:1685-1752`)은 완료·취소만 거부하고(`:1700`), `webrtc_room_id` 는 생성 시 이미 발급(`:305`)이라 **오픈·진행 중 입장자 모두 발급된다**. 대기열(`is_waitlisted`)만 403(`:1730`). 호스트 측 LiveKit 은 시작 시 `connect()`(`ClassPlayerPage.tsx:1058`).
- 테스트 공백: `in_progress` 에서의 by-code join 을 직접 검증하는 백엔드 테스트는 없다(`tests/test_sdd015_class_code.py` 는 `completed` 거부만 `test_18`, `test_sdd021_session_class_flow.py::test_10` 는 state 조회만). → §3 테스트에 추가.

**프론트 현행 동작 — 회원이 준비 단계 중일 때 `in_progress` 를 받으면**
- 감지 경로: WS `session_state_changed`(`class-join-page.tsx:144-163`; status 만 갱신) + `waiting` 단계 3초 폴링 `GET by-code/state`(`:228-296`; `guest_state==='meditation'` → `status='in_progress'`).
- `MemberWaitingScene` 은 `sessionLive={session.status==='in_progress'}`(`class-join-page.tsx:546`)만 `ClassWaitingRoom` 에 넘긴다. `ClassWaitingRoom` 은
  - **준비 완료(게이트 통과)면** 자동 입장: `useEffect` 가 `sessionLive && gate.canEnter` 에서 `handleEnter()` → `onEnter` → `step='meditation'`(`ClassWaitingRoom.tsx:338-343`, `class-join-page.tsx:215-225`).
  - **미완이면 아무 일도 안 일어난다.** `handleEnter` 는 `if (!gate.canEnter) return`(`:325`), `입장하기` 버튼은 `disabled={!gate.canEnter}`(`:579`), 헤더 칩 문구만 "진행 중"으로 바뀜(`:393-395`). **강제 입장도, 준비 일괄 건너뛰기도 없다.** 회원이 3단계를 각각 건너뛰기/완료해야 입장 가능(게이트 `lib/class/class-waiting-room.ts:resolveWaitingRoomGate` — 이름·설문·밴드·기기 모두 true).
- 시작 후 처음 들어오는 회원도 `performJoin` 이 항상 `step='waiting'` 으로 보냄(`class-join-page.tsx:444`; `in_progress` 면 `sessionLive=true` 로 렌더) → **대기실을 건너뛰는 경로는 없다**. 즉 "준비 이어서 하기" 동작 자체는 현행 그대로이고, 새로 만들 것은 (a) 시안 시트 표시, (b) `지금 입장하기` 강제 입장, (c) 입장 후 이어서 하기.

**`지금 입장하기`/`준비 이어서 하기` 시트(member-b `startedSheet` L337-343) 구현에 필요한 것**
- 트리거 상태: `sessionLive` 가 `false→true` 로 바뀌는 순간 `readiness` 가 미완이면 시트 1회 표시(`startedAck` 로컬 state, 닫기 버튼 없음 `noClose`). 이벤트 소스는 이미 있음(WS + 3초 폴링). 시트 내용 "남은 준비: 오늘의 상태 · LINK BAND · 기기"는 `readiness` 의 false 항목(밴드 단계는 `linkband_mode==='none'`·기기 단계는 오프라인이면 제외 — 시안 `steps()` L344).
- `지금 입장하기`: `handleEnter` 에 게이트 우회 옵션(`force`)을 추가(`:324-336`)하고 미완 항목 목록을 `onEnter` payload 에 실어 올림. `준비 이어서 하기`: 시트만 닫음 → 기존 자동 입장 effect 가 그대로 동작.
- 호스트 쪽 영향: 회원이 `지금 입장하기` 를 누르면 `ClassWaitingRoom` 이 언마운트되며 presence `leave` 가 나간다(`useWaitingRoomPresence.ts:95`) — 호스트 구독이 꺼져 있으므로(§2-2 주의) 반응 없음.

**입장 후 미완 준비를 이어서 하는 경로 (진행 화면 `components/class/player/member`)**

| 미완 항목 | 진행 화면에서 이어서 가능? | 근거·재사용 |
|---|---|---|
| LINK BAND | **가능** — 기기 시트가 연결/연결 중/접촉 불량/미지원/끊김 전 상태를 이미 다룸 | `MemberSheets.tsx:223-326`, `MemberClassContainer.tsx:178`(`useBand` 단일 인스턴스, `enabled: connectionsActive`). 전역 BLE 서비스가 입장 시 끊기지 않으므로(`class-join-page.tsx:471-477` 주석: 명시적 종료 때만 해제) 대기실에서 연결해 둔 밴드는 그대로 이어짐 |
| 기기(마이크·카메라·스피커) | **일부** — 입장 후 마이크/카메라 토글은 진행 화면 컨트롤(`MemberMediaControls`), 스피커·볼륨은 소리 시트(`MemberSheets.tsx:123-215`). 대기실의 "마이크 레벨 확인" 같은 점검 UI 는 없음 | 시안 FM06d `-started` 는 "건너뛴 준비는 입장한 뒤 진행 화면의 도구에서 이어서"라고만 약속. 진행 화면 기기 점검을 어디까지 줄지는 plan 결정 |
| 오늘의 상태(설문) | **불가(UI 없음)** — 진행 화면에 사전 설문 진입점이 없고 컨테이너가 체크인 칩을 의도적으로 생략(`MemberClassContainer.tsx:569` "서버 저장 API 가 없어… 노출하지 않는다" 주석 — 그러나 API 는 있다). **API 는 in_progress 에서도 허용**: `POST /sessions/{id}/checkin` 의 `phase='before'` 는 cancelled 만 막음(`record_service.py:320-331`, 라우터 `api/v1/records.py:49-65`) | 재사용 가능한 컴포넌트: `components/class/PreCheckinPanel.tsx`(props: sessionId·participantId·participantToken·isLoggedIn·draft·onDraftChange·onSubmitted·onSkipped — `ClassWaitingRoom.tsx:437-439` 사용례). 시트 1개 신설해 이 패널을 넣으면 된다 |

**건너뛴 항목을 진행 화면이 이어받으려면 프론트 상태를 어디에 두나**
- 현재 `readiness`·`surveyDraft`·`bandSkipped`·`checkin`·`recheckingPrep` 은 모두 `ClassWaitingRoom` 의 로컬 `useState`(`:80-95,124`)라 `step='meditation'` 로 넘어가면 사라진다. 진행 화면 쪽 `MemberClassContainer` 에는 대기실 상태를 받는 prop 이 없다(`class-join-page.tsx:495-511` 의 `MemberSessionScene` props 에 없음).
- 선례: 같은 페이지가 이미 `participantId`·`participantToken` 을 `sessionStorage('mb_join_participant')` 에 보관·복원한다(`class-join-page.tsx:39,79-109`). 권장: **`class-join-page` 가 `prep`(= `{surveyDone, surveySkipped, bandDone, bandSkipped, deviceDone, surveyDraft}`)을 소유**하고 대기실 씬·진행 씬에 props 로 내려주며 `sessionStorage`(키 `mb_join_prep:{sessionId}`)에 미러링(새로고침 복원). 프로젝트 규칙상 클라이언트 상태는 Zustand 허용이므로 동일 내용을 작은 스토어로 둘 수도 있으나, 입장 마법사(FM06)·진행 씬이 같은 페이지 하위라 props+sessionStorage 가 가장 변경이 작다.
- 입장 후 늦게 제출한 설문은 **호스트 화면에 실시간으로 안 뜬다**: presence 는 `ClassWaitingRoom` 에서만 보내고(`ClassWaitingRoom.tsx:128`), 서버 중계는 `waiting_room` 만 호스트에 알린다. 저장(`submit_checkin`)은 되므로 리포트의 `before` 로는 남는다(§5-3).

### 2-5. 알림 재전송·초대 추가 API (S6)

**서버 엔드포인트 전수** (`api/v1/session.py` 라우트 목록, `grep remind api/` 결과 없음)
- `remind`/`reminder`/`waiting_room_reminder`/`invite` 중 존재하는 것: **`POST /sessions/{id}/invite`**(`:292-299`)와 **WS `waiting_room_remind`**(`ws:791-825`)뿐. 예약 사전 안내 `reminder_service`(`services/reminder_service.py`)는 Celery ETA 로 `scheduled` 세션의 시작 N분 전에만 발송하는 **자동 리마인더**이며 호스트가 수동 호출하는 API 는 없다(`run_reminder` 는 `scheduled/ready/open` 상태와 `scheduled_at` 필수, `reminder_service.py:320-372`).

**WS `waiting_room_remind` 의 실제 도달 범위**
- 클라이언트는 **대기실에 들어와 있는데 3단계 미완인 회원**만 대상으로 보낸다(`waiting-room-readiness-panel.tsx:35,44`: `pending` = presence 목록 중 미완).
- 서버는 대상 id 가 이 세션의 활성 참가자인지만 검사하고(`ws:809-816`) 각 `participant_id` 의 **본인 룸**(`session:{id}:self:{pid}`)으로 emit 한다(`ws:817-821`). 그 룸에는 **WS 로 `join` 한 소켓만** 있다 → 아직 앱을 열지 않은 초대 회원에게는 닿지 않으면서도 응답은 `{"ok":true,"sent":len(targets)}` 로 성공을 돌려준다(실제 수신자 수 미집계). 호스트 UI 문구 "서버가 N명에게 보낼 안내를 수락했어요"(`waiting-room-readiness-panel.tsx` 의 `setMessage`)는 전달 보증이 아니다.
- 메시지는 고정 문구 "설문·링크밴드·기기를 확인해 주세요"(준비 독촉용). "입장해 주세요"류 문구 없음.

**`POST invite` 로 초대 추가(FH06a `초대 추가`)가 가능한가**: **가능.** `completed/cancelled` 만 거부(`session_service.py:1269-1270`), `open`·`in_progress` 에서도 동작, 정원이 차면 대기열(`:1290-1300`), 이미 초대되면 409(`:1285-1288`). 호출 `inviteParticipant(id,userId)`(`lib/api/session.ts:377`). UI 재사용: `components/session/ParticipantPicker.tsx`(상세 `SessionDetailPage` S-H11 이 이미 사용). 제약: 참여자 목록 조회가 `GET /clients?size=50` 이라 최대 50명(survey S-H07 ⑥).

**초대 시 알림은 어디까지 가나**: `invite_participant` → `_notify_participants_event(session_invited)`(`:1314-1321`) → `notification_service.notify_event`(`services/notification_service.py:207-278`) = **인앱 알림 행 + WS outbox(실시간) + (사용자 설정 시) 이메일 outbox**. **세션 이벤트에는 FCM 푸시 outbox(`channel="push"`) 를 만드는 코드가 없다**(`channel="push"` 생성처는 `agent_service.py:327`, `chat_service.py:1448`, `agent_risk.py:429` 뿐). 오픈 시점 알림 `session_opened`(`:954-974`)도 같은 경로이므로, 오픈 이후에 초대된 회원은 "오픈됨" 알림을 못 받고 "세션에 초대되었습니다"만 받는다.

**시안 FH06a `invite` 시트가 필요로 하는 데이터 대비**

| 시안 요소(host-b L516-528) | 현행 | 판정 |
|---|---|---|
| `초대 N명 · 대기실 M명` | live-metrics + presence | 있음(§2-2) |
| `아직 입장하지 않은 회원 N명` 목록(이름) | live-metrics − presence | 있음 |
| `N명에게 다시 알림` 버튼 | 엔드포인트 없음 | **없음** |
| 사람별 `오후 2:30에 알렸어요` / `알림이 전달되지 않았어요` + `재시도` | 알림 전달 결과를 호스트에 돌려주는 API·필드 없음. `SessionParticipant.joined_at`(초대 행 생성시각, `models/session.py:112`)은 있으나 `ParticipantInfo` 에 직렬화되지 않음. 알림 실패는 서버가 best-effort 로 로그만 남김(`session_service.py:1057-1108`) | **없음** |
| 클래스 링크 복사(로그인 필요 딥링크) | 코드 기반 링크만(`handleCopyCode`) → 결정 1 이후 별도(I-입장) | 타조사 |
| `초대 추가` | `POST invite` + `ParticipantPicker` | 있음 |

**신규 엔드포인트 최소안** (B1, 마이그레이션 없음)
- `POST /sessions/{id}/invitees/remind` — 호스트 전용(`_get_session_as_host`). body `{participant_ids?: string[]}`(생략 시 서버가 "대기열 제외 + 회원(user_id 있음) 전체"가 아니라 **클라이언트가 보낸 id**만 처리: 서버는 presence 를 모르므로 "입장 안 한 사람"은 호스트 클라이언트가 계산해 보낸다). 상태 `open`·`in_progress`·`ready`·`scheduled` 허용, `completed/cancelled` 400.
- 동작: 대상별로 `notification_service.notify_event` 호출(문구 "상담사가 클래스를 열었어요. 입장해 주세요"; 이벤트 키는 신규 `session_remind` 를 `EVENT_CATALOG` 에 추가하거나 기존 `session_opened` 재사용), 대상별 쿨다운(예: 60초 — `Notification` 에서 `extra.event_type`·session_id 최근 행 조회로 판정, 새 컬럼 불필요).
- 응답: `{results:[{participant_id, status:'sent'|'skipped_cooldown'|'skipped_guest'|'failed', notified_at}]}` → FH06a 의 "알림 받음/재시도"를 채움. 게스트(user_id 없음)는 알릴 수단이 없으므로 `skipped_guest`.
- 프론트만의 대체안: 없음(미입장 회원에게 닿을 수단이 없음). 임시로 `다시 알림` 버튼을 숨기고 `초대 추가`만 남기거나, 대기실 안의 미완 회원 독촉(`waiting_room_remind`)만 `준비 독촉` 이름으로 유지.

### 2-6. 닫기/나가기(FH08)

- 현행: `나가기` = `navigate('/sessions')` → `useLeaveGuard`(open/in_progress 호스트만, `ClassPlayerPage.tsx:1025-1030`, `useLeaveGuard.ts` 의 `useBlocker` + `beforeunload`) → `LeaveGuardModal`(`components/player/LeaveGuardModal.tsx`): open 이면 `나가기(오픈 유지)`/`클래스 닫고 나가기`/`계속 진행` 3버튼, 본문이 닫기의 파괴성(회원 전원 퇴장)을 설명하지 않음. `클래스 닫기`(헤더 X)는 **확인 없이** cancel(`:1556,1085-1101`).
- 시안 FH08: `choose`(나가기 / 클래스 닫기 / 계속 준비하기, 대기 회원 N명 표기)·`choose-0`(0명)·`confirm`(재확인, 코랄). 모두 `useLeaveGuard` 의 blocker 상태(`onStay`/`onLeaveKeepOpen`/`onCloseAndLeave`, `:1459-1479`)로 대응 가능 — 3분기 매핑: `나가기`=`blocker.proceed`, `클래스 닫기`→재확인→`closeClass(false)` 후 `blocker.proceed`, `계속 준비하기`=`blocker.reset`. 헤더 X 닫기 버튼은 제거하거나 같은 시트의 `confirm` 으로 연결해야 한다(현행 확인 없음 해소).
- 시안 가정 S3 "닫으면 대기 회원 전원에게 닫힘 안내가 전달된다": **서버가 이미 한다.** cancel → `_notify_session_state`(WS `session_state_changed` 를 공용 룸 `session:{id}:all` 에 발행, `ws:1005-1015`) + `_notify_participants_event('session_cancelled', include_waitlisted=True)`(인앱 알림+WS outbox+선택 이메일, `session_service.py:946-974`). 푸시(FCM)는 없음.
- 대기 회원 N명 수치: 서버가 주는 값 없음. **클라이언트가 `waitingRoom.count`(대기실 presence)로 계산**(`ClassPlayerPage.tsx:1654-1664` 가 이미 쓰는 값). 초대 인원은 `displayMetrics.length`. FH10 `closed — 회원 3명 안내`의 3 도 닫기 시점 `waitingRoom.count` 를 보관해 쓰면 된다(백엔드 불필요). 주의: presence 는 휘발성·유실 가능(§2-3b)이라 "대기 중 N명" 문구는 "대기실에 있는 회원"으로 한정하는 게 정확.
- 회원 쪽 반응(FM10 `cancelled/closed` 대응): `class-join-page.tsx`
  - details/waiting 단계에서 취소 수신(WS `:158-161`, 3초 폴링 `:257-261,275-278`) → 오류 문구 "이 클래스는 이미 종료되었거나 취소되었습니다." + `setStep('code')`. **결정 1 로 `code` 단계가 사라지므로 이 분기 전체를 FM10 `cancelled` 화면으로 바꿔야 한다.**
  - meditation 단계 취소는 WS 핸들러가 없고(`class-join-page.tsx:149-162` 는 waiting/details 만) 4초 폴링이 `state.status==='cancelled'` 를 보고 `setStep('complete')` + "클래스가 취소되었습니다."(`:299-338`) → **종료 화면(MemberEndScene)에 취소 배너가 붙는 형태**. FM10 `cancelled` 로 분기할 필요.
  - 회원 진행 컨테이너의 소켓은 `onSessionStateChanged` 를 안 받는다(`MemberClassContainer.tsx:297-305`).

### 2-7. 세팅(FH05) 진입 규칙

- 진입: `ready`·`scheduled` 모두 같은 세팅 씬(`ClassPlayerPage.tsx:967`)이고 `클래스 오픈` 은 상태·예약 시각과 무관하게 바로 동작(`:1033-1047`; 서버 `session_service.py:36`). **예약 시각 이전 오픈 제한은 서버·프론트 모두 없다**(survey S-H15 "예정 시각 이전에도 오픈 가능"의 코드 근거). 현행 세팅 씬에는 예정 시각 표시가 없고(`ClassPlayerPage.tsx:1801-1827` 헤더), SessionDto 는 `scheduled_at` 을 내려준다(`session_service.py:96`) → FH05 `오늘 오후 3:00 시작 예정` 표시는 프론트만으로 가능.
- 오프라인 장비 단계 생략(시안 FH05 `offline`): 현행에서 장소 분기는 로비의 BGM 패널(`:1887`)뿐이고 세팅 프리뷰는 장소와 무관하게 카메라·마이크를 요청한다. 오프라인 세팅에서 프리뷰를 안 띄우면 `mediaPrefs` 가 기본값 `{cameraOn:true, micOn:true}`(`:592-595`) 그대로 남아, `startClass` 가 **오프라인에서도 영상 녹화를 시도**하고(`:1073-1075` 조건 `recordVideo && mediaPrefs.cameraOn`) 녹음 동의 모달을 띄운다(`:1071-1072`). 시안 FH05 offline 은 "카메라와 마이크는 쓰지 않아요"인데 FH07 offline 은 녹음 동의를 받는다(S4 "오프라인도 이 기기 마이크로 녹음") → **오프라인 세팅 확정 시 `mediaPrefs` 를 `{cameraOn:false, micOn:<S4 결정>}` 로 명시 설정**해야 한다(§5-2).
- LiveKit(survey §9-8): `startClass` 가 `location_type` 검사 없이 `liveKit.connect()` 호출(`:1058`) → `joinSession`+`getLiveKitToken`(`useLiveKit.ts:18-24`). 렌더는 온라인만(`HostLiveContainer.tsx:128,364` `online && liveKit.token`) → 오프라인에서도 **토큰 요청은 나가지만 화면엔 안 쓰인다**(낭비·무해). 수정: `startClass` 에서 `session.location_type==='online'` 일 때만 connect(1줄), `handleStartClick`(`:1104-1111`)의 보조 connect 도 동일.
- 마이크 OFF/거부 경고 우회(P0-6) 해결을 위한 오픈 버튼 핸들러 변경
  - 현행: 헤더 `클래스 오픈` 이 `openClass(mediaPrefs)` 직접 호출(`:1543`), 프리뷰 내부 `startButton`(마이크 OFF 확인 다이얼로그 `SessionPreJoinPreview.tsx:235-247,257-290`)은 `compact` 라 숨김(`:498`) → 확인 불가 경로.
  - 필요 변경: FH05 의 `클래스 열기` CTA 를 **장비 컴포넌트 안(또는 장비 상태를 props 로 받는 컨테이너)** 에 두고 `openClass` 를 `requestOpen()` 으로 감싼다 — `micState`(on/off/denied/nodevice/unsupported)를 페이지가 알아야 하므로 프리뷰의 `onPrefsChange({cameraOn,micOn})`(`SessionPreJoinPreview.tsx:213-215`)를 `{micState, camState}` 로 확장. 규칙(시안 `mic-off-warn`, host-b L415-418): 사용자가 마이크를 **꺼 둔 채**(`micState==='off'`) 열 때만 3지선다 시트(`마이크 켜고 열기` / `꺼진 채로 열기(수동 기록)` / `돌아가기`). `denied`/`nodevice`/`unsupported` 는 시안상 시트 없이 인라인 안내 + 열기 허용(`mic-denied` L383, `nodevice` L385). 이 규칙을 정책으로 확정할지는 §5-5.
  - 참고: 오픈 후 새로고침하면 `mediaPrefs` 가 기본값 `{true,true}` 로 초기화된다(`:592`, 상태가 페이지 로컬) → 로비에서 시작할 때 마이크를 켠 것으로 간주해 `startAudio(id,false)` 선언이 빠지고 동의 모달이 뜬다(`:1060,1071`). 세팅 확정값을 `sessionStorage` 에 보관하거나 시작 확인 시트(FH07)에서 `mic`/`consent` 를 다시 확인하는 것으로 흡수해야 한다.

### 2-7b. FH07 시작 확인 시트가 프론트에서 필요로 하는 것
- 준비 인원·준비 중 회원(이름+미완 단계 칩): §2-2 집계만으로 충분(시안 `stepChips` L592-593 = `readiness` false 항목, 밴드는 `lead_off` 있으면 `bad`(I5)).
- 녹음 동의 체크(시작 전, S2): 현행은 시작 직후 `ConsentModal`(`ClassPlayerPage.tsx:1068-1072,1449-1457`)이고 서버 저장은 `startAudio(id, consent)`(`lib/api/audio.ts`, 호출 `:1062,1121`)가 시작 후에 한다. 시작 전 시트에서 받은 체크 값을 `startClass(consent)` 인자로 넘겨 `transitionSession('start')` 직후 `handleConsentConfirm` 로직을 모달 없이 실행하면 된다(서버 변경 없음; 동의 영속 저장 A1 은 I-동의 소관).

### 2-8. 비호스트 분기 영향 (SDD-208 plan F2 참고)
- `/sessions/:id/player` 에는 RoleGuard 가 없다(`App.tsx:193`). `isHost && (isSetup||isLobby)`(`:1831`)를 신규 호스트 컴포넌트로 교체해도 비호스트 경로는 그대로다 — 비호스트는 세팅 씬에서 헤더만 보이고, 로비에서만 `monitorPanel`(`:1914`)을 보며 이 두 가지는 이번 교체 범위에 없다. 호스트 판정 `host_id === currentUserId`(`:609`)도 불변.

---

## 3. 변경 목록

### 3-1. 프론트

| 파일 | 변경 | 규모 |
|---|---|---|
| `pages/sessions/ClassPlayerPage.tsx` | (1) `canStart`·`activeCount` 의 인원 조건 제거(`:1322-1331`) (2) `useWaitingRoomCount enabled` 를 `isLobby||isRunning` 으로(`:995`) (3) `isSetup`/`isLobby` 분기에서 신규 `HostSetupContainer`·`HostLobbyContainer` 로 조기 return(진행 중 선례 `:1482-1533`) (4) `openClass` 를 `requestOpen(prefs)`+마이크 확인 시트 흐름으로(P0-6), 오프라인은 `mediaPrefs={cameraOn:false,...}` 명시 (5) `startClass(consent)` 로 시작 전 동의 입력, 시작 후 모달 제거 (6) 장소 `online` 일 때만 `liveKit.connect()`(`:1058,1107`) (7) 닫기에 재확인 시트 연결, 헤더 X 즉시 cancel 제거 (8) 닫기 시점 `waitingRoom.count` 보관(FH10 안내 인원) | M |
| `components/class/player/host/HostSetupContainer.tsx`·`HostSetupView.tsx` (신규) | FH05: 내 영상·소리 합친 컴포넌트, 마이크 5단계 링, 오프라인 분기, 경고 시트, `scheduled_at` 표시. `SessionPreJoinPreview` 는 이모지·영문 아이브로우(`:297,362-413`)가 있어 신규로 대체 | L |
| `components/class/player/host/HostLobbyContainer.tsx`·`HostLobbyView.tsx` (신규) + `sheets/`(초대·BGM·내 밴드·발언권·채팅) | FH06/FH06a/FH07/FH08. 행 = `displayMetrics`(기준) ⊕ `waitingRoom.entries`(덮어쓰기), 상태줄 `statusLine`, 항상 활성 `시작하기`, 시작 확인 시트 | L |
| `lib/class/host-lobby-model.ts` (신규, 순수 함수) | 조인(`participant_id`)·집계(초대/대기/준비/미입장)·셀 상태(ok/wait/skip/na/bad) 파생. 시안 `members()/isReady/statusLine` 과 같은 키 이름 | M |
| `components/class/waiting-room-readiness-panel.tsx` | 신규 로비가 대체하면 삭제 대상(또는 데이터 조각만 `host-lobby-model` 로 이전). 단위 테스트 `tests/waiting-room-readiness-panel.test.ts` 동반 정리 | S |
| `pages/sessions/ClassPlayerPage.tsx` 내 `HostClassWorkspace` + `components/class/host-class-player.css` | 호출처가 사라지면 컴포넌트 삭제(`tests/host-class-workspace.test.tsx` 동시 삭제). css 는 완료·취소·오류 씬이 쓰는 `.host-class-player`/`.hcp-hbtn` 규칙 때문에 FH09/FH10 교체 후 제거 | M |
| `hooks/useWaitingRoomPresence.ts`, `ClassWaitingRoom.tsx` | (회원) 첫 알림 레이스 완화: `join` 응답(`joined`) 수신 후 첫 `waiting_room` 전송 또는 짧은 재시도(§2-3b 후보 2). 신규 회원 마법사(FM06) 로 대체되면 훅만 유지 | S |
| `components/class/ClassWaitingRoom.tsx`(또는 신규 FM06 마법사) | `startedSheet`(`지금 입장하기`/`준비 이어서 하기`), `handleEnter({force})` 게이트 우회(`:324-336`), 미완 항목을 `onEnter` 로 전달 | M |
| `pages/class-join-page.tsx` | `prep` 상태(설문·밴드·기기 완료/건너뜀·설문 초안) 소유 + `sessionStorage` 미러, `MemberSessionScene` 에 전달(`:495-511`), 취소 분기를 `step='code'` 대신 FM10 으로(`:158-161,257-260,275-278`), meditation 중 취소 분기 추가(`:299-338`) | M |
| `components/class/player/member/MemberClassContainer.tsx`·`MemberSheets.tsx` | 미완 준비 진입점: 설문 시트 신설(`PreCheckinPanel` 재사용, `phase:'before'`), 기기 시트에 "남은 준비" 안내. 체크인 칩 주석(`:569`) 정정 | M |
| `lib/api/session.ts` | (B1 채택 시) `remindInvitees(id, participantIds)` | S |
| 테스트 | `tests/class-player-page-live.test.tsx`(세팅·로비가 구형 워크스페이스라는 전제 주석 `:3`), `tests/waiting-room-readiness-panel.test.ts`, `tests/class-waiting-room-presence.test.ts`·`class-waiting-room-flow.test.ts`·`class-join-waiting.test.ts`, 신규 `host-lobby-model` 단위 테스트(0명·초대만·일부 준비 중·전원 준비·오프라인 na·밴드 none na) | M |

### 3-2. 백엔드

| 엔드포인트/모델/마이그레이션 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 |
|---|---|---|---|---|
| (B1) `POST /sessions/{id}/invitees/remind` (`api/v1/session.py`, `services/session_service.py` 또는 신규 `invitee_reminder` 함수, `notification_service.EVENT_CATALOG` 에 `session_remind` 추가 또는 `session_opened` 재사용) | 미입장 초대 회원 대상 알림 재발송 + 대상별 결과 반환. **마이그레이션 없음**(`Notification`·outbox 재사용, 쿨다운은 최근 알림 조회) | **필수**(FH06 `다시 알림` 버튼과 FH06a 시트를 실제 동작시키려면. 안 하면 버튼 제거) | 신규 엔드포인트라 영향 없음. 이메일 선호 기본값이 꺼져 있으면 인앱+WS 만 전달(푸시 없음) | `tests/test_session_remind.py`(신규): 호스트 외 403, 완료/취소 400, 쿨다운 skip, 게스트 skip, 대기열 제외, 알림 행 생성. 참고 패턴 `tests/test_sdd097_session_reminders.py` |
| (B2) 초대 알림 전달 상태·시각 조회(FH06a 사람별 `오후 2:30에 알렸어요/전달 안 됨`) — `ParticipantInfo` 에 `invited_at`(= `joined_at`) 직렬화 또는 `GET /sessions/{id}/invitations` | 알림 결과 영속 조회 | **권장**(대체: B1 응답의 `notified_at`/`status` 로 호스트 세션 중에만 표시, 첫 초대 알림 결과는 생략) | 추가 필드는 additive, `joined_at` 은 기존 컬럼 | `tests/test_session.py` 직렬화 케이스, 알림 실패 시 상태 |
| (B3) `waiting_room.readiness` 확장: `surveySkipped/bandSkipped/deviceSkipped`(optional boolean) 및 전극 접촉(I5와 협의) — `ws/session_live_namespace.py::_sanitize_readiness`(`:1412-1417`)가 3 boolean 외를 버림 | 허용 키 추가(하위 호환: 기존 클라이언트는 3 boolean 만 보냄) | **권장**(시안 `skip`·`bad` 칩용. 대체: `skip` 을 `ok` 로 표시, `bad` 생략) | 기존 payload 그대로 통과 | `tests/test_class_waiting_room_presence.py`(sanitize 케이스 추가) |
| (B4) 호스트 join 스냅샷/요청에 현재 대기실 목록 포함(서버 메모리 presence, 기존 단일 워커 제약 `ws:44-52` 동일) | 호스트 새로고침·늦은 접속 시 최대 15초 공백 제거, presence 유실 시 복구 | **권장**(대체: 프론트에서 초대 명단 기준 행 + 15초 heartbeat 수렴) | 메모리 상태라 데이터 영향 없음 | `tests/test_sdd024_session_live_ws.py` 확장 |
| (B5) `ParticipantInfo` 에 `user_name`/`user_email` 추가(A6) | 상세·`participantsToMetrics` fallback 의 이름 UUID/"참가자" 버그 해소 | **보류**(I-A6 조사 소관. 이 구간은 `live-metrics.display_name` 사용으로 불필요) | additive | — |
| (B6) 시작 후 입장 회귀 방지 테스트(코드 변경 없음) | `in_progress` 상태 by-code join(로그인·게스트) 200, `livekit-token` 발급 검증 | **필수(테스트만)** | — | `tests/test_sdd021_session_class_flow.py` 에 추가 |
| 시작 최소 인원 | **변경 없음**(이미 0명 허용) | — | — | 기존 `test_01`, `test_04` 가 회귀 보호 |
| 예약 시각 이전 오픈 | **변경 없음**(제한 없음 유지 — §5-4) | — | — | — |

**판정: "준비 중 회원 이름·미완 단계"와 "초대 N명" 집계에 백엔드 변경은 필요 없다.** 필수 백엔드 변경은 `다시 알림`(B1) 하나뿐이고 그것도 해당 버튼을 포함할 때만이다.

### 3-3. 프론트만으로 가능한 대체안
- 집계·준비 중 회원 목록·FH07 시트·FH08 시트·시작 항상 활성·오프라인/마이크 확인 시트: 전부 프론트만.
- `다시 알림`: 프론트만으로는 입장 전 회원에게 불가 → 버튼을 대기실 안 미완 회원 대상 `준비 독촉`(현행 `waiting_room_remind`)으로 축소하거나 B1 을 함께 배포.
- `건너뜀`/`접촉 불량` 셀: 현행 payload 로는 `완료`만 가능(skip·bad 생략).
- 입장 후 이어서 하기: 설문 시트·`prep` 보관소 모두 프론트만(API 이미 허용).

---

## 4. 위험·주의

1. **시작 후 구독 소멸**: `useWaitingRoomCount` 가 `isLobby` 에서만 켜짐 → 시작 직후 `entries` 가 사라져 "아직 준비 중인 회원"이 호스트에게 안 보인다. 구독 조건 변경이 선행돼야 한다(§2-2).
2. **presence 휘발성**: 호스트 새로고침 시 회원 heartbeat(≤15초)로 복구, 회원 탭이 백그라운드에서 타이머 스로틀되면 45초 TTL 로 깜박일 수 있다. 시안 `대기실 M명` 은 정확한 서버 값이 아니라 "최근 45초 이내 신호".
3. **`waiting_room_remind` 가 성공을 과장**: 전달 수 미집계. 신규 UI 에서 이 응답을 "N명에게 보냈어요"로 쓰지 말 것.
4. **오픈 후 새로고침 시 `mediaPrefs` 초기화**(§2-7) — 시작 확인 시트에서 마이크·녹음 동의를 재확인하도록 설계.
5. **오프라인 `mediaPrefs`**: 프리뷰 없이 열면 기본 `{camera:true, mic:true}` 가 남아 오프라인에서 영상 녹화를 시도할 수 있다.
6. **회원 입장 엔드포인트 신설과의 의존**(결정 1): 로그인 `join_session` 은 `open` 을 거부하고 `consent_eeg` 를 안 쓴다. 코드 제거 시 회원이 `open` 단계에 어떻게 참가자로 등록·동의 기록되는지 I-입장/동의 조사와 반드시 맞춰야 한다. by-code 의존 코드: `class-join-page.tsx`, `getSessionByCodeState`(3초 폴링), `member livekit-token(by-code)`.
7. **기존 데이터**: 이 구간 변경은 읽기·상태 전이·알림만 다루고 스키마 변경이 없어 과거 세션 `access_code`·게스트 참가자(`user_id IS NULL`) 데이터에 영향이 없다. 단 회원 쪽 취소 분기·`prep` 보관소는 게스트 경로(`!isLoggedIn`)를 깨지 않도록 읽기 호환 유지(결정 1 비범위 조항).
8. **알림 채널**: 세션 이벤트는 FCM 푸시를 만들지 않는다. "다시 알림" 문구를 푸시로 오해하지 않게 시안 문구("알림")와 실제 채널(인앱+실시간) 차이를 plan 에 명시.
9. **24시간 자동 닫힘**(`session_service.py:979-1030`): FH08 "열린 채로 두어요" 안내와 동작 차이.
10. **배포 순서**: B1(서버) → 프론트 `다시 알림` 활성. 서버가 없을 때는 버튼 비노출(기능 플래그 또는 404 폴백). 프론트 교체(HostSetup/Lobby)는 서버 변경과 독립.
11. **호스트 본인 밴드**: `hostParticipantId` 가 null 이라 내 밴드 연결이 막혀 있을 가능성(코드 추정, I5 와 확인) — FH06a `band` 시트 구현 전 확정 필요.

---

## 5. 사용자 결정 필요 (비즈니스·정책만)

| # | 질문 | 옵션 | 기본값 제안 | 영향 |
|---|---|---|---|---|
| 1 | `다시 알림` 의 채널·빈도 | (a) 인앱+실시간(+기존 이메일 선호) 재발송, 쿨다운 60초 (b) 모바일 푸시(FCM) 추가 | (a). 푸시 콘텐츠는 비범위 | (b)면 push outbox 행 생성 로직 신규 + 앱 의존 |
| 2 | 오프라인 녹음(S4): 이 기기 마이크로 녹음 허용? 카메라는? | (a) 마이크만 허용·카메라 없음 (b) 오프라인은 녹음 없이 수동 기록만 | (a) | FH05 offline 문구("마이크는 쓰지 않아요")와 FH07 offline 동의 행 충돌 해소, `mediaPrefs` 규칙 |
| 3 | 시작 후 입장한 회원이 늦게 낸 설문을 상담사에게 실시간 노출? | (a) 리포트 `before` 로만 저장 (b) 진행 화면에도 즉시 표시(신규 이벤트 필요) | (a) | (b)면 서버 이벤트·호스트 UI 추가 |
| 4 | 예약 시각 이전 오픈 | (a) 현행대로 제한 없음 + FH05 에 예정 시각만 표시 (b) N분 전부터만 허용 | (a) | (b)면 서버 규칙 추가(시안에 없음) |
| 5 | 마이크 꺼짐/거부/장치 없음일 때 `클래스 열기` 경고 범위 | (a) 시안대로 사용자가 꺼 둔 경우만 3지선다 시트, 거부·장치 없음은 인라인 안내 (b) 모든 경우 시트 | (a) | P0-6 해소 범위 |
| 6 | 열린 채 방치(24시간) 자동 닫힘 | (a) 유지하고 시안 문구에 안내 추가 (b) 연장/폐지 | (a) | FH08 문구, 스윕 설정 |

---

## 6. 확인하지 못한 것

1. **설문 응답 전 호스트 목록 미표시의 근본 원인** — 코드 후보(레이스·`join_denied`·구독 시점)만 확인, 재현 로그/소켓 트레이스 미수행(dev 서버 접근 없음).
2. python-socketio `async_handlers` 기본 동작 — 로컬에 라이브러리가 없어 소스 미확인(`ws/__init__.py:80-81` 에 옵션 미지정만 확인).
3. 푸시(FCM·웹푸시) 구독·알림 클릭 딥링크의 도착 화면 — `notify_event` 에 push outbox 가 없다는 것까지만 확인(프론트 알림 센터·딥링크 라우팅 미조사, I-입장 소관).
4. 호스트 본인 `내 밴드` 연결 불가 여부 — 코드 추정(`hostParticipantId` null), 실측 안 함(I5).
5. `ClassWaitingRoom` 에서 준비 중 `in_progress` 수신 시 화면 변화 — 코드 판독만(브라우저 실측 안 함).
6. 회원 진행 컨테이너의 취소 즉시 반응(WS) — 컨테이너 소켓은 `onSessionStateChanged` 를 안 받는 것까지 확인, 실제 4초 폴링 지연 실측 안 함.
7. `GET /clients?size=50` 외 초대 대상 검색 한계(50명)의 서버 정의 — 프론트 호출만 확인(`ParticipantPicker.tsx` 본문 미정독).
8. 이메일 알림 선호 기본값(`DEFAULT_NOTIFICATION_PREFERENCES`) — `models/user.py` 미열람이라 `session_opened`/`session_invited` 의 이메일 기본 on/off 미확인.
