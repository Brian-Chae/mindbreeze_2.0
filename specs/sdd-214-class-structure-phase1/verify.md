# SDD-214 Verify — 구현 전 QA 체크리스트 (Stage ③, 구현 전 게이트)

> **구현 후 완화 금지.** 이 문서는 구현 시작 전에 확정한다. 구현 중·후에 항목을 삭제·완화·예외 추가하지 않는다. 기준에 못 미치면 기준을 고치지 말고 구현을 고치거나, **선택지와 비용을 제시해 Brian 승인을 받은 뒤** 하단 `변경 이력`에 사유와 함께 반영한다. 사후 작성 금지(`CLAUDE.md` 7-Stage SDD).
> 근거: `spec.md` · `plan.md`(TD1~TD25, Task, §10 마이그레이션 안전, §12 게이트) · `docs/class-session-restructure/{기획,영향도}.md` · SDD-211 verify 형식.
> 표기: 모든 확인 항목은 `[ ]` 체크박스. 판정 코드: **U**=단위 **B**=백엔드 pytest(SQLite) **P**=PG 테스트(`backend-pg-smoke`) **F**=프론트 vitest **C**=CI 잡 **E**=dev E2E **M**=수동(Brian 입회·승인) **S**=정적 검사(grep·diff·스크립트) **Q**=운영 DB 읽기 전용 조회.
> **결정 전제 (추천안 기준)**: **U1** 분류 규칙 승인 · **U2** `users` 변경 제외 · **U3** dev 완주 후 prod · **U4** 모호/배치 불명 건은 표시·보고만(호스트 질문 UI·재배치는 후속) · **U5** 시안 승인 병행. 답이 달라지면 구현 **전에** 해당 행을 개정하고 `변경 이력` 에 기록한다.
> 미확인(plan §14) 중 **G0·G1·P0·S0 단계에서 해소할 것**은 해소 결과를 `baseline.md`·`schema-contract.md` 에 기록하고, 그 결과로 기준이 바뀌면 변경 이력에 사유를 남긴다.

## 0. 검증 층과 실행 명령

| 층 | 이름 | 실행 | 대상 |
|---|---|---|---|
| V-B | 백엔드(SQLite 단위) | `cd backend && pytest -q --tb=short --ignore=tests/test_sprint4_integration.py --deselect=tests/test_sdd070_pdf_metrics.py::test_real_pdf_metric_pages` (CI 와 동일 제외) | CL·RD·CP·PV 일부 + 기존 전체 |
| V-P | 백엔드(PostgreSQL) | `cd backend && pytest --confcutdir=tests/pg tests/pg -m pg` (로컬 PG16 필요) | SC·MG·BF·CN·RB — **제약·마이그레이션의 1차 증거**(SQLite 는 FK 가 꺼져 있어 위반을 못 잡는다, X16) |
| V-F | 프론트 | `cd frontend && npx vitest run` | FE |
| V-S | 정적 | `npx tsc -p tsconfig.app.json --noEmit` · `npx eslint src/` · `npm run build` · `cd backend && alembic heads` · `python deploy/ci/check_migrations.py --base-sha <SHA> --out <json>` · `git diff --name-only` · grep | G·MG·FE |
| V-C | CI | `ci-feature.yml`(frontend·backend·**backend-pg-smoke**) | 전 항목 합산 |
| V-E | dev E2E | `e2e-smoke.yml` — 배포 후 자동 | DL |
| V-M | 수동 | Brian 승인·입회 | 스냅샷·dry-run 보고·apply·prod |

- 프론트 CI `Test` 단계가 비차단이면 합격 판정은 로컬/CI 로그에서 파일별 pass 를 직접 확인한다(SDD-211 G2 와 동일).
- 기준선: Task **G0** 가 구현 전 `baseline.md` 에 pytest/vitest/tsc/eslint 통과·실패 목록과 SDD-211 계약 골든 현황을 기록한다. "신규 실패 0" 은 이 기록 대비다.

---

## 1. 공통 합격 기준 (모든 Task)

| 확인 | ID | 기준 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | G1 | **백엔드 신규 실패 0**: G0 기준선 외 실패 없음. 기존 테스트 파일 수정은 §4 개정표 범위뿐 | B·S | 신규 실패 0 |
| [ ] | G2 | **프론트 신규 실패 0**: 통과하던 파일 모두 통과, 신규 파일 전부 통과(로그로 확인) | F | 신규 실패 0 |
| [ ] | G3 | `tsc -p tsconfig.app.json` 0 · `eslint src/` 0 · `npm run build` 성공 | S | 0 |
| [ ] | G4 | **기존 테이블 변경은 `ADD COLUMN` 뿐**: `sessions`·`session_participants`·`reports` 에 대한 마이그레이션 문장 중 컬럼 추가·인덱스·단순 FK 외 0건. 기존 컬럼 삭제·개명·타입 변경·NOT NULL 승격·기본값 변경 0 | S | 충족 |
| [ ] | G5 | **변경 최소화**: `git diff --name-only <기준 SHA>..HEAD` 가 plan §9 소유 파일 + 신규 테스트·골든·픽스처 + `specs/sdd-214-…/` 안에만 있다. 엔진(진행·입장·뇌파·녹음/STT/요약·리포트 *생성*) 파일 수정 0, `report_service.py` 승인 경로 수정 0(TD13), `models/user.py`·`users` 마이그레이션 0(U2) | S | 범위 밖 파일 0 |
| [ ] | G6 | **사용자 노출 문구 변경 0**: 서버·프론트 사용자 노출 문구 리터럴 diff 0 (에러 `detail` 포함). 읽기 API 신규 에러 문구는 기존 세션 API 와 같은 문구 재사용 | S | 변경 0 |
| [ ] | G7 | **안전망 불변**: SDD-211 계약 골든(`tests/contract/golden/*`)·특성화 테스트는 **구현 커밋에서 수정 0**(예외: 가산 필드로 인한 갱신이 불가피하면 `breaking_exemptions.json` 절차, 변경 이력에 기록) | S | 수정 0 또는 승인된 예외 |
| [ ] | G8 | `any` 사용 0(신규·수정 TS), 객체·배열 직접 변경 0, 주석은 한글·WHY 만, 파일명 kebab-case/snake_case | S | 0 |
| [ ] | G9 | **비밀·개인정보 0**: 신규·수정 파일(보고서·픽스처·로그 샘플 포함)에 이메일(`@example.com` 제외)·전화·UUID 실값·토큰·DB 접속 문자열·IP·라벨 원문 0건 | S | grep 0건 |
| [ ] | G10 | PR 마다 CI 3잡(frontend·backend·backend-pg-smoke) GREEN, 머지 후 dev 자동 배포 성공 + `e2e-smoke` 통과 | C·E | 충족 |
| [ ] | G11 | **PR 별 범위 일치**: PR-A 에는 053~056·모델·분류 함수·백필 도구·스위프 확장만, PR-B 에는 057 만, PR-C 에는 읽기 API·호환 처리·알림 가산·`SessionDto` 만(plan §9·§12). 동작 변화는 PR-C 에서만 | S | 일치 |
| [ ] | G12 | **사용자 체감 변화 0**: 프론트 화면 파일(`pages/`·`components/`) 수정 0 — `lib/api/session.ts` 타입 가산 외 | S | 0 |

---

## 2. 트랙별 시나리오

### 2.1 스키마 M1 (S 트랙) — SC

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | SC-1 | `schema-contract.md`(S0)의 테이블 11개 컬럼·타입·NULL·기본값·FK·인덱스가 마이그레이션·모델과 **1:1 일치**(자동 대조 테스트: 카탈로그 vs 확정표 파싱) | P·S | 불일치 0 |
| [ ] | SC-2 | 신규 테이블 11개 이름이 `spec.md` 와 일치, `class_templates` 는 **없음**(M6) | P | 11개 |
| [ ] | SC-3 | `sessions` 에 정확히 5개 컬럼 추가(`class_id`·`counseling_relationship_id`·`seq`·`session_kind`·`host_state`), `session_participants` 에 7개(`member_id`·`guest_client_id`·`attendance_status`·`attendance_kind`·`makeup_for_session_id`·`attendance_marked_by`·`absence_reason`), `reports` 에 2개. 전부 NULL 허용(`session_kind` 는 기본값 `'regular'` 추가) | P | 일치 |
| [ ] | SC-4 | 기존 컬럼의 타입·NULL·기본값이 마이그레이션 전/후 **동일**(카탈로그 diff 가 추가 항목만) | P | 변경 0 |
| [ ] | SC-5 | 모든 부모 FK 가 `ON DELETE RESTRICT`, `reports.approved_by_user_id` 는 NO ACTION (`pg_constraint.confdeltype`) | P | 일치 |
| [ ] | SC-6 | 부분 유니크 `uq_classes_active_access_code`: 활성(숨김·종료·취소 제외) 클래스 간 코드 중복 INSERT 는 실패, 종료/숨김 클래스와 같은 코드는 허용 | P | 규칙대로 |
| [ ] | SC-7 | `class_instructors UNIQUE(class_id, user_id)` 위반 INSERT 실패 (복합 FK 의 참조 대상) | P | 실패 확인 |
| [ ] | SC-8 | `counseling_relationships`: `uq_rel_guest`(비회원 1명 1관계)·`uq_rel_placeholder`(상담사당 보관용 1개) 위반 INSERT 실패 | P | 실패 확인 |
| [ ] | SC-9 | 클래스·관계·강사·멤버·상담사 이력에 대한 `hidden_at`/soft 상태 컬럼 존재(삭제 금지 정책의 전제): `class_instructors.status`, `classes.hidden_at`, `counseling_relationships.hidden_at` | P | 존재 |
| [ ] | SC-10 | ORM 모델이 DB 와 일치: `alembic check`(정보성) 에서 **이 SDD 가 추가한 객체**에 대한 차이 0 | S | 신규 차이 0 |
| [ ] | SC-11 | ORM 전역 숨김 필터: `Class`·`CounselingRelationship` 의 숨김 행이 기본 조회에서 제외, `include_hidden` 옵션으로 포함 (기존 `Session` 필터 동작 불변) | B | 통과 |
| [ ] | SC-12 | 순환 FK 순서(053 → 056): 빈 DB 체인과 덤프 복원본 양쪽에서 `upgrade head` 오류 0 | P | 통과 |
| [ ] | SC-13 | 컬럼 확정표 근거 표기: 모든 컬럼 행에 근거 문서(§) 열 존재, `미확인` 이 남은 컬럼은 0 또는 사유와 함께 Brian 보고 | S | 충족 |

### 2.2 마이그레이션 안전 (멱등 · 데이터 보존 · 롤백 · 구 코드 호환) — MG

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | MG-1 | **단일 head**: `alembic heads` 가 PR-A 에서 `…056`, PR-B 에서 `…057` 1개. `down_revision` 체인이 `…052` → 053 → 054 → 055 → 056 → 057 | S | 충족 |
| [ ] | MG-2 | 빈 DB 에 `alembic upgrade head` 성공 (체인 전체) | P | 성공 |
| [ ] | MG-3 | SDD-211 덤프 픽스처(`baseline_e036a0000051.sql`) 복원 후 `upgrade head` 성공 (051 → 052 → 053 …) | P | 성공 |
| [ ] | MG-4 | **멱등**: `upgrade head` → `downgrade` 한 단계씩 → `upgrade head` 재실행 후 스키마가 동일(카탈로그 diff 0). 또한 "일부 객체가 이미 존재하는 상태"(예: 054 의 테이블 하나를 미리 생성)에서 `upgrade` 가 오류 없이 완료 | P | diff 0, 오류 0 |
| [ ] | MG-5 | **파괴적 게이트**: `check_migrations.py` 를 053~057 각각에 실행 → `destructive=false`, `warnings=[]`. 057 의 `VALIDATE CONSTRAINT`·`ADD CONSTRAINT` 가 파괴적으로 분류되지 않음(plan §14-14) | S | 전부 false |
| [ ] | MG-6 | **데이터 보존(M1)**: 마이그레이션 전 합성 시드(세션·참여자·리포트 N건)를 넣고 `upgrade head` 후 기존 3개 테이블의 기존 컬럼 해시·행 수 **동일** | P | 동일 |
| [ ] | MG-7 | **구 코드 호환(핵심)**: 새 스키마에서 **새 컬럼을 모르는 INSERT**(구 모델 모양: `sessions`·`session_participants`·`reports`)가 성공하고 새 컬럼은 NULL(`session_kind` 는 `'regular'`) | P | 성공 |
| [ ] | MG-8 | **구 코드 호환(앱 레벨)**: PR-A 상태(마이그레이션만 적용, 호환 처리 미배선)에서 기존 pytest 전체와 SDD-211 계약 골든 61 라우트·형태 17 시나리오 통과 | B | 신규 실패 0 |
| [ ] | MG-9 | 모든 리비전 첫 문장이 `SET LOCAL lock_timeout`, 모든 DDL 이 존재 검사 또는 `IF NOT EXISTS` (정적 검사) | S | 충족 |
| [ ] | MG-10 | `downgrade()` 의 docstring 경고("운영 롤백 사용 금지, M2 이후 데이터 소실")와 신규 테이블 의존 역순 DROP(`IF EXISTS`) 존재. downgrade 가 **기존 테이블 컬럼만** 삭제하고 기존 데이터를 건드리지 않음 | S·P | 충족 |
| [ ] | MG-11 | 마이그레이션 PR 본문에 **롤백 설계(plan §10.3 표 인용)** 와 `check_migrations` 결과 첨부 | S | 첨부 |
| [ ] | MG-12 | 롤백 트랩 시뮬레이션 문서화: "코드 revert 후 DB 는 `…056`, `backend/alembic` 에는 리비전 없음 → 새 코드 재배포 전 수동 alembic 금지" 가 PR-A 본문과 summary 에 기재 | S | 기재 |
| [ ] | MG-13 | 인덱스: 새 컬럼 FK 인덱스(`sessions.class_id`·`counseling_relationship_id`, 부모 FK 컬럼)가 일반 `CREATE INDEX`, `IF NOT EXISTS` | P | 존재 |

### 2.3 분류 함수 (C 트랙) — CL

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | CL-1 | 템플릿(`is_template=true`) → 이전 안 함(`T0`) | U | 통과 |
| [ ] | CL-2 | `meditation` → 명상 클래스 `C1` (참여자 수 0/1/다수, group/1:1 무관) | U | 통과 |
| [ ] | CL-3 | `clinical`·`hypnosis` + 활성 참여자 2명 이상 → 클래스 `C3` + `type_mismatch` | U | 통과 |
| [ ] | CL-4 | 〃 + 활성 1명(회원) → 상담 관계 `R1`. 참여 방식이 group 이면 `group_vs_count_disagree` 추가 (M0 의 갈림 1건 재현) | U | 통과 |
| [ ] | CL-5 | 〃 + 활성 1명(비회원) → `R2` | U | 통과 |
| [ ] | CL-6 | 〃 + 활성 0명 → `R3` + `placeholder` | U | 통과 |
| [ ] | CL-7 | `custom` + (group 또는 활성 ≥2) → 클래스 `C2`; 그 외 → 상담 `R1`~`R3` | U | 통과 |
| [ ] | CL-8 | `custom_type_name` 키워드(명상류 vs 상담류)가 구조 결과와 충돌하면 `needs_host_confirm`, **분류 결과는 구조 규칙대로 불변** (plan §4.1 해석) | U | 통과 |
| [ ] | CL-9 | 경계: 정원 10 인 1:1 상담 → 정원으로 그룹 판정하지 않음(상담 `R1`~) / 호스트만 있는 세션 / 제거·대기·대기취소 참여자만 있는 세션은 활성 0명 취급 | U | 통과 |
| [ ] | CL-10 | 알 수 없는 `type` → `X0`(분류 불가), 예외를 던지지 않고 결과로 반환 | U | 통과 |
| [ ] | CL-11 | **순수성**: 같은 입력 → 같은 출력, 함수 모듈이 DB 세션·시계·난수·환경변수를 import 하지 않음(정적 검사) | U·S | 통과 |
| [ ] | CL-12 | 규칙표 전수: plan §4.1 의 모든 행(T0, C1, C3, R1, R2, R3, C2, X0)이 최소 1개 테스트로 커버 | U | 커버리지 100% (규칙 코드 기준) |

### 2.4 백필 M2 (B 트랙) — BF

PG 합성 시드로 검증한다. 시드: 명상(완료·취소·예정·진행 중·**숨김**·비회원 참여자·제거/대기/대기취소 참여자·`pii_scrubbed_at` 있는 비회원·코드 보유), 템플릿 1, 임상(활성 0/1회원/1비회원/2명, 같은 쌍 다중 세션), 최면 1, custom(그룹/1:1), `client_counselor_links` 있는 쌍(상태 active/ended).

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | BF-1 | **dry-run 은 쓰기 0**: 실행 전/후 전 테이블 행 수·체크섬 동일, 출력에 규칙별·flags별 건수와 제약 사전 검출(코드 중복·쌍 유일성·`seq` 중복 예상)만 있음 | P | 변경 0 |
| [ ] | BF-2 | **기본 모드가 dry-run**: 인자 없이 실행하면 쓰기 안 함, `--apply` 만 쓴다 | U·P | 통과 |
| [ ] | BF-3 | 규칙별 결과: 시드의 모든 비템플릿 세션이 `session_migration_map` 에 정확히 1행씩, 규칙 코드가 분류 함수 결과와 일치 | P | 일치 |
| [ ] | BF-4 | **멱등**: apply 2회차는 변경 0(새 행 0, 갱신 0) — 행 수·체크섬 동일 | P | 동일 |
| [ ] | BF-5 | **숨김·취소·테스트 세션도 이전**(삭제 안 함): ORM 필터 우회 경로(원시 SQL)로 숨김 세션이 부모를 받고 클래스에 `hidden_at` 이 복사됨 | P | 통과 |
| [ ] | BF-6 | 템플릿 세션은 이전 안 함, `map` 에 없음, 부모 NULL | P | 통과 |
| [ ] | BF-7 | 명상: 세션당 클래스 1 + `class_instructors(host_id,'lead','active')` 1 + 세션 `seq=1`·`host_state='assigned'`·`session_kind='regular'`. 클래스 `schedule_mode='fixed'`, `planned_session_count=1`, `origin='migrated'`, 상태 매핑(completed→completed, cancelled→cancelled, 그 외 active) | P | 통과 |
| [ ] | BF-8 | 클래스 설정 복사 대조(V9): 제목·`notes`→`description`·정원·참여 방식·LINK BAND 모드·장소·소요·녹음/채팅/SFU·알림 오프셋·코드 모두 세션 값과 동일 | P | 불일치 0 |
| [ ] | BF-9 | **코드 동일(V8)**: 클래스 `access_code`·`legacy_access_code` == 세션 값, 활성 클래스 간 코드 중복 0 | P | 0 |
| [ ] | BF-10 | 참여자 → 멤버십·출석 매핑: `removed_at`→`removed`/`withdrawn`, `waitlist_cancelled_at`→`left`/`withdrawn`, `is_waitlisted`→`waitlisted`/`expected`, `entered_at` 있음→`attended`(세션 completed 면 멤버십 `completed`), **입장 정보 없음→`expected` (`absent` 단정 금지)** | P | 통과 |
| [ ] | BF-11 | 상담 회원 쌍 묶기: 같은 `(호스트, 회원)` 의 세션이 한 관계, `seq` 가 `coalesce(scheduled_at, started_at, created_at)`·`created_at`·`id` 순으로 1..N | P | 통과 |
| [ ] | BF-12 | 상담 비회원: 세션당 `counseling_guests` 1행 + 관계 1행. 참여자 개인정보(이름·이메일·성별·생년월일)가 복사되고 `email_verified_at` NULL, `origin='migrated'`, **원본의 `pii_scrubbed_at` 복사**(스크럽된 행은 복제본도 스크럽 상태) | P | 통과 |
| [ ] | BF-13 | 상담 활성 0명 → 상담사당 보관용 관계 1개(`is_placeholder`), 삭제 금지 플래그 `placeholder` | P | 통과 |
| [ ] | BF-14 | **링크 자동 생성 0 (X16)**: 이전 전/후 `client_counselor_links` 행 수·내용 동일. 링크가 있으면 `link_id` 만 연결, `ended` 링크의 쌍은 관계 `closed`(단, 활성 세션이 있으면 `active` 유지, X11) | P | 통과 |
| [ ] | BF-15 | 이메일 정규화: 비회원 `email_norm` 이 가입 이메일 정규화 함수와 **같은 구현**의 결과 (SQL 근사 아님) — 대소문자·공백 케이스 | P | 일치 |
| [ ] | BF-16 | **기존 컬럼 불변(V15)**: `sessions`·`session_participants`·`reports` 의 기존 컬럼 해시 이전/후 동일. 쓰기 대상은 화이트리스트(새 컬럼·새 테이블)뿐 — 쓰기 SQL 정적 검사 + 런타임 검사 | P·S | 동일 |
| [ ] | BF-17 | **id 불변**: 세션 id·참여자 id 집합 이전/후 동일 (V16: 세션 id FK 13개 + 값 보관 6개 참조 행 수 동일) | P | 동일 |
| [ ] | BF-18 | **분류 불가 시 중단**: `X0` 가 있으면 보고 후 apply 거부(쓰기 0) | P | 통과 |
| [ ] | BF-19 | **트랜잭션 원자성**: 처리 중간에 의도적 실패(주입)를 일으키면 전체 롤백, 부분 이전 0 | P | 통과 |
| [ ] | BF-20 | **가드**: `open`/`in_progress` 세션이 있으면 `--allow-live-sessions` 없이는 apply 거부. 락 대기 시간 초과(`lock_timeout`) 시 실패하고 부분 쓰기 0 | P | 통과 |
| [ ] | BF-21 | 사후 검증이 같은 트랜잭션 안에서 실행되고, 위반 심은 시드(고아 부모·`seq` 중복·호스트가 강사 행 없음)에서 **커밋 전 롤백** | P | 통과 |
| [ ] | BF-22 | **스트레이 정리(재실행)**: apply 후 부모 없는 세션을 추가(구 코드 모양 INSERT)하고 재실행 → 같은 분류로 부모를 받고 상담은 기존 활성 관계를 재사용해 `seq` 이어 부여, 기존 `map` 행 불변 | P | 통과 |
| [ ] | BF-23 | **출력·로그에 개인정보 0**: 이름·이메일·UUID·라벨 원문·코드 값이 stdout/로그/보고서에 없음 (합계·분포·규칙 코드만) | U·S | 0건 |
| [ ] | BF-24 | **검증 쿼리 V1~V19 모듈**: 각 쿼리에 대해 위반을 심은 시드에서 검출됨(최소 V2·V3·V4·V5·V6·V7·V8·V10·V12·V13·V15·V16), 정상 시드에서 통과. 전부 읽기 전용(쓰기 문장 0) | P·S | 통과 |
| [ ] | BF-25 | 이벤트 미생성(TD12): 백필이 `class_member_events`·`counseling_relationship_events` 행을 만들지 않음 | P | 0행 |
| [ ] | BF-26 | **역방향 SQL 리허설(B6)**: 합성 DB 에서 apply → 역방향 실행 → 새 컬럼 NULL 복원·신규 부모/보조 행 삭제 후 기존 컬럼 해시 동일. 이 SQL 은 PR-C 배포 전 상태에서만 안전하다는 경고가 절차서에 명시 | P·S | 통과 |

### 2.5 제약 M3 (K 트랙) — CN

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | CN-1 | 백필된 시드에서 057 적용 성공: 복합 FK 2개 `NOT VALID` → `VALIDATE` 통과 | P | 성공 |
| [ ] | CN-2 | **복합 FK 위반**: 호스트가 해당 클래스의 `class_instructors` 행이 아닌 세션 INSERT/UPDATE 는 PG 에서 실패. 상담도 동일(`counseling_relationship_counselors`) | P | 실패 확인 |
| [ ] | CN-3 | **`class_id IS NULL` 행은 검사하지 않음**: 구 코드 모양 INSERT(부모 NULL)가 057 적용 후에도 성공 | P | 성공 |
| [ ] | CN-4 | `UNIQUE(class_id, seq)`·`UNIQUE(counseling_relationship_id, seq)`: 중복 `seq` 실패, `seq` NULL 다수 허용 | P | 규칙대로 |
| [ ] | CN-5 | `UNIQUE(session_id, member_id)`: 같은 회차·멤버 출석 행 중복 실패, `member_id` NULL 다수 허용 | P | 규칙대로 |
| [ ] | CN-6 | `CHECK(member_id IS NULL OR guest_client_id IS NULL)`: 둘 다 채우면 실패, 둘 다 NULL(구 코드)은 통과 | P | 규칙대로 |
| [ ] | CN-7 | `uq_rel_active_pair`: 같은 상담사·회원의 활성 관계 2개는 실패, 종결(`closed`)/보관 관계와는 공존 | P | 규칙대로 |
| [ ] | CN-8 | 057 이 **백필 전 상태(위반 데이터 존재)** 에서는 `VALIDATE` 단계에서 실패하고 원인 행 수가 보고됨(M2 선행 조건 검증). 057 의 사전 점검 질의(V11)가 위반 0 을 확인한 뒤에만 적용 | P | 통과 |
| [ ] | CN-9 | 057 후 기존 pytest(SQLite)·계약 골든 신규 실패 0 | B | 0 |

### 2.6 읽기 API (R 트랙) — RD

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | RD-1 | 5개 엔드포인트 존재·응답 모델: `GET /classes`·`/classes/{id}`·`/classes/{id}/sessions`·`/counseling`·`/counseling/{id}`. OpenAPI 에 등록 | B | 5/5 |
| [ ] | RD-2 | **동치성**: 역할 5종(호스트 상담사·타 상담사·센터 관리자·플랫폼 관리자·참여 회원, 무관한 회원 포함) × 시드에서, 새 API 로 도달 가능한 세션 집합의 합 == 같은 사용자의 `GET /sessions` 목록 집합 (넓히지도 좁히지도 않음) | B | 불일치 0 |
| [ ] | RD-3 | 타 호스트의 클래스/관계 id 접근 → 현행 세션 상세와 **같은 상태코드·메시지**(존재 여부 비노출) | B | 일치 |
| [ ] | RD-4 | 숨김 클래스·숨김 세션은 목록·상세·회차 목록에서 제외 | B | 통과 |
| [ ] | RD-5 | 제거/대기취소 참여자는 회원 시점에서 제외, 이탈(`left`/`removed`) 멤버십 정책은 Phase 4 이므로 이 SDD 는 백필값(`removed`/`left`) 노출만 확인 | B | 통과 |
| [ ] | RD-6 | **회원 시점 마스킹**: 타 참여자 정보·`origin`·`flags`·코드·`organization_attribution_known` 가 응답에 없음. 호스트 시점에만 포함 | B | 통과 |
| [ ] | RD-7 | **본문 비노출**: 어떤 응답에도 EEG·녹음·영상·전사·리포트 본문·상담사 메모가 없음 (응답 필드 화이트리스트 테스트). 상담 상세는 기록·리포트 **진행 상태 값**만 | B | 0 |
| [ ] | RD-8 | **센터 관리자**: 상담 관계 응답은 메타(상담사·내담자 표시·회차 수·상태)만, 본문 없음. 현행 `GET /sessions` 가시 범위를 넘지 않음 (D-28 은 Phase 3) | B | 통과 |
| [ ] | RD-9 | 목록 페이지네이션·`status` 필터, 빈 목록, 존재하지 않는 id | B | 통과 |
| [ ] | RD-10 | 진행률/다음 세션 계산: 취소 회차는 분모에서 제외·계획 횟수 없을 때 가시 회차 기준, 다음 세션은 `scheduled_at` 이 가장 가까운 미래 비취소 회차 (경계: 회차 0개, 전부 완료) | B | 통과 |
| [ ] | RD-11 | 상담 응답의 내담자 표시: 회원 이름 / 비회원 표시명 / 보관용 관계는 고정 라벨. 스크럽된 비회원은 이름이 응답에 없음 | B | 통과 |
| [ ] | RD-12 | **성능**: dev 규모 시드(클래스 200·회차 300)에서 목록 응답 200ms 이내 목표, 질의 수가 항목 수에 비례하지 않음(N+1 없음, 쿼리 카운터 단언) | B·E | 통과 |
| [ ] | RD-13 | **라우트 접두사**: `/class`(기존 `class_audio`) 라우트 집합 불변, `/classes`·`/counseling` 과 충돌 0 (라우트 목록 대조) | B | 불변 |
| [ ] | RD-14 | **접근 로깅**: 읽기 API 가 현행 세션 읽기와 같은 방식의 접근 기록(있다면)을 남김. 현행 방식 확인 결과를 `baseline.md` 에 기록 (plan §14-9) | B·S | 일치 |
| [ ] | RD-15 | 인증 없는 호출 401, 잘못된 역할 403 — 기존 의존성(`get_current_user` 등) 재사용 | B | 통과 |
| [ ] | RD-16 | 응답 직렬화에 **Pydantic v2 `model_validate`/`from_attributes`** 사용, 응답에서 UUID/날짜 형식이 기존 세션 API 와 동일 | B | 일치 |

### 2.7 호환 (P 트랙) — CP

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | CP-1 | `POST /sessions` (meditation) → 세션 + 클래스(`origin='shim'`) + `class_instructors(lead)` + `seq=1`·`host_state='assigned'` 가 **한 트랜잭션**에 생성. 응답은 기존 필드 + 가산 필드 | B·P | 통과 |
| [ ] | CP-2 | `POST /sessions` (clinical/hypnosis) → 호스트별 보관용 관계에 배치 + `flags` 에 `no_client_yet`, `seq` 이어 부여 (TD19) | B·P | 통과 |
| [ ] | CP-3 | 생성 중 부모 생성 실패 시 세션도 생성되지 않음(원자성) | B·P | 통과 |
| [ ] | CP-4 | **같은 분류 함수**: 호환 처리와 백필이 동일 입력에서 동일 규칙 코드 (파라미터화 테스트 공유) | B | 일치 |
| [ ] | CP-5 | `duplicate`·`new-run`·템플릿 적용 경로의 산출물도 부모를 가진다(P0 전수 결과 기준), 템플릿 저장(`save-as-template`)은 부모 없음 | B | 통과 |
| [ ] | CP-6 | **세션 생성 지점 전수**: `Session(` 생성 지점 목록(P0)의 모든 지점이 호환 처리를 거치거나 템플릿 사유로 제외됨 — 누락 0 (정적 검사 + 경로별 테스트) | S·B | 누락 0 |
| [ ] | CP-7 | **코드 입장 해석**: ① 활성 클래스 코드로 입장 → 현재 입장 가능 회차 ② 클래스 없는 구 세션 코드 폴백 ③ 입장 불가(종료·숨김·없음)는 사유 비구분 **동일 404**, 응답 본문·지연 구분 없음 ④ 로그에 코드 마스킹 유지 | B | 통과 |
| [ ] | CP-8 | 코드 읽는 파일 8개(plan §6 P2) 각각에 "세션 값 없으면 클래스 값" 폴백 — 파일별 테스트(리마인더 메일, 대시보드, 이메일 초대, 센터 공개 페이지, 코드 재발급 등)에서 클래스 코드만 있는 세션이 정상 동작 | B | 8/8 |
| [ ] | CP-9 | **코드 발급**: 신규 발급 시 세션·클래스 두 테이블의 활성 코드 합집합에서 중복 회피 (충돌 시 재시도) | B | 통과 |
| [ ] | CP-10 | 구 앱 쓰기 동기화: `PUT /sessions/{id}` 로 클래스 단위 필드 수정 시 `origin ∈ {migrated, shim}` + 가시 세션 1개인 클래스에만 반영, 세션 ≥2 클래스·`origin='created'` 클래스는 세션만 수정 | B | 통과 |
| [ ] | CP-11 | 클래스의 **마지막 가시 세션**을 `DELETE`(숨김)하면 클래스도 `hidden_at`, 가시 세션이 남으면 클래스 유지 | B | 통과 |
| [ ] | CP-12 | 알림 `params`: `class_id`·`seq`(상담은 관계 id) 가산, `target_type='session'`·`target_id`·레거시 `session_id` 불변. 알림 영속 행 수 이전 전/후 동일(V17) | B | 통과 |
| [ ] | CP-13 | **링크 자동 생성 0**: 호환 처리 경로 어디서도 `client_counselor_links` INSERT 0 (정적 검사 + 테스트) | S·B | 0 |
| [ ] | CP-14 | 레거시 호출 계측: 호환 처리·코드 폴백 호출이 구조화 로그 1줄(경로·건수만)로 남고 개인정보·코드값 0 | B·S | 통과 |
| [ ] | CP-15 | **구 계약 회귀**: SDD-211 계약 골든(61 라우트 가산 전용 + 형태 17 시나리오)이 PR-C 에서 통과. 가산 필드 외 응답 변경 0 | B | 통과 |
| [ ] | CP-16 | WS 룸 이름(`session:{sid}`)·세션 id·참여자 id·입장 자격 JWT(`class_entry`)·리포트 토큰의 클레임/키가 불변 — 발급분이 PR-C 전/후 모두 유효 | B | 통과 |

### 2.8 개인정보·보관 (PV)

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | PV-1 | **스위프 확장**: `retention_sweep_service` 가 `class_members`(비회원 개인정보)·`counseling_guests` 를 후보에 포함 — 원본 세션 참여자와 복제본 중 한쪽만 스크럽된 경우를 **검출해 보고**(수정 안 함) | B·P | 통과 |
| [ ] | PV-2 | 스위프 기본값 불변: `RETENTION_SWEEP_ENABLED=false` 면 항상 dry-run(삭제 0), 설정 변경 코드 0 | B·S | 불변 |
| [ ] | PV-3 | 스크럽 후에도 클래스/관계/세션/리포트 행 유지(X14), 스크럽된 비회원 행에서 이름·이메일이 NULL | P | 통과 |
| [ ] | PV-4 | 백필이 **새 수집·목적 변경 없이 동일 목적 범위의 복제**임을 summary 에 기록, 이의 시 Brian 보고 (spec C4) | S | 기록 |
| [ ] | PV-5 | EEG 접근 규칙 불변: 읽기 API 가 EEG 테이블을 조회하지 않음(정적 검사), 본인 세션 + 담당 상담사 규칙 변경 0 | S | 0 |
| [ ] | PV-6 | M2 보고서·PR 본문·로그·`specs/` 문서에 센터·사람 단위 상세 표/라벨 원문 0 (U5=A 정책 유지, 합계·분포만) | S | 0 |
| [ ] | PV-7 | dev 수동 스냅샷(비암호화) 보관 기간·삭제 승인 절차 기록(SDD-211 U7 선례: 호환 윈도우 종료 + Brian 삭제 승인), 스냅샷 공유 속성 0 | M·Q | 기록 |
| [ ] | PV-8 | 감사: 읽기 API 가 기존 감사 로깅 요건(모든 데이터 접근 로깅, 6개월) 대상에 해당하는지 확인 결과 기록 (RD-14 와 연동) | S | 기록 |

### 2.9 프론트 — FE

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | FE-1 | `SessionDto` 에 `class_id?`·`class_title?`·`seq?`·`area?` **선택 필드**만 추가, 기존 필드 변경 0 | S | 충족 |
| [ ] | FE-2 | 가산 필드가 없는 구 응답 fixture(기존 vitest)로 타입·렌더 회귀 0 | F | 신규 실패 0 |
| [ ] | FE-3 | 화면·라우트·문구 변경 0 (G12), Phase 2 용 새 API 클라이언트는 만들지 않음 | S | 0 |

### 2.10 시안(Phase 2) 연결 — DS

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | DS-1 | plan §11 매핑표의 "제공" 행 모두가 실제 API 응답 필드로 존재(필드명 대조 테스트 또는 수동 체크), "후속" 행은 **데이터 없음 처리 필요**로 summary 에 인계 목록화 | S·M | 누락 0 |
| [ ] | DS-2 | 시안 3종(`host-classes`·`member-classes`·`counseling`)의 읽기 요구 필드 중 Phase 1 이 줄 수 없는 것 목록을 Brian 에게 전달 (U5 병행 승인 근거) | M | 전달 |
| [ ] | DS-3 | 시안 금지 규칙과 데이터 충돌 없음: API 응답에 점수·순위·종합점수·강사 평가 필드 0 | S | 0 |

### 2.11 배포·운영 — DL

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | DL-1 | **배포 순서 준수**: PR-A 머지 → (M2) → PR-B → PR-C → 재백필. 순서가 어긋나면 중단 (조정자 체크리스트) | M | 준수 |
| [ ] | DL-2 | PR-A 배포 후 dev: `alembic_version=…056`, 신규 테이블 11개·가산 컬럼 존재, 헬스체크·`e2e-smoke` 통과, 사용자 동작 변화 0 | Q·E | 통과 |
| [ ] | DL-3 | **M2 사전 스냅샷**(RDS 수동, 이름·시각·암호화 여부·공유 0 기록) 후에만 apply. 스냅샷 없이 apply 거부(절차) | M | 기록 |
| [ ] | DL-4 | **dry-run 보고(합계·분포만)** 를 Brian 에게 전달하고 **U1 승인** 후에만 apply (Q: 읽기 전용 조회, 사람·센터 단위 상세는 비커밋 U5=A) | M | 승인 기록 |
| [ ] | DL-5 | 이전 건수 대조(dev, 구현 직전 재측정 기준): 이전 전 비템플릿 세션 합 == 이전 후 `map` 행 수 == 부모별 합 (type 별·규칙별), 참여자 수 대조 일치. 참고값: M0(2026-10-18) 비템플릿 177 = 명상 171 + 임상 6, 템플릿 1 | Q | 일치 |
| [ ] | DL-6 | apply 후 V1~V19 보고 전부 통과(V19 는 보고 항목), **스트레이 세션 0**(V2) | Q | 0 |
| [ ] | DL-7 | PR-B 배포 후 `VALIDATE` 완료, 복합 FK·유니크 `convalidated=true`, `e2e-smoke` 통과 | Q·E | 통과 |
| [ ] | DL-8 | PR-C 배포 직후 **재백필 실행 → 스트레이 0**, 구 앱 회귀(계약 골든) 통과, 레거시 호출 로그 확인 | Q·E | 통과 |
| [ ] | DL-9 | M5 일일 점검 질의(스트레이 V2, 보관용 관계 안 활성 참여자 세션 수, 레거시 호출 건수) 정의·실행 방법이 `summary.md` 에 기록 | S | 기록 |
| [ ] | DL-10 | MANIFEST/릴리스 요약: PR-A/B/C 포함 릴리스 후보 빌드가 `destructive_migrations=false` (prod 릴리스 전) — 052 의 `UPDATE` 로 인한 사전 영향(plan §10.5)을 빌드 요약으로 확인하고 `confirm_destructive` 필요 여부 기록 | S·M | 기록 |
| [ ] | DL-11 | prod: (U3) dev 완주 뒤 사전 점검(현재 head·MANIFEST) → 릴리스 승인 → M1 → 스냅샷 → M2(SSM) → M3 → M4 → 재백필, 각 단계 Brian 승인 기록 | M | 기록 |
| [ ] | DL-12 | prod M2 는 대상 건수 사전 조회(읽기 전용) 후 실행: 빈 운영에 가까워 대상이 거의 없음을 확인(스모크 클래스 등) | Q·M | 기록 |
| [ ] | DL-13 | 배포 직후 점검에 `/health/ready`(prod)·`alembic_version`·신규 테이블 존재 포함 | Q | 통과 |
| [ ] | DL-14 | 호환 윈도우 시작일(M5, ≥30일, D-61)이 summary 에 기록되고 종료 판단은 Brian 승인 항목으로 남음 | S | 기록 |

### 2.12 롤백 리허설 — RB

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | RB-1 | **M1 후 코드 revert 시뮬레이션**: 새 스키마 + 이전 릴리스 코드(PR-A 이전 커밋)로 기존 pytest/계약 골든 통과 | B·P | 신규 실패 0 |
| [ ] | RB-2 | **M3 후 코드 revert**: 057 적용 DB 에서 구 코드 모양 INSERT·UPDATE 성공 | P | 성공 |
| [ ] | RB-3 | **PR-C 후 코드 revert**: 호환 처리 제거 상태에서 구 코드가 만든 세션이 스트레이가 되고, 재백필이 정리 | P | 스트레이 0 |
| [ ] | RB-4 | 롤백 트랩 가정 시뮬레이션: `backend/alembic` 이 구 상태로 복원돼도 구 코드 앱이 기동·요청 처리 가능 (DB 리비전이 소스에 없어도 앱은 동작 — 앱 기동 시 alembic 검사 유무 확인, `미확인` → 확인 결과 기록) | B·S | 기록 |
| [ ] | RB-5 | 역방향 SQL(BF-26)·스냅샷 복원 절차가 문서화되고 책임·승인자 명시 | S | 기록 |
| [ ] | RB-6 | 롤백 후 `alembic` 수동 명령 금지 규칙이 PR-A 본문·summary 에 기재 (MG-12) | S | 기재 |

---

## 3. Brian 수동 확인 게이트 (V-M)

| 확인 | ID | 시점 | 내용 |
|---|---|---|---|
| [ ] | M-1 | 구현 시작 전 | 이 verify 승인 + 결정 U1~U5 답 |
| [ ] | M-2 | PR-A 머지 전 | 마이그레이션 PR 본문(롤백 설계·`check_migrations` 결과) 검토 |
| [ ] | M-3 | dev 스냅샷 생성 전 | 스냅샷 생성 명령·이름·보관 계획 승인 (읽기 전용이 아니므로 별도 승인) |
| [ ] | M-4 | dry-run 실행 전 | dev 읽기 전용 조회 go (dev 는 현재 실사용 DB) |
| [ ] | M-5 | apply 전 | dry-run 보고(합계·분포) 확인, **U1 분류 규칙 승인**, `in_progress` 세션 1건 처리 확인 |
| [ ] | M-6 | PR-B·PR-C 머지 전 | V1~V19 보고 확인 |
| [ ] | M-7 | prod 반영 전 | U3 순서·릴리스·M2 go |
| [ ] | M-8 | 종료 | 호환 윈도우 종료 승인(D-61), 스냅샷 삭제 승인, 최종 리뷰 |

---

## 4. 기존 테스트 개정 허용 목록 (이 목록 밖의 기존 테스트 수정은 G1 위반)

| 파일 | 사유 | 범위 |
|---|---|---|
| `backend/tests/test_sdd210_ci_gates.py` | 하드코딩된 head 리비전 단언(SDD-213 선례) | head 문자열 갱신만 |
| `backend/tests/test_sdd211_migration_30c1_idempotent.py` | 하드코딩된 head·리비전 개수 단언(SDD-213 선례: 85) | head·개수 갱신만 |
| (그 외 head/개수 하드코딩 테스트) | G0 의 grep 으로 확정 | head·개수 갱신만, 목록은 `baseline.md` 에 기록 후 이 표에 추가(변경 이력 기재) |

---

## 5. 변경 이력

| 일자 | 변경 | 사유 | 승인 |
|---|---|---|---|
| 2026-10-18 | 최초 작성 (Stage ③, 구현 전) | — | Brian 승인 대기 |
