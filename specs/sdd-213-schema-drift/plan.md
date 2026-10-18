# SDD-213 [Fix] — dev 스키마 ↔ 체인 드리프트 정리 리비전 (plan: 원인 분석 + 구현 계획)

> 근거: PR #9 `specs/sdd-211-class-structure-phase0/drift-report.md` (이하 DR) §2·§4.2·§5.
> 번호: `.sdd-counter` 211 → 213 (212 는 PR #8 `sdd/212-report-queue` 가 점유).

## 1. 확정된 결정 (Brian)

1. dev 전용 컬럼 5개(DR D-11: `careers.description`, `qualifications.credential_number/credential_url/expires_at/is_verified`)는 **보존**. 모델·마이그레이션에서 건드리지 않는다.
2. 범위는 **DB 변경 9항목(DR D-01~D-09)**. B군 모델 쪽 변경(E-08~E-11 `Index` 선언)과 DR D-07 의 모델 `ondelete` 추가, E-01~E-07 은 제외.
3. 정식 릴리즈 전이므로 **dev 에 바로 배포**(Deploy Prod·main 머지 금지).
4. `careers.organization` NULL 행은 값을 채운다(아래 §3 근거).

## 2. 원인 분석

dev DB 는 과거 `create_all`/수동 DDL 로 만들어져 **체인이 만드는 DB 와 스키마가 다르다**(DR §0). 대부분은 dev 가 모델 방향으로 이미 수렴해 있고(JSONB·CASCADE·NOT NULL 등), 반대로 체인으로 새로 만든 DB(CI·재해복구)는 일부가 어긋난다. 어느 쪽에서 시작하든 리비전 하나를 적용한 뒤 같은 모양이 되게 하는 것이 목적이다.

핵심 위험은 D-01(체인 DB 에서 `chat_messages.read_by` 가 `varchar(36)[]` 라 앱이 JSON 리스트를 쓰면 실패)과 D-03(Phase 1 M1 의 `users` 변경이 "auth_provider NOT NULL" 을 가정).

## 3. 사전 조회 결과 (dev DB, 읽기 전용 — `default_transaction_read_only=on`, 집계만)

| 질의 | 결과 |
|---|---|
| `users.auth_provider` NULL | 0 (users 18행) |
| `chat_messages.recipient_count` NULL | 0 (104행) |
| `careers.organization` NULL / 빈 문자열 | 0 / 0 |
| `careers` created_at·updated_at·is_current NULL | 0 / 0 / 0 |
| `qualifications` created_at·updated_at NULL | 0 / 0 |
| `qualifications` name·issuer 길이 > 100 | 0 |
| `careers` 전체 / `qualifications` 전체 행 | **0 / 0** |
| D-11 dev 전용 컬럼에 값이 있는 행 | 0 |
| `eeg_raw_chunks` / `eeg_feature_windows` | 1,550 / 46,131 (이번 리비전 대상 아님) |
| `alembic_version` | `e036a0000051` |

현재 dev 상태: `chat_messages.read_by` 는 이미 `jsonb`, `careers/qualifications.user_id` FK 는 이미 `ON DELETE CASCADE`(`confdeltype='c'`), `ix_*_user_id` 인덱스 없음, 문제 컬럼들은 NULL 허용.
→ dev 에서 이 리비전은 **NOT NULL 승격·`varchar(200)` 확장·인덱스 2개 생성·`is_current` 기본값만 실제 변경**이고 나머지는 멱등 no-op. 대상 테이블이 모두 소형/빈 테이블이라 락 부담이 없다.

**`organization` 채움 값 결정: 빈 문자열 `''`.** 근거: (a) dev 의 NULL·빈 행이 0건이라 가드는 실제로 작동하지 않는다(안전망). (b) 컬럼 의미는 "경력 소속기관명"이고 API 스키마(`schemas/auth.py:214`)는 `organization: str` 로 빈 문자열을 막지 않는다. (c) `'미입력'` 은 가짜 데이터를 사용자 화면에 노출하고 이후 "입력 여부" 판정을 오염시킨다. 따라서 `''` 가 의미 중립적이다. 행 삭제는 하지 않는다.

## 4. 구현 계획

리비전 **`e036a0000052`** (`down_revision = 'e036a0000051'`, 현재 head 위, 단일 head 유지), 파일 `backend/alembic/versions/e036a0000052_sdd_213_schema_drift_cleanup.py`.
Phase 1 M1 리비전은 이 뒤에 쌓는다.

| 항목 | 동작 (모두 멱등 가드) |
|---|---|
| D-01 | `chat_messages.read_by` 가 `ARRAY` 일 때만 `TYPE jsonb USING to_jsonb(read_by)` |
| D-02 | `recipient_count` NULL→0 백필 후 `SET NOT NULL` |
| D-03 | `users.auth_provider` NULL→`'email'` 백필 후 `SET NOT NULL` |
| D-04 | `careers`: `organization` NULL→`''`, `created_at` NULL→`now()`, `updated_at` NULL→`COALESCE(created_at, now())`, `is_current` NULL→`false`, 이후 4컬럼 `SET NOT NULL`, `is_current` 기본값 `false` (D-09 포함) |
| D-05 | `qualifications` `created_at/updated_at` 백필 후 `SET NOT NULL` |
| D-06 | `qualifications.name/issuer` 길이가 200 미만일 때만 `varchar(200)` 확장 |
| D-07 | `careers/qualifications` 의 `user_id → users.id` FK 가 `CASCADE` 가 아닐 때만 같은 이름으로 drop/add (제약 이름은 컬럼 기준 조회로 찾아 체인/덤프 이름 차이에 의존하지 않음) |
| D-08 | `CREATE INDEX IF NOT EXISTS ix_careers_user_id / ix_qualifications_user_id` |
| D-09 | `careers.is_current SET DEFAULT false` |

원칙: 삭제·컬럼 제거 없음, 데이터 보존, 트랜잭션 DDL, `SET LOCAL lock_timeout='5s'`, `downgrade()` 는 no-op(롤백은 코드 revert·스키마 유지; `e036a0000044` 와 같은 방식). D-10·D-12·D-13 은 허용 차이라 조치 없음. D-11 은 보존.

## 5. 변경 파일

- `backend/alembic/versions/e036a0000052_sdd_213_schema_drift_cleanup.py` (신규)
- `backend/tests/pg/test_sdd213_schema_drift.py` (신규, `pg` 마커)
- 기존 `backend/tests/pg/test_pg_migration_schema.py` 는 변경 없음(`head` 단일성 테스트가 그대로 통과해야 함)
- `specs/sdd-213-schema-drift/{plan,verify,summary}.md`, `specs/.sdd-counter`

## 6. 배포·확인

머지 → Deploy Dev 가 `alembic upgrade head` 로 `...51 → ...52` 적용(`deploy-dev.yml`) → 배포 후 dev DB 읽기 전용 조회로 D-02~D-09 해소 확인(동일 카탈로그 질의).
