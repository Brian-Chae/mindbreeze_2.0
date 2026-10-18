# SDD-214 Verify — 구현 전 QA 체크리스트 (Stage ③, 구현 전 게이트)

> **구현 후 완화 금지.** 이 문서는 구현 시작 전에 확정한다. 구현 중·후에 항목을 삭제·완화·예외 추가하지 않는다. 기준에 못 미치면 기준을 고치지 말고 구현을 고치거나, **선택지와 비용을 제시해 Brian 승인을 받은 뒤** 하단 `변경 이력`에 사유와 함께 반영한다. 사후 작성 금지(`CLAUDE.md` 7-Stage SDD).
> 근거: `spec.md` · `plan.md`(TD1~TD21, Task, §10 마이그레이션 안전, §12 게이트) · `docs/class-session-restructure/{기획,영향도}.md` · SDD-211 verify 형식.
> 표기: 모든 확인 항목은 `[ ]` 체크박스. 판정 코드: **U**=단위 **B**=백엔드 pytest(SQLite) **P**=PG 테스트(`backend-pg-smoke`) **F**=프론트 vitest **C**=CI 잡 **E**=dev E2E **M**=수동(Brian 입회·승인) **S**=정적 검사(grep·diff·스크립트) **Q**=운영 DB 읽기 전용 조회.
> **결정 전제**: **U2** `users` 변경 제외 · **U5** 시안 승인 병행. (U1·U3 소멸, U4 단순화 — 보관용 관계 기본값 확정.) 답이 달라지면 구현 **전에** 해당 행을 개정하고 `변경 이력` 에 기록한다.
> **신규 전제(Brian, 2026-10-18)**: 정식 릴리스 전이라 기존 데이터는 모두 삭제 가능, 구 앱·타 개발자 없음. 데이터 이전·구 앱 호환 시나리오는 이 문서에서 제거되었다(변경 이력 참조).
> 미확인(plan §14) 중 **G0·G1·P0·S0·Z1 단계에서 해소할 것**은 해소 결과를 `baseline.md`·`schema-contract.md`·`reset-procedure.md` 에 기록하고, 그 결과로 기준이 바뀌면 변경 이력에 사유를 남긴다.

## 0. 검증 층과 실행 명령

| 층 | 이름 | 실행 | 대상 |
|---|---|---|---|
| V-B | 백엔드(SQLite 단위) | `cd backend && pytest -q --tb=short --ignore=tests/test_sprint4_integration.py --deselect=tests/test_sdd070_pdf_metrics.py::test_real_pdf_metric_pages` (CI 와 동일 제외) | CL·RD·CP 일부 + 기존 전체 |
| V-P | 백엔드(PostgreSQL) | `cd backend && pytest --confcutdir=tests/pg tests/pg -m pg` (로컬 PG16 필요) | SC·MG·CN·ZR·CP — **제약·마이그레이션의 1차 증거**(SQLite 는 FK 가 꺼져 있고 ORM 이 CHECK 를 선언하지 않으므로 위반을 못 잡는다) |
| V-F | 프론트 | `cd frontend && npx vitest run` | FE |
| V-S | 정적 | `npx tsc -p tsconfig.app.json --noEmit` · `npx eslint src/` · `npm run build` · `cd backend && alembic heads` · `python deploy/ci/check_migrations.py --base-sha <SHA> --out <json>` · `git diff --name-only` · grep | G·MG·FE |
| V-C | CI | `ci-feature.yml`(frontend·backend·**backend-pg-smoke**) | 전 항목 합산 |
| V-E | dev E2E | `e2e-smoke.yml` — 배포 후 자동 | DL |
| V-M | 수동 | Brian 승인·입회 | 초기화·머지·prod |

- 프론트 CI `Test` 단계가 비차단이면 합격 판정은 로컬/CI 로그에서 파일별 pass 를 직접 확인한다(SDD-211 G2 와 동일).
- 기준선: Task **G0** 가 구현 전 `baseline.md` 에 pytest/vitest/tsc/eslint 통과·실패 목록과 SDD-211 계약 골든 현황을 기록한다. "신규 실패 0" 은 이 기록 대비다.

---

## 1. 공통 합격 기준 (모든 Task)

| 확인 | ID | 기준 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | G1 | **백엔드 신규 실패 0**: G0 기준선 외 실패 없음. 기존 테스트 파일 수정은 §4 개정표 범위뿐 | B·S | 신규 실패 0 |
| [ ] | G2 | **프론트 신규 실패 0**: 통과하던 파일 모두 통과, 신규 파일 전부 통과(로그로 확인) | F | 신규 실패 0 |
| [ ] | G3 | `tsc -p tsconfig.app.json` 0 · `eslint src/` 0 · `npm run build` 성공 | S | 0 |
| [ ] | G4 | **기존 테이블 변경 한정**: `sessions`·`session_participants`·`reports` 에 대한 마이그레이션 문장은 컬럼 추가·인덱스·FK·CHECK·UNIQUE 추가뿐. **기존 컬럼** 삭제·개명·타입 변경·NOT NULL 승격·기본값 변경 0. 053~055 `upgrade()` 에 `DROP/DELETE/TRUNCATE/UPDATE` 0 | S | 충족 |
| [ ] | G5 | **변경 최소화**: `git diff --name-only <기준 SHA>..HEAD` 가 plan §9 소유 파일 + 신규 테스트·골든·픽스처 + `specs/sdd-214-…/` + `backend/scripts/reset_dev_data.py`(+서비스) 안에만 있다. 엔진(진행·입장·뇌파·녹음/STT/요약·리포트 *생성*) 파일 수정 0, `report_service.py` 승인 경로 수정 0(TD10), `models/user.py`·`users` 마이그레이션 0(U2). **구 호환 항목이던 `class_code_service`·`class_code_reissue`·`code_service`·`reminder_service`·`org_public_service`·`dashboard_service`·`session_email_invite_service`·`notification_service`·`retention_sweep_service` 수정 0** | S | 범위 밖 파일 0 |
| [ ] | G6 | **사용자 노출 문구 변경 0**: 서버·프론트 사용자 노출 문구 리터럴 diff 0 (에러 `detail` 포함). 읽기 API 신규 에러 문구는 기존 세션 API 와 같은 문구 재사용 | S | 변경 0 |
| [ ] | G7 | **안전망 불변**: SDD-211 계약 골든(`tests/contract/golden/*`)·특성화 테스트는 **구현 커밋에서 수정 0**(예외: 가산 필드로 인한 갱신이 불가피하면 `breaking_exemptions.json` 절차, 변경 이력에 기록). 가산 전용 규칙은 유지(사유: 프론트 무변경 회귀망, plan §6.2) | S | 수정 0 또는 승인된 예외 |
| [ ] | G8 | `any` 사용 0(신규·수정 TS), 객체·배열 직접 변경 0, 주석은 한글·WHY 만, 파일명 kebab-case/snake_case | S | 0 |
| [ ] | G9 | **비밀·개인정보 0**: 신규·수정 파일(절차서·보고·픽스처·로그 샘플 포함)에 이메일(`@example.com` 제외. 단 시드 계정 `counselor@test.com`·`client@test.com` 명칭은 허용)·전화·UUID 실값·토큰·**비밀번호**·DB 접속 문자열·IP·라벨 원문 0건 | S | grep 0건 |
| [ ] | G10 | PR 마다 CI 3잡(frontend·backend·backend-pg-smoke) GREEN, 머지 후 dev 자동 배포 성공 + `e2e-smoke` 통과 | C·E | 충족 |
| [ ] | G11 | **PR 별 범위 일치**: PR-A 에는 053~055·모델·분류 함수·세션 생성 경로·일관성·초기화 절차/스크립트만, PR-B 에는 읽기 API·`SessionResponse` 가산·`SessionDto` 만(plan §9·§12). 제약(CHECK)과 생성 경로는 **같은 PR** | S | 일치 |
| [ ] | G12 | **사용자 체감 변화 0**: 프론트 화면 파일(`pages/`·`components/`) 수정 0 — `lib/api/session.ts` 타입 가산 외 | S | 0 |

---

## 2. 트랙별 시나리오

### 2.1 스키마 (S 트랙) — SC

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | SC-1 | `schema-contract.md`(S0)의 테이블 10개 컬럼·타입·NULL·기본값·FK·인덱스가 마이그레이션·모델과 **1:1 일치**(자동 대조 테스트: 카탈로그 vs 확정표 파싱) | P·S | 불일치 0 |
| [ ] | SC-2 | 신규 테이블 10개 이름이 `spec.md` 와 일치, `class_templates`·`session_migration_map` 은 **없음** | P | 10개 |
| [ ] | SC-3 | `sessions` 에 정확히 5개 컬럼 추가(`class_id`·`counseling_relationship_id`·`seq`·`session_kind`·`host_state`), `session_participants` 에 7개(`member_id`·`guest_client_id`·`attendance_status`·`attendance_kind`·`makeup_for_session_id`·`attendance_marked_by`·`absence_reason`), `reports` 에 2개. `session_kind` 는 `NOT NULL DEFAULT 'regular'`, 나머지는 컬럼 수준에서 NULL 허용(필수성은 CHECK, TD4) | P | 일치 |
| [ ] | SC-4 | 기존 컬럼의 타입·NULL·기본값이 마이그레이션 전/후 **동일**(카탈로그 diff 가 추가 항목만) | P | 변경 0 |
| [ ] | SC-5 | 모든 부모 FK 가 `ON DELETE RESTRICT`, `reports.approved_by_user_id` 는 NO ACTION (`pg_constraint.confdeltype`) | P | 일치 |
| [ ] | SC-6 | 부분 유니크 `uq_classes_active_access_code`: 활성(숨김·종료·취소 제외) 클래스 간 코드 중복 INSERT 는 실패, 종료/숨김 클래스와 같은 코드는 허용 | P | 규칙대로 |
| [ ] | SC-7 | `class_instructors UNIQUE(class_id, user_id)` 위반 INSERT 실패 (복합 FK 의 참조 대상) | P | 실패 확인 |
| [ ] | SC-8 | `counseling_relationships`: `uq_rel_guest`(비회원 1명 비종료 관계 1개 — `pending`·`active` 만, 종결·보관이 있어도 새 상담사 관계 허용)·`uq_rel_placeholder`(상담사당 보관용 1개) 위반 INSERT 실패 | P | 실패 확인 |
| [ ] | SC-9 | `hidden_at`/soft 상태 컬럼 존재(삭제 금지 정책의 전제): `class_instructors.status`, `classes.hidden_at`, `counseling_relationships.hidden_at` | P | 존재 |
| [ ] | SC-10 | ORM 모델이 DB 와 일치: `alembic check`(정보성) 에서 **이 SDD 가 추가한 객체**에 대한 차이 0 (CHECK 는 비교 대상이 아니고, 복합 FK 2개는 ORM 미선언이라 차이로 감지되므로 `env.py` `include_object` 에서 이름으로 제외한다, TD8) | S | 신규 차이 0 |
| [ ] | SC-11 | ORM 전역 숨김 필터: `Class`·`CounselingRelationship` 의 숨김 행이 기본 조회에서 제외, `include_hidden` 옵션으로 포함 (기존 `Session` 필터 동작 불변) | B | 통과 |
| [ ] | SC-12 | 순환 FK 순서(053 → 055): 빈 DB 체인에서 `upgrade head` 오류 0 | P | 통과 |
| [ ] | SC-13 | 컬럼 확정표 근거 표기: 모든 컬럼 행에 근거 문서(§) 열 존재, `미확인` 이 남은 컬럼은 0 또는 사유와 함께 Brian 보고. `origin` 컬럼 제거 여부 결정이 기록됨(TD20) | S | 충족 |
| [ ] | SC-14 | **ORM 에 CHECK·복합 FK 미선언**: 모델 메타데이터에 `ck_sessions_one_parent`·복합 FK 가 없다(기존 SQLite 테스트 보호, TD8) | S | 0 |

### 2.2 마이그레이션 안전 (멱등 · 가드 · 롤백) — MG

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | MG-1 | **단일 head**: `alembic heads` 가 `…055` 1개. `down_revision` 체인이 `…052` → 053 → 054 → 055. `…056`·`…057` 리비전 없음 | S | 충족 |
| [ ] | MG-2 | 빈 DB 에 `alembic upgrade head` 성공 (체인 전체) | P | 성공 |
| [ ] | MG-3 | SDD-211 덤프 픽스처(`baseline_e036a0000051.sql`) 복원 후, 픽스처에 비템플릿 세션이 있으면 **Z 절차(초기화)로 비운 뒤** `upgrade head` 성공 (051 → 052 → 053 …). 픽스처가 데이터를 포함하는지 여부를 `baseline.md` 에 기록(`미확인` 해소) | P | 성공 |
| [ ] | MG-4 | **멱등**: `upgrade head` → `downgrade` 한 단계씩 → `upgrade head` 재실행 후 스키마가 동일(카탈로그 diff 0). 또한 "일부 객체가 이미 존재하는 상태"(예: 054 의 테이블 하나를 미리 생성)에서 `upgrade` 가 오류 없이 완료 | P | diff 0, 오류 0 |
| [ ] | MG-5 | **파괴적 게이트**: `check_migrations.py` 를 053~055 각각에 실행 → `destructive=false`, `warnings=[]`. `ADD CONSTRAINT`(CHECK·FK·UNIQUE)가 파괴적으로 분류되지 않음(plan §14-12) | S | 전부 false |
| [ ] | MG-6 | **가드(핵심)**: 비템플릿 세션이 1건이라도 있는 DB 에서 `upgrade` 가 055 에서 **명확한 오류 메시지**("데이터 초기화(Z) 먼저")로 중단되고, 중단 후 DB 가 **변경 0**(053·054 포함 전체 롤백, `alembic_version` 이 052 그대로) | P | 통과 |
| [ ] | MG-7 | **템플릿 보존**: 템플릿 세션(`is_template=true`)만 있는 DB 에서 `upgrade` 성공, 템플릿 행 해시 이전/후 동일, 템플릿은 부모 없이 유지 | P | 동일 |
| [ ] | MG-8 | **앱 레벨**: PR-A 상태에서 기존 pytest 전체와 SDD-211 계약 골든 61 라우트·형태 17 시나리오 통과 (세션 생성은 새 생성 경로 경유) | B | 신규 실패 0 |
| [ ] | MG-9 | 모든 리비전 첫 문장이 `SET LOCAL lock_timeout`, 모든 DDL 이 존재 검사 또는 `IF NOT EXISTS` (정적 검사) | S | 충족 |
| [ ] | MG-10 | `downgrade()` 가 신규 제약·컬럼·테이블을 의존 역순·`IF EXISTS` 로 제거하고 **기존 테이블의 기존 컬럼·데이터를 건드리지 않음**, docstring 에 "데이터가 있으면 소실, 빈 환경에서만 사용" 경고 | S·P | 충족 |
| [ ] | MG-11 | 마이그레이션 PR 본문에 **롤백 설계(plan §10.3 표 인용)** 와 `check_migrations` 결과 첨부 | S | 첨부 |
| [ ] | MG-12 | 롤백 트랩 문서화: "코드 revert 후 DB 는 `…055`, `backend/alembic` 에는 리비전 없음 → 새 코드 재배포 전 수동 alembic 금지" 및 "구 코드는 CHECK 때문에 세션을 못 만든다(구 호환 포기, forward-fix 우선)" 가 PR-A 본문과 summary 에 기재 | S | 기재 |
| [ ] | MG-13 | 인덱스: 새 컬럼 FK 인덱스(`sessions.class_id`·`counseling_relationship_id`, 부모 FK 컬럼)가 일반 `CREATE INDEX`, `IF NOT EXISTS` | P | 존재 |

### 2.3 분류 함수 (C 트랙) — CL

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | CL-1 | 템플릿(`is_template=true`) → 부모 없음(`T0`) | U | 통과 |
| [ ] | CL-2 | `meditation` → 명상 클래스 `C1` (`participant_mode` 가 어느 쪽이든) | U | 통과 |
| [ ] | CL-3 | `clinical`·`hypnosis`·`custom` + `participant_mode='group'` → 명상 클래스 `C2`, 세션 `type` 라벨은 그대로 | U | 통과 |
| [ ] | CL-4 | `clinical`·`hypnosis`·`custom` + `participant_mode='one_on_one'` → 상담 관계(보관용) `R3`. **정원(`max_participants`)을 판정에 쓰지 않음**(정원 10 인 1:1 도 상담) | U | 통과 |
| [ ] | CL-5 | T0·C1 등 선행 규칙에 해당하지 않는 알 수 없는 `type` 또는 `participant_mode` → `X0`(템플릿·명상은 모드가 미상이어도 T0·C1 이 먼저 적용), 예외를 던지지 않고 결과로 반환 | U | 통과 |
| [ ] | CL-6 | **순수성**: 같은 입력 → 같은 출력, 함수 모듈이 DB 세션·시계·난수·환경변수를 import 하지 않음(정적 검사). 입력 타입에 참여자 수·`custom_type_name` 이 없음 | U·S | 통과 |
| [ ] | CL-7 | 규칙표 전수: plan §4.1 의 모든 행(T0, C1, C2, R3, X0)이 최소 1개 테스트로 커버 | U | 커버리지 100% (규칙 코드 기준) |

### 2.4 데이터 초기화 (Z 트랙) — ZR

> 구현 단계에서는 **합성 PG DB 에서만** 검증한다. dev·prod 실제 실행은 §3 의 M 게이트(Brian 확인 후).

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | ZR-1 | 절차서 `reset-procedure.md` 존재: 환경 식별, 삭제 범위(DB 테이블·Redis·S3 프리픽스), 순서, 확인 문구, 재시드, 사후 확인, 경합 처리(plan §5), 비밀번호·실데이터 미기재 | S | 충족 |
| [ ] | ZR-2 | **스크립트 안전장치**: 기본 모드는 dry-run(삭제 대상 **건수만** 출력), `--apply` 는 환경 식별 문자열을 입력하지 않으면 거부, 잘못된 환경 문자열이면 거부, `alembic_version` 은 항상 보존 | U·P | 통과 |
| [ ] | ZR-3 | **합성 PG 시드(세션·참여자·리포트·사용자·기관)** 에서 `--apply` → 보존 대상 외 전 테이블 0행, 이후 `alembic upgrade head`(055 가드) 통과 | P | 통과 |
| [ ] | ZR-4 | 재실행(이미 빈 DB)에서 오류 0·변경 0 | P | 통과 |
| [ ] | ZR-5 | **범위 옵션**(prod 권고안: 계정·기관 유지, 세션 계열 삭제): 옵션 사용 시 사용자·기관 행은 보존되고 세션·참여자·리포트·기록·알림 등 세션 종속 데이터만 0행. 삭제 대상 테이블 목록이 문서화되고 FK 위반 없이 완료 | P | 통과 |
| [ ] | ZR-6 | 재시드 수단 확정: `counselor@test.com`·`client@test.com` 로그인 성공(합성/dev 에서), `e2e_seed.py seed` 로 e2e 계정 생성, 비밀번호가 문서·로그·이력에 없음 | P·S | 통과 |
| [ ] | ZR-7 | 출력·로그에 개인정보 0: 건수·테이블명·환경명만 출력(이름·이메일·UUID·S3 키 원문 없음) | U·S | 0건 |
| [ ] | ZR-8 | S3·Redis 삭제 범위(N1·N2) 결정이 `reset-procedure.md` 에 기록되고, 스크립트가 해당 범위 밖(다른 프리픽스·다른 환경)을 건드리지 않음 | U·S | 통과 |

### 2.5 제약 (K 트랙) — CN (055 에서 즉시 유효)

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | CN-1 | 055 적용 직후 모든 제약이 **유효 상태**(`pg_constraint.convalidated = true`, `NOT VALID` 0) | P | 통과 |
| [ ] | CN-2 | **`ck_sessions_one_parent`**: 비템플릿 세션 INSERT — ① 부모 둘 다 NULL → 실패 ② 부모 둘 다 채움 → 실패 ③ 부모 하나 + `seq`·`host_state` 채움 → 성공 ④ 부모 하나지만 `seq` 또는 `host_state` NULL → 실패. 템플릿 세션 — 부모 NULL 로 성공 | P | 규칙대로 |
| [ ] | CN-3 | **복합 FK 위반**: 호스트가 해당 클래스의 `class_instructors` 행이 아닌 세션 INSERT/UPDATE 는 PG 에서 실패. 상담도 동일(`counseling_relationship_counselors`) | P | 실패 확인 |
| [ ] | CN-4 | `UNIQUE(class_id, seq)`·`UNIQUE(counseling_relationship_id, seq)`: 같은 부모 내 중복 `seq` 실패, 다른 부모 간 같은 `seq` 허용, 템플릿(부모 NULL)은 영향 없음 | P | 규칙대로 |
| [ ] | CN-5 | `UNIQUE(session_id, member_id)`: 같은 회차·멤버 출석 행 중복 실패, `member_id` NULL 다수 허용 | P | 규칙대로 |
| [ ] | CN-6 | `CHECK(member_id IS NULL OR guest_client_id IS NULL)`: 둘 다 채우면 실패, 둘 다 NULL 은 통과 | P | 규칙대로 |
| [ ] | CN-7 | `uq_rel_active_pair`: 같은 상담사·회원의 비보관(`pending`·`active`·`closed`) 관계 2개는 실패, 보관(`archived`) 관계와만 공존 — R-DB 리뷰로 정정(기획-상세-상담 §179, 종결은 재개로 이어 감) | P | 규칙대로 |
| [ ] | CN-8 | **기존 SQLite 테스트 영향 0**: ORM 이 CHECK 를 선언하지 않으므로, 부모 없이 `Session(...)` 을 직접 만드는 기존 pytest 가 그대로 통과 (G1) | B | 신규 실패 0 |
| [ ] | CN-9 | **기존 `tests/pg`**: 부모 없이 `sessions` 를 INSERT 하던 테스트는 P0 목록의 허용 범위(§4)에서만 정정되고 그 외 신규 실패 0 | P | 신규 실패 0 |

### 2.6 읽기 API (R 트랙) — RD

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | RD-1 | 5개 엔드포인트 존재·응답 모델: `GET /classes`·`/classes/{id}`·`/classes/{id}/sessions`·`/counseling`·`/counseling/{id}`. OpenAPI 에 등록 | B | 5/5 |
| [ ] | RD-2 | **동치성**: 역할 5종(호스트 상담사·타 상담사·센터 관리자·플랫폼 관리자·참여 회원, 무관한 회원 포함) × 시드(새 생성 경로로 생성)에서, 새 API 로 도달 가능한 세션 집합의 합 == 같은 사용자의 `GET /sessions` 목록 집합 (넓히지도 좁히지도 않음) | B | 불일치 0 |
| [ ] | RD-3 | 타 호스트의 클래스/관계 id 접근 → 현행 세션 상세와 **같은 상태코드·메시지**(존재 여부 비노출) | B | 일치 |
| [ ] | RD-4 | 숨김 클래스·숨김 세션은 목록·상세·회차 목록에서 제외 | B | 통과 |
| [ ] | RD-5 | 제거/대기취소 참여자는 회원 시점에서 제외. 회원 시점 가시 범위는 `session_participants` 기준(`class_members` 는 비어 있음) | B | 통과 |
| [ ] | RD-6 | **회원 시점 마스킹**: 타 참여자 정보·코드·`organization_attribution_known` 가 응답에 없음(`origin` 컬럼을 남기면 그것도 제외, TD20). 호스트 시점에만 포함 | B | 통과 |
| [ ] | RD-7 | **본문 비노출**: 어떤 응답에도 EEG·녹음·영상·전사·리포트 본문·상담사 메모가 없음 (응답 필드 화이트리스트 테스트). 상담 상세는 기록·리포트 **진행 상태 값**만 | B | 0 |
| [ ] | RD-8 | **센터 관리자**: 상담 관계 응답은 메타(상담사·내담자 표시·회차 수·상태)만, 본문 없음. 현행 `GET /sessions` 가시 범위를 넘지 않음 (D-28 은 Phase 3) | B | 통과 |
| [ ] | RD-9 | 목록 페이지네이션·`status` 필터, 빈 목록, 존재하지 않는 id | B | 통과 |
| [ ] | RD-10 | 진행률/다음 세션 계산: 취소 회차는 분모에서 제외·계획 횟수 없을 때 가시 회차 기준, 다음 세션은 `scheduled_at` 이 가장 가까운 미래 비취소 회차 (경계: 회차 0개, 전부 완료) | B | 통과 |
| [ ] | RD-11 | 상담 응답의 내담자 표시: Phase 1 은 보관용 관계 → **고정 라벨**. 회원 시점은 관계가 아니라 참여 세션 기준으로 도달(동치성) | B | 통과 |
| [ ] | RD-12 | **성능**: dev 규모 시드(클래스 200·회차 300)에서 목록 응답 200ms 이내 목표, 질의 수가 항목 수에 비례하지 않음(N+1 없음, 쿼리 카운터 단언) | B·E | 통과 |
| [ ] | RD-13 | **라우트 접두사**: `/class`(기존 `class_audio`) 라우트 집합 불변, `/classes`·`/counseling` 과 충돌 0 (라우트 목록 대조) | B | 불변 |
| [ ] | RD-14 | **접근 로깅**: 읽기 API 가 현행 세션 읽기와 같은 방식의 접근 기록(있다면)을 남김. 현행 방식 확인 결과를 `baseline.md` 에 기록 (plan §14-8) | B·S | 일치 |
| [ ] | RD-15 | 인증 없는 호출 401, 잘못된 역할 403 — 기존 의존성(`get_current_user` 등) 재사용 | B | 통과 |
| [ ] | RD-16 | 응답 직렬화에 **Pydantic v2 `model_validate`/`from_attributes`** 사용, 응답에서 UUID/날짜 형식이 기존 세션 API 와 동일 | B | 일치 |

### 2.7 세션 생성 경로·일관성 (P 트랙) — CP

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | CP-1 | `POST /sessions` (meditation) → 클래스 + `class_instructors(lead, active)` + 세션(`seq=1`·`host_state='assigned'`·`session_kind='regular'`)이 **한 트랜잭션**에 생성. 클래스 설정·코드가 세션 값과 동일(dual-write). 응답은 기존 필드 + 가산 필드 | B·P | 통과 |
| [ ] | CP-2 | `POST /sessions` (clinical/hypnosis, one_on_one) → 호스트별 보관용 관계에 배치, `seq` 이어 부여. 같은 호스트의 2번째 상담 세션은 **같은 보관용 관계** 재사용(관계 1개, `uq_rel_placeholder` 위반 없음) | B·P | 통과 |
| [ ] | CP-3 | 생성 중 부모 생성 실패 시 세션도 생성되지 않음(원자성). 분류 `X0` 도달 시 세션 생성 롤백 + 서버 오류 | B·P | 통과 |
| [ ] | CP-4 | **같은 분류 함수**: 생성 경로 전체(`POST /sessions`·`duplicate`·`new-run`)가 분류 함수 하나만 호출(규칙 중복 구현 없음, 정적 검사) | S·B | 통과 |
| [ ] | CP-5 | `duplicate`·`new-run`·템플릿 적용 경로의 산출물도 부모를 가진다(P0 전수 결과 기준), `new-run` 은 별도 부모(TD15), 템플릿 저장(`save-as-template`)은 부모 없음 | B | 통과 |
| [ ] | CP-6 | **세션 생성 지점 전수**: `Session(` 생성 지점 목록(P0)의 모든 지점이 부모 생성을 거치거나 템플릿 사유로 제외됨 — 누락 0 (CHECK 가 PG 에서 누락을 잡으므로 PG 경로별 테스트로 확인) | S·P | 누락 0 |
| [ ] | CP-7 | 일관성 동기화: `PUT /sessions/{id}` 로 클래스 단위 필드(제목·설명·정원·참여 방식·LINK BAND 모드·장소·소요·녹음/채팅/SFU·알림 오프셋·코드) 수정 시 가시 세션 1개인 클래스에 반영 | B | 통과 |
| [ ] | CP-8 | 클래스의 **마지막 가시 세션**을 `DELETE`(숨김)하면 클래스도 `hidden_at`, 가시 세션이 남아 있으면 클래스 유지 | B | 통과 |
| [ ] | CP-9 | **링크 자동 생성 0**: 생성 경로 어디서도 `client_counselor_links` INSERT 0 (정적 검사 + 테스트) | S·B | 0 |
| [ ] | CP-10 | **코드 입장 경로 불변**: 입장·코드 관련 서비스 파일 수정 0(G5), 클래스를 통해 만든 세션의 `access_code` 로 기존 방식 입장이 그대로 동작(계약 골든·입장 회귀 테스트) | S·B | 통과 |
| [ ] | CP-11 | **구 계약 회귀**: SDD-211 계약 골든(61 라우트 가산 전용 + 형태 17 시나리오)이 PR-A·PR-B 에서 통과. 가산 필드 외 응답 변경 0 | B | 통과 |
| [ ] | CP-12 | WS 룸 이름(`session:{sid}`)·세션 id·참여자 id·입장 자격 JWT(`class_entry`)·리포트 토큰의 클레임/키가 불변 | B | 통과 |
| [ ] | CP-13 | 알림 코드 수정 0(`notification_service.py` 불변) — 알림 `params` 가산을 하지 않음 | S | 0 |

### 2.8 개인정보 (PV)

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | PV-1 | **Phase 1 은 신규 테이블에 개인정보를 쓰지 않는다**: 생성 경로·마이그레이션이 `class_members`·`counseling_guests`·`class_member_events`·`counseling_relationship_events`·`guest_claim_events` 에 INSERT 0 (정적 검사 + 생성 경로 테스트 후 행 수 0) | S·P | 0 |
| [ ] | PV-2 | 스위프 불변: `retention_sweep_service.py` 수정 0, `RETENTION_SWEEP_ENABLED` 기본값 불변 | S | 불변 |
| [ ] | PV-3 | EEG 접근 규칙 불변: 읽기 API 가 EEG 테이블을 조회하지 않음(정적 검사), 본인 세션 + 담당 상담사 규칙 변경 0 | S | 0 |
| [ ] | PV-4 | 감사: 읽기 API 가 기존 감사 로깅 요건(모든 데이터 접근 로깅, 6개월)에 해당하는지 확인 결과 기록 (RD-14 와 연동) | S | 기록 |
| [ ] | PV-5 | 초기화(Z)로 삭제되는 개인정보(S3 음성·PDF 포함)가 **남지 않음**(N2 범위대로) — 삭제 후 해당 프리픽스 오브젝트 수 0 보고(건수만) | M·Q | 기록 |

### 2.9 프론트 — FE

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | FE-1 | `SessionDto` 에 `class_id?`·`class_title?`·`seq?`·`area?` **선택 필드**만 추가, 기존 필드 변경 0 | S | 충족 |
| [ ] | FE-2 | 가산 필드가 없는 구 응답 fixture(기존 vitest)로 타입·렌더 회귀 0 | F | 신규 실패 0 |
| [ ] | FE-3 | 화면·라우트·문구 변경 0 (G12), Phase 2 용 새 API 클라이언트는 만들지 않음 | S | 0 |

### 2.10 시안(Phase 2) 연결 — DS

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | DS-1 | plan §11 매핑표의 "제공" 행 모두가 실제 API 응답 필드로 존재(필드명 대조 테스트 또는 수동 체크), "후속"·"데이터 없음" 행은 **Phase 2 에서 빈 상태 처리 필요**로 summary 에 인계 목록화 | S·M | 누락 0 |
| [ ] | DS-2 | 시안 3종(`host-classes`·`member-classes`·`counseling`)의 읽기 요구 필드 중 Phase 1 이 줄 수 없는 것 목록을 Brian 에게 전달 (U5 병행 승인 근거) | M | 전달 |
| [ ] | DS-3 | 시안 금지 규칙과 데이터 충돌 없음: API 응답에 점수·순위·종합점수·강사 평가 필드 0 | S | 0 |

### 2.11 배포·운영 — DL

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | DL-1 | **배포 순서 준수**: dev 초기화 → PR-A 머지 → PR-B 머지. 순서가 어긋나면 중단 (조정자 체크리스트: ① CI GREEN ② 초기화 완료 ③ 비템플릿 세션 0 확인 ④ 머지) | M | 준수 |
| [ ] | DL-2 | 초기화 **직후·머지 직전** 비템플릿 세션 0 재확인(건수 보고). 사이에 세션이 생겼으면 재초기화 | Q·M | 0 |
| [ ] | DL-3 | PR-A 배포 후 dev: `alembic_version=…055`, 신규 테이블 10개·가산 컬럼·제약 존재, 헬스체크·`e2e-smoke` 통과, 사용자 동작 변화 0, 신규 세션 생성 시 부모 1개 확인 | Q·E | 통과 |
| [ ] | DL-4 | 재시드한 `counselor@test.com`·`client@test.com` 로그인 성공(Brian 확인), `e2e-smoke` 가 e2e 계정으로 통과 | M·E | 통과 |
| [ ] | DL-5 | PR-B 배포 후 읽기 API 5종 스모크 + `e2e-smoke` 통과 | E | 통과 |
| [ ] | DL-6 | MANIFEST/릴리스 요약: PR-A/B 포함 릴리스 후보 빌드의 `destructive_migrations` 판정 확인 (prod 릴리스 전) — 052 의 `UPDATE` 로 인한 사전 영향(plan §10.5)을 빌드 요약으로 확인하고 `confirm_destructive` 필요 여부 기록 | S·M | 기록 |
| [ ] | DL-7 | prod: 사전 점검(읽기 전용: 현재 head·MANIFEST·비템플릿 세션 잔존 현황) → N4 범위 확인 → 초기화 → 릴리스 승인 → 배포, 각 단계 Brian 승인 기록 | M·Q | 기록 |
| [ ] | DL-8 | prod 배포 직후 점검에 `/health/ready`·`alembic_version`·신규 테이블 존재 포함. 초기 계정 로그인 확인(계정 유지 범위일 때) | Q | 통과 |
| [ ] | DL-9 | prod 반영이 **정식 릴리스 이전**에 완료됨(spec C5)을 summary 에 기록 | S | 기록 |

### 2.12 롤백 — RB

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | RB-1 | 빈 DB 에서 `…055` → `downgrade` → `…052` 가 무손실로 성공(신규 테이블·제약·컬럼만 제거), 이후 `upgrade` 재적용 성공 | P | 성공 |
| [ ] | RB-2 | **구 코드 + 055 DB** 시뮬레이션: 구 코드(PR-A 이전 커밋)의 비템플릿 세션 생성이 CHECK 로 실패함을 확인하고 대응(forward-fix 또는 승인 하 `downgrade`)이 `reset-procedure.md`/PR-A 본문에 기술됨(구 호환 포기는 의도된 동작) | P·S | 기록 |
| [ ] | RB-3 | PR-B revert: 읽기 API 제거 상태에서 PR-A 기능(생성 경로·`/sessions/*`) 정상 | B | 통과 |
| [ ] | RB-4 | 롤백 트랩 가정: `backend/alembic` 이 구 상태로 복원돼도 앱이 기동·요청 처리 가능한지(앱 기동 시 alembic 검사 유무 확인, `미확인` → 확인 결과 기록) | B·S | 기록 |
| [ ] | RB-5 | 롤백 후 `alembic` 수동 명령 금지 규칙이 PR-A 본문·summary 에 기재 (MG-12) | S | 기재 |

---

## 3. Brian 수동 확인 게이트 (V-M)

| 확인 | ID | 시점 | 내용 |
|---|---|---|---|
| [ ] | M-1 | 구현 시작 전 | 이 verify 승인 + 결정 U2·U5 답 + plan §14-6(분류 `C2` 근사) 이의 여부 |
| [ ] | M-2 | PR-A 머지 전 | 마이그레이션 PR 본문(롤백 설계·`check_migrations` 결과·가드 설명) 검토 |
| [ ] | M-3 | dev 초기화 전 | **N1**(DB·Redis 삭제 범위)·**N2**(S3 포함 여부, 재시드 계정)·**N3**(실행 시점) 확인. dev 는 현재 실사용 DB, 삭제는 비가역 |
| [ ] | M-4 | 초기화 직전 | 사전 점검 건수 보고 확인 + 환경 식별 문자열 입력 go |
| [ ] | M-5 | PR-B 머지 전 | PR-A 배포 결과(DL-3·DL-4) 확인 |
| [ ] | M-6 | prod 반영 전 | **N4**(prod 초기화 범위) 확인 + 사전 점검 보고 + 릴리스·초기화 go |
| [ ] | M-7 | 종료 | 최종 리뷰 |

---

## 4. 기존 테스트 개정 허용 목록 (이 목록 밖의 기존 테스트 수정은 G1 위반)

| 파일 | 사유 | 범위 |
|---|---|---|
| `backend/tests/test_sdd210_ci_gates.py` | 하드코딩된 head 리비전 단언(SDD-213 선례) | head 문자열 갱신만 |
| `backend/tests/test_sdd211_migration_30c1_idempotent.py` | 하드코딩된 head·리비전 개수 단언(SDD-213 선례: 85) | head·개수 갱신만 |
| (그 외 head/개수 하드코딩 테스트) | G0 의 grep 으로 확정 | head·개수 갱신만, 목록은 `baseline.md` 에 기록 후 이 표에 추가(변경 이력 기재) |
| `backend/tests/pg/test_m0_prequery_pg.py` | 이전 전 모양(부모 없는 세션) 시드 때문에 `ck_sessions_one_parent` 가 걸림 | **트랜잭션 안에서만** CHECK 를 해제하고 끝에 롤백. 해제는 `sessions` 에 ACCESS EXCLUSIVE 잠금을 쓰므로 **전용(로컬/CI 임시) DB 에서 직렬 실행**하고, 사후에 제약 존재·`convalidated` 를 확인하는 복구·유효 검증 테스트를 둔다 |
| (`backend/tests/pg/` 중 부모 없이 `sessions` 를 INSERT 하는 테스트) | `ck_sessions_one_parent` 때문. P0 가 목록 확정 | 부모(클래스) 생성 또는 템플릿 사용으로 정정하는 최소 변경만, 목록은 `baseline.md` 에 기록 후 이 표에 추가(변경 이력 기재) |

---

## 5. 변경 이력

| 일자 | 변경 | 사유 | 승인 |
|---|---|---|---|
| 2026-10-18 | 최초 작성 (Stage ③, 구현 전) | — | (개정 전 버전, 승인 이전) |
| 2026-10-18 | **개정: 데이터 이전 폐기** (아래 세 표) | Brian 신규 전제: 정식 릴리스 전이라 기존 데이터 전부 삭제 가능, 개발자 1인, 구 앱 없음 | **Brian 승인 대기** (verify 는 아직 구현 전 단계로 승인 전 개정이라 완화에 해당하지 않음) |

### 2026-10-18 개정 — 신규 (새로 생긴 시나리오)

| 신규 | ID | 내용 |
|---|---|---|
| **데이터 초기화(Z)** | ZR-1~ZR-8 | 절차서, 스크립트 안전장치(dry-run 기본·환경 문자열·`alembic_version` 보존), 합성 PG 에서 삭제→055 가드 통과, 재실행 안전, 범위 옵션(prod 권고), 재시드, 출력 개인정보 0, S3·Redis 범위 |
| **055 가드** | MG-6 | 비템플릿 세션이 있으면 명확한 오류로 중단하고 DB 변경 0 |
| **템플릿 보존** | MG-7 | 템플릿 행 보존 |
| **제약 즉시 유효** | CN-1, CN-2 | `convalidated=true`, `ck_sessions_one_parent` 4+1 경우 |
| **ORM 미선언** | SC-14, CN-8, CN-9 | CHECK·복합 FK 는 마이그레이션에만, 기존 SQLite 테스트 영향 0, 기존 `tests/pg` 정정은 허용 목록으로만 |
| **빈 환경 롤백** | RB-1, RB-2 | `downgrade` 무손실, 구 코드+055 는 의도적으로 세션 생성 불가(forward-fix) |
| **정식 릴리스 전 반영** | DL-9, 전제 | prod 반영을 릴리스 전에 완료 |
| **초기화 관련 게이트** | M-3, M-4, M-6, DL-2, DL-4 | N1~N4 확인, 머지 직전 재확인, 재시드 로그인 확인 |
| **무개인정보 쓰기 확인** | PV-1, PV-5 | 신규 테이블 INSERT 0, 삭제 후 S3 오브젝트 0 |
| **호환 파일 수정 0** | G5, CP-10, CP-13, PV-2 | 구 호환 대상이던 파일 9개 수정 0 |

### 2026-10-18 개정 — 제거 (사라진 시나리오)

| 제거 | 개정 전 ID |
|---|---|
| 백필 M2 전 시나리오(dry-run·apply·멱등·원자성·가드·역방향·검증 쿼리 V1~V19·이메일 정규화·링크 불변·이벤트 미생성 등) | BF-1~BF-26 |
| M3 사후 적용(`NOT VALID→VALIDATE`, 위반 데이터 시 VALIDATE 실패, 057 단독 PR) | CN-1(구)·CN-8(구) 등, 057 관련 MG |
| 데이터 보존(M1 전후 해시)·구 코드 모양 INSERT 성공 | MG-6(구)·MG-7(구) → 가드/템플릿 보존으로 대체 |
| 코드 입장 해석·8개 파일 폴백·발급 합집합·알림 `params`·구 앱 쓰기 동기화 조건(`origin`)·레거시 호출 계측 | CP-7~CP-9(구)·CP-12(구)·CP-14(구) |
| 스위프 확장·복제본 불일치 검출·스냅샷 보관 | PV-1~PV-4(구)·PV-6·PV-7 |
| 스냅샷·dry-run 보고·U1 승인·건수 대조·V1~V19 보고·재백필·M5 일일 점검·호환 윈도우 종료·prod 순서(U3)·M2 SSM | DL-3~DL-6(구)·DL-8(구)·DL-9(구)·DL-12(구)·DL-14(구)·M-3~M-6(구)·M-8(구) |
| 롤백 리허설 중 PR-C revert 스트레이 정리·역방향 SQL | RB-3(구)·RB-5(구) |

### 2026-10-18 개정 — 변경 (내용이 바뀐 시나리오)

| 변경 | 개정 전 → 개정 후 |
|---|---|
| 리비전·head | 053~057(head 057) → **053~055(head 055)** |
| 신규 테이블 | 11개 → **10개**(`session_migration_map` 제거) |
| 배포 PR | A/B/C 3개 → **A/B 2개**(제약과 생성 경로는 같은 PR) |
| 분류 함수 시나리오 | 12개(참여자 수·키워드·`flags`) → **7개**(유형+참여 방식) |
| 제약 | NOT NULL/CHECK 는 M6 → **처음부터 즉시 유효**(템플릿 예외) |
| 롤백 총칙 | 코드 revert 뿐, 구 코드 호환 증명 → **forward-fix 우선, 빈 환경 승인 하 `downgrade` 허용**, 구 호환 포기 |
| 계약 골든(G7·CP-11) | 구 앱 호환 → **프론트 무변경 회귀망**으로 사유 재정의, 가산 전용 규칙은 유지 |
| 읽기 API | 회원 시점 "내담자인 관계" → **참여 세션 기준**(Phase 1 은 보관용 관계만), `origin`/`flags` 마스킹은 컬럼이 없으면 소멸 |
| 사용자 결정 | U1 소멸 · U3 소멸 · U4 단순화 · **U2·U5 유지** |
| 수동 게이트 | 8개 → **7개** |
