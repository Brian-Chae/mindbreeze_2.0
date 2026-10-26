# T05 구현 보고 — 개인 결석 보강 매칭

- 워크트리 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`, 브랜치 `sdd/217-class-structure-phase4`.
- 승인된 R3/V11~14/V35 구현. T05-base 및 기존 T00~T04 변경 보존. 스키마057·모델 변경 없음. 하위 에이전트·커밋·푸시·배포 없음.
- TDD, systematic-debugging, verification-before-completion 적용. 지시대로 관련 PG/HTTP·보강·편성·연결한 출석 경로만 실행했으며 전체 BE 반복은 하지 않았다.

## 변경 파일

1. `backend/app/services/class_makeup_service.py` 신규: canonical 멤버 범위 원결석/대상 검증, 정원·중복 예약, 취소/재예약, 원자 명령, DTO, 현재 본인·강사 권한, 대상 출석 기반 완료 파생.
2. `backend/app/services/class_attendance_service.py`: `_change`에서 보강 완료 파생 훅 호출. 완료 assignment도 AttendanceDTO에서 ID를 제공하고 completed 멤버의 이미 참석한 지정 보강 재접속 자격을 유지한다. 기존 regular 활동 자격을 확대하지 않는다.
3. `backend/app/schemas/class_membership.py`: strict `MakeupAssignmentCommand` 추가.
4. `backend/app/api/v1/class_membership.py`: 예약201·취소200 실제 로그인 API 추가. T02~T04 기존 라우트 보존.
5. `backend/app/schemas/class_scheduling.py`: 기존 user UUID 의미의 `member_ids` 보존, membership UUID `class_member_ids` 가산, 두 입력 동시 비어 있지 않으면422.
6. `backend/app/services/class_write_service.py`: 기존 `add_session`이 동일 `lock_context`/`reserve_locked`를 통과. 취소 원회차 대체 편성은 regular 참가+기존 편성 연결로 보존하며 assignment를 만들지 않는다. `mutate_class`에 선택적 현재 권한 콜백을 추가하여 성공 operation 복원 전에도 개인 보강의 현재 강사 자격을 재검사한다. 다른 호출 의미는 유지.
7. `backend/tests/pg/test_sdd217_makeup.py` 신규: 실제 PG/HTTP 검증30개(파라미터 포함), 독립 migrated DB·두 연결 HTTP 경합 포함.
8. `backend/tests/pg/test_sdd216_lifecycle.py`: 기존 completed 개인 보강 fixture의 원 참가행에 `absent` 사실 명시. 예전 fixture는 `expected`여서 신규 R3와 불일치했다. 사용자 승인·root 동의에 따라 fixture만 정합화했다. 별도 expected 거부 및 cancelled 대체 허용 테스트를 추가하여 이 변경으로 결석 검증을 숨기지 않았다.
9. 이 보고서. root가 만든 T05-review.diff는 T05-base 대비 8개 코드/테스트 파일의 범위다.

## RED → GREEN

- 초기 신규13개: 서비스 부재 assertion, 예약 라우트404, 기존 생성 expected 우회, cancelled 대체의 잘못된 makeup 처리, guest class_member_ids 누락, ambiguous 입력 수락으로 **정상 RED 12 failed, 1 passed**. `membership_as_user` 거부는 기존부터 PASS였다.
- 초기 다른 클래스 fixture에서 공개 코드 UNIQUE, 이어서 class-host FK가 맞지 않는 테스트 데이터 오류를 정정했다. 제품 실패와 별도이며 데이터 정합 이후 해당 검증은 PASS다. 중간 수정 명령의 backend cwd 중복 표기 FileNotFoundError도 제품 실패로 계산하지 않았다.
- 최초 구현·추가 PG/HTTP 경합·권한·정원·원자성 확인 **21 passed**.
- 기본 ORM 보존 필터가 removed 정규 대상행을 숨겨 새 참가행 INSERT가 user UNIQUE 오류가 되는 **RED 1 failed, 1 passed** 재현. 잠금 조회에 `include_removed=True`를 적용한 뒤409 `target_participant_exists`로 GREEN.
- 예약 참가행의 server default `joined_at`이 실제 입장 전 시각을 생성하는 **RED 1 failed, 1 passed** 재현. 기존 expected 편성 의미대로 `joined_at=null()`·report_included=false를 명시하여 GREEN. entered_at은 계속 NULL이다.
- member_id 연결 이전 legacy user 정규 행도 신규 보강 INSERT와 user UNIQUE가 충돌하는 RED를 재현. non-NULL user_id만 보조 충돌 검사하고 guest NULL은 비교하지 않도록 수정. superseded 보존 행도409 처리. 이 추가 테스트 초기의 임의 superseded UUID FK 오류는 실제 같은 회차 survivor 행을 생성하여 정합화했고 제품 실패로 주장하지 않는다.
- 취소된 대상 회차의 미입장 예약을 취소할 수 없어 원결석 재예약이 막히던 **RED 1 failed, 3 passed** → 시작 전 cancelled 대상의 예약 취소 허용 후 다른 대상으로 재예약 GREEN.
- canonical guest alias 테스트 초기의 guest→회원 canonical FK 오류는 guest끼리만 연결하도록 fixture 정합화했다. 실제 병합 실행 자체의 검증은 T07 소유이며 여기서는 유효 canonical 저장 상태를 구성해 보강 조회를 검증했다.

## 실행 명령·최종 출력

기존 Python venv는 실행만 했다. 합성 로컬 PG만 사용했고 실제 환경파일/자격증명은 읽거나 변경하지 않았다. 경합 테스트 scratch DB는 독립 빈 DB에 실제 head057까지 `alembic upgrade head` 후 종료 시 해당 임시 DB만 제거한다. 공유 PG 시작·중지·재시작 없음.

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg \
 tests/pg/test_sdd217_makeup.py tests/pg/test_sdd217_attendance.py \
 tests/pg/test_sdd216_lifecycle.py tests/pg/test_sdd216_write.py \
 tests/pg/test_sdd216_review_regressions.py -q --tb=short
# 83 passed, 5 warnings in 10.18s
```

T05 신규30 + 연결 출석25 + 기존 편성·보강28. 경고는 기존 passlib crypt 및 T03 실제 loopback WebSocket의 websockets/uvicorn API deprecation이다. 새 테스트 실패 없음. `git diff --check` 및 변경 Python8파일 `ast.parse` PASS. 포맷터·전체 BE·FE를 실행/통과했다고 주장하지 않는다.

## Verify별 근거

- **V11 PASS** — `test_v11_rejects_invalid_source[expected/attended/other_class/other_member/same_session]`: 같은 클래스·canonical 멤버 absent/excused만 원결석으로 매칭. expected/attended·다른 클래스·다른 멤버·원=대상 거부. `test_source_target_and_current_authority_limits[started/past/entered/org_admin/removed_instructor]`에서 대상 시작/과거/이미 실제입장, 관리자 단독·제거 강사 거부.
- **V12 PASS** — `test_v12_two_connections_http_reservations_serialized[same_source/target_capacity]`: 독립 migrated PG에서 실제 별도 연결2개·별도 HTTP 요청. 첫 연결이 Class FOR UPDATE를 취득한 상태에서 두 번째가 같은 잠금을 요청하는 것을 SQL 이벤트로 확인한 뒤 해제. 두 요청201/409, stale revision은 최신 revision으로 재시도 후 각각 `makeup_already_reserved`/`session_capacity`. 최종 reserved assignment1개, 대상 초과0. 기존 active-source partial UNIQUE 및 두 participant UNIQUE는 그대로 유지한다.
- **V13 PASS** — `test_v13_regular_target_conflict_source_unchanged_and_completion`: excused인 정규 대상도409로 보존. 다른 대상 예약은 expected·미입장, actual `mark_entered`→attended에서만 completed·시각 파생. 원결석 absent/entered_at=NULL 유지. 보존 removed·legacy user·superseded 정규 대상도409이며 FK/UNIQUE500 없음. `test_completed_makeup_reconnect_and_attendance_correction_derive_completion`: 실제 입장 반복 멱등, 출석 사후 정정 시 완료도 현재 출석에서 다시 파생(reserved/completed_at=NULL).
- **V14 PASS** — `test_v14_cancel_rebook_preserves_history_and_completed_states`: 완료 고정형·completed 멤버 유지, 예약취소→withdrawn 및 취소 assignment 보존, 같은 대상 participant ID 재사용+새 assignment ID. `test_canonical_alias_source_duplicate_and_rebooking_other_target`에서 원결석 alias 변경 후에도 유효 중복예약 거부, 취소 후 다른 대상 새 예약/기존 cancelled 보존. `test_cancelled_target_reservation_can_cancel_and_rebook`은 시작 전 취소 회차의 예약을 해제한 뒤 다른 대상으로 재예약.
- **V35 PASS** — `test_v35_legacy_create_validates_absence_and_identifiers[expected/cancelled/guest/ambiguous/membership_as_user]`와 `test_v35_real_add_session_http_keeps_legacy_users_and_guest_members`: 실제 기존 `POST /classes/{id}/sessions`도 새 매칭 서비스 통과. 개인 expected 근거없음409, cancelled 원회차 대체 regular·편성 연결 유지·assignment0, legacy user UUID 유지, explicit guest membership UUID로 단일 대상 생성, 두 NULL guest 혼동 없음, ambiguous422·membership UUID를 legacy field로 제출422. 새 HTTP와 기존 API 동일 operation 재시도 결과 보존.

추가 권한/원자성: `test_http_current_permissions_idempotency_and_hash`에서 무관 강사403·본인201·동일 키 stale 재시도 동일 결과·다른 대상 키 재사용409·탈퇴 후 예전 성공 키도403·extra422. `test_instructor_retry_rechecks_current_org_membership`은 센터 counselor 소속이 inactive가 된 현재 강사의 성공키 재시도403. `test_cancel_makeup_http_and_reject_entered_cancellation`은 실제 취소 HTTP200·멱등과 이미 입장한 보강 취소409. `test_failed_assignment_insert_rolls_back_versions_and_participant`는 실제 assignment insert 실패 주입 후 참가행·assignment·class revision·participation_version 전부 롤백 및 정상 재시도1개를 확인한다.

## 잠금·후속 인터페이스

- 신규 로그인 명령은 T02 `execute_member_command`를 사용한다. User `FOR NO KEY UPDATE`→Class→모든 ClassMember ID순→모든 회차 ID순→참가행 ID순 잠금. 권한은 prior 복원 전에 현재 DB 상태로 재검사, hash는 action/class/target/body와 기존 actor+operation_key 전역 UNIQUE를 사용. flush 전용 도메인과 최상위 단일 commit/rollback 유지.
- `lock_context(db, cls)`는 **caller가 User→Class를 먼저 잠근 상태**에서 호출한다. members→sessions→participants를 정렬하고 보존 removed 참가행도 잠근다. 반환 `(sessions, participants)`.
- `reserve_locked(db, cls, canonical_member, source_session, target_session, participants, now)`는 위 잠금 하의 **flush-only** 공통 매칭이다. 반환 `(ClassMakeupAssignment, SessionParticipant)`. source alias 범위 기존 active assignment를 검사한다. T07 guest 본인 인증 명령은 guest operation 저장소/현재 자격 검증 후 같은 함수를 재사용해야 한다. guest ID를 로그인 actor_id로 대입하지 않는다.
- `assign_makeup`/`cancel_makeup`는 **로그인 최상위 명령**이다. 강사의 guest 예약은 이미 지원한다. guest 본인 자격 API 연결은 T07에서 별도로 인증해야 한다.
- `sync_completion(db, participant, now=None)`는 flush/commit을 독자 소유하지 않으며 출석 `_change`에서 호출한다. 현재 attended→completed, 그 외 출석 정정→reserved, cancelled 이력은 보존한다. AttendanceDTO의 assignment ID는 reserved/completed만 제공한다.
- T08 연구·리포트 가입 기본값 및 향후 참가행 선택 적용은 별도 소유다. 본 구현은 새 보강 참가행의 report_included=false를 명시하며 동의를 자동 추정하지 않는다.

HTTP:

```text
POST /api/v1/classes/{id}/makeup-assignments  (201)
MemberCommand + member_id,source_session_id,target_session_id
→ {class_id,revision,assignment,participant}

POST /api/v1/classes/{id}/makeup-assignments/{assignment_id}/cancel  (200)
MemberCommand
→ {class_id,revision,assignment}
```

## 미검증·인계

- guest 본인의 credential 인증/operation 경로는 T07 소유. 강사의 guest 예약, canonical 저장 상태의 조회·예약 방어는 실제 PG로 검증했으나 실제 merge 명령·guest 장기자격/지정보강 입장 교환은 미검증.
- T09 실제 출석·보강 횟수 집계/read API와 T10 회원/호스트 UI, 실제 브라우저 여정은 후속이다. T05는 assignment의 실제 출석 파생까지만 검증했다.
- 외부 LiveKit·미디어 서버·분산 WS 회수 및 실제 알림 전달은 미검증. 이번 예약·취소 API에서 이를 완료했다고 주장하지 않는다. 기존 T03 단일 프로세스 WS 회귀가 통과한 사실과 구분한다.
- 독립 리뷰는 root가 진행한다. 구현자가 자신의 리뷰 승인을 주장하지 않는다.

## 독립 리뷰 수정 round 1/5 — Important 1건 (완료 멤버 취소 대체편성 자격)

### 원인과 수정

최초 83 passed 이후 root 리뷰에서 확인한 실제 누락이다. 기존 편성이 completed 멤버의 cancelled 원회차 대체를 `attendance_kind=regular`·`makeup_for_session_id=원회차`로 정확히 생성했지만, 출석 서비스는 completed 멤버에게 assignment가 있는 개인 makeup만 허용했다. 그 결과 실제 `enter_session_as_invited`→`mark_entered`가403이었다. 멤버 정원 함수도 completed+regular를 누락하여 대체편성 생성/입장 정원 계산에서 자리를 차지하지 않았다.

T05-fix1-base 이후 수정 제품 파일은 다음 **3개**뿐이다. 스키마·모델·기존 편성 생성·실제 입장 진입점·다른 태스크 구현은 수정하지 않았다.

- `class_makeup_service.py`: `cancelled_replacement_eligible(db,participant,canonical_member,cls=None)` 추가. 현재 completed canonical 멤버, 숨김 아닌 fixed 클래스(active/completed), 같은 클래스의 makeup 대상 회차, regular 참가행의 명시적 편성 연결, 같은 클래스의 cancelled regular 원회차가 모두 일치할 때만 수료 후 대체 자격으로 인정한다. 개인 원결석·assignment는 합성하지 않는다.
- `class_attendance_service.py`: completed 멤버의 regular 참가행은 위 대체 자격을 검사한다. 기존 withdrawn/removed/waitlist_cancelled/superseded 및 excused 직접 media 접근 가드는 유지한다.
- `class_membership_service.py`: `_occupied_seats`에서도 같은 helper를 재사용하여 유효 대체편성의 expected/attended 좌석을 canonical 단위로 집계한다. 기존 개인 makeup 정원 의미는 보존한다.

추가 파일은 기존 `test_sdd217_makeup.py`의 fix1 테스트12개와 이 보고서뿐이다. 하위 에이전트·커밋·푸시·배포 없음.

### RED → GREEN과 검증

`-k review_fix1` 최초 정상 **3 failed**:

1. `test_review_fix1_completed_cancelled_replacement_actual_entry`: 실제 기존 편성으로 생성한 취소 대체의 실제 `enter_session_as_invited`가403.
2. `test_review_fix1_completed_replacement_reserves_creation_capacity`: 완료 멤버2명을 정원1 대체에 넣어도 성공해 정원409 assertion 실패.
3. `test_review_fix1_completed_replacement_two_connections_last_seat`: 실제 별도 PG 연결2개에서 두 명의 completed 대체 참여자 실제 입장이 모두403. 두 excused가 반환한 마지막 한 자리를 실제 입장으로 경쟁하는 장면이다.

최소 수정 후 동일 명령 **3 passed, 30 deselected**. 실제 입장 attended/entered_at 저장, class/member completed 유지, 원회차 expected 보존, assignment0. 생성 정원 초과는409·회차 전체 롤백. 실제 경합은 선행 User→Class→members→sessions 잠금을 보유한 첫 연결이 실제 입장 후 커밋하고, 두 번째 실제 입장이 최신 좌석을 확인하여409 `session_capacity`. 최종 attended1명·초과0·assignment0 확인.

최초 경합 테스트가 Class SQL만 감지하여 실제 선행 User 잠금 대기를 놓쳤고, 계측 대기에서 중단한 테스트 하네스 문제는 제품 RED로 계산하지 않았다. 기존 잠금 순서에 맞게 모든 FOR 잠금 시도를 계측하고 두 번째 연결에5초 lock_timeout을 넣은 뒤 위 정상 RED3개를 다시 확인했다. 제품 잠금 순서를 바꾸거나 우회하지 않았다.

추가 음성 경로9개 `test_review_fix1_completed_replacement_scope_stays_explicit[no_link/source_completed/foreign_source/source_makeup/regular_target/rolling/left/removed/archived]`는 명시 대체가 아닌 완료 멤버의 일반 활동 자격을 넓히지 않았음을 입장 자격 false·좌석0·assignment0으로 확인한다.

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg \
 tests/pg/test_sdd217_makeup.py tests/pg/test_sdd217_attendance.py \
 tests/pg/test_sdd217_membership.py tests/pg/test_sdd216_lifecycle.py \
 tests/pg/test_sdd216_write.py tests/pg/test_sdd216_review_regressions.py -q --tb=short
# 119 passed, 5 warnings in 14.68s
```

직접 변경한 좌석 함수의 T02 멤버 정원 회귀만 기존 허용 검증에 추가했다. 전체 BE는 미실행이다. 경고는 기존 crypt 및 T03 loopback WebSocket 의존성 deprecation이다. `git diff --check`, fix1 변경 Python4파일 AST PASS. R3/V35의 완료 고정형 cancelled 대체편성은 이제 생성뿐 아니라 실제 입장과 생성·두 연결 정원까지 PASS다. helper는 현재 저장된 편성 자격 판정이며 guest credential 교환·브라우저·외부 LiveKit 검증을 대신하지 않는다. 기존 미검증과 T07/T09/T10 인계는 유지한다.
