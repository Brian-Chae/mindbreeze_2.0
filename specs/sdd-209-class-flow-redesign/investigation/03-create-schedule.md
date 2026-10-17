# I3 클래스 생성·예약(A2·A6) — 코드 조사

기준: develop `32fa5533`. 프론트 경로는 `frontend/src/`, 백엔드 경로는 `backend/app/` 기준. 코드 정독만 했고 dev 서버 호출·DB 조회는 하지 않았다. 대상 시안은 `designs/class-flow-redesign/host-a.html` 의 FH02a~e·FH03, 현행 화면은 `survey/상담사-화면조사.md` S-H04~S-H09.

## 0. 한 줄 결론

- 만들기 마법사 5단계와 FH03 은 **프론트 신규 작업이 중심이고 백엔드 필수 변경은 0건**이다.
- A2(예약 모달 `location_type` 버그)는 프론트가 `location_type` 을 안 보낸 것이 원인이다. 서버는 이미 받는다(`schemas/session.py:29`). 프론트 한 줄 수정으로 끝난다. 과거 `[온라인]` 세션만 별도 호환 처리가 필요하다.
- A6(참여자 이름이 UUID 8자리로 나옴)은 서버 버그다. 세션 응답의 `ParticipantInfo` 에 `user_name`·`user_email` 필드가 **정의조차 없고**(`schemas/session.py:123-143`) 직렬화도 채우지 않는다(`services/session_service.py:121-146`). 프론트 타입의 `user_name?` 은 응답에 존재하지 않는 필드다. 이름은 WS `participant_changed` 이벤트와 `live-metrics` 에서만 나온다.
- 초대 발송 "성공/실패"는 **HTTP 호출 성공 여부밖에 없다.** 알림 생성·이메일·WS 실패는 서버가 삼키고 항상 200 이다(`session_service.py:1100-1108`). `session_invited` 는 푸시 채널이 없다. 알림 재전송 API 도 없다.
- 시간 충돌은 서버가 409 + 문자열 `detail` 하나만 준다. 충돌 클래스 이름·시각은 안 준다. 사전 조회 엔드포인트도 없다. 시안 FH02c `conflict` 는 프론트의 `GET /sessions` 목록 기반 클라이언트 검사로 만들 수 있다.
- 시안 FH02b 의 **`AI 분석` 토글에 대응하는 서버 필드가 없다**(`record_audio`·`record_video` 두 개뿐). 시안 FH02a 에는 `기타` 유형 칩이 있는데 `custom_type_name` 입력이 없다. 시안 FH02a 는 그룹 정원을 10 으로 고정해서 `max_participants` 입력이 사라진다. 이 셋은 사용자 결정이 필요하다.

## 1. 현재 코드 상태 (판정표)

| 항목 | 판정 | 근거 |
|---|---|---|
| 즉시 경로(`/sessions/new`)가 `createSession` 에 모든 설정 필드를 보냄 | 있음 | `pages/sessions/SessionCreatePage.tsx:130-146` |
| 예약 모달 payload 가 `location_type`·`participant_mode`·`linkband_mode`·`record_*` 를 보냄 | 없음(A2 원인) | `pages/sessions/SessionListPage.tsx:76-88` |
| 서버가 `location_type`·`location_address` 를 생성 요청에서 받음 | 있음 | `schemas/session.py:29,32` |
| 서버 `location_type` 기본값 | 있음(`offline`) | `schemas/session.py:29`, `models/session.py:55` |
| 과거 예약의 `[온라인]`/`[오프라인]` 태그를 해석하는 코드 | 없음 | `grep` 결과 태그 문자열 사용처는 `SessionListPage.tsx:76` 뿐 |
| `duration_min` 5분 단위 서버 검증 | 없음(`ge=1, le=600`) | `schemas/session.py:24,80` |
| 시작 시각 5분 단위 서버 검증 | 없음 | `services/session_service.py:279-289` |
| DB `duration_min` 컬럼 | Integer, CHECK 제약 없음 | `models/session.py:50`, `alembic/versions/77cff497fbe0_initial_8_core_tables.py:70` |
| 프론트 `duration_min` 입력 제약 | 일부(1~600 정수만, 5분 단위 아님) | 즉시 `SessionCreatePage.tsx:463-473`, 예약 `SessionListPage.tsx:415-428` |
| 프론트 시각 입력 단위 | 10분 휠(00·10·…·50) | `SessionListPage.tsx:387` |
| 시간 충돌 서버 검사 + 무시 플래그 | 있음(`force`) | `session_service.py:233-258,286-289` |
| 충돌 응답에 충돌 대상 정보 | 없음(문자열 `detail` 만) | `session_service.py:289` |
| 충돌 사전 조회 엔드포인트 | 없음 | `api/v1/session.py` 라우트 전수 확인 |
| 응답 `ParticipantInfo` 의 `user_name`/`user_email` | 없음 | `schemas/session.py:123-143`, `session_service.py:121-146` |
| `SessionParticipant` 에 `User` 관계 | 없음 | `models/session.py:127`(`session` 관계만) |
| 이름을 내려주는 경로 | 일부(WS `participant_changed`, `live-metrics`, host 전용) | `session_service.py:1139-1194`, `2051-2110` |
| `POST /sessions/{id}/invite` 응답에 발송 성공/실패 | 없음(`SessionResponse` 전체만 반환) | `api/v1/session.py:292-299`, `session_service.py:1322` |
| 알림 발송 실패 처리 | 삼킴(로그만, 호출은 200) | `session_service.py:1100-1108` |
| `session_invited` 푸시 | 없음(인앱+WS+이메일) | `notification_service.py:242-269`, push 적재는 `chat_service.py:1448`·`agent_service.py:327`·`agent_risk.py:429` 뿐 |
| 초대 알림 재전송 API | 없음 | `api/v1/session.py` 전수 확인, `grep resend` 는 org·admin·reports 만 |
| 초대 추가 API | 있음(`/invite` 반복 호출, 일괄 API 는 없음) | `api/v1/session.py:292` |
| 1:1 최대 1명 서버 강제 | 없음(프론트만) | 프론트 `SessionCreatePage.tsx:75,356-364,481-484`, 서버 `session_service.py:295-301` |
| 템플릿 저장/목록/복제 | 있음 | `api/v1/session.py:137-149,246-289` |
| 예약 시각 전 `open` 허용 | 있음(시각 검사 없음) | `session_service.py:35-40,854-865` |
| 플레이어 `/sessions/:id/player` 가 `ready`·`scheduled` 에서 세팅 씬 전개 | 있음 | `pages/sessions/ClassPlayerPage.tsx:966-968,1033-1047` |
| 오프라인 + `record_video` 서버 차단 | 없음 | 서버에서 `record_video` 사용처는 저장·복사뿐 |
| 이탈 가드 훅 | 있음(`useLeaveGuard`, 플레이어용) | `hooks/useLeaveGuard.ts:12-36` |

## 2. 상세 조사

### 2.1 현행 두 생성 경로 비교 (조사 1)

**진입점.** 목록 헤더의 `예약 만들기` → 모달(`SessionListPage.tsx:679-681`, 마운트 `:858-862`), `+ 즉시 클래스` → `/sessions/new`(`:682-684`, 라우트 `App.tsx:189`).

#### 2.1.1 폼 필드 → `createSession` payload 매핑

`CreateSessionPayload` 정의는 `lib/api/session.ts:91-113`, 호출은 `createSession`(`:334-335`, `POST /sessions`).

| payload 필드 | 즉시 페이지 | 예약 모달 | 서버 기본값(미전송 시) |
|---|---|---|---|
| `type` | `type` 상태(기본 `meditation`, 선택지 명상·임상·최면·기타) `:26,294-302` | `type`(기본 `clinical`, **기타 없음**) `SessionListPage.tsx:48,233-237` | 필수 |
| `custom_type_name` | `type==='custom'` 일 때만 `:132` | 미전송 | `null`. `type=custom` 이면 서버가 필수로 검증 |
| `scheduled_at` | **미전송**(즉시 = `ready`) | `new Date(scheduledAt).toISOString()` `:80` | `null` → `ready` |
| `duration_min` | `durationMin`(기본 50) `:35,133` | `durationMin`(기본 50) `:50,81` | 필수 |
| `title` | `title \|\| undefined` `:134` | 동일 `:82` | `null` |
| `notes` | `notes \|\| undefined` `:135` | **`[온라인]`/`[오프라인]` + 설명을 한 문자열로 결합** `:76-77,83` | `null` |
| `max_participants` | `maxParticipants`(기본 10, 1:1 이면 1) `:45,136` | `maxParticipants`(기본 10) `:53,84` | `10` |
| `location_type` | `locationType`(기본 `offline`) `:28,137` | **미전송(A2 원인)** | `offline` |
| `location_address` | `getLocationAddressPayload(...)` `:138` | 미전송 | 서버가 기관 주소→상담사 주소로 채움(오프라인일 때) |
| `participant_mode` | `participantMode`(기본 `group`) `:31,139` | **미전송** | **`one_on_one`** |
| `linkband_mode` | `linkbandMode`(기본 `optional`) `:32,140` | 미전송 | `none` |
| `sfu_enabled` | `locationType==='online' && participantMode==='group'` `:141` | 미전송 | `false` |
| `record_audio` | `recordAudio`(기본 true) `:142` | 미전송 | `true` |
| `record_video` | `recordVideo`(기본 true) `:143` | 미전송 | `true` |
| `reminder_offsets` | `reminderOffsets`(기본 `[1440]`, 다중 선택) `:39,145` | 동일(기본 `[1440]`) `:56,87` | `[]` |
| `participant_ids` | 미전송(생성 후 `/invite` 호출) | 미전송(참여자 선택 UI 없음) | `[]` |
| `force` | 미전송 | `force`(`시간 충돌 무시` 체크) `:54,85,494-497` | `false` |
| `is_template` | 미전송 | 미전송 | `false` |

**예약 모달이 만드는 클래스의 실제 모양**(서버 기본값 적용 결과): `participant_mode=one_on_one`, `max_participants=10`, `linkband_mode=none`, `location_type=offline`, `location_address=서버 기본 주소`, 녹음·영상 모두 true. 즉 **1:1 인데 정원 10명인 불일치 상태**로 만들어진다. 상담사-화면조사 S-H04 문제점 ②는 "기본값(그룹 10명 등)"이라고 썼지만 코드상 `participant_mode` 기본값은 `one_on_one` 이다(`schemas/session.py:33`). 바로잡아 둔다.

#### 2.1.2 두 경로의 차이

1. **일정**: 즉시는 `scheduled_at` 없음(→ `ready`), 예약은 있음(→ `scheduled`)(`session_service.py:279-280`). 서버는 한 엔드포인트로 둘 다 처리하므로 통합 마법사의 `지금 바로`/`시간 예약` 분기는 payload 의 `scheduled_at` 유무로 충분하다.
2. **참여자**: 즉시만 선택·초대. 예약은 초대 불가.
3. **설정 필드**: 즉시가 전부 보내고 예약은 7개 필드를 안 보낸다(위 표).
4. **충돌**: 예약만 `force` 노출. 즉시는 `scheduled_at` 이 없어 충돌 검사 자체를 건너뛴다(`session_service.py:282-289`).
5. **완료 후**: 즉시는 코드 큰 글씨+복사 화면(`SessionCreatePage.tsx:200-264`), 예약은 모달 닫고 목록 새로고침만(`SessionListPage.tsx:89-91`).
6. **템플릿**: 즉시만 `내 템플릿에서 시작`(`:272-292`)·`템플릿으로 저장`(`:224-237`).
7. **제목**: 즉시는 `required`(`:498`), 예약은 선택(`SessionListPage.tsx:449`).
8. **리마인더 UI**: 문구가 서로 다름(즉시 `:381-427`, 예약 `SessionListPage.tsx:455-493`). 둘 다 다중 선택 + 기본 `하루 전`.

#### 2.1.3 현행 검증 규칙 전부

**프론트(즉시 페이지)**

| 규칙 | 근거 |
|---|---|
| `type=custom` 이면 `유형 이름` 필수·최대 30자 | `SessionCreatePage.tsx:304-318` |
| `duration_min`: `number`, `min=1`, `max=600`, `required` (브라우저 네이티브 검증, 소수 입력 가능) | `:463-473` |
| 1:1 선택 시 `maxParticipants=1`·입력 비활성·선택자 1명으로 절단 | `:356-364,481-484` |
| `maxParticipants`: 1~100(`max` 속성), 줄이면 선택자 절단 | `:476-492` |
| `title` 필수 | `:498` |
| `location_address`: `maxLength=300`, 온라인이면 숨김·미전송, 빈 값이면 서버 기본값 | `:336-349`, `lib/class/session-location.ts:17-27` |
| 장소 주소 300자 초과 시 `Error` 던짐(제출 try 안에서 잡힘) | `session-location.ts:22-27`, `SessionCreatePage.tsx:129,163-165` |
| 선택자 수 ≤ `pickerMax`(1:1 은 1, 그룹은 `maxParticipants`), 초과 선택 시 `최대 N명까지 선택할 수 있습니다` | `:75`, `ParticipantPicker.tsx:41-46` |
| 템플릿 적용 시 정원이 줄면 선택자 절단 | `:112-114` |
| 초대는 개별 실패해도 생성은 성공 처리, 실패자 이름을 경고 문구로만 표시 | `:149-160` |

**프론트(예약 모달)**

| 규칙 | 근거 |
|---|---|
| `duration_min`: 숫자만 허용, 1~600 으로 clamp, 빈 값은 0→`''` 표시(HTML `required` 로 차단) | `SessionListPage.tsx:415-428` |
| `max_participants`: 1~100 clamp | `:431-445` |
| 시각 10분 단위 휠, 12시간제 | `:387,149-153` |
| 기본 일시 = 현재+1시간 정시 | `:36-41` |
| `title` 선택 | `:449` |
| 과거 일시 클라이언트 검증 없음(서버가 400) | 모달 코드에 해당 로직 없음 |

**백엔드(`SessionCreateRequest` + `create_session`)**

| 규칙 | 근거 |
|---|---|
| `type` ∈ clinical·hypnosis·meditation·custom | `schemas/session.py:11,20` |
| `custom_type_name` 최대 30자, `type=custom` 이면 비어 있으면 안 됨(스키마 + 서비스 이중 검증) | `schemas/session.py:21,57-62`, `session_service.py:292-293` |
| `duration_min` 1~600 | `schemas/session.py:24` |
| `title` 최대 200자 | `schemas/session.py:26` |
| `max_participants` 1~100, 온라인 그룹은 ≤ 50 | `schemas/session.py:28,64-73` |
| `location_address` 최대 300자, 온라인이면 무시·`null` 저장, 오프라인 빈 값이면 기관→상담사 주소 | `schemas/session.py:32`, `session_service.py:54-82` |
| `reminder_offsets`: 5분~14일 정수만 남기고 중복 제거·내림차순·최대 5개 | `schemas/session.py:47-55` |
| `scheduled_at`: 있으면 과거(현재-1분 이전) 400 | `session_service.py:283-284` |
| 충돌: `force` 가 아니면 호스트의 활성 세션(`ready`·`scheduled`·`open`·`in_progress`) 중 `scheduled_at` 이 있는 것과 구간 겹침 시 409 | `session_service.py:30,233-258,286-289` |
| `participant_ids` 수 > 정원이면 400(정원 계산: 명상은 입력값, 그 외 `max(입력,1)`) | `session_service.py:295-301` |
| `participant_ids` 의 사용자 존재·상담사 연결 여부 검증 없음(`_to_uuid` 형식 검사만) | `session_service.py:346-347` |
| 기관 소속 필수(`require_active_user_org`) | `session_service.py:268-272` |
| 1:1 최대 1명 서버 강제 없음 | `session_service.py:295-301` |

**통합 마법사 상태 모델 제안**(시안 `host-a.html:448` 의 `BASE` 키와 이름을 맞춰 시안↔구현 대조를 1:1 로 한다)

| 단계 | 필드(시안 키 → payload) | 검증 |
|---|---|---|
| ① 유형·방식 | `type`(`clinical`/`hypnosis`/`meditation`/`other`→`custom`), `mode`(`online`/`offline`→`location_type`), `addr`(→`location_address`, 오프라인만), `size`(`solo`/`group`→`participant_mode` `one_on_one`/`group`) | `custom` 이면 유형 이름 필요(시안에 입력 없음, 결정 D5). 주소 ≤300자. `solo` 면 `max_participants=1`. 그룹 최대는 결정 D1 |
| ② LINK BAND·녹음·AI | `band`(→`linkband_mode`), `voice`(→`record_audio`), `ai`(**대응 필드 없음**, 결정 D2), `video`(→`record_video`, 오프라인이면 false 고정, 결정 D3) | `voice=false` 면 `ai` 비활성(시안 `:512`). 온라인일 때만 `video` 선택 |
| ③ 일정 | `when`(`now`/`later`), `day`·`time`(→`scheduled_at`), `dur`(→`duration_min`), `remind`(→`reminder_offsets`), `conflict`(파생) | `dur` 5~600, 5 의 배수. `later` 면 `scheduled_at` 이 현재 시각 이후이고 분이 5 의 배수. 서버는 현재-1분까지만 허용하므로 클라이언트가 같은 하한을 쓴다. `now` 면 `scheduled_at`·`remind` 미전송 |
| ④ 초대 | `picked`(→생성 후 `/invite` N회) | `solo` 면 ≤1, `group` 이면 ≤`max_participants`. 0명 허용(시안 `empty` 케이스, 확정 결정 5) |
| ⑤ 확인 | `title`(→`title`) | 필수 여부는 결정 D6. ≤200자 |

### 2.2 예약 모달 `location_type` 버그 (조사 2, A2)

- **위치.** `pages/sessions/SessionListPage.tsx:76-88`. `isOnline` 상태(`:64`)가 `[온라인]`/`[오프라인]` 문자열로만 변환되어 `notes` 앞에 붙고(`:76-77`), payload(`:78-88`)에 `location_type` 키가 없다.
- **서버 스키마.** `SessionCreateRequest.location_type: LocationType = "offline"`(`schemas/session.py:29`), `location_address: str | None = Field(None, max_length=300)`(`:32`). 둘 다 이미 수용한다.
- **모델 컬럼.** `Session.location_type String(20) NOT NULL default "offline"`(`models/session.py:55`), `location_address String(300) NULL`(`:59`).
- **서비스 저장.** `location_type=payload.location_type`(`session_service.py:322`), 주소는 `resolve_location_address`(`:324-330`)가 결정: 온라인이면 항상 `None`(`:67-68`), 오프라인+입력 있음이면 입력값, 입력 없으면 기관 주소→상담사 주소(`:72-82`).
- **그 결과.** 예약 모달로 `온라인` 을 골라도 서버에는 `location_type=offline` 으로 저장되고 `location_address` 도 기본 주소로 채워진다. 상세 화면은 `오프라인 · 주소 미등록`(주소 없을 때) 또는 기본 주소를 보여 주고 메모에 `[온라인]` 이 노출된다(`SessionDetailPage.tsx:448,456-460`, S-H13).
- **수정 시 프론트만으로 해결 가능한가: 예.** 통합 마법사가 `location_type`·`location_address` 를 보내면 된다. 서버 변경 불필요. 예약 모달은 마법사로 대체되어 사라진다(시안 FH01 의 `클래스 만들기` 단일 진입).
- **과거 데이터 호환.** 지금까지 모달로 만든 예약은 모두 `location_type=offline` 이고 `notes` 가 `[온라인] ...` 또는 `[오프라인] ...` 으로 시작한다(태그 뒤 공백 1칸, 설명이 없으면 태그만). 태그를 쓰는 코드는 `SessionListPage.tsx:76` 하나뿐이고 읽는 코드는 어디에도 없다. 파생 규칙은 다음과 같다.
  1. `notes` 가 `[온라인]` 으로 시작 → 표시상 `location_type=online`, `location_address=null`, 메모는 태그와 뒤 공백 제거.
  2. `[오프라인]` 으로 시작 → `offline`(서버 값과 동일), 메모는 태그 제거.
  3. 태그 없음 → 서버 값 그대로.
  4. 이 규칙은 **서버 값이 `offline` 일 때만** 적용한다. 서버가 이미 `online` 이면 마법사로 만든 새 데이터이므로 건드리지 않는다.
  - 프론트만으로 적용하려면 `lib/api/session.ts` 의 `listSessions`/`getSession`/`duplicateSession` 등 `SessionDto` 를 돌려주는 래퍼에서 한 번 정규화해야 한다. `session.location_type` 을 직접 읽는 곳이 `HostLiveContainer.tsx:128,250`, `ClassPlayerPage.tsx:976,987,1887`, `SessionDetailPage.tsx:448`, `SessionCard.tsx:77`, `class-join-page.tsx:505,547`, `session-location-editor.tsx:13` 으로 흩어져 있어서다. 회원 입장 경로(`SessionByCodeResponse.location_type`, `session.ts:151`)는 별도라 래퍼가 못 덮는다(I1 소관).
  - 백엔드 백필(권장): `UPDATE sessions SET location_type='online', location_address=NULL WHERE location_type='offline' AND notes LIKE '[온라인]%'` 와 두 태그의 메모 접두사 제거를 Alembic 데이터 마이그레이션 1건으로 처리. 컬럼 변경 없음. 가역성은 접두사 제거 때문에 떨어지므로, 접두사 제거는 하지 않고 프론트가 표시 시 제거하는 쪽이 안전하다. 운영 DB 에 해당 행이 몇 건인지는 미확인(§6).

### 2.3 `duration_min` · 시작 시각 5분 단위 (조사 3)

- **프론트 현행.** 즉시 `type=number min=1 max=600`, step 속성 없음(기본 1)(`SessionCreatePage.tsx:463-473`). 예약은 텍스트 입력에 숫자만, 1~600 clamp(`SessionListPage.tsx:415-428`). 시각 휠은 `00·10·20·30·40·50`(`:387`). 어느 쪽도 5분 단위가 아니다.
- **백엔드 스키마.** 생성 `Field(..., ge=1, le=600)`(`schemas/session.py:24`), 수정 `Field(None, ge=1, le=600)`(`:80`). `multiple_of` 없음. 복제·템플릿은 원본 값을 그대로 복사(`session_service.py:383-399`).
- **DB.** `duration_min Integer NOT NULL`(`models/session.py:50`). CHECK 제약 없음.
- **서버 검증 추가 필요성.**
  - 판정: **보류**. 프론트 스텝퍼(최소 5, 5씩 증감)가 정상 경로의 단일 입력원이다. 서버 규칙을 넣으면 캐시된 구 번들·직접 API 호출이 422 를 받는다.
  - 테스트 영향: 기존 백엔드 테스트의 `duration_min` 은 10·30·40·50·60 으로 모두 5의 배수라 `multiple_of=5` 자체는 통과한다. 반면 **시작 시각 5분 검증은 기존 테스트를 깬다.** 테스트 헬퍼 `_future()` 가 `now+N분` 을 그대로 쓰기 때문이다(`backend/tests/test_session.py:30-31`, `test_sdd095_class_template.py:37-38`). 시각의 5분 단위는 서버가 아니라 프론트 입력 제약으로만 건다.
  - 굳이 서버에 넣는다면 `SessionCreateRequest` 에만 `ge=5, multiple_of=5` 를 걸고 `SessionUpdateRequest`·복제 경로는 건드리지 않는다.
- **기존 비5분 값의 읽기 호환.** 과거에 모달/폼에서 `47` 같은 값을 만들 수 있었다(1 단위). 읽기 쪽은 `{duration_min}분` 으로 숫자를 그대로 쓰므로 문제없다(`SessionDetailPage.tsx:427`). 호환이 필요한 곳은 **템플릿 적용·복제**다. 복제는 서버가 값을 그대로 복사한다. 마법사에 템플릿 값을 채울 때 5의 배수로 올림(최소 5)해 보여 주고, 시안 칩(30·45·50·60·90)과 맞지 않으면 칩은 선택 해제 상태로 둔다.
- **`scheduled_at` 시간대.** 프론트는 입력을 로컬 시각 문자열 `YYYY-MM-DDTHH:MM` 으로 들고 있다가 `new Date(scheduledAt).toISOString()` 으로 UTC 로 변환해 보낸다(`SessionListPage.tsx:80`). 서버는 `DateTime(timezone=True)` 로 저장(`models/session.py:43`)하고 tz 없는 값이 오면 UTC 로 간주한다(`session_service.py:220-223`). 응답은 aware datetime 이라 `new Date(iso)` 로 로컬 표시가 된다. 즉 **변환 위치는 프론트 제출 직전 한 곳**이고, 마법사도 `day`·`time` 상태를 로컬 기준으로 들고 있다가 제출 때 `toISOString()` 하면 된다. 초·밀리초는 0 으로 맞춘다. 서버 쪽 KST 고정은 리마인더 본문 포맷(`reminder_service.py:104-109`)뿐이다.
- **시안과 서버 사이 간극.** 시안은 날짜를 0~13일 뒤, 시를 07~22시로 제한하고(`host-a.html:527,529`) 소요 시간 최대 480분(`:518`)이다. 서버는 이런 제한이 없다(과거만 막음, 소요 시간 최대 600). 이 제한은 시안의 UI 제약이므로 프론트에서만 구현하되, 기존 600분 세션을 읽는 호환에는 영향이 없다.

### 2.4 시간 충돌 검사 (조사 4)

- **서버 구현.** `detect_conflict`(`session_service.py:233-258`): 같은 `host_id` 의 `ACTIVE_STATUSES`(`ready`·`scheduled`·`open`·`in_progress`, `:30`) 중 `scheduled_at` 이 있는 세션과 구간 `[start, start+duration)` 겹침을 검사해 **첫 1건** 반환. 충돌 시 `HTTPException(409, "시간이 겹치는 세션이 있습니다")`(`:288-289`). 같은 규칙이 수정(`:718-721`)·복제(`:533-536`)에도 있다.
- **409 구조.** `{"detail": "시간이 겹치는 세션이 있습니다"}` 한 줄이다. 오류 코드·충돌 세션 id·이름·시각이 없다. 프론트 `ApiError` 는 `status`·`message`·`data` 를 갖지만(`lib/api/client.ts:110-113,346-348`), 현재 페이지들은 `Error.message` 만 쓴다(`SessionListPage.tsx:93`).
- **`ignore_conflict` 같은 이름은 없다.** 실제 필드는 `force`(`schemas/session.py:40`)이고, `force=true` 는 충돌 검사만 건너뛴다(과거 일시 검사는 유지, `:283-289`).
- **즉시(`when=now`) 는 충돌 검사 대상이 아니다.** `scheduled_at` 이 없으면 검사 블록 전체를 건너뛴다(`:282`). 또 `detect_conflict` 가 `scheduled_at=None` 인 기존 세션을 무시하므로(`:251-253`) 즉시 클래스는 예약과 겹쳐도 경고되지 않는다.
- **시안 FH02c `conflict` 케이스 필요 데이터**(`host-a.html:524-526`): `같은 시간에 {회원} 님 {제목}이 있어요. 겹쳐도 만들 수 있어요` — 충돌 클래스 **제목**(시안은 `박지우 님 1차 상담`)과 `겹쳐도 만들 수 있어요`(= `force`). 시각 표시는 없다.
- **프론트만으로 가능한 대체(채택 가능).** `GET /sessions`(`api/v1/session.py:50-61`, `listSessions` `session.ts:309-310`)는 `page`·`limit` 없이 호출하면 호스트이거나 참여자인 비템플릿 세션 **전체**를 `scheduled_at`·`duration_min`·`status`·`title`·`host_id` 와 함께 준다(`session_service.py:624-653`). 클라이언트에서 다음을 재현한다.
  - 대상: `host_id === authStore.user.id`, `status ∈ {ready, scheduled, open, in_progress}`, `scheduled_at != null`.
  - 겹침: `s.start < newEnd && newStart < s.end`(서버와 동일, `:256`).
  - 마법사 진입 시 1회 로드해 두고 ③단계에서 `startAt`·`dur` 가 바뀔 때마다 계산(네트워크 왕복 없음). 제출은 `conflict` 면 `force: true`.
  - 한계: 목록이 커지면 전체 응답이 무겁다(페이지네이션 파라미터가 있지만 날짜 필터는 없다). 서버가 최종 판정하므로, 클라이언트 검사와 제출 사이에 생긴 충돌은 409 로 돌아온다 → `ApiError.status===409` 를 잡아 같은 경고 노트를 띄우고 `force` 재제출을 권한다.
- **백엔드 변경안(보류).** `GET /sessions/conflicts?scheduled_at=&duration_min=` → `{conflict: {id,title,scheduled_at,duration_min} | null}`. `detect_conflict` 재사용이라 규모는 S(라우터 1 + 서비스 래퍼 + 스키마 + 테스트). 라우트는 `/{session_id}` 보다 앞에 선언해야 한다(`api/v1/session.py:73,100,133` 주석 참조). 프론트 대체안이 충분하면 필수가 아니다.

### 2.5 참여자 이름이 UUID 8자리로 나오는 원인 (조사 5, A6)

- **프론트 폴백.** `SessionDetailPage.tsx:64-68` `participantLabel`: `user_name → user_email → guest_name → user_id.slice(0,8) → '게스트'`. 상세 REST 스냅샷의 회원 참여자는 앞 세 값이 모두 비어 있어 **UUID 앞 8자리**로 떨어진다.
- **서버 스키마.** `ParticipantInfo`(`schemas/session.py:123-143`)의 필드는 `participant_id`·`user_id`·`guest_name`·`gender`·`birth_date`·`is_guest`·`band_connected`·`linkband_device_id`·`webrtc_peer_id`·`consent_audio`·`consent_eeg`·`is_waitlisted`·`waitlist_position`·`raise_hand`·`speaking` 이다. **`user_name`·`user_email` 이 없다.**
- **직렬화.** `_serialize`(`session_service.py:85-148`)가 참여자 dict 에 넣는 키(`:121-146`)도 위와 같다. `SessionParticipant` 에 `User` 관계가 없고(`models/session.py:127`) `_serialize` 는 `db` 를 받지 않는다. `grep user_name\|user_email backend/app` 결과 세션 응답에서 쓰이는 곳은 없다(`org` 스키마만).
- **프론트 타입의 `user_name?`·`user_email?`**(`lib/api/session.ts:43-44`)은 서버가 안 보내는 필드를 optional 로 선언해 둔 것이다. 값이 채워지는 곳은 한 군데 — WS `participant_changed` 이벤트를 `toSessionParticipant`(`SessionDetailPage.tsx:71-83`)가 `user_name: metric.display_name` 으로 변환할 때다.
- **어느 엔드포인트가 이름을 빠뜨리나.** `SessionResponse` 를 반환하는 **모든 엔드포인트**가 해당한다.

  | 엔드포인트 | 코드 | 이름 |
  |---|---|---|
  | `GET /sessions`, `GET /sessions/templates` | `session_service.py:621,653` | 없음 |
  | `GET /sessions/{id}` | `:690-696` | 없음 |
  | `POST /sessions` | `:373` | 없음 |
  | `PUT /sessions/{id}`, 전이(`open/start/end/cancel`) | `:814,975` | 없음 |
  | `POST /sessions/{id}/invite` | `:1322` | 없음(→ FH03 에서 이름을 못 씀) |
  | `DELETE /sessions/{id}/participants/{user_id}` | `:1375` | 없음 |
  | `POST /sessions/{id}/duplicate`, `save-as-template` | `:555,586` | 없음 |
  | WS `participant_changed` | `:1139-1194` | **있음**(`display_name`, 활성 참여자만) |
  | `GET /sessions/{id}/live-metrics` | `:2051-2110` | **있음**(host 전용, 활성 참여자만, 대기열 제외) |

  참고: 이 경로들이 `user_name` 으로 내려주는 이름은 `User.name`(`models/user.py` `name`)이다.
- **재현 조건(코드 정독).** 상담사가 초대 직후 상세/로비를 REST 로 읽으면 이름이 없다. WS 가 `participant_changed` 를 보내 `participants` 배열이 오면 활성 참여자만 이름이 채워지고, 대기열 참여자는 REST 값이 유지되어 UUID 가 남는다(`SessionDetailPage.tsx:107-113`).
- **수정 위치와 규모(권장).**
  1. `schemas/session.py` `ParticipantInfo` 에 `user_name: str | None = None`, `user_email: str | None = None` 추가.
  2. `session_service.py` `_serialize` 에 참여자 이름 맵 인자(`identities: dict[UUID, tuple[str, str]] | None`)를 추가하고, 호출부가 한 번의 `User.id IN (...)` 쿼리로 채운다. 대안은 `SessionParticipant.user = relationship("User", viewonly=True)` + 목록 쿼리의 `selectinload`. `_serialize` 호출부는 20곳이다(`grep` 결과). host 전용 호출 8곳(생성·수정·전이·초대·제거·복제·템플릿)이 우선 대상이다.
  3. **PII 주의.** 참여자 본인이 `GET /sessions/{id}` 로 볼 때는 타인의 이름·이메일이 새면 안 된다. `include_participant_pii` 가 이미 있어(`session_service.py:85,128-132,693-696`) 이 플래그가 참인 호출에서만 이름을 채운다. 규모 S~M(스키마 2줄 + `_serialize` 수정 + 테스트).
  4. **기존 PII 노출 주의(발견).** `list_sessions` 와 `join_session_by_code` 계열이 `_serialize(s)` 를 기본값(`include_participant_pii=True`)으로 호출한다(`session_service.py:621,653,1567,1627,1681`). 회원이 `GET /sessions` 로 자기 참여 클래스를 읽을 때 **다른 참여자의 성별·생년월일이 응답에 포함될 수 있다.** 이름을 추가할 때 이 호출들을 `include_participant_pii=(s.host_id == uid)` 로 고쳐야 한다. 이 건은 코드 정독만으로 판단했고 실행으로 재현하지 않았다.
- **프론트 대체안(백엔드 무변경).**
  - FH03 완료 화면: 마법사가 이미 `ParticipantPicker` 에서 `SelectedParticipant{userId,name,email}` 를 들고 있으므로 이름 표시에 서버 응답이 필요 없다(`ParticipantPicker.tsx:7-11,41-52`).
  - 상세·로비의 초대 명단: `getSessionLiveMetrics(id)`(`session.ts:466-475`)의 `display_name` 을 `user_id` 로 매핑하거나, `listClients({size:100})`(`clients.ts:51-58`, 서버 `size` 상한 100 `api/v1/client.py:26`)로 `id→name` 맵을 만든다. 한계: `live-metrics` 는 대기열 참여자를 제외하고, `GET /clients` 는 `active` 연결 내담자만 주며(`client_service.py:121-135`) 100명 초과 시 페이지 순회가 필요하다. 연결이 종료된 회원은 맵에 없어 폴백이 남는다.

### 2.6 초대 흐름 (조사 6)

- **`POST /sessions/{id}/invite`.**
  - 요청: `InviteParticipantRequest{user_id: str}`(`schemas/session.py:192-193`), 호스트 전용(`_get_session_as_host` `session_service.py:674-687`).
  - 응답: `SessionResponse` 전체(`api/v1/session.py:292`, `session_service.py:1322`). 초대 결과 객체는 없다.
  - 거부: `completed`·`cancelled` 면 400(`:1269-1270`).
  - 중복: 같은 `(session_id,user_id)` 가 있으면 409 `이미 초대된 참여자입니다`(`:1287-1288`), 동시 경합은 `begin_nested` + `IntegrityError` 로 같은 409(`:1302-1308`). `uq_session_participant_user` 제약(`models/session.py:97-99`).
  - 한도: 정원이 차 있으면 거절하지 않고 **대기열에 넣는다**(`is_waitlisted=True`, `:1290-1297`, 정원 계산 `:1211-1231`). 1:1 이라는 이유로 거절하는 코드는 없다. 정원은 `max_participants` 하나만 본다. 예약 모달이 만든 `one_on_one`+10명 클래스(§2.1.1)는 10명까지 초대된다.
  - 이름 중복·존재 검증: 대상 사용자 존재 여부, 호스트와의 연결 여부를 검사하지 않는다(`_to_uuid` 형식 검사뿐 `:1272`). 존재하지 않는 `user_id` 면 PostgreSQL 에서는 FK 위반이 위의 `IntegrityError` 로 잡혀 **`이미 초대된 참여자입니다` 라는 잘못된 409** 가 나갈 것으로 읽힌다(코드 정독 추정, 미실행).
- **알림 발송 경로.** `invite_participant` 가 커밋 직후 `_notify_participants_event(s, "session_invited", ..., recipient_ids=[target_uuid], include_waitlisted=True, title="세션에 초대되었습니다", body=s.title or "세션")`(`session_service.py:1313-1320`)를 **요청 스레드 안에서 동기 호출**한다. Celery 가 아니다. 이 함수는 수신자별로 `notification_service.notify_event`(`:1084`)를 부르고 예외를 `logger.warning` 후 `db.rollback()` 으로 삼킨다(`:1100-1108`).
  - `notify_event`(`notification_service.py:207-281`): 사용자 환경설정의 `in_app[event]` 가 켜져 있으면(기본 켜짐 `models/user.py:51-90`) `Notification` 행 생성 + `ws` outbox 행(`:242-257`), `email[event]` 가 켜져 있으면(`session_invited` 기본 켜짐 `models/user.py:17`) `email` outbox 행(`:259-269`). 같은 트랜잭션에서 커밋하고 **실제 전달은 비동기 워커**가 한다: WS 는 `services/outbox_worker.py:14-`(최대 5회, 이후 `failed`), 이메일은 `tasks/outbox.py:16` `process_email_outbox`(최대 5회).
  - **푸시 없음.** outbox `channel="push"` 행을 적재하는 코드는 채팅(`chat_service.py:1448`)과 에이전트(`agent_service.py:327`, `agent_risk.py:429`)뿐이다. `session_invited` 는 앱 푸시가 가지 않는다(확정 결정 8 의 푸시 콘텐츠는 비범위지만 사실로 기록).
  - 수신자가 인앱 알림을 꺼 두면 `notify_event` 는 아무것도 만들지 않고 `None` 을 반환하며(`:221-223,242`) 이 값은 `_notify_participants_event` 에서 버려진다.
  - 이메일 본문: 제목 `[MIND BREEZE] 세션에 초대되었습니다`, 본문은 `s.title`(`:226-228,266`). 링크·입장 안내가 없다. 인앱 알림 문구도 `세션`(결정 7 용어 위반)이다.
- **딥링크 payload(I1 과 겹침, 사실만).** `build_standard_extra("session_invited","session",str(s.id), params=None, legacy={"session_id": ...})`(`session_service.py:1090-1096`) → `{schema_version:1, event_type:"session_invited", target_type:"session", target_id:<session id>, params:{}, session_id:<session id>}`(`notification_service.py:86-106`). 프론트는 `target_type=session` 을 회원이면 `/app/sessions/{id}` 로 보낸다(`lib/api/notifications.ts:154-156`).
- **발송 실패 처리.** 응답에 성공/실패 목록이 없다. 클라이언트가 알 수 있는 실패는 (a) `/invite` HTTP 오류(400 종료·403 비호스트·404·409 중복·네트워크), (b) 그 외 전부 성공으로 보인다. 알림 생성 실패·수신자 환경설정 off·이메일 outbox 실패는 응답으로 알 수 없다.
- **프론트 `Promise.allSettled` 방식의 한계**(`SessionCreatePage.tsx:150-160`).
  1. 참여자마다 별도 요청이라 N 번 왕복, 각 호출이 `_lock_session_for_capacity`(행 잠금, `session_service.py:1234-1244`)를 잡아 서로 직렬화된다. 동시에 던지면 정원 경계에서 어떤 사람이 대기열로 갈지 불확정이다.
  2. 실패 사유를 버린다(`results[i].status==='rejected'` 만 보고 `reason` 은 안 쓴다). 409(이미 초대됨)도 "실패"로 보여 준다.
  3. 정원 초과로 대기열에 들어간 사람도 "성공"으로 센다(응답의 `is_waitlisted` 를 안 본다).
  4. 실패자를 다시 시도할 수단이 없다. 문구가 "클래스 상세에서 다시 초대" 뿐이다(`:156-158`).
  5. 성공·실패를 화면에 구조화해 보여 주지 않는다(문구 한 줄).
  - 상세 페이지 쪽 `handleInvite` 는 순차 `for` 루프라 첫 실패에서 중단하고 나머지는 시도조차 안 한다(`SessionDetailPage.tsx:202-231`).
- **FH03 `partial` + `다시 보내기` 를 만들려면.**
  - 프론트 단독(채택 가능): 마법사가 `allSettled` 결과를 `{userId, name, state: 'sent'|'duplicate'|'waitlisted'|'failed', error}` 로 구조화한다. `ApiError.status===409` 는 `이미 초대됨`(성공 취급), 그 외 reject 는 `발송 실패`. `다시 보내기` = 실패 건만 `/invite` 재호출. `/invite` 가 실패한 건은 참여자 행이 안 생겼으므로(트랜잭션 롤백) 재호출이 올바른 재시도다. 한계: 이 "실패" 는 초대 등록 실패이지 알림 전달 실패가 아니다. 시안의 `발송 완료` 는 실제로는 `초대 등록 + 알림 큐 적재` 를 뜻한다.
  - 백엔드(권장): ① 일괄 초대 `POST /sessions/{id}/invites {user_ids: []}` → 사용자별 `{user_id, status: invited|already|waitlisted|failed, error, notified: bool}` 와 이름. ② 알림 재전송 `POST /sessions/{id}/participants/{user_id}/resend-invite`(`session_invited` 알림 재발화). ③ `_notify_participants_event` 가 수신자별 결과(`Notification|None`·예외)를 호출자에게 돌려주도록 반환값 추가. 규모 M. 알림 재전송 API 는 현재 **없음**.
- **로비 `다시 알림`·`초대 추가`(S6, I4 위임).** `초대 추가` 는 `/invite` 를 반복 호출하면 되어 API 는 **있음**(일괄은 없음). `다시 알림` 은 위 ②가 필요해서 **없음**. 대안 없음(알림을 다시 만드는 공개 API 가 없다). 상세 설계는 I4 에 위임한다.

### 2.7 템플릿 저장 (조사 7)

- **엔드포인트.** `POST /sessions/{id}/save-as-template`(`api/v1/session.py:272-289`, 본문 `title` 선택), `GET /sessions/templates`(`:137-149`), 복제 `POST /sessions/{id}/duplicate`(`:246-269`). 프론트 `saveSessionAsTemplate`·`listSessionTemplates`·`createSessionFromTemplate`(`session.ts:357-370`).
- **저장되는 필드.** `_COPYABLE_CONFIG_FIELDS`(`session_service.py:383-399`): `type`·`custom_type_name`·`duration_min`·`max_participants`·`location_type`·`location_address`·`participant_mode`·`linkband_mode`·`sfu_enabled`·`record_audio`·`record_video`·`chat_enabled`·`reminder_offsets`. 여기에 `title`(인자 또는 원본)·`notes`(원본)가 추가된다(`:457-495`). **일정·상태·코드·룸·run_id·참여자는 복사하지 않는다.** 템플릿은 `ready`·`access_code=null`·`is_template=true`(`:476-477,490`), 일반 목록에서 제외(`:631-653`).
- **새 필드가 늘면.** 마법사가 새로 저장하는 값은 위 13개 필드의 값뿐이라 **새 컬럼이 없으면 템플릿 호환 문제가 없다.** 결정 D2 에서 `ai_analysis` 컬럼을 추가하기로 하면 `_COPYABLE_CONFIG_FIELDS` 에도 넣어야 한다(`_clone_session_config` 의 `Session(**config, ...)` 가 필드 이름을 그대로 쓴다 `:473-483`).
- **"내 템플릿에서 시작" 매핑.** 현행 `applyTemplate`(`SessionCreatePage.tsx:93-123`)이 채우는 값: `type`·`customTypeName`·`locationType`·`locationAddress`·`participantMode`·`maxParticipants`·`linkbandMode`·`recordAudio`·`recordVideo`·`durationMin`·`notes`. 제목·일정은 새로 입력, **`reminder_offsets` 는 채우지 않는다**(서버는 복사하지만 프론트가 읽지 않음). 마법사는 `reminder_offsets` 도 읽어 `remind` 단일 선택(결정 D4)으로 역변환해야 한다. 역변환 규칙: `[]`→`off`, `[1440]`→`day`, `[60]`→`hour`, 그 외(복수·기타 값)는 **가장 이른 시점**을 고르고 나머지는 버린다고 안내.
- **시안의 위치.** FH03 `템플릿 저장` 보조 버튼(`host-a.html:590`)만 있고 **`내 템플릿에서 시작` 진입점은 시안에 없다.** 결정 D7.
- **저장 동작 변화.** 시안은 FH03 에서 저장한다. 현행도 생성 후(`SessionCreatePage.tsx:171-183`)라 흐름은 같다. 저장은 방금 만든 클래스 id 로 `save-as-template` 을 호출한다. 시안에서 `max_participants` 가 10 고정이면 템플릿에도 10 이 들어간다.

### 2.8 생성 완료 → `클래스 열러 가기` (조사 8)

- **`POST /sessions` 응답.** `SessionResponse`(`schemas/session.py:146-184`): `id`·`run_id`·`type`·`status`·`host_id`·`scheduled_at`·`access_code`·`opened_at`·`started_at`·`ended_at`·`duration_min`·`title`·`notes`·`max_participants`·`location_type`·`location_address`·`participant_mode`·`linkband_mode`·`webrtc_room_id`·`sfu_enabled`·`record_audio`·`record_video`·`chat_enabled`·`chat_room_id`·`is_template`·`reminder_offsets`·`created_at`·`participants[]`·`waitlist_count`. 생성 응답의 `participants` 는 `participant_ids` 로 넣은 사람만 담고 `/invite` 이후 값은 없다.
- **초기 status.** `scheduled_at` 없음 → `ready`, 있음 → `scheduled`(`session_service.py:279-280`).
- **오픈 가능 시점.** `TRANSITIONS["open"] = ({"ready","scheduled"}, "open")`(`:36`). `scheduled_at` 과 현재 시각을 비교하는 코드가 없다(`transition_status` `:854-918` 전체에서 `scheduled_at` 미참조). **예약 시각 이전에도 언제든 열 수 있고, 시각이 지나도 자동으로 열리지 않는다.** 방치된 `open` 은 24시간 후 스윕으로 취소된다(`STALE_OPEN_SESSION_MAX_AGE_HOURS=24` `:979`).
- **`/sessions/:id/player` 직행에 필요한 것.** 플레이어는 `session.status` 로 씬을 정한다. `ready`·`scheduled` 이면 세팅 씬(`isSetup` `ClassPlayerPage.tsx:967`), 거기서 `openClass` 가 `transitionSession(id,'open')` 을 호출한다(`:1033-1047`). 호스트 판정은 `session.host_id === currentUserId`(`:609`). 따라서 **생성 응답의 `id` 만 있으면 `navigate('/sessions/${id}/player')` 로 바로 갈 수 있고** 서버 선행 호출은 필요 없다. 목록의 `입장` 버튼이 이미 같은 경로로 간다(`components/session/SessionListTable.tsx:107-116`, `status !== 'cancelled'`면 노출).
- **시안과 코드의 차이.** 시안 FH03 의 주 CTA `클래스 열러 가기` 는 `data-go="FH04|ready"` 로 상담사 **상세**(FH04, `host-a.html:589`)로 연결되어 있고 `상세 보기` 도 같은 곳이다. 확정 결정 1 의 문구는 "주 CTA `클래스 열러 가기`" 이므로 이동 목적지(상세 vs 플레이어 세팅 씬)는 시안 기준으로는 상세다. 코드 쪽 `ready`/`scheduled` 직행은 가능함을 확인했으므로, 목적지는 plan 에서 결정한다(결정 D9).
- **예약(`scheduled`) 클래스의 `클래스 열러 가기`.** 시안 FH03 `scheduled` 케이스에서도 같은 버튼이다. 서버가 시각 검사를 안 하므로 가능하나, 회원 측에서 `scheduled` 클래스를 오픈 전 어떻게 보이는지는 미확인(§6).

### 2.9 장소·기본 주소·1:1 고정·LINK BAND·녹음 필드 (조사 9)

- **장소(오프라인 주소).** 입력은 즉시 폼 `SessionCreatePage.tsx:336-349`(기본 주소 비동기 채움 `:59-72`). 기본 주소 계산은 프론트 `getLocationAddressDefault`(`lib/class/session-location.ts:11-15`: 저장 주소 → 기관 주소 → 상담사 `address_line1 + address_line2`)와 서버 `resolve_location_address`(`session_service.py:54-82`)에 **같은 규칙이 이중 구현**되어 있다. 프론트가 `getCounselorProfile()`(`lib/api/counselor.ts`)·`getOrg(profile.org_id)`(`lib/api/org.ts`)로 미리 채워 보여 주고, 사용자가 비워 두면 서버가 같은 규칙으로 다시 채운다. 마법사는 시안 ①단계의 주소 입력(`host-a.html:494`)에 이 사전 채움을 그대로 재사용하면 된다. 편집 UI 는 상세에도 있다(`session-location-editor.tsx`, `ready`·`scheduled` 에서만 `SessionDetailPage.tsx:450-452`).
- **1:1 최대 1명.** 프론트: `participantMode` 변경 시 `setMaxParticipants(1)`·선택자 절단(`SessionCreatePage.tsx:356-364`), 선택 상한 `pickerMax`(`:75`), 입력 비활성(`:484`). **서버: 강제 없음.** `max_participants` 는 클라이언트가 보낸 값대로 저장되고(`session_service.py:295-298`, 명상이 아니면 `max(입력,1)`), 1:1 이어도 정원이 10 이면 10명까지 초대된다. `participant_mode` 가 서버에서 읽히는 곳은 송신 가능 판정 `_compute_can_publish`(`:1755-1772`)와 온라인 그룹 정원 검사뿐이다.
- **LINK BAND.** 필드 `linkband_mode`: `none`/`optional`/`required`(`schemas/session.py:17,34`, 모델 `models/session.py:61`, 프론트 `LinkbandMode` `session.ts:24`). 시안 `band` 의 `none`·`optional`·`required` 와 값이 1:1 대응이고 라벨만 다르다(시안 `사용 안 함·선택·필수` ↔ 현행 `미사용·선택·필수`).
- **녹음·영상·AI 분석.** 서버 필드는 `record_audio`·`record_video` 두 개(`schemas/session.py:37-38`, `models/session.py:66-67`, 기본 true). 시안 FH02b 는 `voice`·`ai`·`video` 세 토글이다(`host-a.html:512,509`).
  - `voice` ↔ `record_audio`, `video` ↔ `record_video`: 1:1 대응.
  - **`ai` ↔ 대응 필드 없음.** AI 요약·리포트는 세션 종료 시 녹음이 있으면 자동으로 돈다(`services/audio_service.py:243-293` `finalize_on_session_end`가 STT→요약→리포트 chain 을 적재). 세션 단위로 AI 분석을 끄는 플래그는 서버에 없다(`grep ai_analysis` 0건). 현행 폼 문구는 "AI 클래스 분석: 영상·음성을 녹화해 …"(`SessionCreatePage.tsx:429-452`)로 녹화 두 체크박스를 묶어서 `AI 분석` 이라 불렀다. 시안처럼 `음성 녹음 ON·AI 분석 OFF` 조합은 저장할 곳이 없다. 결정 D2.
  - `record_audio`·`record_video` 의 소비처는 프론트 플레이어뿐이다: 시작 직후 자동 녹음 동의 모달(`ClassPlayerPage.tsx:1068-1076`), `record_video===false` 면 영상 UI 제거·영상 녹화 미시작(`HostLiveContainer.tsx:293`, `ClassPlayerPage.tsx:1142`). 서버는 저장·복사만 한다.
  - **오프라인 + `record_video`.** 서버는 막지 않는다. 플레이어도 `location_type` 으로 영상 녹화를 막지 않고 `record_video` 만 본다. 시안은 오프라인에서 영상 녹화 자리를 안내문으로 바꾸므로, 마법사가 오프라인이면 `record_video=false` 를 보내야 플레이어가 영상 녹화를 시작하지 않는다. 결정 D3.
- **`sfu_enabled`.** 즉시 폼은 `온라인 && 그룹` 일 때 true 를 보낸다(`SessionCreatePage.tsx:141`). 서버에서 이 값의 소비처는 없다(저장·복사뿐, `grep sfu_enabled` 결과). 마법사도 같은 식으로 계속 보내면 되고, 안 보내도 동작에 영향 없다.
- **`one_on_one` 의 `can_publish`.** 온라인 1:1 은 상시 송출(`session_service.py:1766-1767`), 온라인 그룹 ≤20 은 발언권 부여 시만(`:1768-1769`). 시안 그룹 최대 10 은 이 규칙과 호환된다(그룹 ≤20 은 항상 발언권 관리 대상).

### 2.10 마법사 구현 구조 제안 (조사 10)

**현행 관례 확인.**
- 페이지 단위 폼 상태는 `useState` 나열(`SessionCreatePage.tsx:24-57`). 전역 `zustand`(`stores/*.ts`)는 인증·채팅·알림·세션 목록 뷰 설정 같은 **앱 전역/교차 화면 상태**에만 쓴다(`stores/sessionStore.ts`). 플레이어는 화면별 훅(`useHostUi.ts`)과 순수 파생 함수(`lib/class/*-case.ts`)를 쓴다(SDD-208 plan `§1.2`).
- 케이스 하니스: `lib/class/player-harness.ts` + `pages/design/ClassPlayerCasesPage.tsx`(`App.tsx:61,203`)가 `lib/class/fixtures/*.ts` 의 `playerCases` 를 자동 수집한다. SDD-208 선례는 시안 `state` 키와 같은 이름을 쓴다.
- 이탈 가드: `hooks/useLeaveGuard.ts:12-36`(`beforeunload` + `useBlocker`, 이탈 시점에 `shouldGuard()` 평가, `currentLocation.pathname !== nextLocation.pathname` 일 때만 차단). 데이터 라우터 전제(`App.tsx:149` `createBrowserRouter`). 사용처는 `ClassPlayerPage.tsx:1025-1030` 한 곳이고, 프로그램 이동은 `bypassGuardRef` 로 우회한다(`:1020,1092-1094`). 확인 모달 `components/player/LeaveGuardModal.tsx` 는 `SessionStatus` 별 문구로 고정돼 마법사에는 재사용 불가.

**제안 상태 관리.** 마법사 드래프트는 한 화면 수명 동안만 필요하므로 **zustand 를 쓰지 않고** `useReducer` 기반 훅 한 개로 둔다. 단계 이동·수정 점프(시안 FH02e 의 연필 아이콘 `data-go="FH02c"`)가 같은 훅 안에서 일어나고, 라우트를 바꾸지 않으므로 이탈 가드가 단계 이동에 걸리지 않는다. 시안의 `sessionStorage('w_state')` 는 시안 단독 페이지 간 이동용이라 구현에서는 필요 없다. 새로고침 복원이 필요하면 `sessionStorage` 에 드래프트를 저장하되 결정 사항으로 둔다.

**신규 파일 제안**(SDD-208 명명 규칙: 컴포넌트 `PascalCase.tsx`, lib·훅 `kebab-case.ts`/`useXxx.ts`)

```
frontend/src/
├─ lib/class/
│  ├─ class-wizard.ts               # 타입 ClassWizardState(시안 BASE 키), 기본값, 단계별 검증, toCreatePayload(), 템플릿→상태 변환, 5분 단위 보정, 충돌 계산(detectLocalConflict), legacy notes 태그 파생
│  └─ fixtures/wizard-cases.ts      # FH02a~e·FH03 케이스 입력(시안 PRESET 과 같은 키) — 하니스·단위 테스트 공용
├─ hooks/
│  ├─ useClassWizard.ts             # useReducer(상태·단계·검증), 제출(createSession → 초대 allSettled 구조화 → 결과), 템플릿 저장
│  └─ useWizardLeaveGuard.ts        # useLeaveGuard 를 감싸 드래프트 dirty 일 때만 차단 + bypass ref
├─ components/class/wizard/
│  ├─ ClassWizardShell.tsx          # 상단 X·제목·스텝 점·하단 이전/다음 (몰입형, 앱 셸 없음)
│  ├─ StepTypeMode.tsx · StepRecording.tsx · StepSchedule.tsx · StepInvite.tsx · StepReview.tsx
│  ├─ WizardStepper.tsx             # 시안 `.w-stepper`(날짜·시·분·소요 시간 공용)
│  ├─ WizardLeaveSheet.tsx          # 시안 FH02a `leave` 케이스 시트
│  └─ CreatedInviteStatus.tsx       # FH03 초대 현황(성공·실패·다시 보내기)
└─ pages/sessions/ClassCreateWizardPage.tsx   # 라우트 `/sessions/new` 로 SessionCreatePage 교체
```

- 라우트: `App.tsx:189` 의 `/sessions/new` 를 새 페이지로 교체하고, 예약 모달(`SessionListPage.tsx:47-511`)과 `예약 만들기` 버튼(`:679-681`)은 제거한다(시안 FH01 의 `클래스 만들기` 단일 진입). `SessionCreatePage.tsx` 의 `created` 분기와 코드 노출은 함께 삭제된다(확정 결정 1). `AppShell` 은 쓰지 않는다(결정 6, 몰입형).
- 재사용: `ParticipantPicker`(검색·CSV 칩 UI 는 시안과 달라 재스타일 필요, 데이터 로직은 유지 — `listClients` 호출, CSV 이메일 N회 조회 `:80`), `lib/class/session-location.ts`, `lib/class/reminder.ts`(`REMINDER_ON_OPTIONS` 는 시안 `끄기/하루 전/1시간 전` 과 같은 값). 두 lib 에는 기존 테스트가 있으므로(`tests/session-location.test.ts`, `tests/session-reminder.test.ts`, `tests/session-location-editor.test.tsx`) 시그니처를 바꾸지 않는다.
- 이탈 확인 시트(`leave`): 상단 X 버튼이 시트를 열고(`host-a.html:469`, `data-sheet="leave"`), `useWizardLeaveGuard` 는 `useBlocker` 로 브라우저 뒤로가기·사이드바 이동을 가로채 같은 시트를 띄운다. `dirty` 는 기본값과 달라졌는지로 판단한다. 생성 성공 후 `/sessions/:id` 등으로 이동할 때는 bypass. `beforeunload` 도 같은 조건으로 건다(`useLeaveGuard` 가 이미 포함). 새로 만든 가드의 `shouldGuard` 는 이탈 시점에 평가되므로 `useRef` 로 최신 상태를 참조해야 한다(`useLeaveGuard.ts:12-16` 와 같은 패턴).
- 하니스: `pages/design/ClassFlowCasesPage.tsx`(`/design/class-flow`, `App.tsx` 에 라우트 1줄)로 `fixtures/wizard-cases.ts` 를 렌더하는 방식이 SDD-208 선례와 일치한다.

## 3. 변경 목록

### 3.1 프론트

| 파일 | 변경 | 규모 |
|---|---|---|
| `lib/class/class-wizard.ts`(신규) | 상태 모델·검증·payload 변환·충돌 계산·5분 보정·템플릿 변환·legacy 태그 파생 | M |
| `hooks/useClassWizard.ts`(신규) | 단계·제출·초대 결과 구조화·재시도·템플릿 저장 | M |
| `hooks/useWizardLeaveGuard.ts`(신규) | `useLeaveGuard` 래핑, dirty·bypass | S |
| `components/class/wizard/*`(신규 9개) | 5단계 + 쉘 + 스텝퍼 + 이탈 시트 + FH03 초대 현황 | L |
| `pages/sessions/ClassCreateWizardPage.tsx`(신규), `App.tsx:189` | `/sessions/new` 교체 | S |
| `pages/sessions/SessionCreatePage.tsx` | 삭제(코드 노출·즉시 폼 포함) | S |
| `pages/sessions/SessionListPage.tsx:47-511,679-684,858-862` | `CreateSessionModal` 제거, 두 진입 버튼을 `클래스 만들기` 하나로 | S~M |
| `lib/api/session.ts` | (선택) `CreateSessionPayload` 는 그대로. 템플릿 역변환·legacy 정규화 래퍼 추가 시 소폭. 서버 변경 시 `user_name`·일괄 초대 타입 추가 | S |
| `pages/sessions/SessionDetailPage.tsx:64-68,202-231` | `participantLabel` 폴백(서버 수정 전까지 `live-metrics` 매핑), 초대 순차 루프 개선(I4 와 조율) | S |
| `lib/class/fixtures/wizard-cases.ts`, `pages/design/ClassFlowCasesPage.tsx`, `App.tsx` 라우트 | 하니스 | M |
| `tests/` | `class-wizard.test.ts`(검증·payload·충돌·5분 보정·reminder 역변환·legacy 태그), 하니스 렌더 테스트 | M |

### 3.2 백엔드

| 항목 | 변경 | 분류 | 기존 데이터 호환 | 필요 테스트 | 프론트 단독 대체안 |
|---|---|---|---|---|---|
| A6 이름 필드 | `ParticipantInfo.user_name`·`user_email` 추가, `_serialize` 에 이름 맵, host 전용 호출만 채움 | **권장** | 신규 필드(기본 null), 무영향 | `backend/tests/test_session.py` 계열에 host/참여자 응답 이름 노출·비노출 | FH03 는 선택 목록의 `name` 사용, 상세는 `live-metrics`·`GET /clients` 매핑(§2.5) |
| A6 PII | `list_sessions`·`join_by_code` 의 `_serialize` 를 호스트 여부로 PII 제어 | **권장**(발견된 기존 노출) | 응답에서 타인 성별·생년월일 제거. 참여자 클라이언트가 이 값을 읽는 곳이 있는지 확인 필요(미확인) | 참여자로 `GET /sessions` 호출 시 타인 PII null | 해당 없음 |
| S6/FH03 초대 결과·재전송 | 일괄 초대 `POST /sessions/{id}/invites`(사용자별 결과) + 알림 재전송 + `_notify_participants_event` 가 결과 반환 | **권장**(규모 M) | 신규 엔드포인트, 기존 `/invite` 유지 | `backend/tests/test_notification.py`·`test_session.py` 에 대기열·중복·알림 off 케이스 | `allSettled` 구조화 + 실패 건 `/invite` 재호출(§2.6). 알림 재전송은 대체안 없음 |
| 1:1 서버 강제 | `participant_mode=one_on_one` 이면 `max_participants=1`, 1:1 초대가 가득 차면 대기열 대신 400/409 | **권장**(S) | 기존 `one_on_one`+10명 세션(예약 모달 산출물)은 그대로 둠. 읽기 호환만. 2번째 초대 거절은 신규 호출부터 적용 | 1:1 두 번째 초대 거절 테스트 | 마법사가 `size=solo` 면 1 고정 + 선택 1명(현행과 동일) |
| A2 과거 데이터 백필 | `location_type='offline'` AND `notes LIKE '[온라인]%'` 행을 `online`·주소 null 로 | **권장(선택)** | 접두사는 지우지 않음. 가역 | 마이그레이션 단위 테스트 | `lib/api/session.ts` 정규화 래퍼(§2.2). 단 회원 입장 경로는 못 덮음 |
| 충돌 사전 조회 | `GET /sessions/conflicts` | **보류**(S) | 신규 | `test_session.py` 충돌 케이스 확장 | `GET /sessions` 로 클라이언트 검사(§2.4) |
| `duration_min` `multiple_of=5`/시작 시각 5분 | `SessionCreateRequest` 검증 | **보류** | 구 값 읽기 호환 유지(생성에만 적용) | 시각 검증은 기존 테스트 다수를 수정해야 함 | 프론트 스텝퍼·시각 입력 제약 |
| 오프라인 + `record_video` 차단 | 스키마 검증 | **보류** | 기존 값 유지 | 해당 | 마법사가 오프라인이면 `record_video=false` 전송 |
| `AI 분석` 플래그 | `ai_analysis` 컬럼 + `_COPYABLE_CONFIG_FIELDS` + 파이프라인 분기 | **보류**(결정 D2 에 따라 변동) | 컬럼 `NOT NULL DEFAULT true` 로 기존 데이터 유지 | 파이프라인 분기 테스트 | 시안 `ai` 를 `record_audio` 파생으로 처리 |
| `session_invited` 푸시·문구 | 푸시 outbox 적재, 알림 문구 `세션`→`클래스` | **보류**(푸시 콘텐츠는 비범위) | 해당 | 해당 | 해당 |
| 예약 리마인더 본문 | `참여코드`·`/join` 링크 제거 | 이 조사 범위 밖(I1·코드 제거 소관). 사실만: `reminder_service.py:132-179` 가 `참여코드: {code}`·`/join` 링크를 본문에 넣는다 | 과거 예약도 이 본문으로 발송됨 | 해당 | 해당 |

필수/권장/보류 합계: **필수 0 / 권장 5(A6 이름, A6 PII, 초대 결과·재전송, 1:1 강제, A2 백필(선택)) / 보류 6(충돌 조회, 5분 서버검증, 오프라인 영상, AI 플래그, 푸시·문구, 리마인더 본문은 타 조사 소관).** 권장 중 A2 백필은 프론트 정규화로 대체 가능하므로 "선택"이다.

## 4. 위험·주의

- **예약 모달 산출 데이터**: 지금까지 만든 예약은 `participant_mode=one_on_one`+`max_participants=10`+`location_type=offline`+`notes` 접두사(§2.1.1, §2.2). 마법사의 템플릿 저장·복제·상세 표시는 이 모양을 그대로 읽는다. 복제하면 이 이상한 설정이 복사된다(`_COPYABLE_CONFIG_FIELDS`).
- **그룹 정원 10 고정**(시안): 현행 클래스·템플릿의 `max_participants` 가 10 이 아닌 경우 마법사에서 수정할 수단이 없어진다. 상세 화면에는 정원 편집이 없다(편집은 `updateSession` 으로만 가능하고 UI 는 장소 편집뿐 `session-location-editor.tsx`).
- **정원 초과 초대는 조용히 대기열행**: 마법사의 선택 상한이 서버 정원과 어긋나면 초대 성공으로 보이는 사람이 실제로는 대기열이다. 응답 `participants[].is_waitlisted` 를 확인해 `waitlisted` 로 표시해야 한다.
- **초대 동시 호출**: 참여자마다 행 잠금으로 직렬화되므로 `allSettled` 병렬은 이득이 작다. 순차 호출 + 진행 표시가 더 예측 가능하다.
- **`409` 의 두 의미**: `/sessions` 생성의 409 는 시간 충돌, `/invite` 의 409 는 `이미 초대된 참여자입니다`(존재하지 않는 사용자도 이 문구로 나갈 것으로 읽힘). 상태 코드만으로 분기하지 말고 호출 종류별로 해석한다.
- **회귀 지점**: `tests/session-location*.test`·`tests/session-reminder.test` 는 `lib/class` 헬퍼를 직접 테스트한다. 시그니처 유지. `e2e/` 에서 `즉시 클래스 만들기`·`예약 만들기` 문구를 쓰는 곳은 확인되지 않았다(`grep` 0건).
- **배포 순서**: 프론트(마법사)와 서버 변경은 독립 배포 가능하다. 권장 변경 중 A6 필드는 추가형이라 먼저 서버, 이후 프론트가 읽는 순서가 안전하다. 예약 모달 제거와 `[온라인]` 파생 코드는 같은 프론트 릴리스에 넣어야 과거 데이터 표시가 깨지지 않는다.
- **A6 노출 범위**: 이름·이메일을 응답에 추가할 때 회원이 읽는 응답에 새지 않게 한다(§2.5-3). 이메일은 호스트 화면에서도 꼭 필요할 때만 내려준다(데이터 프라이버시 규칙 `최소 권한 접근`).
- **알림 off 사용자**: 인앱 알림을 꺼 둔 회원은 초대를 받아도 알림이 없다(§2.6). 초대 화면에서 "발송 완료"라고만 보이면 상담사가 오해한다.

## 5. 사용자 결정 필요

| # | 질문 | 옵션 | 기본값 제안 | 영향 |
|---|---|---|---|---|
| D1 | 그룹 최대 인원 | (a) 시안대로 10 고정 (b) ①단계에 인원 입력 복원 (c) 기본 10 + 상세에서 변경 | (a) | 현행은 1~100(온라인 그룹 ≤50). 11명 이상 그룹 불가. 템플릿·복제는 원본 값 보존 |
| D2 | 시안 `AI 분석` 토글의 의미(서버에 필드 없음) | (a) 별도 토글 없이 `음성 녹음`이 곧 AI 분석(토글 제거·고지 문구만) (b) `ai_analysis` 컬럼 신설 | (a) | (b)는 마이그레이션·파이프라인 분기·템플릿 필드 추가가 따른다 |
| D3 | 대면(오프라인) 클래스의 영상 녹화 | (a) 오프라인이면 `record_video=false` 로 저장 (b) 값은 true 로 두고 UI 만 숨김 | (a) | (b)는 플레이어가 영상 녹화를 시작해 시안(`대면은 영상 녹화 없이`)과 어긋남 |
| D4 | 예약 알림 선택 방식과 기본값 | 시안: 단일 선택(끄기/하루 전/1시간 전), 기본 1시간 전. 현행: 다중, 기본 하루 전 | 시안대로 단일, 기본값은 확인 필요 | 서버는 다중 지원. 기존 `[1440,60]` 클래스를 템플릿으로 열면 하나만 남는다 |
| D5 | `기타` 유형의 이름 입력 | (a) `기타` 선택 시 ①단계에 이름 입력 노출 (b) 시안대로 칩만 두고 `custom_type_name` 고정값 전송 | (a) | 서버는 `custom` 이면 이름 필수(`schemas/session.py:57-62`). 현행 예약 모달에는 `기타` 자체가 없었다 |
| D6 | 클래스 이름(제목) 필수 여부 | (a) 필수 (b) 비우면 `유형 + 날짜` 자동 이름 (c) 선택(현행 예약) | (b) | 목록·알림에 `제목 없음`(`SessionDetailPage.tsx:403`)이 노출되는 문제와 연동. 서버는 `title` null 허용 |
| D7 | `내 템플릿에서 시작` 진입 위치(시안에 없음) | (a) ①단계 상단 (b) 목록 `클래스 만들기` 시트 (c) 미제공 | (a) | 현행 기능 유지 여부. 저장 필드는 §2.7 |
| D8 | `클래스 열러 가기` 목적지 | (a) 시안대로 상세(FH04) (b) 플레이어 세팅 씬(`/sessions/:id/player`)으로 직행 | (a), 예약 클래스는 (a) 고정 | (b)는 서버 선행 호출 없이 가능(§2.8). 예약 클래스를 오픈하면 시각과 무관하게 열린다 |
| D9 | 초대 "발송 완료" 의미와 알림 off 회원 처리 | (a) 초대 등록 성공 = 발송 완료로 표기 (b) 서버가 알림 생성 여부까지 돌려주도록 변경(권장 백엔드) | (a), (b)는 S6 과 함께 | 알림 off 회원·이메일 실패는 (a)에서 숨겨진다 |
| D10 | 과거 `[온라인]` 예약 데이터 | (a) 프론트 표시 파생만 (b) DB 백필 | (a) | (b)는 회원 입장 경로까지 정정되지만 마이그레이션 필요 |
| D11 | 예약 가능 범위(시안 UI 제약) | 시안: 오늘~13일 뒤, 07~22시, 소요 최대 8시간 | 시안대로 | 서버는 과거만 막음. 기존 600분 세션은 읽기 영향 없음 |

## 6. 확인하지 못한 것

1. 운영/개발 DB 에 `[온라인]`·`[오프라인]` 접두사 `notes` 세션 수, `duration_min` 이 5의 배수가 아닌 세션 수 — DB 접근 금지.
2. 존재하지 않는 `user_id` 로 `/invite` 호출 시 실제 응답(FK 위반 → 409 로 보일 것으로 읽음) — dev 호출 금지, 코드 정독 추정.
3. `GET /sessions` 에서 참여자에게 타인의 성별·생년월일이 실제로 내려가는지 실행 확인 — 코드 정독으로 판단.
4. 이메일 outbox 의 실제 발송 성공률·SMTP 설정, 인앱/이메일 환경설정 off 비율 — 운영 데이터 없음.
5. 회원 화면이 `scheduled` 클래스를 오픈 전·후에 어떻게 보여 주는지, `GET /sessions` 가 돌려주는 타인 PII 필드를 회원 클라이언트가 읽는지 — I1·회원 조사 소관.
6. `GET /clients` 가 아닌 경로(초대하려는 회원이 활성 연결이 아닌 경우)의 이름 조회 — 현 API 로는 불가능해 보이나 다른 엔드포인트 존재 여부를 전수 확인하지 못했다.
7. `session_invited` 이메일이 실제 어떤 본문으로 렌더되는지(`tasks/email.py` 템플릿 경로) — `notify_event` 는 `subject`·`body` 문자열만 outbox 에 넣는 것까지만 확인했고 워커의 최종 렌더링은 읽지 않았다.
8. 시안 FH02d 의 `CSV 추가` 동작 사양 — 시안은 버튼만 있고 동작이 없어 현행 `ParticipantPicker` 의 CSV 로직(이메일당 `listClients` N회, `:80`)을 유지한다고 가정했다.
9. 프론트 `useBlocker` 를 마법사 같은 비플레이어 화면에 적용한 선례 — 저장소에 `useLeaveGuard`(플레이어 전용) 사용처 1건뿐이라 동일 패턴 가정으로 제안했다.

## 부록: 다른 조사와의 겹침

- **I1(입장·딥링크)**: 초대 알림 extra 와 회원 라우트 `/app/sessions/{id}`(§2.6), 예약 리마인더 본문의 참여코드·`/join` 링크(§3.2 마지막 행), `SessionByCodeResponse.location_type` 정규화 불가(§2.2).
- **I4(로비·초대 현황)**: `다시 알림`·`초대 추가`(§2.6), 참여자 이름 필드(§2.5), 초대 `Promise` 순차 루프(`SessionDetailPage.tsx:202-231`).
- **결정 충돌**: 없음. 확정 결정 4(5분 단위)는 서버 검증 없이 프론트 제약으로 충족 가능하다는 점만 기록한다.
