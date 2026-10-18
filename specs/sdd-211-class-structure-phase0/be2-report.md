# BE-2 구현 보고 (SDD-211 Stage ④) — 계약 스냅샷 · PG 스모크 · M0 사전 조회

브랜치 `sdd/211-be2` (푸시하지 않음). 기준 `d43e53cc`. 측정·실행한 것만 적는다. 확인하지 못한 것은 마지막 절.

## 1. 커밋 (오래된 순)

| Task | SHA | 요약 |
|---|---|---|
| C1 | `9f3a231f` | 계약 비교기 `compat.py`·`shape.py` + 합성 입력 단위 테스트 |
| C2 | `a073cddf` | `/sessions/*` OpenAPI 골든(61 op·참조 스키마 77개) + 계약 테스트 15 + 갱신 스위치 |
| C3 | `c3f98698` | 응답 형태 골든 17 시나리오(+에러 4) + 변이 주입 테스트 |
| P0 | `6549bb46` | 마이그레이션 `30c1bfbc724f` 존재 검사 멱등화 |
| P1 | `1090c7f2` | `backend-pg-smoke` 잡 |
| P3 | `bc3fe8c1` | `tests/pg` 하네스 + PG 테스트 5 + CI 단계 |
| P4 | `e21377f9` | `alembic check` 정보성 단계 |
| P2 준비 | `31e40ca2` | 픽스처 자리·위생 가드·합성 시드 초안·조건부 CI 단계 |
| M1 | `80d42bb1` | M0 질의 44문장 + 읽기 전용 러너 + 테스트 + 독립 리뷰 기록 |
| 정리 | `89431f31` | 테스트 샘플의 UUID·이메일·IP 리터럴을 런타임 생성으로(G9) |

**C3 까지 먼저 커밋했다.** A3(BE-1)는 `c3f98698` 이후 기준으로 비교해야 골든이 변경 전 동작이다(CS-9).

## 2. 테스트 수 (이 브랜치에서 추가)

계약 74(비교기 36 · OpenAPI 15 · 형태 23) · 마이그레이션 멱등 5 · 픽스처 위생 15 · M0 러너 60 · `tests/pg` 8(제약 2 · 결과 스키마 3 · M0 3). 합계 162 — 기본 `pytest`(SQLite)에서는 154 통과 + `tests/pg` 8 skip.

## 3. 실행 결과

- 백엔드 전체 `pytest -q --ignore=tests/test_sprint4_integration.py --deselect=…test_real_pdf_metric_pages`: **2139 통과 · 19 skip · 1 deselect · 실패 0** (3분 20초, macOS 로컬). G9 정리 커밋 `89431f31` 이후 HEAD 에서 한 번 더 돌려 같은 결과를 확인했다. 기준선(`d43e53cc` 단독) 전체 실행은 하지 않았다 — 실패가 0 이라 대조할 목록이 없다.
- 임시 PG 16.13(Homebrew, `$TMPDIR` 클러스터, 끝나면 정지·삭제)에서 `backend-pg-smoke` 잡의 `run` 단계를 순서대로 재현: head 1개 → 빈 DB `upgrade head`(약 1.1~1.9초) → `tests/pg` 8 통과 → 위생 통과 → (스냅샷 단계는 덤프가 없어 skip) → `alembic check` 정보성.
- 프론트·tsc·eslint 는 이 워커의 범위가 아니라 실행하지 않았다.

## 4. PG-3 재현 증거 (P0)

- 수정 전: 빈 DB(`smoke_empty`)에서 `alembic upgrade head` → **rc=1**, 14번째 `30c1bfbc724f` 에서 `psycopg2.errors.DuplicateTable: relation "chat_room_participants" already exists`(0.49초).
- 수정 후: **rc=0**, `alembic current` = `heads` = `e036a0000051`, 리비전 84개 불변, 테이블 62개 + `alembic_version`(63).
- 스키마 대조: 같은 체인에서 `30c1bfbc724f` 를 `stamp` 로 건너뛴 DB 와 `pg_dump --schema-only` 를 비교하면 차이가 **정확히 4건** — `careers.role` 200→100, `careers.is_current NOT NULL`, `careers.updated_at`, `qualifications.updated_at`.
- 단위 회귀(`test_sdd211_migration_30c1_idempotent.py`): 수정 전 파일로 되돌리면 3건 실패(RED), 수정 후 5건 통과. 오프라인 `--sql` 렌더는 원래 문장을 그대로 낸다.

## 5. P1 "일부러 깨뜨린 리비전" (PG-9) — 로컬 대체

`act` 와 도커가 없어(도커 데몬 미기동) CI 실증은 하지 못했다. 같은 `run` 단계를 로컬 PG 로 재현했다.
- 이미 있는 테이블을 만드는 리비전을 head 뒤에 추가 → `빈 DB 에 alembic upgrade head` 단계 **FAIL rc=1**.
- head 를 둘로 만드는 리비전 추가 → `alembic head 는 정확히 1개` 단계 **FAIL rc=1**.
- 두 주입 파일은 커밋하지 않았고 삭제했다. **GitHub Actions 에서의 RED 확인과 `gh run` 링크, 단계별 소요(PG-11)는 I1 에서 한다.**

## 6. P2 대기 — Brian go 필요

준비한 것: `backend/tests/fixtures/pg/` 자리, 위생 가드(`check_fixture_hygiene.py`), `seed_synthetic.sql`(example.com·`gen_random_uuid()` 만, 로컬 PG16 head 에서 적재 확인), CI 단계(`baseline_*.sql` 이 있을 때만 실행). 덤프가 없으면 건너뛴다. 복원→시드→`upgrade head` 경로는 빈 체인으로 만든 덤프를 임시로 넣어 로컬에서 통과를 확인한 뒤 제거했다.

실행 시 절차(미실행, dev 읽기 필요):
1. 서버에서 `.env.dev` 의 `DATABASE_URL` 을 환경변수로만 읽어(`set -x` 금지) `pg_dump --schema-only --no-owner --no-privileges` 실행, 결과에서 `^\\(un)?restrict ` 줄을 제거하고 `INSERT INTO public.alembic_version … 'e036a0000051'` 한 행을 덧붙여 `baseline_e036a0000051.sql` 로 저장.
2. `python backend/tests/fixtures/pg/check_fixture_hygiene.py` 로 위생 0건 확인 후 커밋.
3. **주의**: 최근 `pg_dump`(16.13 확인)는 `\restrict` 메타 명령을 넣는다. 러너 `psql` 이 이를 모르면 복원이 실패하므로 CI 단계는 해당 줄을 걸러서 복원한다.
4. dev 덤프에 `CREATE EXTENSION` 이 있으면 `postgres:16` 이미지에 없을 수 있다 — 첫 실행 때 확인.
5. 덤프 스키마 vs 빈 체인 스키마를 각각 복원·`pg_dump --schema-only` 해 diff 건수를 보고한다(PG-5, 추정 ≈12건).

## 7. `alembic check` 드리프트 12건 (후속 정리 backlog, PG-10)

빈 체인 head 에서 모델과 다른 곳(로컬 PG16 측정): `agent_conversations.created_at` NOT NULL · `agent_memory_items.client_id` 인덱스 추가 · `chat_messages.read_by` ARRAY(VARCHAR(36))↔JSONB · `ix_chat_messages_room_id_created_at` 제거 · `eeg_feature_windows.created_at` NOT NULL · `eeg_raw_chunks.created_at` NOT NULL · `uq_eeg_record_session_participant` 유니크 추가 · `ix_org_documents_org_id` 제거 · `ix_org_documents_status` 제거 · `ix_pipeline_outbox_status_available` 제거 · `user_org_memberships.created_at` NOT NULL · `user_org_memberships.updated_at` NOT NULL. 이 12건이 실제 dev DB 에도 있는지는 P2 diff 로 확인한다. 차단 승격은 정리 후.

## 8. M0 (M1) 요약

- 질의 44문장(B0·A1~A11·A4a~d·A5 변형·C2~C4·C6-Q1~Q11), `WITH` 없음, 전부 집계. 러너는 연결 옵션(read-only·statement_timeout) + REPEATABLE READ/READ ONLY 단일 트랜잭션 + 항상 ROLLBACK + 문장 검증(SELECT 시작·함수 허용 목록·금지 문자)·출력 위생 가드(이메일/UUID 형식·250행 상한).
- U5=A: 소량 셀 억제 코드·`HAVING` 없음. U6: A4d 는 `--include-labels` 일 때만 실행, 결과는 별도 0600 파일(`out-labels-*`), 일반 출력·커밋 대상과 분리. 폴더 `.gitignore` 에 `out-*` 추가.
- 빈 PG: EXPLAIN 44/44, 전 질의 실행 오류 0. 합성 데이터(롤백되는 트랜잭션)로 A1·A2·A4b·A5·A6·A10·A11 집계가 손으로 센 값과 일치함을 `tests/pg` 에서 검증. 러너 연결이 실제로 쓰기를 거부함(`create temp table` → read-only 오류)도 PG 에서 확인.
- 독립 리뷰(별개 에이전트)와 R0~R10 기록: `m0-review.md`. 지적 중 "다른 qid 로 라벨을 내보내는 경우"는 러너가 아니라 정적 테스트·sha256 고정으로 막는다고 판단해 러너에는 넣지 않았다.
- **질의는 어떤 DB 에도 실행하지 않았다.** M2(스냅샷)·M3(실행)는 Brian 승인 단계.

## 9. 개정한 기존 테스트 / 기존 파일 변경

- 기존 테스트 개정 **0건**. 기존 파일 수정은 `.github/workflows/ci-feature.yml`(잡 추가)과 마이그레이션 `30c1bfbc724f_*.py` 두 개뿐.
- `deploy-dev.yml`·`e2e-smoke.yml` 변경 0(PG-12). PG 잡은 `deploy-dev` 의 `needs` 가 아니므로 **브랜치 보호의 필수 상태 점검 등록은 Brian 수동**(저장소 설정, 현황 미확인).

## 10. 확인하지 못한 것 / 주의

- GitHub Actions 에서의 실행·소요(PG-11)·RED 확인(PG-9) — I1. 러너 `psql` 유무, `pip` 설치 소요.
- 최소 패키지 6종(requirements.txt 와 같은 버전)으로 alembic·`tests/pg` 가 도는 것은 macOS 로컬 venv 에서 확인했고 Linux 러너에서는 미확인.
- G9: 새 파일에 `127.0.0.1`(CI 서비스 컨테이너·로컬 한정 호스트 가드)과 CI 일회용 DB 비밀번호 `ci_pw`(PG-7 이 허용한 영숫자 비밀번호, 비밀 아님)가 있다. 응답 형태 테스트 `test_sessions_response_shapes.py` 는 기존 테스트와 같은 가짜 주소 `@test.com` 을 쓴다(C3 는 만든 뒤 수정 금지라 그대로 둠).
- 계약 골든은 Phase 0 시작 시점 동작이다(버그 포함). 61 라우트 선택 규칙에서 admin 2·reports 1 의 호출자는 확인하지 못했다.
- `tests/pg` 의 PG 테스트는 `PG_SMOKE=1` + 로컬 호스트 `DATABASE_URL` 일 때만 실행된다(개발 DB 오접속 방지로 plan 의 "DATABASE_URL 이 PG 일 때" 보다 엄격하게 했다).
- 프론트 `reportStore` 등 BE-1/FE-1 소유 파일은 건드리지 않았다.
