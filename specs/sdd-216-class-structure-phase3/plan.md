# SDD-216 Plan — 명상 클래스 편성·강사 구현 계획

- 실행 갱신: Brian의 명시적 후속 지시 “아니 괜찮아. 계속 개발 진행해줘”에 따라 백엔드 로컬 구현·테스트를 계속한다. 아래의 문서 워커 범위는 최초 작성 당시 기록이다. push·배포·삭제·메일·머지 금지는 유지한다.
- 상태: Stage ②는 구현 전 작성. 후속 실행 결과는 [summary.md](summary.md)에 구분한다. 아래 표는 원래 Task와 선행 조건을 유지한다.
- 목표: 8회 원자 편성·강사 운영·권한을 BE에서 먼저 제공하고, 시안에 맞춘 FE를 두 번째로 출시한다.
- 구조: 기존 Session 엔진·Class 모델·session_authz·notification outbox를 확장한다. 반복/충돌 계산과 변경 트랜잭션을 분리하고, 단건 생성 함수를 N번 호출하지 않는다.
- 기술: 현재 저장소 FastAPI·SQLAlchemy·Alembic·PostgreSQL·Celery/OS cron, React·TypeScript·기존 apiClient·Vitest·Playwright 사용. 버전 변경·새 UI 라이브러리 도입 없음.
- 기준: [spec.md](spec.md), [verify.md](verify.md). 작업 경로: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd216`.
- 향후 실행자는 Task별 실패 테스트 → 최소 구현 → 같은 테스트 통과 → 정리 → 파일 소유자 검토 순서를 따른다. 구현 전 게이트 문서는 작성되어 있으며, 최신 실행 근거는 Brian의 명시적 개발 계속 지시다.

## 1. 구현 전 확인·설계 고정

- T00에서 승인 기록·시작 SHA·dirty 파일·허용 경로를 기록한다. 실행 근거: Brian의 기본값 적용 지시와 “아니 괜찮아. 계속 개발 진행해줘”.
- T01에서 신규 API/DTO/오류/권한을 `api-contract.md`에 고정한다(향후 산출물). SDD-215의 코드 대조 → 타입/fixture 고정 → 화면 연결 순서를 재사용한다.
- 정적 기준 head는 `e036a0000055`. 기존 053~055 수정 금지. 새 번호는 B가 실제 head 확인 후 단일 후속 리비전으로 발급한다. 지금 번호를 선점하거나 마이그레이션 파일을 만들지 않는다.
- 공유 잠금 순서: 관련 User 행(UUID 오름차순) → Class 행(UUID 오름차순) → Session 행(UUID 오름차순) → 요청/멤버 행 → 코드 발급 잠금. 여러 클래스를 건드리는 정지도 같은 순서를 따른다.
- 클래스 변경은 `revision` 비교, 회차 변경은 `state_version` 비교. 오래된 미리 보기는 409. 충돌 검사는 항상 실행하고 확인된 충돌 fingerprint와 다르면 다시 확인한다.
- 시간 기준은 주입 가능한 now, tz=Asia/Seoul. 시간/랜덤 코드/UUID/외부 전달을 테스트에서 고정한다.
- 승인자 컬럼·복합 FK·부모 CHECK·seq/member UNIQUE를 이미 존재하는 것으로 취급하되 PG 카탈로그로 재검증한다.

### 검토 집중 지점

| 실패 조건 | 담당 Task·검증 |
|---|---|
| 단건 생성/알림/채팅 함수 내부 commit으로 N회 중 일부만 남음 | T07, T08 / V-07~09 |
| 정지·제거·열기·수락·리포트 승인 경합으로 권한/host 불일치 | T12~17 / V-16~25 |
| 클래스 코드와 단건 회차 코드가 서로 다른 테이블에서 충돌 | T05 / V-04~06 |
| 회원·센터 관리자가 REST/PDF/WS/AI 우회로 미허용 본문을 읽음 | T18~20 / V-29~34 |
| 4뷰포트 fit 통과를 히어로·사이드바·행의 시안 일치로 오인 | T35~37 / VR-01~06 |

## 2. 추가 스키마와 트랜잭션

모든 항목은 신규 설계다. 기존 승인/멤버 컬럼을 재사용하고 운영 데이터 백필·초기화를 요구하지 않는다. JSON 구조는 Pydantic으로 검증한다.

| 대상 | 추가/재사용 | 목적·제약 |
|---|---|---|
| classes | `draft_schedule JSONB NULL`, `ends_on DATE NULL`, `generation_cursor DATE NULL`, `revision INT NOT NULL DEFAULT 0`, `archived_from_status VARCHAR(12) NULL` | 초안·종료일·마지막 검사 날짜·동시 수정·보관 해제. draft_schedule은 검증된 입력/후보만, 개인정보·동의·메일 본문 없음 |
| classes | recurrence_rule·assignment_rule 기존 JSONB | 규칙 version=1, 월=1~일=7. per_session은 사용자가 확인한 정규 후보 순서별 host 목록을 한 주기로 저장하여 반복 투영. 개별 회차 override는 규칙을 바꾸지 않음 |
| sessions | `assignment_override BOOL NOT NULL DEFAULT false` | 개별 수동 배정 보존. 기존 host_state·state_version·seq·kind 사용 |
| sessions | `ix_sessions_host_scheduled_at(host_id,scheduled_at)` | 통합 충돌 범위 조회. EXCLUDE 제약 없음 |
| session_host_requests 신규 | id, session_id FK, requested_by, candidate_host_id, request_kind(transfer/change), status(requested/pending_ack/accepted/rejected/expired/cancelled), expected_state_version, reason, expires_at, created_at, resolved_at | 미해결 requested/pending_ack은 session당 1행 부분 UNIQUE. 후보는 기존 host_id와 분리. 수락 시 현재 active/동일 기관 재검사 |
| class_operations 신규 | id, actor_id, operation_key, request_hash, class_id nullable, result JSONB, created_at; UNIQUE(actor_id,operation_key) | 재시도 결과 저장. result는 ID·처리 건수만. 키 재사용/본문 변경 409. 도메인 변경과 같은 커밋 |
| class_effects 신규 | id, class_id, session_id nullable, effect_key UNIQUE, kind, payload JSONB, available_at, status, attempts | 알림·리마인더 예약/취소·채팅 준비·초대 전달 의도. payload에 접근 토큰·코드·메일 본문을 저장하지 않고 실행 시 조회 |
| class_email_invites 신규 | id, class_id FK, email_norm, invited_by, invite_version, status(pending/sent/failed), created_at, sent_at; UNIQUE(class_id,email_norm,invite_version) | 회원 없는 초대 수신자를 NotificationOutbox.user_id로 조작하지 않음. 이메일/CSV 재시도는 동일 invite 행 |
| session_host_notes 신규 | id, session_id, actor_id, displayed_host_name, reason, created_at | 승인 후 표시 정정의 append-only 메모. 실제 진행자·리포트 소유 불변 |
| ClassInstructor·ClassMember·SessionHostHistory | 기존 컬럼/유일성 유지 | guest scope·회원 고지·진행자 이력. removed 행 물리 삭제 없음 |
| SessionParticipant·Report | 기존 notice/attendance/approved_by 필드 재사용 | D-05는 report_notice_version에 class-team-v1. 연구 notice version을 바꾸거나 연구 동의로 해석하지 않음 |

- class_effects는 notification_outbox를 대체하지 않는다. 도메인 처리 워커가 잠금으로 effect를 선점하고 `notify_event(commit=False)`·outbox 생성·effect 완료를 같은 트랜잭션으로 커밋한다.
- class_effects 예약/취소는 결정적 ETA task_id를 사용한다. 브로커 호출 후 프로세스 종료 시 중복 작업 실행은 가능하므로 최종 발송은 기존 delivery 유일성·최신 일정/상태 검증으로 멱등 처리한다. 외부 메일의 정확히 1회 전달은 보장했다고 쓰지 않는다.
- 이메일 초대는 저장된 이메일 대상에 기존 이메일 전달 부품을 사용하되 등록 회원 ID를 위조하지 않는다. 성공/실패 요청 결과만 API에 제공한다.
- generation_cursor는 생성한 마지막 날짜가 아니라 검사한 마지막 패턴 날짜다. skip·휴강·미배정·종료일 처리를 포함하고, 기존 회차를 이동해도 뒤로 돌리지 않는다.
- per_session rolling은 최초 확인한 후보의 순서별 host 목록을 주기로 저장하고 다음 정규 순번에 반복 적용한다. preview/확인 화면에 반복 주기와 다음 4주 배정을 보여준다. 수동 override는 저장 규칙과 분리한다. 목록의 강사가 비활성/removed이면 해당 host_id를 유지한 needs_reassign으로 생성한다. 빈 목록은 공개 422다.
- 코드 발급은 전체 코드 공간의 PG transaction advisory lock 1개와 활성 코드 합집합 검사로 직렬화한다. Session 단건 생성/복제/재발급까지 같은 함수 사용. SQLite에서는 동일 API 검증, 경합 증명은 PG에서만 한다.

## 3. API·모듈 계약

경로 접두는 `/api/v1` 생략. 아래 표는 구현 전 계약이다. 실제 연결·오류·제약은 [api-contract.md](api-contract.md)를 따른다. 기존 읽기 envelope `classes/total`, `sessions/total`, 상세 직접 반환을 유지하되 host nullable·권한 필드 변경을 함께 타입화한다.

### 3.1 공통 요청/응답

- `ScheduleInput`: title, location_type/address, capacity, linkband_mode, record_audio/video, chat_enabled, schedule_mode, planned_session_count, recurrence_rule, assignment_rule, instructors, rows(override), reminder_offsets, ends_on.
- `ScheduleRow`: client_key, session_id nullable, seq, scheduled_at, duration_min, location_type/address, host_id nullable(초안만), session_kind, assignment_override.
- `SchedulePreview`: rows, conflicts, warnings, input_hash, conflict_fingerprint, class_revision nullable. 저장 없음.
- `ConflictItem`: candidate_key, kind, starts_at, ends_at, other_session_id/parent_title/seq nullable, visible bool. 비공개 상대는 ID·이름·제목 없음.
- 쓰기 공통: `operation_key`, `expected_revision`, 회차별 `expected_state_version`, `confirmed_conflict_fingerprint`, `force`(명시 확인), `reason`(대행/귀속 정정 필수).
- 성공: `{class_id, revision, session_ids, effects_pending, invitation_results}` 또는 해당 변경 DTO. 원자 쓰기에는 `failed_rows` 부분 성공 없음.
- 오류: 입력 422, 인증 401, 역할 403, 부모 미존재/미가시 동일 404, 상태/버전/정원/경고 재확인 409, 코드 소진 503. 공개 코드 조회의 잘못된 형식은 404로 통일. FE는 error.code로 한글 매핑하며 서버 원문 노출 금지.

| API | 동작·주체 |
|---|---|
| POST /classes/preview-schedule | 초안 후보 계산, counselor/org_admin. 관리 대상 ID가 있으면 권한 검증 |
| POST /classes | draft 또는 active. active 생성 원자성·멱등 키 필수 |
| PATCH /classes/{id} | draft 입력/설정/향후 생성 규칙. 주강사·센터 관리자 |
| POST /classes/{id}/publish | draft→active, 전체 후보 진행자 검증 |
| POST /classes/{id}/duplicate | 원래 패턴 기반 새 draft 생성, 새 시작일·회원 재초대 선택은 draft 입력에 저장, publish 때 초대 |
| POST /classes/{id}/schedule/preview | 기존 회차 선택·변경 범위의 전→후·충돌 계산 |
| PATCH /classes/{id}/sessions/bulk | 선택 날짜/강사/취소/이후 이동/한 주 밀기. 1요청·1트랜잭션 |
| POST /classes/{id}/sessions | 정규/보강 1회 추가. 보강 대상 회원 명시 |
| POST /classes/{id}/roll-forward | 관리 권한자의 rolling 보충, cron과 같은 멱등 함수 |
| POST /classes/{id}/transition | complete/cancel/archive/restore. 숨김은 별도 DELETE /classes/{id}(물리 삭제 아님) |
| GET/POST /classes/{id}/instructors | 강사 목록/추가. 같은 센터 active counselor |
| PATCH/DELETE /classes/{id}/instructors/{user_id} | 역할 변경/soft-remove. guest 일반 강사 전환도 명시 동작 |
| POST /classes/{id}/sessions/{session_id}/host-requests | 관리자의 변경 요청 또는 본인 양도 요청. 부모 일치 확인 |
| POST /classes/{id}/sessions/{session_id}/host-requests/{request_id}/resolve | approve(양도 요청을 관리자 처리)/accept/reject/cancel. 상태별 권한 분리 |
| POST /classes/{id}/sessions/{session_id}/host-correction | 완료 후 승인 전 정정 또는 승인 후 표시 메모, mode 명시 |
| GET/POST /classes/{id}/members | 최소 회원 목록/즉시 초대. 권한 있는 강사·센터 관리자 |
| POST /classes/{id}/email-invites, POST /classes/{id}/email-invites/{invite_id}/retry | 이메일/CSV 요청과 실패만 재시도 |
| POST /classes/resolve-code | 기존 시도 제한으로 부모·공개 일정 해석. 회원 개인정보 목록 없음 |
| POST /classes/{id}/join | 인증 회원 코드 가입, 코드 검증과 같은 부모 일치 필요. 코드만으로 본문 접근 권한을 주지 않음 |
| POST /classes/{id}/sessions/{session_id}/observe | class-team-v1 적용 범위 확인, 읽기 전용 참관 토큰 |
| GET /classes/reassignment-queue | 같은 센터 관리자의 미해결 명상 회차 메타. 24h 우선 정렬 |
| 기존 /sessions/{id}·전이·입장·리포트/기록 API | 엔진 유지, action 권한과 부모 코드 해석·고지 게이트 적용. 생성/복제 우회도 통합 부품 경유 |

- 정적 경로 preview-schedule/resolve-code/reassignment-queue를 `/{class_id}`보다 먼저 등록한다.
- GET /classes/{id}에 revision·draft_schedule(관리자만)·rules·ends_on·capabilities를 추가한다. 회원에는 draft·코드·강사 내부 목록·변경 요청 없음.
- host/next_session.host의 nullable 변경은 서버 스키마·FE DTO·adapter·리플레이에 동시 반영. old FE는 신규 편성 활성화 전까지만 사용한다. 구 데이터 보존을 위해 placeholder host를 넣지 않는다.
- 신규 UI에서도 ID는 ClassId/SessionId로 분리. 회원 회차 선택은 실제 SDD-215 계약 `?sessionId=` 사용. `?session=`을 새로 발행하지 않는다.

### 3.2 독립 모듈 인터페이스

| 소유 | 인터페이스(새 설계) | 계약 |
|---|---|---|
| S | `expand_schedule(input: ScheduleInput, now: datetime) -> list[ScheduleRow]` | 순수 함수, preview/create/duplicate/rolling 공용 |
| S | `detect_conflicts_bulk(db, rows, exclude_ids, viewer) -> list[ConflictItem]` | commit 없음, SQL 후보 조회+내부 비교+비공개 projection |
| S | `build_bulk_changes(current_rows, command) -> list[ScheduleRow]` | 변경 범위·+7일·override·금지 상태 검사 |
| I | `validate_instructor(db, cls, user_id, session_id=None) -> ClassInstructor` | active 계정·membership·scope, commit 없음 |
| I | `apply_host_request(db, cls, session, command, actor, now) -> HostChangeResult` | 호출자가 잠금 소유, 이력·chat host·effect 의도 반환, commit 없음 |
| I | `mark_needs_reassign(db, user_id, class_ids, now) -> list[ReassignmentResult]` | 명상만, 반복 호출 멱등, 과거 host/숨김 불변 |
| B | `create_class(db, actor, command) -> ClassWriteResult` | 외부 트랜잭션 진입점, S/I 부품 조합·전체 commit 1회 |
| B | `roll_forward(db, class_id, now) -> RollForwardResult` | 생성 커서·클래스 잠금·active 회원 expected·effects |
| B | `authorize_class_action(db, actor, cls, action)` 및 기존 `authorize_session` | 권한 1곳에서 판정, 읽기·편집·진행·원문 분리 |
| F | `previewClass`, `createClass`, `publishClass`, `previewBulk`, `updateClassSessions`, `requestHostChange`, `resolveHostRequest` | 위 API와 1:1, ID 구분·AbortSignal·에러 코드 타입화 |

## 4. 파일 소유 표

**원래 병렬 구현 소유권 표다. 이번 로컬 BE 실행은 B가 S/I 경로도 순차 소유하고, 보조 리뷰는 읽기 전용으로 수행한다.** 트랙마다 별도 워크트리. 같은 파일 수정 금지. 새 발견 경로는 통합 담당 B/F가 이 표에 먼저 배정한다. 기존 파일은 그대로 이름을 쓰며 신규 Python 모듈은 저장소의 snake_case import 관례를 따른다.

| 트랙/단일 담당 | 독점 경로 | 책임 |
|---|---|---|
| B BE 통합·DB | `backend/alembic/versions/` 전체(새 리비전 1명), `backend/app/models/class_program.py`, `backend/app/models/session.py`, `backend/app/models/session_parent.py`, `backend/app/models/user.py`, `backend/app/models/__init__.py`, 신규 `backend/app/models/class_scheduling.py` | 가산 스키마·유일성·기본값 |
| B | `backend/app/services/agent_llm.py`, `backend/app/services/agent_service.py`, `backend/app/services/session_service.py`, `backend/app/services/agent_checkin.py`, `backend/app/config.py`, `backend/app/schemas/session.py`, `backend/app/api/v1/session.py` | 공유 파일은 B만. AI·생성·입장·전이 연동. 불필요한 파일은 수정하지 않음 |
| B | `backend/app/services/class_read_service.py`, `backend/app/services/session_authz.py`, `backend/app/services/admin_service.py`, `backend/app/services/org_service.py`, `backend/app/services/org_management_service.py`, `backend/app/services/membership_service.py`, `backend/app/services/chat_service.py` | 부모 읽기·권한·정지/삭제·소속 해제·채팅 |
| B | `backend/app/services/report_service.py`, `backend/app/services/record_service.py`, `backend/app/services/report_pdf_service.py`, `backend/app/services/report_email_service.py`, `backend/app/services/report_progress_service.py`, `backend/app/services/report_comment_service.py`, `backend/app/services/export_service.py`, `backend/app/services/video_service.py`, `backend/app/services/class_audio_service.py`, `backend/app/services/agent_policy.py` | D-05/D-28·본문 우회·진행자 변경 권한 |
| B | `backend/app/api/v1/classes.py`, `backend/app/api/v1/reports.py`, `backend/app/api/v1/records.py`, `backend/app/api/v1/data_exports.py`, `backend/app/api/v1/video.py`, `backend/app/schemas/class_parent.py`, 신규 `backend/app/schemas/class_scheduling.py`, `backend/app/ws/session_live_namespace.py` | REST·응답·WS 경계 |
| B | `backend/app/services/class_code_service.py`, `backend/app/services/class_code_reissue.py`, `backend/app/services/notification_service.py`, `backend/app/services/reminder_service.py`, `backend/app/services/session_terms.py`, `backend/app/services/session_email_invite_service.py` | 코드·알림·리마인더·문구 통합 |
| B | 신규 `backend/app/services/class_write_service.py`, `backend/app/services/class_membership_service.py`, `backend/app/services/class_effect_service.py`, `backend/app/services/class_access_service.py`, `backend/app/services/class_rolling_service.py` | 트랜잭션·멤버·effects·권한·롤링 |
| B | 신규 `backend/class_rolling_cron.py`, `backend/class_operations_cron.py`, `backend/app/tasks/class_operations_task.py`; 기존 `backend/app/core/celery_app.py`, `backend/app/tasks/reminder_task.py`, `backend/app/tasks/outbox.py` | cron·작업 등록·재처리 |
| B | `.github/workflows/ci-feature.yml`, `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml` | PG 차단 게이트·향후 cron 등록. 실제 배포는 승인 후 |
| B | 신규 `backend/tests/test_sdd216_integration.py`, `backend/tests/test_sdd216_access.py`, `backend/tests/test_sdd216_members.py`, `backend/tests/test_sdd216_effects.py`, `backend/tests/test_sdd216_rolling.py`; 기존 `backend/tests/test_sdd214_read_api.py`, `backend/tests/test_sdd214_create_path.py` | 공유 서비스 단위/회귀 테스트·의도 계약 변경 |
| S BE 편성 계산 | 신규 `backend/app/services/class_schedule_service.py`, `backend/app/services/class_conflict_service.py`, `backend/tests/test_sdd216_schedule.py`, `backend/tests/test_sdd216_conflicts.py` | 순수 생성·배정·일괄 변환·SQL 충돌. 기존 공유 파일 수정 없음 |
| I BE 강사 규칙 | 신규 `backend/app/services/class_instructor_service.py`, `backend/tests/test_sdd216_instructors.py` | 추가/제거·수락·guest·needs_reassign 부품. 정지 API 연결은 B |
| F FE 공통·권한 | `frontend/src/App.tsx`, `frontend/src/lib/api/client.ts`, `frontend/src/lib/api/class-structure.ts`, `frontend/src/lib/api/session.ts`, `frontend/src/lib/api/class-flow.ts`, `frontend/src/lib/api/notifications.ts`, 신규 `frontend/src/lib/api/class-scheduling.ts` | 라우트·타입·서버 오류·실제 전송 취소·알림 |
| F | `frontend/src/lib/class-structure/{read-model,adapters,navigation}.ts`, `frontend/src/hooks/use-class-structure.ts`, 신규 `frontend/src/hooks/use-class-scheduling.ts`, `frontend/src/lib/class-structure/scheduling-model.ts` | 데이터 수명·API contract·계정 전환 |
| F | `frontend/src/components/class/structure/{structure-shell.tsx,structure-shell.css,read-state.tsx}`, `frontend/src/components/layout/{SidebarNav,AppShell,BottomTabBar}.tsx`, `frontend/src/components/client/{ClientShell,BottomTabBar}.tsx`, `frontend/src/lib/terms.ts` | 히어로/사이드바 공통 토큰·용어·셸 |
| F | `frontend/src/components/class/flow/member/NoticeStepView.tsx`, `frontend/src/lib/class/flow/member-prep.ts`, `frontend/src/hooks/useEntryPrep.ts`, `frontend/src/pages/reports/{ReportListPage,ReportDetailModal}.tsx`, `frontend/src/pages/records/SessionRecordPage.tsx`, `frontend/src/pages/sessions/ClassPlayerPage.tsx` | 고지·D-28 UI·참관 화면. 엔진 제어 권한 서버 연동 |
| F | `frontend/src/pages/client/member-class-detail-page.tsx`, `frontend/src/components/class/structure/member-class-views.tsx`, `frontend/src/pages/client/member-structure-home-page.tsx`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/pages/OrgDashboardPage.tsx`, `frontend/src/pages/notifications/NotificationCenterPage.tsx`, `frontend/src/pages/client/ClientNotificationPage.tsx` | sessionId 소비·오늘 영역 칩·재배정 큐·알림 |
| F | 신규 `frontend/tests/class-scheduling-data.test.ts`, `frontend/tests/class-team-access.test.tsx`; 기존 `frontend/tests/class-structure-data.test.ts`, `frontend/tests/class-structure-navigation.test.ts`, `frontend/tests/terms-guard.test.ts`, `frontend/tests/class-flow-shell-terms.test.ts` | 타입·수명·권한·공통 회귀 |
| H FE 편성 | 신규 `frontend/src/pages/classes/class-create-page.tsx`, `frontend/src/components/class/scheduling/` 전체, 신규 `frontend/tests/class-scheduling-wizard.test.tsx`, `frontend/tests/class-schedule-editor.test.tsx` | CH10~15·CH20, 공용 표/카드/시트. 외부 공통 CSS 수정은 F 요청 |
| O FE 운영 | 기존 `frontend/src/pages/classes/{host-classes-page,host-class-detail-page}.tsx`, `frontend/src/components/class/structure/host-class-views.tsx`, `frontend/src/pages/sessions/SessionDetailPage.tsx`, 신규 `frontend/src/components/class/operations/` 전체 | CH01~04·CH06·CH30, H 편집 컴포넌트 소비 |
| O | 신규 `frontend/tests/class-operations.test.tsx`; 기존 `frontend/tests/host-class-structure.test.tsx` | 운영·상태·강사 변경·멤버 최소 탭 |
| Q 독립 QA | 신규 `backend/tests/pg/test_sdd216_schema.py`, `backend/tests/pg/test_sdd216_atomicity.py`, `backend/tests/pg/test_sdd216_conflicts.py`, `backend/tests/pg/test_sdd216_reassignment.py`, `backend/tests/pg/test_sdd216_races.py` | PG 제약·원자성·동시성, 제품 파일 수정 금지 |
| Q | 신규 `frontend/e2e/class-scheduling/` 전체, `specs/sdd-216-class-structure-phase3/evidence/` | 리플레이·실제 로컬 BE E2E·캡처·manifest·실패 증거 |
| 문서 담당 | 현재 `specs/sdd-216-class-structure-phase3/spec.md`, `specs/sdd-216-class-structure-phase3/plan.md`, `specs/sdd-216-class-structure-phase3/verify.md`; 향후 `specs/sdd-216-class-structure-phase3/api-contract.md`, `specs/sdd-216-class-structure-phase3/summary.md`, `specs/sdd-216-class-structure-phase3/release-checklist.md`(이 폴더) | 추적성·미확인·출시별 결과 |

- 같은 테스트를 서로 고치지 않는다. Q는 독립 PG/E2E 테스트만 소유하고 단위 테스트 실패는 담당자에게 전달한다.
- 디자인 원본·과거 SDD 문서·기존 banned 파일은 수정 대상이 아니다. 다른 BE API/WS 구독 경로가 발견되면 B 소유로 명시 추가하고 누락 없이 D-28를 적용한다.
- 단위 파일명이 현재 없으면 신규, 실제 경로가 다르면 T01에서 문서의 해당 행을 코드와 맞춘 뒤 수정한다. 광범위 문자열 치환 금지.


### 로컬 실행의 추가 독점 경로

- B: `backend/app/services/class_operations_service.py`, `backend/tests/pg/sdd216_helpers.py`, `backend/tests/pg/test_sdd216_*.py` 전체. 편성/강사 신규 서비스도 B가 순차 구현하며 같은 워크트리에서 동시 쓰기 없음.
- B: `backend/tests/pg/test_sdd214_schema.py`, `backend/tests/pg/test_sdd214_create_path.py`, `backend/tests/pg/test_pg_migration_schema.py`. 053~055의 역사적 스키마 테스트와 최신 모델 테스트를 분리하고 D-30 기대값을 반영한다.
- B: `backend/app/api/v1/notifications.py`, `backend/app/schemas/notification.py`. 임박 변경 푸시 수신 선호의 가산 계약.
- B: `backend/tests/contract/golden/sessions_openapi.json`, `backend/tests/test_data_exports.py`, `backend/tests/test_mb2_low_fixes_7th.py`, `backend/tests/test_report_email.py`, `backend/tests/test_sdd026_live_session_p0.py`. host nullable 계약, 오프라인 PG 방언, 실제 승인자 fixture, 참관 이벤트 투영을 검증한다.
- B: `backend/app/services/dev_data_reset.py`, `backend/tests/test_sdd214_reset_guards.py`. 신규 테이블의 범위 분류만 추가하며 실제 초기화는 실행하지 않는다.
- B: `backend/tests/test_sdd209_b2_report_choice.py`, `backend/tests/test_sdd209_b11_research_consent.py`, `backend/tests/test_sdd210_ci_gates.py`, `backend/tests/test_sdd211_migration_30c1_idempotent.py`, `backend/tests/test_sdd211_session_role_guard.py`, `backend/tests/test_sdd211_member_report_visibility.py`, `backend/tests/test_sdd211_authz_characterization.py`. 고지 버전 fixture·가산 head·D-28 권한 변경 회귀를 담당한다.
- 문서: 이 폴더의 `api-contract.md`, `summary.md`, `release-checklist.md`. `verify.md`는 구현 전 게이트 원본을 유지하며 실행 결과를 덮어쓰지 않는다.

## 5. Task 분해·TDD

총 **40개 Task(T00~T39)**. 각 구현 Task는 아래 5단계를 개별 수행한다. 테스트 이름·입력·정확한 기대값은 verify의 연결 행이 정본이다.

- [ ] RED: 연결 시나리오의 실패 테스트를 소유 테스트 파일에 작성한다.
- [ ] 실행: 해당 파일/테스트만 실행해 기능 부재에 의한 실패를 확인한다. 환경 실패는 RED로 세지 않는다.
- [ ] GREEN: §2~3 인터페이스·값으로 최소 구현한다. 내부 commit·권한 우회·가짜 응답을 추가하지 않는다.
- [ ] 재실행: 같은 테스트 통과 후 해당 모듈 회귀·타입/린트를 확인한다.
- [ ] 정리·검토: 중복 제거, 파일 경계 확인, 검토 근거 기록. 커밋·외부 반영은 실행 시 승인 범위에 따른다.

| Task | 담당·선행 | 테스트로 고정할 입력→결과 / 산출 | 검증 연결 |
|---|---|---|---|
| T00 | 문서 / 없음 | 구현 전 승인 기록·시작 SHA·dirty·경계 확인. 미승인이면 실행 중단 | DOC-01 |
| T01 | B/F/Q / T00 | 현 코드 계약·경로·기준선 확보, api-contract·소유 표·fixture 고정. 테스트 전후 비교 가능 | V-01, V-44 |
| T02 | B / T01 | 055→새 head 및 빈 PG 체인, 추가 컬럼·유일성·기존 복합 FK 확인 | V-02~03 |
| T03 | S / T02 | 월=1·skip·격주·KST·8회 후보·28일·종료일 → 결정적 목록 | V-10~11 |
| T04 | S / T03 | 4종 배정·보강 제외 rotate·수동 override → 정확한 host 배열 | V-12 |
| T05 | B / T02 | 클래스/단건 동시 코드 발급·0042·공간 소진·종료 코드 → 중복 0/503 | V-04~06 |
| T06 | S / T03 | DB·요청 내부·명상/상담·경계 맞닿음·긴 회차·비공개 상대 → 전체 충돌/마스킹 | V-13~15 |
| T07 | B / T02~06·T12 | 중간 5번째 insert 예외·commit 실패 → 클래스/회차/코드/effects 0, 성공 8개 | V-07 |
| T08 | B / T07 | 같은 제출 키 재시도·다른 payload·브로커 실패 → 중복 0/409/재처리 | V-08~09 |
| T09 | B / T07 | 미정 draft 저장·재개·publish·원본 패턴 복제 → draft 회차 0, 공개 전 필수 검사 | V-35~36 |
| T10 | S/B 순차 / T06~09 | bulk 전후 미리 보기·+7일·한 행 금지 상태 → 원자 적용/전부 409 | V-37~38 |
| T11 | B / T10 | 정규 추가·보강 추가·seq 유지·취소 분모 → 정확한 집계·자동 보충 0 | V-39 |
| T12 | I / T02 | 강사 add/remove/lead·재추가·동시 마지막 lead 제거 → 유일성/409 | V-16~17 |
| T13 | I / T12 | 61분 즉시/60분 수락·15분 만료·중복 요청·본인 양도 → 상태표 일치 | V-18~20 |
| T14 | I/B 순차 / T13 | 동일 센터 guest·두 scope 충돌·14일/승인 만료·scope NULL → 제한 권한 | V-21 |
| T15 | B / T13 | host 변경과 chat/이력/AI·알림·리마인더 → 동일 커밋/오류 전부 롤백 | V-22 |
| T16 | B / T15 | completed 정정과 리포트 승인 동시 요청 → 한 쪽만 성공, 승인 후 메모만 | V-23 |
| T17 | I/B 순차 / T12~16 | 플랫폼/기관 정지·삭제·강제 해제·재활성화 → 명상 needs_reassign/숨김 0/자동 복귀 0 | V-24~25 |
| T18 | B / T15 | action별 주강사·보조·guest·회원·센터·타 센터 → 권한표 일치 | V-26~28 |
| T19 | B / T18 | D-05 버전·미확인·일부 고지 누락·참관 토큰/WS → 고지 전 확대 0/EEG·제어 0 | V-29~31 |
| T20 | B / T18 | D-28 명상 읽기/쓰기·상담 본문·PDF/발송/WS·기관 이동 → 경계 동일 | V-32~34 |
| T21 | B / T07·T18 | 초대 중복·중간 합류·정원 경합·코드 가입 → active 1·미래 expected만 | V-40~41 |
| T22 | B / T21 | 이메일/CSV 중복·형식·일부 전달 실패·재시도 → 클래스별 1요청, 동의/신원 자동 연결 0 | V-42 |
| T23 | B / T17·T21 | 02시 cron+상세 보충 동시·시간 경과·removed 규칙 → 중복 0/4주/needs_reassign | V-45~46 |
| T24 | B / T11·T23 | 완료·마무리·취소·보관·정규 재개·open 경합 → 코드/멤버/알림 정합 | V-47~48 |
| T25 | B / T08·T17·T22 | class/events 선호·7일/60분·72h/24h·과거 ETA → 올바른 수신/중복 0 | V-49~51 |
| T26 | Q/B / T02~25 | 독립 PG 4대 게이트·두 연결 경합·로컬 API 통합·BE 출시 체크리스트 | V-02~51 중 BE, V-52 |
| T27 | B / T26·출시 승인 | 1차 BE 배포·마이그레이션·cron off→스모크→on, 팀 열람 off 유지 | V-53 |
| T28 | F / T27 | actual API와 DTO·host nullable·요청 취소·계정 전환·operation key → 안전한 데이터 계층 | V-54~55 |
| T29 | F / T28 | 공통 셸 히어로/사이드바·용어·고지 버전·관리자 버튼·오늘 영역 칩 | V-29, V-32, V-56, VR-01 |
| T30 | H / T28~29 | CH10/11/12 입력·복제·skip·미저장 → 4단계 진입/서버 preview | V-57, VR-02 |
| T31 | H / T30 | CH13 4배정·미정 draft·서버 충돌 → 다음 차단/초안 가능 | V-58, VR-02 |
| T32 | H / T31 | CH14/15 초대·용량·중복 제출·일부 실패 → 확정 1클래스/실패만 재시도 | V-59, VR-02 |
| T33 | H / T31 | CH20 표/카드·선택·편집 시트·전후 확인 → 같은 모델/1회 bulk 요청 | V-60, VR-03 |
| T34 | O / T29·T33 | CH01~04/06/30 운영·강사 변경·최소 멤버·설정·축소 상세 → 새 경로 연결 | V-61~62, VR-01, VR-04 |
| T35 | F / T34 | 참관·D-05 고지·D-28 UI·알림·회원 sessionId·no-band → 실제 API와 회귀 | V-63~65 |
| T36 | Q / T35 | 전체 시안 case 리플레이·4뷰포트·원본/앱/diff/overlay·보완 상태 | VR-01~06 |
| T37 | 각 소유/Q / T36 | 실패별 수정·동일 입력 재실행·로컬 BE+FE E2E·실기기 결과 분리 | V-66, VR-05~06 |
| T38 | F/B / T37·출시 승인 | 2차 FE 배포·권한/고지 검증 후 팀 열람 on, 실패 시 off | V-67 |
| T39 | 문서/Q / T38 | summary에 BE/FE SHA·실행 수·기존 실패·미확인·사용자 최종 리뷰 기록 | DOC-06 |

- T02의 migration test, T26의 독립 QA, T27/T38 출시, T39 보고는 코드를 먼저 만드는 TDD Task가 아니라 승인·검증 Task다.
- 미래 구현에서 T10/T14/T17처럼 두 담당이 적힌 Task는 **S/I가 자기 신규 모듈을 끝낸 뒤 B가 공유 파일을 연결하는 순차 작업**이다. 공동 편집을 뜻하지 않는다.

## 6. 병렬 트랙·인수 순서

| 구간 | 병렬 가능 트랙 | 선행·인수 | 직렬화 대상 |
|---|---|---|---|
| 계약 | B/F/Q 읽기 검토 | T01 contract·소유 경로 고정 | 문서 반영은 문서 담당 1명 |
| BE 부품 | S 반복·충돌 / I 강사 / B 스키마·코드·원자 생성 | B 스키마/DTO 인터페이스 배포 후 각 전용 워크트리 | session_service·권한·알림·마이그레이션은 B |
| BE 연결 | B | S/I 결과·단위 테스트 인수 | 기존 공유 파일 동시 수정 없음 |
| PG QA | Q | 인터페이스 확정 후 테스트 작성 가능, 최종 실행은 통합본 | Q 제품 코드 수정 없음 |
| 1차 출시 | B | PG·권한·API 통과 + 출시 승인 | BE 1차가 끝나기 전 제품 FE 구현을 시작하지 않음 |
| FE | H 마법사/표 / O 운영 / F 공통·권한 | F API/셸 고정, O는 H 공용 편집기 계약 인수 | 공통 CSS·App.tsx·API/terms는 F |
| FE QA·2차 출시 | Q 검증 → 담당 수정 → F/B 출시 | 실제 로컬 API 통합 + 시안 차이 해소 + 출시 승인 | 배포/스위치 조작은 지정 담당 순차 |

- 브랜치는 `sdd/216-be`, `sdd/216-fe` 등 규칙에 맞추고 각 출시 단위 안에서 통합 PR을 만든다. BE와 FE는 서로 다른 출시 순서로 인수한다. **이번 작업에서는 브랜치/워크트리/PR 생성·push·머지하지 않는다.**
- 1차 BE의 리뷰 가능한 산출물: API 계약·PG 결과·권한 매트릭스·cron 설정 변경안·롤백 절차. 2차 FE: 시안 비교 manifest·실제 서버 E2E·고지 문구·스위치 활성화 검증.

## 7. 마이그레이션·배포 순서 ① BE ② FE

### ① BE

1. 승인 후 현재 head·미적용 리비전·dirty 상태 확인. 기존 테스트 데이터 보존용 백필·reset·삭제 없음.
2. 로컬 폐기용 PG에서 빈 DB 전체 체인, 055 합성 데이터 업그레이드, FK·원자성·경합·코드 유일성 검증. 새 head 1개.
3. preview/생성/강사/코드/멤버/권한/알림 구현. 실제 메일·푸시 어댑터는 검증 중 모의 처리.
4. `CLASS_SCHEDULING_ENABLED=false`, `CLASS_ROLLING_ENABLED=false`, `CLASS_TEAM_READ_ENABLED=false` 기본으로 코드/가산 스키마 배포 준비. D-28은 기능 스위치와 관계없이 적용한다.
5. 별도 출시 승인 후 BE 배포 → migration → API 읽기·D-28 스모크 → 편성 스위치 on → 직접 API 합성 스모크 → rolling cron on. FE 노출이 없어도 API로 8회 생성·변경 검증 가능해야 한다.
6. cron: rolling 매일 02:00 KST, class_operations 매분(수락 마감·72h/24h·effects·guest 만료). 실제 서버 TZ를 확인하고 02:00 KST를 UTC 17:00 전일로 중복 등록하지 않는다.
7. 관찰: 실패 effects·생성 지연·needs_reassign·알림 재시도 건수. 처리 건수를 운영 성능 수치로 꾸미지 않는다.

### ② FE

1. 배포된 BE 계약을 고정한 뒤 T28 시작. 위저드·편집·운영·D-05 고지·D-28 UI를 구현한다.
2. 합성 API 리플레이와 별도로 localhost BE+PG 실연동 E2E를 통과한다. 외부 전달은 계속 모의 처리한다.
3. 4뷰포트 전체 case와 시각 차이를 검증한다. 사용자 문구·후속 제외 차이는 manifest에 남긴다.
4. 별도 출시 승인 후 FE 배포. class-team-v1 실제 표시·저장·권한 제한 검증 후 CLASS_TEAM_READ_ENABLED on. 기존 고지 자료는 계속 제외한다.
5. 클래스 생성→8회 배정→초대→회원 일정→진행자 교체→참관→취소/보강→정지/재배정 경로를 승인된 테스트 계정으로 확인한다. 현재 문서 작업에서는 접속하지 않는다.

### 실패·복구

- 생성/변경 DB 실패: 트랜잭션 롤백, 외부 전달 0. 커밋 이후 전달 실패: 같은 effect/초대 재처리, 클래스 재생성 금지.
- FE 실패: 새 편성 진입과 팀 열람을 끄고 이전 FE로 복귀. BE의 D-28 축소·생성 데이터·새 권한 검사는 유지한다. 구 FE가 다회차/nullable host를 완전히 표시한다고 보장하지 않는다.
- BE 실패: 편성·롤링·팀 열람 스위치 off, class_operations는 미결 요청 만료/전달 정리 범위로 유지. D-28를 되돌리는 구 BE 전체 revert 금지. 보안 수정이 유지된 BE 빌드로 복귀하거나 전진 수정한다.
- DB downgrade·데이터 reset·삭제를 정상 복구로 사용하지 않는다. 이전 코드가 새 스키마·코드 해석을 수용하는지는 로컬 시험 후만 보고한다.

## 8. 테스트 실행 계획

아래는 **구현 승인 후 실행할 명령**이다. 신규 테스트 파일은 현재 없다. 이번에는 문서 정적 검증만 수행한다. 환경 변수는 로컬 합성 PG만 사용하며 `.env`/시크릿을 출력하지 않는다.

```bash
# 저장소 루트: 파일 그래프 확인
python3 scripts/check-alembic-heads.py

# backend: Task 소유 파일별 먼저 실행, 예시
python -m pytest tests/test_sdd216_schedule.py tests/test_sdd216_conflicts.py -q
python -m pytest tests/test_sdd216_instructors.py -q
python -m pytest tests/test_sdd216_integration.py tests/test_sdd216_access.py -q
python -m pytest tests/test_sdd216_members.py tests/test_sdd216_effects.py tests/test_sdd216_rolling.py -q
python -m pytest tests/test_sdd214_read_api.py tests/test_sdd214_create_path.py -q

# backend: DATABASE_URL이 localhost 폐기용 PG로 검증된 환경에서만
python -m alembic upgrade head
PG_SMOKE=1 python -m pytest --confcutdir=tests/pg tests/pg -q -m pg -p no:cacheprovider

# frontend
npx vitest run tests/class-scheduling-data.test.ts tests/class-team-access.test.tsx
npx vitest run tests/class-scheduling-wizard.test.tsx tests/class-schedule-editor.test.tsx tests/class-operations.test.tsx
npx vitest run tests/class-structure-data.test.ts tests/class-structure-navigation.test.ts tests/terms-guard.test.ts tests/class-flow-shell-terms.test.ts
npx playwright test --config=e2e/class-scheduling/playwright.config.ts
npm run build
npm run lint
npm test -- --run
```

- B/Q는 PG 필수 4대 시나리오를 CI 차단 단계로 실행한다. PG skip은 통과가 아니다. 2연결 동시성 테스트는 단일 savepoint fixture로 대신하지 않는다.
- 단위 테스트의 SQLite 통과는 CHECK/FK/행 잠금 증거가 아니다.
- 전체 backend 회귀는 T01에서 확인한 현재 CI 명령·제외 사유를 그대로 기록하고 T26에서 비교한다. 이전 summary의 3024/77·1874/11 같은 건수를 이번 결과로 쓰지 않는다.
- SDD-215 리플레이 방식: 로컬 앱 + designs 상위 루트 정적 시안 서버, 합성 역할/API·고정 시계·외부 네트워크 차단. 신규 config는 두 프로젝트 `replay`/`local-api`로 분리한다. 로컬 API 프로젝트만 합성 PG를 사용한다.
- capture 산출 경로는 Q의 evidence 아래 실행별 SHA 디렉터리. 원본 시안 수정·앱을 정답 스크린샷으로 자동 승인 금지.
- 브라우저·픽셀·PG·실제 서비스·실기기는 별도 결과로 기록한다.

## 9. 이번 문서 완료 검증

- spec 첫 줄 고정, 세 파일 존재, 사용자 결정 표가 spec 마지막 절인지 확인.
- 실제 파일 근거·신규 설계 구분, Task/시나리오 ID 중복·참조 누락 0, Phase 3 요구의 spec→Task→Verify 연결 확인.
- 파일 소유 표는 prefix·brace 표기를 풀어 중복 소유 0 확인. 실제 존재하지 않는 기존 경로는 수정한다.
- `git diff --check` 및 지정 3파일만 stage했는지 확인 후 `feat(sdd-216): 클래스 편성·강사 구현 전 문서 작성` 로컬 커밋.
- push·배포·삭제·메일·머지·구현 테스트 실행 없음. 최종 보고는 커밋·3파일·Task/시나리오 수·정책 결정·미확인으로 구성한다.
