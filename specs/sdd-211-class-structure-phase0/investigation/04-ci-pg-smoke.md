# 조사 04 — PostgreSQL 대상 `alembic upgrade head` CI 스모크 (Phase 0 항목 4)

> 범위: 읽기 전용 조사 + 일회용 로컬 PG(임시 디렉터리 initdb, 포트 55432, 조사 후 삭제)로만 측정. 저장소 코드·워크플로·실 DB·서버는 건드리지 않았다. `git status` 깨끗함 확인.
> 표기: `파일:줄` 근거, 확인 불가는 `미확인`. 측정값은 "로컬(Apple M4, Homebrew PG 16.13, 로컬 소켓)" 기준이며 CI 러너 값이 아니다.

## 0. 핵심 발견 (먼저 읽을 것)

| # | 발견 | 근거 |
|---|---|---|
| **F1** | **빈 DB 에서 `alembic upgrade head` 는 지금 실패한다.** 14번째 리비전 `30c1bfbc724f` 에서 `DuplicateTable: "chat_room_participants" 이미 존재`. 같은 테이블을 앞선 `c8f3a1b5d201` 이 이미 만들었다. | 측정(아래 §2), `alembic/versions/30c1bfbc724f_add_updated_at_to_qualifications_and_.py:24`, `alembic/versions/c8f3a1b5d201_013_chat_room_participants.py:22` |
| F2 | 원인: `30c1bfbc724f` 는 "auto generated" 주석이 달린 **드리프트 캐치업 리비전**이다 — 이미 다른 리비전이 만든 테이블·컬럼(`chat_room_participants`, `chat_rooms.room_type/host_id/name`, `session_participants.is_waitlisted`, `users.status/auth_provider/notification_preferences` 등)을 다시 만든다. 체인이 "create_all 로 만들어진 개발 DB" 위에서 생성·적용되었다는 뜻이다(추정, 사실 근거는 파일 내용뿐 — 당시 DB 이력은 `미확인`). | `30c1bfbc724f…py:21-55`, `git log`: 해당 파일 최초 커밋 `e427d54a` "chore: 미커밋 변경사항 전체 커밋"(2026-05-28) |
| F3 | 첫 리비전 `77cff497fbe0` 은 `op.create_table` 로 핵심 8개 테이블을 **빈 DB 에서** 만든다(`Revises: None`). 즉 체인의 출발점 자체는 빈 DB 가정이 맞고, **깨지는 곳은 14번째 한 군데**다. | `77cff497fbe0_initial_8_core_tables.py:16, 24-140` |
| F4 | `30c1bfbc724f` 만 `alembic stamp` 로 건너뛰면 나머지 83개는 전부 통과(실패 1건 / 84건). 단 건너뛴 결과 스키마에는 `careers.updated_at`·`qualifications.updated_at`·`careers.role` 길이·`careers.is_current NOT NULL` 이 빠진다(`alembic check` 로 확인, §6). | 측정 |
| F5 | **SDD-210 T-15 영향**: "빈 DB 에 `alembic upgrade head`(85개 체인 신규 적용…)" 리허설이 계획돼 있다. 지금 상태로는 T-15 가 첫 단계에서 실패한다. | `specs/sdd-210-prod-environment/plan.md:202, 301(R19)` |
| F6 | SDD-210 plan 의 "85개" 는 `ls` 항목 수(`__pycache__` 디렉터리 포함). 실제 리비전은 **84개**(.py 84). | `ls alembic/versions \| wc -l`=85 / `*.py`=84 / 파싱한 revision=84; `specs/sdd-210-prod-environment/plan.md:23` |
| F7 | 마이그레이션이 CI 에서 한 번도 안 돈다. 테스트는 SQLite `create_all` 이다. 마이그레이션이 PG 에서 처음 도는 곳은 dev 배포다(`deploy-dev.yml:201`). | `tests/conftest.py:195-203`, `ci-feature.yml:88-94` |

> F1 이 이 항목의 전제를 바꾼다: "빈 DB 스모크"를 만들려면 먼저 체인이 빈 DB 에서 통과하도록 `30c1bfbc724f` 를 손봐야 한다(§7 Task 후보, **사용자 결정 필요 아님 — 기술 결정**, 단 SDD-210 일정 영향은 Brian 인지 필요).

## 1. 현행 CI·배포 구조

### 1.1 워크플로 3종
- `ci-feature.yml` (94줄): 트리거 `push`(develop·feature/**·fix/**·sdd/**) + `pull_request`(**develop 대상만**) — `:8-17`. `main` 대상 PR 은 트리거 안 됨(SDD-210 릴리스 흐름에서 주의, `미확인`: main 보호 규칙).
  - `frontend` 잡 `:20-63`, `backend` 잡 `:65-94`: apt(Cairo/Pango/폰트) → `pip install -r requirements.txt` → `pytest -q --tb=short --ignore=tests/test_sprint4_integration.py --deselect=…test_real_pdf_metric_pages`. **PG 서비스 없음·alembic 단계 없음.** `setup-python` 에 `cache: pip` 없음(`:70-73`).
- `deploy-dev.yml` (310줄): develop push → `frontend` 빌드 잡 → `deploy` 잡(SCP+SSH) → `e2e-smoke` 재사용 잡(`:307-310`). **`ci-feature` 의 backend 테스트를 `needs` 하지 않는다**(독립 워크플로) → CI 가 빨개도 dev 배포는 막히지 않는다. 막으려면 브랜치 보호의 필수 상태 점검(저장소 설정, `미확인`) 또는 워크플로 의존이 필요.
  - 마이그레이션은 서버에서 `venv/bin/alembic upgrade head` (`:199-201`, DATABASE_URL 은 `.env.dev` 에서 추출).
  - **롤백 트랩**(`:118-144`): 백업 대상은 `dist`·`backend/app`·`backend/alembic` 세 디렉터리뿐(`:122-124`), 복원도 동일(`:135-137`) 후 서비스 재시작. **DB 되돌림 없음.** `DEPLOY_OK=1` 은 헬스체크(`:293`) 통과 뒤에 확정(`:296`).
  - 해석: PG 는 DDL 이 트랜잭션이라 `alembic upgrade head` 도중 실패하면 전체 롤백(측정: F1 실패 후 `alembic_version` 테이블조차 없음). 문제는 **upgrade 성공 → 이후 헬스체크 실패** 경우로, 이때는 코드만 옛 버전이고 스키마는 새 버전이다. 그래서 기획 X1·롤링 "추가형 스키마만" 원칙이 필요하다.
- `e2e-smoke.yml`: 배포 후 dev 서버 대상 Playwright 스모크(`:25-58`). 마이그레이션과 무관.

### 1.2 alembic 구성
- `backend/alembic.ini:89` `sqlalchemy.url = driver://user:pass@localhost/dbname` — 자리표시자. 실제 URL 은 `env.py:12` 가 `config.set_main_option("sqlalchemy.url", settings.database_url)` 로 덮어쓴다.
- `env.py:7-9` `from app.core.database import Base` / `from app.models import *` / `from app.config import settings`. `:17` `target_metadata = Base.metadata`. 온라인 모드는 `NullPool` 엔진(`:28-32`), 오프라인(`--sql`) 지원(`:20-24`).
- **필수 환경변수는 `DATABASE_URL` 하나뿐.** `Settings` 의 모든 필드가 기본값을 갖는다(`app/config.py:34-120`, 필수 필드 없음 — 정규식 grep 결과 무). JWT 비밀키 부재 시 중단은 `main.py` lifespan 에서만 일어나 alembic 은 영향 없음(`config.py:39` 주석). `REDIS_URL` 도 alembic 에는 불필요(기본값 `config.py:37`, 연결 안 함). 내가 측정할 때는 `backend/.env` 가 존재해 `DATABASE_URL` 을 **환경변수로 명시**해 덮었다(환경변수 우선: `config.py:12-15`).
- 주의(소): `set_main_option` 은 configparser 보간을 쓰므로 비밀번호에 `%` 가 있으면 깨진다 → CI 비밀번호는 영숫자.
- URL 스킴 `postgresql://` → psycopg2(`requirements.txt:14` `psycopg2-binary==2.9.12`). `asyncpg==0.31.0`(`:15`)은 alembic 이 쓰지 않는다. alembic 1.18.4(`:13`), SQLAlchemy 2.0.49(`:12`).
- `env.py` import 경로가 로드하는 서드파티 모듈(측정): `sqlalchemy, psycopg2, pydantic, pydantic_core, pydantic_settings, dotenv, annotated_types, typing_extensions, typing_inspection` (+ alembic). → 스모크 잡은 전체 `requirements.txt`(weasyprint·pyarrow·livekit·celery…) 없이 **최소 6개 패키지만 설치**해도 되는지 시도해 볼 가치가 있다(`미확인` — 실제 clean-venv 설치는 하지 않음, 방법: 새 venv 에 `sqlalchemy alembic psycopg2-binary pydantic pydantic-settings python-dotenv` 만 설치 후 `alembic heads`). 단 버전 고정은 requirements.txt 와 같아야 한다.

## 2. 리비전 체인 (측정)

| 항목 | 값 | 방법 |
|---|---|---|
| 리비전 수 | **84** | 파일에서 `revision =` 정규식 파싱 + `ScriptDirectory.walk_revisions()` 84 |
| head | **1개** `e036a0000051` | 파싱한 down_revision 집합에 없는 리비전 = 1개; `alembic heads` → `e036a0000051 (head)` |
| root | 1개 `77cff497fbe0` (`down_revision = None`) | `77cff497fbe0…py:16` |
| 머지 리비전 | 2개 `001fd31549c5`(0f5a7c2b9e14 + e512db25533a), `0e240d60b539`(e036a0000017 + e036a0000018) | 파싱 |
| 이미 있는 단일 head 가드 | ≥5개 테스트 | `tests/test_sdd209_b4_class_code.py:288`, `test_sdd209_b13_research_export.py:503-510`, `test_mb2_high_severity_fixes_4.py:192-202`, `test_mb2_low_fixes_6th.py:311-318`, `test_mb2_medium_fixes_6th.py:514-522` |
| 이미 있는 오프라인 렌더 테스트 | 1개(`e036a0000006:e036a0000007 --sql`) | `tests/test_data_exports.py:200-209` |

**빈 DB 실행 결과** (일회용 PG 16.13, `DATABASE_URL=postgresql://postgres@127.0.0.1:55432/smoke_empty`):
- `alembic upgrade head` → 14번째 `Running upgrade d74027f66e1c -> 30c1bfbc724f` 에서 `psycopg2.errors.DuplicateTable: "chat_room_participants"` 로 종료(rc=1, 0.46초). 전체가 하나의 트랜잭션이라 `alembic_version` 도 생기지 않음(조회 시 "relation 없음").
- 리비전을 한 개씩 `upgrade <rev>` 하다 실패하면 `stamp <rev>` 로 넘어가는 방식(일회용 DB `smoke_step`)으로 전수: **실패 1 / 84 (`30c1bfbc724f`)**, 이후 83개 통과, 최종 `e036a0000051 (head)`, 테이블 62개 + `alembic_version` = 63. 모델 메타데이터 테이블 수는 62(`Base.metadata.tables`) → SDD-210 plan 의 "테이블 63개"(`specs/sdd-210-prod-environment/plan.md:90`)와 정합(alembic_version 포함).
- `30c1bfbc724f` 의 진짜 필요분(빈 체인에서 다른 리비전이 안 채우는 변경)은 `careers.updated_at` 추가, `qualifications.updated_at` 추가, `careers.role` 200→100, `careers.is_current NOT NULL` 4건(+ `ix_chat_messages_room_created` 삭제, 이 인덱스 존재 여부는 `미확인`). 나머지는 앞선 리비전과 중복(§0 F2). 이 분석은 `alembic check` 결과(§6) 기반이며 실 dev DB 상태와의 대조는 `미확인`.

**"빈 DB 업그레이드가 가능한가"의 정확한 답**: 출발점은 빈 DB 가정이 맞지만(F3), 현재 체인은 `30c1bfbc724f` 때문에 **불가능**하다. 가능하게 하려면 해당 리비전의 `upgrade()` 를 (a) 중복분 제거 + 필요 4건만 남기거나 (b) 존재 검사(`sa.inspect`)로 멱등화해야 한다. 이미 적용된 dev DB 는 이 리비전을 다시 실행하지 않으므로(alembic_version 이 이미 head) 내용을 고쳐도 dev/prod(스냅샷 복원)에는 영향이 없다 — 단 이 사실은 코드 논리상의 추론이고 dev 서버 `alembic current` 는 이번 조사에서 조회하지 않았다(`미확인`, SDD-210 plan 은 dev 가 `e036a0000051` 이라 기록 `plan.md:23`).

## 3. PG 전용 DDL 인벤토리 (SQLite 테스트가 못 보는 것)

| 종류 | 위치 | 비고 |
|---|---|---|
| 부분 유니크/부분 인덱스 `postgresql_where` | `e036a0000001`(35), `e036a0000002`(31), `e036a0000011`(42·47), `e036a0000029`(27·35), `e036a0000034`(34), `e036a0000044`(54) + raw SQL `e036a0000026`(`CREATE UNIQUE INDEX … WHERE play_group_id IS NULL`) | 모델은 `postgresql_where` + `sqlite_where` 를 **둘 다 손으로 번역**(`app/models/session.py:22-31`, 7개 모델 파일 각 1~2곳) — 번역 불일치 위험(예: PG `is_template = false` vs SQLite `= 0`) |
| CHECK 제약 | `e036a0000007`(37), `e036a0000008`(33·37) | `sa.CheckConstraint` |
| JSONB | 18개 리비전 | conftest 가 SQLite 에서 TEXT 로 컴파일(`tests/conftest.py:41-43`) |
| ARRAY | `093ca5586573`, `e512db25533a`(`chat_messages.read_by`) | 모델은 JSONB(§6 드리프트 항목) |
| PG 시퀀스/기본값 | `server_default=now()` 다수, `gen_random_uuid()`(`881a08fbe584…py:66`, PG13+ 내장) | 확장(extension) 불필요 — `CREATE EXTENSION` grep 0건 |
| raw `op.execute` | 7개 파일: `881a08fbe584`(5), `b3d9e1f04277`(1), `c1d2e3f40288`(1), `e036a0000024`(2), `e036a0000026`(3), `e036a0000028`(1), `e036a0000030`(1) | 대부분 `UPDATE/DELETE` 데이터 이전 |
| ENUM 타입 | 없음 (`sa.Enum`·`CREATE TYPE` 0건) | 문자열 컬럼 + 앱 검증 |
| TimescaleDB | **미사용** | `b3d9e1f04277…py:13`, `c1d2e3f40288…py:13` "TimescaleDB 미사용". `.claude/rules/architecture.md` 의 TimescaleDB 언급은 현실과 다름 |
| 복합 FK | **현재 0건** | 마이그레이션·모델 grep. 기획이 도입할 예정(`기획.md:191, 474`) |
| FK 일반 | 모델 `ForeignKey(` 81곳 | **SQLite 테스트에서는 FK 강제 안 됨**(`PRAGMA foreign_keys` 설정 0건: `tests/conftest.py`, `app/core/database.py`) |
| 데이터 의존 사전검사 | `e036a0000044`(활성 코드 중복 시 `RuntimeError`, `:36-49`), `e036a0000030`(정규화 충돌 시 중단, `:39-55`), `e036a0000026`(중복 DELETE 후 인덱스) | **빈 DB 에선 항상 통과** → 빈 DB 스모크만으로는 이 가드를 검증하지 못한다(§5 가 필요한 이유) |

## 4. 테스트 DB 현황
- 테스트는 인메모리 SQLite(`create_engine("sqlite://", StaticPool)` + `Base.metadata.create_all`) — `tests/conftest.py:195-203`. PG 대상 테스트·skip 없음: `postgresql://` 문자열은 conftest 의 SQLite 타입 컴파일 훅에만 등장(`:41-43, 79, 94`). `skipif` 는 PDF 테스트 1곳(`tests/test_sdd070_report_pdf.py:26`)뿐.
- 160개 테스트 파일(`ls tests`), `/sessions` 를 치는 파일 77개.
- → 마이그레이션 SQL 자체(op.* 시퀀스)와 PG 제약은 CI 어디에서도 실행되지 않는다. X16(`기획.md:614`)의 전제 확인.

## 5. "스냅샷 복원 DB" 가 CI 에서 현실적으로 뜻하는 것 — 옵션 비교

배경: (i) 실제 배포 경로는 "이미 head 근처인 드리프트 있는 DB 에 델타 적용"이다(dev), (ii) prod 는 dev 스냅샷 복원(`specs/sdd-210-prod-environment/spec.md:50`), (iii) 위 F1 때문에 체인-빌드 DB 와 실제 DB 스키마가 같다는 보장이 없다.

| 옵션 | 내용 | 개인정보 | 크기 | 유지보수 | 검증력 | 비고 |
|---|---|---|---|---|---|---|
| **A. 스키마 전용 덤프 픽스처 + 합성 시드** | 실 dev DB 에서 `pg_dump --schema-only --no-owner --no-privileges` 로 뽑은 DDL(+`alembic_version` 한 행)을 `backend/tests/fixtures/pg/baseline_<rev>.sql` 로 커밋. CI 는 빈 DB 에 psql 로 복원 → **손으로 쓴 합성 시드 SQL**(가짜 행, 데이터 사전검사를 건드리는 케이스) 삽입 → `alembic upgrade head` | **없음**(DDL 만; 실데이터 0행). CI 에 `COPY `/`INSERT INTO`(alembic_version 제외) grep 가드 | 수백 KB 예상(63 테이블, `미확인` — 덤프를 만들지 않았음) | 낮음: 특정 리비전에 고정, 새 마이그레이션은 위에 델타로 얹힘. 델타가 너무 길어지면 재기준(rebaseline) | **실제 드리프트 상태를 재현**(F1 과 무관하게 동작), 데이터 가드(044·030·026) 검증 가능 | 덤프 생성에는 dev DB 읽기 접근 필요(구현 단계, Brian/SSM 경유 — 이번 조사에선 하지 않음) |
| B. 이전 릴리스 alembic 디렉터리 → upgrade | CI 에서 직전 태그의 `backend/alembic` 을 체크아웃해 빈 DB 에 head 까지 적용한 뒤 현재 디렉터리로 upgrade | 없음 | 없음(픽스처 0) | 중: 태그·`fetch-depth` 관리, **F1 수정 선행**(옛 체인도 같은 이유로 실패) | "신규 델타만" 검증. 드리프트 재현 못함 | F1 수정 후엔 A 의 보완재로 좋음 |
| C. 정제(sanitized) 실데이터 덤프 | dev 덤프를 마스킹해 커밋/아티팩트로 보관 | **위험**: dev 스냅샷 비암호화·개인정보 포함(`기획.md:611` X13), 마스킹 누락 시 git 영구 유출, 상담 내용·생체정보(`.claude/rules/data-privacy.md`) | 54MB(`plan.md:90`) | 높음(마스킹 스크립트 유지) | 가장 현실적이나 위험 대비 이득 작음 | **기각** |

**권고: A(스키마 전용 덤프 + 합성 시드) 를 "스냅샷 복원본"의 정의로 채택하고, 빈 DB 스모크(F1 수정 후)를 병행. B 는 추후(선택).**
이유: ① 개인정보 0행 — git 에 개인정보를 넣지 않는 요건 충족. ② 실제 운영 경로(드리프트 있는 DB + 델타)와 같다. ③ 합성 시드로 빈 DB 가 못 보는 데이터 의존 가드(044 중복, 030 정규화 충돌, 026 dedup, 029 부분 유니크)를 실행. ④ 유지보수 비용이 고정 파일 1~2개. 단점: 덤프 최초 생성에 dev DB 읽기(메타데이터만)가 필요하다 — 구현 단계 수동 절차로 plan 에 기재.
  - **픽스처 리비전 정책(plan 이 확정)**: (a) 현재 head `e036a0000051` 로 고정하면 지금은 `upgrade head` 가 무동작이지만 Phase 1 의 M1 마이그레이션부터 매 PR 이 "head 이후 델타"를 검증하므로 의미가 생긴다. (b) 더 과거 리비전(예: SDD-209 직전 `e036a0000041`)으로 고정하면 기존 10개 델타도 검증하나, 그 리비전 시점의 실 dev 스키마 덤프를 구할 수 없다(PITR 복원 필요, `미확인`) — 현실적으로 (a) 권고. 픽스처는 마이그레이션 PR 마다 갱신하지 않고 고정한다(델타가 누적될수록 검증 범위 증가), 델타가 과도하면 재기준.
- 합성 시드는 사람이 쓴 SQL 이므로 개인정보 없음(이메일은 `@example.com`, 이름 `테스트`).

## 6. `alembic heads` / `alembic check` / 다운그레이드 정책

- **단일 head 검사**: `alembic heads` 0.16초(측정). 이미 pytest 가드가 5곳 있으나(§2) 파일마다 흩어져 있고 어떤 테스트가 우연히 deselect 되어도 모름 → 스모크 잡에 `[ "$(alembic heads | wc -l)" = 1 ]` 한 줄 추가(중복이지만 PG 잡 안에서 명시적 실패 원인 노출). 비용 무시 가능.
- **`alembic check`(autogenerate 드리프트 검출)**: 파일을 생성하지 않는 검출 전용 명령이므로 `.claude/rules/architecture.md:24` "마이그레이션 자동 생성 금지, 수동 리뷰 필수" 와 충돌하지 않는다(생성이 아니라 비교). 그러나 **지금 돌리면 실패**한다. 측정: `smoke_step` DB(F4 우회로 만든 head) 에서 `alembic check` rc=255, "New upgrade operations detected". 감지 항목 16건 중 4건(`careers.updated_at`, `careers.role` 타입, `careers.is_current`, `qualifications.updated_at`)은 내가 `30c1bfbc724f` 를 건너뛴 부작용이고 **약 12건은 우회와 무관한 모델↔마이그레이션 드리프트**(예: `chat_messages.read_by` ARRAY(VARCHAR) vs 모델 JSONB, `uq_eeg_record_session_participant` 유니크 제약 누락, `org_documents`/`pipeline_outbox` 인덱스 2~3건, 여러 `created_at` NOT NULL 차이 — 감지 로그 `/tmp` 전용, 파일 보관 안 함). 이 중 실제 dev DB 에도 존재하는 드리프트인지는 `미확인`.
  - 권고: Phase 0 에서는 **정보성(비차단) 단계**로 `alembic check` 결과 건수를 로그에 남기고(`continue-on-error: true`), 기준 건수를 초과해 늘어나면 실패시키는 "래칫" 은 후속(드리프트 정리 후 차단 승격). 이유: 지금 차단하면 모든 PR 이 빨개진다.
- **다운그레이드 정책**: 리비전 84개 모두 `downgrade()` 정의가 있으나(`def downgrade` 84건 grep) 최근 리비전 docstring 은 "다운그레이드는 drop 이므로 데이터 손실 — 운영 롤백에는 사용하지 않는다"(`e036a0000042…py:8-9`, `…043:8-9`, `…045:6-7`, `…046:5-6`, `…047:9`, `…049:9`, `…050:5`, `…051:4`)로 못박고, `…044` 는 "롤백은 코드 revert 로만"(`:12`)이라 명시. 기획 롤백 총칙도 동일(`기획.md:622`). → 스모크는 **upgrade 만 검증**하고 downgrade 왕복은 하지 않는다(정책 일관). 다운그레이드는 가용성 보장 대상이 아님을 spec 에 명시.

## 7. GitHub Actions 설계 제안

### 7.1 잡 구조: 새 잡 `backend-pg-smoke` (권고)
- 별도 잡 이유: ① `backend` 잡은 weasyprint apt·전체 pip·160개 테스트라 길다. 스모크는 최소 의존으로 병렬 실행하면 총 소요(wall-clock)가 늘지 않는다. ② 실패 원인 분리(마이그레이션 vs 단위테스트). ③ PG 서비스 컨테이너를 테스트 잡에 붙이면 `backend` 잡 시작이 느려진다.
- 단점: checkout·setup-python 중복(수 초), pip 중복 설치(최소 패키지로 상쇄).

```yaml
backend-pg-smoke:
  runs-on: ubuntu-latest
  timeout-minutes: 10
  services:
    postgres:
      image: postgres:16            # 운영 RDS 는 PostgreSQL 16 (SDD-210 spec.md:28, dev 16.14 plan.md:48)
      env: { POSTGRES_PASSWORD: ci_pw, POSTGRES_DB: smoke }
      ports: ['5432:5432']
      options: >-
        --health-cmd="pg_isready -U postgres" --health-interval=5s
        --health-timeout=5s --health-retries=10
  env:
    DATABASE_URL: postgresql://postgres:ci_pw@127.0.0.1:5432/smoke
  steps:
    - actions/checkout@v4
    - actions/setup-python@v5 (3.11, cache: pip)
    - pip install (alembic·sqlalchemy·psycopg2-binary·pydantic·pydantic-settings·python-dotenv — requirements.txt 와 동일 버전)
    - alembic heads → 정확히 1개
    - [빈 DB]  alembic upgrade head → alembic current == heads
    - [스냅샷]  createdb smoke_snap → psql -v ON_ERROR_STOP=1 -f tests/fixtures/pg/baseline_<rev>.sql
                → psql -f tests/fixtures/pg/seed_synthetic.sql → alembic upgrade head → current == heads
    - [정보성]  alembic check (continue-on-error)
    - 픽스처 위생: grep -E '^(COPY|INSERT INTO)' (alembic_version 제외) 가 0건
```
- 세부(`미확인` 표시 항목): 러너의 `psql` 클라이언트 존재 여부 `미확인`(없으면 `apt-get install postgresql-client`, 수 초); 서비스 컨테이너 이미지 pull 시간 `미확인`.
- 환경변수: `DATABASE_URL` **하나만**(§1.2). 시크릿 불필요(CI 일회용 DB). JWT·Redis·AWS 불요.
- PG 버전: `postgres:16`. 운영 RDS 마이너는 dev 16.14(`plan.md:48`), 러너 이미지 마이너와 다를 수 있으나 마이그레이션 SQL 은 마이너 의존이 없다(측정은 16.13에서 통과).
- 확장 불필요(`CREATE EXTENSION` 0건, `gen_random_uuid` PG13+ 내장) → 순정 `postgres:16` 이미지로 충분(TimescaleDB 이미지 불필요).

### 7.2 실패 의미(blocking)
- 이 잡의 실패 = 마이그레이션이 PG 에서 안 돈다 = dev 배포(`deploy-dev.yml:201`) 에서도 안 돈다 → **차단(blocking)** 이어야 한다. 그러나 `deploy-dev` 가 `ci-feature` 를 `needs` 하지 않으므로(§1.1) 실질 차단은 브랜치 보호 필수 점검 등록이 필요(저장소 설정 `미확인`, 구현 단계에서 Brian 이 설정). 정보성 단계(`alembic check`)만 `continue-on-error`.
- 트리거: 기존 `ci-feature.yml` 에 잡 추가(같은 트리거) 또는 `paths:` 필터(`backend/alembic/**`, `backend/app/models/**`, 픽스처, 워크플로) 로 불필요한 실행 축소. 단 `paths` 필터를 쓰면 필수 점검 등록 시 "스킵된 점검=통과" 처리 필요 → **필터 없이 항상 실행 권고**(비용 작음).

### 7.3 CI 시간 영향
- **측정(로컬, PG 16.13, 빈 DB, M4)**: 마이그레이션 적용 총 ≈ 1.2초(`upgrade → d74027f66e1c` 0.69초 + `stamp 후 upgrade head`(70개) 0.46초, 프로세스 기동 포함), `alembic heads` 0.16초, `upgrade head --sql` 0.35초.
- **CI 러너 값은 `미확인`.** 측정 방법: 구현 PR 에서 잡을 한 번 돌린 뒤 `gh run view <id> --json jobs` 의 step 별 `startedAt/completedAt`. 사전 추정(근거 약함): 서비스 컨테이너 기동·헬스 대기 10~30초, 최소 pip 설치 수십 초, 마이그레이션 두 번 합계 수 초 → 잡 총 1~2분 추정. `backend` 잡과 병렬이므로 wall-clock 증가는 거의 없고 러너 분(minute) 소모만 1~2분 늘 것으로 예상(`미확인`).
- 기존 `backend` 잡 소요 시간 자체는 이번에 `gh` 로 조회하지 않아 `미확인`.

### 7.4 PG 대상 제약 테스트(복합 FK 등)의 범위 — Phase 0 vs 후속
- **Phase 0 에 포함할 것(하네스까지)**: PG 서비스 컨테이너 + pytest 마커 `@pytest.mark.pg`(또는 `tests/pg/` 디렉터리) + `DATABASE_URL` 이 PG 일 때만 도는 픽스처 + **현존 제약 1~2개를 검증하는 샘플 테스트**(예: `uq_sessions_active_access_code` 부분 유니크가 PG 에서 활성 코드 중복을 막고 종료 후 재사용을 허용; 모델의 `postgresql_where`/`sqlite_where` 번역 일치 확인). 이것이 X16 완화책("PG 대상 제약 테스트 CI 단계 추가", `기획.md:614`)의 인프라이며, 이후 Phase 가 제약만 추가하면 된다.
- **후속 Phase**: 복합 FK 위반 불가 테스트·진행자 정확히 1명(PG) 등은 해당 테이블이 생기는 Phase 의 완료 기준(`기획.md:474, 632`). 지금은 복합 FK 가 0건이라 테스트할 대상이 없다.
- 기존 SQLite 단위 테스트 스위트를 PG 로 통째 전환하는 것은 **비범위**(conftest 의 SQLite 호환 훅 다수, 160개 파일 — 별도 대형 작업).

## 8. Task 후보 (plan 이 확정)

| 후보 | 내용 | 규모 | 비고 |
|---|---|---|---|
| T-a | `30c1bfbc724f` 멱등화/축소(필요 4건만 또는 inspector 가드). 빈 DB `upgrade head` 통과 + 기존 DB 무영향 확인 | S | **DB 스키마 변경 아님**(이미 적용된 DB 는 재실행 안 함). 회귀 방지로 SQL 오프라인 렌더·빈 DB 실행 모두 확인. 이 수정 후 SDD-210 T-15 가 의미를 가짐 |
| T-b | `backend-pg-smoke` 잡 + 최소 의존 설치 + head 단일/빈 DB/스냅샷 3단계 | S | §7.1 |
| T-c | 스키마 전용 덤프 픽스처 + 합성 시드 SQL + 위생 grep | M | 덤프 생성 절차(dev 읽기)는 구현 단계 수동 절차로 문서화 |
| T-d | `pg` 마커 하네스 + 샘플 제약 테스트 2개 | S | §7.4 |
| T-e | `alembic check` 정보성 단계 + 드리프트 12건 목록을 후속 정리 backlog 로 | S | 차단 승격은 후속 |

## 9. 확인하지 못한 것 (`미확인` 요약)
1. 실 dev DB 의 `alembic current` 및 스키마 상태(접근하지 않음; SDD-210 plan 기록 `e036a0000051` 만 인용).
2. `30c1bfbc724f` 가 dev 에 실제로 어떻게 적용됐는지(이력).
3. CI 러너 기준 소요 시간·기존 `backend` 잡 소요 시간·러너 `psql` 존재.
4. 최소 패키지 설치로 `alembic` 이 도는지(import 모듈 측정만 함).
5. 스키마 전용 덤프의 실제 크기·내용(만들지 않음).
6. 브랜치 보호 규칙(필수 점검 등록 여부).
7. 약 12건 드리프트가 실 dev DB 에도 존재하는지.

> 측정에 쓴 일회용 PG 클러스터는 `/tmp` 임시 디렉터리에 만들고 조사 직후 정지·삭제했다(`/tmp/pgsmoke*` 0건 확인). 저장소 변경 없음.
