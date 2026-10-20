# SDD-223 — 진행 중 클래스에서 회원 바로 초대·입장

- 상태: Stage ① Spec (사용자 승인 완료)
- 브랜치: `sdd/223-live-class-invite`
- 작성일: 2026-10-20
- 프론트: 별도 워커(`sdd/223-fe`)가 구현. 이 SDD는 backend + API 계약만 다룬다.

## 1. 문제

지도사가 클래스 **진행 중**(회차 `open`=대기실, `in_progress`=진행 중)에 회원을 초대해도, 그 회원은 현재 회차에 들어갈 수 없다.

- `class_membership_service.invite_members`는 고정 일정 클래스에서 `scheduled_at >= now`인 `ready/scheduled` 회차에만 `SessionParticipant(expected)`를 만든다. `open/in_progress` 회차는 `recurrence_rule.start_now`(즉시 시작 클래스)일 때만 포함한다.
- 초대 알림(`class_effect_service._deliver`)의 "지금 입장할 수 있어요" 문구·입장 링크도 `start_now` 클래스에만 붙는다. 효과 즉시 발송(`queue_class_effects`)도 `start_now`에만 걸려 있다.
- 같은 이유로 `_activate_future`(대기→활성 승격, 재가입)도 `start_now`일 때만 열린 회차에 붙는다.

결과: 초대받은 회원은 다음 예정 회차까지 기다려야 하고, 이메일 초대 링크에도 현재 회차 입장 링크가 없다.

## 2. 목표 (사용자 결정)

지도사가 클래스 진행 중 회원을 초대하면 그 회원이 **현재 열린 회차에 즉시 입장**할 수 있다. `start_now` 여부와 무관하다.

## 3. 범위

### (a) 회원 선택 초대 — 현재 열린 회차에 참여자 추가
- `invite_members`가 `start_now`와 관계없이 `session_kind="regular"`, `hidden_at IS NULL`, `status in (open, in_progress)`인 회차에도 `SessionParticipant`(`attendance_status="expected"`)를 만든다. 기존 미래 회차 규칙은 그대로.
- **정원 체크 유지**: 회차 `max_participants` 초과 시 기존과 같이 `409 session_capacity`, 클래스 정원 초과는 `409 class_capacity`.
- 기존 참여자가 이미 `attended`/`absent` 등이면 건드리지 않는다(`ensure_expected`의 기존 규칙).
- `_activate_future`(대기자 승격·재가입 경로)도 같은 기준(열린 회차 포함)으로 통일한다.

### (b) 이메일 초대 수락·가입 후 현재 열린 회차 연결
- 클래스 이메일 초대(`ClassEmailInvite`)는 멤버를 직접 만들지 않는다. 수신자가 메일의 입장 링크/참여 코드로 들어오면 `session_service._enter_resolved`가 `invite_members(via="code")`를 호출해 멤버가 된다. 그 호출이 (a)로 현재 열린 회차에 붙으므로 **(a)의 공용 수정으로 충족**한다.
- 이메일 본문의 입장 링크(`/class/{session_id}/enter`)를 `start_now` 여부와 무관하게 현재 열린 회차가 있으면 포함한다.

### (c) 초대 알림 — "지금 입장 가능" 문구·링크
- `class_invited` 알림(인앱/웹푸시 공용 `notify_event`)은 클래스에 현재 열린 회차가 있으면(`start_now` 무관) 제목 "클래스 초대", 본문 "{클래스명}: 지금 입장할 수 있어요. {frontend}/class/{session_id}/enter", `extra.params`에 `start_now: true`, `session_id` 포함. 열린 회차가 없으면 기존 문구 유지.
- 열린 회차가 있으면 효과를 즉시 발송한다(`queue_class_effects`). 없으면 기존처럼 워커 주기 발송.

### (d) 프론트용 API 계약
아래 필드를 **가산**한다(기존 필드 변경·삭제 없음).

| API | 응답 추가 필드 |
|---|---|
| `POST /api/v1/classes/{class_id}/members` (`classOperationsApi.inviteMembers`) | `current_session_id: string \| null` — 초대 처리 후 입장 가능한 현재 열린 회차 ID. 없으면 `null`. 기존 `member_ids` 유지. |
| `POST /api/v1/classes/{class_id}/email-invites` (`schedulingApi.inviteEmails`) | `current_session_id: string \| null` — 동일 의미. 기존 `invitations` 유지. |

- `current_session_id` 선정: 클래스의 `regular` · 숨김 아님 · `open/in_progress` 회차 중 `seq` 가장 작은 것(알림의 `instant_session`과 같은 기준). 입장 URL은 프론트가 `/class/{current_session_id}/enter`로 만든다(알림과 동일).
- 멱등 재호출 시 저장된 최초 응답이 재생되므로 재생 응답의 `current_session_id`는 최초 시점 값이다.
- 에러 코드는 기존 그대로(`session_capacity`, `class_capacity`, `member_reinvite_required`, `class_not_active` 등).

## 4. 비범위
- frontend/ 수정, DB 스키마 변경(alembic 없음).
- 종료·취소 회차, `makeup`/`extra` 종류 회차 추가.
- 이미 입장 기록(`entered_at`)이 있는 참여자의 상태 되돌림.

## 5. QA 체크리스트 (수락 기준)

| ID | 시나리오 | 기대 |
|---|---|---|
| Q1 | 고정 일정 클래스, 회차가 `open`일 때 회원 초대 | 해당 회차에 `expected` 참여자 생성 |
| Q2 | 같은 상황, 회차 `in_progress` | `expected` 참여자 생성 |
| Q3 | 회차 `max_participants` 가득 찬 상태에서 초대 | `409 session_capacity`, 멤버·참여자 롤백 |
| Q4 | `ready/scheduled` 미래 회차 + 열린 회차 공존 | 둘 다 참여자 생성 |
| Q5 | 열린 회차 없음 | 기존 동작(미래 회차만) 유지 |
| Q6 | 응답 `current_session_id` | 열린 회차 있으면 ID, 없으면 `null` (members·email-invites 둘 다) |
| Q7 | `class_invited` 알림 | 열린 회차 있으면 "지금 입장할 수 있어요" + 입장 링크 + `session_id` param, 없으면 기존 문구 |
| Q8 | 이메일 초대 본문 | 열린 회차 있으면 입장 링크 포함 |
| Q9 | 이메일 수신자가 코드로 입장(`via="code"` 경로) | 멤버 생성 + 현재 열린 회차 참여자 생성 |
| Q10 | 대기자 승격/재가입(`_activate_future`) | 열린 회차에도 참여자 생성 |
| Q11 | 취소·종료 회차 / `hidden` 회차 | 참여자 추가 안 함 |
| Q12 | 이미 `attended` 인 참여자 재초대 | 변경 없음 |
