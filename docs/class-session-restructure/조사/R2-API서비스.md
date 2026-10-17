# R2 — API·서비스 영향 조사 (클래스=프로그램 / 세션=회차)

> 조사일 2026-10-17. 코드·시안·DB 수정 없음(문서 전용). ROOT=`/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`, 경로 접두 `backend/app/` 는 `app/` 로 줄여 적음.
> 전제(Brian 확정, 뒤집지 않음): 클래스=프로그램(상위), 세션=회차(하위). 회원 결석·보강·중간 합류·이탈 가능. 명상 클래스는 회차 고정형+정기형. 기존 단회차 → 클래스 1 + 세션 1. (`docs/클래스-세션-개념-재정의_메모.md:7-19`)

## 0. 요약 (숫자)

| 항목 | 값 | 근거 |
|---|---|---|
| 전체 v1 REST 라우트 | 239 (dev_auth 제외) | 아래 §1 명령 ① |
| 경로에 `session_id`/`/sessions` 포함 | **61** | 명령 ② |
| 세션 파생(경로엔 없지만 세션·참여자 테이블을 읽음) | 18 | §3.2 |
| 세션 중심 합계 | **79 / 239** | 61 + 18 |
| `session_id` 문자열 등장 | 1,232줄 / 70개 파일 (app/, 줄 수 기준 — `grep -rh "session_id" app` 의 행 수. 한 줄에 여러 번이면 1로 계산) | 명령 ③ |
| `app.models.session` 임포트 파일 | 40개 (models 제외) | 명령 ④ |
| 상위 3개 파일 | ws/session_live_namespace.py 224 · services/session_service.py 110 · api/v1/session.py 109 | 명령 ③ |
| tests 의 `session_id` | 488회 / 73개 파일 | 명령 ⑤ |
| 분류(경로 61건) | 호환 유지 37 · 변경 24 · (신규는 별도 제안 §3.3) | §3.1 |

## 1. 조사 방법 (실행한 명령)

```
① cd backend && venv/bin/python -  # app.api.v1.router.routes 를 순회해 (메서드, 경로, endpoint 모듈) 추출
   → 239 (모듈별: session 44, admin 30, org 19, auth 18, chat 16, agent_counselor 16, reports 15,
          onboarding 11, agent 10, normalization 9, signup_applications 7, notifications 6,
          client/video/records 5, credential/devices 4, client_portal/audio/data_exports 3,
          research_export/dashboard 2, class_audio/org_public 1)
   주의: dev_auth 는 환경 조건부 include(`api/v1/__init__.py:44-48`)라 239 에 불포함.
② 같은 순회에서 path 에 "session_id" 또는 "/sessions" 포함 → 61
   (session 44 · video 5 · records 5 · audio 3 · admin 2 · reports 1 · data_exports 1)
③ grep -rc "session_id" app --include="*.py" | grep -v ":0$" | sort   → 아래 §2.1
④ grep -rnE "from app\.models\.session import|from app\.models import .*Session" app | models 제외 → 40개 파일
⑤ grep -r "session_id" tests --include="*.py" | wc -l → 488 / grep -rl → 73
⑥ grep -rcE "\b(Session|SessionModel|CounselingSession)\.[a-z_]+|\bSessionParticipant\.[a-z_]+" app → 컬럼 접근식 총 369회
```

- 데코레이터 정규식 grep 은 `session.py` 의 for-루프 등록 라우트(open/start/end/cancel, `api/v1/session.py:252-269`)와 멀티라인 데코레이터를 놓치므로 라우터 런타임 순회를 기준 수치로 삼음.

## 2. grep 집계

### 2.1 `session_id` 등장 횟수 (app/, 상위)

| 순위 | 파일 | 횟수 | 성격 |
|---|---|---|---|
| 1 | ws/session_live_namespace.py | 224 | 실시간 룸·이벤트 (회차 단위가 본래 맞음) |
| 2 | services/session_service.py | 110 | 코어 (3,164줄) |
| 3 | api/v1/session.py | 109 | 엔드포인트 44 |
| 4 | services/report_service.py | 57 | 리포트 목록·생성·접근 |
| 5 | services/audio_service.py | 45 | 녹음 청크·finalize 체인 |
| 6 | services/chat_service.py | 38 | 세션 채팅방 |
| 7 | services/record_service.py | 37 | 세션 기록·체크인 |
| 8 | services/video_service.py | 34 | 영상 |
| 9 | services/research_export_service.py | 32 | 연구 내보내기 |
| 10 | services/report_email_service.py | 32 | 비회원 리포트 메일 |
| 11 | tasks/stt_task.py | 29 | STT |
| 12 | tasks/summary_task.py | 28 | 요약 |
| 13 | tasks/report_task.py | 26 | 리포트 생성 |
| 14 | ws/record_namespace.py | 25 | 기록 진행 |
| 15-16 | services/agent_service.py · agent_policy.py | 23 · 23 | AI 비서 |
| 17 | api/v1/video.py | 20 | |
| 18 | services/eeg_raw_service.py | 19 | |
| 19 | models/record.py | 19 | FK 다수 |

- 전체 1,232회 중 상위 3개(ws·session_service·session.py)가 443회(36%).
- 이 값은 "회차 단위"로 이미 올바르게 쓰이는 곳이 대부분 → **세션 id 의미를 '회차'로 고정하면 대다수는 무변경**(핵심 설계 결론, §8 제안 1).

### 2.2 `Session`/`SessionParticipant` 컬럼 접근식 (명령 ⑥, 상위)

| 파일 | 횟수 |
|---|---|
| services/session_service.py | 67 |
| services/agent_policy.py | 49 |
| services/report_service.py | 32 |
| services/chat_service.py | 22 |
| services/report_email_service.py | 12 |
| services/agent_reminder.py | 11 |
| services/report_scope.py · org_management_service.py · agent_counselor_service.py · agent_checkin.py · api/v1/client_portal.py | 각 9 |
| tasks/report_task.py | 8 |

- 합계 369회. 클래스 컬럼(정원·코드·참여 방식 등)을 `classes` 로 올리면 영향이 가장 큰 곳은 session_service·agent_policy·report_service·chat_service(R1 분류표와 교차 필요).
- 전체 내려받은 `app.models.session` 임포트: 40개 파일(`app/services` 35, `app/tasks` 4, `app/ws` 1 등 — 명령 ④).

## 3. 세션 중심 엔드포인트

### 3.1 경로에 session 포함 61건 — 분류

분류 기준: **호환 유지**=회차(=현행 sessions 행) 단위 의미 그대로 두면 동작·응답 계약 변경 불필요 / **변경**=클래스 도입으로 입력·응답·로직 변경 필요 / **신규**=새로 만들어야 함(§3.3).
`session_id` 는 이전 후에도 **같은 값으로 '회차 id'가 됨**을 전제(제안 1).

#### (A) 호환 유지 — 37건

| 메서드 경로 | 파일:줄 | 비고 |
|---|---|---|
| POST /sessions/{id}/open · start · end · cancel (4) | session.py:252 (루프 등록 `:269-275`) | 회차 상태머신 `TRANSITIONS` (`session_service.py:35-40`). 종료 시 STT→요약→리포트 체인 기동 |
| POST /sessions/{id}/participants/{pid}/raise-hand | session.py:392 | 입장 자격 기반 |
| POST /sessions/{id}/participants/{pid}/speaking | session.py:561 | 호스트 전용 |
| GET /sessions/{id}/entry-state | session.py:416 | 응답에 클래스 요약 필드 추가는 가산(비파괴) |
| POST /sessions/{id}/entry/livekit-token | session.py:432 | |
| POST /sessions/{id}/livekit-token | session.py:690 | 호스트 전용 |
| POST /sessions/{id}/join | session.py:714 | |
| POST /sessions/{id}/markers | session.py:581 | |
| POST /sessions/{id}/features | session.py:593 | EEG 5초 배치 |
| GET /sessions/{id}/eeg-rollup | session.py:615 | |
| POST /sessions/{id}/eeg-raw/presign · ack (2) | session.py:642, 662 | |
| GET /sessions/{id}/live-metrics | session.py:678 | |
| POST /sessions/{id}/audio/start · chunk · stop (3) | audio.py:19, 29, 45 | |
| POST·GET /sessions/{id}/video/start · chunk · stop · url · stream (5) | video.py:26, 36, 52, 63, 94 | |
| GET·PUT /sessions/{id}/record, GET transcript, POST checkin, GET report-status (5) | records.py:23, 32, 42, 51, 72 | 체크인은 회차 직후 1탭 |
| POST /sessions/{id}/report-email, GET report-email/view (2) | session.py:732, 743 | 비회원 리포트 메일 |
| GET /sessions/{id}/chat-room | session.py:228 | 채팅방 단위는 결정 후보 D-? (§8) |
| POST /sessions/entry/revoke | session.py:165 | 자격 폐기 |
| POST /sessions/{id}/participants/{pid}/data-exports | data_exports.py:15 | 참여자×회차 단위 내려받기 |
| GET /admin/sessions/{id}/research-consents · POST originals/delete (2) | admin.py:316, 332 | 보관·삭제는 회차 종료일 기준 |
| POST /reports/generate/{session_id} | reports.py:63 | 회차 리포트 수동 생성 |

#### (B) 변경 — 24건

| 메서드 경로 | 파일:줄 | 변경 내용(제안) |
|---|---|---|
| POST /sessions | session.py:86 | `class_id` 선택 입력 추가. 미지정이면 서버가 클래스 1개 자동 생성(구 앱 호환 shim). 정원·코드·참여방식 등 클래스 컬럼은 클래스에서 상속 |
| GET /sessions | session.py:72 | 응답 항목에 `class_id`·`class_title`·`session_no`(회차 번호) 가산. 호스트/참여자 쿼리 `session_service.py:690-722` 는 멤버십 포함으로 확장 |
| GET·PUT·DELETE /sessions/{id} | session.py:194, 203, 213 | 응답에 클래스 요약 가산. PUT 의 클래스 레벨 필드는 클래스로 위임. DELETE=숨김(`hidden_at`) 유지, 클래스 마지막 회차 삭제 시 처리 규칙 필요 |
| POST /sessions/enter/verify · /sessions/enter | session.py:104, 128 | 4자리 코드가 가리키는 대상이 클래스가 됨 → "현재 입장 가능한 회차" 해석 로직 신규(`class_code_service.find_enterable_session` `:89-99`) |
| POST /sessions/{id}/enter | session.py:451 | 초대 회원 편의 입장 → 클래스 멤버십 확인으로 확장 |
| POST /sessions/{id}/invite · invite/remind · invite/email(POST·GET) (4) | session.py:334, 344, 360, 371 | 초대 대상이 회차→클래스 멤버십. 호환 기간엔 회차 초대를 클래스 초대+해당 회차 출석으로 변환 |
| DELETE /sessions/{id}/participants/{user_id} | session.py:381 | "제거"의 의미 분기: 이탈(클래스) vs 해당 회차 제외(결석 처리) |
| POST /sessions/{id}/waitlist/cancel | session.py:520 | 정원·대기열 단위(클래스/회차)에 따라 이동 (R4 결정 의존) |
| PUT /sessions/{id}/report-choice, GET report-choice/summary (2) | session.py:539, 500 | 동의 시점(클래스 가입 1회 vs 회차마다) 결정 의존 |
| GET·PUT /sessions/{id}/research-consent, GET research-consent/summary (3) | session.py:461, 477, 510 | 위와 동일 |
| POST /sessions/{id}/chat-enabled | session.py:238 | 클래스 설정으로 올릴지 회차 유지할지 |
| POST /sessions/{id}/new-run | session.py:272 | `run_id`(재실행 식별자, `models/session.py:36-44`)는 회차 개념으로 대체됨 → 폐기 후보, 호환 기간 유지 |
| POST /sessions/{id}/duplicate · save-as-template, GET /sessions/templates (3) | session.py:288, 314, 179 | "복제/템플릿" 이 "클래스 복제/템플릿"과 중복 → 클래스 단위로 재정의, 회차 복제는 "회차 추가"로 흡수 |

### 3.2 세션 파생 18건 (경로에 session_id 없음)

| 메서드 경로 | 파일:줄 | 분류 | 비고 |
|---|---|---|---|
| GET /reports | reports.py:75 | 변경(소) | 세션 LEFT JOIN 리포트 (`report_service.py:527-610`). 클래스 필터·그룹핑 가산 |
| GET /client/home | client_portal.py:213 | 변경 | 다음 예정 세션·오늘 세션 수가 `SessionParticipant` 직조회(`:236-252`, `:309-318`). 멤버십 기반 + "MBSR 봄 · 3회차" 표기용 필드 필요 |
| GET /dashboard/counselor · /dashboard/org | dashboard.py:14, 23 | 변경 | `class_count` 가 현재 sessions 행 수(`dashboard_service.py:122-213`) → 클래스 수 vs 회차 수 구분 |
| GET /org/{org_id}/counselors/{uid}/activity | org.py:469 | 변경(소) | 최근 세션 10건(`org_service.py:457-520`) → 클래스 단위 표시 여부 |
| 리포트 13건: view, view/pdf, auto-approve(GET·PATCH), read-all, approve-all, {id}/pdf, GET·PUT {id}, comment, comment-draft, approve, resend-email | reports.py:28-171 | 호환 유지 | 리포트 행은 회차 소유(`Report.session_id`) 그대로 |

- 채팅 `/chat/rooms*` 16건(chat.py:31-243)은 `ChatRoom.session_id` unique FK(`models/chat.py:17-19`)로 세션 채팅방을 담지만 엔드포인트 자체는 세션 비종속 → 위 합계에 미포함.
- `/class/audio-tracks`(class_audio.py:17, 명상 BGM 목록)는 세션 비종속, 무변경.

### 3.3 신규 엔드포인트 제안 (기본값)

(수치는 설계 단계에서 확정. 경로 접두는 `/classes`.)

| # | 메서드 경로 | 용도 |
|---|---|---|
| 1 | POST /classes | 클래스 생성(유형·정원·참여방식·LINK BAND 모드·녹음 설정·회차 방식 고정/정기) |
| 2 | GET /classes | 내 클래스 목록(상담사: 호스트, 회원: 멤버십) |
| 3 | GET·PUT·DELETE /classes/{id} (3) | 상세·수정·보관 |
| 4 | POST /classes/{id}/sessions | 회차 1개 추가(보강 회차 포함) |
| 5 | POST /classes/{id}/sessions/bulk | 고정형 일괄 예약(총 N회·요일 반복) |
| 6 | GET /classes/{id}/sessions | 회차 타임라인 |
| 7 | GET·POST·DELETE /classes/{id}/members (3) | 멤버 목록·초대/가입·이탈 |
| 8 | PUT /sessions/{id}/attendance/{member} | 결석·보강·출석 표시 |
| 9 | GET /classes/{id}/attendance | 출석 현황 매트릭스 |
| 10 | POST /classes/{id}/code/reissue | 4자리 코드 재발급(현 `class_code_reissue.py` 계승) |
| 11 | GET /classes/{id}/report | 클래스 단위 추이·회차 비교(R6) |
| 12 | GET /classes/{id}/members/{mid}/progress | 회원 개인 변화량 타임라인(R6) |

- 합계 약 16 라우트(그룹 표기 12행, 메서드 분리 시 16). 이 수는 제안이며 R4/R5 결정에 따라 증감.

## 4. 서비스 함수 (세션 중심)

### 4.1 `services/session_service.py` (3,164줄, 함수 약 110개)

| 군 | 함수(줄) | 분류 |
|---|---|---|
| 직렬화·조회 | `_serialize`(103) · `_with_chat_room`(201) · `list_sessions`(690) · `list_templates`(667) · `get_session`(758) · `_get_session_for_user`(724) · `_get_session_as_host`(742) | 변경 — 응답에 클래스 요약, 권한 판정에 멤버십 |
| 생성·복제 | `create_session`(333) · `_clone_session_config`(523) · `duplicate_session`(568) · `save_as_template`(623) · `_create_template`(475) · `detect_conflict`(300) | 변경 — 클래스 생성 위임, 시간 충돌 검사 단위(R5) |
| 수정·삭제 | `update_session`(767) · `delete_session`(896) | 변경 — 클래스 필드 분리 |
| 상태 전이 | `transition_status`(941) · `sweep_stale_open_sessions`(1073) · `start_new_run`(1126) · `_close_out_media_on_cancel`(922) | 호환 유지(`start_new_run` 폐기 후보) |
| 알림·WS 발행 | `_notify_participants_event`(1148) · `_notify_session_state`(1221) · `_notify_participant_changed`(1249) · `_notify_promoted`(1400) · `_notify_speaking_changed`(2408) · `_notify_device_status`(3054) | 알림만 변경(수신자 = 멤버십), WS 는 유지 |
| 정원·대기열 | `_active_participant_count`(1321) · `_has_capacity`(1334) · `_lock_session_for_capacity`(1344) · `_waiting_participants`(1357) · `_renumber_waitlist`(1367) · `_promote_waitlist_all`(1380) · `cancel_waitlist`(2133) | 변경 — 정원이 클래스 단위면 `classes`/멤버십 기준(R4 결정) |
| 초대·참여자 | `invite_participant`(1480) · `remove_participant`(1552) · `_revive_removed_participant`(1440) · `_reactivate_cancelled_or_removed`(1421) | 변경 — 멤버십 + 출석 |
| 입장 | `_get_session_by_code`(1729) · `verify_entry_code`(1743) · `enter_session`(1908) · `_enter_resolved`(1781) · `enter_session_as_invited`(1927) · `join_session`(1671) · `get_entry_state`(2001) · `resolve_participant_actor`(2185) · `revoke_entry_credential`(1938) | 변경(코드 해석) / 나머지 호환 유지 |
| 미디어·토큰 | `generate_livekit_token`(1624) · `participant_livekit_token`(1946) · `_compute_can_publish`(2055) | 호환 유지 |
| 동의 | `set_report_choice`(2258) · `report_choice_summary`(3150) | 변경(동의 시점) |
| 발언권 | `raise_hand`(2321) · `set_speaking`(2364) | 호환 유지 |
| 실시간 지표 | `get_live_metrics`(2529) · `_participant_live_snapshot`(2662) · `resolve_live_join`(2698) · `_aggregate_window_stats`(2834) | 호환 유지 |
| EEG 업로드 | `resolve_upload_participant`(2911) · `persist_feature_windows`(2934) · `ingest_features`(3103) · `_assert_upload_eligible`(2899) | 호환 유지 |
| 기타 | `add_marker`(1604) · `ensure_session_chat_room`(210) · `set_chat_enabled`(217) · `get_session_chat_room`(235) · `resolve_location_address`(54) | 호환 유지(채팅 단위 결정 의존) |

### 4.2 그 외 서비스

| 서비스(줄수) | 세션 의존 포인트 | 분류 |
|---|---|---|
| `class_code_service.py`(102) | `Session.access_code` 활성 클래스 사이 유일 (`:49-62`, 부분 유니크 인덱스 `models/session.py:19-32`) | 변경 — 코드 소유자를 클래스로. "활성"의 의미(종료 회차 제외 vs 클래스 보관) 재정의 |
| `class_code_reissue.py`(70) · `class_code_attempt_service.py` | 재발급·시도 제한(Redis, IP·코드 키) | 변경(소) |
| `entry_credential_service.py`(99) | JWT 클레임 `type=class_entry`, `sub=참여자id`, `sid=세션id`, `ver=entry_ver` (`:5`, `:39-40`) 자격이 **참여자(=세션×사람) 행에 묶임** | 변경 — 비회원이 클래스 멤버가 되려면 자격 주체가 멤버십이 되어야 함(R4와 교차). 호환: `sid` 는 회차 id 유지 |
| `class_audio_service.py`(164) | 명상 BGM 목록 정적 카탈로그, 세션 비종속 | 호환 유지 |
| `session_invite_service.py`(110) · `session_email_invite_service.py`(287) | 초대 재발송·비회원 이메일 초대(`SessionEmailInvite`) | 변경 — 대상=클래스 |
| `reminder_service.py`(468) · `agent_reminder.py`(361) | §6 | 변경 |
| `notification_service.py`(410) | §6 | 호환 유지 + 확장 |
| `audio_service.py`(327) · `video_service.py` · `record_service.py`(339) · `eeg_raw_service.py` · `eeg_rollup_service.py`(200) · `eeg_query.py` | 모두 session_id(+participant_id) 키 | 호환 유지 |
| `report_service.py`(1,052) · `report_scope.py`(171) · `report_comment_service.py`(288) · `report_email_service.py`(439) · `report_progress_service.py`(418) · `report_pdf_service.py`(192) | §7 + R6 | 호환 유지 + 신규 클래스 리포트 |
| `group_aggregate.py`(490) | 회차 내 익명 집계(세션 룸 단위) | 호환 유지 |
| `dashboard_service.py`(213) · `org_service.py`(916) · `org_management_service.py` | 집계 단위 | 변경(소) §9 |
| `research_consent_service.py`(346) · `research_export_service.py`(645) · `retention_sweep_service.py`(380) · `original_deletion_service.py` · `media_cleanup_service.py` · `export_service.py`(275) | 회차 종료일·참여자 단위 보관·내보내기 | 호환 유지(동의 시점 결정 시 `research_consent_service` 변경) |
| `agent_policy.py`(1,065) · `agent_service.py` · `agent_briefing.py` · `agent_checkin.py` · `agent_counselor_service.py` | 내담자 AI 비서가 "다음 일정·직전 회차 요약"을 Session 직조회 (`agent_policy.py:611-640` 직전 회차 쿼리, `agent_service.py:504` URL `/app/sessions/{id}`, `agent_briefing.py:360` `/sessions/{id}`) | 변경(소) — 문구에 클래스명·회차 번호, 직전 회차 정의(클래스 내) |
| `chat_service.py`(1,677) | `get_or_create_room_by_session` (`chat_service.py:280` `room_type="session"`) | 변경 가능 — D-? |

## 5. WebSocket (Socket.IO) 룸

현행 3개 네임스페이스 (`ws/__init__.py:88-94` 에서 등록, Redis `AsyncRedisManager` 부착 가능 `:49-76`).

| 네임스페이스 | 룸 이름 | 입장 조건 | 근거 |
|---|---|---|---|
| `/session-live` | `session:{sid}` (호스트 전용) · `session:{sid}:all` (호스트+참가자) · `session:{sid}:self:{participant_id}` (본인) | `join` 이벤트의 `session_id`+참가자 확인, 비활성 계정 거부, 타 세션 재-join 시 이전 룸 이탈 | `ws/session_live_namespace.py:257-269`, `:444-533` |
| `/record` | `session:{sid}` | 호스트/참여자만 `subscribe` | `ws/record_namespace.py:53-63`, `:135` |
| `/chat` | `user:{user_id}`(알림), 채팅방 id 그대로 | 멤버십 검사 `_is_room_member` | `ws/chat_namespace.py:75`, `:94-108`, `:111-133` |

- 이벤트: `joined`·`join_denied`·`eeg_feature`·`speaking_changed`·`participant_promoted`·`device_status_changed`·`waiting_room_reminder`, `class:signal`·`class:aggregate`·`class:group_average`·`class:audio_sync`, `report:progress`·`record_status` (`session_live_namespace.py:77-88, 835, 1022-1083, 1332`; `record_namespace.py:153-213`).
- 프로세스 메모리 상태가 **세션 id 키**: `_active_signals`, `_last_aggregate_at`, `_last_group_average_at` (`:77-96`), 마지막 소켓 이탈 시 정리 `_clear_session_if_last_socket` (`:441`) → 회차 단위 유지가 자연스러움.
- 분류: **룸 이름·키 = 호환 유지**(세션 id = 회차 id). 구 앱(Capacitor 번들) 이 `session:{sid}` 형식을 하드코딩 → 이름 변경 금지가 안전(미확인: 프론트 코드 확인은 R3 범위).
- 신규 제안: 클래스 룸(`class:{cid}`)은 **만들지 않음(기본값)**. 새 회차 추가·일정 변경·멤버 변동은 기존 알림(인앱+푸시) 경로로 전달. 이유: 룸 구독 수명이 길어 Redis manager 부하·권한 검증 표면이 늘고 알림 경로로 충분.
- 변경 필요: `_resolve_join` (`:444` 호출) 의 권한 판정이 "이 회차의 참여자 행 존재"인데, 클래스 멤버가 회차 참여자 행 없이 입장(중간 합류·보강)할 수 있으려면 멤버십 기반 → 회차 참여자 행 지연 생성 규칙이 필요(R4 데이터 모델 의존).

## 6. 알림·리마인더

### 6.1 인앱·이메일 알림

- 이벤트 카탈로그 `EVENT_CATALOG` 의 세션 이벤트 11종(`notification_service.py:27-37`) + `report_low_confidence`(`:47`, target=session) + `schedule_change_request`(`:70`). 모두 `target_type="session"`/`notice`, `target_id=str(session.id)`.
- 페이로드: `build_standard_extra(..., params=..., legacy={"session_id": ...})` (`notification_service.py:86-108`, 호출 `session_service.py:1183-1196`). `params` 는 자유 dict → **`class_id`·`class_title`·`session_no` 를 `params` 에 가산하면 스키마 변경 없이 확장**.
- 수신자 선정: `s.participants` 중 호스트·대기열 제외 (`session_service.py:1171-1175`) → 멤버십 기반으로 변경 필요(결석 예고 회원 제외 여부 등은 결정 후보).
- 딥링크: `target_type="session"` 의 라우트 매핑은 프론트(화이트리스트 `STANDARD_TARGET_TYPES` `:20`). **세션 id 불변 → 기존 알림·구 앱 딥링크 호환 유지**. 새 이벤트 후보: `class_session_added`, `class_member_joined/left`, `class_absence_recorded`, `class_completed`(보강 안내 포함 여부는 결정).
- 분류: 기존 11종 호환 유지(+params 확장) / 신규 이벤트 4-5종 / 문구의 "세션→클래스" 용어 재정리는 R8.

### 6.2 사전 안내(리마인더) — `session_reminders`

(DB 테이블명은 `session_reminder_logs`, `models/session.py:170-198`; `session_reminders` 라는 이름의 테이블은 없음.)

- 예약: 세션 생성/복제/수정 시 `schedule_session_reminders` → 오프셋별 Celery ETA 태스크, task_id=`session-reminder:{session_id}:{offset}:{scheduled_at epoch}` (`reminder_service.py:401-408, 438-468`; 호출 `session_service.py:437, 619, 881`). 일정 변경 시 `revoke_session_reminders`(`:411`).
- 발송: `run_reminder`(`:334`) — 수신자 = **그 세션 `SessionParticipant` 중 회원·비대기** (`reminder_recipients` `:196-218`). 중복방지 UNIQUE(`session_id, offset_min, user_id, channel`) (`models/session.py:182-189`).
- 스윕 안전망: `sweep_session_reminders` 가 향후 48시간 내 회차를 스캔, 상태 `scheduled/ready/open` (`tasks/reminder_task.py:29-78`; 크론 `sweep_session_reminders_cron.py`).
- AI 비서 사전 안내(`agent_reminder.py`): 오프셋 기본 `(180, 60)`(`:33`), **1:1(`participant_mode != "group"`) 예약 세션만** 대상(`:71-83`), 대상=client 역할 활성 참여자(`:85-110`).
- 클래스 도입 영향:
  - 변경 — 수신자 산출을 "클래스 멤버(활성) − 해당 회차 결석 예고자"로. 회차 참여자 행이 없는 멤버도 수신해야 함.
  - 변경 — 고정형 8회 일괄 예약 시 오프셋 수 × 8개의 ETA 태스크가 한 번에 생성(`apply_async(eta=...)`). 브로커 부담보다 **일정 변경 시 개별 revoke** 가 회차 수만큼 필요. 정기형(끝 없음)은 전 회차를 미리 만들 수 없으므로 "다음 N회차 롤링 생성"이 필요(R5와 교차). 스윕이 48시간 창이라 롤링 생성 주기는 그보다 길어도 안전.
  - 변경 — 상담(1:1 클래스)의 AI 비서 사전 안내는 회차마다 유지되므로 `is_eligible_session` 은 그대로 동작. 단 문구에 회차 번호 필요.
  - 신규 후보 — "다음 회차 안내(이전 회차 종료 직후)", "결석 후 보강 안내" (결정 후보).
- 분류: `SessionReminderLog` 스키마 **호환 유지**(회차 키 그대로). 서비스는 수신자 쿼리만 변경.

## 7. 리포트 생성 · STT 파이프라인

(리포트 내용·연결 키는 `R6-리포트분석.md` 상세. 여기선 호출 경로·영향만.)

### 7.1 종료 → 체인

- `transition_status(action="end")`(`session_service.py:941-1070`): 영상 finalize → 오디오 finalize → 연구 내보내기 큐 등록 → 알림. `audio_service.finalize_on_session_end` 가 **STT → 요약 → 리포트 생성** Celery chain 을 큐에 적재하고 `PipelineOutbox`(`session_id` UNIQUE FK, `models/pipeline_outbox.py:22-24`)로 발행을 보장 (`audio_service.py` finalize 부분, `tasks/pipeline_outbox_task.py:1-30`).
- 태스크: `tasks/stt_task.py`(636줄, `run_stt_inline`) → `tasks/summary_task.py`(`run_summary_inline`) → `tasks/report_task.py`(`generate_report_inline`).
- 모두 `session_id` 한 개를 받아 `SessionRecord`(`session_id` UNIQUE) 1건과 `Report` 를 만든다 → **회차 단위로 정확히 맞음, 호환 유지**.
- 클래스 도입 영향: 체인 자체 변경 없음. 추가 필요 — (a) 회차 리포트 완료 시 클래스 단위 추이 갱신 훅(신규, 비동기 Celery 태스크 — `sdd-workflow` 규칙상 동기 호출 금지), (b) 출석 상태가 "결석"인 멤버는 해당 회차 client 리포트를 만들지 않음 — 현행 `generate_client_reports_for_session` 은 대기열 제외 전 참여자를 순회하고 `report_included=False` 면 행 생성 생략(`report_service.py:357-440`, 특히 참가자 `report_included` 판정 `:400`) → **'참여자 행 존재=출석'** 가정이 코드에 있음. 멤버십 모델에서는 "출석 기록"을 기준으로 해야 함(변경).

### 7.2 동의·범위 필터

- `report_scope.scope_for_session`(`report_scope.py:84-87`): 리포트 반영 범위가 **회차 × 참여자** 단위로 `SessionParticipant.report_included`·`entered_at` 에서 산출. 동의 시점이 "클래스 가입 1회"가 되면 이 판정의 입력이 멤버십으로 바뀜(변경). 결정 후보 D-1.
- 비회원 리포트 메일: `report_email_service`(참여자 토큰 `participant_token` `:29`), 회차 단위 → 호환 유지. 비회원이 클래스 멤버가 되는 경우 "클래스 전체 리포트 링크"는 신규 설계 필요(결정 후보).

### 7.3 내려받기·보관

- `export_service.authorize/create_export`(`export_service.py:50-130`) 참여자×회차 단위, 보관 스위프 기준일=회차 종료일(`retention_sweep_service.py`, R5 정책 `policy-revision-r4.md:9`) → 호환 유지.

### 7.4 Celery 태스크 목록 (`tasks/`) — 세션 키 사용 현황

(`grep -c "session_id" tasks/*.py` — report_task 26 · stt_task 29 · summary_task 28 · video_task 13 · session_task 16(=sweep) · pipeline_outbox_task 2 · reminder_task 3)

| 태스크 이름 | 파일 | 키 | 분류 |
|---|---|---|---|
| `tasks.stt` · `tasks.summary` | stt_task.py:617 · summary_task.py:337 | session_id (회차) | 호환 유지 |
| `tasks.merge_video_chunks` | video_task.py:76 | session_id | 호환 유지 |
| `tasks.generate_reports_for_session` | report_task.py:704 | session_id → counselor 1 + client N 리포트 | 호환 유지(+ 클래스 추이 갱신 훅 신규) |
| `tasks.process_pipeline_outbox` | pipeline_outbox_task.py:50 | `PipelineOutbox.session_id` UNIQUE | 호환 유지 |
| `tasks.send_session_reminder` · `tasks.sweep_session_reminders` | reminder_task.py:18, 28 | session_id (48h 창) | 변경(수신자 쿼리) |
| `tasks.sweep_stale_open_sessions` | session_task.py:16 | 세션 상태 | 호환 유지 |
| `tasks.sweep_stale_eeg_raw` | eeg_raw_task.py:32 | session | 호환 유지 |
| `tasks.report_email` · `tasks.session_invite_email` (email_app 큐) | report_email_task.py:18, 93 | report_id / 초대 | 변경(초대는 클래스 대상) |
| 신규 제안 | — | class_id | 정기형 다음 회차 롤링 생성 · 클래스 추이 갱신(R6) |

## 8. 권한 — 회원이 볼 수 있는 범위 (client_portal 등)

### 8.1 현행

| 경로 | 판정 | 근거 |
|---|---|---|
| 세션 단건 조회 | host 이거나 `SessionParticipant` 행 존재 | `_get_session_for_user` `session_service.py:724-739` |
| 세션 목록 | host OR 참여자 행 존재(EXISTS 서브쿼리) | `list_sessions` `:690-722` |
| 참여자 PII | 호스트 뷰만 이메일·성별·생년월일 (B8) | `:150-190`, `:722` |
| 호스트 전용 조작 | `_get_session_as_host` + 활성 기관 검사 | `:742-755` |
| 내담자 홈 | 본인 참여자 행의 다음 예정·오늘 일정 | `client_portal.py:213-321` |
| 리포트 | 본인 `Report.user_id`(회원), 호스트, org_admin(소속 기관 호스트의 세션) | `report_service.py:595-610`(내담자 쿼리), `:823-845`(`_can_access_report`) |
| 비회원 | 입장 자격 JWT(`sid`=세션) 로만 본인 상태·토큰·업로드 | `entry_credential_service.py:62-99` |
| 숨김/제거 | `hidden_at`·`removed_at`·`waitlist_cancelled_at` 은 모든 ORM SELECT 에서 자동 제외 | `core/database.py:17-40` |

- 현행 규칙은 "그 회차의 참여자 행이 있으면 그 회차를 본다". **결석한 회차는 참여자 행이 없어 회원이 볼 수 없다.**
- 리포트도 같은 규칙: 회원 상세는 참여자 행 존재 + 소유자 본인(`report_service.py:823-845, 741-749`). 참여자 행이 제거(`removed_at`)되면 과거 리포트 열람도 막히는 것으로 읽힘(코드 해석, 실행 미검증) → 이탈 회원 처리는 `R6-리포트분석.md` §4.2·R6-D4 참조.

### 8.2 클래스 도입 시 변경 (기본값 제안)

- 새 판정: `class_member(user, class)` 존재 → 클래스 상세·회차 타임라인(일정·상태·제목) 열람 가능. 회차 **입장·리포트**는 그 회차의 출석(참여) 기록이 있을 때만.
- 중간 합류자의 지난 회차 열람 범위: 기본값 **일정 정보만 열람, 리포트·기록은 본인 참여 회차만**(기존 PII·원본 최소 권한 원칙 `.claude/rules/data-privacy.md`). → 비즈니스 결정 D-2.
- 이탈 회원: 이탈 이후 회차 열람 불가, 본인 과거 리포트는 유지(`Report.user_id` 기준이라 자연 유지).
- 멤버십 도입 후에도 `GET /sessions/{id}`·`/sessions` 는 호환 유지하되 판정에 "클래스 멤버" 추가 → 구 앱은 동일 응답.
- 쿼리 비용: 현재 `EXISTS(SessionParticipant)` 단일 경로가 멤버십 `EXISTS` 와 OR 로 늘어남 → 인덱스(`class_members(user_id, class_id)`) 필요(R1 협의).
- 비회원: 자격이 `sid`(세션) 고정이라 클래스 단위 재방문 불가 → 클래스 멤버가 되려면 4자리 코드 재입력 또는 클래스 자격 신설. 기본값 **비회원은 클래스 멤버가 되지 않고 회차별 자격 유지**(회원 가입/로그인 유도로 이어지는 설계는 R4). 결정 후보 D-3.

## 9. org_admin 영향

현행 코드 사실:
- 세션 API(`session.py`)에는 org_admin 전용 분기가 **없다**. org_admin 이 `GET /sessions/{id}` 를 호출하면 host/참여자가 아니므로 403 (`_get_session_for_user` `:724-739`) — 확인 근거: 함수 본문에 role 검사 없음.
- org_admin 이 보는 세션 정보는 두 경로뿐: ① `GET /dashboard/org` — 기관 소속 상담사(`counselor`,`org_admin`)가 호스트인 비템플릿 세션 전체와 통계 (`dashboard_service.py:153-213`), ② 리포트 접근 `_can_access_report` 의 org_admin 소속 기관 분기(`report_service.py:829-833`) 및 `GET /reports` 의 기관 전체 호스트 조회(`:583-586` 부근, `host_ids = ... User.org_id == user.org_id`), ③ `get_counselor_activity` (`org_service.py:457-520`, 상담 내용은 비노출).
- 세션 생성 시 기관 귀속: `organization_id`·`organization_attribution_known` (`models/session.py:49-56`), 비활성화 영향도 `deactivation_impact`(`org_management_service.py:138-174`)가 sessions 행 상태로 집계.

클래스 도입 영향:
- 변경 — 기관 귀속(`organization_id`)은 **클래스 컬럼으로 올림**. 회차는 클래스에서 상속(회차별 귀속이 달라질 이유 없음). 이전 시 기존 `organization_attribution_known=false` 보존.
- 변경 — `org_dashboard` 의 `total_classes`·`class_count`(= sessions 행 수) 의미가 달라짐: 클래스 수(프로그램)와 회차 수를 분리해 제공(기본값: `total_classes`=클래스, `total_sessions` 신설).
- 변경 — 기관 비활성화 영향도(`scheduled/ongoing`)는 "남은 회차가 있는 클래스 수"를 추가.
- 신규(후속 분리 권장) — org_admin 이 소속 클래스 목록·출석 요약(내용 비노출)을 보는 센터 관리자 화면. MVP 범위 외로 제안; 포함 시 `/dashboard/org` 확장으로 충분.
- 호환 유지 — org_admin 리포트 접근 규칙(소속 기관 호스트 세션).
- 상충 확인 필요(미확인): 호스트 변경/상담사 퇴사 시 클래스 소유권 이전 규칙은 현재 없음(sessions.host_id 고정) — 클래스 호스트 이관 요건은 센터 고객 요구로 후속.

## 10. 기타 연관 영향

| 영역 | 현행 | 영향 |
|---|---|---|
| 채팅 | `ChatRoom.session_id` UNIQUE FK(회차당 1방), 오픈 시 개설(`session_service.py:210, 1039`, `chat_service.py:280`) | 클래스 채팅방(회차 간 연속)으로 올릴지 결정 필요. 기본값: 회차 채팅방 유지(호환), 클래스 채팅방은 후속 |
| 시간 충돌 검사 | `detect_conflict`(`session_service.py:300`) 호스트 기준 | 회차 단위 유지가 자연(R5) |
| `is_template` | 세션 행 플래그(`models/session.py:99-104`) | 클래스 템플릿으로 승격 또는 회차 복제로 흡수(R1·R5) |
| `run_id` | 재실행 그룹 키(기본=id) | 회차 개념으로 대체. 이전 시 값 보존, 신규 사용 중단 |
| 연구 내보내기·보관 크론 | 회차 종료 후 큐 등록 | 호환 유지 |
| 크론 16종 | `*_cron.py` (`ls backend/*_cron.py`) | 신규 필요: 정기형 다음 회차 롤링 생성 크론 1건 |
| 테스트 | `tests/` 에 `session_id` 488회/73파일 | 신규 `class_id` 경로 테스트 + 구 `/sessions` 호환 회귀(고정 응답 스냅샷) 필요 |

## 11. 기본값 제안 (기술 선택 — 근거 명시)

1. **세션 id = 회차 id 로 고정**. `sessions.id` 불변, `class_id` FK 추가(추가형 nullable → 백필 → NOT NULL). 이유: `session_id` 1,232회·WS 룸·알림 딥링크·JWT `sid`·`Report`/`EEG`/`SessionRecord` FK 모두 변경 없이 유지(§2.1, §5, §6.1).
2. **기존 `/sessions/*` 61개 경로는 폐기하지 않고 유지**, 응답에 클래스 요약 필드만 가산. 신규 `/classes/*` 로 클래스 기능 제공. 이유: 구 앱 번들 강제 업데이트 없음(브리프 R7).
3. `POST /sessions` 에 `class_id` 미지정 시 클래스 자동 생성(구 앱 단회차 생성 호환).
4. 클래스 룸 미신설, 알림 `params` 확장으로 클래스 정보 전달.
5. 클래스 리포트는 회차 리포트 완료 후 **비동기 Celery 태스크**로 갱신(R6).
6. 권한 판정은 서비스 함수 한 곳(`_get_session_for_user` 계열)에서 멤버십 OR 참여자 행으로 일원화.

## 12. 결정 후보 (비즈니스·정책)

| ID | 질문 | 옵션 | 기본값 제안 |
|---|---|---|---|
| D-1 | 리포트 반영·연구 동의 시점 | (a) 클래스 가입 시 1회 (b) 회차마다 확인 (c) 가입 시 1회 + 회차 입장 시 변경 가능 | (c) — 현행 "종료 전 변경 가능" 정책(`session.py:477` 독스트링)과 정합 |
| D-2 | 중간 합류자의 지난 회차 열람 범위 | 일정만 / 일정+요약 / 전부 | 일정만(리포트·기록은 본인 참여 회차만) |
| D-3 | 비회원(4자리 코드) 클래스 멤버화 | 회차별 일회성 유지 / 클래스 멤버 허용(재방문 코드) | 일회성 유지(후속에서 재논의) |
| D-4 | 채팅방 단위 | 회차마다 / 클래스 1개 | 회차 유지(후속에 클래스 채팅) |
| D-5 | 결석 처리 시 알림 | 호스트 알림 / 회원 본인 알림 / 없음, 보강 안내 자동화 | 호스트에게만, 보강 안내는 수동 |
| D-6 | 호스트(상담사) 변경/퇴사 시 클래스 소유권 | 이전 허용 / 불가 | 후속(센터 고객 요구 시) |
| D-7 | org_admin 의 클래스 열람 범위 | 현행 유지(통계만) / 클래스 목록·출석 요약 | 현행 유지(통계만) |
| D-8 | 상담(1:1) 클래스의 회원-상담사 연결(`ClientCounselorLink`)과 클래스 멤버십 관계 | 별도 유지 / 상담 클래스 생성 시 자동 연결 | 별도 유지(`client_portal.py:90-205` 상담사 코드 연결은 그대로) |

(기술 결정은 위 §11 기본값으로 처리 — 결정 후보에서 제외.)

## 13. 미확인

- 구 앱(Capacitor 번들)이 WS 룸 이름·`/sessions` 응답 필드를 어디까지 하드코딩하는지 — 프론트 코드는 R3 범위, 이번 조사 미수행.
- 프론트가 알림 `target_type="session"` 을 어떤 라우트로 매핑하는지 — 미확인(R3/R8).
- `audio_service.finalize_on_session_end` 전체 체인 구성의 세부(영상 병합 태스크 등)는 본문 일부만 확인(`audio_service.py:244-300` 부근) — 회차 단위라는 결론엔 영향 없음.
- 운영 DB의 실제 sessions 행 수·참여자 수·활성 4자리 코드 수 — 조회 권한 없음(코드/로컬 확인만).
- `chat_service.py` 의 세션 채팅방 참여자 동기화 로직(멤버 변동 시 방 멤버십 갱신) 세부 — 미확인.
- 테스트(`tests/`)에서 `/sessions` 응답 스냅샷 고정 여부 — 미확인.
- `agent_policy.py` 63개 Session 심볼 사용처의 개별 분류 — 상위 쿼리(`:611-640`)만 확인.
