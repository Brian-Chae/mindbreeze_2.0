# T07 구현 보고 — guest 장기 자격·병합·단회 회복

- 작업 경로: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`, 브랜치 `sdd/217-class-structure-phase4`.
- 승인된 T07/R4/V15~19,V37~38 구현. 이전 T00~06 변경 보존. 모델/마이그레이션 수정 없음. 하위 에이전트·커밋·푸시·배포 없음.
- TDD 및 verification-before-completion 적용. 합성 로컬 PG만 사용했으며 기존 Python venv는 실행만 했다. 실제 환경파일/자격증명 미사용. 모든 sibling 변경·테스트는 승인된 `require_escalated` 실행으로 수행했다.

## 변경 파일

신규:

1. `backend/app/services/class_guest_service.py`: 장기 DB grant+서명 인증, 90일 자격, 가입/refresh/logout/rejoin/회차교환, 별도 guest command operation, canonical 병합/미리보기, 10분 hash-only 단회 회복.
2. `backend/app/schemas/class_guests.py`: extra=forbid 가입/미리보기/병합/회복/교환 DTO. 가입 operation_key UUID. 기존 guest 필수 이름·성별·생일·이메일 및 이메일 형식 검사. 선택 동의 기본 false.
3. `backend/app/api/v1/class_guests.py`: 공개 가입 시도 제한과 실제 guest 자격 HTTP, 강사 확인 병합/회복 HTTP.
4. `backend/tests/pg/test_sdd217_guests.py`: 실제 migrated PG 및 HTTP 검증34개. 독립 DB·두 연결 경합2개 포함.

연계 파일의 T07 변경:

5. `backend/app/api/v1/__init__.py`: class_guests router 등록.
6. `backend/app/api/v1/class_membership.py`: 기존 로그인 경로를 보존하며 optional 로그인+전용 guest 헤더로 전이/대기/출석/개인 보강/취소를 분기. participation에 활동 guest 헤더 가산.
7. `backend/app/services/class_membership_service.py`: `ensure_expected`의 NULL user_id 공유 조회를 membership ID 우선으로 수정. user_id fallback은 로그인+미연결 legacy 참가행에만 사용.
8. `backend/app/services/class_attendance_service.py`: root 승인된 연계 수정2건. guest 실제 입장의 participant 표시자는 기존 enum self, 감사 actor_kind는 guest 및 원 member_id 유지. 완료 개인 보강 자격은 assignment.member_id의 canonical alias 범위와 동일 클래스/원결석/비superseded 근거를 확인하고 원본 FK를 유지.
9. `backend/app/services/class_participation_service.py`: 활동 grant로 본인 canonical 유효 참가행1개만 snapshot. 읽기 grant 거부. 기존 로그인/회차 자격 경로 유지.
10. `backend/tests/pg/test_sdd217_membership.py`, `test_sdd217_attendance.py`, `test_sdd217_makeup.py`: root 승인된 fixture 정합 변경. 기존 `get_current_user` override를 유지하고 동일 주체의 `get_current_user_optional` override를 가산. assertion/권한 기대/제품 흐름을 완화하지 않았다.
11. 이 보고서.

## RED → GREEN

1. 최초 guest 테스트7개: 신규 서비스 부재 ImportError로 **7 failed RED**. 가입·grant·병합·회복 구현 후 **7 passed GREEN**. 첫 파일 작성 시 backend 경로를 중복 지정해 파일 없음으로 실행되지 않은 호출은 제품 RED로 계산하지 않았다.
2. guest 본인 전이/출석/보강/회차교환 및 HTTP 연결4개: 미구현 메서드/라우트 부재 **4 failed RED**. 구현 후 연계 PG CHECK 오류1개를 제외하고 통과했다.
3. 실제 guest_entry가 T03 `mark_entered`→`_change`에서 `attendance_marked_by='guest'`를 써 기존 PG `ck_session_participants_marked_by(system/host/self)` 제약500 **RED**. root 승인으로 참가행 표시자는 self로 정규화하고 append-only 감사 actor_kind=guest·원 member_id는 유지해 **GREEN**.
4. 활동 grant snapshot은 `member_credential` 인자 부재 TypeError **RED**. root 승인 adapter 후 본인1행 및 읽기 grant 거부 **GREEN**.
5. 가입 필수 정책은 root가 기존4개 필수 문구 우선으로 판정했다. 이름은 기존부터 거부했고 성별/생일/이메일 누락3개는 성공해 **3 failed RED**. DTO/서비스 동일 검증 후4개 모두 **GREEN**. 실제 HTTP 역시 extra/필수값 검증을 적용한다.
6. 실제 병합→completed alias 보강 입장 통합: 원결석을 잘못 supersede하면 source 자격403 **RED**. 유효 assignment가 참조한 원결석/대상 참가행을 선택 보존했다. 이후 T03가 assignment.member_id==canonical만 조회해 실제 `mark_entered`403 **RED**. root 승인으로 alias 범위와 원결석 동일 클래스/상태를 확인해 **GREEN**. assignment/member/participant FK 재작성 없음.
7. 체크인 unknown placeholder(`before:null,after:null`)를 실기록으로 보아 병합 충돌409 **RED**. 실제 before/after 객체 또는 checkin_state/at만 근거로 판정해 **GREEN**.

중간 관련 회귀의6개401 실패는 인증 dependency 변경에 기존 HTTP fixture가 get_current_user만 override한 원인이었다. root 승인으로 두 인증 dependency에 동일 주체를 연결해 정합화했고, 별도의 T07 실제 Bearer 검증으로 제품 인증까지 확인했다. 실제 Bearer 테스트 초기에 create_access_token에 dict를 전달한 하네스 오류는 subject 문자열로 바로잡았으며 제품 인증 우회는 추가하지 않았다.

## 실행 명령·검증 결과

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg \
 tests/pg/test_sdd217_guests.py tests/pg/test_sdd217_membership.py \
 tests/pg/test_sdd217_attendance.py tests/pg/test_sdd217_makeup.py \
 tests/pg/test_sdd217_participation.py tests/pg/test_sdd216_members.py \
 tests/pg/test_sdd216_entry.py tests/pg/test_sdd216_lifecycle.py -q --tb=short
# 144 passed, 7 warnings in 17.84s (guest32 당시)

# 이후 NULL legacy helper 직접 회귀 및 양쪽 서로 다른 과거2회차/FK 검증2개 추가
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_guests.py -q --tb=short
# 34 passed, 1 warning in 3.78s
```

추가로 T07 직접 변경 Python12파일 AST parse 및 `git diff --check` PASS. 경고는 기존 crypt 및 T03/T04 실제 loopback WebSocket 의존성 deprecation이다. 전체 BE/FE·실브라우저·실장치를 실행/통과했다고 주장하지 않는다. 두 연결 경합은 scratch DB 각각에 실제 `alembic upgrade head`를 적용하며 해당 DB만 fixture가 제거한다. 공유 PG 시작/종료/재시작 없음.

## Verify별 증거

- **V15 PASS**: `test_v15_distinct_null_guests_expected_and_reports`, `test_v15_legacy_ensure_expected_uses_membership_id_for_null_users`. 동명이인 NULL guest 각각 별도 member/participant/report. 기존 ensure_expected 두 번 호출도 각 원행을 재사용하여2개 유지. 로그인 legacy fallback 의미 보존.
- **V16 PASS**: `test_v16_scope_expiry_tamper_cross_class_logout`, `test_recovery_expired_cross_class_and_readonly_refresh`, `test_real_bearer_login_guest_and_anonymous_http`. DB grant·JWT type/sub/cid/jti/ver/exp·현재 canonical 상태 전부 검사. 90일 초과, 변조, 타 클래스, 구 entry_ver, 읽기→활동, 제외/로그아웃 자격 거부. active/waitlisted만 활동 자격, completed/left/removed는 읽기만. 부모 자격을 로그인 Bearer로 제출하면401.
- **V17 PASS**: `test_v17_v37_merge_preserves_fk_revokes_and_replays`, `test_merge_flatten_stale_cross_class_and_current_authority`. 강사 확인 명시 IDs로만 병합, source removed 보존·alias 최종 survivor로 평탄화, cycle/alias 재병합 거부. 원 participant ID/member_id 및 report ID/participant FK·내용 보존. 이름 같은 신규 가입은 별도 행 유지.
- **V18 PASS**: `test_v18_report_conflict_rolls_back`, `test_actual_record_kinds_block_merge_and_preserve_grants[entered/checkin/eeg/media]`, `test_merge_stale_preview_and_storage_failure_are_atomic`. 같은 회차 양쪽 실제 기록409, 기존 grant·canonical·감사 무변경. 미리보기 fingerprint stale409. 실제 merge 감사 insert 실패 주입 시 revision/alias/participant.superseded/grant 회수/operation 모두 롤백 및 동일 키 재시도 성공. 동일 병합 operation은 이력1개 및 동일 도메인 결과.
- **V19 PASS**: `test_v19_non_manager_forbidden`, `test_cross_class_merge_and_recovery_scope_return_no_guest_token`, `test_merge_flatten_stale_cross_class_and_current_authority`. 무관/타 클래스 멤버 병합 금지, 현재 강사 제거 뒤 성공 operation 재시도도 거부. 양쪽 옛 활동/읽기 자격 및 원회차 자격 버전 회수. 성공 병합 응답에는 guest 자격 없음.
- **V37 PASS**: `test_v37_two_distinct_past_sessions_reports_and_one_future_canonical_seat`. 양쪽 서로 다른 과거 attended2개/report2개 원 ID/FK/내용 그대로 보존. 미래 expected2개 중 유효1개만 남기고 나머지는 withdrawn+superseded 및 출석 감사 유지. canonical 유효3회차 distinct. `test_completed_alias_makeup_entry_preserves_original_assignment_member_fk`에서 유효 보강의 source absent·target expected를 보존하고 실제 entry가 assignment completed를 파생.
- **V38 API/PG PASS, 브라우저 후속**: `test_v38_recovery_hash_only_single_use_retry_no_secret`, `test_http_join_exchange_recovery_refresh_strict_payloads`, `test_guest_leave_read_only_rejoin_same_member_and_no_pii_operation`, `test_two_connections_exchange_and_merge_replay`. hash만 저장하는10분 단회 토큰, 동일 발급 operation 재시도 원문 재노출 없음. 타 클래스·만료·재사용401. 실제 두 연결 exchange는200/401·새 grant 단일 세트, merge 같은 operation은200/200·이력1개·양쪽 옛 grant0. 이탈 시 읽기만 새 발급, 현재 코드 재가입은 같은 member 행·미래 참가행 재사용, logout 후 read 및 성공 operation 재시도 거부. 과거 승인 리포트 열람은 T09 연결 전이므로 V38 전체 브라우저 PASS로 표기하지 않는다.

추가:

- `test_guest_attendance_makeup_current_auth_before_replay`: guest 출석 excuse·동일 키 재시도·본인 보강예약·취소·로그아웃 후 이전 키 거부. User FK 대신 원 member_id 기반 ClassMemberOperation을 사용한다.
- `test_guest_entry_active_and_completed_makeup_preserve_status`, `test_completed_cancelled_replacement_read_exchange_and_entry_retry`, `test_read_grant_cannot_enter_unassigned_completed_or_removed`: 활동 active의 본인 입장과 read completed의 명시 개인/취소대체만 class_entry 교환. 실제 entered_at/attended 및 assignment.completed는 같은 트랜잭션, 부모/멤버 completed 유지. 임의 정규·다른회차·left/removed 거부. 현재 읽기 grant 및 배정/회차/정원 재검사 후 같은 operation의 회차 토큰 재발급, operation에는 토큰 없음.
- `test_snapshot_activity_credential_own_only_read_denied`: 활동 grant 본인canonical1행만 snapshot, read 거부. 기존 class_entry WS·snapshot 경로 보존.
- `test_join_reuses_existing_guest_required_pii_policy`: 기존 필수4개 누락422. 선택 리포트/연구/알림 동의는 필수로 바꾸지 않았다.

## API 및 후속 인터페이스

실제 신규 HTTP:

```text
POST /api/v1/classes/{id}/guest-memberships (201, 공개 code 시도 제한)
POST /api/v1/classes/{id}/guest-credentials/refresh
POST /api/v1/classes/{id}/guest-credentials/logout
POST /api/v1/classes/{id}/guest-credentials/rejoin (code 시도 제한)
POST /api/v1/classes/{id}/sessions/{sid}/guest-entry
POST /api/v1/classes/{id}/guest-merges/preview (현재 manage_members)
POST /api/v1/classes/{id}/guest-merges (현재 manage_members, identity_confirmed+reason)
POST /api/v1/classes/{id}/members/{mid}/recovery (동일 권한, identity_confirmed+reason)
POST /api/v1/classes/{id}/guest-credentials/exchange
```

장기 자격은 `X-Class-Member-Credential`만 사용한다. 기존 transition/waitlist/attendance/makeup/cancel 및 participation도 이 헤더의 활동 scope를 검사한다. 회차 entry-state/WS/LiveKit은 교환된 기존 `class_entry`만 사용한다.

```python
authenticate_guest(db, class_id, token, *, scope='read', now=None)
# -> (현재 canonical ClassMember, ClassGuestCredential)
# scope='read'는 유효 activity/read 토큰 둘 다 허용.
# scope='activity'는 현재 active/waitlisted+클래스active의 activity만 허용.
# 조회 자체는 commit/rollback/last_used_at 갱신을 소유하지 않는다.

canonical_member_ids(db, member)
# -> 같은 클래스의 survivor + flat alias UUID set

execute_guest_command(db, class_id, token, command, *, action, target_id,
    apply, authorize=None, scope='activity', now=None, decorate=None)
# Class→members ID순, 현재 grant/소유권 authorize를 prior 조회보다 먼저 검사.
# action/class/canonical member/target/body SHA256 및 member+key UNIQUE.
# apply는 flush-only. 결과 PII/원문 자격 제거, 단일 commit/rollback.
# decorate는 검증된 응답에만 ephemeral 자격을 가산(같은 트랜잭션).
```

T08/T09는 위 인증과 canonical 범위를 재사용해야 한다. 직접 read token을 회차 입장/미디어/일반 쓰기에 전달하지 않는다. T08 동의/철회 API에서 읽기 grant 예외는 해당 전용 command의 scope/authorize로 명시해야 한다. `execute_guest_command`를 로그인 `actor_id`에 guest UUID를 넣는 방식으로 대체하지 않는다.

root가 승인하고 T00 계약/결정 기록에 반영할 정합 보완:

1. guest-entry는 기존 누락된 active 활동 자격→본인 정규/지정보강 교환을 가산. read는 completed 지정 개인/취소대체에만 허용.
2. guest-memberships의 gender/birth_date/report_email 선택표시는 기존4개 필수 정책 재사용 문구에 맞춰 필수로 정정.
3. 완료 alias 보강 및 guest attendance 표시자 연계 수정은 이 T07 통합 소유 범위.

## 남은 후속·미검증

- T08: 가입 동의 증빙 이벤트·향후 expected/보강 참가행의 guest PII 및 동의 기본값 복사, canonical PII 스크럽·연구 철회. 현재 가입의 member 기본값 저장까지만 구현했으며 자동 리포트 동의를 추정하지 않는다.
- T09: read grant의 canonical 본인 과거 승인 리포트/이력 접근, alias source의 원문 PII 비노출 및 집계. FK/자격 scope 기반은 준비됐으나 해당 읽기 API를 T07에서 대신 구현하지 않았다.
- T10/T11: 실제 guest 브라우저 가입→기기 상실→강사 확인→단회 회복→승인된 과거 리포트 열람 여정. 브라우저·실장치 증거 없음.
- 외부 LiveKit·분산 WS·실제 알림 전달·실제 Redis 서버는 미검증. `ClassEffect` 회수 의도 및 기존 단일 프로세스 loopback WS 회귀 통과와 구분한다. 신규 공개 가입 HTTP의 Redis는 메모리 대역으로 rate-limit 경로 연결을 실행했다.
- 독립 리뷰/추가 수정은 root 소유. 구현자가 최종 리뷰 승인을 주장하지 않는다.

## 독립 리뷰 수정 round 1/5 — 유효 보강 참조행 무효화 병합 차단

독립 Important finding1건을 수정했다. fix1-base 이후 변경은 `backend/app/services/class_guest_service.py`, `backend/tests/pg/test_sdd217_guests.py`, 이 보고서3개뿐이다. 모델/스키마/다른 태스크 구현/커밋/푸시/하위 에이전트 없음.

### 원인과 최소 수정

- A의 absent/excused 원결석 또는 expected 보강 대상이 reserved assignment에 참조되고, B의 같은 회차 참가행에만 entered/report/checkin 실기록이 있으면 `_merge_preview_locked`는 실제 기록 B를 우선 선택했다. A의 참조행을 withdrawn+superseded로 만들 계획이면서 preview conflicts=[]였고, 병합 후 assignment는 reserved인 채 실제 completed guest_entry의 원결석/대상 검사403이 되었다.
- 실제 기록 우선 규칙은 유지한다. 선택 결과 superseded될 participant IDs와 현재 reserved/completed assignment의 source/target 참조를 비교한다. 참조행을 무효화하면 preview에 `code=makeup_assignment_invalidated`, `assignment_id`, `participant_id`, `session_id`, `role=source|target`을 추가한다. 개인정보나 자격은 포함하지 않는다.
- 기존 preview HTTP200+conflicts 계약을 유지한다. commit은 기존 `guest_merge_record_conflict`409에 해당 conflicts를 가산하고 회수/멤버/출석 변경 전에 거부한다. 예약 암묵 취소·ID/FK 재작성은 하지 않는다. 명시적 예약 취소 뒤 같은 실제 기록 우선 선택을 만족하는 병합만 허용한다.

### RED → GREEN·증거

`-k review_fix1` 최초 **7 failed RED**: source/target × 상대방 entered/report/checkin6개 모두 preview가 예약 무효화 conflict를 누락했고, 명시 취소 전 거부를 기대한 양성 여정1개도 같은 원인으로 실패했다. 최소 수정 후 동일 명령 **7 passed GREEN**.

- `test_review_fix1_rejects_invalidating_reserved_makeup_and_keeps_actual_entry_usable[entered/report/checkin-source/target]`: preview에 구체 참조 사유, commit409+사유 확인. 거부 전후 class revision, member status/canonical/entry_ver, participant 출석/superseded/entry_ver/entered_at, 양쪽 grant revoked_at, assignment 상태와 원 source/target FK, merge 감사/operation 수 모두 동일함을 실제 PG에서 확인했다. 양쪽 기존 읽기 자격도 유효하다.
- 같은6개 사례 각각에서 거부 이후 A와 부모를 completed로 두고 기존 reserved target 회차를 open으로 전환하여 **실제 guest_entry→mark_entered→class_entry 토큰 소유 검증**까지 실행했다. 원 target participant ID로 입장하고 assignment completed, 원 source absent·source/target superseded=NULL을 확인했다. 병합 거부가 기존 예약 입장을 손상시키지 않는다.
- `test_review_fix1_explicit_cancel_allows_later_legal_merge_without_rewriting_assignment`: 유효 예약 때 충돌, 별도 guest_cancel_makeup 명령으로 명시 취소 후 conflicts=[], 병합 성공. 원 assignment ID/member/source/target FK 및 cancelled 이력, 상대방 실제 entered_at 모두 보존했다.

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_guests.py \
 -k review_fix1 -q --tb=short
# RED: 7 failed,34 deselected -> GREEN: 7 passed,34 deselected

PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_guests.py \
 tests/pg/test_sdd217_makeup.py tests/pg/test_sdd217_attendance.py -q --tb=short
# 108 passed,5 warnings in 13.28s
```

guest 최종41개+개인 보강42개+출석25개. 경고는 기존 crypt 및 T03 loopback WS 의존성 deprecation이다. fix1 변경 Python2파일 AST parse와 `git diff --check` PASS. 이번 finding에 연결된 범위만 재검증했으며 전체 BE/FE/브라우저/외부 장치 검증으로 확대하지 않았다. T08~11 후속 및 기존 미검증은 유지한다. 독립 재리뷰는 root 소유다.
