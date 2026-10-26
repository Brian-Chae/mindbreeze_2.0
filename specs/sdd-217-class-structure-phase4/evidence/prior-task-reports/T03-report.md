# T03 구현 보고 — 출석·실제 입장·현재 접근 회수

- 경로: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`, 브랜치 `sdd/217-class-structure-phase4`.
- 승인 범위 T03/R2/V07~10 및 인계된 R1/V36. 기존 T00~02 변경 보존. 스키마·마이그레이션·모델 수정 없음. 하위 에이전트·커밋·푸시·배포 없음.
- TDD와 systematic-debugging, verification-before-completion 절차 적용. root의 관련 회귀 한정 지시에 따라 전체 BE 실행은 하지 않았다.

## 변경 파일

1. `backend/app/services/class_attendance_service.py` 신규: 출석 명령, canonical 참가행 선택, 회차 정원 재검사, append-only 감사, 실제 입장·정상 종료 flush 전용 훅, 현재 멤버 자격 검사.
2. `backend/app/schemas/class_membership.py`: `AttendanceCommand`(기존 T02 MemberCommand 상속, extra=forbid, 참여 버전 및 action 제한) 추가.
3. `backend/app/api/v1/class_membership.py`: 계약 그대로 attendance HTTP 추가. 과대 classes.py를 추가 수정하지 않았다.
4. `backend/app/services/session_service.py`: 코드·초대 실제 입장, 기존 로그인 join_session, 정상 end 훅 연결. entered_at/attended 멱등. 로그인 actor 및 회차 자격의 현재 멤버 자격 검사, excused의 media·WS 직접 우회 차단. 커밋 뒤 출석 가산 payload 발행.
5. `backend/app/services/class_write_service.py`: 기존 User 선행 잠금 유지, Class→ClassMember ID순→Session ID순 잠금 정렬. User는 `FOR NO KEY UPDATE`로 변경(아래 실제 deadlock 원인).
6. `backend/app/services/class_member_commands.py`, `backend/app/services/class_code_service.py`: User 선행 잠금을 같은 `FOR NO KEY UPDATE`로 정렬. 이 두 파일은 T02 기존 변경 위의 **User 잠금 한 줄씩만 추가 변경**했다.
7. `backend/app/services/class_access_service.py`: 기존 reconcile_observers 소비가 observer와 일반 participant UUID/legacy user UUID identity의 현재 자격을 검사하고 회수. 유효 호스트는 보존. 기존 malformed non-observer 문자열은 기존 동작과 같이 무시.
8. `backend/app/services/class_effect_service.py`: live_access_reconcile 의도에서 room 유무와 무관하게 해당 회차 WS 룸 재검사 후 LiveKit 회수 소비. 외부 실패의 기존 pending/backoff 재시도 유지.
9. `backend/app/ws/session_live_namespace.py`: 기존 `_refresh_instructor_rooms`가 participant도 검증하고 all/self 룸을 제거. 실제 join 권한 검사와 룸 등록 사이 제외 커밋도 등록 직후 재검사.
10. `backend/tests/pg/test_sdd217_attendance.py` 신규: 실제 PG/HTTP/두 연결/loopback WebSocket 검증 18개(파라미터 포함).
11. 이 보고서.

## RED → GREEN 증거

- 최초 **6 failed, 1 passed**: 실제 입장 뒤 expected 유지, 정상 종료 뒤 expected 유지, 출석 서비스/HTTP 부재, 제외된 로그인 멤버의 actor 해석 허용, 일반 멤버 LiveKit 회수 누락. 최소 구현 뒤 **7 passed**. 최초 파일 작성 시 cwd를 중복 표기한 도구 오류(no tests ran)는 경로 정정 후 정상 RED와 분리했다.
- legacy join_session 출석 미전이와 기존 WS refresh가 participant를 건너뛰는 추가 RED **2 failed** → 해당 경로 연결 뒤 GREEN.
- 출석 커밋 이벤트 미발행 RED **1 failed** → 별도 participation_version과 출석 필드 가산 후 GREEN.
- excused가 participant-livekit-token/WS를 바로 호출할 수 있는 우회 RED **1 failed** → 실제 enter에서 정원 검사를 먼저 통과해야 하도록 현재 media/WS 접근에서 차단 후 GREEN. 본인 entry-state 읽기와 실제 enter의 cap 재검사 의미는 보존했다.
- 정원 축소 뒤 이미 attended인 참가자의 재접속이 session_capacity가 되는 RED **1 failed** → 실제 기록·현재 자격이 유지된 재접속을 멱등 처리 후 GREEN. left/removed→재활성화 정원 검사는 기존 T02에서 수행하며 생략하지 않는다.
- 최종 관련 회귀 중 실제 **57 passed, 1 failed**: 임의 UUID 순서에 따른 User/FK deadlock. client UUID<host를 고정하여 **1 passed, 1 failed**로 결정적 재현 후 아래 수정. User 잠금 SQL이 바뀐 뒤 계측이 `FOR UPDATE` 문자열만 감지하던 테스트 실패2개는 `FOR NO KEY UPDATE`도 감지하도록 계측 정정했고, 제품 실패와 분리했다.

## 실제 deadlock 원인과 최소 수정

- 실제 로컬 PG server.log에서 entrant의 `SELECT users ... ORDER BY users.id FOR UPDATE`와 remover의 `UPDATE class_members SET entry_ver=1 ...` 사이 양방향 transaction ShareLock 대기를 확인했다. 합성 PG의 class_members→users FK 및 AFTER UPDATE `RI_FKey_check_upd` 트리거도 직접 조회했다.
- remove 선행이 호스트 User·Class·members를 보유한다. entrant는 ID가 작은 client User를 먼저 잠근 뒤 host User를 기다린다. remover의 동일 트랜잭션 내 멤버 재갱신에서 user FK KEY SHARE를 얻으려 하면 entrant의 client FOR UPDATE와 충돌하여 순환 대기가 생긴다. 직접 User 선행 잠금을 삭제하는 방식으로 우회하지 않았다.
- User PK를 변경하지 않는 세 진입점만 SQLAlchemy `with_for_update(key_share=True)`로 수정했다. **read=False 기본 조합은 PostgreSQL에서 FOR NO KEY UPDATE**이며 FOR KEY SHARE가 아니다. SQL dialect compile 결과를 직접 확인했다. FK KEY SHARE와 공존하면서 User의 상태 UPDATE·삭제와는 계속 충돌한다.
- `test_user_no_key_update_still_serializes_account_deactivation`에서 실제 연결1의 잠금 동안 연결2의 User.status UPDATE가 시작 후 대기하고, 연결1 커밋 뒤에만 비활성화되는 것을 확인했다.

## 실행 명령과 최종 출력

Python은 기존 read-only venv를 실행만 했다. 실제 서비스 env/비밀값 사용 없음. 로컬 테스트 전용 PG이며 scratch_db는 별도 빈 DB마다 `alembic upgrade head` 후 끝에 해당 DB만 정리한다. 공유 PG 중지·재시작 없음.

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg \
 tests/pg/test_sdd217_attendance.py tests/pg/test_sdd217_membership.py \
 tests/pg/test_sdd216_entry.py tests/pg/test_sdd216_lifecycle.py \
 tests/pg/test_sdd216_observer.py tests/pg/test_sdd216_members.py -q --tb=short
# 59 passed, 4 warnings in 8.51s
```

신규18 + 기존 관련41. warning은 passlib crypt와 실제 loopback WebSocket을 실행하며 드러난 기존 uvicorn/websockets API deprecation 3개다. 외부 실패/미확인 테스트를 PASS로 계산하지 않았다.

```bash
DATABASE_URL=sqlite:// \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest tests/test_sdd024_session_live_ws.py \
 tests/test_sdd209_b5a_entry.py tests/test_sdd209_i2_entry_times.py -q --tb=short
# 33 passed, 6 warnings in 5.77s
```

SQLite 실행은 마지막 User 잠금 강도 조정 직전의 실제 WS·guest 입장·시각 회귀다(PostgreSQL 잠금 효과 증명으로 해석하지 않음). warning은 기존 crypt/argon2/HTTP422 deprecation. 최종 `git diff --check` 및 변경 Python 11파일 `ast.parse` PASS. black/ruff/autopep8 미설치로 포맷터 통과를 주장하지 않는다.

## Verify별 증거

- **V07 PASS**: `test_v07_actual_enter_attended_once_not_invite_or_checkin`, `test_v07_legacy_join_records_attended_and_rejects_removed`. 초대·체크인만으로 출석 아님, 실제 enter와 legacy join에서 entered_at+attended를 저장. 반복 입장 시 시각·참여 버전 불변. 대기자는 실제 참석으로 표시하지 않음. `test_attended_reenter_is_idempotent_after_capacity_shrink`는 기존 참석자 멱등 재접속 보존.
- **V08 PASS**: `test_v08_end_only_unentered_expected[end-absent/cancel-expected]`. 실제 transition_status 정상 종료 훅과 취소 훅을 실행. expected·미입장만 absent, entered_at 있는 expected·excused·attended·withdrawn 보존. 취소에서는 expected도 유지. 취소 attended 보존은 같은 상태집합으로 확인.
- **V09 PASS**: `test_v09_excuse_return_and_direct_enter_recheck_capacity`, `test_v09_two_connections_excuse_seat_taken_before_return`. 사전 결석으로 좌석 반환 뒤 다른 참가행이 채움. 실제 독립 연결1이 좌석 점유를 잠그고 연결2 복귀가 잠금 시도 후 대기한 것을 계측, 선행 커밋 후 최신 점유로409 session_capacity. excused 상태와 미입장 유지. 실제 enter도 같은 검사. media/WS 우회 차단 테스트 추가.
- **V10 PASS**: `test_v10_http_self_forbidden_instructor_audit_and_stale`. 실제 HTTP 본인/무관 강사403, 권한 강사의 reason 없음422, 사후 정정200, 같은 operation 재시도 동일 결과, 참여버전 stale409. old/new/actor/reason 감사 및 실제 entered_at 미조작 확인. `test_v10_audit_insert_failure_rolls_back_everything`는 실제 ORM 감사 insert 실패 주입 시 상태·두 버전·감사 롤백.
- **V36 PASS (단일 WS 워커/외부 LiveKit 대역 범위)**: 제거 후 로그인 및 기존 class_entry로 actor/LiveKit 발급/WS join 거부. `test_v36_enter_remove_two_connections_serialized[enter/remove]`는 실제 PG 두 연결, client<host 고정, 양쪽 잠금 시도 후 대기 확인. 입장 먼저면 attended/entered_at 보존 후 제거, 제거 먼저면 입장403 및 미입장 보존. 두 경우 최종 멤버 removed·접근 불가. `test_v36_real_websocket_effect_consumer_revokes_room`은 실제 loopback uvicorn+Socket.IO WebSocket 클라이언트·독립 PG에서 정상 join→실제 remove→실제 ClassEffect process_effects→access_revoked 수신 및 all/self 룸 제거, done1/failed0. 같은 소비에서 LiveKit SDK 대역의 participant identity 회수 확인.

## API·T04/T05/T07 후속 인터페이스

```json
POST /api/v1/classes/{class_id}/sessions/{session_id}/members/{member_id}/attendance
{"operation_key":"UUID","expected_revision":3,"expected_participation_version":2,"action":"excuse","reason":"선택 사유"}
```

- action은 `excuse|undo_excuse|correct_attended|correct_absent|correct_excused`. 본인은 시작 전 excuse/undo만. 사후 correct는 현재 해당 회차 강사 또는 유효 클래스 lead/assistant counselor만, reason 필수. org_admin 단순 운영 권한으로는 불가.
- 응답 `{class_id,revision,participant:AttendanceDTO,participation_version}`. DTO는 원본 participant ID 및 canonical_member_id를 제공한다. 강사 correct는 entered_at을 조작하지 않는다.
- `change_attendance(...)`가 execute_member_command를 통해 commit/rollback 소유. `mark_entered(db, session, participant, now=None)`, `finalize_attendance(db, cls, session)`는 **caller locks, flush-only**. T07의 성공 guest-entry도 기존 `_mark_entered` 또는 이 함수를 같은 트랜잭션에서 재사용 가능하다. completed 멤버는 reserved 지정 makeup assignment가 있는 참가행만 현재 접근 허용한다. 보강 완료 파생/예약 취소는 T05가 소유하며 본 태스크에서 구현하지 않았다.
- `lock_participants(db, session)`는 participant ID순 FOR UPDATE. 멤버/클래스/회차 선행 잠금이 필요하다. `eligible_participant/require_eligible(..., allow_excused=True)`는 본인 entry-state 접근과 실제 입장 전 검사에 사용. media/WS는 allow_excused=False로 복귀 cap 검사를 우회하지 않는다. canonical+superseded 접근을 일관되게 검사한다.
- 출석 변화 때 Session.participation_version을 +1, 최초 entered_at만 새로 기록되는 경우도 +1. 같은 attended 재입장은 증가하지 않음. Session.state_version과 혼용하지 않는다.
- `session_service._notify_participant_changed`가 기존 호스트용 전체 participant 목록을 유지하면서 최상위 `participation_version`과 각 행의 `member_id,attendance_status,entered_at`을 가산한다. 기존 최상위 `version`은 state_version 의미를 그대로 보존했다. 출석 명령/입장/정상 종료 **커밋 후** 기존 발행 훅 호출. T04는 이 payload를 checkin/presence/canonical ID 및 잠금 아래 일관된 snapshot 구성으로 확장해야 한다. 현재 notify는 기존 best-effort 호스트 이벤트이며 T04 참여상태 snapshot API/heartbeat DB lease/갭 복구 전체를 대신하지 않는다.

## 남은 미검증·제약

- **실제 외부 LiveKit 서버/미디어 연결은 미검증**. SDK 경계의 list/remove는 대역이다. 현재 실제 접근 차단·DB 버전 폐기와 기존 effect retry 경로 연결은 검증했다.
- **다른 WS 워커 프로세스/Celery에서만 소비하는 분산 회수는 미검증이며 현재 `_sid_session_ids`가 워커 로컬이라 다른 워커 소켓을 즉시 순회할 수 없는 기존 구조 제약**이 남는다. 실제 단일 프로세스 WebSocket 회수만 PASS다. Redis 분산 제어/운영 다중 워커 회수 완료로 해석하지 않는다. 이는 후속 통합에서 소유권 결정이 필요하다.
- 체크인/presence/전체 스냅샷·보강 완료·guest 활동/읽기 grant·UI 여정은 T04/T05/T07 이후 소유. 본 태스크에서 추가 구현하지 않았다. FE·실장치·배포 미검증.
- 위 테스트 검증 완료 후 독립 리뷰는 root가 수행할 차례이며, T03 구현자가 자신의 리뷰 승인을 주장하지 않는다.

## 독립 리뷰 수정 round 1/5 — Important 2건

최초 보고의 59 passed 이후, 다음 두 finding만 수정했다. 이 절의 **66 passed**가 최종 PG 결과다. 추가 작업 파일은 `class_attendance_service.py`, `session_service.py`, `ws/session_live_namespace.py`, `test_sdd217_attendance.py`, 이 보고서뿐이며 T03-fix1-base 이후의 다른 범위·스키마·FE 변경은 없다.

### 1. 과거 host_id만으로 출석 정정 권한을 유지하던 문제

- 원인: `row.host_id == actor.id`가 현재 클래스 강사 행 및 센터 소속 검증을 우회했다. 완료회차는 강사를 제거해도 host_id를 보존하므로 과거 담당자에게 계속 정정이 허용됐다.
- 실제 PG 재현 `test_review_r1_correct_rechecks_current_instructor_eligibility[removed/organization_inactive/guest_scope]`: 실제 remove_instructor로 제거(다른 lead 추가 후), UserOrgMembership 비활성화, guest 강사의 다른 회차 scope 지정. 세 사례 모두 정정이 성공하여 **RED 3 failed**.
- 수정: 기존 `class_instructor_service.validate_instructor(db, cls, actor.id, row.id)`로 현재 계정·센터 counselor 소속·기관 활성·강사 status·guest 회차 scope를 재검증한다. 통과한 현재 해당 회차 진행자 또는 lead/assistant counselor에게만 정정을 허용하고 권한 상실은403으로 응답한다. 이전 operation 재응답보다 먼저 검사하는 기존 명령 구조를 유지한다.
- GREEN: 세 사례 모두403, 기존 출석·감사 무변경. 기존 유효 강사의 HTTP200/감사/멱등·stale 검증도 관련 회귀에서 유지됐다.

### 2. 정상 수료 직후 종료 통지가 룸 회수에 밀리던 문제

- 원인: 마지막 회차 종료의 같은 커밋에서 멤버가 completed가 된다. 이후 participant_changed/session_state_changed의 공통 refresh가 활동 자격을 상실한 본인을 먼저 퇴장시켜, 기존 FE가 듣는 completed/오디오 stop을 받지 못했다.
- 실제 PG+룸 재현 `test_review_r2_terminal_notify_before_room_cleanup[completed/removed/left]`: finish_class_if_due를 실제 호출한 완료 클래스. completed 본인의 terminal 이벤트가0개여서 **RED 1 failed**, removed/left에게 노출하지 않는 음성 경로2개는 이미 PASS.
- 수정: 일반 활동 자격을 completed로 넓히지 않았다. 현재 세션이 종료 상태이고 부모 클래스·canonical 멤버가 모두 completed이며 실제 entered_at이 있는 본인에게만, 별도 `completed_participant_state`가 소유권·현재 계정/서명·entry_ver·participant ID·superseded/철회 여부를 확인하고 최소 종료 상태를 반환한다. WS refresh는 이 본인에게 `session_state_changed`와 기존 AUDIO_SYNC_EVENT의 stop을 직접 먼저 전달한 뒤 all/self 룸과 활동 컨텍스트를 정리한다. 정상 수료에는 access_revoked를 내지 않는다. removed/left·폐기/만료 자격·타인에게는 종료 상태/오디오를 새로 전달하지 않고 기존 접근 회수만 수행한다. FE 변경 없이 기존 이벤트 계약을 사용한다.
- 안전한 종료 payload는 session_id/status/version/started_at/ended_at뿐이며 강사·다른 참가자·뇌파·리포트 필드를 포함하지 않는다. participant 단순 refresh가 먼저 실행되는 경우에도 이 순서를 지킨다.
- GREEN: 룸 테스트6개(권한3+종료3) 통과. 추가로 기존 실제 loopback WebSocket/Socket.IO+독립 migrated PG 테스트를 remove/complete 두 경로로 실행했다. `transition_status(end)`→finish_class_if_due→완료·오디오 stop 실제 수신→all/self 룸 제거, 정상 수료에서 access_revoked 없음 확인. 기존 remove→effect 소비→access_revoked·LiveKit SDK 대역 회수도 함께 통과.

### 실행 명령·결과

```bash
# 정상 RED
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_attendance.py -k review_r -q --tb=short
# 4 failed, 2 passed, 18 deselected, 1 warning
# 수정 후 동일 명령: 6 passed, 18 deselected, 1 warning

# 실제 WebSocket 추가 확인
# 위 환경·Python·pytest에 -k 'review_r or real_websocket'
# 8 passed, 17 deselected, 5 warnings

# 최종 허용된 관련 PG 전체(이 보고서의 기존 최종명령과 동일 6파일)
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg \
 tests/pg/test_sdd217_attendance.py tests/pg/test_sdd217_membership.py \
 tests/pg/test_sdd216_entry.py tests/pg/test_sdd216_lifecycle.py \
 tests/pg/test_sdd216_observer.py tests/pg/test_sdd216_members.py -q --tb=short
# 66 passed, 5 warnings in 10.15s

DATABASE_URL=sqlite:// \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest tests/test_sdd024_session_live_ws.py \
 tests/test_sdd209_b5a_entry.py tests/test_sdd209_i2_entry_times.py -q --tb=short
# 33 passed, 6 warnings in 5.84s
```

T03 신규 검증은 파라미터 포함25개이며 기존 관련41개다. warning은 기존 의존성/API deprecation이며 새 실패 없음. `git diff --check`와 이번 변경 Python4파일 AST 검사 PASS. 최초 재현 실행의 cwd를 repository root로 지정하여 confcutdir 오류(no tests ran)가 난 도구 실수는 backend cwd로 정정한 뒤 위 정상 RED를 확인했고 제품 실패로 계산하지 않았다. 실제 외부 LiveKit 서버와 여러 WS 워커 간 분산 회수의 기존 미검증·구조 제약은 여전히 남는다.
