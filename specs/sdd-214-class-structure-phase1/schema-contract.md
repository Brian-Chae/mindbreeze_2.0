# SDD-214 컬럼 확정표 (Task S0, schema-contract)

> 2026-10-18 · 작성: W-DB · 리비전 `e036a0000053`(클래스군) · `…054`(상담군) · `…055`(보조·기존 테이블 컬럼·제약·가드)
> 이 문서가 마이그레이션·ORM 모델·테스트의 **단일 기준**이다. `backend/tests/pg/test_sdd214_schema.py` 가 이 표를 파싱해 PG 카탈로그와 1:1 대조한다(verify SC-1) — 표 형식을 바꾸면 파서도 함께 고쳐야 한다.
> 표기: 타입 `uuid` `varchar(N)` `text` `int` `bool` `timestamptz` `date` `jsonb` · NULL 열 `NN`=NOT NULL / `NULL`=허용 · 기본값 `-`=없음.
> 근거 약어: `R1`=조사/R1-데이터모델 · `R4`=조사/R4-회원참여모델 · `B`=기획.md · `상담`=기획-상세-상담.md · `강사`=기획-상세-강사모델.md · `회원`=기획-상세-회원내클래스.md · `TD`=plan §1.

## 0. 공통 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| id | 모든 신규 테이블 `uuid` PK, DB 기본값 없음(앱이 `uuid4` 발급, 기존 모델과 동일) | 기존 `Session.id` 관례 |
| FK 삭제 규칙 | **부모 FK**(`classes`·`counseling_relationships`·`class_members`·`counseling_guests` 를 가리키는 FK, 복합 FK 포함) = `RESTRICT`. `users`·`organizations` 를 가리키는 FK = NO ACTION(현행 `sessions.host_id` 관례, `reports.approved_by_user_id` 포함). `sessions` 를 가리키는 선택 참조(`scope_session_id`·`first_session_id`·`makeup_for_session_id`) = `SET NULL`(세션 원본 삭제 경로를 막지 않기 위해). 이력 테이블은 FK 없음 | TD5 · R1 §8 서두 |
| 열거 값 | 모두 `CHECK (col IN (…))` 로 DB 가 강제(PG 마이그레이션에만 존재, ORM 미선언 — TD8) | TD4 |
| `origin` 컬럼 | **제거**: `classes`·`counseling_relationships`·`counseling_guests` 에 두지 않는다(`migrated`/`shim` 값이 사라져 의미 없음, 필요한 Phase 에서 가산) | TD20 (plan 권고 확정) |
| `session_migration_map`·`class_templates` | 만들지 않는다 | spec 조사 정정 2 |
| 판단 보류 항목 | `counseling_relationships.counselor_memo`·`retention_hold` 는 R1 이 "판단 보류"라 **제외**(해당 Phase 에서 가산) | R1 §8.4 |
| 시각 컬럼 | `timestamptz`, `created_at`/`updated_at` 은 `DEFAULT now()` | R1 §8 서두 |
| ORM 미선언 | `ck_sessions_one_parent` 와 `sessions` 복합 FK 2개는 ORM 메타데이터에 없다. 신규 테이블의 CHECK 도 ORM 에 선언하지 않는다(PG 마이그레이션이 정본). `alembic check` 는 ORM 에 없는 복합 FK 를 차이(remove_fk)로 감지하므로 `alembic/env.py` 의 `include_object` 에서 두 FK 를 **이름으로 제외**한다(CHECK 는 비교 대상이 아님). DB 정의 존재는 PG 테스트가 계속 검증 | TD8 · SC-10 · SC-14 |
| `member_id` 의미 | `session_participants.member_id` → `class_members.id` | R4 §3.2 |

## 1. 신규 테이블 — 053 (클래스군)

### `classes`

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R1 §8.1 |
| `organization_id` | uuid | NULL | - | FK `organizations` | R1 §8.1 |
| `organization_attribution_known` | bool | NN | false | | R1 §8.1 |
| `created_by` | uuid | NN | - | FK `users` | R1 §8.1 |
| `title` | varchar(200) | NULL | - | | R1 §8.1 |
| `description` | text | NULL | - | | R1 §8.1 |
| `schedule_mode` | varchar(10) | NN | 'fixed' | CHECK `fixed`·`rolling` | R1 §8.1 |
| `planned_session_count` | int | NULL | - | CHECK NULL 또는 ≥1 | R1 §8.1 |
| `status` | varchar(12) | NN | 'active' | CHECK `draft`·`active`·`completed`·`cancelled`·`archived` | B §4.3 (R1 초안보다 우선) |
| `capacity` | int | NN | 1 | CHECK ≥1 | R1 §8.1 |
| `participant_mode` | varchar(20) | NN | 'one_on_one' | | R1 §8.1 |
| `linkband_mode` | varchar(20) | NN | 'none' | | R1 §8.1 |
| `location_type` | varchar(20) | NN | 'offline' | | R1 §8.1 |
| `location_address` | varchar(300) | NULL | - | | R1 §8.1 |
| `default_duration_min` | int | NN | - | | R1 §8.1 |
| `record_audio` | bool | NN | true | | R1 §8.1 |
| `record_video` | bool | NN | true | | R1 §8.1 |
| `chat_enabled` | bool | NN | false | | R1 §8.1 |
| `sfu_enabled` | bool | NN | false | | R1 §8.1 |
| `reminder_offsets` | jsonb | NN | '[]' | | R1 §8.1 |
| `recurrence_rule` | jsonb | NULL | - | Phase 3 이 채움 | B §4.3 |
| `assignment_rule` | jsonb | NULL | - | Phase 3 이 채움 | 강사 §4.1 |
| `access_code` | varchar(6) | NULL | - | | R1 §8.1 |
| `legacy_access_code` | varchar(6) | NULL | - | | R1 §8.1 |
| `hidden_at` | timestamptz | NULL | - | 보존 전환(숨김) | R1 §8.1 |
| `created_at` | timestamptz | NN | now() | | R1 §8.1 |
| `updated_at` | timestamptz | NN | now() | | R1 §8.1 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_classes_organization_id` | FK | `organization_id` → `organizations.id` |
| `fk_classes_created_by` | FK | `created_by` → `users.id` |
| `ck_classes_schedule_mode` | CHECK | `fixed`·`rolling` |
| `ck_classes_planned_count` | CHECK | `planned_session_count IS NULL OR >= 1` |
| `ck_classes_status` | CHECK | `draft`·`active`·`completed`·`cancelled`·`archived` |
| `ck_classes_capacity` | CHECK | `capacity >= 1` |
| `ix_classes_organization_id` | IDX | `(organization_id)` |
| `ix_classes_created_by` | IDX | `(created_by)` |
| `ix_classes_status` | IDX | `(status)` |
| `uq_classes_active_access_code` | UNIQUE IDX | `(access_code) WHERE access_code IS NOT NULL AND hidden_at IS NULL AND status NOT IN ('completed','cancelled','archived')` |

### `class_instructors`

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R1 §8.2 |
| `class_id` | uuid | NN | - | FK `classes` RESTRICT | R1 §8.2 |
| `user_id` | uuid | NN | - | FK `users` | R1 §8.2 |
| `role` | varchar(10) | NN | 'lead' | CHECK `lead`·`assistant`·`guest` | 강사 §2.1 |
| `status` | varchar(10) | NN | 'active' | CHECK `active`·`removed` (행 삭제 금지, soft) | 강사 §2.1 |
| `scope_session_id` | uuid | NULL | - | FK `sessions` SET NULL, guest 한정 | 강사 §2.1 |
| `added_by` | uuid | NULL | - | FK `users` | 강사 §2.1 |
| `added_at` | timestamptz | NN | now() | | 강사 §2.1 |
| `removed_at` | timestamptz | NULL | - | | 강사 §2.1 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_class_instructors_class_id` | FK | `class_id` → `classes.id` ON DELETE RESTRICT |
| `fk_class_instructors_user_id` | FK | `user_id` → `users.id` |
| `fk_class_instructors_scope_session_id` | FK | `scope_session_id` → `sessions.id` ON DELETE SET NULL |
| `fk_class_instructors_added_by` | FK | `added_by` → `users.id` |
| `uq_class_instructors_class_user` | UNIQUE | `(class_id, user_id)` — `sessions` 복합 FK 의 참조 대상 |
| `ck_class_instructors_role` | CHECK | `lead`·`assistant`·`guest` |
| `ck_class_instructors_status` | CHECK | `active`·`removed` |
| `ck_class_instructors_scope` | CHECK | `scope_session_id IS NULL OR role = 'guest'` |
| `ix_class_instructors_user_id` | IDX | `(user_id)` |

### `class_members`

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R4 §3.2 |
| `class_id` | uuid | NN | - | FK `classes` RESTRICT | R4 §3.2 |
| `user_id` | uuid | NULL | - | FK `users` (비회원은 NULL) | R4 §3.2 |
| `kind` | varchar(10) | NN | 'member' | CHECK `member`·`guest` | R4 §3.2 |
| `status` | varchar(20) | NN | - | CHECK `invited`·`waitlisted`·`active`·`completed`·`left`·`removed`·`declined` | R4 §9.1 |
| `joined_via` | varchar(20) | NN | - | CHECK `host_invite`·`code`·`email_invite`·`waitlist_promotion` | R4 §3.2 (`migration` 은 이전 폐기로 제외) |
| `guest_name` | varchar(100) | NULL | - | 비회원 개인정보 | R4 §3.2 |
| `gender` | varchar(20) | NULL | - | 비회원 개인정보 | R4 §3.2 |
| `birth_date` | date | NULL | - | 비회원 개인정보 | R4 §3.2 |
| `report_email` | varchar(320) | NULL | - | 비회원 개인정보 | R4 §3.2 |
| `pii_scrubbed_at` | timestamptz | NULL | - | | R4 §3.2 |
| `waitlist_position` | int | NULL | - | status=waitlisted 일 때 | R4 §3.2 |
| `joined_at` | timestamptz | NN | now() | | R4 §3.2 |
| `activated_at` | timestamptz | NULL | - | | R4 §3.2 |
| `left_at` | timestamptz | NULL | - | | R4 §3.2 |
| `removed_at` | timestamptz | NULL | - | 출석 `removed_at` 과 별개 | R4 §3.2 |
| `completed_at` | timestamptz | NULL | - | | R4 §3.2 |
| `first_session_id` | uuid | NULL | - | FK `sessions` SET NULL | R4 §3.2 |
| `report_included_default` | bool | NN | false | | R4 §3.2 |
| `notice_ack_at` | timestamptz | NULL | - | | R4 §3.2 |
| `notice_version` | varchar(20) | NULL | - | | R4 §3.2 |
| `entry_ver` | int | NN | 0 | 입장 자격 폐기 버전 | R4 §3.2 |
| `created_at` | timestamptz | NN | now() | | R1 §8 서두 |
| `updated_at` | timestamptz | NN | now() | | R1 §8 서두 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_class_members_class_id` | FK | `class_id` → `classes.id` ON DELETE RESTRICT |
| `fk_class_members_user_id` | FK | `user_id` → `users.id` |
| `fk_class_members_first_session_id` | FK | `first_session_id` → `sessions.id` ON DELETE SET NULL |
| `uq_class_members_class_user` | UNIQUE | `(class_id, user_id)` — NULL 은 서로 다름(비회원 다중 허용) |
| `ck_class_members_kind` | CHECK | `member`·`guest` |
| `ck_class_members_status` | CHECK | R4 §9.1 7값 |
| `ck_class_members_joined_via` | CHECK | 4값 |
| `ix_class_members_user_id` | IDX | `(user_id)` |
| `ix_class_members_class_status` | IDX | `(class_id, status)` |

### `class_member_events` (append-only, FK 없음)

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R4 §3.2 |
| `class_id` | uuid | NN | - | FK 없음(삭제 후에도 이력 보존) | R4 §3.2 |
| `member_id` | uuid | NN | - | FK 없음 | R4 §3.2 |
| `from_status` | varchar(20) | NULL | - | | R4 §3.2 |
| `to_status` | varchar(20) | NN | - | | R4 §3.2 |
| `actor_kind` | varchar(20) | NN | - | CHECK `self`·`host`·`system`·`platform_admin` | R4 §3.2 |
| `actor_user_id` | uuid | NULL | - | FK 없음 | R4 §3.2 |
| `reason` | text | NULL | - | | R4 §3.2 |
| `created_at` | timestamptz | NN | now() | | R4 §3.2 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `ck_class_member_events_actor_kind` | CHECK | 4값 |
| `ix_class_member_events_class_id` | IDX | `(class_id)` |
| `ix_class_member_events_member_id` | IDX | `(member_id)` |

## 2. 신규 테이블 — 054 (상담군)

### `counseling_guests`

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R1 §8.6 |
| `organization_id` | uuid | NULL | - | FK `organizations` | R1 §8.6 |
| `created_by_counselor_id` | uuid | NN | - | FK `users` (프라이버시 격리 단위) | R1 §8.6 |
| `display_name` | varchar(100) | NULL | - | 개인정보, 스크럽 후 NULL | R1 §8.6 |
| `email` | varchar(320) | NULL | - | 개인정보 | R1 §8.6 |
| `email_norm` | varchar(320) | NULL | - | 정규화 값 | R1 §8.6 |
| `email_verified_at` | timestamptz | NULL | - | | R1 §8.6 |
| `gender` | varchar(20) | NULL | - | 개인정보 | R1 §8.6 |
| `birth_date` | date | NULL | - | 개인정보 | R1 §8.6 |
| `reentry_secret_hash` | varchar(64) | NULL | - | SHA-256, 평문 저장 금지 | R1 §8.6 |
| `reentry_ver` | int | NN | 0 | | R1 §8.6 |
| `reentry_issued_at` | timestamptz | NULL | - | | R1 §8.6 |
| `reentry_last_used_at` | timestamptz | NULL | - | | R1 §8.6 |
| `privacy_consent_at` | timestamptz | NULL | - | | R1 §8.6 |
| `privacy_notice_version` | varchar(20) | NULL | - | | R1 §8.6 |
| `claimed_user_id` | uuid | NULL | - | FK `users` | R1 §8.6 |
| `claimed_at` | timestamptz | NULL | - | | R1 §8.6 |
| `claim_method` | varchar(20) | NULL | - | CHECK NULL 또는 `email_otp`·`counselor_confirmed`·`admin` | R1 §8.6 |
| `pii_scrubbed_at` | timestamptz | NULL | - | | R1 §8.6 |
| `created_at` | timestamptz | NN | now() | | R1 §8.6 |
| `updated_at` | timestamptz | NN | now() | | R1 §8.6 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_counseling_guests_organization_id` | FK | `organization_id` → `organizations.id` |
| `fk_counseling_guests_created_by_counselor_id` | FK | → `users.id` |
| `fk_counseling_guests_claimed_user_id` | FK | → `users.id` |
| `ck_counseling_guests_claim_method` | CHECK | NULL 또는 3값 |
| `ck_counseling_guests_claimed` | CHECK | `claimed_user_id IS NULL OR claimed_at IS NOT NULL` |
| `ck_counseling_guests_name` | CHECK | `pii_scrubbed_at IS NOT NULL OR display_name IS NOT NULL` |
| `uq_guest_email_per_counselor` | UNIQUE IDX | `(created_by_counselor_id, email_norm) WHERE email_norm IS NOT NULL AND claimed_user_id IS NULL AND pii_scrubbed_at IS NULL` |
| `ix_counseling_guests_created_by_counselor_id` | IDX | `(created_by_counselor_id)` |
| `ix_counseling_guests_email_norm` | IDX | `(email_norm)` |

### `counseling_relationships`

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R1 §8.4 |
| `organization_id` | uuid | NULL | - | FK `organizations` | R1 §8.4 |
| `organization_attribution_known` | bool | NN | false | | R1 §8.4 |
| `counselor_id` | uuid | NN | - | FK `users`, 현재 담당 상담사 | R1 §8.4 |
| `client_user_id` | uuid | NULL | - | FK `users`, 회원 내담자 | R1 §8.4 |
| `client_guest_id` | uuid | NULL | - | FK `counseling_guests` RESTRICT | R1 §8.4 |
| `is_placeholder` | bool | NN | false | 보관용 관계 | R1 §8.4 |
| `link_id` | uuid | NULL | - | FK `client_counselor_links` SET NULL (약결합) | R1 §8.4 |
| `title` | varchar(200) | NULL | - | | R1 §8.4 |
| `modality_default` | varchar(20) | NULL | - | CHECK NULL 또는 `clinical`·`hypnosis` | R1 §8.4 |
| `status` | varchar(10) | NN | 'active' | CHECK `pending`·`active`·`closed`·`archived` | 상담 §2.2 (R1 초안보다 우선) |
| `started_at` | timestamptz | NN | now() | | R1 §8.4 |
| `closed_at` | timestamptz | NULL | - | | R1 §8.4 |
| `closed_by` | uuid | NULL | - | FK `users` | R1 §8.4 |
| `close_reason` | varchar(40) | NULL | - | | R1 §8.4 · 상담 §2.2 |
| `archived_at` | timestamptz | NULL | - | | R1 §8.4 |
| `reopened_count` | int | NN | 0 | | R1 §8.4 |
| `predecessor_relationship_id` | uuid | NULL | - | FK `counseling_relationships` RESTRICT | 상담 §2.2 |
| `default_duration_min` | int | NULL | - | 관계 기본값 | R1 §8.4 |
| `location_type` | varchar(20) | NULL | - | 관계 기본값 | R1 §8.4 |
| `location_address` | varchar(300) | NULL | - | 관계 기본값 | R1 §8.4 |
| `linkband_mode` | varchar(20) | NULL | - | 관계 기본값 | R1 §8.4 |
| `record_audio` | bool | NULL | - | 관계 기본값 | R1 §8.4 |
| `record_video` | bool | NULL | - | 관계 기본값 | R1 §8.4 |
| `reminder_offsets` | jsonb | NULL | - | 관계 기본값 | R1 §8.4 |
| `access_code` | varchar(6) | NULL | - | 비회원 입장용(Phase 7) | 상담 §2.2 |
| `legacy_access_code` | varchar(6) | NULL | - | | 상담 §2.2 |
| `hidden_at` | timestamptz | NULL | - | 보존 전환(숨김) | R1 §8.4 |
| `created_at` | timestamptz | NN | now() | | R1 §8.4 |
| `updated_at` | timestamptz | NN | now() | | R1 §8.4 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_counseling_relationships_organization_id` | FK | → `organizations.id` |
| `fk_counseling_relationships_counselor_id` | FK | → `users.id` |
| `fk_counseling_relationships_client_user_id` | FK | → `users.id` |
| `fk_counseling_relationships_client_guest_id` | FK | → `counseling_guests.id` ON DELETE RESTRICT |
| `fk_counseling_relationships_link_id` | FK | → `client_counselor_links.id` ON DELETE SET NULL |
| `fk_counseling_relationships_closed_by` | FK | → `users.id` |
| `fk_counseling_relationships_predecessor` | FK | → `counseling_relationships.id` ON DELETE RESTRICT |
| `ck_rel_client` | CHECK | `(is_placeholder AND client_user_id IS NULL AND client_guest_id IS NULL) OR (NOT is_placeholder AND (client_user_id IS NOT NULL OR client_guest_id IS NOT NULL))` |
| `ck_rel_status` | CHECK | 4값 |
| `ck_rel_modality` | CHECK | NULL 또는 2값 |
| `uq_rel_active_pair` | UNIQUE IDX | `(counselor_id, client_user_id) WHERE client_user_id IS NOT NULL AND status <> 'archived'` |
| `uq_rel_guest` | UNIQUE IDX | `(client_guest_id) WHERE client_guest_id IS NOT NULL AND status IN ('pending','active')` — 종결·보관 관계는 제외해 같은 비회원 행에 새 상담사 관계를 만들 수 있다 |
| `uq_rel_placeholder` | UNIQUE IDX | `(counselor_id) WHERE is_placeholder` |
| `ix_counseling_relationships_counselor_status` | IDX | `(counselor_id, status)` |
| `ix_counseling_relationships_client_user_id` | IDX | `(client_user_id)` |
| `ix_counseling_relationships_organization_id` | IDX | `(organization_id)` |

### `counseling_relationship_counselors`

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R1 §8.5 |
| `relationship_id` | uuid | NN | - | FK `counseling_relationships` RESTRICT | R1 §8.5 |
| `counselor_id` | uuid | NN | - | FK `users` | R1 §8.5 |
| `status` | varchar(10) | NN | 'active' | CHECK `active`·`removed` | R1 §8.5 |
| `from_at` | timestamptz | NN | now() | | R1 §8.5 |
| `to_at` | timestamptz | NULL | - | | R1 §8.5 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_rel_counselors_relationship_id` | FK | → `counseling_relationships.id` ON DELETE RESTRICT |
| `fk_rel_counselors_counselor_id` | FK | → `users.id` |
| `uq_rel_counselors_rel_counselor` | UNIQUE | `(relationship_id, counselor_id)` — `sessions` 복합 FK 의 참조 대상 |
| `ck_rel_counselors_status` | CHECK | 2값 |
| `ix_rel_counselors_counselor_id` | IDX | `(counselor_id)` |

### `counseling_relationship_events` (append-only, FK 없음)

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R1 §8.7 |
| `relationship_id` | uuid | NN | - | FK 없음 | R1 §8.7 |
| `from_status` | varchar(10) | NULL | - | | R1 §8.7 |
| `to_status` | varchar(10) | NN | - | | R1 §8.7 |
| `actor_kind` | varchar(20) | NN | - | CHECK `counselor`·`client`·`system`·`platform_admin` | R1 §8.7 |
| `actor_user_id` | uuid | NULL | - | FK 없음 | R1 §8.7 |
| `reason` | text | NULL | - | | R1 §8.7 |
| `created_at` | timestamptz | NN | now() | | R1 §8.7 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `ck_rel_events_actor_kind` | CHECK | 4값 |
| `ix_rel_events_relationship_id` | IDX | `(relationship_id)` |

### `guest_claim_events` (append-only, FK 없음)

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | R1 §8.7 |
| `guest_client_id` | uuid | NN | - | FK 없음 | R1 §8.7 |
| `user_id` | uuid | NN | - | FK 없음 | R1 §8.7 |
| `method` | varchar(20) | NN | - | CHECK `email_otp`·`counselor_confirmed`·`admin` | R1 §8.7 |
| `rewritten_counts` | jsonb | NN | '{}' | 건수만(개인정보 없음) | R1 §8.7 |
| `created_at` | timestamptz | NN | now() | | R1 §8.7 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `ck_guest_claim_events_method` | CHECK | 3값 |
| `ix_guest_claim_events_guest_client_id` | IDX | `(guest_client_id)` |

## 3. 신규 테이블 — 055 (보조)

### `session_host_history` (append-only, FK 없음)

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `id` | uuid | NN | - | PK | 강사 §2.3 |
| `session_id` | uuid | NN | - | FK 없음(세션 원본 삭제 후에도 이력 보존) | 강사 §2.3 |
| `previous_host_id` | uuid | NN | - | FK 없음 | 강사 §2.3 |
| `new_host_id` | uuid | NN | - | FK 없음 | 강사 §2.3 |
| `reason` | text | NULL | - | | 강사 §2.3 |
| `changed_by` | uuid | NULL | - | FK 없음 | 강사 §2.3 |
| `created_at` | timestamptz | NN | now() | | 강사 §2.3 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `ix_session_host_history_session_id` | IDX | `(session_id)` |

## 4. 기존 테이블 가산 컬럼 — 055

> 기존 컬럼은 바꾸지 않는다(SC-4). 아래 컬럼만 `ADD COLUMN`.

### `sessions` (추가 컬럼 5개)

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `class_id` | uuid | NULL | - | FK `classes` RESTRICT | R1 §8.8 |
| `counseling_relationship_id` | uuid | NULL | - | FK `counseling_relationships` RESTRICT | R1 §8.8 |
| `seq` | int | NULL | - | 부모 안 회차 번호(1부터) | R1 §8.8 |
| `session_kind` | varchar(10) | NN | 'regular' | CHECK `regular`·`makeup` | B §4.3 |
| `host_state` | varchar(20) | NULL | - | CHECK NULL 또는 `assigned`·`pending_ack`·`needs_reassign` | 강사 §2.2 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_sessions_class_id` | FK | `class_id` → `classes.id` ON DELETE RESTRICT |
| `fk_sessions_counseling_relationship_id` | FK | → `counseling_relationships.id` ON DELETE RESTRICT |
| `fk_sessions_class_host` | FK(복합) | `(class_id, host_id)` → `class_instructors(class_id, user_id)` ON DELETE RESTRICT, MATCH SIMPLE |
| `fk_sessions_relationship_host` | FK(복합) | `(counseling_relationship_id, host_id)` → `counseling_relationship_counselors(relationship_id, counselor_id)` ON DELETE RESTRICT |
| `ck_sessions_one_parent` | CHECK | `is_template OR (num_nonnulls(class_id, counseling_relationship_id) = 1 AND seq IS NOT NULL AND host_state IS NOT NULL)` |
| `ck_sessions_session_kind` | CHECK | 2값 |
| `ck_sessions_host_state` | CHECK | NULL 또는 3값 |
| `uq_sessions_class_seq` | UNIQUE | `(class_id, seq)` |
| `uq_sessions_relationship_seq` | UNIQUE | `(counseling_relationship_id, seq)` |
| `ix_sessions_class_id` | IDX | `(class_id)` |
| `ix_sessions_counseling_relationship_id` | IDX | `(counseling_relationship_id)` |

### `session_participants` (추가 컬럼 7개)

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `member_id` | uuid | NULL | - | FK `class_members` RESTRICT | R4 §3.2 |
| `guest_client_id` | uuid | NULL | - | FK `counseling_guests` RESTRICT | R1 §8.9 |
| `attendance_status` | varchar(20) | NULL | - | CHECK NULL 또는 `expected`·`attended`·`absent`·`excused`·`withdrawn` | R4 §9.2 |
| `attendance_kind` | varchar(10) | NN | 'regular' | CHECK `regular`·`makeup`·`guest_pass` | R4 §3.2 |
| `makeup_for_session_id` | uuid | NULL | - | FK `sessions` SET NULL | R4 §3.2 |
| `attendance_marked_by` | varchar(20) | NULL | - | CHECK NULL 또는 `system`·`host`·`self` | R4 §3.2 |
| `absence_reason` | varchar(200) | NULL | - | 선택(개인정보 최소화) | R4 §3.2 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_session_participants_member_id` | FK | `member_id` → `class_members.id` ON DELETE RESTRICT |
| `fk_session_participants_guest_client_id` | FK | → `counseling_guests.id` ON DELETE RESTRICT |
| `fk_session_participants_makeup_for` | FK | `makeup_for_session_id` → `sessions.id` ON DELETE SET NULL |
| `uq_session_participants_session_member` | UNIQUE | `(session_id, member_id)` — `member_id` NULL 다수 허용 |
| `ck_session_participants_one_identity` | CHECK | `member_id IS NULL OR guest_client_id IS NULL` |
| `ck_session_participants_attendance_status` | CHECK | NULL 또는 5값 |
| `ck_session_participants_attendance_kind` | CHECK | 3값 |
| `ck_session_participants_marked_by` | CHECK | NULL 또는 3값 |
| `ix_session_participants_member_id` | IDX | `(member_id)` |
| `ix_session_participants_guest_client_id` | IDX | `(guest_client_id)` |

### `reports` (추가 컬럼 2개)

| 컬럼 | 타입 | NULL | 기본값 | 참조·제약 | 근거 |
|---|---|---|---|---|---|
| `approved_by_user_id` | uuid | NULL | - | FK `users` (NO ACTION) | B §4.3 · TD10 |
| `approved_at` | timestamptz | NULL | - | | B §4.3 · TD10 |

제약·인덱스

| 이름 | 종류 | 정의 |
|---|---|---|
| `fk_reports_approved_by_user_id` | FK | → `users.id` (삭제 규칙 NO ACTION) |

## 5. plan·원본 문서와 달라진 점 (확정 사유)

| # | 항목 | 원본 | 확정 | 사유 |
|---|---|---|---|---|
| 1 | `origin` 컬럼 | R1 §8.1·8.4·8.6, 상담 §4.2 에 존재 | 제거 | 이전·`shim` 폐기(TD20) |
| 2 | `class_members.joined_via` 값 | `migration` 포함 | 제외 | 이전 폐기 |
| 3 | `uq_rel_active_pair` 조건 | 상담 §2.2: `status <> 'archived'` / R1: `status = 'active'` | `status <> 'archived'` (R-DB 리뷰 반영, 기획 우선) | 종결 관계는 재개(같은 관계)로 이어 가므로 closed 와 새 관계 공존 금지 — 기획-상세-상담 §179. verify CN-7 정정 |
| 3b | `uq_rel_guest` 조건 | R1: 전체 유일 | `status IN ('pending','active')` 부분 유니크 | 종결·보관 관계가 남아도 같은 비회원 행으로 새 상담사 관계 생성 가능(상담 §198 "같은 counseling_guests 행을 새 관계가 참조") |
| 4 | 관계 `status` | R1: `active·closed·archived` | `pending·active·closed·archived` | 상담 §2.2 가 `pending` 을 정의(비회원 초대 대기) |
| 5 | `counselor_memo`·`retention_hold` | R1 §8.4 "판단 보류" | 제외 | 해당 Phase 에서 가산 |
| 6 | `sessions` 선택 참조 삭제 규칙 | (미정) | `SET NULL` | 세션 원본 삭제(플랫폼 관리자·보관 정책) 경로를 FK 가 막지 않도록 |
| 7 | `classes.recurrence_rule`·`assignment_rule` | B §4.3·강사 §4.1 | 포함(NULL 허용 jsonb) | 기획 문서 우선 규칙. Phase 1 은 쓰지 않음 |
| 8 | 상담 세션의 `host_state` | 강사: 상담은 배정 단계 없음 | 비템플릿 세션은 항상 NOT NULL(상담도 `assigned`) | plan TD4 · verify CN-2 의 CHECK 정의 |

## 6. `sessions` 선택 참조의 `ON DELETE SET NULL` 의미

| 참조 | 세션 삭제 시 | 후속 Phase 의무 |
|---|---|---|
| `class_instructors.scope_session_id` | NULL 이 되면 범위가 사라진 `guest`(대체) 강사가 `active` 로 남을 수 있다. Phase 1 에는 세션을 삭제하는 경로가 없어(삭제=숨김) 발생하지 않는다 | **Phase 3 의 세션 삭제 트랜잭션에서 해당 guest 강사를 `removed` 로 전환해야 한다**(필수). 스키마는 바꾸지 않는다 |
| `class_members.first_session_id` | NULL 이면 "합류 기준 회차를 알 수 없음"을 뜻한다(합류 전 판정 불가). 중간 합류 멤버의 합류 전 회차 판정은 이 값이 있을 때만 유효 | 세션 삭제 경로를 만드는 Phase 가 NULL 처리 후 판정을 앱에서 보완 |
| `session_participants.makeup_for_session_id` | NULL 이면 "대체 대상 회차가 삭제됨"을 뜻하며 `attendance_kind='makeup'` 행은 대상 없는 보강으로 남는다 | 보강 상태 파생 로직(Phase 4)이 NULL 을 "대상 없음"으로 처리 |

세 컬럼 모두 세션 원본 삭제(플랫폼 관리자·보관 정책) 경로를 FK 가 막지 않게 하려는 선택이다.
