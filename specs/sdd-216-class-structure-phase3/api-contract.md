# SDD-216 — 편성 API 계약

- 상태: 로컬 BE 구현. 코드: `backend/app/api/v1/classes.py`, `backend/app/schemas/class_scheduling.py`. 테스트 실행 결과는 [summary.md](summary.md).
- 접두: `/api/v1/classes`. HTTP 응답은 코드와 PG 라우터 테스트 기준이며 배포 환경 응답은 미확인.
- `class_scheduling_enabled=false` 기본값: 편성 쓰기·preview·코드 가입·참관 진입점은 404. 기존 읽기는 유지한다.
- `class_rolling_enabled=false`, `class_team_read_enabled=false` 기본값. 팀 본문·참관은 새 고지와 팀 스위치가 모두 필요하다.
- UUID는 문자열. 날짜는 ISO 날짜, 반복 시각은 한국 벽시계 `HH:MM`. 회차 시각은 시간대가 있는 ISO 문자열이며 DB에는 UTC로 저장한다. 코드는 선행 0을 보존하는 4자리 문자열.

## 1. 생성·편성 입력

- `operation_key`: 1~100자. 같은 사용자·키·동일 요청은 저장된 동일 결과. 다른 요청은 409 `operation_key_reused`.
- `expected_revision`: 클래스 수정에 필수. 생성은 새 클래스, 수정은 클래스 행 잠금 후 현재 revision 비교. 오래된 값은 409 `stale_class`.
- `expected_state_versions`: bulk에서 선택한 모든 회차 ID→버전. 강사 변경은 `expected_state_version`. 오래된 값은 409.
- `force` + `confirmed_conflict_fingerprint`: 최신 충돌 확인. 검사를 건너뛰지 않는다. 확인 후 충돌이 바뀌면 다시 409.
- 센터 관리자 대행·완료 후 정정의 `reason` 필수. 허용하지 않은 입력 필드는 422.

`ScheduleInput`:

- `title`, `location_type`(online/offline), `location_address`, `capacity`, `linkband_mode`, `record_audio`, `record_video`, `chat_enabled`.
- 온라인 정원 최대 50, 오프라인 최대 100. 영상 녹화 기본 off. 오프라인 후보는 장소 입력 필요.
- `schedule_mode`: fixed/rolling. `planned_session_count`: 기본 8, 2~52. `duration_min`: 기본 60, 5~480의 5분 단위.
- `recurrence_rule`: version=1, start_date, weekdays(월=1~일=7), time(07:00~22:00·5분 단위), interval_weeks, skip_dates.
- `assignment_rule`: version=1, mode(all_one/rotate/by_weekday/per_session), host_ids 또는 weekday_hosts. 미정 null은 draft만 저장한다.
- `instructors`: user_id·role(lead/assistant). counselor 개설자는 lead. org_admin 개설은 별도 lead 필수.
- `rows`: client_key(`regular:YYYY-MM-DD`)·seq·scheduled_at·duration_min·location_type/address·host_id·session_kind·assignment_override. 수동 수정은 원래 후보 키로 식별한다.
- `reminder_offsets`, `ends_on`, `member_ids`. 이메일/CSV 초대는 별도 API다.

## 2. 연결된 HTTP 경로

| 메서드·상대 경로 | 입력·권한 | 결과·핵심 조건 |
|---|---|---|
| GET 빈 경로 | 인증, 기존 목록 필터·페이지 | `classes`, `total` |
| GET `/{class_id}` | 현재 강사·회원·센터 관리자 | 상세 직접 반환, 관리 권한자만 draft_schedule, capabilities.schedule은 편성 스위치와 관리 권한을 반영한 bool |
| GET `/{class_id}/sessions` | 부모 가시 범위 | `sessions`, `total`, 미정 host nullable |
| POST `/preview-schedule` | ScheduleInput, counselor/org_admin | rows/conflicts/warnings/input_hash/conflict_fingerprint/class_revision. 저장 없음 |
| POST 빈 경로 | operation_key, status(draft/active), schedule, 충돌 확인 | 201, class_id/revision/session_ids/effects_pending/invitation_results |
| PATCH `/{class_id}` | 전체 schedule·공통 쓰기 입력, lead/org_admin | draft 입력 또는 이후 생성 설정 수정. 기존 회차 수정은 bulk |
| POST `/{class_id}/publish` | 공통 쓰기 입력, lead/org_admin | 전체 진행자·충돌 재검사 후 공개 |
| POST `/{class_id}/duplicate` | start_date, invite_members 기본 false | 201, 원래 패턴으로 새 draft. 원본 규칙 없으면 422 |
| POST `/{class_id}/schedule/preview` | BulkCommand | 전후 후보·충돌·현재 revision. 저장 없음 |
| PATCH `/{class_id}/sessions/bulk` | action(replace/shift_week/cancel), session_ids, 버전, rows | 선택 전체 원자 적용. 한 행 실패하면 전부 롤백 |
| POST `/{class_id}/sessions` | row, makeup_for_session_id, member_ids | 정규 또는 지정 회원 보강. 보강의 원 정규 회차 연결 저장 |
| POST `/{class_id}/roll-forward` | lead/org_admin | cron과 같은 잠금·커서 계산. class_id/session_ids |
| POST `/{class_id}/transition` | action(complete/cancel/archive/restore/hide)·공통 입력 | 클래스 수명 전이. open/in_progress이면 마무리/취소 거절 |
| DELETE `/{class_id}` | 공통 쓰기 입력, lead/org_admin | 시작 이력 없는 클래스·회차 숨김. 물리 삭제 없음. 시작/완료 이력은 409 archive_required |
| GET/POST `/{class_id}/instructors` | 조회 또는 강사 추가 입력 | 동일 센터 active counselor. guest는 scope_session_id 필요 |
| PATCH/DELETE `/{class_id}/instructors/{user_id}` | 역할 변경/제거, 공통 쓰기 입력 | 마지막 lead 제거·미진행 배정이 남은 제거·다른 진행 회차를 잃는 guest 축소는 409 |
| POST `/{class_id}/sessions/{session_id}/host-requests` | candidate_host_id, request_kind, 회차 버전, 충돌 확인 | request_id/status. 후보와 확정 host 분리 |
| POST `/{class_id}/sessions/{session_id}/host-requests/{request_id}/resolve` | action(approve/accept/reject/cancel), 공통 입력 | 후보/관리자/요청자 권한 분리. 수락 시 최신 충돌 fingerprint 재확인 |
| POST `/{class_id}/sessions/{session_id}/host-correction` | mode(correct/note), reason, 후보 또는 displayed_host_name | 승인 전 귀속 정정, 승인 후 append-only 표시 메모 |
| GET/POST `/{class_id}/members` | 조회 또는 user_ids·reactivate·공통 입력 | active 1행, 미래 정규 expected. 수료·탈퇴 회원 재초대는 명시 reactivate |
| POST `/{class_id}/email-invites` | emails·공통 쓰기 입력 | 주소 정규화·중복 제거·전달 의도. 회원 신원·동의 자동 생성 없음 |
| POST `/{class_id}/email-invites/{invite_id}/retry` | 공통 쓰기 입력 | failed만 pending 재처리. 실제 메일은 별도 워커 |
| POST `/resolve-code` | code, 기존 시도 제한 | 공개 부모·입장 가능한 일정, 개인정보 목록 없음 |
| POST `/{class_id}/join` | 인증 회원·code, 시도 제한 | 코드와 부모 일치 검증 후 최소 멤버십. 미래 회차 자동 시작 없음 |
| POST `/{class_id}/sessions/{session_id}/observe` | 현재 lead/assistant, 새 고지·팀 스위치 | 참관 token/room_name/snapshot. participant 생성 없음 |
| GET `/reassignment-queue` | 센터 관리자 | 같은 센터 needs_reassign 운영 메타 |

- 성공한 DB 저장과 외부 전달 성공은 구분한다. 생성의 `invitation_results`는 현재 빈 배열이며 이메일 전달 결과는 이메일 초대 API에서 조회한다.
- `effects_pending`은 생성 회차의 준비 의도 수다. 클래스 전체 outbox 잔량이나 전달 성공 건수가 아니다.
- draft에는 실제 회차·코드·멤버·전달 의도가 없다. 부분 생성 성공 응답은 없다.
- 숨김과 상태 변경도 `operation_key`를 사용한다. 동일 키 재시도는 권한이 유지되는 가시 클래스에서 처리한다.

### 클래스 상세 capabilities

- `manage`: 현재 클래스의 주강사(`lead`) 또는 같은 센터 관리자(`org_admin`)이면 true.
- `invite`: 현재 주강사·보조강사·같은 센터 관리자이면 true.
- `schedule`: **bool, 항상 반환**. `CLASS_SCHEDULING_ENABLED=true`이고 `manage=true`일 때만 true. 설정 객체에서는 `settings.class_scheduling_enabled`로 읽는다.
- 권한은 현재 활성 계정·소속·강사 상태를 검사하는 `class_role` 기준이다. 보조강사·회원 및 기존 회차 호스트라는 사실만으로 편성 권한을 부여하지 않는다.
- 스위치 off에서도 GET 상세는 유지하고 `schedule=false`를 반환한다. 기존 `manage`·`invite` 값은 스위치로 바꾸지 않는다.
- FE의 새 편성 마법사 CTA는 `capabilities.schedule === true`일 때만 활성화한다. 요청 시 서버의 편성 스위치·권한 검사는 계속 적용한다.
- 추가 검증 SC-01: 실제 GET 상세에서 스위치 off/on × 주강사/센터 관리자/보조강사/회원 8조합의 bool 값과 기존 capability 보존을 확인한다. 구현 전에 기대값·실패 테스트를 작성한다.

## 3. 오류·권한·기존 엔진 연결

- 401 인증, 403 역할/동작, 404 미존재·비가시 부모, 409 상태/버전/충돌/정원, 422 입력, 503 코드 소진.
- 신규 도메인 오류의 detail은 `code` 객체. 필드 검증 오류는 FastAPI 표준 422.
- 공개 코드 형식 오류·비활성·잘못된 코드 조회는 404. 잘못된 코드 시도에는 기존 rate limiter 적용.
- 충돌 항목: host/place/member. 장소는 정보 경고, host/member는 명시 확인 필요. 비가시 상대의 ID·제목·seq는 null.
- 진행자 변경: 시작 61분 전 즉시, 60분 전부터 수락 대기, 15분 이하 새 요청 거절. 수락·열기 시 현재 자격을 재검사한다.
- 새 편성 활성화 시 기존 POST `/sessions`의 실제 명상 생성과 기존 명상 복제는 409 `use_class_scheduling`. 상담·설정 템플릿은 기존 엔진을 유지한다.
- 신규 부모의 기존 단건 수정·삭제·new-run·자동 시작 join도 클래스 편성 경로로 유도한다.
- 기존 SessionResponse에 `host_state` 추가, 미정/수락 대기 회원 응답의 host_id/host_name은 null. 계약 골든은 host_id nullable 변경만 갱신했다.
- 회원 회차 링크는 `/app/classes/{class_id}?sessionId={session_id}`, 강사 링크는 `/classes/{class_id}/sessions/{session_id}`. 부모 ID와 회차 ID를 혼용하지 않는다.
- D-28: 센터 관리자는 명상 리포트 읽기, 상담 운영 메타만 허용. 리포트 쓰기·승인·원문·녹음/영상 제어는 진행 지도사 권한으로 별도 판정한다.
- D-05: 팀 본문은 반영 대상의 `class-team-v1` 확인, 라이브 참관은 실제 입장 회원 전체의 확인 필요. 전사·원본 미디어·편집 이력은 팀/센터 관리자 응답에서 제거한다.

## 4. 전달·참관 계약

- 클래스 전달 의도→`notify_event(commit=False)`→Notification/NotificationOutbox→효과 완료를 같은 DB 커밋으로 처리한다.
- 요청/수락 결과, 가입, 추가 회차, 배정·변경, 재배정, 클래스 종료 이벤트를 생산한다. 일괄 변경은 묶어서 전달한다. 수락 대기 행 때문에 확정된 다른 행 알림이 누락되지 않도록 확정 행을 선택한다.
- `GET/PUT /api/v1/notifications/preferences`에 `push` 맵 추가. 시작 60분 이내 확정 변경은 해당 push 선호를 확인해 기존 push outbox에 적재한다. 실제 FCM/Web Push는 이번 실행에서 호출하지 않았다.
- LiveKit 참관 토큰: identity=`observer:{user_id}`, TTL 60초, canPublish=false, canPublishData=false. 토큰만으로 이미 연결된 사용자의 권한 회수를 대신하지 않는다.
- 참관 WS 방은 `session:{session_id}:observer`. 상태·버전·시각만 투영하며 EEG·참여자·기기 payload를 포함하지 않는다. 민감 이벤트 직전 현재 역할을 재검사한다.
- 강사 제거·계정 제한·회원 입장/고지 변경은 LiveKit 재검사 의도를 저장한다. 클래스 유지 cron은 열린 회차를 재검사한다. 서버에서 현재 참관 권한이 없는 identity를 제거하고 없는 방/이미 나간 identity는 멱등 처리한다.
- 실제 LiveKit 연결 회수 시간, 다중 WS 워커, 브라우저 권한 표시·실제 전달은 미확인. 팀 스위치 on의 출시 차단 조건이다.

## 5. FE 연결 순서

1. BE 출시·마이그레이션·운영 작업 검증 후 이 계약을 고정한다.
2. DTO의 nullable host·push 선호·오류 code·operation_key·버전·충돌 확인을 연결한다.
3. 4단계 편성·표/카드/시트·강사 운영을 연결한다.
4. 새 고지 문구·저장과 실제 참관 회수 검증 후 팀 스위치를 켠다. 시안 시각 검증은 별도 FE 게이트다.
