# SDD-214 기준선 (Task G0, W-DB 범위)

> 2026-10-18 · 측정 기준: `origin/develop` @ `41c85f86` (구현 전) · 환경: Python 3.11 venv(`requirements.txt` 설치), 로컬 PostgreSQL 16, SQLite 단위 테스트
> 범위: 백엔드와 PG 만 측정했다. 프론트(vitest·tsc·eslint)는 W-DB 가 프론트 파일을 건드리지 않아 측정하지 않았다(`미확인` — 조정자가 필요하면 별도 측정).

| 항목 | 기준선 |
|---|---|
| alembic head | `e036a0000052` 단일, 리비전 85개 |
| 백엔드 pytest (CI 와 같은 제외: `--ignore=tests/test_sprint4_integration.py --deselect=…test_real_pdf_metric_pages`) | **2918 passed, 30 skipped, 1 deselected, 실패 0** (265초) |
| PG 테스트 (`PG_SMOKE=1 pytest --confcutdir=tests/pg tests/pg -m pg`, 빈 DB 에 `upgrade head` 후) | **19 passed, 실패 0** |
| 덤프 픽스처 | `tests/fixtures/pg/baseline_e036a0000051.sql` 1개(스키마 전용 — 위생 검사 기준 데이터 행 없음). 복원 후 `upgrade head` 가 비템플릿 세션 0 이라 가드를 통과함을 S5 가 확인 |

## head·리비전 개수를 하드코딩한 테스트 (verify §4 허용 목록 근거)

| 파일 | 하드코딩 | 이번 변경 |
|---|---|---|
| `backend/tests/test_sdd210_ci_gates.py:99` | head `e036a0000052` | `e036a0000055` |
| `backend/tests/test_sdd211_migration_30c1_idempotent.py:23,43` | `HEAD`, 리비전 수 85 | `e036a0000055`, 88 |
| `backend/tests/pg/test_sdd213_schema_drift.py` | `upgrade head` 후 `alembic_version == 052` | 이 리비전 테스트는 `upgrade e036a0000052` 까지만 적용하도록 변경(head 가 더 앞서기 때문) |
| `backend/tests/pg/test_pg_migration_schema.py` | 테이블 수 62 | 72 (신규 테이블 10) |

## 부모 없이 `sessions` 를 만드는 기존 PG 테스트 (CHECK 영향)

| 파일 | 영향 | 정정 |
|---|---|---|
| `tests/pg/test_pg_constraints.py` (`_new_class` 헬퍼) | ORM 으로 비템플릿 세션 INSERT | 헬퍼가 클래스·강사 행을 먼저 만들고 `class_id`·`seq`·`host_state` 를 채움(템플릿은 그대로) |
| `tests/pg/test_m0_prequery_pg.py` + `m0_prequery_seed.sql` | 이전 전 모양의 부모 없는 세션 12건을 SQL 로 시드 | 시드는 SDD-214 이전 데이터 모양을 흉내 내는 용도라 **테스트 트랜잭션 안에서만** `ck_sessions_one_parent` 를 해제(끝에 롤백) |

기타 SQLite 기반 테스트는 CHECK 를 ORM 에 선언하지 않으므로 영향 없음(전체 실행으로 확인).

## 미확인 해소 (plan §14)

| # | 결과 |
|---|---|
| 9 | 컬럼 길이·값 집합 → `schema-contract.md` 로 확정 |
| 11(일부) | 덤프 픽스처는 스키마 전용(데이터 없음). 재시드 수단은 조정자(Z1) 몫 |
| 12 | `check_migrations.py` 는 `ADD CONSTRAINT`·`CHECK`·`ADD COLUMN` 을 파괴적으로 분류하지 않음 — 053~055 모두 `destructive=false`, `warnings=[]` (정적 파싱 테스트 + 스크립트 실행으로 확인). 단, SQL 문자열에 `ON UPDATE`·`DELETE FROM` 같은 표현이 들어가면 오탐하므로 마이그레이션 SQL 에서 피했다 |
