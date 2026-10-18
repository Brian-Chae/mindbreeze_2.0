# SDD-214 Plan — 클래스·세션 재설계 Phase 1 (Stage ②)

> 2026-10-18 작성, **2026-10-18 개정(데이터 이전 폐기)** · 코드 변경 없음(문서 전용) · 입력: `spec.md`, `docs/class-session-restructure/{기획,영향도,결정-필요}.md`, `조사/R1·R7·R10`, `기획-상세-{상태머신권한,강사모델,회원내클래스,상담}.md`, `specs/sdd-211-class-structure-phase0/`, `specs/sdd-213-schema-drift/`, 현행 코드(파일:줄은 해당 항목에 표기)
> 기술 결정은 이 문서가 확정한다(§1). 비즈니스 결정은 `spec.md` 에 분리했고 남은 것은 **U2·U5** 뿐이다. 이 plan 은 추천안(U2 제외·U5 병행)을 전제로 쓴다.
> 확인하지 못한 것은 `미확인` 으로 표기하고 §14 에 모았다.

## 0. 결론 먼저

| 질문 | 답 |
|---|---|
| 무엇을 만드나 | 신규 테이블 10 + 기존 3개 테이블 가산 컬럼 + **즉시 유효한 제약** → 세션 생성 시 부모 동시 생성 → 읽기 API 5. 기존 데이터는 **지우고** 시작 |
| 출시 단위 | **2회 배포**: [dev 초기화(Brian 확인)] → PR-A(스키마·제약·모델·분류 함수·세션 생성 경로·일관성) → PR-B(읽기 API·`SessionDto`) |
| 마이그레이션 리비전 | `e036a0000053`(클래스군) · `…054`(상담군) · `…055`(보조 테이블 + 기존 테이블 컬럼 + 제약 + 가드). 현재 head `…052` 불변. **개정 전 5개(053~057) → 3개** (§3.3 판단·근거) |
| 안전의 핵심 | 기존 테이블 변경은 `ADD COLUMN`/`ADD CONSTRAINT` 뿐(DROP·UPDATE·기존 컬럼 변경 0 → 파괴적 게이트 통과). 비어 있지 않은 DB 에서는 055 가드가 **데이터 변경 없이 중단**. 빈 환경 전제라 롤백은 코드 revert 가 기본, 필요 시 승인 하 `downgrade` |
| 병렬 | 워커 **4**(W-DB·W-CL·W-API·W-CP), 동시 최대 3. 소유 파일 겹침 0 (§9) |
| Task 수 | **37 → 24** (제거 14, 신규 1 — §8 하단 변화표) |
| Brian 게이트 | verify 승인 → (구현) → **N1~N3 확인 후 dev 초기화** → PR-A 머지 go → PR-B 머지 go → prod(N4 확인 후) 릴리스 go (§12) |

---

## 1. 확정 기술 결정 (TD)

| # | 사안 | 결정 | 근거 |
|---|---|---|---|
| TD1 | 리비전 분할 | `053` 클래스군(`classes`·`class_instructors`·`class_members`·`class_member_events`) / `054` 상담군(`counseling_guests`·`counseling_relationships`·`counseling_relationship_counselors`·`counseling_relationship_events`·`guest_claim_events`) / `055` 보조(`session_host_history`) + 기존 테이블 가산 컬럼(`sessions`·`session_participants`·`reports`) + 제약 전부 + 가드. 한 PR(PR-A) | §3.3 판단. 부모 테이블 → 기존 테이블 컬럼·제약 순서 |
| TD2 | 멱등 가드 | 모든 DDL 은 존재 검사 후 실행(`CREATE TABLE`/`ADD COLUMN`/`CREATE INDEX` 는 `IF NOT EXISTS` 또는 `information_schema`·`pg_constraint` 검사 `DO` 블록). 첫 문장 `SET LOCAL lock_timeout='5s'` | SDD-213 리비전 `e036a0000052` 관례. 부분 적용 상태에서도 안전 |
| TD3 | 파괴적 게이트 | 053~055 의 `upgrade()` 에 `op.drop_*`·기존 컬럼 `alter_column`·`execute` 안의 `DROP/DELETE/TRUNCATE/UPDATE <table>` **0건**. `ADD CONSTRAINT`·`ADD COLUMN` 은 허용. `deploy/ci/check_migrations.py` 로 `destructive=false` 를 PR 에서 확인(`미확인` §14-12: `ADD CONSTRAINT` 분류) | prod 릴리스가 파괴적이면 `confirm_destructive` 입력이 필요(`deploy-prod.yml`). 데이터 삭제는 마이그레이션이 아니라 별도 수동 절차(Z) |
| TD4 | 컬럼·제약 형태 | 새 컬럼은 비어 있는 표에 추가되므로 **처음부터 제약 부과**. `sessions.session_kind` `NOT NULL DEFAULT 'regular'`. `host_state`·`seq`·`class_id`·`counseling_relationship_id` 는 **컬럼 자체는 NULL 허용**(템플릿이 부모 없음)이고, 비템플릿 필수는 CHECK 로: `ck_sessions_one_parent` = `is_template OR (num_nonnulls(class_id, counseling_relationship_id) = 1 AND seq IS NOT NULL AND host_state IS NOT NULL)`. `session_participants`: `CHECK(member_id IS NULL OR guest_client_id IS NULL)`, `UNIQUE(session_id, member_id)`. 컬럼 세부는 S0 | 이전 단계가 없어 `NOT VALID`→`VALIDATE` 불필요(§3.3). 템플릿은 Phase 8 까지 부모 없음 |
| TD5 | FK 삭제 규칙 | 부모 FK 는 `ON DELETE RESTRICT`(삭제=숨김 보존 전환). `reports.approved_by_user_id` 는 NO ACTION(현행 `sessions.host_id` 관례). `users` 행 삭제 경로는 바꾸지 않음 | `조사/R1` §8 서두, `기획-상세-상태머신권한` X13 |
| TD6 | 순환 FK 순서 | `class_instructors.scope_session_id`·`class_members.first_session_id`(→`sessions`, 기존 테이블)는 053 에서, `sessions.class_id`(→`classes`)·복합 FK 는 055 에서 추가 | 순서 의존, PG 테스트(S5)로 증명 |
| TD7 | `downgrade()` | 신규 테이블 DROP(의존 역순, `IF EXISTS`) + 추가 제약·컬럼 DROP 구현. docstring 에 "데이터가 있으면 소실, 비어 있는 환경에서만 사용" 명시. CI 의 `upgrade → downgrade → upgrade` 검증 + 빈 환경 롤백(§10.3)에 사용 | 빈 환경 전제로 데이터 소실 위험 소멸 |
| TD8 | ORM 에는 CHECK·복합 FK 미선언 | `ck_sessions_one_parent`·복합 FK 는 **마이그레이션(PG)에만** 두고 ORM 메타데이터에는 선언하지 않는다. 기존 SQLite 테스트 수백 건이 부모 없이 `Session(...)` 을 직접 만들고, SQLite 는 CHECK 를 집행하기 때문. 새 컬럼·단순 FK·인덱스·부분 유니크는 ORM 에 선언 | 변경 최소화(G1). 제약의 1차 증거는 PG 테스트(R9). `alembic check` 는 CHECK 는 비교하지 않지만 ORM 에 없는 복합 FK 는 remove_fk 차이로 감지하므로 `alembic/env.py` 의 `include_object` 에서 두 FK 를 이름으로 제외한다 |
| TD9 | 분류 함수 | `backend/app/services/session_classifier.py` 의 순수 함수 `classify_session(facts) -> Classification`. DB·시계·난수 접근 0. 입력 `SessionFacts(is_template, type, participant_mode)` · 출력 `Classification(parent_kind, rule)`. 규칙 §4 | 신규 생성 시점에는 참여자가 없으므로 참여자 수 기반 규칙(이전 규칙)은 쓸 수 없다 |
| TD10 | `reports` 컬럼 | `approved_by_user_id`·`approved_at` 는 컬럼만 추가. 기존 승인 경로(`report_service.py`)는 **값을 쓰지 않는다**(Phase 5) | 변경 최소화 |
| TD11 | 읽기 API 접근 범위 | 현행 `GET /sessions` 가시 범위의 **부모 단위 투영**. 새 정책 없음. 동치성 속성 테스트(§7)로 고정 | `D-05`·`D-28` 은 Phase 3 이전에는 확장 금지 |
| TD12 | 라우터 | `backend/app/api/v1/classes.py`(`/classes`), `counseling.py`(`/counseling`) 신설, `api/v1/__init__.py` 에 등록. 기존 `class_audio.py` 의 `/class` 접두사는 건드리지 않음 | `/class` 와 `/classes` 혼동 방지를 verify 로 확인 |
| TD13 | 응답 가산 | `SessionResponse`(`schemas/session.py:154`)에 선택 필드 `class_id`·`class_title`·`seq`·`area` 가산. 프론트 `SessionDto`(`frontend/src/lib/api/session.ts`)에 선택 필드로 반영 | SDD-211 계약 골든은 가산 통과(경고) 규칙 |
| TD14 | 세션 생성 경로 | 세션 생성(`services/session_service.py:335 create_session`, `duplicate`, `new-run`)에서 **분류 함수 → 부모 생성/선택 → 세션 INSERT 를 같은 트랜잭션**으로(CHECK 때문에 부모가 먼저 있어야 세션이 들어간다). `class_instructors(host_id,'lead','active')` 와 `seq`·`host_state` 도 같은 트랜잭션. 템플릿은 제외. 생성 지점 전수는 P0 에서 확정 | **폴백이 아니라 Phase 1 의 유일한 정식 경로**: 클래스 쓰기 API 가 Phase 3 에야 생긴다 |
| TD15 | `new-run` 산출물 | **세션도 부모도 새로 만들지 않는다**(구현 확인: `start_new_run` 은 `run_id` 만 교체, 완료·취소 세션은 거부). 정정 전 문구는 "별도 부모로 만든다" | `미확인`: 문서에 new-run 의 부모 귀속 규칙이 없음. 가장 보수적(구 의미 유지: 회차 연결은 `run_id` 가 담당). Phase 3 에서 재논의 |
| TD16 | 상담 세션 부모 | 만들 때 내담자를 알 수 없으므로 호스트별 **보관용 관계**(`is_placeholder`)에 배치하고 `seq` 를 이어 부여. 재배치는 이 SDD 에서 정의하지 않음(Phase 6) | 기본값 확정(구 U4). 보관용 관계는 `uq_rel_placeholder`(상담사당 1개)로 보호 |
| TD17 | 숨김 필터 | `core/database.py` 의 `with_loader_criteria` 에 `Class`·`CounselingRelationship` 의 `hidden_at IS NULL` 추가, 같은 `include_hidden` 옵션으로 해제 | 기획 §9 P1-7 |
| TD18 | 클래스 동기화·숨김 연쇄 | `PUT /sessions/{id}` 로 클래스 단위 필드가 바뀌면, 부모 클래스의 가시 세션이 1개일 때 클래스에 반영(Phase 1 의 클래스는 항상 1:1). 마지막 가시 세션이 숨겨지면 클래스도 `hidden_at`. 다회차 클래스는 Phase 3 이 규칙을 다시 정한다 | `GET /classes` 가 클래스 행의 설정을 보여주므로 어긋나면 안 됨(내부 일관성). `origin` 조건은 불필요(§TD20) |
| TD19 | 모델 파일 | 신규 모델은 `models/class_program.py`(클래스군), `models/counseling.py`(상담군), `models/session_parent.py`(`session_host_history`)로 분리하고 `models/__init__.py` 에 import. `Session`·`SessionParticipant`·`Report` 모델은 컬럼만 추가 | 기존 파일명 충돌 방지, 소유 영역 분리(§9). 파일명은 구현 시 확정 가능 |
| TD20 | 이전 전용 요소 정리 | `session_migration_map` 테이블 **제거**. `classes`/`counseling_relationships` 의 `origin` 컬럼은 `migrated`/`shim` 값이 사라져 의미가 없으므로 S0 에서 **컬럼 제거를 권고**(필요해지는 Phase 에서 추가 — 가산이라 비용 없음). 회원 시점 마스킹 목록에서 `origin`·`flags` 는 컬럼이 없으면 자동 소멸 | 이전·호환 소멸. 확정은 S0 의 `schema-contract.md` |
| TD21 | 데이터 초기화(Z) 설계 | 마이그레이션이 아닌 **별도 수동 절차**: 절차서 `reset-procedure.md` + 환경 가드가 있는 스크립트(`backend/scripts/reset_dev_data.py`, 기본 dry-run·삭제 대상 건수만 출력, 환경 식별 문자열 확인 없이는 `--apply` 거부, `alembic_version` 보존). 범위는 N1~N4 로 Brian 이 확인한 대로. 스크립트는 `reissue_class_codes.py` 와 같은 모양(서비스 + 얇은 CLI) | 삭제는 비가역이고 dev 는 현재 실사용 DB. 실행은 항상 Brian 확인 후 |

---

## 2. 아키텍처 요약

```
organizations 1 ─< classes 1 ─< class_instructors >─ users               [명상]
                   classes 1 ─< class_members                             (Phase 1 에서는 비어 있음)
                   classes 1 ─< sessions (class_id, seq, host_id → class_instructors, host_state, session_kind)
organizations 1 ─< counseling_relationships (counselor, client_user_id | client_guest_id → counseling_guests)
                   counseling_relationships 1 ─< sessions (counseling_relationship_id, seq)
sessions 1 ─< session_participants (member_id → class_members | guest_client_id → counseling_guests, 출석 컬럼; Phase 1 에서는 비어 있음)
sessions: class_id XOR counseling_relationship_id  -- 비템플릿 세션, ck_sessions_one_parent 로 DB 가 강제
엔진(reports·session_records·audio/video·eeg·chat) 은 sessions 를 계속 읽는다 (dual-write: 세션 컬럼도 계속 채운다)
```

- **dual-write**: 새 부모를 만들되 `sessions` 의 기존 컬럼(`title`·`access_code`·`max_participants` 등)도 그대로 유지한다. 엔진은 세션만 읽는다(호환이 아니라 "엔진 불변" 원칙). 세션 컬럼 쓰기 중단은 Phase 8 이후 별도 결정.
- 세션 id·참여자 id 불변: 알림 딥링크·JWT(`class_entry` 24h, `report_participant` 7일)·S3 키·Celery 인자가 의존.
- Phase 1 에서 `class_members`·`counseling_guests`·`class_member_events` 등은 **비어 있다**(쓰는 API 가 Phase 3~7). 회원 시점 가시 범위는 `session_participants` 기준(현행과 동일).

---

## 3. 스키마 상세

### 3.1 리비전 분할과 순서

| 리비전 | 파일(예) | 내용 |
|---|---|---|
| `e036a0000053` | `…053_sdd_214_class_tables.py` | `classes`, `class_instructors`, `class_members`, `class_member_events` + 인덱스. `class_instructors UNIQUE(class_id, user_id)`(복합 FK 참조 대상). 부분 유니크 `uq_classes_active_access_code` |
| `e036a0000054` | `…054_sdd_214_counseling_tables.py` | `counseling_guests`, `counseling_relationships`, `counseling_relationship_counselors`(복합 FK 참조 대상 유니크 포함), `counseling_relationship_events`, `guest_claim_events` + 인덱스. 부분 유니크 `uq_rel_guest`·`uq_rel_placeholder`·`uq_rel_active_pair` |
| `e036a0000055` | `…055_sdd_214_session_parent_columns_constraints.py` | ① **가드**(비템플릿 세션이 있으면 `RAISE EXCEPTION` — 메시지에 "데이터 초기화(Z) 먼저" 명시, 아무것도 변경하지 않음) ② `session_host_history` ③ `sessions`: `class_id`·`counseling_relationship_id`(단순 FK, RESTRICT, 인덱스)·`seq`·`session_kind`(`NOT NULL DEFAULT 'regular'`)·`host_state` ④ `session_participants`: `member_id`·`guest_client_id`·`attendance_status`·`attendance_kind`·`makeup_for_session_id`·`attendance_marked_by`·`absence_reason` ⑤ `reports`: `approved_by_user_id`·`approved_at` ⑥ 제약: `ck_sessions_one_parent`, 복합 FK `(class_id, host_id)→class_instructors(class_id, user_id)`·`(counseling_relationship_id, host_id)→counseling_relationship_counselors(relationship_id, counselor_id)`, `UNIQUE(class_id, seq)`·`UNIQUE(counseling_relationship_id, seq)`, `UNIQUE(session_id, member_id)`, `CHECK(member_id IS NULL OR guest_client_id IS NULL)` |

- 컬럼 단위 정의는 `조사/R1` §8.1~8.9 와 `기획-상세-회원내클래스` §2.2~2.3, `기획-상세-강사모델` §2.3 을 **원본**으로 하되, 구현 시작 시 Task S0 가 **컬럼 확정표**(`schema-contract.md`)를 만들어 verify 의 SC 항목과 대조한다. 불일치가 있으면 기획 문서(`기획.md` §4.3)를 우선한다(예: 클래스 상태는 `draft·active·completed·cancelled·archived`).
- `class_members` 상태 값: `invited·waitlisted·active·completed·left·removed·declined`, 출석 상태: `expected·attended·absent·excused·withdrawn` (`기획.md` §4.3).
- 인덱스는 일반 `CREATE INDEX`(빈 테이블·dev DB 54MB). `CONCURRENTLY` 는 Alembic 트랜잭션 안에서 불가하고 불필요.

### 3.2 제약이 들어가는 시점

**전부 055 에서 즉시 유효하게 건다.** 새 컬럼은 전부 NULL 인 빈 표(템플릿 제외)이고 새 테이블도 비어 있어 검증 비용이 없으며, 백필이 없으므로 "이전 후 검증" 단계가 필요 없다. 템플릿 예외(`is_template`)만 CHECK 안에 남긴다. `access_code` 쓰기 중단·템플릿 이사(`class_templates`)는 Phase 8 로 유지.

### 3.3 리비전 통합 판단 (M1~M3 → 3개)

| 판단 항목 | 결론 | 근거 |
|---|---|---|
| M1(가산)·M2(이전)·M3(제약)을 한 리비전으로 합칠 수 있는가 | **M2 는 소멸. M1 의 기존 테이블 컬럼과 M3 제약은 055 하나로 합친다** | 제약을 늦춘 이유는 이전분이 위반 상태였기 때문. 데이터가 없으면 컬럼 추가와 동시에 제약을 걸어도 검증 대상이 없다 |
| 단일 리비전 1개로 더 줄일 수 있는가 | **아니오. 053·054 는 분리 유지** | 테이블 9개를 한 파일에 몰면 리뷰·부분 실패 분석이 어렵다. 053/054 는 서로 독립이고 055 만 둘에 의존한다. 리비전을 합쳐도 `alembic upgrade head` 는 어차피 한 트랜잭션이라 안전성 이득은 없고 리뷰 비용만 는다 |
| `NOT VALID → VALIDATE` 2단계가 필요한가 | **불필요** | 055 가드가 비어 있음을 보장 |
| 이미 적용된 `e036a0000052` | **불변** | 단일 head 유지, 053 은 052 위에 쌓는다 |
| 소멸하는 리비전 | 개정 전 `…056`(기존 테이블 컬럼)·`…057`(M3 제약)은 055 로 흡수, 번호 폐기 | — |
| 가드의 부작용 | 비어 있지 않은 DB(예: 초기화 전 dev, 스모크 세션이 있는 prod)에서 배포가 **의도적으로 실패**한다 | 초기화(Z)를 먼저 하라는 신호. 마이그레이션이 한 트랜잭션이라 중단 시 DB 변경 0 |

---

## 4. 분류 함수 (C 트랙)

### 4.1 규칙표 (단순화 — 신규 생성 시점에는 참여자가 없다)

| 순서 | 조건 | 부모 | 규칙 코드 |
|---|---|---|---|
| 0 | `is_template = true` | 없음 | `T0` |
| 1 | `type = 'meditation'` | 명상 클래스 | `C1` |
| 2 | `clinical`·`hypnosis`·`custom` 이고 `participant_mode = 'group'` | 명상 클래스(유형 라벨 `type` 유지) | `C2` |
| 3 | `clinical`·`hypnosis`·`custom` 이고 `participant_mode = 'one_on_one'` | 상담 관계(호스트별 보관용, TD16) | `R3` |
| — | 위에 해당 없음(알 수 없는 `type`/`participant_mode`) | 분류 불가 | `X0` — 세션 생성 롤백 + 서버 오류 로그(도달하면 버그) |

- **`parent_kind` 허용 문자열**(분류 함수 반환값, 호출 측 P1 이 동일 상수를 사용): `none`(T0) · `meditation_class`(C1·C2) · `counseling_relationship`(R3) · `unclassifiable`(X0). 대소문자는 정규화하지 않고 엄격 비교한다(`"GROUP"` → X0). 템플릿·명상은 `participant_mode` 가 미상이어도 선행 규칙(T0·C1)이 먼저 적용된다.
- 이전 규칙에서 **삭제한 것**: 활성 참여자 수 판정(`C3`·`R1`·`R2`), `custom` 키워드 판정(`needs_host_confirm`), `flags`. 근거: 이전 대상 소멸(D-55~57) + 생성 시점에 참여자가 없음.
- `C2` 는 구 D-55("여러 명이면 명상 클래스, 유형 라벨 유지")의 취지를 **참여 방식으로 근사**한 plan 가정이다. 정원(`max_participants`)으로 그룹/1:1 을 판정하지 않는다(기본 정원이 10). `미확인`: 위 근사에 이의가 있는지 → Brian 이 plan 검토 시 확인(별도 결정 아님, 이의 없으면 이대로).
- 단위 테스트: 위 표 5행(T0, C1, C2, R3, X0) + 경계(`custom_type_name` NULL, 알 수 없는 `type`/`participant_mode`) + 순수성(같은 입력 → 같은 출력, DB 접근 없음).

---

## 5. 데이터 초기화 (Z 트랙) — 기존 백필(M2) 대체

기존 데이터를 이전하지 않고 지운다. **아래 모든 실행은 Brian 확인 후**(spec N1~N4).

### 5.1 절차

| 단계 | 내용 | 확인 |
|---|---|---|
| 0 사전 점검 | 환경 식별(dev/prod), `alembic_version`(052 여야 함), 삭제 대상 건수 보고(비템플릿 세션 수·사용자 수·S3 프리픽스별 오브젝트 수 — **건수만**, 개인정보 0) | 읽기 전용 |
| 1 확인 | 건수·범위(N1 DB·Redis, N2 S3·재시드)를 Brian 에게 보고하고 go | **Brian** |
| 2 DB 삭제 | `alembic_version` 을 제외한 애플리케이션 테이블 전부 `TRUNCATE … RESTART IDENTITY CASCADE`(스크립트가 테이블 목록을 카탈로그에서 읽어 의존 순서 무관) | 환경 문자열 확인 필요 |
| 3 큐·캐시 | Redis(Celery 큐·캐시 키) 비움 — 삭제된 세션 id 를 가리키는 잔여 작업 방지 | N1 |
| 4 S3 | N2 범위의 프리픽스 오브젝트 삭제(버킷 자체는 유지). 음성·PDF 는 개인정보 | N2 |
| 5 재시드 | `counselor@test.com`·`client@test.com` + `e2e-smoke` 용 e2e 계정(`scripts/e2e_seed.py seed`). `counselor@test.com`/`client@test.com` 생성 수단은 저장소에 없음(`미확인`) → Z1 이 확정(예: 가입 API 호출 또는 소형 시드 스크립트). 비밀번호는 문서·로그에 쓰지 않음 | N2 |
| 6 사후 확인 | 비템플릿 세션 0, 로그인 성공, `e2e-smoke` 통과 | 건수·성공 여부만 |

### 5.2 배포와의 선후 (경합 방지)

- 055 가드 때문에 **초기화는 PR-A 배포 직전**에 한다(N3). 초기화~배포 사이에 `e2e-smoke` 나 수동 테스트가 구 코드로 세션을 만들면 055 가드가 중단시킨다 → 그 경우 데이터 변경 0 이므로 **재초기화 후 재배포**하면 된다.
- PR-A 머지 직전에 (a) CI GREEN (b) 초기화 완료 (c) 가드 조건(비템플릿 세션 0) 확인 순서를 조정자 체크리스트로 고정.
- prod: N4 로 정한 범위(권고: 계정·기관 유지, 세션 계열 삭제)를 같은 절차로. 계정을 유지하면 `TRUNCATE` 대상 테이블 목록을 권고 범위로 제한해야 하므로 스크립트는 `--keep-accounts` 류 범위 옵션이 필요하다(구현 시 Z1 에서 확정).

### 5.3 되돌릴 수 없음에 대한 처리

- Brian 이 "기존 데이터는 하나도 필요 없다"고 확정했으므로 삭제 전 RDS 스냅샷은 **기본 생략**한다. 원하면 N1 확인 시 추가(스냅샷 생성 자체가 별도 승인 대상).
- 이 전제는 정식 릴리스 전까지만 유효하다(spec C5). 정식 릴리스 후에는 이 절차를 쓰지 않는다.

---

## 6. 세션 생성 경로·내부 일관성 (P 트랙) — 기존 "호환" 대체

### 6.1 구 앱 호환 항목 필요성 재평가

| # | 개정 전 항목 | 재평가 | 결과 |
|---|---|---|---|
| 1 | `POST /sessions` 부모 자동 생성 "폴백" | 구 앱 때문이 아니라, **CHECK 가 걸리면 부모 없이는 세션이 들어가지 않고 Phase 1 에는 클래스 쓰기 API 가 없다** | **유지·재정의**: 정식 생성 경로(TD14). `shim` 개념 폐기 |
| 2 | `duplicate`·`new-run`·템플릿 적용 경로 | 모두 `Session(...)` 생성 지점 | 유지(P0 전수) |
| 3 | 코드 입장 해석(클래스 코드 우선 + 세션 코드 폴백, 입장 불가 동일 404) | Phase 1 의 클래스는 세션과 1:1, 클래스 코드 = 세션 코드 복사. 입장 경로를 바꿀 이유가 없다 | **제거**. 입장은 기존 `sessions.access_code` 경로 그대로(변경 0). 클래스 코드 입장은 다회차가 생기는 Phase 3 |
| 4 | 코드 읽는 8개 파일의 "세션 값 없으면 클래스 값" 폴백 | dual-write 로 세션 컬럼은 항상 채워진다 → 폴백이 작동할 상황이 없다 | **제거** (8개 파일 수정 0) |
| 5 | 코드 발급 시 세션·클래스 활성 코드 합집합 | 클래스 코드는 세션 코드를 복사하므로 세션 유일성이 곧 클래스 유일성 | **제거**. `uq_classes_active_access_code` 는 무해한 안전망으로 유지 |
| 6 | 알림 `params` 에 `class_id`·`seq` 가산 | 소비자 없음(딥링크는 Phase 2). 레거시 `session_id` 유지는 구 앱이 아니라 **프론트(같은 릴리스)** 가 읽기 때문에 "변경 안 함" | **제거** (알림 코드 수정 0) |
| 7 | 구 앱 쓰기 동기화(`PUT` → 클래스) | `GET /classes` 가 클래스 행의 설정을 보여주므로 어긋나면 내부 불일치 | **단순화·유지** (TD18, `origin` 조건 삭제) |
| 8 | 마지막 가시 세션 숨김 시 클래스 숨김 | 안 하면 가시 세션 0개의 클래스가 목록에 남는 고아 발생 | 유지 |
| 9 | 레거시 호출 계측·호환 윈도우(M5)·일일 점검 | 구 앱 없음 | **제거** |
| 10 | 스트레이 세션·재백필 | CHECK 가 구조적으로 부모 없는 세션을 막는다 | **제거** |
| 11 | 보관 스위프 확장 | Phase 1 은 신규 테이블에 개인정보를 쓰지 않는다 | **제거** (PV 에서 "쓰지 않음"을 검사) |
| 12 | dual-write, 세션 id·참여자 id·WS 룸·JWT 불변 | 호환이 아니라 **엔진 불변 원칙** | 유지 |
| 13 | SDD-211 계약 골든(가산 전용) | §6.2 | 유지(사유 재정의) |

### 6.2 계약 골든 정책 판단

- 개정 전 사유: "구 앱(강제 업데이트 없음)이 새 서버와 동작". 이 사유는 소멸.
- 그러나 `/sessions/*` 61 라우트를 쓰는 **프론트가 같은 릴리스로 배포되며 Phase 1 은 화면 변경 0** 이므로, 골든은 "의도치 않은 응답 변경을 잡는 회귀망"으로 여전히 가치가 있다. Phase 1 의 응답 변경은 선택 필드 가산뿐이라 "가산 전용" 제약이 부담도 아니다.
- **결정**: 골든은 그대로 유지하고 가산 전용 규칙도 유지(완화 이득 없음). 사유만 "프론트 무변경 회귀망"으로 재정의. 파괴적 변경이 필요해지면 구 앱 협의 없이 기존 `breaking_exemptions.json` 절차 + Brian 승인 + 프론트 동반 수정으로 허용(규칙을 풀어 두지는 않는다). G1 Task 가 골든이 가산 필드를 실제로 허용하는지 먼저 확인.

### 6.3 Task 내용

| # | 대상 | 변경 |
|---|---|---|
| P0 | 전수 조사 | `Session(` 생성 지점 전수 목록(duplicate·new-run·템플릿 적용·기타) + CHECK 로 깨질 수 있는 **기존 PG 테스트**(`tests/pg`)의 직접 INSERT 목록 → 보고 |
| P1 | 세션 생성 | TD14. 분류 → 부모 생성/선택 → 세션 INSERT, 상담은 보관용 관계 재사용·`seq` 이어 부여(동시 생성 시 `UNIQUE(…, seq)` 충돌은 재시도 또는 행 잠금 — 구현 시 확정). `client_counselor_links` INSERT 0 |
| P2 | 일관성 | TD18: `PUT` 동기화, 마지막 가시 세션 숨김 시 클래스 숨김 |

---

## 7. 읽기 API (R 트랙)

### 7.1 엔드포인트

| 메서드·경로 | 응답 핵심 필드(초안, R1 단계에서 확정) | 가시 범위 |
|---|---|---|
| `GET /classes` | 목록: `id`·`title`·`status`·`schedule_mode`·`planned_session_count`·`area`·진행률(완료 회차/계획 또는 가시 회차)·`next_session{id,seq,scheduled_at,status,host}`·열린 세션 유무. `status` 필터·페이지네이션(기존 목록 관례). 검색은 Phase 2 | 호스트/강사: 자신이 강사인 클래스. org_admin/platform_admin: 현행 세션 목록 범위. 회원: 자신이 비제거 참여자인 세션이 속한 클래스 |
| `GET /classes/{id}` | 상세: 위 + 설정(장소·LINK BAND 모드·녹음·정원·참여 방식), `instructors[]`(호스트 시점만), 코드(호스트 시점만) | 동일 |
| `GET /classes/{id}/sessions` | 회차: `id`·`seq`·`scheduled_at`·`status`·`session_kind`·`host{id,name}`·`host_state` | 동일 |
| `GET /counseling` | 상담 관계 목록: `id`·`status`·상담사·내담자 표시(보관용은 고정 라벨 — Phase 1 은 보관용만 존재)·`modality_default`·회차 수·다음/최근 세션 | 상담사: 자신의 관계. 회원: **자신이 비제거 참여자인 세션이 속한 관계**(Phase 1 은 내담자가 관계에 묶이지 않으므로 세션 참여 기준 — 현행 가시 범위와 동일). 센터 관리자: 현행 범위를 넘지 않음(상담 본문 비공개 방침 `D-28` 은 Phase 3, 이 SDD 는 **메타만 노출**) |
| `GET /counseling/{id}` | 상세: 회차 목록(`id`·`seq`·`scheduled_at`·`status`·유형), 기록·리포트 **진행 상태 값만**(본문 없음) | 동일 |

- 모든 응답에 숨김(`hidden_at`)·제거 참여자는 제외. **EEG·녹음·전사·리포트 본문은 어떤 응답에도 넣지 않는다.**
- 회원 시점 응답에서 타 참여자·내부 필드(코드·`organization_attribution_known` 등)는 제외. 호스트 시점만 포함.
- 존재하지 않거나 권한 없는 id 는 현행 세션 상세와 같은 방식(상태코드·메시지)으로 응답 — 존재 여부를 구분해 노출하지 않는다. `미확인`: 현행 세션 상세의 정확한 방식(403/404) — R1 단계에서 `session_authz.authorize_session`(:127) 동작과 맞춘다.
- HTTP 요청은 200ms 이내 목표(프로젝트 규칙), N+1 질의 금지(목록은 집계 질의 1~2회).

### 7.2 동치성 원칙 (TD11)

`GET /classes/{id}/sessions`·`GET /counseling/{id}` 로 도달 가능한 세션 집합의 합 == 같은 사용자의 `GET /sessions` 목록 집합 (역할 5종 × 시드 데이터). 새 API 가 권한을 넓히지도 좁히지도 않는다는 증거이며 verify `RD-*` 의 핵심. 시드는 새 생성 경로(P1)로 만든 데이터를 쓴다.

### 7.3 프론트

- `frontend/src/lib/api/session.ts` 의 `SessionDto` 에 `class_id?`·`class_title?`·`seq?`·`area?` 선택 필드 가산(타입만, 화면 변경 0). 새 API 클라이언트·화면은 Phase 2.

---

## 8. Task 분해

표기: 규모 S(반나절 이하) · M(1~2일) · L(3일 이상, 상대값). **모든 구현 Task 는 테스트 먼저(RED) → 구현(GREEN)**. 소유는 §9.

| ID | Task | 소유 | 선행 | 규모 |
|---|---|---|---|---|
| **G0** | 기준선: pytest·vitest·tsc·eslint 통과/실패 목록, `alembic heads`, SDD-211 계약 골든 현황, head/개수 하드코딩 테스트 grep → `baseline.md` | 조정자 | verify 승인 | S |
| **G1** | 계약 골든이 응답 속성 **가산**을 허용하는지 실험적으로 확인(`tests/contract/golden/*`, `compat.py`). 응답 형태 17 시나리오가 키 집합 정확 비교면 예외 절차 확정 | 조정자 | G0 | S |
| **S0** | 컬럼 확정표 `schema-contract.md`(테이블별 컬럼·타입·NULL·기본값·FK·인덱스·부분 유니크·CHECK, 근거 문서 §, `origin` 컬럼 제거 여부 확정(TD20)) 작성 후 verify SC 항목과 대조 | W-DB | G0 | M |
| **S1** | 리비전 `053` 클래스군 (RED: PG 테스트 → GREEN) | W-DB | S0 | M |
| **S2** | 리비전 `054` 상담군 | W-DB | S1 | M |
| **S3** | 리비전 `055`: 가드 + 보조 테이블 + 기존 테이블 가산 컬럼 + 제약 일괄 | W-DB | S2 | L |
| **S4** | ORM 모델 3파일 + 기존 모델 컬럼 추가 + `models/__init__.py` + `core/database.py` 숨김 필터(TD17). CHECK·복합 FK 는 ORM 미선언(TD8) | W-DB | S3 | M |
| **S5** | PG 테스트(`tests/pg/test_sdd214_schema.py`): 빈 DB 체인 `upgrade head`, 덤프 픽스처 복원 후 Z 절차로 비운 뒤 `upgrade head`, **가드**(비템플릿 세션 있으면 중단·변경 0), `upgrade → downgrade → upgrade` 멱등, 제약 위반/통과(CHECK·복합 FK·UNIQUE), `check_migrations` 가 053~055 에 대해 `destructive=false`. 기존 `tests/pg` 중 부모 없이 `sessions` 를 INSERT 하는 테스트 정정(허용 목록, P0 결과) | W-DB | S4 | M |
| **C1** | 분류 함수 단위 테스트 RED (§4.1 5행 + 경계 + 순수성) | W-CL | G0 | S |
| **C2** | `session_classifier.py` 구현 GREEN | W-CL | C1 | S |
| **Z1** | 초기화 절차서 `reset-procedure.md` + 환경 가드 스크립트 `reset_dev_data.py`(dry-run 기본, 건수만 출력, 범위 옵션) + `counselor@test.com`·`client@test.com` 재시드 수단 확정 + 합성 PG DB 에서 삭제→재시드→055 가드 통과 테스트. **실행은 하지 않는다**(D2/D4 에서 Brian 확인 후) | 조정자 | S5 | M |
| **R1** | 읽기 API RED: 역할 5종 × 시드(P1 경로로 생성), 동치성 속성 테스트, 숨김·제거 제외, 회원 마스킹, 본문 비노출 | W-API | S5, P1 | M |
| **R2** | `schemas/class_parent.py`, `services/class_read_service.py`, `api/v1/classes.py` | W-API | R1 | M |
| **R3** | `api/v1/counseling.py` + 서비스(상담 관계 읽기) | W-API | R2 | M |
| **R4** | `SessionResponse` 가산 필드 + 응답 조립부, 계약 골든 가산 통과 확인 | W-API | G1, S4 | S |
| **R5** | 프론트 `SessionDto` 선택 필드 가산 + tsc | W-API | R4 | S |
| **P0** | `Session(` 생성 지점 전수 + 기존 PG 테스트 직접 INSERT 목록 보고 | W-CP | G0 | S |
| **P1** | 세션 생성 경로 RED→GREEN (TD14·TD16): `POST /sessions`·`duplicate`·`new-run`, 템플릿 제외, 상담 보관용 배치, 원자성 | W-CP | C2, S5, P0 | L |
| **P2** | 일관성 (TD18): `PUT` 동기화·마지막 가시 세션 숨김 시 클래스 숨김 | W-CP | P1 | M |
| **D1** | PR-A 구성·CI 3잡·머지 준비(머지는 D2 에서 Brian go) | 조정자 | S5, C2, P2, Z1 | S |
| **D2** | **dev 초기화(N1~N3 확인) → PR-A 머지 → dev 배포 → `e2e-smoke`** | 조정자 + Brian | D1 | M |
| **D3** | PR-B(R1~R5) 머지·dev 배포 | 조정자 | D2, R5 | S |
| **D4** | prod 반영(N4 확인): 사전 점검(head·`destructive`·세션 계열 데이터 현황) → 초기화 → 릴리스(PR-A+B) 승인 | 조정자 + Brian | D3, Brian go | M |
| **I1** | 전체 회귀, summary.md, 시안 매핑(§11) 최종 점검 | 조정자 | D3 | S |

**Task 수 변화 (37 → 24)**

| 구분 | Task |
|---|---|
| 제거 (14) | B1~B6(백필 6), K1(M3 제약 리비전), 개정 전 P2(코드 입장 해석·8개 파일), P4(알림), P5(스위프), P6(계측), 개정 전 D1~D6 중 2(PR 3→2, M2·M5·재백필 단계 소멸), 개정 전 S3·S4 중 1(보조/컬럼 리비전 통합) |
| 신규 (1) | Z1 (데이터 초기화 절차·스크립트) |
| 이름·내용 변경 | 개정 전 P3 → P2(동기화), 개정 전 S6 → S5, D1~D4 재정의 |
| 불변 | G0·G1·S0·S1·S2·C1·C2·R1~R5·P0·P1·I1 |

---

## 9. 병렬 워커 소유 영역

원칙: **파일 단위로 소유자 1명**, 겹치면 직렬. 각 워커는 별도 worktree·브랜치(`sdd/214-<워커>`)에서 일하고 조정자가 통합 브랜치 `sdd/214-int` 로 병합한다. `git add` 는 파일 지정, 소유 밖 파일 수정 금지.

| 워커 | 소유 파일(경로) | 읽기만 가능 | Wave |
|---|---|---|---|
| **W-DB** | `backend/alembic/versions/e036a00000{53..55}_*`, `backend/app/models/{class_program,counseling,session_parent}.py`, `backend/app/models/session.py`(컬럼 추가), `backend/app/models/record.py`(`Report` 컬럼 2개), `backend/app/models/__init__.py`, `backend/app/core/database.py`, `backend/tests/pg/test_sdd214_schema.py`, `backend/tests/pg/conftest.py`, `specs/sdd-214-…/schema-contract.md` | 전부 | 1 |
| **W-CL** | `backend/app/services/session_classifier.py`, `backend/tests/test_sdd214_classifier.py` | 모델·세션 서비스 | 1 |
| **W-API** | `backend/app/api/v1/{classes,counseling}.py`, `backend/app/api/v1/__init__.py`(라우터 등록), `backend/app/schemas/class_parent.py`, `backend/app/schemas/session.py`(가산 필드), `backend/app/services/class_read_service.py`, `backend/app/api/v1/session.py`(응답 조립부 가산에 한함), `frontend/src/lib/api/session.ts`, `backend/tests/test_sdd214_read_api.py` | 모델, `session_authz`, 세션 목록 가시 범위 | 2 |
| **W-CP** | `backend/app/services/session_service.py`, `backend/tests/test_sdd214_create_path*.py`, `backend/tests/pg/test_sdd214_create_path.py` | 모델, 분류 함수 | 2 |
| **조정자** | `baseline.md`, `reset-procedure.md`, `backend/scripts/reset_dev_data.py`(+서비스), `summary.md`, 통합 브랜치, `.github/workflows/*`(변경 필요 시), PR | — | 전체 |

- **개정으로 소유 영역에서 빠진 것**: W-BF 전체(백필), W-CP 의 `class_code_service`·`class_code_reissue`·`code_service`·`reminder_service`·`org_public_service`·`dashboard_service`·`session_email_invite_service`·`notification_service`·`retention_sweep_service` (수정 0 — verify G5 정적 검사 대상).
- **Wave 0(직렬)**: G0·G1·P0 → verify 승인 후.
- **Wave 1(병렬 2)**: W-DB(S0~S5) ∥ W-CL(C1~C2). 서로의 파일을 읽지 않는다.
- **Wave 2(병렬 2~3)**: W-API ∥ W-CP ∥ 조정자(Z1). 선행: 통합 브랜치에 S5·C2 병합. `session_service.py`·`schemas/session.py`·`api/v1/__init__.py`·`models/__init__.py` 는 위 소유자 외 수정 금지(충돌 핫스팟). R1(읽기 API 시드)은 P1 이 끝나야 하므로 W-API 는 R4·R5 를 먼저 진행해도 된다.
- **Wave 3(직렬)**: PR-A(S·C·P·Z1) → 초기화 → 머지 → PR-B(R) → prod.
- PR-A 에는 W-DB·W-CL·W-CP(+ Z1 문서·스크립트)가, PR-B 에는 W-API 가 들어간다. 제약이 켜진 상태에서는 생성 경로(P1)가 반드시 같은 배포에 있어야 하므로 **P 와 S 를 분리하지 않는다.**

---

## 10. 마이그레이션 안전

### 10.1 멱등

| 층 | 수단 |
|---|---|
| 스키마 | TD2: 존재 검사 후 실행, 2회 적용해도 오류 0 (S5 가 `upgrade → downgrade → upgrade` 와 "이미 일부 적용" 상태에서 `upgrade` 를 검증) |
| 가드 | 055 첫 단계. 비어 있으면 통과, 아니면 변경 없이 중단 |
| 초기화(Z) | 스크립트 재실행 안전(이미 비어 있으면 변경 0) |

### 10.2 데이터 보존 → 데이터 초기화 후 시작

| 단계 | 보장 | 증명 |
|---|---|---|
| 053·054 | 새 테이블만 생성, 기존 행·컬럼 변경 0 | `check_migrations` `destructive=false` |
| 055 | 기존 3개 테이블의 변경은 `ADD COLUMN`·`ADD CONSTRAINT`·인덱스뿐. 기존 컬럼 변경 0. **템플릿 세션은 보존**(가드·CHECK 예외) | PG 테스트: 템플릿 행 해시 이전/후 동일, 기존 컬럼 카탈로그 diff 가 추가 항목만 |
| Z | Brian 확인 범위만 삭제. `alembic_version` 보존 | 건수 보고서(개인정보 0) |

### 10.3 롤백 (총칙: 코드 revert 우선, 빈 환경에서는 승인 하 `downgrade` 허용)

| 시점 | 정상 롤백 | 주의 |
|---|---|---|
| PR-B 후 | PR-B revert | 읽기 API 가 사라질 뿐 |
| PR-A 후 | **forward-fix 권장**(단일 개발자, 빠른 수정 배포). 코드만 revert 하면 DB 에 CHECK 가 남아 구 코드의 세션 생성이 실패한다 → 빈 환경이므로 Brian 승인 하에 수동 `alembic downgrade e036a0000052`(신규 테이블·제약·컬럼 DROP, 무손실) 후 코드 revert 도 가능 | 개정 전 "구 코드가 새 스키마에서 동작" 보증은 **포기**(그 전제는 구 앱 호환용). `downgrade` 는 데이터가 있으면 소실되므로 데이터가 쌓인 환경에서는 사용 금지 |
| 초기화(Z) | 되돌릴 수 없음 | N1~N4 확인이 유일한 안전장치(§5.3) |

- **롤백 트랩 주의**: `deploy-dev.yml` 의 롤백은 `dist`·`backend/app`·`backend/alembic` 만 복원하고 DB 를 되돌리지 않는다. PR-A 배포가 실패해 롤백되면 DB 는 `…055`(또는 중간 리비전)인데 `backend/alembic` 에는 그 리비전이 없을 수 있다 → 롤백 후 **새 코드가 다시 배포되기 전까지 수동 `alembic` 명령 금지**(기획 §12). 한 번의 `alembic upgrade head` 는 대기 리비전을 한 트랜잭션으로 실행하므로(`env.py`) 053~055 중간 실패는 전체 롤백 — 가드 실패 시 DB 변경 0.

### 10.4 락과 성능

- `ADD COLUMN`(NULL/상수 기본값)은 메타데이터 변경, `lock_timeout 5s` 로 장시간 대기 방지. 빈 표라 제약 추가 비용 0. 사용자 체감 점검 창 불필요.

### 10.5 환경 순서와 prod 사전 점검

dev: [초기화] → PR-A 배포 → PR-B 배포. prod: 같은 순서(N4 범위). prod 는 `release-build` → Brian 승인 → `deploy-prod`. **prod 사전 점검(읽기 전용)**: 현재 prod head(`…051`/`…052`), `release-build` 요약의 `destructive` 판정(052 는 `UPDATE` 를 포함해 파괴적으로 분류될 수 있음, `미확인`), 스모크 세션 등 비템플릿 세션 잔존 여부(있으면 가드에 걸리므로 N4 범위로 삭제).

---

## 11. 시안(Phase 2) 연결 매핑

시안 화면 → Phase 1 이 줄 수 있는 데이터. 화면 이름은 시안 코드에서 확인한 것만 적었고 나머지는 지시서(`지시서-*.md`) 기준이다.

| 시안 | 필요 데이터 | Phase 1 제공 | 판정 |
|---|---|---|---|
| CH01 클래스 목록 | 클래스명·다음 세션·진행률 `3/8`·진행 강사·열린 세션 | `GET /classes` | 제공(검색·필터 고급 조합은 Phase 2) |
| CH02 클래스 상세 개요 | 설정·강사·코드·상태 | `GET /classes/{id}` | 제공 |
| CH03 세션 탭(타임라인·강사 변경 시트) | 회차·일시·진행 강사·상태·취소/보강 | `GET /classes/{id}/sessions` (`session_kind`·`host_state`) | 읽기만 제공, **강사 변경은 Phase 3** |
| CH04 멤버/출석 탭 | 멤버 목록·출석 | 테이블은 존재하나 **비어 있고 읽기 API 없음** | 후속(Phase 4) — Phase 2 는 "데이터 없음" 처리 |
| 리포트 탭·추이 | 회차별 리포트·승인 상태 | 없음 | Phase 5 |
| MC01~MC03 회원 홈·내 클래스·클래스 상세 | 클래스명·`seq`·진행 강사·상태·내 참석 | `GET /classes`·`/classes/{id}`·`/classes/{id}/sessions` 의 회원 시점 | 제공(참석/결석/보강 표기는 출석 컬럼이 Phase 4 까지 비어 있어 "데이터 없음") |
| MC04 변화 서사 · MC05 비회원 제한 뷰 · MC06 상태 안내 · MC07 알림 | 서사·멤버 상태·알림 `params` | 없음(알림 `params` 가산도 이번에 하지 않음) | Phase 4~5 (알림 딥링크용 `params` 는 Phase 2 가 필요 시 추가 요청) |
| CN01 상담 목록 · CN02 상담 상세 | 관계 목록/상세·회차·상태 | `GET /counseling`·`/counseling/{id}` | 제공(Phase 1 은 보관용 관계 위주, 종결/보관 동작은 Phase 6) |
| CN07·CN08 내 상담 | 상담사·회차·다음 상담 | 회원 시점 `GET /counseling` | 제공(리포트 열람은 기존 리포트 경로) |
| CN03~CN06, CN09~CN16 마법사·승인·종결·비회원 입장·회원 전환 | 쓰기 흐름 | 없음 | Phase 6~7 |

- Phase 1 이 **데이터 없음으로 남기는 것**은 Phase 2 가 빈 상태/비활성으로 표시해야 한다. 이 표는 verify `DS-1` 로 최종 점검한다.
- 시안 승인 전이라 화면 ID↔기능 대응 중 일부(CH05~, CN03~)는 지시서 순서 기준의 추정이다(`미확인`).

---

## 12. 배포 순서와 Brian 게이트

| 순 | 단계 | 내용 | 승인 |
|---|---|---|---|
| 0 | verify 승인 | 이 문서 3종 검토. 사용자 결정 U2·U5 답 | **Brian** |
| 1 | 구현 | Wave 0~2, 로컬/PG 테스트. 푸시·머지 없음(통합 브랜치까지) | — |
| 2 | PR-A 준비 | S·C·P·Z1 병합, CI 3잡(frontend·backend·`backend-pg-smoke`) GREEN. **머지 전** 마이그레이션 PR 본문에 롤백 설계(§10.3)와 `check_migrations` 결과 첨부 | PR 본문 검토 (Brian) |
| 3 | **dev 초기화** | N1(DB·Redis)·N2(S3·재시드)·N3(시점) 확인 → 사전 점검 건수 보고 → go → 초기화 → 재시드 | **Brian 확인 후 실행** |
| 4 | **PR-A 머지** | 초기화 직후 머지 → `deploy-dev` 자동(055 가드 통과) → `e2e-smoke` | 머지 go (Brian) |
| 5 | **PR-B 머지** | 읽기 API·`SessionDto` → 배포 → `e2e-smoke` | 머지 go (Brian) |
| 6 | prod | N4 확인 → 사전 점검(읽기 전용) → 세션 계열 초기화 → `release-build` → 릴리스 승인 → `deploy-prod` → `/health/ready` | 릴리스 승인 + 초기화 go (Brian) |
| 7 | summary | summary.md 작성 | 최종 리뷰 (Brian) |

- 배포 직후 점검: `alembic_version`, 신규 테이블 10개·컬럼 존재, 새 세션 생성 후 부모 확인, `e2e-smoke`.
- Phase 8(`access_code` 쓰기 중단·템플릿 이사)은 이 SDD 밖.
- 정식 릴리스 전에 prod 반영 완료(spec C5).

---

## 13. 위험

| # | 위험 | 가능성/영향 | 대응 | 롤백 |
|---|---|---|---|---|
| R1 | CHECK 가 켜진 DB 에서 **구 코드**가 세션을 못 만듦(롤백 트랩이 코드만 복원) | 중/중 | 구 앱 호환을 의도적으로 포기. forward-fix 우선, 빈 환경 `downgrade` 허용(§10.3) | forward-fix / 승인 하 `downgrade` |
| R2 | 초기화 범위 오류로 **필요한 데이터까지 삭제**(특히 prod 계정·기관) | 낮음/높음 | N1~N4 확인, 환경 가드, dry-run 건수 보고, prod 는 범위 옵션 분리 | 복구 불가 — 확인 절차가 유일한 방어 |
| R3 | 초기화~배포 사이 경합으로 055 가드가 배포를 중단 | 중/낮음 | 머지 직전 초기화(N3), 가드가 변경 0 으로 중단, 재초기화 후 재배포 | 재초기화 |
| R4 | **링크 자동 생성**으로 AI 비서·채팅 권한 발생(X4/X16) | 낮음/높음 | 생성 경로 어디서도 `client_counselor_links` INSERT 0 — 테스트로 고정 | — |
| R5 | 읽기 API 가 권한을 넓힘 | 중/높음 | TD11 동치성 속성 테스트, 회원 시점 마스킹, 본문 비노출 | 코드 revert |
| R6 | 복합 FK·CHECK 가 SQLite 테스트에서 동작하지 않아 위반이 통과(X16) | 중/높음 | PG 테스트가 1차 증거(`backend-pg-smoke`), ORM 미선언(TD8) 대신 PG 에서 직접 검증 | — |
| R7 | CHECK 때문에 기존 `tests/pg` 일부가 부모 없이 INSERT 해 실패 | 중/낮음 | P0 가 목록 확정, 허용 목록에 한해 정정(verify §4) | — |
| R8 | 병렬 워커의 충돌(`session_service.py` 등) | 중/낮음 | §9 소유 규칙, 통합 브랜치 | — |
| R9 | `/class` ↔ `/classes` 라우트 혼동 | 낮음/낮음 | verify: 두 접두사 라우트 목록 대조 | — |
| R10 | 계약 골든 형태 비교가 가산 필드에 실패 | 중/낮음 | G1 에서 사전 확인, 예외 파일 절차(SDD-211 `breaking_exemptions.json`) | — |
| R11 | 053~055 중 파괴적 판정(`ADD CONSTRAINT` 분류 포함)이 나와 prod 릴리스가 차단 | 낮음/중 | TD3 + PR 에서 `check_migrations` 확인(§14-12) | 리비전 수정 |
| R12 | `미확인` 이 구현 중 사실로 판명되어 Task 가 바뀜 | 중/중 | §14 를 G0·P0·S0·Z1 에서 먼저 해소, 변경은 verify `변경 이력` 에 사유 기록 | — |
| R13 | 정식 릴리스 일정이 앞당겨져 "삭제 가능" 전제가 무효 | 낮음/높음 | spec C5: 릴리스 전에 prod 반영 완료 | — |

---

## 14. 미확인 (구현 전 해소 계획 포함)

| # | 미확인 | 영향 | 해소 |
|---|---|---|---|
| 1 | prod 현재 head(`…051`/`…052`) 및 052 의 파괴적 판정이 다음 prod 릴리스에 미치는 영향 | prod 릴리스 절차 | D4 사전 점검(읽기 전용) |
| 2 | SDD-211 응답 형태 골든 17 시나리오가 가산 필드를 허용하는지 | R4 의 골든 갱신 필요 여부 | G1 |
| 3 | `Session(` 생성 지점 전수(duplicate·new-run·템플릿 적용·기타) 및 기존 `tests/pg` 직접 INSERT | 생성 경로 누락, 허용 목록 | P0 |
| 4 | `new-run` 산출물의 부모 귀속 규칙(TD15 는 보수적 가정) | new-run 동작 | 구현 중 확인, Phase 3 재논의 |
| 5 | 보관용 관계의 `seq` 동시 생성 경합 처리(행 잠금 vs 재시도) | P1 설계 | P1 RED 테스트에서 확정 |
| 6 | 분류 `C2` 가 구 D-55 의 근사로 적절한지(§4.1) | 그룹 상담형 세션의 부모 종류 | Brian 이 plan 검토 시 확인(이의 없으면 확정) |
| 7 | 현행 세션 상세의 권한 없음/존재하지 않음 응답 방식(403 vs 404) | 읽기 API 일관성 | R1 에서 `session_authz.py` 동작 확인 |
| 8 | 읽기 API 가 기존 감사 로그(데이터 접근 로깅, 6개월 보관 규칙)에 걸리는지 | 프라이버시 규칙 | R1 에서 현행 세션 읽기의 로깅 방식 확인, 동일 방식 적용 |
| 9 | `class_members`·`session_participants` 신규 출석 컬럼의 정확한 길이·값 집합(R4 §3.2 원본) | 컬럼 확정표 | S0 |
| 10 | 시안 승인 여부와 CH05~·CN03~ 의 화면 대응 | §11 매핑 일부 | U5 |
| 11 | `counselor@test.com`·`client@test.com` 재시드 수단(저장소에 시드 스크립트 없음), SDD-211 덤프 픽스처가 데이터를 포함하는지 | Z1, S5 | Z1·S5 |
| 12 | `deploy/ci/check_migrations.py` 가 `ALTER TABLE … ADD CONSTRAINT`·`CHECK` 를 파괴적으로 분류하지 않는지(코드상 `DROP/DELETE/TRUNCATE/UPDATE` 만 확인됨) | prod 릴리스 | S5 에서 053~055 로 직접 실행 |
| 13 | `origin` 컬럼 제거 여부 최종(TD20 은 권고) | 컬럼 확정표 | S0 |

---

## 15. 개정 요약 (2026-10-18, 데이터 이전 폐기)

**새로 생긴 것**: Z 트랙(dev 초기화 절차·스크립트·재시드·실행 시점 확인 N1~N4), 055 **가드**, 제약 즉시 유효(`ck_sessions_one_parent` 포함), ORM 미선언 원칙(TD8), 빈 환경 `downgrade` 허용(§10.3), 구 앱 호환 항목 재평가표(§6.1), 계약 골든 정책 판단(§6.2), 리비전 통합 판단(§3.3), 분류 함수 단순화(§4.1), 신규 상담 세션의 보관용 배치 기본값(TD16), 정식 릴리스 전 prod 반영 전제(R13).

**사라진 것**: 백필 M2 전부(Task B1~B6, `session_migration_map`, V1~V19), M3 별도 리비전/PR, M5 호환 윈도우·계측·스트레이 재백필, 코드 입장 해석·8개 파일 폴백·발급 합집합, 알림 `params` 가산, 스위프 확장, 역방향 SQL, 스냅샷 선행, 사용자 결정 U1·U3·U4(단순화), 확인 C1·C2·C4.

**유지**: dual-write·세션 생성 시 부모 동시 생성·일관성 동기화·읽기 API·동치성 원칙·숨김 필터·계약 골든·엔진 불변·시안 매핑.

## 16. 구현 중 확정 사항 (2026-10-18, W-CP·리뷰 반영)

| 항목 | 확정 |
|---|---|
| `new-run` | 세션·부모 생성 없음(TD15 정정) |
| 클래스 기본값 | `planned_session_count=1`, `schedule_mode='fixed'` (일정 없는 즉석 세션에도 동일 적용, Phase 1 1:1·즉석 구조 가정) |
| PUT 으로 `type`·`participant_mode` 변경 | 부모 **고정**(재분류·재배치 안 함, Phase 1). 필요 시 후속 Phase |
| 세션 종료·취소 시 클래스 `status` | 연동 안 함(Phase 3 에서 상태 필터·코드 해제 정책과 함께 결정). 코드 충돌은 실제 유니크 충돌 대상 클래스의 `access_code` 만 비워 방어 |
| 호스트 삭제(`admin_service`) | 가시 세션이 0이 된 클래스를 같은 트랜잭션에서 숨김 |
| 신규 읽기 API 의 미존재·접근 불가 | 동일 404(존재 여부 비노출). 기존 `/sessions` 는 변경 없음 |
