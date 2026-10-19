# T00-S — 승인된 SDD-217 가산 스키마 구현 결과

- 상태: **스키마 구현 및 지정 검증 PASS**. 제품 서비스·라우트·프론트 구현은 이 작업 범위 밖이다.
- 기준/결과 revision: `e036a0000056` → 단일 `e036a0000057` (`down_revision=e036a0000056`). 로컬 합성 PG에서 head 적용 및 동일 head 재적용 PASS.
- 정본: `specs/sdd-217-class-structure-phase4/api-contract.md` §8, canonical 불변식, §2/4의 guest 멱등 저장소.

## 변경 파일

- `backend/app/models/class_membership.py`: ClassAttendanceEvent, ClassMakeupAssignment, ClassGuestCredential, ClassGuestRecovery, ClassGuestMerge, ClassMemberOperation, ClassGuestJoinOperation, ClassMemberConsentEvent, SessionPresenceLease 9개 신규 모델.
- `backend/app/models/class_program.py`: canonical_member_id, research_consented/research_notice_version/research_selected_at/research_origin_id, reminder_opt_in 및 canonical DB 방어.
- `backend/app/models/session.py`: participation_version(bigint), 체크인/presence/동의 override/origin/superseded 필드 및 같은 회차 superseded 복합 FK.
- `backend/app/models/research.py`: ResearchConsent.origin_id nullable UUID.
- `backend/app/models/__init__.py`: 신규 모델 등록.
- `backend/alembic/versions/e036a0000057_sdd217_membership.py`: 단일 가산 migration 및 새 감사 3종 append-only PG 트리거.
- `backend/tests/pg/test_sdd217_schema.py`: 실제 PG 스키마·제약·감사·경합·업그레이드 검증 10개.

## RED → GREEN 및 검증

1. 구현 전 실제 head056 PG에서 새 schema 파일 실행: **6 failed**. 새 테이블 없음·canonical 필드 없음·신규 모델 없음으로 모두 예상한 assertion 실패.
2. 057 migration 적용 후 첫 schema 검증: **6 passed**.
3. 추가 지정 최종 PG 검증: **24 passed, 기존 crypt deprecation 1경고**.
   - `PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test <기존 Python> -m pytest --confcutdir=tests/pg tests/pg/test_sdd217_schema.py tests/pg/test_sdd216_schema.py tests/pg/test_sdd216_members.py tests/pg/test_sdd216_lifecycle.py tests/pg/test_sdd216_entry.py -q`
   - 새 스키마 10개 + 기존 216 schema/members/lifecycle/entry 14개.
   - source 원결석 유효 reserved/completed 최대 1개, cancelled 이후 재예약 허용, invalid status/같은 원·대상 거부.
   - 두 실제 연결 경합: 선행 미커밋 예약 동안 후행이 lock_timeout, 선행 커밋 후 후행이 partial UNIQUE 위반. 테스트가 커밋한 합성 fixture만 정리함.
   - canonical 자기참조·타클래스·회원 target 거부, 같은 클래스 guest target 허용.
   - 감사 3종의 ORM update/delete 및 직접 SQL UPDATE/DELETE 모두 거부.
   - guest 멱등키/회복 hash UNIQUE, 자격 scope CHECK, presence 참가자-회차 쌍 FK, superseded 자기참조·타회차 거부.
   - superseded 행은 global ORM 조회에서 계속 보임(기록·스크럽 대상 보존).
   - 별도 scratch DB에서 전체 기존 chain→056, before/after/근거없는 합성 체크인 시드→057 적용, head 재적용: before만 completed, 나머지 NULL. scratch DB 정리됨.
4. 기존 SQLite fixture를 사용하는 제한 회귀: **69 passed, 기존 crypt/argon2 deprecation 2경고**.
   - `DATABASE_URL=sqlite:// <기존 Python> -m pytest tests/test_sdd216_capabilities.py tests/test_sdd216_schedule.py tests/test_sdd214_read_api.py -q`
   - 모든 모델 create_all 및 복합 자기 FK의 ORM 매핑/기존 214·216 소비 경로 호환 확인. 실제 PG migration 증거와 구분함.
5. 로컬 합성 PG `alembic upgrade head` 재실행 성공, `alembic current` = `e036a0000057 (head)`.
6. 변경된 기존 모델 파일 `git diff --check` PASS. 전체 BE 테스트는 통합 담당 지시에 따라 실행하지 않음.

중간 검증에서 backfill 테스트 fixture가 기존 session_records.ai_summary 등 필수값을 누락하여 실패했으나, 기존 필수값을 fixture에 보완한 뒤 최종 24개가 통과했다. 제품 코드/기존 제약을 완화하지 않았다.

## 상세 판단 및 후속 서비스 책임

- canonical 복합 FK `(class_id,canonical_member_id,kind)` → `class_members(class_id,id,kind)`와 source guest/자기참조 CHECK를 함께 둔다. 참조 대상과 원본 모두 같은 클래스 guest임을 PG에서 보장한다. cycle 금지·survivor 평탄화·source removed 전환·alias 전체 잠금은 서비스 책임이다.
- superseded 복합 FK는 같은 회차 참가자만 허용한다. 원래 participant ID/member FK·EEG/리포트 참조를 재작성하지 않는다. superseded를 global ORM filter에 추가하지 않았다.
- 보강 source/target participant는 각 회차와 복합 FK로 연결하며 삭제 RESTRICT. canonical alias 전체 원결석 중복·같은 클래스·원결석 출석 상태·대상 정원/진입 검사는 서비스 책임이다.
- 감사 3종은 기존 ClassMemberEvent의 UUID 보존 패턴과 같이 원본 FK 없이 보존하여 CASCADE 삭제를 만들지 않는다. ORM before_update/before_delete와 PG BEFORE UPDATE OR DELETE 트리거를 모두 둔다.
- recovery는 token_hash만, grant는 jti/버전/범위/만료만 저장한다. 원문 자격·토큰을 저장하는 컬럼은 없다. TTL/한 번 사용/현재 canonical 자격 검증·row lock은 서비스 책임이다.
- lease.id는 Socket.IO sid가 UUID가 아니므로 varchar(200) PK이며, 계약의 UNIQUE(session_id,id)와 expiry/participant-expiry 인덱스를 함께 둔다.
- 기존 연구 동의를 가입 동의로 추정하지 않는다(false/NULL). 체크인 before JSON object 실존만 completed로 채우며 시각은 추정하지 않아 NULL. after/입장/초대/밴드로 체크인을 추정하지 않는다. 기존 makeup_for_session_id로 assignment를 합성하지 않는다.
- downgrade는 RuntimeError로 막아 자동 데이터·이력 삭제를 제공하지 않는다. 운영 데이터/외부 서비스 접속, 커밋·push·배포 없음.
- 최초 발견한 프론트 4개 변경과 다른 담당자의 계약/FE 테스트·specs 변경은 보존하고 수정하지 않았다.
