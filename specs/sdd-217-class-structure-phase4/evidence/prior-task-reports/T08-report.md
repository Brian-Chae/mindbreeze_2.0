# T08 구현 보고 — 가입 선택 동의·보관·코드 회전

- 승인된 R4 / V20~24,V39. 전용 워크트리 `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217`, 브랜치 `sdd/217-class-structure-phase4`.
- 기존 T00~07 변경 보존. 모델/마이그레이션/FE 수정 없음. 하위 에이전트·커밋·푸시·배포 없음. 형제 워크트리의 변경·테스트는 승인된 `require_escalated`로 실행했다. 기존 venv는 실행만 했다.
- TDD 및 verification-before-completion 적용. 전체 BE 반복 대신 요청된 직접 관련 회귀만 실행했다. 실제 환경파일/운영 자격증명/외부 전달 없음.

## 변경 파일

신규:

1. `backend/app/services/class_member_consent_service.py`: 본인 동의 조회/변경, O3 가입 증거/사본, 클래스 범위 명시 철회, 코드 회전, canonical 원본·사본 스크럽, exact member ID operation 응답 정리, 기존 회차 명시 선택 잠금.
2. `backend/app/schemas/class_consents.py`: extra=forbid, 누락 선택값 보존, 명시 null 선택 거부, 철회 reason 필수 DTO.
3. `backend/tests/pg/test_sdd217_consent_retention.py`: 실제 migrated PG 및 실제 Bearer/guest HTTP 검증18개.

연계 파일의 T08 가산 변경:

4. `backend/app/api/v1/class_membership.py`: `GET/PUT /{id}/me/consents`, `POST /{id}/me/research-withdrawal`, `POST /{id}/access-code/rotate`.
5. `backend/app/services/class_guest_service.py`: 가입 원선택 ClassMemberConsentEvent 연결. 기존 공개 가입 operation의 HMAC/PII 미저장/토큰 원문 미저장 유지.
6. `backend/app/services/class_membership_service.py`: `ensure_expected` 및 실제 가입/재가입의 `_activate_future` 생성에 같은 사본 복사 helper 연결.
7. `backend/app/services/class_makeup_service.py`: 개인 보강 신규 참가행에 같은 helper 연결.
8. `backend/app/services/class_write_service.py`: 취소 회차 대체 편성의 직접 신규 참가행에도 같은 helper 연결. 기존 T05 로직/식별자 계약 보존.
9. `backend/app/services/research_consent_service.py`: O3를 기존 ResearchConsent/current+append-only event에 복사, class 범위 flush-only 철회, 기존 회차의 동일값 명시 선택도 override 표시. 기존 admin 전역 철회 유지.
10. `backend/app/services/session_service.py`: 기존 리포트 회차 선택 override 표시 및 공통 User→Class→members→sessions→participants 잠금 연결.
11. `backend/app/services/retention_sweep_service.py`: 클래스 멤버 연결 참가행은 기존 개별 회차 PII 날짜 계산에서 제외하고 canonical 스크럽으로 처리. 기존 raw/export hold 정책 유지.
12. `backend/app/services/report_email_service.py`: 실제 request/deliver/resend에 스크럽 가드 및 최신 참가행 재조회·행 잠금. 스크럽 후 이메일 복원/발송 방지. 기존 정상 다른 참가행 발송은 회귀 검증.
13. 이 보고서.

root가 승인한 연계 범위: report_email 실제3경로, 보강·취소 대체 directcreate 사본, exact member ID의 기존 operation 결과 PII 정리. 스키마는 통합 담당 단독 소유로 유지했다.

## RED → GREEN

- 최초4개: 서비스 미구현 ImportError 및 실제 가입 사본 PII/연구 동의 누락으로 RED. 초기 회차 fixture host_state 누락은 하네스 오류로 바로잡고4개 제품 RED를 다시 확인했다. 서비스·원동의·두 생성 경로 연결 후4 passed.
- HTTP/보관: 신규 경로404와 scrub helper 부재 RED → 실제 Bearer/guest scope·보관 경계 연결 후7 passed. 코드 회전은 그 전에 구현한 경로에 대한 후속 회귀로 검증했으며 해당 개별 테스트의 선행 RED는 주장하지 않는다.
- 보강·재발송: 보강 사본 PII/원동의 누락, scrubbed 참가자 resend가 원문 주소를 다시 저장·발송하는2개 RED → helper/가드 후10 passed.
- 숨김 회차 철회: affected_count=0 RED → include_hidden/include_removed canonical 범위로 확장하고 false 기본값 복사가 withdrawn 상태를 덮지 않게 해12 passed.
- 오래된 ORM 상태: DB에서는 scrubbed인데 기존 객체를 재사용해 resend가 성공하는 RED →3메일 경로 populate_existing+row lock 후16 passed.
- 고지 버전: 명시 연구 선택 없이 research_notice_version만 바꿔 원동의를 소급 변경하는 RED → 명시 선택 필요422, 새 버전 명시 true는 새 origin/시각/append-only event를 생성하여17 passed.
- 명령 재응답: 정확한 member ID가 있는 과거 operation 결과에 guest 이름·메일이 남는 RED → 같은 스크럽 트랜잭션에서 해당 DTO 필드만 null 처리하여18 passed. 독립 invite.email 및 다른 member 이름 보존 assertion 포함.
- 스크럽 저장 실패 주입, 실제 sweep 활동 중 멤버 보존, pending report mail 차단, 기존 uploaded 배치 취소 및 두 클래스 동일 subject 격리는 관련 추가 회귀이며 각각 선행 RED를 주장하지 않는다.

초기 fixture 수정 호출1회는 cwd backend에서 backend 경로를 중복 지정해 실패했다. 올바른 경로로 재실행했다. 제품 RED로 계산하지 않았다.

## 최종 검증 명령·결과

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg \
 tests/pg/test_sdd217_consent_retention.py tests/pg/test_sdd217_guests.py \
 tests/pg/test_sdd217_makeup.py tests/pg/test_sdd216_reminders.py -q --tb=short
# 102 passed, 1 warning in 9.03s

DATABASE_URL=sqlite:// \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest tests/test_sdd209_b11_research_consent.py \
 tests/test_sdd209_b13_research_export.py tests/test_sdd209_b12_retention_sweep.py \
 tests/test_report_email.py -q --tb=short
# 80 passed, 2 warnings in 7.67s
```

직접 변경 Python12개 AST parse 및 `git diff --check` PASS. PG 경고는 기존 crypt deprecation, SQLite는 기존 crypt/argon2 deprecation. 신규 실패/기준선 실패 없음. 전체 BE·전체 FE·브라우저·실장치·운영 검증은 실행하지 않았다. PG 회귀에는 기존 T07의 실제 두 연결 테스트도 포함되지만 T08 새 명령의 별도 두 연결 경합 증거로 확대하지 않는다.

## Verify별 증거

- **V20 API/PG PASS**: `test_v20_default_false_and_optional_entry`, `test_real_http_login_guest_scope_and_payload`. 보고/연구/알림 기본 false, 연구 current 행 없음=미동의, 미선택 상태 실제 guest-entry 성공. 읽기는 guest read 및 실제 로그인 Bearer만, anonymous401, 타인403/404. read PUT401, extra422, 고지 없는 true422. 현재 active/waitlisted만 기본값 변경.
- **V21 PG PASS**: `test_v21_future_only_override_and_historical_preserved`, `test_explicit_session_same_value_marks_override`. 미래 미입장·미종료만 전파. 개별 report/research override, entered, completed snapshot 보존. 기존 session 명시 false→false도 override 저장. 기존 회차 명시 선택과 기본값 변경은 같은 잠금 순서로 직렬화.
- **V22 PG PASS + 기존 export 회귀**: `test_v22_join_choice_evidence_and_future_copy`, `test_makeup_new_participant_copies_origin_and_pii`, `test_research_notice_cannot_rewrite_original_selection_without_choice`. 가입 선택은 버전/선택시각/origin을 class append-only 사건으로 남기고 participant.research_origin_id 및 ResearchConsent.origin_id/current/event로 연결. 정규·개인 보강 생성은 같은 helper, 재확인 gate 없음. 새 고지 명시 선택은 새 origin이며 이전 원선택 event 보존. 기존 연구 가명/hold/export 조건 회귀80개 중 관련 파일 모두 통과.
- **V23 PG PASS**: `test_v23_canonical_scrub_boundary_active_and_no_resurrection`, `test_v23_scrub_transaction_failure_and_existing_sweep_active_preserved`, `test_scrubbed_report_resend_cannot_restore_email`, `test_scrubbed_request_and_pending_delivery_no_email`, `test_scrubbed_database_state_rechecked_before_resend`, `test_scrub_exact_member_operation_results_preserve_independent_invite`. canonical 마지막 attended.ended_at 및 canonical membership 종료 시각 중 늦은 날짜+90일 직전 미삭제/정각 삭제. active/종료시각 부재는 created_at 등 대체 없음. alias/member/participant PII 원자삭제·스크럽 표식. 저장 실패 전부 rollback. 사본 생성은 marker를 전파하고 원문 재복사 금지. pending report status cancelled 및 실제 발송3경로 차단. 기존 operation 결과 중 명시 member ID DTO만 비움.
- **V24 API/PG PASS**: `test_v24_rotate_old_code_rejected_existing_grant_and_reminder`, 실제 HTTP 권한 테스트. 기존 class_code_service 발급+DB/advisory 잠금 재사용. 이전 코드 신규 가입 거부, 기존 읽기 grant 유지(entry_ver 불변), 동일 operation 같은 결과. rotate는 기존 manage 권한. 별도 opt-in 없이 guest 리마인더 없음(기존 sender는 guest 전체 제외).
- **V39 PG PASS**: `test_v39_explicit_withdrawal_reaches_ended_and_preserves_evidence`, 숨김/제거 사본 테스트, `test_class_withdrawal_same_subject_other_class_and_export_unchanged`, `test_class_withdrawal_cancels_existing_uploaded_batch_without_global_request`. false 기본값 변경은 미래 current declined만, 명시 철회는 과거/종료/숨김/제거를 포함한 canonical current false+withdrawn_at+export_state=withdrawn 및 append-only withdrawn. 원 consented_at/origin/이전 consented 사건 보존. 기존 `_pending_consents` 제외 및 uploaded batch cancel 작동. **ResearchWithdrawalRequest 생성 안 함**: 전역 `_withdrawn_subject` 차단을 가산하지 않아 동일 subject 다른 클래스의 현재/신규 동의를 막지 않는다. 기존 admin 전역 subject 철회 의미는 유지.

## root 판정 반영

1. 클래스 본인 철회는 canonical 본인 클래스 current 행만 수정한다. 전역 ResearchWithdrawalRequest를 생성하지 않는다. 이미 ack된 외부 Spark 데이터 삭제를 수행했다고 주장하지 않는다.
2. member FK 없는 ClassEmailInvite를 이메일 일치만으로 guest로 귀속해 삭제하지 않는다. 독립 강사 초대 메일 보관 정책은 T08에서 변경하지 않았다. ClassOperation/ClassMemberOperation의 **명시 member_id/id가 scrubbed canonical 범위인 응답 DTO**는 정리한다.
3. SessionEmailInvite는 기존 회차 보관 정책을 유지하며 해당 회차·원문 이메일 사본만 처리한다. 이메일만의 전역 동일인 매칭/병합/삭제 없음.
4. guest reminder_opt_in은 다른 선택과 분리해 저장한다. 기존 sender가 guest 전체 제외하므로 opt-in=true의 새로운 전달 채널은 이번에 추가하지 않았다.

## T09/T10 인계

```python
get_consents(db,class_id,*,user_id=None,member_credential=None)
# -> consent_view, 로그인 본인 또는 authenticate_guest(scope=read)
update_consents(db,class_id,command,*,user_id=None,member_credential=None,now=None)
# -> {class_id,revision,consents,updated_future_participant_ids}
withdraw_research(db,class_id,command,*,user_id=None,member_credential=None,now=None)
# -> {class_id,revision,affected_count,withdrawn_at}, 읽기 grant 허용
rotate_access_code(db,class_id,user_id,command)
# -> {class_id,revision,access_code}, manage
copy_member_defaults(db,member,participant,*,report=True,research_choice=True,pii=False)
# flush-only. 새 사본/검증된 미래 행에서만 사용. override 및 scrub marker 보존.
scrub_expired_guests(db,*,now=None,execute=True,apply_from=None)
# flush-only. sweep가 commit을 소유. canonical 범위/잠금 내부 수행.
```

- HTTP는 모두 기존 class_membership router에 있으므로 별도 router 등록 불필요. Guest 헤더는 `X-Class-Member-Credential`만. class_entry를 부모 자격으로 재사용하지 않는다.
- 기본값 DTO에는 연구 가명키/subject, 원문 PII, 타인 동의가 없다. 선택 notice 변경만으로 원선택을 바꾸지 말고 새 연구 true 선택을 제출한다.
- 새 동의 PUT는 부분 입력이다. 미지정 필드를 false/null로 전송하지 않는다. 회차 override/이미 입장/종료는 updated_future_participant_ids에 없다.
- 과거/이탈/완료 guest 기본값 편집은 불가, 명시 연구 철회는 읽기 자격으로 가능하다. reason 필수. 프론트에서 false 기본값과 명시 철회 동작/문구를 구별한다.
- V31/V38의 실제 서버 연결 브라우저 여정, 동의 설정 UI·종료 본인 리포트는 T09/T10 후속이다. T08에서 브라우저 PASS로 기록하지 않는다.

## 남은 검증/제한

- T08 신규 명령의 별도 실제 두 연결 경합, 실제 메일 브로커/Resend/Redis, 실서버/브라우저, 외부 S3/Spark 삭제·ack, 실장치 검증 없음. 기존 PG 회귀와 외부 효과 증거를 구분한다.
- 이미 ack된 외부 연구 DB 데이터의 클래스 범위 삭제 완료를 새 전역 철회 요청으로 가장하지 않았다. 현재 DB 철회/기존 신규 export 제외 및 미ack 배치 취소까지 증거가 있다.
- 클래스에 연결되기 전 legacy member_id=NULL guest는 기존 회차 retention 정책 대상이다. 신규 canonical 스크럽과 임의 동일인 추정으로 합치지 않았다.
- 독립 코드 리뷰와 최종 승인 판정은 root 소유이다.

## 독립 리뷰 수정 round 1/5 — canonical alias의 최근 종료일 누락

Important finding1건을 수정했다. `T08-fix1-base` 이후 제품/테스트 변경은 `backend/app/services/class_member_consent_service.py`, `backend/tests/pg/test_sdd217_consent_retention.py`2개이며 이 보고서에 증거를 가산했다. 모델/마이그레이션/다른 태스크 변경/하위 에이전트/커밋/푸시 없음.

### 원인과 최소 수정

- 스크럽은 canonical root의 status별 종료 시각1개와 전체 참석 회차 종료만 비교했다. 실제 `merge_guests`는 active source를 과거 left target에 병합할 수 있고, source는 현재 removed_at으로 종료되지만 target.left_at은 과거로 유지된다. root만 보면 병합 직후 source의 최근 개인정보까지 즉시 만료 처리되는 결함이었다.
- canonical root+전체 alias의 status별 종료 시각을 모아 최댓값을 계산하고, 전체 canonical 참석 회차 ended_at의 최댓값과 다시 비교해90일 경계를 적용한다.
- canonical 범위에 active 등 아직 종료되지 않은 행 또는 종료 상태지만 해당 종료 시각이 없는 행이 있으면 스크럽을 보류한다. created_at/joined_at/다른 멤버의 날짜로 종료 근거를 추정하지 않는다.
- 앞 보고서의 “canonical membership 종료 시각” 설명은 이번 수정으로 **canonical 범위 전체의 멤버십 종료 시각 최댓값**으로 정정한다. PII 삭제/동의 증거/export hold/이메일 독립 초대 정책은 기존대로 유지했다.

### RED → GREEN 및 최종 검증

신규 테스트3개:

- `test_fix1_merge_recent_source_into_old_left_target_retains_until_alias_end_plus90`: 실제 가입2명→91일 전 left target→actual preview/merge, source.removed_at=현재/target.left_at=과거 확인. 병합 직후 및 source 종료+90일1µs 전은 원본·사본 전부 보존, 정각에는 member2+participant2 원자스크럽.
- `test_fix1_canonical_alias_without_end_defers_scrub_without_date_guess[active/removed]`: alias가 active 또는 removed인데 종료 시각 없음. 다른 canonical root는 충분히 오래된 종료 상태여도 날짜를 추정해 전체 스크럽하지 않는다.

수정 전3개 모두 `members=2`, 기대0으로 실패한 **3 failed RED**. 최소 변경 후 **3 passed GREEN**.

```bash
cd '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0-sdd217/backend'
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_consent_retention.py -k fix1 -q --tb=short
# RED: 3 failed, 18 deselected / GREEN: 3 passed, 18 deselected

PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_consent_retention.py -q --tb=short
# 21 passed, 1 warning in 1.72s

DATABASE_URL=sqlite:// \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest tests/test_sdd209_b12_retention_sweep.py -q --tb=short
# 20 passed, 1 warning in 1.83s
```

직접 변경 Python2파일 AST parse 및 `git diff --check` PASS. 두 경고는 기존 crypt deprecation. 해당 finding/직접 retention 회귀만 실행했고 전체 BE·FE·외부 효과 검증은 반복하지 않았다. 신규 인터페이스/후속 태스크 계약 변화 없음. 독립 재리뷰/최종 승인 판정은 root 소유이다.
