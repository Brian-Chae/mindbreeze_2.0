# SDD-214 Plan — 클래스·세션 재설계 Phase 1 (Stage ②)

> 2026-10-18 · 코드 변경 없음(문서 전용) · 입력: `spec.md`, `docs/class-session-restructure/{기획,영향도,결정-필요}.md`, `조사/R1·R7·R10`, `기획-상세-{상태머신권한,강사모델,회원내클래스,상담}.md`, `specs/sdd-211-class-structure-phase0/`, `specs/sdd-213-schema-drift/`, 현행 코드(파일:줄은 해당 항목에 표기)
> 기술 결정은 이 문서가 확정한다(§1). 비즈니스 결정(U1~U5)은 `spec.md` 에 분리했고, 이 plan 은 **추천안(U1 승인·U2 제외·U3 dev 먼저·U4 표시만·U5 병행)을 전제**로 쓴다. 답이 다르면 해당 Task 만 개정한다.
> 확인하지 못한 것은 `미확인` 으로 표기하고 §14 에 모았다.

## 0. 결론 먼저

| 질문 | 답 |
|---|---|
| 무엇을 만드나 | 신규 테이블 11 + 기존 3개 테이블 가산 컬럼(M1) → 기존 데이터 이전(M2, 수동·멱등) → 제약(M3) → 읽기 API 5 + 호환 처리(M4) |
| 출시 단위 | **3회 배포**(기획 §9): PR-A(스키마·모델·분류 함수·백필 도구, 동작 변화 0) → [M2 수동] → PR-B(제약) → PR-C(호환·읽기 API) → [M2 재실행으로 스트레이 0 확인] |
| 마이그레이션 리비전 | `e036a0000053`~`…056`(M1 4개) + `…057`(M3). 현재 head `…052` 위에 쌓는다 |
| 안전의 핵심 | M1 은 **데이터를 건드리지 않는 순수 가산**(UPDATE·DROP·NOT NULL 승격 0 → 파괴적 마이그레이션 게이트 통과). M2 는 **새 테이블·새 컬럼에만 쓰고 기존 컬럼은 해시로 불변 증명**. 롤백은 코드 revert, DB 는 되돌리지 않음 |
| 병렬 | 워커 5(W-DB·W-CL·W-BF·W-API·W-CP), 동시 최대 3. 소유 파일 겹침 0 (§9) |
| Brian 게이트 | verify 승인 → (구현) → **U1 분류 규칙 승인 후** 실데이터 dry-run → dev apply go → PR-B/PR-C 머지 go → prod 릴리스 go (§12) |

---

## 1. 확정 기술 결정 (TD)

| # | 사안 | 결정 | 근거 |
|---|---|---|---|
| TD1 | 리비전 분할 | `053` 클래스군(`classes`·`class_instructors`·`class_members`·`class_member_events`) / `054` 상담군(`counseling_guests`·`counseling_relationships`·`counseling_relationship_counselors`·`counseling_relationship_events`·`guest_claim_events`) / `055` 보조(`session_migration_map`·`session_host_history`) / `056` 기존 테이블 가산 컬럼(`sessions`·`session_participants`·`reports`) / `057` M3 제약(별도 PR). 한 PR(PR-A)에 053~056 | 기획 §11.2 "관심사별 3~4개", 리뷰·재사용 용이. 의존 순서: 부모 테이블 → 보조 → 기존 테이블 FK 컬럼 |
| TD2 | 멱등 가드 | 모든 DDL 은 존재 검사 후 실행(`CREATE TABLE`/`ADD COLUMN`/`CREATE INDEX` 는 `IF NOT EXISTS` 또는 `information_schema`·`pg_constraint` 검사 `DO` 블록). 첫 문장 `SET LOCAL lock_timeout='5s'` | SDD-213 리비전 `e036a0000052` 관례. dev 가 부분 적용 상태여도 안전 |
| TD3 | 파괴적 게이트 | 053~057 의 `upgrade()` 에 `op.drop_*`·`alter_column(nullable=False/type_)`·`execute` 안의 `DROP/DELETE/TRUNCATE/UPDATE <table>` **0건**. `deploy/ci/check_migrations.py` 로 `destructive=false` 를 PR 에서 확인 | prod 릴리스가 파괴적이면 `confirm_destructive` 입력이 필요(`deploy-prod.yml`). 백필 UPDATE 는 마이그레이션이 아니라 수동 스크립트에서만 |
| TD4 | 가산 컬럼 형태 | 기존 테이블 컬럼은 전부 NULL 허용. `sessions.session_kind` 만 `server_default 'regular'`(NULL 허용 유지), `host_state` 는 기본값 없음(백필·호환 처리가 채움). NOT NULL·CHECK 는 M6 | 기획 §9 공통 원칙, 구 코드 INSERT 가 새 컬럼을 모름 |
| TD5 | FK 삭제 규칙 | 부모 FK 는 `ON DELETE RESTRICT`(삭제=숨김 보존 전환). `reports.approved_by_user_id` 는 NO ACTION(현행 `sessions.host_id` 관례). `users` 행 삭제 경로는 이 SDD 에서 바꾸지 않음 | `조사/R1` §8 서두, `기획-상세-상태머신권한` X13 |
| TD6 | FK 시점 | 새 컬럼의 단순 FK(`class_id`→`classes` 등)는 M1 에서 바로 건다(값이 전부 NULL 이라 검사 비용 0). **복합 FK 와 유니크는 M3** | 복합 FK 는 MATCH SIMPLE 이라 `class_id IS NULL` 행을 검사하지 않아 구 코드와 공존 |
| TD7 | 순환 FK | `class_instructors.scope_session_id`·`class_members.first_session_id`(→`sessions`)와 `sessions.class_id`(→`classes`)가 서로를 가리킨다. 053 에서 테이블을 만들고 056 에서 `sessions` 컬럼을 추가하는 순서로 해소(053 의 `sessions` 참조 FK 는 기존 테이블이라 문제 없음) | 순서 의존, PG 테스트(S6)로 증명 |
| TD8 | `downgrade()` | 신규 테이블 DROP(의존 역순, `IF EXISTS`) + 추가 컬럼 DROP 을 구현하되 docstring 에 "운영 롤백 사용 금지, M2 이후엔 데이터 소실"을 명시. CI 의 `upgrade → downgrade → upgrade` 검증에만 사용 | 프로젝트 관례("다운그레이드는 drop 이므로 운영 롤백에 사용하지 않는다"). SDD-213 은 되돌릴 수 없는 백필 때문에 no-op 이었으나 M1 은 가산이라 구현 가능 |
| TD9 | 분류 함수 | `backend/app/services/session_classifier.py` 의 순수 함수 `classify_session(facts) -> Classification`. DB·시계·난수 접근 0. 입력 `SessionFacts`(비템플릿 여부, `type`, `participant_mode`, `custom_type_name`, 활성 참여자 수, 활성 참여자 종류 목록) · 출력 `Classification(parent_kind, rule, flags)` | 기획 §9 P1-2. 백필과 호환 처리가 같은 결과를 내야 스트레이 정리가 일관 |
| TD10 | 백필 구조 | 로직은 `app/services/session_backfill_service.py`, 실행 파일은 `backend/scripts/migrate_sessions_to_parents.py`(얇은 CLI). 선례 `backend/scripts/reissue_class_codes.py` + `app/services/class_code_reissue.py` 와 같은 모양: **기본 dry-run, `--apply` 로만 쓰기, 출력은 건수만, 멱등** | 선례 일치. 단위 테스트가 서비스를 직접 호출 |
| TD11 | 백필 접근 방식 | 읽기·쓰기 모두 **원시 SQL**(또는 `include_hidden`·`include_removed` 실행 옵션). ORM 전역 필터(`core/database.py:20-36`)가 숨김 세션·제거 참여자를 가리므로 ORM 기본 경로 사용 금지 | 숨김 39건도 이전 대상(기획 §11.3). 필터 우회를 테스트로 고정 |
| TD12 | 백필 이벤트 | 백필은 **초기 상태 설정**이므로 `class_member_events`·`counseling_relationship_events` 행을 만들지 않는다. 근거는 `session_migration_map.flags` | 이벤트는 "상태 전이" 기록(X17). 전이 기록 규칙은 Phase 3~4 가 정의. `미확인`: 기획이 백필 이벤트를 명시하지 않음 |
| TD13 | `reports` 컬럼 | `approved_by_user_id`·`approved_at` 는 컬럼만 추가. 기존 승인 경로(`report_service.py`)는 **값을 쓰지 않는다**(Phase 5) | 변경 최소화, 리포트 승인 로직 미접촉 |
| TD14 | 읽기 API 접근 범위 | 현행 `GET /sessions` 가시 범위의 **부모 단위 투영**. 새 정책 없음. 동치성 속성 테스트(§7)로 고정 | `D-05`·`D-28` 은 Phase 3 이전에는 확장 금지 |
| TD15 | 라우터 | `backend/app/api/v1/classes.py`(`/classes`), `counseling.py`(`/counseling`) 신설, `api/v1/__init__.py` 에 등록. 기존 `class_audio.py` 의 `/class` 접두사는 건드리지 않음 | `/class` 와 `/classes` 혼동 방지를 verify 로 확인 |
| TD16 | 응답 가산 | `SessionResponse`(`schemas/session.py:154`)에 선택 필드 `class_id`·`class_title`·`seq`·`area` 가산. 프론트 `SessionDto`(`frontend/src/lib/api/session.ts`)에 선택 필드로 반영 | SDD-211 계약 골든은 가산 통과(경고) 규칙 |
| TD17 | `POST /sessions` 호환 | 세션 생성 직후 **같은 트랜잭션**에서 분류 함수로 부모 생성. 삽입 지점 `services/session_service.py:335 create_session`(+ `duplicate`·`new-run` 경로, 생성 지점 전수는 P1-0 에서 확정). 템플릿은 제외 | 기획 §9 P1-6, R7 §6.8 |
| TD18 | `new-run` 산출물 | 별도 부모(클래스 1 + 세션 1, `origin='shim'`)로 만든다. 같은 클래스의 다음 회차로 붙이지 않는다 | `미확인`: 문서에 new-run 의 부모 귀속 규칙이 없음. 가장 보수적(구 의미 유지: 회차 연결은 `run_id` 가 담당). Phase 3 이후 재논의 |
| TD19 | 상담 세션 생성 시 부모 | 참여자가 아직 없으므로 호스트별 "내담자 미상" 보관용 관계(`is_placeholder`)로 배치하고 `flags` 에 `no_client_yet` 표시. 재배치 규칙은 이 SDD 에서 정의하지 않음(U4) | R7 §6.8. 재배치는 Phase 6 |
| TD20 | 코드 입장 해석 | 1단계 활성 클래스 코드 → 그 클래스의 "현재 입장 가능 회차", 없으면 2단계 기존 `sessions.access_code` 폴백. 입장 불가는 사유 비구분 동일 404 유지. 이전분은 클래스·세션이 **같은 코드값**이라 결과가 동일 | R7 §6.1, `class_code_service.py:89` `find_enterable_session` |
| TD21 | 숨김 필터 | `core/database.py` 의 `with_loader_criteria` 에 `Class`·`CounselingRelationship` 의 `hidden_at IS NULL` 추가, 같은 `include_hidden` 옵션으로 해제 | 기획 §9 P1-7 |
| TD22 | 스위프 확장 | `retention_sweep_service.py` 가 `class_members`(비회원 개인정보)·`counseling_guests` 를 후보에 포함. 백필은 원본의 `pii_scrubbed_at` 을 복사. 한쪽만 스크럽되는 경우를 검출해 보고(자동 수정 안 함). 스위프 기본값(`RETENTION_SWEEP_ENABLED=false`, 항상 dry-run)은 변경하지 않음 | 기획 §12 X6·X19, `retention_sweep_service.py:15` |
| TD23 | 구 앱 쓰기 동기화 | `PUT /sessions/{id}` 로 클래스 단위 필드가 바뀌면, 부모 클래스가 `origin ∈ {migrated, shim}` 이고 가시 세션이 1개일 때만 클래스에 반영. 마지막 가시 세션 숨김 시 클래스도 `hidden_at` | R7 §6.5. 새 앱이 만든 클래스(세션 ≥2)는 세션만 수정 |
| TD24 | 레거시 호출 계측 | 호환 처리(shim) 경로와 코드 폴백 경로 호출을 구조화 로그 한 줄로 남긴다(코드·이름 등 개인정보 제외, 건수·경로만) | M5 종료 판단 근거(R7 §6.5) |
| TD25 | 모델 파일 | 신규 모델은 도메인별 파일 `models/class_program.py`(클래스군), `models/counseling.py`(상담군), `models/session_parent.py`(`session_migration_map`·`session_host_history`)로 분리하고 `models/__init__.py` 에 import. `Session`·`SessionParticipant`·`Report` 모델은 컬럼만 추가 | 기존 파일명 충돌 방지, 소유 영역 분리(§9). 파일명은 구현 시 확정 가능 |

---

## 2. 아키텍처 요약

```
organizations 1 ─< classes 1 ─< class_instructors >─ users               [명상]
                   classes 1 ─< class_members
                   classes 1 ─< sessions (class_id, seq, host_id → class_instructors, host_state, session_kind)
organizations 1 ─< counseling_relationships (counselor, client_user_id | client_guest_id → counseling_guests)
                   counseling_relationships 1 ─< sessions (counseling_relationship_id, seq)
sessions 1 ─< session_participants (member_id → class_members | guest_client_id → counseling_guests, 출석 컬럼)
sessions.class_id XOR sessions.counseling_relationship_id  -- 비템플릿 세션. CHECK 는 M6, 그 전엔 분류·검증 쿼리 V2·V13 으로 감시
엔진(reports·session_records·audio/video·eeg·chat) 은 sessions 를 계속 읽는다 (dual-write: 세션 컬럼도 계속 채운다)
```

- **dual-write(이중 기록)**: 새 부모를 만들되 `sessions` 의 기존 컬럼(`title`·`access_code`·`max_participants` 등)도 그대로 유지한다. 엔진·구 앱은 세션만 읽는다. 세션 컬럼 쓰기 중단은 M6 이후 별도 결정(R7 §6.6).
- 세션 id·참여자 id 불변: 알림 딥링크·JWT(`class_entry` 24h, `report_participant` 7일)·S3 키·Celery 인자가 의존.

---

## 3. 스키마 M1 상세

### 3.1 리비전 분할과 순서

| 리비전 | 파일(예) | 내용 | PR |
|---|---|---|---|
| `e036a0000053` | `…053_sdd_214_m1_class_tables.py` | `classes`, `class_instructors`, `class_members`, `class_member_events` + 인덱스. `classes` 부분 유니크 `uq_classes_active_access_code` | PR-A |
| `e036a0000054` | `…054_sdd_214_m1_counseling_tables.py` | `counseling_guests`, `counseling_relationships`, `counseling_relationship_counselors`, `counseling_relationship_events`, `guest_claim_events` + 인덱스. 부분 유니크 `uq_rel_guest`·`uq_rel_placeholder` | PR-A |
| `e036a0000055` | `…055_sdd_214_m1_aux_tables.py` | `session_migration_map`(PK `session_id`), `session_host_history` | PR-A |
| `e036a0000056` | `…056_sdd_214_m1_session_columns.py` | `sessions`: `class_id`·`counseling_relationship_id`(FK, RESTRICT, 인덱스)·`seq`·`session_kind`(기본 `regular`)·`host_state`. `session_participants`: `member_id`·`guest_client_id`·`attendance_status`·`attendance_kind`·`makeup_for_session_id`·`attendance_marked_by`·`absence_reason`. `reports`: `approved_by_user_id`·`approved_at` | PR-A |
| `e036a0000057` | `…057_sdd_214_m3_constraints.py` | 복합 FK 2개 `NOT VALID` → `VALIDATE`, `UNIQUE(class_id, seq)`·`UNIQUE(counseling_relationship_id, seq)`, `UNIQUE(session_id, member_id)`, `CHECK(member_id IS NULL OR guest_client_id IS NULL)`, 부분 유니크 `uq_rel_active_pair` | PR-B (M2 apply 후) |

- 컬럼 단위 정의는 `조사/R1` §8.1~8.9 와 `기획-상세-회원내클래스` §2.2~2.3, `기획-상세-강사모델` §2.3 을 **원본**으로 하되, 구현 시작 시 Task S0 가 **컬럼 확정표**(`schema-contract.md`)를 만들어 verify 의 SC 항목과 대조한다. 불일치가 있으면 기획 문서(`기획.md` §4.3)를 우선한다. 예: 클래스 상태는 `draft·active·completed·cancelled·archived`(R1 초안은 `draft` 없음).
- `class_members` 상태 값: `invited·waitlisted·active·completed·left·removed·declined`, 출석 상태: `expected·attended·absent·excused·withdrawn` (`기획.md` §4.3).
- 구 코드가 INSERT 하는 `sessions`·`session_participants`·`reports` 행에는 새 컬럼이 전부 NULL(또는 `session_kind='regular'`)로 들어간다 → 구 코드 호환.
- 인덱스는 일반 `CREATE INDEX`(dev DB 54MB, `기획.md` §11.2). `CONCURRENTLY` 는 Alembic 트랜잭션 안에서 불가하고 규모상 불필요.

### 3.2 제약이 들어가는 시점

| 제약 | 시점 | 이유 |
|---|---|---|
| 단순 FK(`sessions.class_id` 등), `class_instructors UNIQUE(class_id, user_id)`, 새 테이블 안에서만 판정되는 부분 유니크(`uq_classes_active_access_code`·`uq_rel_guest`·`uq_rel_placeholder`) | M1 | 새 테이블이거나 값이 전부 NULL. 코드 유일성은 백필 dry-run 이 사전 검출(V8) |
| 복합 FK `(class_id, host_id) → class_instructors(class_id, user_id)`, `(counseling_relationship_id, host_id) → counseling_relationship_counselors(relationship_id, counselor_id)` | M3 (`NOT VALID` → 백필 후 `VALIDATE`) | 백필이 강사 행을 만든 뒤에만 기존 행이 통과 |
| `UNIQUE(class_id, seq)`, `UNIQUE(counseling_relationship_id, seq)`, `UNIQUE(session_id, member_id)`, 부분 유니크 `uq_rel_active_pair`(같은 상담사·회원의 활성 관계 1개) | M3 | NULL 은 서로 다르게 취급되므로 구 코드 INSERT 와 공존, 백필 결과(쌍 묶기)에 의존하므로 중복 검출 후 |
| `ck_sessions_one_parent`, `seq`/부모 필수화 | **M6(Phase 8)** | 구 코드가 부모 없이 INSERT 하므로 검증 상태로 걸면 깨짐 |

---

## 4. 분류 함수 (C 트랙)

### 4.1 규칙표 (기획 §11.3 · R7 §4.1 · `결정-필요` D-55/56/57 확정)

| 순서 | 조건 | 부모 | 규칙 코드 | 표시(flags) |
|---|---|---|---|---|
| 0 | `is_template = true` | 이전 안 함 | `T0` | — |
| 1 | `type = 'meditation'` | 명상 클래스 | `C1` | — |
| 2 | `clinical`·`hypnosis` 이고 활성 참여자 ≥ 2 | 명상 클래스(유형 라벨 유지) | `C3` | `type_mismatch` |
| 3 | 〃 활성 참여자 = 1 (회원) | 상담 관계 (회원 쌍 묶기) | `R1` | 참여 방식이 group 이면 `group_vs_count_disagree` |
| 4 | 〃 활성 참여자 = 1 (비회원) | 상담 관계 (비회원, 세션당 1) | `R2` | 〃 |
| 5 | 〃 활성 참여자 = 0 | 상담 관계 (내담자 미상 보관용, 상담사당 1) | `R3` | `placeholder` |
| 6 | `custom` 이고 (group 또는 활성 참여자 ≥ 2) | 명상 클래스 | `C2` | 키워드 충돌이면 `needs_host_confirm` |
| 7 | `custom` 그 외 | 상담 관계 (R1/R2/R3 과 동일 하위 규칙) | `R1`~`R3` | 키워드 충돌이면 `needs_host_confirm` |
| — | 위에 해당 없음 | 분류 불가 | `X0` | 백필은 보고 후 **중단** |

- 활성 참여자 = 호스트 본인·제거(`removed_at`)·대기(`is_waitlisted`)·대기취소(`waitlist_cancelled_at`) 제외.
- **정원(`max_participants`)으로 그룹/1:1 을 판정하지 않는다**(기본 정원이 10 이라 상담도 10 일 수 있음).
- `custom` 의 키워드(명상·마음챙김·호흡·요가·MBSR / 상담·치료·코칭·심리·면담)는 **구조 규칙(6·7)의 결과와 충돌하는지 판정해 `needs_host_confirm` 만 표시**한다. 키워드가 분류를 덮어쓰는 해석은 취하지 않는다. `미확인`: `D-56` 문구 "키워드로 초안"의 정확한 의미 — dev 에는 custom 0건이라 결과 차이 없음, U4 로 확인.
- 단위 테스트: 위 표의 9행 + 경계(정원 10 인 1:1 상담, 호스트만 참여, 제거·대기 참여자만 있는 세션, `custom_type_name` NULL, 알 수 없는 `type`) + 순수성(같은 입력 → 같은 출력, DB 접근 없음).

---

## 5. 백필 M2 (B 트랙)

### 5.1 알고리즘

| 단계 | 내용 | 안전장치 |
|---|---|---|
| 0 사전 점검 | `alembic_version ≥ …056`, 신규 테이블 존재, 비템플릿 세션 수(숨김 포함), `open`/`in_progress` 세션 수, 매핑 수, 코드 중복 | 하나라도 어긋나면 중단. `open`/`in_progress` 가 있으면 `--allow-live-sessions` 없이는 apply 거부(dev `in_progress` 1건 2026-10-06 은 Brian 확인 후) |
| 1 대상 선정 | 원시 SQL 로 `is_template = false` 이고 `session_migration_map` 에 없는 세션(숨김 포함) | 멱등 키 = `map.session_id` PK. 재실행은 미매핑분만 |
| 2 사실 수집 | 세션별 활성 참여자 수·종류를 1회 질의로 집계 | 읽기 전용 |
| 3 분류 | `classify_session` 호출. 분류 불가 `X0` 가 하나라도 있으면 보고 후 중단 | 규칙 코드별 건수 집계 |
| 4 (dry-run 끝) | 집계 출력(규칙별·flags별·부모 종류별 건수, 예상 생성 행 수)과 **제약 사전 검출**(활성 코드 중복·쌍 유일성·`seq` 중복 예상). **쓰기 0**, 개인정보 0 | 기본 모드 |
| 5 apply | 단일 트랜잭션. `SET LOCAL lock_timeout`, `LOCK TABLE sessions, session_participants IN SHARE ROW EXCLUSIVE MODE`(수 초). 아래 5.2 순서로 INSERT/UPDATE | 어느 단계든 실패하면 전체 `ROLLBACK` |
| 6 사후 검증 | 같은 트랜잭션 안에서 검증 쿼리 V2·V4·V5·V6·V7·V8·V10·V12·V13·V15 실행, 하나라도 실패하면 `ROLLBACK` | 나머지(V1·V3·V9·V11·V14·V16~V19)는 커밋 후 보고서 |
| 7 보고 | 건수·규칙·flags 만 출력, `docs`/`specs` 에 커밋하는 보고서는 합계·분포만(`M0` 와 같은 정책, U5=A) | 이메일·이름·UUID·라벨 원문 0 |

### 5.2 쓰기 순서와 값

- **명상 클래스(C1·C2·C3)**: `classes` 1행(새 uuid, `created_by`←`host_id`, `title`, `description`←`notes`, `schedule_mode='fixed'`, `planned_session_count=1`, `origin='migrated'`, `status`←(completed→completed, cancelled→cancelled, 그 외 active), 설정 기본값·`access_code`·`legacy_access_code`·`hidden_at`·`created_at` 복사) → `class_instructors(host_id,'lead','active')` 1행 → `sessions.class_id`·`seq=1`·`host_state='assigned'`·`session_kind='regular'` 만 UPDATE → 참여자마다 `class_members` 1행 + `session_participants.member_id`·`attendance_status` UPDATE. **`class_instructors` INSERT 가 세션 UPDATE 보다 먼저**(M3 복합 FK 검증을 통과해야 하므로).
- **상담 관계(R1·R2·R3)**: 회원 쌍은 `(host_id, 회원)` 으로 묶어 관계 1행(`seq` 순서 = `coalesce(scheduled_at, started_at, created_at)`, `created_at`, `id`), 비회원은 세션당 `counseling_guests` 1행(참여자 개인정보 복사, `email_verified_at=NULL`, `origin='migrated'`, `pii_scrubbed_at` 복사) + 관계 1행, 내담자 미상은 상담사당 보관용 관계 1개. `counseling_relationship_counselors` 에 상담사 이력 1행. 이메일 정규화는 가입 이메일과 **같은 함수**(SQL 근사 금지, X12). 링크(`client_counselor_links`)는 **생성하지 않고**, 있으면 `link_id` 만 연결(X16). 활성 세션이 있으면 관계는 `active` 유지(X11).
- 참여자 상태 백필: `removed_at` → 멤버십 `removed` / 출석 `withdrawn`; `waitlist_cancelled_at` → `left` / `withdrawn`; `is_waitlisted` → `waitlisted` / `expected`; `entered_at` 있음 → `attended`(세션 completed 면 멤버십 `completed`); 입장 정보 없음 → **`absent` 로 단정하지 않고 `expected`** 유지.
- 모든 이전 행 → `session_migration_map(session_id, parent_kind, parent_id, rule, flags, created_at)`.
- 건드리지 않는 것: `sessions`/`session_participants` 의 기존 컬럼 전부, `reports`, 엔진 테이블. 증명은 V15(불변 컬럼 해시 이전/후 동일).

### 5.3 스트레이 정리 (재실행)

- PR-C(M4) 배포 후 한 번 더 실행: 구 코드가 M2~M4 사이에 만든 부모 없는 세션을 같은 분류 함수로 이전. 상담은 같은 `(호스트, 회원)` 쌍에 활성 관계가 있으면 재사용하고 `seq` 를 이어 부여.
- 매일 스트레이 질의(V2) 실행 — M5 호환 윈도우 동안.

### 5.4 역방향(보조 수단, 정상 롤백 아님)

- `session_migration_map` 기반 역방향 SQL(`sessions.class_id/…/seq/host_state` NULL 복원, 신규 부모·보조 행 삭제)을 **준비해 스냅샷 복원본에서 리허설**한다. 실행은 "M2 직후·새 코드(PR-C) 배포 전"에만 가능하고 Brian 승인 필요. 그 이후는 RDS 스냅샷/PITR.

---

## 6. 호환 (P 트랙)

| # | 대상 | 변경 | 근거 |
|---|---|---|---|
| P1 | 세션 생성 | `create_session`(`session_service.py:335`) 직후 같은 트랜잭션에서 분류 → 부모 생성(`origin='shim'`) → 세션에 `class_id`/`counseling_relationship_id`·`seq`·`host_state` 설정. `duplicate`·`new-run`(TD18) 도 같은 경로. **P1-0**: `Session(` 생성 지점 전수 grep(미확인) 후 누락 경로 0 확인 | TD17 |
| P2 | 코드 읽는 파일 | `class_code_service.find_enterable_session`(:89)의 1단계/2단계 해석 + "세션 값 없으면 클래스 값" 폴백을 코드 참조 파일 8개에 적용: `reminder_service`·`code_service`·`class_code_service`·`class_code_reissue`·`org_public_service`·`dashboard_service`·`session_service`·`session_email_invite_service`(전수 재확인은 P2-0). 코드 발급은 **두 테이블의 활성 코드 합집합**에서 중복 회피 | R7 §6.1 |
| P3 | 구 앱 쓰기 | TD23: 클래스 단위 필드 동기화(대상 필드 = R1 §8.1 의 "← 세션 값" 열: title·notes→description·max_participants→capacity·participant_mode·linkband_mode·location_*·duration_min·record_*·chat_enabled·sfu_enabled·reminder_offsets·access_code). 마지막 가시 세션 숨김 시 클래스 숨김 | R7 §6.5 |
| P4 | 알림 | `notification_service.py:86-106` 의 `extra`/`params` 에 `class_id`·`seq` 가산(상담은 `counseling_relationship_id`). `target_type='session'`·`target_id`·레거시 `session_id` 는 **그대로**. `target_type='class'` 는 Phase 2 | R7 §6.3 |
| P5 | 스위프 | TD22 | `retention_sweep_service.py` |
| P6 | 계측 | TD24 | R7 §6.5 |
| P7 | 알림 영속 행 | 알림·AI 비서 CTA 가 가리키는 영구 URL(`/app/sessions/{id}`·`/sessions/{id}`)은 세션 id 불변이므로 변환 없음 — V17 로 이전 전/후 동일 확인 | R7 §6.3 |

---

## 7. 읽기 API (R 트랙)

### 7.1 엔드포인트

| 메서드·경로 | 응답 핵심 필드(초안, R1 단계에서 확정) | 가시 범위 |
|---|---|---|
| `GET /classes` | 목록: `id`·`title`·`status`·`schedule_mode`·`planned_session_count`·`area`·진행률(완료 회차/계획 또는 가시 회차)·`next_session{id,seq,scheduled_at,status,host}`·열린 세션 유무. `status` 필터·페이지네이션(기존 목록 관례). 검색은 Phase 2 | 호스트/강사: 자신이 강사인 클래스. org_admin/platform_admin: 현행 세션 목록 범위. 회원: 자신이 비제거 참여자인 세션이 속한 클래스 |
| `GET /classes/{id}` | 상세: 위 + 설정(장소·LINK BAND 모드·녹음·정원·참여 방식), `instructors[]`(호스트 시점만), 코드(호스트 시점만) | 동일 |
| `GET /classes/{id}/sessions` | 회차: `id`·`seq`·`scheduled_at`·`status`·`session_kind`·`host{id,name}`·`host_state` | 동일 |
| `GET /counseling` | 상담 관계 목록: `id`·`status`·상담사·내담자 표시(회원 이름 / 비회원 표시명 / 보관용은 라벨)·`modality_default`·회차 수·다음/최근 세션 | 상담사: 자신의 관계. 회원: 자신이 내담자인 관계. 센터 관리자: 현행 범위를 넘지 않음(상담 본문 비공개 방침 `D-28` 은 Phase 3, 이 SDD 는 **메타만 노출**) |
| `GET /counseling/{id}` | 상세: 회차 목록(`id`·`seq`·`scheduled_at`·`status`·유형), 기록·리포트 **진행 상태 값만**(본문 없음) | 동일 |

- 모든 응답에 숨김(`hidden_at`)·제거 참여자는 제외. **EEG·녹음·전사·리포트 본문은 어떤 응답에도 넣지 않는다.**
- 회원 시점 응답에서 타 참여자·내부 필드(`origin`·`flags`·코드·`organization_attribution_known`)는 제외. 호스트 시점만 포함.
- 존재하지 않거나 권한 없는 id 는 현행 세션 상세와 같은 방식(상태코드·메시지)으로 응답 — 존재 여부를 구분해 노출하지 않는다. `미확인`: 현행 세션 상세의 정확한 방식(403/404) — R1 단계에서 `session_authz.authorize_session`(:127) 동작과 맞춘다.
- HTTP 요청은 200ms 이내 목표(프로젝트 규칙), N+1 질의 금지(목록은 집계 질의 1~2회).

### 7.2 동치성 원칙 (TD14)

`GET /classes/{id}/sessions`·`GET /counseling/{id}` 로 도달 가능한 세션 집합의 합 == 같은 사용자의 `GET /sessions` 목록 집합 (역할 5종 × 시드 데이터). 새 API 가 권한을 넓히지도 좁히지도 않는다는 증거이며 verify `RD-*` 의 핵심.

### 7.3 프론트

- `frontend/src/lib/api/session.ts` 의 `SessionDto` 에 `class_id?`·`class_title?`·`seq?`·`area?` 선택 필드 가산(타입만, 화면 변경 0). 새 API 클라이언트·화면은 Phase 2.

---

## 8. Task 분해

표기: 규모 S(반나절 이하) · M(1~2일) · L(3일 이상, 상대값). **모든 구현 Task 는 테스트 먼저(RED) → 구현(GREEN)**. 소유는 §9.

| ID | Task | 소유 | 선행 | 규모 |
|---|---|---|---|---|
| **G0** | 기준선: pytest·vitest·tsc·eslint 통과/실패 목록, `alembic heads`, SDD-211 계약 골든 현황, dev 비템플릿 세션 수 재측정(M0 A1·A2 재실행은 **읽기 전용·Brian go 필요**) → `baseline.md` | 조정자 | verify 승인 | S |
| **G1** | 계약 골든이 응답 속성 **가산**을 허용하는지 실험적으로 확인(`tests/contract/golden/*`, `compat.py`). 응답 형태 17 시나리오가 키 집합 정확 비교면 예외 절차 확정 | 조정자 | G0 | S |
| **S0** | 컬럼 확정표 `schema-contract.md`(테이블별 컬럼·타입·NULL·기본값·FK·인덱스·부분 유니크, 근거 문서 §) 작성 후 verify SC 항목과 대조 | W-DB | G0 | M |
| **S1** | 리비전 `053` 클래스군 (RED: PG 테스트 → GREEN) | W-DB | S0 | M |
| **S2** | 리비전 `054` 상담군 | W-DB | S1 | M |
| **S3** | 리비전 `055` 보조 테이블 | W-DB | S2 | S |
| **S4** | 리비전 `056` 기존 테이블 가산 컬럼 | W-DB | S3 | M |
| **S5** | ORM 모델 3파일 + 기존 모델 컬럼 추가 + `models/__init__.py` + `core/database.py` 숨김 필터(TD21) | W-DB | S4 | M |
| **S6** | PG 테스트(`tests/pg/test_sdd214_schema.py`): 빈 DB 체인 `upgrade head`, 덤프 픽스처 복원 후 `upgrade head`, `upgrade → downgrade → upgrade` 멱등, **구 코드 모양 INSERT(새 컬럼 생략)** 가 새 스키마에서 성공, `check_migrations` 가 053~056 에 대해 `destructive=false` | W-DB | S5 | M |
| **C1** | 분류 함수 단위 테스트 RED (§4.1 9행 + 경계 + 순수성) | W-CL | G0 | S |
| **C2** | `session_classifier.py` 구현 GREEN | W-CL | C1 | S |
| **B1** | 백필 서비스 RED: PG 합성 시드(명상 숨김·취소·진행 중·템플릿, 상담 회원 쌍·비회원·0명, 제거·대기 참여자, 코드 보유, `pii_scrubbed_at` 있는 비회원) 대상 기대 결과 | W-BF | C2, S6 | M |
| **B2** | `session_backfill_service.py`: 대상 선정·사실 수집·분류·dry-run 집계 | W-BF | B1 | M |
| **B3** | apply: 단일 트랜잭션·락·쓰기 순서(§5.2)·사후 검증·실패 시 전체 롤백·`--allow-live-sessions` | W-BF | B2 | L |
| **B4** | `scripts/migrate_sessions_to_parents.py` CLI(dry-run 기본, 출력 건수만) | W-BF | B3 | S |
| **B5** | 검증 쿼리 V1~V19 읽기 전용 모듈 + PG 테스트(위반을 심어 검출 확인) | W-BF | B3 | M |
| **B6** | 역방향 SQL 준비 + 스냅샷 복원본 리허설 절차서(`rollback-m2.md`) — 실행은 Brian 승인 | W-BF | B3 | S |
| **R1** | 읽기 API RED: 역할 5종 × 시드, 동치성 속성 테스트, 숨김·제거 제외, 회원 마스킹, 본문 비노출 | W-API | S6 | M |
| **R2** | `schemas/class_parent.py`, `services/class_read_service.py`, `api/v1/classes.py` | W-API | R1 | M |
| **R3** | `api/v1/counseling.py` + 서비스(상담 관계 읽기) | W-API | R2 | M |
| **R4** | `SessionResponse` 가산 필드 + 응답 조립부, 계약 골든 가산 통과 확인 | W-API | G1, S5 | S |
| **R5** | 프론트 `SessionDto` 선택 필드 가산 + tsc | W-API | R4 | S |
| **P0** | `Session(` 생성 지점·`access_code` 참조 파일 전수 grep 보고(P1-0·P2-0) | W-CP | G0 | S |
| **P1** | 호환 처리 RED→GREEN: `POST /sessions`·`duplicate`·`new-run` 부모 자동 생성, 템플릿 제외, 분류 결과 = 백필과 동일(공유 함수) | W-CP | C2, S6, P0 | L |
| **P2** | 코드 입장 해석·폴백 8개 파일, 발급 시 활성 코드 합집합 | W-CP | S6, P0 | M |
| **P3** | 구 앱 쓰기 동기화·마지막 가시 세션 숨김 시 클래스 숨김 | W-CP | P1 | M |
| **P4** | 알림 `params` 가산 | W-CP | S5 | S |
| **P5** | 스위프 확장(TD22) + 복제본 불일치 검출 | W-CP | S5 | M |
| **P6** | 레거시 호출 계측 로그 | W-CP | P1, P2 | S |
| **K1** | 리비전 `057` M3 제약 + PG 위반 테스트(호스트가 강사가 아님 → 위반, `class_id IS NULL` 행 미검사, 유니크, 구 코드 INSERT 통과) | W-DB | **dev M2 apply 완료** | M |
| **D1** | PR-A 구성·CI·머지·dev 배포 | 조정자 | S6, C2, B6, P5 | S |
| **D2** | dev M2: 스냅샷 → dry-run 보고 → (U1 승인) → apply → V 보고 | 조정자 + Brian | D1, U1 | M |
| **D3** | PR-B(K1) 머지·dev 배포 | 조정자 | D2, K1 | S |
| **D4** | PR-C(R·P) 머지·dev 배포 → **재백필(스트레이 0)** | 조정자 | D3, R5, P6 | M |
| **D5** | M5 일일 점검(V2·레거시 호출 건수) 시작, summary 에 시작일 기록 | 조정자 | D4 | S |
| **D6** | prod 반영(U3): 릴리스 빌드 요약 확인 → 사전 점검 → M1 배포 → (스냅샷) → M2 → M3 → M4 → 재백필 | 조정자 + Brian | D5, Brian go | M |
| **I1** | 전체 회귀, summary.md, 시안 매핑(§11) 최종 점검 | 조정자 | D4 | S |

---

## 9. 병렬 워커 소유 영역

원칙: **파일 단위로 소유자 1명**, 겹치면 직렬. 각 워커는 별도 worktree·브랜치(`sdd/214-<워커>`)에서 일하고 조정자가 통합 브랜치 `sdd/214-int` 로 병합한다. `git add` 는 파일 지정, 소유 밖 파일 수정 금지.

| 워커 | 소유 파일(경로) | 읽기만 가능 | Wave |
|---|---|---|---|
| **W-DB** | `backend/alembic/versions/e036a00000{53..57}_*`, `backend/app/models/{class_program,counseling,session_parent}.py`, `backend/app/models/session.py`(컬럼 추가), `backend/app/models/record.py`(`Report` 컬럼 2개), `backend/app/models/__init__.py`, `backend/app/core/database.py`, `backend/tests/pg/test_sdd214_schema.py`, `backend/tests/pg/conftest.py`, `specs/sdd-214-…/schema-contract.md` | 전부 | 1 (S) → 3 (K) |
| **W-CL** | `backend/app/services/session_classifier.py`, `backend/tests/test_sdd214_classifier.py` | 모델·세션 서비스 | 1 |
| **W-BF** | `backend/app/services/session_backfill_service.py`, `backend/scripts/migrate_sessions_to_parents.py`, `backend/app/services/session_backfill_verify.py`, `backend/tests/pg/test_sdd214_backfill.py`, `specs/sdd-214-…/rollback-m2.md` | 모델, 분류 함수, 이메일 정규화 함수 | 2 |
| **W-API** | `backend/app/api/v1/{classes,counseling}.py`, `backend/app/api/v1/__init__.py`(라우터 등록), `backend/app/schemas/class_parent.py`, `backend/app/schemas/session.py`(가산 필드), `backend/app/services/class_read_service.py`, `backend/app/api/v1/session.py`(응답 조립부 가산에 한함), `frontend/src/lib/api/session.ts`, `backend/tests/test_sdd214_read_api.py` | 모델, `session_authz`, 세션 목록 가시 범위 | 2 |
| **W-CP** | `backend/app/services/session_service.py`, `class_code_service.py`, `class_code_reissue.py`, `code_service.py`, `reminder_service.py`, `org_public_service.py`, `dashboard_service.py`, `session_email_invite_service.py`, `notification_service.py`, `retention_sweep_service.py`, `backend/tests/test_sdd214_compat*.py`, `backend/tests/pg/test_sdd214_compat.py` | 모델, 분류 함수 | 2 |
| **조정자** | `baseline.md`, `summary.md`, 통합 브랜치, `.github/workflows/*`(변경 필요 시), PR | — | 전체 |

- **Wave 0(직렬)**: G0·G1·P0 → verify 승인 후.
- **Wave 1(병렬 2)**: W-DB(S0~S6) ∥ W-CL(C1~C2). 둘 다 서로의 파일을 읽지 않는다(분류 함수는 DB 의존 없음).
- **Wave 2(병렬 3)**: W-BF ∥ W-API ∥ W-CP. 선행: 통합 브랜치에 S6·C2 병합. `session_service.py`·`schemas/session.py`·`api/v1/__init__.py`·`models/__init__.py` 는 위 소유자 외 수정 금지(충돌 핫스팟).
- **Wave 3(직렬)**: PR-A 머지 → M2 → K1 → PR-B → PR-C → 재백필 → 점검.
- 의존 때문에 **PR-A 에는 W-DB·W-CL·W-BF(백필 도구 — 서버에 먼저 있어야 M2 를 돌린다)·P5(스위프 확장 — 복제 전에 있어야 함)가 들어가고**, PR-C 에는 W-API·W-CP(P5 제외)가 들어간다. P5 만 W-CP 소유이므로 PR-A 용 브랜치로 분리 병합한다.

---

## 10. 마이그레이션 안전

### 10.1 멱등

| 층 | 수단 |
|---|---|
| 스키마 | TD2: 존재 검사 후 실행, 2회 적용해도 오류 0 (S6 가 `upgrade → downgrade → upgrade` 와 "이미 일부 적용" 상태에서 `upgrade` 를 검증) |
| 백필 | 키 = `session_migration_map.session_id`. 재실행은 미매핑 세션만. 같은 입력 → 같은 규칙 코드 (분류 함수 순수성) |
| 제약 | `pg_constraint` 존재 검사 후 `ADD CONSTRAINT`, `VALIDATE` 는 이미 검증됐으면 no-op |

### 10.2 데이터 보존

| 단계 | 보장 | 증명 |
|---|---|---|
| M1 | 기존 행·컬럼 변경 0, 삭제 0 | `check_migrations` `destructive=false`, G4(verify): 기존 테이블 변경은 `ADD COLUMN` 뿐 |
| M2 | 새 테이블·새 컬럼에만 쓴다. 숨김·취소·테스트 세션 삭제 안 함. 세션 id·참여자 id 불변 | V15(불변 컬럼 해시 이전/후 동일), V16(FK 13개 + 값 보관 6개 참조 행 수 동일), V6(참여자 수) |
| M3 | 데이터 변경 0 | — |
| M4 | 신규 세션만 부모 포함 | 구 계약 골든 |

### 10.3 롤백 (총칙: 코드 revert, DB 유지)

| 시점 | 정상 롤백 | 구 코드가 새 스키마에서 동작하는 근거 | 데이터를 되돌려야 하면 |
|---|---|---|---|
| M1 후 | PR-A revert | 새 컬럼 전부 NULL/기본값, 새 테이블은 구 코드가 모름 | 불필요(비어 있음) |
| M2 후 | PR-A revert 해도 데이터는 무해 | 새 컬럼·테이블에만 썼음 | **PR-C 배포 전이면** 역방향 SQL(B6), 이후는 스냅샷/PITR |
| M3 후 | PR-B revert | 복합 FK 는 `class_id IS NULL` 행 미검사, 신규 유니크는 NULL 허용, 구 INSERT 통과를 PG 테스트로 증명 | 제약은 데이터가 아님 |
| M4 후 | PR-C revert | 읽기 API·호환 처리가 사라질 뿐 | 구 코드가 만든 스트레이는 재백필로 정리 |

- **롤백 트랩 주의**: `deploy-dev.yml` 의 롤백은 `dist`·`backend/app`·`backend/alembic` 만 복원하고 DB 를 되돌리지 않는다. PR-A 배포가 실패해 롤백되면 DB 는 `…056`(또는 중간 리비전)인데 `backend/alembic` 에는 그 리비전이 없을 수 있다. → 롤백 후 **새 코드가 다시 배포되기 전까지 수동 `alembic` 명령 금지**(기획 §12). 구 코드는 가산 스키마에서 그대로 동작.
- 한 번의 `alembic upgrade head` 가 대기 리비전을 한 트랜잭션으로 실행하므로(`env.py`, R7 §2) 053~056 중간 실패는 전체 롤백.

### 10.4 락과 성능

- `ADD COLUMN`(NULL/상수 기본값)은 메타데이터 변경, `lock_timeout 5s` 로 장시간 대기 방지. `sessions`/`session_participants` 에 FK 컬럼 추가는 짧은 `SHARE ROW EXCLUSIVE`. 규모 dev 177 세션·153 참여자(M0), prod 는 사실상 빈 DB.
- M2 apply 는 `LOCK TABLE … SHARE ROW EXCLUSIVE` 수 초. `open`/`in_progress` 세션이 없을 때 실행(B3 의 가드).
- 사용자 체감 점검 창은 **불필요**(D-60 무중단 확정).

### 10.5 환경 순서

dev 완주(PR-A → M2 → PR-B → PR-C → 재백필 → 점검) 후 prod 동일 절차(U3). prod 는 `release-build` → Brian 승인 → `deploy-prod`, M2 는 SSM 경유 수동(22 비개방, SDD-210). **prod 사전 점검**: 현재 prod head(`…051`/`…052`)와 `release-build` 요약의 `destructive` 판정 — 052 는 `UPDATE` 를 포함해 파괴적으로 분류될 수 있음(`미확인`, `check_migrations.py` 의 `--base-sha` 처리 확인).

---

## 11. 시안(Phase 2) 연결 매핑

시안 화면 → Phase 1 이 줄 수 있는 데이터. 화면 이름은 시안 코드에서 확인한 것만 적었고 나머지는 지시서(`지시서-*.md`) 기준이다.

| 시안 | 필요 데이터 | Phase 1 제공 | 판정 |
|---|---|---|---|
| CH01 클래스 목록 | 클래스명·다음 세션·진행률 `3/8`·진행 강사·열린 세션 | `GET /classes` | 제공(검색·필터 고급 조합은 Phase 2) |
| CH02 클래스 상세 개요 | 설정·강사·코드·상태 | `GET /classes/{id}` | 제공 |
| CH03 세션 탭(타임라인·강사 변경 시트) | 회차·일시·진행 강사·상태·취소/보강 | `GET /classes/{id}/sessions` (`session_kind`·`host_state`) | 읽기만 제공, **강사 변경은 Phase 3** |
| CH04 멤버/출석 탭 | 멤버 목록·출석 | 테이블·이전 데이터는 존재, **읽기 API 없음** | 후속(Phase 4) — Phase 2 에서 필요하면 API 추가를 별도 요청 |
| 리포트 탭·추이 | 회차별 리포트·승인 상태 | 없음 | Phase 5 |
| MC01~MC03 회원 홈·내 클래스·클래스 상세 | 클래스명·`seq`·진행 강사·상태·내 참석 | `GET /classes`·`/classes/{id}`·`/classes/{id}/sessions` 의 회원 시점 | 제공(참석/결석/보강 표기는 출석 컬럼 데이터가 Phase 4 이전엔 백필값 `expected`/`attended` 뿐) |
| MC04 변화 서사 · MC05 비회원 제한 뷰 · MC06 상태 안내 · MC07 알림 | 서사·멤버 상태·알림 `params` | 알림 `params` 가산만 | 나머지 Phase 4~5 |
| CN01 상담 목록 · CN02 상담 상세 | 관계 목록/상세·회차·상태 | `GET /counseling`·`/counseling/{id}` | 제공(종결/보관 동작은 Phase 6) |
| CN07·CN08 내 상담 | 상담사·회차·다음 상담 | 회원 시점 `GET /counseling` | 제공(리포트 열람은 기존 리포트 경로) |
| CN03~CN06, CN09~CN16 마법사·승인·종결·비회원 입장·회원 전환 | 쓰기 흐름 | 없음 | Phase 6~7 |

- Phase 1 이 **데이터 없음으로 남기는 것**은 Phase 2 가 빈 상태/비활성으로 표시해야 한다(예: 멤버 탭). 이 표는 verify `DS-1` 로 최종 점검한다.
- 시안 승인 전이라 화면 ID↔기능 대응 중 일부(CH05~, CN03~)는 지시서 순서 기준의 추정이다(`미확인`).

---

## 12. 배포 순서와 Brian 게이트

| 순 | 단계 | 내용 | 승인 |
|---|---|---|---|
| 0 | verify 승인 | 이 문서 3종 검토. 사용자 결정 U1~U5 답 | **Brian** |
| 1 | 구현 | Wave 0~2, 로컬/PG 테스트. 푸시·머지 없음(통합 브랜치까지) | — |
| 2 | **PR-A**(#1) | 053~056 + 모델 + 분류 함수 + 백필 도구 + 스위프 확장. CI 3잡(frontend·backend·`backend-pg-smoke`) GREEN → 머지 → `deploy-dev` 자동 → `e2e-smoke` | 머지 go (Brian) |
| 3 | M2 dev | RDS 수동 스냅샷(이름·보관 기준 기록) → 사전 점검 → **dry-run 보고(합계·분포만)** → **U1 승인** → apply → V1~V19 보고 | dry-run 보고 후 apply go (Brian) |
| 4 | **PR-B**(#2) | 057 제약 (`VALIDATE` 통과) | 머지 go |
| 5 | **PR-C**(#3) | 호환 처리·읽기 API·알림 가산·`SessionDto` → 머지 → 배포 → **즉시 재백필(스트레이 0 확인)** | 머지 go |
| 6 | M5 | ≥30일 일일 점검(스트레이 V2, 레거시 호출 건수). 종료 판단은 `D-61` | 종료 승인 (Brian) |
| 7 | prod(U3) | 위 2~5 를 prod 에 동일 적용. M2 는 SSM, 사전 스냅샷 | 릴리스 승인 + M2 go (Brian) |
| 8 | summary·Linear | summary.md 작성 | 최종 리뷰 (Brian) |

- 마이그레이션 PR 마다 **롤백 설계(§10.3)와 `check_migrations` 결과를 PR 본문에 첨부**(`CLAUDE.md` 관례).
- 배포 직후 점검: `alembic_version`, 신규 테이블·컬럼 존재, V2(스트레이), 레거시 호출 로그. prod 는 `/health/ready` 포함.
- M6(contract)는 이 SDD 밖(Phase 8): 구 앱 지원 종료 확인 후.

---

## 13. 위험

| # | 위험 | 가능성/영향 | 대응 | 롤백 |
|---|---|---|---|---|
| R1 | 구 코드가 새 스키마에서 깨짐(롤백 트랩이 코드만 복원) | 중/높음 | 가산만, NOT NULL·CHECK 는 M6, PG 스모크, 구 코드 모양 INSERT 테스트(S6), 계약 골든 | 코드 revert |
| R2 | 분류 오판(상담↔명상) | 중/중 | M0 분포 확인(영향 아니오), U1 승인, `flags` 로 사후 재분류, 규칙 코드·`map` 보존 | map 기반 재분류 SQL, 최후는 스냅샷 |
| R3 | 백필이 기존 컬럼을 바꿈 | 낮음/높음 | V15 해시, 쓰기 대상 화이트리스트 테스트(B3) | 역방향 SQL(PR-C 전) / 스냅샷 |
| R4 | 스트레이 세션(M2~M4 사이, 롤백 후) | 높음/낮음 | 같은 분류 함수, 재백필, 일일 V2 | 재백필 |
| R5 | **링크 자동 생성**으로 AI 비서·채팅 권한 발생(X4/X16) | 낮음/높음 | 이전·호환 처리 어디서도 `client_counselor_links` INSERT 0 — 테스트로 고정 | — |
| R6 | 비회원 개인정보 복제 후 스크럽 누락(X6) | 낮음/높음 | TD22: 복제본도 스위프 대상, `pii_scrubbed_at` 복사, 불일치 검출 | 스크럽 재실행 |
| R7 | 코드 폴백 누락으로 구 앱 입장 실패(X7) | 중/높음 | 8개 파일 전수(P0·P2), 입장 회귀 테스트, 동일 404 | 코드 revert |
| R8 | 읽기 API 가 권한을 넓힘 | 중/높음 | TD14 동치성 속성 테스트, 회원 시점 마스킹, 본문 비노출 | 코드 revert |
| R9 | 복합 FK 가 SQLite 테스트에서 동작하지 않아 위반이 통과(X16) | 중/높음 | PG 테스트가 1차 증거(`backend-pg-smoke`), 앱 검증 병행 | — |
| R10 | dev 가 현재 실사용 → apply 가 실사용자 영향 | 중/중 | 스냅샷, `open/in_progress` 가드, 락 수 초, dry-run 선행 | 역방향 SQL / 스냅샷 |
| R11 | 상담 세션이 "내담자 미상" 관계에 쌓이고 재배치 규칙이 없음(U4/TD19) | 높음/중 | `flags=no_client_yet`, 일일 점검 질의(보관용 관계 안에 활성 참여자가 있는 세션 수), Phase 6 에서 규칙 확정 | 데이터 보존이므로 되돌릴 일 없음 |
| R12 | 053~056 중 파괴적 판정이 나와 prod 릴리스가 차단 | 낮음/중 | TD3 + PR 에서 `check_migrations` 확인 | 리비전 수정 |
| R13 | 병렬 워커의 충돌(`session_service.py` 등) | 중/낮음 | §9 소유 규칙, 통합 브랜치 | — |
| R14 | `/class` ↔ `/classes` 라우트 혼동 | 낮음/낮음 | verify: 두 접두사 라우트 목록 대조 | — |
| R15 | 계약 골든 형태 비교가 가산 필드에 실패 | 중/낮음 | G1 에서 사전 확인, 예외 파일 절차(SDD-211 `breaking_exemptions.json`) | — |
| R16 | E2E 가 계속 dev 에 세션을 추가해 건수 대조 기준이 변함 | 높음/낮음 | 구현 직전 재측정, V1 은 "이전 전 집계 == 이전 후 부모 합" 상대 비교로 | — |
| R17 | `미확인` 이 구현 중 사실로 판명되어 Task 가 바뀜 | 중/중 | §14 를 G0·P0·S0 에서 먼저 해소, 변경은 verify `변경 이력` 에 사유 기록 | — |

---

## 14. 미확인 (구현 전 해소 계획 포함)

| # | 미확인 | 영향 | 해소 |
|---|---|---|---|
| 1 | prod 현재 head(`…051`/`…052`) 및 052 의 파괴적 판정이 다음 prod 릴리스에 미치는 영향 | prod 릴리스 절차 | D6 사전 점검(읽기 전용) |
| 2 | SDD-211 응답 형태 골든 17 시나리오가 가산 필드를 허용하는지 | R4 의 골든 갱신 필요 여부 | G1 |
| 3 | `Session(` 생성 지점 전수(duplicate·new-run·템플릿 적용·기타) | 호환 처리 누락 | P0 |
| 4 | `access_code` 참조 파일 8개(코드 grep) vs 기획의 6개 | 폴백 누락 | P0·P2-0 |
| 5 | `new-run` 산출물의 부모 귀속 규칙(TD18 은 보수적 가정) | 구 앱 재실행 동작 | 구현 중 사용 로그 확인 후 Phase 3 재논의 |
| 6 | 상담 세션 참여자 확정 후 보관용 관계에서 실제 관계로 옮기는 규칙 | Phase 6 | U4, Phase 6 |
| 7 | `D-56` "키워드로 초안"의 해석 | custom 분류(dev 0건) | U4 로 확인 |
| 8 | 현행 세션 상세의 권한 없음/존재하지 않음 응답 방식(403 vs 404) | 읽기 API 일관성 | R1 에서 `session_authz.py` 동작 확인 |
| 9 | 읽기 API 가 기존 감사 로그(데이터 접근 로깅, 6개월 보관 규칙)에 걸리는지 | 프라이버시 규칙 | R1 에서 현행 세션 읽기의 로깅 방식 확인, 동일 방식 적용 |
| 10 | `class_members`·`session_participants` 신규 출석 컬럼의 정확한 길이·값 집합(R4 §3.2 원본) | 컬럼 확정표 | S0 |
| 11 | dev `in_progress` 세션 1건(2026-10-06 생성)의 실제 상태 | M2 apply 가드 | D2 사전 점검, Brian 확인 |
| 12 | SDD-210 "134건"의 질의 정의 | 없음(기준선은 177 로 고정, 재측정) | 필요 없음 |
| 13 | 시안 승인 여부와 CH05~·CN03~ 의 화면 대응 | §11 매핑 일부 | U5 |
| 14 | `deploy/ci/check_migrations.py` 가 `ALTER TABLE … VALIDATE CONSTRAINT`·`ADD CONSTRAINT` 를 파괴적으로 분류하지 않는지(코드상 `DROP/DELETE/TRUNCATE/UPDATE` 만 확인됨) | PR-B 의 prod 릴리스 | S6·K1 에서 057 로 직접 실행 |
