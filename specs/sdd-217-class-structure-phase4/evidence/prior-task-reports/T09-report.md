# T09 구현 보고 — 본인 읽기 모델·과거 리포트 권한

작업: 승인된 SDD-217 T09/R5/V25~27. 전용 `mindbreeze_2.0-sdd217` 워크트리에서만 수정. 하위 에이전트·모델/마이그레이션 변경·커밋·푸시·배포 없음. 기존 변경은 `T09-base/status.txt` 및 담당5파일 스냅샷으로 보존했다. sibling 변경·테스트는 한국어 사유의 require_escalated로 수행했으며 거절/우회 없음. TDD와 verification-before-completion을 적용했다.

## 변경 파일

1. `backend/app/services/class_read_service.py`: 정규 클래스의 completed/left/removed 및 waitlisted 본인 메타 읽기 복원. 본인 membership/attendance 서비스, canonical 유효 참가행·리포트 FK 판정, distinct 집계, 가입 이전 metadata 투영, 현재 역할/상태/자격 capability 가산. 기존 클래스 detail/sessions 응답에 같은 본인 DTO 가산. 214 legacy 목록의 필드와 상수 질의수 계약 보존.
2. `backend/app/schemas/class_parent.py`: class summary의 membership/attendance_summary/capabilities, session item의 participation_scope/attendance/makeup/approved_report_ids/capabilities 가산. 기존 필드·envelope 유지.
3. `backend/app/api/v1/classes.py`: me/membership 및 me/attendance GET 가산. 기존 class list/detail/session은 로그인 인증을 유지한다. 기존 legacy 응답의 불필요한 새 default 필드 노출은 exclude_unset으로 방지한다.
4. `backend/app/api/v1/reports.py`: 기존 GET /reports/{id} 한 경로에만 optional login + X-Class-Member-Credential read 지원. 그 외 쓰기/PDF/승인/공유 경로 및 역할 dependency 유지.
5. `backend/app/services/report_service.py`: 현재 강사/관리자 경로를 유지하면서 본인 멤버(상담사 역할을 가진 일반 회원 포함)·guest는 승인된 개인 client/완료 회차 리포트만 canonical 소유권으로 읽는다. 타인/미승인/group/추측ID/타기관/숨김404. 본인 읽기에서는 기존 report_scope 필터 후 raw/media/URL을 제거하고 pdf_url/report_email/generation_error를 null로 반환한다.
6. `backend/tests/pg/test_sdd217_read_access.py`: 신규 PG13개. 실제 Bearer/guest 헤더 HTTP와 실제 guest merge 후 과거 두 회차/FK 보존·집계 포함.
7. `backend/tests/test_sdd217_read_access.py`: 신규 SQLite HTTP2개. 본인 membership 가산·401/404 및 승인 전/후 raw URL 차단.
8. 이 보고서와 T09 로그/기준 스냅샷(계획 폴더의 로컬 산출물).

## RED → GREEN 및 중간 실패

- 최초 신규 PG8개 **8 failed RED**: me 라우트404, 정규 departed 목록 소실, 미승인 리포트200, capability 누락. 구현 후 **8 passed**.
- 추가 회차 DTO·상담사 역할 회원·타기관 검증 **3 failed RED +8 passed**. 회차 가산과 개인/운영 역할 분기 후 **11 passed**.
- 실제 guest merge→두 과거 참석/리포트 원본 FK 검증을 추가하여 PASS. 병합 자체는 T07 서비스를 실행하며 FK를 변경하지 않는다.
- 관련 SQLite75개에서 신규 회귀2개(214 legacy exact-field·목록 N+1)를 확인했다. legacy 가산 응답을 생략하고 목록의 membership 존재 조회를 묶어 두 기존 테스트를 그대로 통과시켰다. 테스트 기대 완화 없음.
- 216 PG HTTP staff 회차 목록2개에서 projection의 started_at 누락을 발견했다. 기존 조회 select에 started_at을 가산하여 해결했다.
- 마감 자체점검에서 원결석과 유일 대상회차가 같은데 request_makeup=true인 오류를 **1 failed RED +12 passed**로 확인했다. 서로 다른 source/target이 있을 때만 true로 보완했고, 숨김 클래스의 로그인 리포트도404로 일치시켰다. 이후 PG 관련 **26 passed**.
- 최초 테스트 파일 작성 시 backend 경로 중복, 최초 GREEN 실행 시 cwd 오류의 두 실행은 테스트가 수집되지 않았으므로 제품 RED/GREEN으로 계산하지 않는다. 해당 명령을 올바른 backend cwd에서 다시 실행했다.

## 최종 검증

환경은 `.superpowers/sdd/plan/environment.md`의 합성 PG와 기존 Python venv 실행만 사용. 실제 환경파일·자격증명 미사용. 공유 PG 시작/정리 없음.

```bash
# cwd: mindbreeze_2.0-sdd217/backend
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg \
 tests/pg/test_sdd217_read_access.py tests/pg/test_sdd216_http.py \
 tests/pg/test_sdd216_access.py tests/pg/test_sdd216_observer.py -q --tb=short
# 26 passed, 1 warning in 2.39s — T09-regression-pg.log

DATABASE_URL=sqlite:// \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest tests/test_sdd217_read_access.py tests/test_sdd214_read_api.py \
 tests/test_sdd216_capabilities.py tests/test_sdd216_read_followup.py \
 tests/test_report.py -q --tb=short
# 77 passed, 2 warnings in 23.91s — T09-regression-sqlite.log (마지막2파일 수정 후 재실행)
```

Python 변경7파일 AST parse 및 git diff --check PASS. 기존 crypt/argon2 deprecation만 남고 SQLite에서 PG marked module import로 생긴 경고는 독립 fixture로 제거했다. 전체 BE/FE를 실행/통과했다고 주장하지 않는다.

## Verify 증거

- **V25**: `test_v25_before_join_only_metadata`, `test_v25_existing_sessions_dto_additive_and_session_capability`. 합류 전의 잘못 남은 본인 참가/리포트 사본도 attendance=null/report IDs=[]로 숨긴다. 참가 근거 없는 회차를 absent로 추정하지 않는다. 취소·makeup은 기존 progress 정규 분모에서 제외하며 결석에 점수·추이·서사를 만들지 않는다.
- **V26**: departed3상태·unapproved/group·guest alias·타기관/logout·상담사 역할 회원 테스트. login/guest 현재 인증 재사용, 본인 완료회차의 승인된 client report만200. 타인/미승인/group/추측/타기관/숨김404. guest read로 기존 /members는401이며 완료/이탈 login은403/404. 기존 raw material/원문·미디어 접근 권한을 부여하지 않는다.
- **V27**: distinct counts/실제 병합 두 이력/현재 role capability/admin 경계/보강 source≠target. 참석은 유효 canonical participant/session 기준 distinct이며 attendance event3개나 cancelled+completed assignment 이력이 합산되지 않는다. 보강 완료는 distinct source만 집계하고 참석에 다시 더하지 않는다. admin의 manage_members/merge_guests와 correct_attendance/assign_makeup을 구분하며 제거된 assistant는 다음 HTTP에서404. 기존 214 exact-field/N+1 및 216 capabilities/read followup/HTTP/access/observer 회귀 통과.

## T10 인터페이스·hook 연결

신규 GET 두 개는 `settings.class_scheduling_enabled` gate를 사용한다.

- `GET /api/v1/classes/{id}/me/membership`: `{class_id,revision,member:MemberDTO,attendance_summary:{attended,absent,excused,makeup_reserved,makeup_completed},capabilities:Record<string,bool>,consents}`. consents는 T08 `consent_view`와 동일. member.name은 canonical의 pii_scrubbed_at이 있으면 null이며 alias 원문 PII를 가져오지 않는다.
- `GET /api/v1/classes/{id}/me/attendance`: `{sessions:[{id,seq,scheduled_at,status,session_kind,participation_scope,attendance:AttendanceDTO|null,makeup:MakeupAssignmentDTO|null,approved_report_ids:string[],capabilities}],total}`. scope=`before_join|eligible|outside_membership`. attendance/assignment의 ID와 원본 member_id는 병합 이전 FK를 보존한다. canonical_member_id가 현재 주체다.
- 기존 로그인 class list/detail: 정규 클래스 또는 본인 멤버가 있는 summary에는 `membership:MemberDTO|null,attendance_summary|null,capabilities`가 가산된다. 기존 legacy 목록은 종전 필드 그대로. detail은 기존 manage/invite/schedule/host_request도 유지한다.
- 기존 로그인 `GET /classes/{id}/sessions`: 원래 session item 필드/envelope 그대로, 본인 회원에게 me/attendance 필드를 가산한다. 강사/관리자에게는 해당 회차 correct_attendance/assign_makeup bool을 가산한다. admin은 두 clinical capability=false다.
- 로그인은 Bearer access 토큰, guest는 `X-Class-Member-Credential` 장기 자격을 신규 me GET과 기존 `GET /reports/{id}`에 보낸다. read grant의 excuse/edit_consents/request_makeup 등 활동 capability는 false다. rejoin은 별도 전용 exchange 흐름용이며 left+active class에서만 true. 로그인과 guest 헤더가 함께 있으면 로그인 본인 주체를 우선한다.
- member capability: `manage_members,correct_attendance,assign_makeup,merge_guests,leave,cancel_waitlist,rejoin,excuse,request_makeup,edit_consents,read_own_reports` 모두 bool. 회차 item capability는 `excuse,correct_attendance,assign_makeup,read_own_reports`다. 클래스 단위는 해당 가능한 회차 존재를 요약하고 회차 버튼은 item 값을 사용한다.
- T10에서 `useMyClassMembership`, `useMyClassAttendance`에 해당하는 query hook과 guest header 전달이 필요하다(이름 제안). 기존 classes detail/sessions hook에 가산 타입 연결. T02/T03/T05/T07/T08 성공 후 membership/attendance/class detail/sessions를 같은 class ID로 무효화한다. 본인 리포트는 승인 ID로 기존 report detail GET을 사용하고 guest header를 전달한다. 새로운 보고서 경로나 공개 URL을 만들 필요는 없다.

## 남은 미검증·리뷰 사항

- 전체 BE/FE/실브라우저/모바일 뷰포트·실장치·운영 데이터·실제 외부 메일/미디어는 검증하지 않았다. T10/T11 여정 검증이 남는다.
- legacy 목록 상수 질의수는 기존 RD12 테스트로 확인했다. 정규 클래스 다건의 가산정보는 클래스별 조회가 남아 있으며 별도 부하검증/일괄화는 미수행이다. 본인 attendance 투영도 회차별 participant DTO의 보강 조회를 재사용한다. 새로운 집계 correctness를 성능보장으로 주장하지 않는다.
- 독립 코드 리뷰 및 최종 승인은 root/Brian 소유다.
- root의 `T09-review.diff`797줄 스냅샷 이후 마지막 가산 변경: class_read_service의 request_makeup source/target distinct, report_service의 hidden class404, PG read 테스트1개. 새 diff 생성이 필요하다.

## 독립 리뷰 수정 round 1/5 — 수료 보강 이력·예약 capability 일치

독립 Important2건을 수정했다. 이번 변경 파일은 `backend/app/services/class_read_service.py`, `backend/app/services/class_makeup_service.py`, `backend/tests/pg/test_sdd217_read_access.py`, 이 보고서4개다. 공유 판정 추출은 root가 명시 승인했다. 정규 다건 N+1은 이번 수정으로 확장하지 않았다. 하위 에이전트·모델/마이그레이션 변경·커밋·푸시·배포 없음.

### 원인·수정

1. 수료 후 지정 보강 숨김: `_participation_scope`가 `completed_at` 이후 회차를 일괄 outside_membership으로 분류하여 실제 T05 참가자격을 가진 expected 보강도 attendance/makeup=null로 숨겼다. 합류 이전 메타 제한을 먼저 유지한 채, completed+실제 참가행+비취소 대상에 한하여 기존 `eligible_participant` 판정을 재사용한다. 이 함수는 canonical의 유효 개인보강 assignment와 원결석, 또는 `cancelled_replacement_eligible`의 명시 취소 대체를 확인한다. 비지정 future expected는 계속 outside이며 left/removed 예외를 열지 않았다.
2. 잘못 켜지는 request_makeup: 날짜·상태만으로 대상을 추정하여 이미 regular/expected 참가행이 있는 대상·alias 대상·superseded 대상·만석도 true였다. `class_makeup_service.reserve_locked`의 기존 검증을 `validate_reservation(db,cls,member,source,target,participants,now)`로 그대로 추출하고, 실제 reserve와 읽기 capability가 동일한 원결석/대상 회차 쌍으로 호출한다. 원결석 기존 배정/alias, 대상 기존 참가행/제거/superseded/예약, 정원 및 상태·시간 조건을 공유한다. 읽기는 SELECT만 하며 불필요한 잠금·commit·행 생성·version 변경·flush·감사/전달효과를 추가하지 않는다. 실제 reserve의 잠금 호출 구조와 flush 이후 쓰기 블록은 기존 위치에 유지했다.

### RED → GREEN·증거

- 신규9개 중8개 제품 RED, 재사용 가능한 withdrawn makeup 양성1개 기존 PASS. superseded 첫 fixture는 다른 회차 참조로 실제 PG 복합 FK에 위배되어 같은 회차의 다른 참가행으로 바로잡았고, 이후 **8 failed +14 passed**의 제품 RED를 다시 확보했다(`T09-fix1-red.log`).
- 수정 후 **T09 PG22 passed**(`T09-fix1-green.log`).
- `test_review_fix1_completed_assigned_makeup_visible_but_unassigned_outside` 4조합(login/guest × 개인보강/취소대체): 미래 expected가 eligible이고 원 participant/assignment 또는 replacement source ID를 표시한다. 무관한 미래 expected는 outside+attendance=null이다. guest 두 조합은 실제 `guest_entry`→출석까지 성공하며 부모/멤버 completed를 유지한다.
- `test_review_fix1_makeup_capability_matches_actual_reservation_blockers` 4조건: regular_expected/alias_expected/superseded/만석이면 capability=false, 실제 `reserve_locked`도 동일 `target_participant_exists`/`session_capacity`409다.
- `test_review_fix1_reusable_withdrawn_makeup_capability_matches_reserve`: 재사용 가능한 withdrawn 보강은 true이며 실제 reserve가 같은 target participant ID를 재사용해 reserved를 생성한다. 읽기 전후 member/class/participation/entry version 및 assignment수가 변하지 않는다.

### 관련 검증

```bash
# cwd: mindbreeze_2.0-sdd217/backend
PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test \
 '/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python' \
 -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_read_access.py \
 tests/pg/test_sdd217_makeup.py tests/pg/test_sdd217_guests.py \
 tests/pg/test_sdd216_http.py tests/pg/test_sdd216_access.py \
 tests/pg/test_sdd216_observer.py -q --tb=short
# 118 passed, 1 warning in 13.30s — T09-fix1-pg.log (UTC 정합화 후 최종)
```

추출된 공유 검증의 원래 쓰기 회귀(T05/T07), 두 연결 병합·복구 및216 HTTP/관리자/참관 권한을 포함해118개 통과. fix1 Python3파일 AST 및 git diff --check PASS. SQLite는 같은 기존77개 명령을 `T09-fix1-sqlite.log`에 재실행했다. 전체BE/FE·실브라우저·실장치·정규다건 부하 검증은 이번에도 미수행이다. T10 DTO 형태는 같고 기존에 숨겨지던 유효 수료 보강 attendance/makeup만 정상 복원된다.

최종 fix1 관련 검증: **PG118 passed(13.30s), SQLite77 passed(26.84s)**. 공유 검증을 읽기에서 재사용하면서 SQLite의 timezone 없는 scheduled_at과 aware now 비교가 TypeError인 회귀1개가 드러났고, 기존 `class_conflict_service.utc`로 양쪽을 정규화하여 동일한 예약 시간 의미를 유지했다. 이 수정 후 두 관련 명령을 다시 실행해 전부 통과했으며 새 기준선 실패는 없다. 최종 diff는 위4파일 외 변경을 포함하지 않는다.
