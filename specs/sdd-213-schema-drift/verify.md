# SDD-213 verify — 구현 전 QA 체크리스트

| ID | 시나리오 | 기대 | 방법 |
|---|---|---|---|
| V-01 | 덤프 픽스처 복원 DB 에 `alembic upgrade head` | `e036a0000052` 적용, 오류 0 | pg 테스트 |
| V-02 | 빈 DB 체인 `upgrade head` | 오류 0, head=`e036a0000052` | pg 테스트 |
| V-03 | 두 DB 에서 D-01 `read_by`=jsonb | 두 DB 모두 `jsonb` | 카탈로그 질의 |
| V-04 | D-02/03/04/05 대상 컬럼 | 모두 NOT NULL | 카탈로그 질의 |
| V-05 | D-06 `qualifications.name/issuer` | 두 DB 모두 `varchar(200)` | 카탈로그 질의 |
| V-06 | D-07 FK | careers/qualifications `user_id` FK 둘 다 `confdeltype='c'` | pg_constraint |
| V-07 | D-08 인덱스 | `ix_careers_user_id`, `ix_qualifications_user_id` 존재 | pg_indexes |
| V-08 | D-09 `careers.is_current` 기본값 | `false` | information_schema |
| V-09 | 멱등: 리비전 재실행(downgrade -1 후 upgrade) | 오류 0, 적용 전후 스키마 동일 | pg 테스트 |
| V-10 | 백필: NULL 이 섞인 합성 행(롤백 트랜잭션/스크래치 DB)이 있는 덤프 DB | NULL 이 `0`/`'email'`/`''`/`now()`/`false` 로 채워지고 행 수 보존 | pg 테스트 |
| V-11 | 체인 DB 에서 `read_by` 변환 시 기존 배열 값 보존 | `{a,b}` → `["a","b"]` | pg 테스트 |
| V-12 | D-11 컬럼 5개 보존 | 덤프 DB 에 그대로 존재, 값 불변 | pg 테스트 |
| V-13 | `alembic heads` | 정확히 1개 | CLI·기존 테스트 |
| V-14 | 기존 pytest(SQLite) | 신규 실패 0 (기준선 대비) | `pytest -q` |
| V-15 | CI frontend·backend·backend-pg-smoke | green | PR 체크 |
| V-16 | Deploy Dev·e2e-smoke | 성공 | Actions |
| V-17 | 배포 후 dev 읽기 전용 조회 | D-02~D-09 해소, D-11 컬럼 존재 | 카탈로그 질의 |

스크래치 DB: 테스트는 로컬 호스트(127.0.0.1)에서만 `CREATE DATABASE`/`DROP DATABASE` 로 임시 DB 를 만들고 끝에 정리한다.
