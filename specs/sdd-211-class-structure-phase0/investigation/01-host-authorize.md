# 조사 01 — 호스트 판정 복제 헬퍼 전수와 `authorize_session` 설계 (SDD-211 Phase 0 항목 2)

> 조사일 2026-10-18 · 읽기 전용(코드 수정·DB/서버 실행 없음) · 근거는 `파일:줄`(ROOT=`/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`, 이하 `backend/app/` 는 `app/` 로 줄임).
> 근거 없는 것은 `미확인`. 테스트는 **실행하지 않았고** grep·정독으로만 판단했다(실행 결과 아님).

## 0. 한 줄 결론

- **복제 헬퍼 9곳은 확인됐다. 그러나 "5개 서비스 파일"은 틀렸고 실제 6개 파일이다**(session·record·audio·video·session_email_invite·report). R9 문서의 같은 표(`조사/R9-강사모델권한.md:60`)도 6개 파일을 나열한다.
- 9곳은 **의미가 같은 한 종류가 아니라 4가지 계열**이다. 가장 큰 함정은 `session_service._get_session_as_host`(`app/services/session_service.py:742`) 만 **기관 활성 검사(409) + 기관 행 `FOR UPDATE` 잠금**을 한다는 점이다. 나머지 호스트 전용 복제본은 이를 하지 않는다. 단일 함수로 합치면서 이걸 놓치면 응답이 바뀐다.
- 9곳 밖에도 호스트 비교가 **인라인으로 7곳+** 있고, `_can_access_report`(`app/services/report_service.py:823`)는 이름과 달리 **호스트·같은 기관 org_admin·참여자**를 모두 통과시키는 별개 의미다. "9곳 통합"에 섞으면 안 된다.
- 9곳 헬퍼의 호출 지점은 총 **33곳**. 이 중 **비호스트 거부(403) 테스트가 없는 지점**이 있다(§4) — 리팩터 전에 특성화 테스트를 먼저 써야 한다.

---

## 1. 복제 헬퍼 9곳 전수

공통: 전부 `db.query(Session).filter(Session.id == sid).first()` 로 세션을 직접 읽고(`db.get` 아님), 없으면 404 `"세션을 찾을 수 없습니다"`, 이후 판정한다. **호스트 아님 확인보다 404가 항상 먼저**다(존재 은닉 없음). 어느 복제본도 사용자 **role 을 보지 않는다** — org_admin·platform_admin 도 호스트가 아니면 403.

| # | 위치 | 이름·시그니처 | 통과 | 거부 | 세션 직접 로드 | 호출 지점 |
|---|---|---|---|---|---|---|
| 1 | `app/services/session_service.py:724-739` | `_get_session_for_user(session_id, user_id, db)` | 호스트, 또는 `SessionParticipant.user_id == uid` 행 존재 | 404 `세션을 찾을 수 없습니다`(:728) / 403 `접근 권한이 없습니다`(:739) | 예 | 2 — `:240`(`get_session_chat_room`), `:759`(`get_session`) |
| 2 | `app/services/session_service.py:742-755` | `_get_session_as_host(session_id, host_id, db)` | 호스트 + **기관 활성 검사** | 404(:746) / 403 `host 상담사만 가능합니다`(:748) / **409**(아래 D1) | 예 | **16** — 파일 내 12(`:222,585,631,768,903,945,1136,1481,1553,1605,2537,3158`) + 외부 4(`app/api/v1/session.py:631,703`, `app/services/session_invite_service.py:53`, `app/services/research_consent_service.py:243`) |
| 3 | `app/services/session_service.py:1652-1668` | `_get_session_for_participant(session_id, user_id, db)` | #1 과 본문 동일(독스트링만 다름) | 404(:1657) / 403 `접근 권한이 없습니다`(:1668) | 예 | 2 — `:1673`(`join_session`), `app/ws/record_namespace.py:59-63`(**private 이름을 import**) |
| 4 | `app/services/record_service.py:26-41` | `_get_session_for_user(...)` | #1 과 동일 | 404(:30) / 403 `접근 권한이 없습니다`(:41) | 예 | 3 — `:185`(`get_record`), `:209`(`get_transcript`), `:230`(`get_report_status`) |
| 5 | `app/services/record_service.py:44-51` | `_get_session_as_host(...)` | 호스트만(기관 검사 **없음**) | 404(:48) / 403 `host 상담사만 가능합니다`(:50) | 예 | 1 — `:235`(`update_record`) |
| 6 | `app/services/audio_service.py:40-47` | `_get_host_session(...)` | 호스트만(기관 검사 없음) | 404(:44) / 403 `host 상담사만 가능합니다`(:46) | 예 | 3 — `:70,112,172`(start/chunk/stop) |
| 7 | `app/services/video_service.py:117-124` | `_get_host_session(...)` | 호스트만(기관 검사 없음) | 404(:121) / 403 `host 상담사만 가능합니다`(:123) | 예 | 3 — `:140,157,233`(start/chunk/stop) |
| 8 | `app/services/session_email_invite_service.py:64-76` | `_get_host_session(...)` | 호스트만(기관 검사 없음) | 400 `잘못된 ID 형식입니다`(:69) / 404(:72) / 403 **`호스트만 초대할 수 있습니다`**(:74) | 예 | 2 — `:102`(`invite_by_email`), `:191`(`list_email_invites`) |
| 9 | `app/services/report_service.py:225-232` | `_get_session_as_host(...)` | 호스트만(기관 검사 없음) | 404(:229) / 403 `host 상담사만 가능합니다`(:231) | 예 | 1 — `:276`(`generate_report`) |

호출 합계 2+16+2+3+1+3+3+2+1 = **33**. 계열: (A) 호스트 전용·기관 검사 없음 = #5,6,7,9 / (B) 호스트 전용+기관 검사 = #2 / (C) 호스트 전용·문구 상이 = #8 / (D) 호스트 또는 참여자 = #1,3,4.

호스트 전용 복제본의 403 문구 분포: `host 상담사만 가능합니다` 5곳(#2,5,6,7,9), `호스트만 초대할 수 있습니다` 1곳(#8). 참여자 허용 3곳(#1,3,4)은 `접근 권한이 없습니다`.

`_to_uuid` 복제본도 13곳(`grep "def _to_uuid" app` → 13)이며 확인한 5곳(session·record·audio·video·report)은 본문 동일(400 `잘못된 ID 형식입니다`). 헬퍼 통합 범위 밖.

### 1.1 9곳 밖의 호스트 판정 (통합 후보 vs 건드리지 말 것)

| 위치 | 의미 | 거부 응답 | 9곳과 다른 점 |
|---|---|---|---|
| `app/services/report_service.py:823-846` `_can_access_report(user_id, session, db) -> bool` | 호스트 OR (`user.role=="org_admin"` 이고 `host.org_id == user.org_id`) OR **세션 참여자** | bool(호출부가 403 변환) | **9곳이 아님.** org_admin·참여자까지 통과. 호출: `report_service.py:728`(`get_report`), `:854`(`require_report_host`, 문구 `host 상담사만 가능합니다`), `:864`(`update_report`, 문구 `host 상담사만 수정 가능합니다`), `report_comment_service.py:39`(문구 `host 상담사만 가능합니다`) |
| `app/services/report_service.py:914` `approve_report` | 리포트→세션 조회 후 `session.host_id != host` | 403 `host 상담사만 승인 가능합니다` | 세션 없음도 403(`not session or ...`) |
| `app/services/session_service.py:2382` `set_speaking` | 인라인 호스트 비교 | 403 `발언권은 상담사만 부여/해제할 수 있습니다` | **순서가 다름**: 404 → 종료 상태 **400**(:2381) → 호스트 403. 비호스트가 종료 세션에 호출하면 403 이 아니라 400 |
| `app/services/session_service.py:2506-2508` `resolve_audio_sync_host` | `current_user_id` 없으면 403, 호스트 아니면 403 | 403 `상담사만 재생을 제어할 수 있습니다`(두 곳 동일 문구) | WS 호출(`app/ws/session_live_namespace.py:898` → `_resolve_audio_host` `:955`), HTTP 아님 |
| `app/services/session_service.py:2731` `resolve_live_join` | 호스트면 role `host` 스냅샷, 아니면 참가자 해석 | 거부 없음(분기) | 판정이 분기일 뿐 거부가 아님 |
| `app/services/session_service.py:1798` `_enter_resolved` | 호스트는 참여자로 입장 불가 | 403 `호스트는 참여자로 입장할 수 없어요`(require_invite일 때) / 아니면 호스트 응답 반환 | 통합 대상 아님(입장 규칙) |
| `app/api/v1/video.py:81,108` `get_video_url`·`stream_video` | `host_id != 요청자 and role != "platform_admin"` | 403 `호스트 상담사만 영상을 조회할 수 있습니다` | **platform_admin 우회가 있는 유일한 지점**. 라우트에서 직접 `db.query(Session)` |
| `app/services/export_service.py:65` `authorize` | `role=="counselor"` 는 호스트만, `platform_admin` 은 모두, `org_admin` 은 별도 403(:57-58) | 비호스트 상담사는 **404** `대상을 찾을 수 없습니다` | 존재 은닉(404). 문구·코드 전부 상이 |
| `app/services/chat_service.py` 다수 | `ChatRoom.host_id`(방장) 비교 | — | **다른 컬럼**(`ChatRoom.host_id`). 세션 호스트 판정과 무관 — 통합 금지 |

R9 가 센 "인라인 7+"(`조사/R9-강사모델권한.md:61`)와 위가 대체로 일치한다. 신규 후보는 `resolve_audio_sync_host` 의 미인증 분기(:2505)와 `export_service` 의 org_admin 별도 거부다.

---

## 2. 동작 차이 (동작 동일 리팩터의 함정)

**D1. 기관 활성 검사·행 잠금 — #2 에만 있다.** `_get_session_as_host` 는 호스트 확인 뒤 `db.get(User, s.host_id)` → `require_active_user_org(host, db)` → (세션에 `organization_id` 가 있으면) `require_active_org(...)` 를 호출한다(`session_service.py:749-755`). 이 함수들은 `lock_organization` 으로 **조직 행에 `with_for_update()`**(`app/services/org_management_service.py:68`)를 걸고, `db.refresh(user, [...])`(:86)를 하며, 기관 비활성이면 **409 `비활성화된 기관에서는 이 작업을 수행할 수 없습니다`**(:78), 소속 변경이면 409 `소속 기관이 변경되었습니다. 다시 시도해주세요`(:88)를 던진다.
- 영향: 이 헬퍼를 쓰는 **읽기 엔드포인트도 조직 행 잠금과 409 위험**을 가진다 — `GET live-metrics`(`session_service.py:2537`), `GET eeg-rollup`(`app/api/v1/session.py:631`), `POST livekit-token`(:703), `GET report-choice/summary`(`:3158`), `GET research-consent/summary`(`research_consent_service.py:243`), `markers`(:1605).
- 반면 #5(`update_record`)·#6·#7·#9·#8 은 기관이 비활성이어도 통과한다. 단일 함수가 이를 "전부 검사"로 통일하면 **녹음·영상·기록 수정·리포트 생성·이메일 초대가 새로 409 로 막힌다**(체감 변경). "전부 미검사"로 통일하면 15개 지점이 409/잠금을 잃는다. → **액션별 정책 플래그**(`require_active_org`)로 현행 그대로 보존해야 한다.
- 테스트: 비활성 기관 409 는 `create_session` 서비스 직접 호출만 검증(`backend/tests/test_sdd075_org_management.py:125-137`). **기존 세션 호스트 조작이 비활성 기관에서 409 인지 검증하는 테스트는 없다**(`grep "비활성화된 기관에서는" backend/tests` → 0건).

**D2. 403 문구 3종 + 이메일 초대 복제본의 400 분기(위 §1 표).** 호스트가 아닌 이메일 초대는 `호스트만 초대할 수 있습니다`(:74)다. `host_id` UUID 파싱이 404 앞에 있다(:65-69)는 점도 다르지만, 호출자는 JWT 사용자 id(`app/api/deps.py:49`)여서 실질 차이는 없다 — 그래도 계약상 바이트 동일을 위해 순서는 보존한다.

**D3. 숨김(hidden) 세션 처리는 복제본이 아니라 전역 필터가 한다.** 9곳 모두 `hidden_at` 을 직접 검사하지 않는다. 대신 `app/core/database.py:20-37` 의 ORM `do_orm_execute` 리스너가 **모든 ORM SELECT 에 `Session.hidden_at IS NULL`**(옵션 `include_hidden` 으로 해제)과 `SessionParticipant.removed_at/waitlist_cancelled_at IS NULL` 을 붙인다. 따라서 숨김 세션은 9곳 모두 **404**, 제거·대기취소된 참여자는 참여자 허용 3곳에서 **403** 이 된다. **함정**: 통합 함수가 `db.get(Session, id)`(식별자 맵 우회 가능성)로 바뀌면 이 필터가 빠질 수 있다 — 복제본처럼 `db.query(...).filter(...)` 를 유지해야 한다(`db.get` 의 실제 동작은 이번 조사에서 실행 검증하지 않음 → `미확인`). `include_hidden` 을 주는 호출자(스위프·관리자 삭제)는 9곳을 쓰지 않는다 — 단 `session_service.py:1106` 스위프는 `transition_status` 를 호스트 id 로 호출해 **#2 를 통과**한다(아래 D5).

**D4. role 무시.** 9곳 어디에도 org_admin·platform_admin 우회가 없다 — 호스트가 아니면 403(`조사/R9-강사모델권한.md:127`, `session_service.py:742-748`). Phase 0 은 "동작 동일"이므로 `authorize_session` 도 **role 우회를 도입하면 안 된다**(오히려 org_admin 이 타인 세션을 수정/삭제할 수 있게 되는 권한 확대). platform_admin 우회는 `video.py` 인라인(:81,108)에만 있으니 9곳 통합 범위(§3 1단계)에서 제외한다.

**D5. 스위프가 호스트 신분으로 `transition_status` 를 호출한다.** `app/services/session_service.py:1106` — `transition_status(str(s.id), str(s.host_id), "cancel", db, restrict_from={"open"})`. 즉 시스템 작업이 "호스트인 척" #2(기관 검사 포함)를 통과한다. 실패는 예외 흡수 후 건너뛴다(:1108-1117). 통합 함수는 이 호출 경로(`user_id == s.host_id`)에서 동일하게 통과·동일 예외를 던져야 한다. 호출자가 `SYSTEM` 같은 별도 actor 를 도입하면 동작이 바뀐다 → Phase 0 에서는 도입하지 않는다.

**D6. 비호스트에 대한 404/403 판별과 정보 노출.** 모든 복제본은 세션 존재 여부를 먼저 404 로 구분한다. 이를 "존재 은닉 403/404" 로 바꾸면 안 된다(`test_sdd209_b7`·`b11` 은 `in (403, 404)` 로 느슨하지만 `test_session.py:104-115` 등은 403 고정).

**D7. 외부 결합.** `app/ws/record_namespace.py:59` 는 `from app.services.session_service import _get_session_for_participant` 로 private 이름을 import 한다. `app/api/v1/session.py:631,703`·`session_invite_service.py:53`·`research_consent_service.py:243` 은 `session_service._get_session_as_host` 를 직접 호출한다. 이 이름들을 지우면 import 오류 — 마이그레이션 중 **얇은 위임 shim 을 유지**한 뒤 마지막에 제거. 테스트가 헬퍼 이름을 직접 참조하지는 않는다(`grep` `backend/tests` → 0건, monkeypatch 의존 없음).

**D8. R9 문서의 소소한 줄번호 오차.** `조사/R9-강사모델권한.md:75` 는 기관 검사를 `:750-755` 로 적었으나 실제는 `:749-755`(import 포함 749). 동작 영향 없음.

---

## 3. 설계 제안

### 3.1 위치·모듈

`app/services/session_authz.py` (신규, 단일 모듈). `session_service` 가 이 모듈을 import 하므로 **순환 방지를 위해 `session_authz` 는 `session_service` 를 import 하지 않는다**(필요한 `_to_uuid` 는 자체 소형 복제 또는 `app/core` 로 이동은 Phase 0 범위 밖 — 모듈 내부 사본 1개). 기관 검사는 기존처럼 함수 내부 지연 import(`org_management_service`, 현 코드 `:749`와 동일 패턴).

### 3.2 계약

```
class SessionAction(str, Enum): ...            # 아래 액션 표
def authorize_session(db, user_id: str|UUID, session: Session, action: SessionAction) -> Session   # 판정만(세션은 이미 로드)
def get_session_authorized(db, session_id: str, user_id: str, action: SessionAction) -> Session     # 로드(400/404) + 판정 = 현행 헬퍼 1:1 대체
```
- 기획서의 `authorize_session(user, session, action)` 에서 `user` 는 **user_id 문자열**로 시작한다. 현행 서비스 시그니처가 전부 `host_id: str`(예: `session_service.py:222,768`)이고 role 을 쓰지 않기 때문이다. role 이 필요해지는 Phase 3(강사 배정)·`video.py` 통합 시 `Actor(id, role)` 로 확장(후속).
- **로드는 `get_session_authorized` 가 담당**(현행 헬퍼와 같이 `db.query(Session).filter(Session.id == sid).first()`; 400 `잘못된 ID 형식입니다` → 404 `세션을 찾을 수 없습니다` → 판정). `authorize_session` 단독은 리포트 경로(세션을 이미 로드한 `approve_report`)용.
- **정책 표(액션 → 규칙·거부 문구·기관검사)** 를 모듈 상수로 둔다. 거부는 `HTTPException(403, detail=정책.deny_detail)`; 기관 검사는 `require_active_org=True` 인 액션만, **호스트 확인 뒤 같은 순서**(`db.get(User)` → `require_active_user_org` → `require_active_org`)로.
- 에러 우선순위 고정: **400(ID) → 404 → 403 → 409(기관)**. 이는 4개 복제본 전부와 동일.

### 3.3 액션 enum (현 호출 지점에서 도출) — 현행 응답 바이트 보존용

| 계열 | 액션 | 호출 지점(현행) | 규칙 | 403 문구 | 기관 검사 |
|---|---|---|---|---|---|
| B | `SESSION_UPDATE` | `session_service.py:768` | HOST | `host 상담사만 가능합니다` | 예 |
| B | `SESSION_DELETE` | `:903` | HOST | 동일 | 예 |
| B | `SESSION_TRANSITION` | `:945`(+스위프 `:1106`) | HOST | 동일 | 예 |
| B | `SESSION_NEW_RUN` | `:1136` | HOST | 동일 | 예 |
| B | `SESSION_DUPLICATE` | `:585` | HOST | 동일 | 예 |
| B | `SESSION_SAVE_TEMPLATE` | `:631` | HOST | 동일 | 예 |
| B | `SESSION_CHAT_TOGGLE` | `:222` | HOST | 동일 | 예 |
| B | `PARTICIPANT_INVITE` / `PARTICIPANT_REMOVE` | `:1481` / `:1553` | HOST | 동일 | 예 |
| B | `PARTICIPANT_REMIND` | `session_invite_service.py:53` | HOST | 동일 | 예 |
| B | `MARKER_ADD` | `:1605` | HOST | 동일 | 예 |
| B | `LIVE_METRICS_READ` | `:2537` | HOST | 동일 | 예 |
| B | `EEG_ROLLUP_READ` | `app/api/v1/session.py:631` | HOST | 동일 | 예 |
| B | `LIVEKIT_TOKEN_ISSUE` | `app/api/v1/session.py:703` | HOST | 동일 | 예 |
| B | `REPORT_CHOICE_SUMMARY_READ` | `:3158` | HOST | 동일 | 예 |
| B | `RESEARCH_CONSENT_SUMMARY_READ` | `research_consent_service.py:243` | HOST | 동일 | 예 |
| A | `RECORD_UPDATE` | `record_service.py:235` | HOST | 동일 | **아니오** |
| A | `AUDIO_RECORD` | `audio_service.py:70,112,172` | HOST | 동일 | 아니오 |
| A | `VIDEO_RECORD` | `video_service.py:140,157,233` | HOST | 동일 | 아니오 |
| A | `REPORT_GENERATE` | `report_service.py:276` | HOST | 동일 | 아니오 |
| C | `EMAIL_INVITE_MANAGE` | `session_email_invite_service.py:102,191` | HOST | **`호스트만 초대할 수 있습니다`** | 아니오 |
| D | `SESSION_VIEW` | `session_service.py:759` | HOST_OR_PARTICIPANT | `접근 권한이 없습니다` | 아니오 |
| D | `SESSION_CHAT_ROOM_VIEW` | `:240` | HOST_OR_PARTICIPANT | 동일 | 아니오 |
| D | `SESSION_JOIN` | `:1673`, `app/ws/record_namespace.py:63`(`RECORD_SUBSCRIBE` 로 분리 가능) | HOST_OR_PARTICIPANT | 동일 | 아니오 |
| D | `RECORD_VIEW` / `TRANSCRIPT_VIEW` / `REPORT_STATUS_VIEW` | `record_service.py:185,209,230` | HOST_OR_PARTICIPANT | 동일 | 아니오 |

> 기획서가 말하는 `authorize_session(user, session, action)` 의 "action" 은 위처럼 **현 호출 지점 단위**로 두는 것을 권한다. 정책 속성이 액션마다 달라서(문구·기관검사) 이렇게 하지 않으면 바이트 동일을 못 지킨다. Phase 3 에서 강사 배정이 들어오면 `HOST` 규칙을 "진행 강사(`class_instructors`) 포함"으로 **한 곳에서** 바꾼다 — 이것이 단일화의 목적이다.

### 3.4 범위 결정 (기본값)

- **포함(1단계, 33개 호출 지점)**: 위 9곳 헬퍼 대체. 거부 응답 바이트 동일.
- **제외(건드리지 않음)**: `_can_access_report` 계열(org_admin·참여자 통과 — 별 의미), `set_speaking`·`resolve_audio_sync_host`(순서·문구 상이), `video.py` platform_admin 우회, `export_service.authorize`, `ChatRoom.host_id` 비교. 이들은 `authorize_session` 의 **후속 액션**(`REPORT_ACCESS` 등)으로 Phase 3 에서 흡수 검토. 근거: Phase 0 은 "동작 동일 리팩터"(`brief.md`, `기획.md` §9 Phase 0).
- 관찰(범위 밖, 수정 아님): `_can_access_report` 의 참여자 분기 때문에 `update_report`(`report_service.py:864`)·`require_report_host`(:854)의 서비스 계층은 **참여자도 통과**한다. 라우트가 `require_roles("counselor","org_admin")` 로 막고 있어(`app/api/v1/reports.py:131,108,178`) client 는 막히지만, **다른 상담사의 세션에 참여자로 들어간 상담사**는 서비스 계층 판정을 통과한다고 코드상 읽힌다(실행 검증 안 함, `미확인`). 별 이슈로 Brian 에게 알릴 가치가 있다. 또 `generate`·`approve`·`get_one` 라우트(`reports.py:63-70,118-124,161-168`)에는 role 가드가 없다.

### 3.5 마이그레이션 순서

1. **특성화 테스트 먼저**(§4 의 "없음" 지점) — 현행 코드에서 통과해야 하며 이후 변경 금지(verify 게이트).
2. `session_authz.py` 추가(정책 표·함수). 단위 테스트: 계열별 거부 문구/코드/순서.
3. **저위험 순**으로 호출 지점 교체 — 각 교체는 한 커밋, 교체 직후 해당 파일 테스트 + 전체 pytest:
   ① 계열 A 단순 호스트(`audio_service` → `video_service` → `report_service.generate_report` → `record_service.update_record`),
   ② `session_email_invite_service`(문구 상이 C),
   ③ 계열 D(`record_service` 3곳 → `session_service` `_get_session_for_user`/`_for_participant`; WS shim 유지),
   ④ 계열 B(기관검사 포함) — 가장 마지막. 파일 내 12곳 + 외부 4곳. 기관 검사는 마지막까지 `session_service._get_session_as_host` 위임 shim 으로 두었다가 일괄 교체.
4. 옛 private 헬퍼는 **shim → 호출부 0 확인 → 삭제**. `record_namespace.py:59` import 를 먼저 새 함수로.
5. 보호 장치: 교체 전후 `/sessions/*` 비호스트 응답 스냅샷(상태코드+detail) 비교 — 특히 기관 비활성 409.

---

## 4. 기존 테스트 커버리지 (grep·정독, 실행 안 함)

호스트 헬퍼는 **테스트가 이름을 참조하지 않고** HTTP 로 간접 검증한다. 표는 "비호스트(또는 비참여자) 요청이 거부되는지 확인하는 테스트가 있는가"다.

| 호출 지점(액션) | 비호스트 거부 테스트 | 근거 |
|---|---|---|
| `SESSION_UPDATE`/`SESSION_DELETE` | 있음(403) | `backend/tests/test_session.py:104-115` |
| `SESSION_DUPLICATE` | 있음(403) | `test_sdd095_class_template.py:267-272` |
| `SESSION_SAVE_TEMPLATE` | **없음** | `grep save-as-template` + 403 → 0건 |
| `SESSION_NEW_RUN` | 있음 | `test_sdd028_run_scaling.py:137-143` |
| `SESSION_TRANSITION` open/start/cancel | 있음(참가자 자격 403) | `test_sdd209_b5b_ownership.py:205-232`(`test_AZ10`) |
| `SESSION_TRANSITION` **end** | **없음**(AZ10 목록에 `end` 없음) | 같은 파일 `:214-216` |
| `SESSION_CHAT_TOGGLE` | 있음 | `test_session_chat.py:268-278`(`test_09`) |
| `PARTICIPANT_INVITE`/`REMOVE` | 있음 | `test_sdd209_b5b_ownership.py:217-220` |
| `PARTICIPANT_REMIND` | 있음(403 또는 404 허용 — 느슨) | `test_sdd209_b7_invite_remind.py:148-149` |
| `MARKER_ADD` | **없음** | `grep "/markers"` + 403 → 0건 |
| `LIVE_METRICS_READ` | 있음 | `test_sdd021_session_class_flow.py:171-177` |
| `EEG_ROLLUP_READ` | 있음 | `test_sdd027_rollup_raw_report.py:173-178` |
| `LIVEKIT_TOKEN_ISSUE` | 있음 | `test_mb2_high_severity_fixes_2.py:138-159` |
| `REPORT_CHOICE_SUMMARY_READ` | 있음 | `test_sdd209_b9_readiness_entry.py:245` |
| `RESEARCH_CONSENT_SUMMARY_READ` | 있음(403 또는 404 — 느슨) | `test_sdd209_b11_research_consent.py:442` |
| `RECORD_UPDATE` (`PUT /record`) | **없음** | `client.put(.../record)` + 403 → 0건 |
| `AUDIO_RECORD` start | 있음 | `test_audio_record.py:84-93` |
| `AUDIO_RECORD` chunk·stop | **없음** | audio 403 은 `:93` 한 곳뿐 |
| `VIDEO_RECORD` start·chunk | 있음 | `test_video_record.py:91-100,124-130` |
| `VIDEO_RECORD` stop | **없음** | 403 은 `:100,:130` 뿐 |
| `REPORT_GENERATE` | 있음, **문구까지 단언** | `test_report.py:113-123`(`host 상담사만 가능합니다`) |
| `EMAIL_INVITE_MANAGE` | 있음(403) | `test_sdd209_b14_email_invite.py:72,249`(문구 단언 없음) |
| `SESSION_VIEW`/`CHAT_ROOM_VIEW` | 있음 | `test_session_chat.py:168-176` 등(채팅방) · `get_session` 비참여자는 **간접만**(미확인) |
| `RECORD_VIEW`/`TRANSCRIPT_VIEW` | 참여자 마스킹만 검증, **비참여자 403 없음** | `test_mb2_high_severity_fixes_2.py:70-110` |
| `REPORT_STATUS_VIEW` | 있음 | `test_sdd095_report_progress.py:361-367` |
| `SESSION_JOIN` / WS `RECORD_SUBSCRIBE` | WS 는 `test_mb2_ws_mid_fixes.py:291` 가 subscribe 를 다룸(거부 케이스는 `미확인`), HTTP `POST /sessions/{id}/join` 비참여자 403 은 테스트 존재 여부 `미확인`(앞서 지목한 `test_mb2_relations_consistency.py:253` 은 기관 가입 테스트라 무관) |
| **기관 비활성 409 (계열 B 전체)** | **없음**(create 만) | `test_sdd075_org_management.py:125-137` |
| `approve_report` 비호스트 403(`report_service.py:914`) | **없음** | `grep approve` + 403 → `test_report_bulk_actions.py:83`(approve-all) 뿐 |

**403 body 문구를 단언하는 기존 테스트는 사실상 `test_report.py:123`(`host 상담사만 가능합니다`)과 `test_report.py:257-258`(`이 작업을 수행할 권한이 없습니다`, require_roles 용) 뿐이다.** 따라서 문구 보존은 테스트가 지켜주지 않는다 → 특성화 테스트에서 계열별로 **detail 문자열 단언**을 새로 추가해야 한다.

### 4.1 리팩터 전에 써야 할 특성화 테스트 (우선순위)

1. 계열 B 기관 비활성: 기관 비활성 상태에서 `PUT /sessions/{id}`·`GET live-metrics` → 409 + detail (그리고 같은 상태에서 `audio/start`·`PUT record`·`POST invite/email` 은 **통과**한다는 반대 케이스 = D1 보존 증명).
2. 비호스트 detail 단언: 계열 A(`record PUT`, `audio chunk/stop`, `video stop`), C(`호스트만 초대할 수 있습니다`), B(`host 상담사만 가능합니다`).
3. 비호스트 end·save-as-template·markers 403.
4. org_admin(타 세션)·platform_admin 이 호스트 전용 엔드포인트에서 **여전히 403** 임을 고정(D4 — 권한 확대 방지).
5. 숨김 세션 → 404, 제거된 참여자 → 403(전역 필터 의존 D3 고정).
6. 스위프 경로: 호스트 id 로 `transition_status(... restrict_from={"open"})` 통과(D5).
7. 비참여자 `GET /record`·`/transcript`·`GET /sessions/{id}` → 403 `접근 권한이 없습니다`.

## 5. 미확인

- DB 실데이터(호스트가 비활성 기관 소속인 세션 수 등) — 조회 금지.
- `db.get(Session, id)` 가 전역 숨김 필터를 우회하는지(§D3) — 실행 검증 안 함.
- WS 거부 케이스·HTTP `join` 비호스트 테스트 존재 여부(§4 일부) — 정독 미완.
- 33개 지점 외에 동적 호출/`getattr` 로 헬퍼를 쓰는 곳 — `grep` 으로 이름 기준 전수했으나 동적 접근은 확인 불가.
- `_can_access_report` 참여자 분기가 상담사 참여자에게 실제 수정 권한을 주는지 — 코드 정독만(§3.4).
