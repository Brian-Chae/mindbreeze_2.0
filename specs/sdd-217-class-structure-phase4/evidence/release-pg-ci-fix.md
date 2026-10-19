# SDD-217 PR 20 PostgreSQL CI 스키마 테스트 수정

- 원인: head 057은 056 대비 테이블 9개를 추가해 총 86개이나 기존 head 테스트는 77개를 기대했다. 또한 214의 전역 ORM CHECK 금지 검사가 057에서 의도적으로 추가한 canonical guest 제약을 금지했다.
- 근거: `backend/alembic/versions/e036a0000057_sdd217_membership.py`의 CREATE TABLE 9개 및 class_members ALTER, `backend/app/models/class_program.py`의 canonical guest CHECK·복합 FK를 대조했다. 신규 테이블 9개는 `backend/app/models/class_membership.py`에도 모두 존재한다.
- 수정: `test_pg_migration_schema.py`의 개수 기대만 86으로 변경하고 DB/ORM 전체 테이블 집합 일치 검사는 유지했다.
- 수정: `test_sdd214_schema.py`는 sessions의 one-parent CHECK 및 복합 FK 부재 검사를 그대로 유지했다. sessions와 214 신규 테이블 전체 CHECK 목록은 canonical guest CHECK 하나만 정확한 테이블·이름·식으로 허용한다. 같은 범위의 복합 FK도 canonical guest 하나만 정확한 테이블·이름·컬럼 순서·참조 컬럼 순서·ON DELETE RESTRICT로 검증한다. 214 마이그레이션의 실제 DB 제약 검사는 유지했다.

## 검증

실행: `PG_SMOKE=1 DATABASE_URL=postgresql://sdd217@127.0.0.1:55437/sdd217_test /Volumes/Looxid\ SSD/looxid/repository/mindbreeze_2.0/backend/venv/bin/python -m pytest --confcutdir=tests/pg tests/pg/test_pg_migration_schema.py tests/pg/test_sdd214_schema.py -q`

- RED: 2 failed, 35 passed (8.43s). `/private/tmp/sdd217-pg-schema-red.log`.
- GREEN: 37 passed (7.69s). `/private/tmp/sdd217-pg-schema-green.log`.
- `git diff --check`: 통과.
- 변경은 지정된 두 테스트 파일뿐이며 제품 코드·커밋·푸시는 하지 않았다. 전체 PG/BE 회귀와 원격 CI 재실행은 상위 에이전트 범위다.
