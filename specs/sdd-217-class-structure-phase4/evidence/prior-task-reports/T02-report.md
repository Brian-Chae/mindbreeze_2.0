# T02 구현 결과 — 멤버 전이·FIFO·정원

- 기준 HEAD: `a4acf6ba0c434fd40f7eb70ce573e7ad1a7699b4`, 브랜치 `sdd/217-class-structure-phase4`.
- 작업 경로: `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`.
- 승인된 T02 범위의 로그인 주체 API 구현. 모델/마이그레이션 수정 없음. 기존 스키마057·T01 프런트 변경 보존. 커밋/푸시/배포/하위 에이전트 실행 없음.

## 변경 파일

- `backend/app/services/class_membership_service.py`: flush 전용 전이·재가입·FIFO·미래 출석 활성화/철회, 감사 및 전달 의도 저장. 기존 명시 초대의 즉시 active/정원409/explicit reinvite 의미 보존. NULL user_id guest를 dict 한 칸으로 집계하던 정원 누락은 행 기준 canonical active 집계로 수정.
- `backend/app/services/class_member_commands.py`: User→Class→ClassMember ID순 잠금, 현재 actor 권한/소유권 검사, 기존 ClassOperation의 actor+operation_key 전역 유일성, action/class/target/body SHA256, stale 비교 전 검증된 결과 복원, commit/rollback 소유.
- `backend/app/services/class_code_service.py`: 기존 `{code}` 계약 보존. left는 같은 멤버 행으로 재가입, 신규 가입의 선행 대기/FIFO 및 회차 정원 검사, removed/completed 코드 재가입 금지 보존.
- `backend/app/schemas/class_membership.py`: MemberCommand/MemberTransitionCommand/MemberWaitlistCommand, extra=forbid.
- `backend/app/api/v1/class_membership.py`: 로그인 전이·대기 라우트, 편성 스위치와 기존 코드 시도 제한 공유.
- `backend/app/api/v1/__init__.py`: 신규 router 등록.
- `backend/tests/pg/test_sdd217_membership.py`: 신규 실제 PG/HTTP 검증 16개.

## RED → GREEN

1. 신규 7개: 서비스/라우트 미구현을 assert로 확인한 정상 RED 7 failed. 초기 fixture의 host_state 누락은 실제 PG 제약 실패였으며, 이를 정정하고 **다시 정상 RED를 확인한 뒤** 제품 구현.
2. left 코드 재가입 RED: 기존 member_reinvite_required409. 기존 신규 code join의 3연결 경합 RED: 선행 waitlisted가 있어도 신규 사용자 active 성공. 정정 후 GREEN.
3. actor별 capability 부재 및 신규 코드 가입의 회차 정원 누락 RED 2개. actor별 bool capability/회차 cap 검사 후 GREEN.
4. 신규 대기 HTTP에서 코드 실패 10회 후 올바른 코드도 200이던 RED. 기존 code_limited 연결 후429 GREEN. Redis는 시간 창 내부 상태 저장용 메모리 대역이며, 실제 Redis 서버 검증은 아님.
5. 승격 대상 없는 탈퇴 알림 의도0개 RED → event ID 결합 class_member_left 저장 후1개 GREEN.
6. 서로 다른 NULL user_id guest 2명이 정원2를 채웠음에도 로그인 신규가입 성공 RED → 기존 invite 정원 집계를 canonical active 행 전체로 수정 후409 GREEN.

## 실행 명령 및 결과

환경: 기존 read-only Python `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python`, 로컬 합성 PG `postgresql://sdd217@127.0.0.1:55437/sdd217_test`, head057 적용. 경합 테스트는 fixture가 별도 빈 임시 DB를 만든 뒤 실제 `alembic upgrade head`를 적용하며 종료 후 해당 DB만 제거한다. 공유 PG를 재시작/종료하지 않는다.

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
  '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
  -m pytest --confcutdir=tests/pg \
  tests/pg/test_sdd217_membership.py \
  tests/pg/test_sdd216_members.py tests/pg/test_sdd216_entry.py \
  tests/pg/test_sdd216_lifecycle.py -q --tb=short
```

최종 결과: **28 passed, 1 warning**. 신규16 + 기존 관련12. 경고는 기존 passlib의 crypt deprecation. 전체 BE 반복은 명시 범위에 따라 미실행. `git diff --check` 통과. black 모듈 미설치 확인(포맷터 실행/통과 주장 없음).

## Verify ID별 증거

- **V01 PASS**: `test_v01_rejoin_same_id_future_only_and_idempotent`, `test_code_left_rejoins_same_row_and_cannot_jump_waitlist`. 같은 멤버 ID 재사용, 재가입 시 이미 과거인 회차 expected 생성 없음, 동일키·stale revision 재시도 동일 응답/중복 없음.
- **V02 PASS (T02 범위)**: `test_v02_removed_only_host_restore_completed_rejoin_forbidden`, `test_http_permissions_hidden_member_and_strict_input`. removed 본인 rejoin/restore 금지, 코드 가입409, 권한 강사 restore만 허용, completed 새 transition rejoin 금지. 기존 completed **강사 explicit reinvite** 테스트 통과로 기존 의미 보존. 미인증 guest ID extra422.
- **V03 PASS**: `test_v03_last_seat_restore_promote_join_three_connections`. 실제 PG 독립 연결3개·Barrier 동시 시작, restore/promote/new code join 경합. 클래스 active≤1, 신규 가입이 선행 대기 추월 못함. optimistic revision 경합은 stale_class로 응답 후 최신 revision 재시도. `test_session_capacity_applies_to_restore_and_code_join_atomically`는 회차cap409 및 멤버 생성/복구 전체 롤백. `test_existing_distinct_guest_members_count_toward_login_capacity`는 guest도 정원에 각각 포함.
- **V04 PASS**: `test_v04_fifo_cancel_reapply_end_and_capacity_shrink`, `test_waitlist_explicit_only_and_promote_cannot_skip_fifo`. 대기 취소 재신청 끝 순번, FIFO 승격/선행자 추월409, 정원 부족에 기존 active 강등 없음. 빈자리+대기 없음은 waitlist_not_required409.
- **V05 PASS**: `test_v05_leave_withdraws_only_future_and_revokes_live_access`. 미래 expected/excused만 withdrawn, 과거 및 현재 attended 보존, participant ID와 실제 합성 Report FK/content 보존. member/participant entry_ver 증가. V36의 현재 접속 회수 완료 증거로 해석하지 않음.
- **V06 PASS**: `test_v06_effect_insert_failure_rolls_back_promotion_audit_and_retry`, `test_v06_participant_and_class_revision_rollback_with_effect_failure`, `test_leave_without_promotion_still_stores_notification_intent_once`. 실제 ClassEffect insert 실패 주입 시 멤버 상태/출석/감사/승격/operation/revision/participation_version 전부 롤백, 같은 키 재시도 단일 저장. 실제 외부 메일/푸시 수신은 미확인.
- **V36 PARTIAL / T03 인계**: 제거 측 member/participant 버전·guest grant 폐기·미래 withdrawn·기존 attended 유지·`live_access_reconcile` 의도 원자 저장 검증. 입장과 제거의 실제 두 연결 경합, WS/LiveKit 현재 접속 강제 회수, excused 직접입장 cap 재검사는 T03 소유이며 여기서는 미검증.

추가 HTTP 검증: 편성 off404, 타인 leave403, 본인 remove403, 강사 remove200, 제거자 본인 rejoin409, extra422, 코드 시도 제한429. 현재 권한을 상실한 강사는 이전 성공 operation을 재응답받지 못함. 같은 actor의 operation_key를 다른 클래스/대상에 재사용하면409 operation_key_reused.

## 신규 HTTP 예시

`POST /api/v1/classes/{class_id}/waitlist` (로그인 본인, 기존 code 시도 제한 적용):

```json
{"operation_key":"무작위-UUID","expected_revision":3,"code":"0217"}
```

200 응답(식별자/시각은 설명용):

```json
{"class_id":"CLASS_UUID","revision":4,"member":{"id":"MEMBER_UUID","user_id":"USER_UUID","name":"합성 사용자","status":"waitlisted","kind":"member","canonical_member_id":"MEMBER_UUID","waitlist_position":2,"joined_at":"2026-11-02T01:00:00+00:00","activated_at":null,"left_at":null,"removed_at":null,"completed_at":null,"capabilities":{"manage_members":false,"leave":false,"cancel_waitlist":true,"rejoin":false}}}
```

`POST /api/v1/classes/{class_id}/members/{member_id}/transition`:

```json
{"operation_key":"새-무작위-UUID","expected_revision":4,"action":"leave","reason":"선택 사유"}
```

200 응답은 `{class_id,revision,member,promoted_member_ids:[]}`. member는 위 DTO이며 status 및 actor별 capabilities 갱신. action은 leave/cancel_waitlist/rejoin(본인), remove/restore/promote(기존 invite와 같은 lead/assistant/같은센터 org_admin). org_admin은 reason 필수. 응답은 도메인 결과이며 알림/현재 접속 회수 완료를 뜻하지 않는다.

## T03 재사용·잠금 인계

```python
execute_member_command(db, actor_id, class_id, command, *,
    action, target_id, authorize, apply)
# authorize(cls, actor, data): 현재 소유권/역할 검사. prior 결과 복원보다 먼저 호출.
# apply(cls, actor, data): flush 전용 도메인 로직, 응답 추가 필드 dict 반환.
# User→Class→해당 클래스 모든 ClassMember ID순 잠금 보유.
# 이 함수만 commit/rollback. apply 안에서 새 User 잠금 취득 금지.

_sessions_locked(db, cls)  # 모든 회차를 Session.id순 FOR UPDATE, 반환 list
member_dto(db, member, actor=None, cls=None)  # actor별 bool capabilities
rejoin_member(db, cls, member, actor_id, now, reason=None)  # caller locks, flush only
```

T03는 apply에서 회차→participant ID순 잠금, expected_participation_version 검사/변경을 추가하면 된다. member_id 대상과 action은 해시 target_id/action/body에 포함되어야 한다. guest는 T07 전용 인증/operation 저장소 연결 전까지 로그인 actor 함수를 위조 guest ID로 호출하지 않는다.

**현재 회수 소비의 실제 한계**: `backend/app/services/class_effect_service.py::_deliver`의 kind=`live_access_reconcile`은 `backend/app/services/class_access_service.py::reconcile_observers`만 부른다. 해당 함수는 identity가 `observer:`로 시작하지 않으면 continue하므로 일반 멤버 WS/LiveKit을 제거하지 않는다. root 결정에 따라 T03가 일반 멤버 현재 접근 판정/WS 및 reconcile 소비 확장을 맡는다. T02는 `member-revoke:{member.id}:{member.entry_ver}` effect_key로 중복 없는 회수 의도를 저장했다.

## 남은 미검증

- T03 V36 입장/제거 경합 및 실제 WS/LiveKit 회수. 실제 외부 전달 결과.
- T07 guest 활동/읽기 자격 인증 및 토큰 발급·회복. 기존 ensure_expected의 NULL user_id 조회 공유 결함은 T07 담당으로 남겼다.
- T08 연구/리포트 기본값·스크럽 정책 연결. T09 읽기/리포트 승인 접근. 브라우저 여정·실장치·배포.

## 독립 리뷰 수정 round 1/5 — Important 2건

리뷰에서 발견한 두 항목만 수정했다. 위 최초 결과 28 passed 이후의 최종 검증 결과는 이 절의 **34 passed**가 우선한다.

### 수정 근거와 제품 변경

1. 즉시 클래스(start_now=true) 진행 중 cap1에서 A expected/attended를 보존한 채 leave/remove하면, 과거 상태값만 세던 `_activate_future`가 A를 계속 점유로 보아 FIFO 승격을 session_capacity409로 막고 이탈까지 롤백했다. `class_membership_service.py::_occupied_seats`로 현재 canonical 멤버 자격과 출석 기록을 분리했다. left/removed 등의 무자격 기록은 입장 점유에서 빠지지만 원 participant ID·attendance_status·entered_at은 그대로 남긴다. alias는 canonical survivor의 상태로 판정하고 동일 canonical 점유는 한 번만 센다. 기존 member 미연결 참가행은 보수적으로 계속 센다. completed 지정 보강 출석은 후속 T05가 처리할 자격을 지우지 않도록 점유에 유지한다. guest 인증/병합 기능은 추가하지 않았다.
2. 기존 `POST /classes/{id}/members`의 invite_members→ensure_expected는 클래스 상한만 확인해 cap3 클래스/cap1 회차에 두 번째 expected를 만들었다. 기존 초대에서도 ClassMember ID순→Session ID순→SessionParticipant ID순 FOR UPDATE 후 같은 현재 자격 기반 회차 상한 검사를 수행한다. 서비스는 flush만 하며 기존 최상위 명령이 commit/rollback한다. 기존 completed 강사 explicit reinvite 허용과 ClassCodeInput 의미는 그대로다.

### RED → GREEN 및 추가 검증

- `test_review_r1_live_departure_frees_eligibility_without_erasing_attendance`: expected/attended × leave/remove 4개 모두 수정 전 session_capacity409 **RED**. 수정 후 이탈/제외 성공, B FIFO active·expected 생성, A 상태·entered_at·participant ID 보존, A entry_ver 증가 및 회수 의도1개 **GREEN**.
- `test_review_r2_existing_invite_http_cannot_exceed_session_capacity`: 실제 기존 초대 HTTP에서 수정 전200/expected2명 **RED**. 수정 후409 session_capacity, 신규 멤버0개·원expected1개·revision 보존 **GREEN**.
- `test_review_r2_invite_locks_session_and_rechecks_latest_occupancy`: 추가 실PG 두 연결 검증. 연결1이 회차 FOR UPDATE를 보유하는 동안 연결2 초대가 회차 잠금 쿼리까지 도달 후 대기함을 확인한다. 연결1이 excused→expected로 점유를 채우고 커밋하면 연결2는 최신 상태를 재검사하여 session_capacity409, 신규 멤버/참가자 생성 없이 롤백한다. 임시 DB에 실제 head migration 적용.
- 관련 회귀 첫 실행은 **32 passed, 1 failed**. 실패는 `test_sdd216_members.py::test_member_idempotency_future_only_and_capacity`의 fixture였다. 클래스capacity=2와 달리 회차 max_participants를 생략하여 기본1로 두고 두 명 초대를 기대했기 때문에, 이번에 신설된 별도 회차 상한 검사에서 올바르게409였다. 회차에 `max_participants=2`를 명시하여 원래 클래스정원2 검증과 fixture를 정합시켰다. 클래스정원 초과409 기대를 완화하지 않았다. 별도의 신규 HTTP cap1 거부 테스트가 잘못된 초대를 막는다. root 확인을 받고 수정했다.

### 명령/최종 출력

```bash
# 리뷰 재현 RED
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
  '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
  -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_membership.py \
  -k 'test_review_r' -q --tb=short
# 5 failed, 16 deselected, 1 warning

# 최종 허용된 관련 검증
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
  '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
  -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_membership.py \
  tests/pg/test_sdd216_members.py tests/pg/test_sdd216_entry.py \
  tests/pg/test_sdd216_lifecycle.py -q --tb=short
# 34 passed, 1 warning in 3.79s
```

이번 추가 변경 파일: `backend/app/services/class_membership_service.py`, `backend/tests/pg/test_sdd217_membership.py`, `backend/tests/pg/test_sdd216_members.py`, 이 보고서. 기존 스키마/모델/다른 태스크 파일 변경 없음. `py_compile`, `git diff --check` 통과. 미검증인 V36의 WS/LiveKit 실제 회수와 T03 입장 경합 책임은 이전 인계와 같다.

## 독립 리뷰 수정 round 2/5 — attended 재활성화 cap 우회

앞선 Important 두 건은 ADDRESSED 판정. 새 finding 하나만 수정했다.

- 재현: 클래스cap2/start_now=true/현재 in_progress 회차cap1. A attended→leave(또는 remove)→B 코드 가입 active→A rejoin(또는 restore). `_activate_future`가 A의 entered_at/attended를 보고 회차cap 검사 전에 continue하여 A/B 모두 현재 active가 되었다.
- RED: `test_review_round2_attended_member_return_rechecks_current_session_capacity`의 leave/rejoin, remove/restore 두 사례에서 기대한409가 발생하지 않아 **2 failed**.
- 최소 수정: `class_membership_service.py::_activate_future`의 기존 실제입장/attended 보존 분기를 회차 점유 검사 뒤로 옮겼다. 현재 자격을 재활성화할 때도 본인 참가행을 제외한 점유를 검사하고, 통과한 뒤 원본 출석/entered_at/participant ID를 그대로 보존한다. 미입장 absent/excused의 기존 보존 처리는 유지한다.
- GREEN: 동일 재현에서409 session_capacity, 멤버 원래 left/removed·class revision·출석 이력 보존, B만 active 확인. 이후 B가 leave하여 자리를 반환하면 A는 같은 attended 행으로 재가입/복구 성공하는 양성 경로도 확인했다.

```bash
# RED 및 최종 focused GREEN(동일 명령)
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
  '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
  -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_membership.py \
  -k test_review_round2 -q --tb=short
# RED: 2 failed, 22 deselected, 1 warning
# 최종 양성 경로 포함 GREEN: 2 passed, 22 deselected, 1 warning in 0.76s

# 수정 후 허용된 관련 전체
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
  '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
  -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_membership.py \
  tests/pg/test_sdd216_members.py tests/pg/test_sdd216_entry.py \
  tests/pg/test_sdd216_lifecycle.py -q --tb=short
# 36 passed, 1 warning in 4.01s
```

이번 변경은 서비스의 해당 분기, 신규 재현2개, 이 보고서뿐이다. 추가 제품 범위/스키마/다른 태스크 변경 없음. `py_compile`, `git diff --check` 통과. 미검증 V36 실제 WS/LiveKit 회수 및 T03 입장 경합은 기존 인계와 같다.
