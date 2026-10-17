# I9 대기열(A4)·시작 대기·종료·닫힘/오류 — 코드 조사

> 기준: develop `32fa5533`, 조사일 2026-10-17, 읽기 전용(코드 실행·빌드 없음, 정적 읽기만). 경로 표기: 프론트는 `frontend/src/` 기준, 백엔드는 `backend/app/` 기준, 테스트는 `frontend/tests/`·`backend/tests/`. "재현"·"실측"이라고 쓴 곳 외에는 모두 코드 읽기로 확인한 사실이다.
> 확정 결정 1~8 과 충돌하는 발견은 없다. 다만 SDD-208 plan D6(종료 후 `/record` 점프 유지)과 시안 가정 S5 가 충돌한다(§5 결정 B).

## 0. 한 줄 결론

- **대기열**: 서버의 대기열 규칙은 "초대 수 = 정원"이라서(`session_service.py:1211-1231`, 초대 즉시 좌석 점유) 초대 기반 모델에서는 대기열이 **호스트가 정원보다 많이 초대했을 때만** 생기고, 자리는 **호스트가 회원을 제거하거나 정원을 늘릴 때만** 난다(§2.1). 승격 감지는 프론트만으로 `GET /sessions/{id}` 폴링(읽기 전용, 부작용 없음)으로 가능하고, 현행 5초 `join` 재호출은 호스트에게 `participant_changed` 를 쏘므로 쓰지 않는 편이 낫다. 백엔드 변경 필수 0건.
- **시작 대기**: 시작 예정 시각은 서버 응답(`by-code`·`GET /sessions/{id}`)에 이미 있지만 화면까지 전달되지 않는다. **준비 인원("6명 중 4명")은 회원에게 갈 데이터 경로가 없다**(대기실 presence 는 호스트 방 전용, `ws/session_live_namespace.py:1078-1092`). 프론트만으로는 "내 준비 + 초대 인원 수"까지만 가능.
- **종료(회원)**: `MemberEndView` 카드는 시안과 거의 같은 구조다. 손볼 곳은 ① 시트 안 라이트 카드(`.mp-legacy-panel`)와 레거시 두 패널, ② 시트 높이 상한(`min(58dvh, 520px)`)과 카드 자체 스크롤(`.mp-fv-card` `overflow-y:auto`)로 생기는 2중 스크롤, ③ 사후 체크인 완료 시 시트가 비는 문제(`SelfCheckinPanel.tsx:202`), ④ "함께한 시간"을 서버 `ended_at` 로 바꾸는 일.
- **종료(상담사)**: 시안 FH09 의 4단계(`end-saving/stt/ai/done`)는 서버 `steps[]` 4개 키(`save/stt/summary/ready`)와 **1:1**이다(`report_progress_service.py:44-55`). 같은 화면 진행으로 바꾸는 변경 규모는 M(페이지 1곳 + `HostEndingCard` 4단계화 + 테스트 2곳). 단 수동 기록 모드는 서버가 `generation_status=partial` 이면서 `ready` 단계는 `active` 인 상태를 내려 **현재 폴링 훅이 멈춘다**(§2.5-5).
- **FH10/FM10**: 오류 화면 두 곳이 서버 메시지 원문을 그대로 쓴다(`ClassPlayerPage.tsx:1419`, `ClientSessionDetailPage.tsx:233-236`). HTTP 분기는 axios 가 아니라 `ApiError.status` 로 하면 되고, 네트워크 단절은 `ApiError` 가 아닌 `TypeError` 로 던져진다(§2.6). 풀스크린 상태 템플릿은 `MemberFullView.tsx` 의 비공개 `FullScene`/`FullCard` 를 공용화하면 된다.
- 백엔드: **필수 0 / 권장 3 / 보류 3**. 사용자 결정 4건.

## 1. 현재 코드 상태 (있음/일부/없음)

| 항목 | 판정 | 근거 |
|---|---|---|
| 정원 초과 시 `is_waitlisted` 설정(코드 입장) | 있음 | `session_service.py:1589-1597`(회원 신규), `1654-1660`(게스트 신규) |
| 정원 초과 시 `is_waitlisted` 설정(호스트 초대) | 있음 | `session_service.py:1290-1300` |
| 생성 시 정원 초과 초대 | 거부(400) | `session_service.py:295-301` |
| 자동 승격 `_promote_waitlist` | 일부 — 제거 시에만 호출 | 정의 `1247-1264`, 호출 `1353`(`remove_participant` 한 곳). 정원 증가(`update_session` `737-738`)·회원 나가기에서는 호출 안 함 |
| 승격 알림 `session_waitlist_promoted` | 일부 — 인앱 알림만 | `session_service.py:1366-1373`, 카탈로그 `notification_service.py:35`, 인앱 기본 ON·메일 기본 OFF `models/user.py:30,61`. `notify_event` 는 ws·email outbox 만 적재(`notification_service.py:243-268`), **push 채널 없음** |
| 승격 시 WS 이벤트 | 없음 | `_notify_participant_changed` 는 `join_session_by_code` 두 곳에서만 발행(`1626`, `1677`), 호스트 방 전용(`ws/session_live_namespace.py:1020-1031`). 초대·제거·승격은 발행 안 함 |
| 회원이 본인 대기열 여부를 아는 경로 | 일부 | join 응답 `session.participants[]`(`schemas/session.py:123-142`), `GET /sessions/{id}`(참여자 조회 허용, `session_service.py:690-696`). `by-code`(`schemas/session.py:228-246`)·`by-code/state`(`schemas/session.py:400-427`)에는 없음 |
| 프론트 타입 `participant_id` | 반영됨(optional) | `lib/api/session.ts:22-23`. optional 인 이유는 `SessionDetailPage.tsx:71-83` 가 직접 객체를 만들기 때문 |
| 프론트 대기열 판별·진행 씬 | 반영됨 | `lib/class/waitlist.ts:5-10`, `pages/class-join-page.tsx:20,357,428`, `components/class/player/member/MemberClassContainer.tsx:85,399,534`, 화면 `MemberFullView.tsx:94-111` |
| 대기열 화면을 **사전 흐름(시작 전)**에서 보여 줌 | 없음 | `waitlisted` 는 `step==='meditation'` 일 때만 소비(`class-join-page.tsx:359-365,493-511`). `step==='waiting'`(준비·시작 대기)에서는 대기열 회원도 정상 준비 화면을 본다(`533-553`) |
| 대기열 회원이 호스트 "대기실 인원"에 잡힘 | 있음(문제) | `on_waiting_room` 은 `participant` 역할만 검사, `is_waitlisted` 미검사(`ws/session_live_namespace.py:753-785`) |
| 시작 예정 시각이 클래스 응답에 포함(A3) | 있음 | `by-code`: `schemas/session.py:242`, `session_service.py:1530`. 상세 DTO: `schemas/session.py:154`(`scheduled_at`), `157`(`opened_at`) 도 포함 |
| 시작 예정 시각이 대기 화면까지 전달 | 없음 | `ClassWaitingRoomProps`(`ClassWaitingRoom.tsx:33-55`)·`WaitingForStartProps`(`WaitingForStart.tsx:24-33`)에 prop 없음 |
| 준비 인원(A5)을 회원이 받음 | 없음 | `broadcast_waiting_room` 호스트 방 전용(`ws/session_live_namespace.py:1078-1092`), 훅 `useWaitingRoomCount` 는 호스트 화면용(`hooks/useWaitingRoomCount.ts`) |
| `준비 다시 확인하기` | 있음 | `WaitingForStart.tsx:107-113` → `ClassWaitingRoom.tsx:361-364` |
| 오프라인(대면)에서 BGM 제거 | 있음 | `useLobbyBgm(locationType === 'online')` `ClassWaitingRoom.tsx:139`, 대기 화면 `365`, 준비 화면 `638` |
| BGM 재생/일시정지 | 없음(볼륨·음소거만) | `LobbyBgmBar.tsx:1-3,56-72`, 엔진은 `pause()` 보유(`lib/class/audio-engine.ts:28`) |
| 시작되면 자동 입장 | 있음 | `ClassWaitingRoom.tsx:338-343`, `class-join-page.tsx:215-225,228-296` |
| 시작 대기 화면 시안 위반 요소 | 있음 | 영문 대문자 아이브로우 `WaitingForStart.tsx:85`, 명상 한마디 순환 `10-21,43-56,94-104`, 이모지 `LobbyBgmBar.tsx:58`, 대문자 mono `LobbyBgmBar.tsx:28` |
| 회원 종료 카드 | 있음 | `MemberFullView.tsx:122-153`(`MemberEndView`), 래퍼 `components/player/MemberEndScene.tsx` |
| 종료 시트 라이트 카드 래핑 | 있음 | `MemberEndScene.tsx:29-31,52-65`, 스타일 `components/class/player/member/member-player.css:347-348` |
| 사후 체크인 완료 시 빈 시트 | 있음 | `components/class/SelfCheckinPanel.tsx:202` `return null`, 버튼은 항상 노출 `MemberFullView.tsx:147-148` |
| "함께한 시간" 서버 값 | 없음(클라이언트 계산) | `MemberEndScene.tsx:37`, `lib/class/member-end.ts:4-8` |
| 상담사 종료 카드 `HostEndingCard` | 있음(하니스에서만 사용) | `components/class/player/host/HostEndingCard.tsx`, 사용처 `HostCaseHarness.tsx:20,153` 뿐 |
| 상담사 종료 후 같은 화면 진행 | 없음(`/record` 점프) | `ClassPlayerPage.tsx:1184-1210`(`navigate(leaveTo ?? '/sessions/${id}/record')` `1202`). `isEnded` 씬(`1949-1980`)은 종료된 세션을 직접 열었을 때만 도달 |
| 리포트 진행 4단계 서버 필드 | 있음 | `report_progress_service.py:44-55`(`save→stt→summary→ready`), 응답 `schemas/report.py:107-122`, REST `api/v1/records.py:68-80`, WS `report:progress` |
| 수동 기록 모드 표현 | 있음 | `report_progress_service.py:139-150`(save=skipped), `152-163`(stt=skipped), `165-182`(summary=skipped), reason `mic_off` `107-117` |
| 닫기(cancel) 후 회원 N명 안내 수치 | 일부 | 수신자 = 호스트 제외 전 참여자(대기열 포함) `session_service.py:946-973,1078-1081`. 저장된 카운트·"닫은 시각" 필드 없음(`models/session.py` 에 `cancelled_at` 없음, `transition_status` 는 `end` 일 때만 `ended_at` 기록 `887-908`) |
| 오류 화면에서 서버 메시지 원문 노출 | 있음 | `ClassPlayerPage.tsx:1411-1435`(`1419`), `ClientSessionDetailPage.tsx:60-62,233-236`, `class-join-page.tsx:61-77` 은 상태 분기+원문 폴백 혼재 |
| 상태 분기 가능한 오류 객체 | 있음 | `lib/api/client.ts:110-118`(`ApiError.status`), 408 `298`, 503 `329-335`, 일반 `348` |
| 사전 흐름의 네트워크 끊김 처리 | 없음 | `online`/`offline` 리스너는 진행 화면 컨테이너에만(`MemberClassContainer.tsx:505-510`, `HostLiveContainer.tsx:109-116`). `class-join-page.tsx` 폴링은 오류를 삼킨다(`281-286,328-330`) |
| 단일 풀스크린 상태 템플릿 | 일부 | `MemberFullView.tsx:41-84` 의 `FullScene`/`FullCard` 가 거의 그대로이나 비공개이고 코랄(warn) 톤·행 수 가변이 없음 |

## 2. 상세 조사

### 2.1 서버 정원 초과 처리

**좌석 계산.** `_active_participant_count` 는 `is_waitlisted=False` 인 `SessionParticipant` 행 수다(`session_service.py:1211-1221`). 회원이 입장했는지(presence)와 무관하게 **행이 있으면 좌석을 차지**한다. 호스트 행은 참가자 행이 없다(코드 입장은 호스트면 조기 반환 `1565-1567`).

**`is_waitlisted=True` 가 되는 경로 4개.**

| 경로 | 조건 | 근거 |
|---|---|---|
| 호스트 `POST /sessions/{id}/invite` | `_has_capacity` 거짓 | `session_service.py:1290-1300`. 초대 알림 `session_invited` 는 대기열 초대자에게도 같은 문구("세션에 초대되었습니다")로 나감 `1313-1320` |
| 코드 입장(회원 신규 행) | 정원 꽉 참 | `1589-1597` |
| 코드 입장(게스트) | 정원 꽉 참 | `1654-1660` |
| 재입장 시 해제 | `existing.is_waitlisted and _has_capacity` → 해제 | `1619-1623`(회원), `1670-1673`(게스트). **순번(`waitlist_position`)을 보지 않는다** — 자리가 나면 먼저 `join` 을 호출한 사람이 새치기 승격된다 |

생성 시에는 `len(participant_ids) > max_p` 면 400(`session_service.py:295-301`)이라 대기열이 생기지 않는다. 즉 **결정 1(초대 기반)에서 대기열이 생기는 유일한 경로는 생성 후 `invite_participant` 로 정원 초과 초대**다(코드 입장·게스트 경로는 I1/I7 에서 제거 대상).

**자리가 나는 경로.** `remove_participant` 만 승격을 호출한다(`1345-1353`, 1순위 한 명). 승격 시 `is_waitlisted=False`, `waitlist_position=None`, 나머지 순번을 1부터 다시 매긴다(`1258-1263`). 호스트가 `max_participants` 를 올려도(`update_session` `737-738`) 승격은 일어나지 않고, 대기열 회원이 재입장 호출을 할 때 비로소 해제된다. 회원이 "나가기"를 눌러도 서버에는 아무 호출이 없어(`class-join-page.tsx:471-490` `resetJoin` 은 로컬 초기화) 좌석이 유지된다. 따라서 **시안 FM08 문구 "자리가 나면 자동으로 입장해요"가 실제로 이뤄지는 때는 호스트가 누군가를 제거하거나 정원을 올릴 때뿐**이다(§5 결정 A).

**승격 알림.** `_notify_participants_event(... "session_waitlist_promoted", recipient_ids=[promoted_id] ...)`(`1367-1373`). `notify_event` 는 인앱 알림 행 + ws outbox(+선호 설정 시 이메일)만 만들고(`notification_service.py:241-268`) push outbox 는 만들지 않는다. 푸시 소비자 `tasks/push_task.py:39,80` 은 `channel="push"` 행만 집는다. 따라서 현행 문구 `notifyByPush: isAuthenticated`(`MemberClassContainer.tsx:399`)·`MemberFullView.tsx:105` "입장 알림은 이 기기와 푸시로 보내 드려요."는 **실제로는 인앱 알림**을 가리킨다. 시안 FM08 문구는 "입장 알림은 이 기기로도 보내 드려요."(`member-b.html:512`)다.

**참고(이력 확인).** SDD-208 plan F10·F12·B3(`specs/sdd-208-class-player-redesign/plan.md:21,23,142,248`)이 지적한 두 가지 중 ① `participant_id` 타입 누락은 이미 반영(`lib/api/session.ts:22-23`, `lib/class/waitlist.ts`), ② 대기열 회원이 진행 화면에서 LiveKit 403 만 보던 문제는 `MemberClassContainer` 가 `waitlisted` 면 연결을 만들지 않는 것으로 해소(`MemberClassContainer.tsx:85`). 서버 403(`session_service.py:1729-1730`)은 그대로다.

### 2.2 회원 사전 흐름에서 대기열 상태를 아는 방법

현재 흐름(`class-join-page.tsx`): `performJoin`(`396-451`)이 join 응답의 `participants[]` 에서 본인 행을 찾아 `setWaitlisted`(`428`) → `step='waiting'` → 준비·시작 대기는 대기열을 무시하고 진행하다가 `meditation` 단계에서야 `MemberWaitlistView`(`MemberFullView.tsx:94-111`)가 뜬다. 승격 감지는 `meditation && waitlisted` 일 때만 5초마다 `joinSessionByCode` 를 다시 부른다(`340-365`, 상수 `42`).

문제 3가지(사실).
1. 대기열 회원이 시작 전에 FM08 을 못 보고 준비 마법사를 끝까지 진행한다(`533-553`).
2. 그 5초 폴링은 `join_session_by_code` 를 호출하므로 매번 `_notify_participant_changed`(`session_service.py:1626`)가 호스트 방으로 나간다(SDD-208 R11 `plan.md:522` 가 예고한 부작용).
3. 대기열 회원도 `waiting_room` 을 보내 호스트의 "대기실 인원"에 잡힌다(`ws/session_live_namespace.py:753-785`, 클라이언트 `hooks/useWaitingRoomPresence.ts:41-100`) — "준비 완료 N명"이 부풀려진다.

**FM08 을 만드는 최소안.**

| 방안 | 변경 | 비고 |
|---|---|---|
| 프론트만(권장 기본) | 입장 확정 응답(I1 이 정할 입장 API 의 응답)의 `participants[]` 로 최초 판별 → `waitlisted` 면 준비 마법사 대신 FM08. 폴링은 `getSession(id)`(`lib/api/session.ts:312`) 5초 주기 — 참여자는 조회 가능(`session_service.py:690-696`), 읽기 전용이라 호스트에 이벤트가 안 나간다. 본인 행은 `user_id === auth user.id` 로 찾는다(사전 흐름은 회원 전용이므로 게스트 토큰 불필요). `is_waitlisted=false` 가 되면 마법사로 진행 | 시안의 "순위·경쟁 표현 금지"를 지키려면 `waitlist_position` 은 화면에 쓰지 않는다(서버는 다른 참여자의 순번까지 내려 준다 `session_service.py:139-140`) |
| 백엔드 권장 BE-2 | 승격 시 해당 참여자 방(`_room_self`, `ws/session_live_namespace.py:522-526`)으로 `participant_promoted` 발행 + 초대/제거/승격에서 `_notify_participant_changed` 발행 | 즉시 입장, 폴링 제거 가능 |
| 알림 | `new_notification`(`hooks/useNotificationSocket.ts:104`)의 `extra.event_type==='session_waitlist_promoted'` 로 감지 | 인앱 알림 설정을 끈 회원은 못 받는다(`notification_service.py:242`) → 보조 수단 |

### 2.3 시작 대기(`WaitingForStart`) — 시안 FM07 과의 차이

시안 FM07(`member-b.html:486-501`)의 구성: 칩 3개(방식·인원·LINK BAND) → 시작 예정 시각 + "약 5분 뒤에 시작해요" → 준비 현황 카드(그룹 "6명 중 4명이 준비를 마쳤어요" 바, 1:1 "내 준비를 마쳤어요") → 온라인 BGM 카드(곡명·재생/일시정지·볼륨) 또는 오프라인 장소 카드 → 하단 `준비 다시 확인하기` + "상담사가 시작하면 자동으로 입장해요."

| 시안 요소 | 현재 | 필요한 것 |
|---|---|---|
| 시작 예정 시각 | 없음 | `by-code`/상세 DTO 의 `scheduled_at` 을 `ClassWaitingRoom`→`WaitingForStart` 로 전달. 즉석 클래스는 `scheduled_at=null`(생성 시 일정 선택) → 시안에 없는 분기(계획에서 문구 결정). 예정 시각이 지난 경우("약 5분 뒤" 음수)도 시안에 없음 |
| "N분 뒤" | 없음 | 클라이언트 시계로 계산(`scheduled_at − now`) |
| 상담사 이름 | 없음 | `by-code.host_name`(`session_service.py:1522`)만 있고 상세 DTO(`schemas/session.py:146-185`)에는 없음 |
| 준비 인원(A5) | 없음 | 아래 참조 |
| 오프라인 장소 카드 | 없음 | `location_address` 는 상세 DTO(`_serialize` `session_service.py:107`)에만 있고 `by-code` 에는 없다(`schemas/session.py:228-246`) → 사전 흐름이 `GET /sessions/{id}` 기반이면 해결 |
| BGM 재생/일시정지 | 음소거만 | 시안 `bgmoff`("꺼짐", 볼륨 비활성) = 음소거 토글에 대응시키면 프론트만 가능. 진짜 일시정지는 `useLobbyBgm` 에 `paused` 추가(엔진 `pause()` 존재) |
| 자동 입장 | 있음 | 단 **`준비 다시 확인하기`로 되돌아간 상태에서 시작돼도 자동 입장한다**(`ClassWaitingRoom.tsx:338-343` 에 `recheckingPrep` 조건 없음) — 시안 R2-3a(준비 중 시작 시 `지금 입장하기`/`준비 이어서 하기` 시트)와 어긋남. 준비 미완 회원은 시작돼도 아무 안내가 없다(게이트 `canEnter` 거짓이면 대기) |
| 제거 대상 | — | 아이브로우 `A MOMENT FOR YOURSELF`(`WaitingForStart.tsx:85`), 8초 명상 한마디 순환(`10-21,43-56,94-104`), `LobbyBgmBar` 이모지 🔇🔊(`:58`)와 대문자 mono 라벨(`:28`) |

**준비 인원 데이터.** 호스트는 `waiting_room_changed`(participant_id·readiness{surveyDone,bandDone,deviceDone})를 받지만 회원은 못 받는다(`broadcast_waiting_room` 호스트 방 전용 `ws/session_live_namespace.py:1078-1092`, 서버는 대기 상태를 저장하지 않음 `753-785` docstring). 회원 화면에 줄 수 있는 값은 `participant_count`(by-code `session_service.py:1527`, 대기열 제외 행 수 = 초대 인원)와 본인 readiness 뿐이다.
- 프론트만: 그룹 카드를 "초대 N명 · 내 준비 완료" 로 바꾸거나, 그룹에서는 준비 바를 빼고 1:1 문구만 쓴다(시안 일부 포기).
- 백엔드 권장 BE-1: 서버가 `on_waiting_room` 수신 시 세션별 휘발성 집계(참가자별 마지막 신호·readiness)를 갖고 `{ready, total}` 만 `_room_all` 로 방송. 개인 식별 정보 없음. 서버 메모리 상태 도입(현재 설계는 stateless)이므로 TTL(호스트 훅은 45초 `useWaitingRoomCount.ts` 상단 상수) 일치 필요.

**A5(시작 판정).** 프론트 `canStart` 는 그룹이면 `activeCount>=1` 요구(`ClassPlayerPage.tsx:1328-1332`)지만 서버는 0명도 허용한다(`session_service.py:867-878`, SDD-101 로그). 결정 5(0명 시작 가능)는 서버 변경 없이 프론트 조건만 풀면 된다. 이 판정은 호스트 조사(I7/I8)와 겹치므로 사실만 적는다.

### 2.4 종료 씬(회원) — 컨테이너·재스타일·스크롤

- **구조**: `class-join-page.tsx:514-531` → `MemberEndScene` → `MemberEndView`(`MemberFullView.tsx:122-153`). 카드 라벨이 "수업"(`:95`, `:141`)이라 결정 7(클래스) 위반. 시트는 `PlayerSheet` 를 `FullScene` 의 `sheet` 슬롯에 넣는다(`:127-136`).
- **라이트 카드 래핑**: `LegacyPanelCard`(`MemberEndScene.tsx:29-31`) = `.mp-legacy-panel`(`member-player.css:347-348`, 연보라 크림 바탕). 안쪽 `SelfCheckinPanel` 은 다시 자기 카드(`border bg-white p-5` + `mt-8 max-w-md`)를 가져 **카드 안의 카드**가 된다(`SelfCheckinPanel.tsx:205-207`). 두 패널 모두 레거시 변수(`--mb-label-70`, `--mb-fg-muted`, `--mb-border`)와 `.mb-btn` 에 의존한다.
- **재스타일 범위**: `ReportEmailRequestPanel`(209줄, OTP 분기가 절반)·`SelfCheckinPanel`(261줄, `GuestCompletePanel` 에서도 쓰지만 그 컴포넌트는 `MemberEndScene` 도입 후 미사용 — `components/class/GuestCompletePanel.tsx`, `GuestMeditationPanel.tsx` 는 어디에서도 import 되지 않음). 결정 1 로 OTP 가 사라지면 리포트 패널은 "받는 이메일(읽기 전용) + 신청 1탭 + 신청 완료" 40줄 내외로 줄어 **재작성이 재스타일보다 싸다**(OTP 상세는 I2). 사후 체크인은 3축 선택 UI 재사용 + 스타일 교체.
- **2중 스크롤 원인(코드로 확인된 사실)**:
  1. 종료 카드 자체가 `max-height:100%; overflow-y:auto`(`member-player.css:325`)라 모바일에서 카드(로고·아이콘·정보 3행·버튼 3개)가 넘치면 **카드 뒤에서** 스크롤러가 하나 생긴다. 시안 FM09(`member-b.html:188-199` `.w-fv`)는 `overflow` 규칙이 없다.
  2. 시트는 `PlayerSheet` 의 `max-height: min(58dvh, 520px)`(`player-shared.css:184`)에 본문 `overflow-y:auto`(`:199`)다. 체크인 시트(3축×5단계 + 한 줄 소감 + 버튼 2개)와 안쪽 래핑 카드 패딩이 이보다 커서 본문이 스크롤된다. 시안 시트는 `max-height: calc(100dvh - 72px)`(host-b `.w-sheet` `host-b.html:133`)이고 member-b 는 상한이 없다.
  → 설계서 survey 의 실측(S-M19 모바일 251px+240px, S-M18 125px — `designs/class-flow-redesign/survey/회원-화면조사.md:264,266`)과 일치하는 원인이다. 이번 조사에서 재측정은 하지 않았다.
- **사후 체크인 완료 시 빈 시트**: `SelfCheckinPanel.tsx:202` 가 `phase==='skipped'||'done'` 이면 `null` 을 반환하지만 `MemberEndView` 는 버튼을 계속 보여 준다(`MemberFullView.tsx:147-148`). 시안은 완료 시 비활성 버튼 "오늘 상태를 남겼어요"(`member-b.html` FM09 `checked`). 필요한 것: 완료 여부를 `MemberEndScene` 이 알아야 하므로 `onSubmitted`(이미 prop 존재, `SelfCheckinPanel` 내부 `onSubmitted?.()`)를 연결하고, 건너뛰기 기록(`isSessionSkipped`)도 반영.
- **"함께한 시간" 서버 값 일치(survey §9-13)**: 현재 값 = `Date.now()`(씬 마운트 시점) − `startedAt`(`MemberEndScene.tsx:37`, `member-end.ts:4-8`). 서버 `ended_at` 은 종료 전이 때 기록되고(`session_service.py:887-908`) `GET /sessions/{id}`·join 응답(`_serialize` `session_service.py:100`)에 있으나 **`by-code`·`by-code/state` 응답에는 없다**(`schemas/session.py:228-246,400-427`). WS `session_state_changed` 는 `ended_at` 을 싣지만(`session_service.py:1125-1127`, 프론트 타입 `lib/socket.ts:207-213`) 회원 페이지 핸들러는 `status`·`started_at` 만 반영한다(`class-join-page.tsx:152-156`). 따라서 값이 서버와 다른 경우: ① 회원이 종료 알림을 늦게 받은 시간(폴링 4초 `333-335`)만큼 길어짐 ② 시작 후 늦게 들어온 회원도 클래스 전체 시간으로 표시 ③ `started_at` 이 없으면 계획 시간. **프론트만으로 해결**: 핸들러가 `ended_at` 도 저장하거나 종료 씬 진입 시 `getSession(id)` 한 번(`ended_at − started_at`).

### 2.5 상담사 종료(FH09)

**현행 흐름.** 종료 확인은 `HostLiveContainer` 의 레거시 `EndSessionModal`(흰 모달, 글머리 "·" 글리프, `components/player/EndSessionModal.tsx:28-30`, 사용처 `HostLiveContainer.tsx:377`) → `finishSession`(`ClassPlayerPage.tsx:1184-1210`): 녹음·녹화 정지(`1190-1197`, `handleStop` `1163-1182`) → `liveKit.disconnect()` → `transitionSession(id,'end')`(`1199`, **응답을 버린다**) → `setEndModalOpen(false)` → `bypassGuardRef=true` → `navigate('/sessions/${id}/record')`(`1202`). 실패 시 `endFailed` + 재시도(`1203-1207`). `isEnded` 씬(`1949-1980`)은 `ReportProgressStepper tone="dark"`(`1957-1961`)와 기록 보기·목록으로 버튼만 가진다.

**시안과의 차이.** 시안 FH09 는 종료 확인 시트(`confirm`, `confirm-busy`) → 같은 몰입 화면에서 4단계 진행 → `기록 보기`. 시안 문구 "48분 동안 8명이 함께했어요"(`host-b.html:652`)에 필요한 값: 분 = `ended_at − started_at`(종료 응답에 있음), 인원 = 아래 §5 결정 C.

**1. 단계 매핑(1:1 확인).**

| 시안 케이스 | 서버 `steps[]` (key: state) | 근거 |
|---|---|---|
| `end-saving`(stage 0) | `save: active` | `_save_step_state` `report_progress_service.py:139-149`(recording→active) |
| `end-stt`(1) | `save: done`, `stt: active` | `152-163` |
| `end-ai`(2) | `stt: done`, `summary: active` | `165-182` |
| `end-done`(4) | 전부 `done`, `generation_status=ready` | `_ready_step_state` `184-196` |
| `manual-ing`(3) | `save/stt/summary: skipped`, `ready: active` | `139-182` |
| `manual-done` | 위 + `ready: done` | `184-196` |
| (시안에 없음) | 어느 단계든 `failed`, `generation_status=partial` + `reason` | `152-163`, `107-136` |

라벨은 서버 `STEP_LABELS`(`report_progress_service.py:49-54`: "녹음 저장/음성 인식(STT)/AI 요약/리포트 완료")와 프론트 `REPORT_PROGRESS_STEP_LABELS`(`lib/api/report-status.ts`)가 같은 문구이고 시안은 "음성 인식"이다 → 키(`save/stt/summary/ready`)로 라벨을 새로 매핑하면 된다. 진행률 바는 서버 `progress`(0~100, `report_progress_service.py:256-286`)를 쓰면 되고 시안 값(25/50/75/90/100)과 단계별로 다르다(수동 기록 시안 70% vs 서버 계산 85%) — 시안 수치는 목업용이므로 서버 값을 쓰는 쪽이 정합.

**2. 현재 `HostEndingCard` 와의 차이.** 기본 3단계("기록 정리/AI 요약/리포트 생성", `HostEndingCard.tsx:14-18`)이고 `progress` 가 있으면 레거시 `ReportProgressStepper`(`components/session/ReportProgressStepper.tsx`)를 그대로 쓴다. 이 스텝퍼는 글자 기호 `✓ – !`(`ReportProgressStepper.tsx:57-67,152`)와 숫자 원, `bg-white/5` Tailwind 톤으로 **문자 글리프 아이콘 0 규칙·진행 화면 언어에 맞지 않는다**. 시안 FH09 는 lucide 계열 아이콘(`circle-check`/`loader`/`minus-circle`/`clock`)과 단계별 우측 상태 문구("완료/진행 중/기다리는 중/녹음 없음/건너뜀/메모로 만드는 중")다. → `ReportProgressStepper` 를 고치지 말고(기록 화면 `light` 톤 사용처 유지) 신규 사전 흐름용 스텝 목록 컴포넌트를 `components/class/flow/host/` 에 두는 편이 안전하다.

**3. 데이터 원천.** `useReportProgress(sessionId)`(`hooks/useReportProgress.ts`): 마운트 즉시 `GET /sessions/{id}/report-status` 후 5초 폴링(`:23`) + `/record` 소켓 `report:progress` 구독(`:134-170`). 페이지는 `isEnded` 일 때만 구독한다(`ClassPlayerPage.tsx:1016-1017`). 같은 화면 진행으로 바꾸면 `finishSession` 이 `transitionSession` 응답을 `setSession`(→`isEnded`)으로 넘겨야 구독이 시작된다. 지금은 `session_state_changed` 핸들러가 `ended_at` 을 반영하지 않으므로(`ClassPlayerPage.tsx:715-728`) 응답 값을 직접 써야 종료 시각이 정확하다.

**4. D6 번복 시 변경 규모(정리).**

| 선택 | 변경 | 규모 |
|---|---|---|
| (1) 같은 화면 진행(시안 S5) | `finishSession` 에서 `navigate` 제거 + 응답 `setSession`, `isEnded` 일 때 새 `HostEndingScene` 렌더(`HostEndingCard` 4단계화·시안 문구), `기록 보기` 버튼은 그대로 `/record` 로 이동, 종료 확인 시트(다크) 신규, 테스트 `class-player-page-live.test.tsx:195-216`(종료 후 `/record` 이동 단언 2건)·`class-player-host-container.test.tsx:248-260,386-410`(3단계 카드·종료 후 카드) 갱신 | M |
| (2) `/record` 점프 유지(D6 현행) | 시안 FH09 의 `end-*` 케이스는 "종료된 세션을 직접 열었을 때"(`isEnded` 씬)에만 쓰인다. 종료 확인 시트·씬 재스타일만 | S~M |
| (3) 하이브리드 | 같은 화면 진행 + 리포트 완료 시 자동 이동은 하지 않음(사용자가 `기록 보기`) = (1) 과 동일 | M |

**5. 위험: 수동 기록 모드에서 폴링이 멈춤(코드 읽기 확인, 실행 미검증).** 서버는 리포트 행이 아직 없고 `record.status=='manual'` 이면 `generation_status='partial'`(`report_progress_service.py:245-248`)이면서 `ready` 단계는 `active`(`184-196`)를 낸다. 프론트 훅은 `isReportGenerationDone`(= `ready|partial`)이면 폴링을 멈춘다(`hooks/useReportProgress.ts:126-132` "완료되면 폴링 중단" 효과) — 소켓 `report:progress` 는 계속 받으므로 서버가 push 하는 한 갱신되지만 소켓이 끊기면 `manual-ing` 에서 멈춘다. 레거시 스텝퍼도 이 상태에서 제목을 "리포트가 일부만 준비되었습니다"(`ReportProgressStepper.tsx:81-86`)로 보여 시안 `manual-ing`("메모로 만드는 중")과 어긋난다. → 신규 컴포넌트의 판정은 `generation_status` 가 아니라 **`steps[ready].state`** 로 한다(프론트만). 서버를 바꾸는 안은 보류(§3).

**6. 시안의 종료 확인 시트 문구.** 시안 "참여 중인 회원 8명의 화면도 함께 끝나요"(`host-b.html:633`)는 `activeCount`(`ClassPlayerPage.tsx:1322-1325`, 대기열 제외 행 수)로 만들 수 있으나 "참여 중"은 실제 접속이 아니다(§5 결정 C).

### 2.6 FH10 닫힘·오류 / FM10 회원 쪽 상태

**상담사 오류(1411-1435).** `if (!session && error)` 가 `error` 를 `<p className="break-words">{error}</p>` 로 그대로 출력한다(`ClassPlayerPage.tsx:1419`). `error` 는 `refreshSession` 이 `e instanceof Error ? e.message : '세션을 불러오지 못했습니다'` 로 넣는다(`:920-929`). 서버 문구는 404 "세션을 찾을 수 없습니다", 403 "접근 권한이 없습니다"(`session_service.py:656-671`), 네트워크 끊김은 브라우저 원문(`Failed to fetch` 등). **시안은 원문을 숨기고 4종 문구**(일반/찾을 수 없음/내 클래스 아님/연결 끊김)다.

**HTTP 분기 관례.** 이 프로젝트는 axios 가 아니라 `fetch` 래퍼 `apiClient`(`lib/api/client.ts`)를 쓴다. 오류는 `ApiError(status, message, data)`(`:110-118`)이고 서버 `detail` 이 `message` 로 들어간다(`:340-348`). 구분 규칙(코드 근거):

| 시안 | 판정 |
|---|---|
| `error-notfound` | `e instanceof ApiError && e.status === 404` |
| `error-forbidden` | `ApiError && status === 403` (참여자가 아닌 상담사/회원) |
| `error-network` | `ApiError && (status === 408 \|\| status === 503)`(타임아웃 `:298`, 토큰 갱신 중 네트워크 `:329-335`) **또는 `ApiError` 가 아닌 오류**(fetch 실패는 `TypeError` 그대로 던져진다 `:296-301`) 또는 `navigator.onLine===false` |
| `error`(일반) | 그 밖의 `ApiError`(5xx 등) |

선례: `class-join-page.tsx:61-77` `errorMessage()`, `ReportEmailRequestPanel.tsx:19-30`, `SelfCheckinPanel.tsx` 의 `errorMessage()` 모두 `status` 분기 + `message` 폴백이다. 새 구현은 폴백 문구에 `message` 를 쓰지 않아야 시안 "서버 메시지 원문 숨김"을 지킨다(순수함수 `deriveFlowStateKind` 단위 테스트 가능).

**닫힘(cancelled) 씬.** `ClassPlayerPage.tsx:1982-1994`: "닫힌 클래스입니다" + 목록으로 버튼 하나. 시안에 필요한 값:
- `회원 N명에게 안내됨`: 수신자는 호스트를 제외한 **전 참여자(대기열 포함)**(`session_service.py:946-973`, `include_waitlisted=(action=="cancel")`). 상세 DTO `participants` 에서 `user_id && user_id !== host_id` 개수로 프론트가 계산할 수 있다(게스트 행은 `user_id=None` 이라 제외됨; 게스트에게 알림을 보내려다 예외 로그가 남는 기존 동작은 I7 범위). 시안 문구 "**대기 중이던** 회원"은 서버가 모르는 값(대기실 presence 는 휘발성)이라 **문구와 수치가 어긋난다** → "초대한 회원 N명에게 안내했어요"로 쓰거나 호스트 화면에서 클릭 순간의 `waitingRoom.entries.length` 를 쓰되 재진입(`closed-revisit`)에는 쓸 수 없다(§5 결정 C).
- `닫은 시각`: **저장되지 않는다**(`models/session.py` 에 `cancelled_at` 없음, 취소 전이는 `ended_at` 도 안 채운다 `session_service.py:887-908`). 방금 닫은 경우는 클라이언트 시계로 표시 가능, 재진입에서는 값이 없다 → 행 생략(프론트 대체) 또는 BE-X(보류).
- `closed-0`(대기 회원 없음)/`closed`(3명)/`closed-revisit`: 위 계산으로 모두 구분 가능.
- 취소 후 `같은 설정으로 새 클래스` CTA 는 `duplicateSession`(`lib/api/session.ts:350`)이 이미 있다.
- 종료 후 오류(`error` 케이스에서 다시 시도)는 `refreshSession` 재호출.

**회원 쪽 FM10 현재 분산(근거).**

| 시안 | 현재 위치 |
|---|---|
| `cancelled` | ① 상세 페이지 인라인 빨간 박스 `ClientSessionDetailPage.tsx:198-205`("취소된 세션입니다") ② `/join` 대기 중 취소 → 코드 입력 단계로 되돌리며 빨간 문구 `class-join-page.tsx:157-161,257-261,275-279` ③ **진행 중 취소 → `complete` 단계 = "수고하셨어요" 종료 카드 + 하단 빨간 토스트** `314-317`(취소인데 종료 축하 카드가 뜨는 결함) |
| `closed` | `/join` 코드·상세 단계에서 빨간 문구 `class-join-page.tsx:175-177,205-207`, `errorMessage` 의 400/409/410 문구 `61-77` |
| `notyet` | `isPreOpen` 노란 박스 + 3초 폴링 `198-212,619-623,735-741`(회원 자동 입장 `460-469`) |
| `error` | `errorMessage` 폴백 `61-77`, 상세 페이지 원문 `ClientSessionDetailPage.tsx:60-62,233-236` |
| `offline` | **사전 흐름·상세 페이지에는 없음**. 진행 화면 `MemberNetDownCard`(`MemberFullView.tsx:19-31`, 뷰 `MemberClassView.tsx:114`)만 |

**단일 풀스크린 템플릿으로 합치는 방법.** `MemberFullView.tsx` 의 `FullScene`(배경+중앙, `:41-55`)·`FullCard`(로고·아이콘·제목·리드·정보 행·메모·버튼, `:61-84`)는 시안 `fl-state`(`member-a.html:407-416` `.w-tc`)와 구조가 같다. 필요한 변경: (1) 두 컴포넌트를 공용 위치(`components/class/flow/shared/`)로 이동·export, (2) `tone: 'neutral'|'warn'`(코랄) 추가(`.mp-fv-ic[data-ok]` 은 민트만 있다 `member-player.css:330-331`), (3) 정보 행을 0~2개로, 버튼 2개(주/보조) 고정, (4) 호스트 FH10 은 상단 바(`LEFT_HOME`)가 있고 회원 FM10 은 상단 바가 없다(`member-a.html:416 top:false`) → `top` 슬롯 선택적. 입력은 순수함수 `deriveFlowStateKind({ error, sessionStatus, scheduledAt, online })` 하나로 모아 `cancelled|closed|notyet|error|notfound|forbidden|network` 를 돌려주면 `class-join-page`, `ClientSessionDetailPage`, `ClassPlayerPage` 가 같은 컴포넌트를 쓴다.

## 3. 변경 목록

### 프론트

| 파일 | 변경 | 규모 |
|---|---|---|
| `pages/class-join-page.tsx` | (I1 소유) 대기열을 사전 흐름에서 판별해 FM08, 폴링을 `getSession(id)` 로 교체, 취소 시 종료 카드로 가지 않게, `ended_at` 저장, 오프라인 감지, 대기실에서 `scheduledAt`·`locationAddress` 전달 | M |
| `components/class/ClassWaitingRoom.tsx` / `WaitingForStart.tsx` | FM07 재구성(칩·시작 시각·준비 현황·BGM 또는 장소 카드), 아이브로우·명상 한마디 제거, `recheckingPrep` 중 시작 시 시트(R2-3a), props 에 `scheduledAt`·`readyCount`(옵션) | M |
| `components/class/LobbyBgmBar.tsx`, `hooks/useLobbyBgm.ts` | 이모지·대문자 제거, 시안 레이아웃(곡명·재생/일시정지·볼륨), `paused` 상태 추가(선택) | S |
| `components/class/player/member/MemberFullView.tsx` | `FullScene`/`FullCard` 공용화, 라벨 "수업"→"클래스", 대기열 문구 시안화("지금은 자리가 가득 찼어요", "대기 그만하기"), 푸시 문구 제거 | S |
| `components/player/MemberEndScene.tsx`, `ReportEmailRequestPanel.tsx`, `SelfCheckinPanel.tsx` | 라이트 카드 제거·재작성(OTP 제거는 I2), 체크인 완료 시 버튼 비활성, 서버 `ended_at` 기반 시간 | M |
| `components/class/player/shared/PlayerSheet.tsx` / `player-shared.css` | 종료 시트용 높이 상한 변형(`calc(100dvh - 72px)`) 필요 — I10 참조 | S |
| `pages/sessions/ClassPlayerPage.tsx` | 종료 후 `/record` 점프 제거(결정 B), 응답 `setSession`, 오류 화면(`1411-1435`)·닫힘 씬(`1982-1994`) 교체, `canStart` 0명 허용 | M |
| `components/class/player/host/HostEndingCard.tsx` | 4단계·시안 문구·`steps[ready].state` 판정, 글리프 없는 스텝 목록 | S~M |
| `components/player/EndSessionModal.tsx` | FH09 다크 확인 시트로 교체(라이트 모달·글머리 "·" 제거) | S |
| `pages/client/ClientSessionDetailPage.tsx` | 취소·오류를 풀스크린 템플릿으로(I3 와 소유 조정) | S |
| 신규 `lib/class/flow/flow-state.ts` | `deriveFlowStateKind`(HTTP 분기, 원문 비노출) + 단위 테스트 | S |
| `lib/api/session.ts` | `SessionDto`에 필요한 필드 이미 있음 — 변경 없음(타입 정리만) | - |

### 백엔드 (필수 0 / 권장 3 / 보류 3)

| 엔드포인트/모델 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 |
|---|---|---|---|---|
| BE-1 `ws/session_live_namespace.py` `on_waiting_room` | 세션별 휘발성 집계 → `{ready,total}` 을 `_room_all` 로 방송(`waiting_room_summary`) | 권장 | 모델·마이그레이션 없음, 새 이벤트라 기존 클라이언트 영향 없음 | `backend/tests/test_sdd024_session_live_ws.py` 계열에 이벤트·TTL·권한 테스트 추가 |
| BE-2 `session_service.py` `invite_participant`/`remove_participant`/`_promote_waitlist` | 승격 시 대상 `_room_self` 로 `participant_promoted` 발행, 초대·제거·승격에서 `_notify_participant_changed` 호출 | 권장 | 기존 데이터 영향 없음. 호스트 화면 갱신이 늘어남 | `test_func_fixes_4th.py:85-110`, `test_sdd021_session_class_flow.py:93-101,285-305` 에 이벤트 단언 추가 |
| BE-3 `session_service.py` `update_session` | `max_participants` 증가 시 가능한 만큼 `_promote_waitlist` 반복 호출(순번 순) | 권장 | 대기열 행의 `waitlist_position` 재번호(기존 로직 재사용) | 신규: 정원 증가 승격, 순번 보존 |
| BE-4 `models/session.py` + Alembic | `cancelled_at`(nullable) 추가, `cancel` 전이에서 기록, `SessionResponse` 노출 | 보류 | nullable 추가라 기존 행 영향 없음. `ended_at` 재사용 안(통계가 `ended_at` 을 완료로 해석)은 위험 | `test_session.py` 상태 전이 |
| BE-5 `report_progress_service.py` `_aggregate_generation_status` | 수동 기록이어도 `ready` 단계가 `active` 이면 `processing` 을 내림 | 보류 | 응답 의미 변경 → `test_sdd095_report_progress.py` 기대값 갱신, 프론트 `partial` 표시 영향 | 위 파일 |
| BE-6 승격·닫힘 알림 push 채널 | `notify_event` 에서 `session_waitlist_promoted`/`session_cancelled` 를 push outbox 에도 적재 | 보류(푸시 콘텐츠는 비범위) | 알림 설정 기본값 영향 | `test_agent_reminder.py` 계열 |

**프론트만으로 가능한 대체안**: BE-1 → 그룹 준비 바 생략("초대 N명 · 내 준비 완료"); BE-2 → `GET /sessions/{id}` 5초 폴링(§2.2); BE-3 → 호스트가 정원을 늘린 뒤 대기열 회원 폴링이 서버를 건드리지 못함(승격 안 됨) — 이 경우 사용자 안내는 "상담사가 자리를 열면"으로 두고 정원 증가는 제거와 함께 쓰도록 UX 안내; BE-4 → 방금 닫음만 시각 표시; BE-5 → `steps[ready].state` 판정; BE-6 → 문구를 "알림으로 알려 드려요"로.

## 4. 위험·주의

- **기존 데이터**: 과거 세션의 게스트 대기열 행(`user_id=NULL`)은 그대로 읽혀야 한다. 대기열 판별(`isParticipantWaitlisted`)은 `participant_id` 기반이라 게스트 행도 동작하지만, 사전 흐름이 회원 전용이 되면 과거 게스트 행은 호스트 화면(`toHostQueue` `host-live-model.ts:118-124`, `SessionDetailPage.tsx:511-535`의 "N순위")에서만 보인다. 호스트 쪽 "순위" 표기는 FM08 금지(회원 대상)와 별개이지만 용어 통일 대상.
- **회귀**: 대기열 폴링을 `join`→`getSession` 으로 바꾸면 `consent_eeg=True` 설정(`session_service.py:1594,1614,1618`)이 폴링으로는 일어나지 않는다. 입장 확정 응답(I1)에서 한 번은 설정돼야 한다 — 지금은 재입장 호출마다 `existing.consent_eeg = True` 로 덮는다.
- **대기열 새치기**: 현행 해제 경로(`1619-1623`)가 순번을 무시한다. 폴링을 `getSession` 으로 바꾸면 서버 쪽 새치기 경로는 사라지지만, BE-2/3 없이 대기열 회원이 영영 승격되지 않는 경우(정원만 증가)가 생긴다 → BE-3 권장 이유.
- **대기열 회원이 대기실 인원에 잡힘**(`on_waiting_room`): 회원이 FM08 에 머무는 동안은 `useWaitingRoomPresence` 를 켜지 않으면 해결(프론트). 이미 대기열 판별이 사전에 되므로 `enabled` 조건만 추가.
- **D6 번복**: `bypassGuardRef`·`useLeaveGuard` 는 `open/in_progress` 만 가드(`ClassPlayerPage.tsx:1020-1033`)라 `completed` 에 머무는 것은 안전하다. 종료 직후 `HostLiveContainer`→종료 씬 전환 시 `useWakeLock(isLobby || isRunning)`(`:992`)이 해제된다. 같은 화면에서 `/sessions/:id/record`(라이트 톤, I8 이후 별도)로 이동은 사용자 탭 시점이라 톤 단절이 남지만 의도된 전환.
- **종료 확인 시트 이중 소유**: `EndSessionModal` 은 `HostLiveContainer.tsx:377` 과 `GuestMeditationPanel`(미사용) 모두 import 한다. 교체 시 미사용 컴포넌트 정리(`GuestCompletePanel`, `GuestMeditationPanel`)를 함께 하지 않으면 죽은 코드가 남는다.
- **원문 노출 재발 방지**: `formatErrorDetail`(`client.ts:231-268`)이 FastAPI 검증 오류를 "필드: 사유"로 합쳐 `message` 에 넣으므로 화면에 `message` 를 쓰는 곳은 모두 위험하다. 새 템플릿은 `message` 를 읽지 않는다는 규칙을 테스트로 고정.

## 5. 사용자 결정 필요

| # | 질문 | 옵션 | 기본값 제안 | 영향 |
|---|---|---|---|---|
| A | **정원의 의미와 대기열의 운명.** 현재 "정원 = 초대된 인원 수"라 초대 모델에서 대기열은 초과 초대 시에만 생기고 자리는 호스트가 제거·증가시킬 때만 난다 | ① 현행 유지(초대 수 기준, 시안 FM08 문구 그대로) ② 동시 입장 인원 기준으로 변경(나가기·끊김 시 좌석 반환, presence 기반 — 큰 변경) ③ 대기열 폐지(`invite_participant` 도 정원 초과 시 400, FM08 삭제) | ① | ①이면 BE-3 권장·FM08 은 드문 화면. ②는 백엔드 설계 신규(별도 SDD 권장). ③은 확정 범위의 FM08 을 빼는 결정 |
| B | **SDD-208 D6 번복**: 종료 후 `/record` 점프(D6 현행) vs 같은 몰입 화면 진행(시안 S5) | ① 번복 — 같은 화면 ② D6 유지 | ① | ①: 규모 M, 테스트 2파일 갱신, 시안과 동일. ②: FH09 의 `end-*` 케이스는 종료된 세션을 열었을 때만 쓰임 |
| C | **"N명" 정의와 문구**: 종료 "N명이 함께했어요"·종료 확인 "참여 중인 회원 N명"·닫힘 "대기 중이던 회원 N명" | ① 초대 전체(대기열 제외) 행 수 기준, 문구를 "초대한 회원 N명"으로 ② 실제 입장 인원(서버 집계 신설 — 현재 입장 이력 저장 없음) | ① | ①이면 서버 변경 없음·문구만 바뀜(시안 문구 수정). ②는 백엔드 필요 |
| D | **푸시 약속**: FM08 "입장 알림은 이 기기로도", 닫힘 안내 | ① 문구를 "알림"으로 바꾸고 푸시는 보내지 않음 ② 승격·닫힘을 푸시로도 발송(BE-6) | ① | 푸시 콘텐츠는 SDD-209 비범위 |

## 6. 확인하지 못한 것

1. **시트·카드 스크롤 값 재측정**: survey 의 실측(251px/240px 등)을 인용했고, 이번에 하니스를 실행하지 않았다(읽기 전용·저장소 쓰기 금지 — dev 서버 기동이 `node_modules/.vite` 캐시를 만든다). 원인(CSS 규칙)은 코드로 확인.
2. **수동 기록 모드의 `useReportProgress` 폴링 중단·스텝퍼 문구**: 코드 읽기로만 확인, 실제 종료→수동 기록 시나리오는 실행하지 않았다.
3. **푸시 미발송**: `notify_event` 가 push outbox 를 만들지 않는 것은 확인했으나, 다른 경로(예: `push_service`)가 `session_waitlist_promoted` 를 별도로 푸시하는지는 `services/push_service.py`·`web_push_service.py` 를 열지 않았다(`grep` 로 이벤트명 참조 없음만 확인).
4. **`/record` 소켓의 구독 권한**(회원이 `report:progress` 를 받을 수 있는지): REST `report-status` 는 참여자 허용(`record_service.py:223-231`)이나 `ws/record_namespace.py` 의 룸 규칙은 열지 않았다. 회원 화면에는 진행 단계가 필요 없어 영향 낮음.
5. **`started_at`/`scheduled_at` 의 즉석 클래스 값**: 즉석(ready) 클래스의 `scheduled_at=null` 은 생성 코드로 확인했으나, FM07 의 "시작 예정" 대체 문구는 시안에 없어 plan 결정 필요(사용자 정책 아님).
6. **게스트 알림 예외 경로**: `_notify_participants_event` 가 `user_id=None` 수신자에게 호출될 때의 실제 동작(`_to_uuid(None)` 400 → 로그·롤백)은 코드 읽기만, 실행 확인 안 함. I7(게스트 제거) 범위.

## 다른 조사와의 겹침·충돌

- **I1(입장·사전 확인)**: 대기열 판별의 입력 = I1 이 정할 "입장 확정 API 응답". `consent_eeg` 설정 위치와 `class-join-page.tsx` 소유권이 겹친다. 사전 오픈 입장(`FM05 member-wait`)은 서버가 오픈 전 입장을 거부(`session_service.py:1556-1562`)하는 점이 걸린다 — I1 에서 결정.
- **I2(OTP·리포트 신청)**: `ReportEmailRequestPanel` 재작성 범위는 I2 결과에 의존.
- **I7(게스트 제거)·I3(회원 홈·상세)**: `ClientSessionDetailPage.tsx` 의 취소·오류·"세션 입장하기"(`:134-181`) 수정이 겹친다(소유 조정 필요).
- **I10**: `PlayerSheet` 높이 상한·스크림, `FullScene`/`FullCard` 공용화, `HostEndingCard` 위치.
