# SDD-211 — dev 스키마 ↔ 마이그레이션 체인 드리프트 정리 계획 (읽기 전용 조사)

> 범위: 이미 커밋된 덤프 픽스처(`backend/tests/fixtures/pg/baseline_e036a0000051.sql`)와 `alembic upgrade head` 결과만 비교. dev DB·AWS 접근 없음. 마이그레이션 코드는 작성하지 않았고 계획과 SQL 초안만 담았다.
> 근거 문서: `m0-report.md` §7, `investigation/04-ci-pg-smoke.md`, `be2-report.md` §7.

## 0. 결론 (먼저 읽을 것)

| 질문 | 답 |
|---|---|
| 드리프트 건수 | **A군(덤프↔체인) 13항목 / 30개 객체**, **B군(덤프=체인, 둘 다 모델과 다름) 11항목**. 합계 24항목 |
| Phase 1 의 `users` 변경 전 선행 필요? | **하드 블로커는 아님. 단 D-01·D-02·D-03 3건은 Phase 1 M1 리비전 이전에 정리 리비전 1개로 먼저 머지하길 권고(소형, 멱등).** `users` 에 걸린 드리프트는 D-03(`auth_provider` NULL 허용) 한 건뿐이다 |
| 정리 방식 | 리비전 1개(`head` 뒤), 전 단계 멱등 가드, 데이터 보존(삭제 없음), downgrade 는 no-op |
| 가장 큰 위험 | D-01: 체인으로 만든 DB 는 `chat_messages.read_by` 가 `varchar(36)[]` 라 앱(JSONB 로 기록)과 어긋난다. 현재 dev·prod(dev 스냅샷 복원)는 JSONB 라 영향 없고, **체인으로 새로 만드는 DB(CI PG 스모크·재해복구)에서만** 터진다 |
| Brian 결정 필요 | §6 참조 (4건) |

`m0-report.md` §7 의 일부 서술은 이번 전수 비교와 다르다. 정정한다: (1) `chat_rooms.host_id` FK 는 **덤프에도 있다**(이름만 `fk_chat_rooms_host_id` ↔ 체인 `chat_rooms_host_id_fkey`), (2) "약 6개 객체 계열" → 실제 13항목/30객체, (3) 덤프 `careers.id`·`qualifications.id` 기본값, 추가 컬럼 5개는 사실이나 `careers.is_current`·`organization`·`created_at`·`updated_at` NULL 허용 등이 빠져 있었다.

## 1. 방법과 재현

- 로컬 PG 16.13(Homebrew, 임시 클러스터 포트 55433, 작업 후 삭제)에 DB 2개:
  - `d_dump`: 픽스처 복원(`\restrict` 줄 제거 후 `psql -v ON_ERROR_STOP=1`, 오류 0).
  - `d_chain`: 빈 DB + `alembic upgrade head` → `e036a0000051 (head)`. 빈 DB 체인 적용은 현재 develop 에서 통과한다(`30c1bfbc724f` 가 멱등화됨, `5bf7eac6`).
- 비교 두 가지: ① `pg_attribute`·`pg_constraint`·`pg_indexes` 카탈로그 전수 diff(컬럼 타입·NULL·기본값, 제약 정의, 인덱스 정의), ② `alembic.autogenerate.compare_metadata`(`compare_type`·`compare_server_default`)로 각 DB 를 SQLAlchemy 모델(`Base.metadata`)과 대조.
- 주의: 덤프는 PG 16.14, 로컬은 16.13 이다. 두 서버 간 minor 차이로 CHECK·부분 인덱스의 표현(deparse)이 달라 보이는 항목이 있다(D-13, 같은 원본 SQL 에서 나왔음을 마이그레이션 파일로 확인).
- 정리 SQL 초안은 두 DB 의 복제본(`_t`)에 2회씩 적용해 **오류 없음·멱등·적용 후 diff 에서 D-01~D-08 소멸**을 확인했다(D-09 는 자명한 `SET DEFAULT`라 미실행).
- 두 DB 의 데이터는 비어 있다. **NULL 행·중복 행 존재 여부는 이 조사로 알 수 없다**(§5 사전 질의).

## 2. A군 — 덤프(dev) ↔ 체인 차이 (13항목)

모델 열은 현행 `backend/app/models` 기준. "정답"은 모델·체인 마이그레이션·앱 코드·dev 가 가리키는 방향의 종합 판정.

| ID | 객체 | 덤프(dev) | 체인(빈 DB) | 모델 | 정답 | 위험 | 권고 조치 |
|---|---|---|---|---|---|---|---|
| D-01 | `chat_messages.read_by` | `jsonb` | `varchar(36)[]` (`e512db25533a`) | `JSONB` (`models/chat.py:49`) | **JSONB** (모델·dev·`chat_service.py:175-197` 가 리스트로 사용) | **중** — 체인 DB 에서 앱이 JSON 을 쓰면 타입 불일치. dev·prod 는 영향 없음 | 체인/미래 DB 를 JSONB 로 변환(`USING to_jsonb`) |
| D-02 | `chat_messages.recipient_count` | NULL 허용, 기본 0 | NOT NULL | NOT NULL | NOT NULL | 하 — dev 에 NULL 행이 있으면 모델 가정 위반 | 백필 0 후 NOT NULL |
| D-03 | **`users.auth_provider`** | NULL 허용, 기본 `'email'` | NOT NULL (`0ef759a9d5bc`) | NOT NULL | NOT NULL | **중(Phase 1 관련)** — `users` 를 건드리는 M1 의 백필·NOT NULL 가정이 dev 에서 깨질 수 있음 | 백필 `'email'` 후 NOT NULL |
| D-04 | `careers.organization/created_at/updated_at/is_current` | 4컬럼 모두 NULL 허용 | NOT NULL | NOT NULL (`is_current` 는 `server_default=false`) | NOT NULL | 하 — `organization` NULL 행이 있으면 자동 백필 불가 | `organization` NULL 존재 시 중단(사람 판단), 나머지는 백필 후 NOT NULL |
| D-05 | `qualifications.created_at/updated_at` | NULL 허용 | NOT NULL | NOT NULL | NOT NULL | 하 | 백필 후 NOT NULL |
| D-06 | `qualifications.name/issuer` | `varchar(100)` | `varchar(200)` | `String(200)` | 200 | 하 — 확장이라 손실 없음. 현재 dev 는 101~200자 입력 시 오류 가능 | `varchar(200)` 으로 확장 |
| D-07 | `careers/qualifications.user_id` FK | `ON DELETE CASCADE` | 없음 | `ForeignKey("users.id")`(ondelete 없음), relationship `cascade="all, delete-orphan"` | **CASCADE** (dev 실상태, 개인정보 삭제 시 방어) | 하 — 관리자 삭제는 자식 선삭제 후 삭제(`admin_service.py:835-854`)라 어느 쪽이든 동작 | 체인에 CASCADE 적용 + 모델에 `ondelete="CASCADE"` 추가 |
| D-08 | `ix_careers_user_id`, `ix_qualifications_user_id` | **없음** | 있음 (`d74027f66e1c`) | `index=True` | 있음 | 하 — 성능만 | 인덱스 생성(IF NOT EXISTS) |
| D-09 | `careers.is_current` 기본값 | `false` | 없음 | `server_default="false"` | `false` | 하 | 체인 쪽에 `SET DEFAULT false` |
| D-10 | `careers.id`, `qualifications.id` 기본값 | `gen_random_uuid()` | 없음 | 앱에서 `uuid4()` 생성 | 허용 차이 | 무 — dev 쪽이 더 방어적 | 조치 없음, 허용 목록에 기록 |
| D-11 | dev 에만 있는 컬럼 5개: `careers.description`, `qualifications.credential_number/credential_url/expires_at/is_verified` | 있음(전부 NULL 허용) | 없음 | 없음 | **미정** — 앱·프론트 `grep` 0건(미사용), 마이그레이션 이력에도 없음 | 하(기능) / 중(데이터: 값이 들어 있는지 모름) | **삭제하지 않음.** 처리 방향은 Brian 결정(§6) |
| D-12 | `chat_rooms.host_id` FK 이름 | `fk_chat_rooms_host_id` (`b7e2c4d0a1f2`) | `chat_rooms_host_id_fkey` (`30c1bfbc724f`) | 이름 미지정 | 허용 차이 | 무 | 조치 없음 |
| D-13 | CHECK 3개(`ck_data_export_status`, `ck_signup_application_type/status`)·부분 인덱스 `uq_sessions_active_access_code` 의 표현 | 표현만 다름 | 표현만 다름 | 동일 SQL 원문 | 의미 동일 | 무 — 서버 minor(16.14 vs 16.13) deparse 차이로 **추정** | 조치 없음. diff 도구는 이 4개를 허용 목록으로 둔다 |

테이블 단위로는 양쪽이 동일하다(덤프 62 + `alembic_version` = 63, 체인도 동일).

## 3. B군 — 덤프와 체인이 같지만 모델과 다른 곳 (11항목, `be2-report.md` §7 의 12건 중 D-01 제외)

`alembic check` 의 `compare_server_default` 는 꺼둔 상태 기준이다. 켜면 모델에 `server_default` 가 없고 DB 에만 있는 곳이 46건 더 나온다(`pipeline_outbox.status`, `eeg_raw_chunks.*` 등). 이는 기능상 문제가 아니라 모델 표기 누락이므로 backlog 로만 기록한다.

| ID | 객체 | DB(덤프=체인) | 모델 | 정답 | 위험 | 권고 조치 |
|---|---|---|---|---|---|---|
| E-01 | `agent_conversations.created_at` | NULL 허용 | NOT NULL | NOT NULL | 하 | 백필 후 NOT NULL (별도 backlog) |
| E-02 | `eeg_feature_windows.created_at` | NULL 허용 | NOT NULL | NOT NULL | 하 | 동상 |
| E-03 | `eeg_raw_chunks.created_at` | NULL 허용 | NOT NULL | NOT NULL | 하(대용량 테이블이면 스캔 비용 — 행 수 `미확인`) | 동상, 락 시간 확인 후 |
| E-04 | `user_org_memberships.created_at` | NULL 허용 | NOT NULL | NOT NULL | 하 | 동상 |
| E-05 | `user_org_memberships.updated_at` | NULL 허용 | NOT NULL | NOT NULL | 하 | 동상 |
| E-06 | `agent_memory_items.client_id` 인덱스 | 없음 | `index=True` | 인덱스 있음 | 하 | 인덱스 생성 |
| E-07 | `uq_eeg_record_session_participant` 유니크 | 없음 | 있음 | 있음(의도된 불변식) | **중** — dev 에 중복 행이 있으면 생성 실패. 중복 존재 `미확인` | 사전 질의로 중복 확인 후 정리·생성 |
| E-08 | `ix_chat_messages_room_id_created_at`(room_id, created_at DESC) | 있음 | 선언 없음 | DB(마이그레이션 `e036a0000014` 가 의도적으로 생성) | 하 | **모델에 `Index` 선언 추가**(DB 는 건드리지 않음) |
| E-09 | `ix_org_documents_org_id` | 있음 | 선언 없음 | DB | 하 | 모델에 선언 추가 |
| E-10 | `ix_org_documents_status` | 있음 | 선언 없음 | DB | 하 | 모델에 선언 추가 |
| E-11 | `ix_pipeline_outbox_status_available` | 있음 | 선언 없음 | DB | 하 | 모델에 선언 추가 |

E-01~E-07 은 DB 변경이라 데이터 사전 확인이 필요하다. E-08~E-11 은 모델 코드 변경만 필요하다.

## 4. 정리 마이그레이션 계획

### 4.1 구조

- 리비전 1개 (예: `e036a0000052_sdd211_drift_cleanup`, `down_revision = 'e036a0000051'`). **Phase 1 M1 리비전은 반드시 이 리비전의 뒤**에 쌓는다.
- 범위: **D-01~D-09 (A군 DB 변경)**. E-01~E-07 은 사전 질의 결과를 보고 같은 리비전에 넣을지 별도 리비전으로 뺄지 결정(§6). 모델 변경(D-07 `ondelete`, E-08~E-11 `Index`)은 같은 PR 이 아니라 코드 PR 로 분리.
- 멱등 전제: dev 는 이미 일부가 맞는 상태라 모든 문장이 현재 상태를 검사하거나 no-op 이어야 한다. `ALTER ... SET NOT NULL`·`CREATE INDEX IF NOT EXISTS`·타입이 이미 같으면 no-op 인 `ALTER TYPE`·`information_schema` 확인 `DO` 블록을 사용한다. 로컬에서 같은 SQL 을 두 번 적용해 오류 없음을 확인했다.
- 데이터 보존: 삭제·컬럼 제거 없음. NULL 은 백필(`recipient_count=0`, `auth_provider='email'`, 타임스탬프는 `created_at`/`now()`, `is_current=false`). 백필 불가한 `careers.organization` NULL 은 예외로 중단해 사람이 판단한다.
- `downgrade()`: no-op. 백필·타입 변환은 되돌릴 수 없고, 되돌려도 의미가 없다. 리비전 문서에 "롤백은 코드 revert, 스키마 유지" 명시(`e036a0000044` 와 같은 방식).
- 락: 대상은 소형 테이블 위주(`users`·`chat_messages` 가 유일한 큰 후보). `SET LOCAL lock_timeout = '5s'` 로 장시간 대기 방지. `chat_messages` 의 `read_by` 타입 변환과 `recipient_count` NOT NULL 은 테이블 재작성/전체 스캔이 생길 수 있어 행 수 확인 후(§5) 야간 배포 권고.
- dev 에서의 실행: 배포가 `alembic upgrade head` 를 돌리므로(`deploy-dev.yml:199-201`) dev 는 `...51 → ...52` 한 스텝으로 적용된다. prod 는 dev 스냅샷 복원이므로(SDD-210) 컷오버 전에 정리 리비전이 dev 에 먼저 들어가 있으면 prod 에도 그대로 반영된다. 컷오버 이후에 넣으면 prod 에 별도 적용이 필요하다. 일정은 SDD-210 쪽과 맞춰야 한다.
- 이후 방지: 정리 후 `alembic check` 에서 허용 목록(D-10~D-13·D-11 결정 결과)을 제외하고 0건이 되게 하고, PG 스모크(`tests/pg`)에 "덤프 복원 DB 에 `upgrade head` 후 체인 DB 와 스키마 diff 가 허용 목록뿐" 검증을 추가한다. 이것은 별도 후속 작업.

### 4.2 SQL 초안 (로컬 PG16 복제본에 2회 적용 검증됨, D-09 제외)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

-- D-01 chat_messages.read_by : ARRAY → JSONB
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_name='chat_messages' AND column_name='read_by') = 'ARRAY' THEN
    ALTER TABLE chat_messages ALTER COLUMN read_by TYPE jsonb USING to_jsonb(read_by);
  END IF; END $$;

-- D-02 chat_messages.recipient_count
UPDATE chat_messages SET recipient_count = 0 WHERE recipient_count IS NULL;
ALTER TABLE chat_messages ALTER COLUMN recipient_count SET NOT NULL;

-- D-03 users.auth_provider
UPDATE users SET auth_provider = 'email' WHERE auth_provider IS NULL;
ALTER TABLE users ALTER COLUMN auth_provider SET NOT NULL;

-- D-04 careers (organization NULL 은 자동 보정하지 않고 중단)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM careers WHERE organization IS NULL) THEN
    RAISE EXCEPTION 'careers.organization NULL 행 존재 — 수동 판단 필요';
  END IF; END $$;
UPDATE careers SET created_at = now() WHERE created_at IS NULL;
UPDATE careers SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;
UPDATE careers SET is_current = false WHERE is_current IS NULL;
ALTER TABLE careers
  ALTER COLUMN organization SET NOT NULL, ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL,   ALTER COLUMN is_current SET NOT NULL;

-- D-05 qualifications
UPDATE qualifications SET created_at = now() WHERE created_at IS NULL;
UPDATE qualifications SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;
ALTER TABLE qualifications
  ALTER COLUMN created_at SET NOT NULL, ALTER COLUMN updated_at SET NOT NULL;

-- D-06 길이 확장
ALTER TABLE qualifications
  ALTER COLUMN name TYPE varchar(200), ALTER COLUMN issuer TYPE varchar(200);

-- D-08 인덱스
CREATE INDEX IF NOT EXISTS ix_careers_user_id ON careers (user_id);
CREATE INDEX IF NOT EXISTS ix_qualifications_user_id ON qualifications (user_id);

-- D-07 FK ON DELETE CASCADE (이미 CASCADE 면 건너뜀)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['careers','qualifications'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = t||'_user_id_fkey' AND confdeltype = 'c') THEN
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t||'_user_id_fkey');
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (user_id) '
                     'REFERENCES users(id) ON DELETE CASCADE', t, t||'_user_id_fkey');
    END IF;
  END LOOP; END $$;

-- D-09 (미실행 검증)
ALTER TABLE careers ALTER COLUMN is_current SET DEFAULT false;
COMMIT;
```

E-06·E-07 초안(필요 시): `CREATE INDEX IF NOT EXISTS ix_agent_memory_items_client_id ON agent_memory_items (client_id);` / 중복이 0건일 때만 `ALTER TABLE eeg_records ADD CONSTRAINT uq_eeg_record_session_participant UNIQUE (session_id, participant_id);`(제약 존재 검사 가드 포함). 중복이 있으면 어느 행을 남길지 데이터 판단이 필요해 자동화하지 않는다.

## 5. dev 에서 Brian 이 읽기 전용으로 확인할 사전 질의 (이번 조사는 dev 접근 금지라 미실행)

```sql
SELECT count(*) FROM users WHERE auth_provider IS NULL;                          -- D-03
SELECT count(*) FROM chat_messages WHERE recipient_count IS NULL;                -- D-02
SELECT count(*) FROM careers WHERE organization IS NULL;                         -- D-04 (0 이어야 자동)
SELECT count(*) FROM careers WHERE description IS NOT NULL;                      -- D-11
SELECT count(*) FROM qualifications WHERE credential_number IS NOT NULL
   OR credential_url IS NOT NULL OR expires_at IS NOT NULL OR is_verified IS TRUE; -- D-11
SELECT count(*) FROM qualifications WHERE length(name) > 100 OR length(issuer) > 100; -- D-06 (0 이어야 정상)
SELECT session_id, participant_id, count(*) FROM eeg_records
  GROUP BY 1,2 HAVING count(*) > 1;                                              -- E-07
SELECT relname, n_live_tup FROM pg_stat_user_tables
  WHERE relname IN ('users','chat_messages','eeg_raw_chunks','eeg_feature_windows'); -- 락·스캔 비용
```

모두 집계만 반환하며 개인정보를 내지 않는다.

## 6. Phase 1 `users` 변경 선행 여부 판정과 Brian 결정 항목

판정:
- `users` 와 직접 얽힌 드리프트는 **D-03 한 건**이다. Phase 1 이 `users` 에 컬럼을 추가하는 정도라면 D-03 과 독립이라 **차단 사유가 되지 않는다.**
- 그럼에도 정리 리비전을 **M1 보다 먼저** 머지하길 권고하는 이유: (a) Alembic 은 선형 체인이라 정리 리비전을 나중에 넣으면 M1 뒤에 끼게 되어 M1 검증 베이스라인(덤프)과 어긋난다. (b) M1 이 `users` 에 NOT NULL 컬럼 추가·백필을 한다면 D-03 처럼 "dev 는 NULL 허용" 가정이 틀어질 위험이 같은 방식으로 반복된다. (c) D-01 은 Phase 1 과 무관하지만 체인 DB 신뢰성을 위해 같은 리비전에 넣는 비용이 거의 없다.
- 그와 별개로, **Phase 1 의 모든 델타 검증은 덤프 복원 DB 와 체인 DB 양쪽에서** 해야 한다(어느 쪽이 실제 배포 경로인지 단정할 수 없으므로).

Brian 결정 항목:

1. **D-11 (dev 전용 컬럼 5개)**: ① 보존하고 허용 목록에 기록(권고 — 가장 안전, 값 존재 여부 §5 확인 후), ② 모델·체인에 반영해 정식 필드화, ③ 값이 없음을 확인한 뒤 제거. 어느 쪽인지.
2. **정리 범위**: 같은 리비전에 D-01~D-09 만 넣고 E-01~E-07 은 후속으로(권고) / E-01~E-07 도 함께. E-07(유니크)은 중복 데이터 판단이 필요하다.
3. **배포 시점**: D-01·D-02 는 `chat_messages` 재작성/스캔 가능성이 있어 야간 배포로 할지, 그리고 SDD-210 컷오버 전(dev 반영 → prod 스냅샷에 포함)과 후(prod 별도 적용) 중 어느 쪽인지.
4. **`careers.organization` NULL 행이 있을 때**: 빈 문자열/`'(미상)'` 로 채울지, 해당 행을 삭제할지(권고: 채우기, 삭제 금지).

## 7. 다음 작업 (승인 후)

1. §5 질의 결과 수령 → 범위 확정.
2. `[Fix]` 카드 SDD 4종 문서(plan·verify 먼저) → 정리 리비전 구현 → 덤프 복원 DB·체인 DB 양쪽 적용 테스트 → 모델 정리(D-07 `ondelete`, E-08~E-11 `Index`) → `alembic check` 허용 목록 테스트.
3. 이후 Phase 1 M1 리비전.
