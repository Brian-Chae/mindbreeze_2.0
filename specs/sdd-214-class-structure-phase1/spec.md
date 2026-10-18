# SDD-214 — 클래스·세션 재설계 Phase 1 (상위 구조 기반: 데이터 모델 M1 · 이전 M2 · 제약 M3 · 읽기 API · 호환)

> 2026-10-18 · 작성: Claude (Stage ①②③ 문서 전용) · **코드·DB·서버 변경 없음, 구현은 Brian go/no-go 및 verify 승인 후**
> 입력: `docs/class-session-restructure/{기획,영향도,결정-필요}.md`(+`기획-상세-*`, `조사/R1·R7·R10`), `specs/sdd-211-class-structure-phase0/{spec,plan,summary,m0-report,drift-report}.md`, `specs/sdd-213-schema-drift/summary.md`, 시안 `designs/class-structure-redesign/`(커밋 `234d99d2`)
> 정본: **plan.md**(Task·병렬 소유 영역·마이그레이션 안전·배포 순서) · **verify.md**(구현 전 QA 게이트). 확인하지 못한 것은 `미확인` 으로 표기한다.

## 용어 풀이 (이 문서 한정)

| 용어 | 뜻 |
|---|---|
| 클래스 | 명상 프로그램(상위). 회차(세션)를 묶는 단위. 예: `MBSR 봄` |
| 상담 관계 | 상담의 상위 단위. 내담자 1명 + 상담사 1명 (`counseling_relationships`) |
| 부모 | 세션의 상위. 명상은 클래스, 상담은 상담 관계. 비템플릿 세션은 부모가 정확히 하나 |
| 가산(추가형) | 기존 것을 바꾸거나 지우지 않고 새 테이블·새 컬럼(비어 있어도 되는 것)만 더하는 변경 |
| 백필 | 이미 쌓인 기존 데이터를 새 구조에 맞게 채워 넣는 일회성 이전 작업 (M2) |
| 멱등 | 여러 번 실행해도 결과가 같고 오류가 나지 않는 성질 |
| 스트레이 세션 | 부모 연결이 없는 비템플릿 세션 (구 코드가 새 구조 이후에도 만들 수 있음) |
| 복합 외래키(복합 FK) | 두 컬럼 묶음으로 거는 외래키. 예: `(class_id, host_id)` 가 해당 클래스의 강사 행이어야 함 |
| NOT VALID | 제약을 걸되 기존 행 검사는 미루는 방식. 이후 `VALIDATE` 로 기존 행 검사 |
| 호환 윈도우 | 구 앱(강제 업데이트 없음)이 새 서버와 함께 동작해야 하는 유예 기간 (M5, 30일 이상) |

## 목적

기획 `§9 Phase 1` 의 목표를 그대로 따른다. **새 구조의 데이터 뼈대를 만들고 기존 데이터를 이전한다. 사용자에게는 아무 변화가 없다.**

- Phase 2(명상 클래스 읽기·IA 전환)와 Phase 6(상담 영역)이 올라설 바닥을 만든다.
- 기존 세션 1건 → **클래스 1 + 세션 1**(명상) / **상담 관계 + 세션**(상담) 으로 이전하되, 세션 id·참여자 id·`/sessions/*` 61개 계약·엔진은 바꾸지 않는다.
- 이후 모든 Phase 가 기대는 불변식(부모 정확히 하나, 진행자는 해당 클래스 강사, 회차 번호 유일)을 데이터베이스가 지킬 수 있게 한다.

## 범위

### 포함 (기획 §9 Phase 1 의 7개 항목 + 필수 연동)

| # | 항목 | 내용 | 기획 근거 |
|---|---|---|---|
| 1 | **M1 스키마** | 신규 테이블 11개: `classes`, `class_instructors`, `class_members`, `class_member_events`, `counseling_relationships`, `counseling_relationship_counselors`, `counseling_guests`, `counseling_relationship_events`, `guest_claim_events`, `session_migration_map`, `session_host_history`. 기존 테이블 가산 컬럼: `sessions`(`class_id`, `counseling_relationship_id`, `seq`, `session_kind`, `host_state`), `session_participants`(`member_id`, `guest_client_id`, 출석 컬럼 5종), `reports`(`approved_by_user_id`, `approved_at`). **전부 비어 있어도 되는(nullable) 또는 기본값 있는 형태** | §9 P1-1, §11.2 |
| 2 | **분류 함수 1개** | 세션 → (명상 클래스 / 상담 관계 / 이전 안 함) 판정. 백필과 `POST /sessions` 호환 처리가 같은 함수를 쓴다. 순수 함수 + 단위 테스트 8행 + 경계 | §9 P1-2, §11.3 |
| 3 | **M2 백필** | 별도 멱등 스크립트(수동 실행, 기본 dry-run, 단일 트랜잭션). `session_migration_map` 이 멱등 키 겸 역방향 근거. 세션 id·참여자 id 불변, 기존 컬럼 불변 | §9 P1-3 |
| 4 | **M3 제약** | 복합 FK 2개(`NOT VALID` → `VALIDATE`), `UNIQUE(class_id, seq)`·`UNIQUE(counseling_relationship_id, seq)`, 부분 유니크 | §9 P1-4 |
| 5 | **읽기 API** | `GET /classes`, `GET /classes/{id}`, `GET /classes/{id}/sessions`, `GET /counseling`, `GET /counseling/{id}`. 기존 세션 응답에 `class_id`·`class_title`·`seq`·`area` **가산** | §9 P1-5 |
| 6 | **호환** | `POST /sessions` 호환 처리(부모 자동 생성), 코드 입장 해석(클래스 코드 → 현재 입장 가능 회차, 없으면 세션 코드 폴백, 입장 불가는 동일 404), 알림 `params` 가산(`target_id`·레거시 `session_id` 유지), 코드를 읽는 파일의 "세션 값 없으면 클래스 값" 폴백 | §9 P1-6, §11.4 |
| 7 | **숨김 필터** | 새 부모 모델(`Class`, `CounselingRelationship`)에도 `hidden_at` ORM 전역 필터 적용 | §9 P1-7 |
| 8 | **필수 연동** (기획 §9 Phase 1 목록에는 없으나 §12 X6·X19 가 요구) | 백필이 **비회원 개인정보를 새 테이블로 복제**하므로 보관 스위프(개인정보 삭제 작업)가 복제본도 대상으로 삼도록 확장. 한쪽만 스크럽되는 상태 금지. 스위프는 prod 에서 계속 dry-run(`RETENTION_SWEEP_ENABLED=false`) | §12 X6·X19 |
| 9 | **구 앱 연동 유지** | 구 앱의 클래스 단위 필드 수정을 클래스에 동기화(조건부), 클래스의 마지막 가시 세션이 숨겨지면 클래스도 숨김 | §11.4, R7 §6.5 |

### 제외 (이 SDD 에서 하지 않는다)

| 제외 항목 | 이유 / 담당 Phase |
|---|---|
| **`users` 테이블 변경** | 기획 §9 Phase 1 목록에 `users` 컬럼 변경이 없다. `users.auto_approve_report` 영역 분리는 `D-37`(차단 Phase 6). → **사용자 결정 U2** 로 확인 |
| 화면(UI) 변경·문구 변경 | Phase 2 (`D-62` 호칭 적용). 프론트는 `SessionDto` 타입에 선택 필드를 더하는 것까지 |
| 클래스·멤버십·강사 **쓰기** API (편성·강사 배정·초대·출석·보강) | Phase 3~4 |
| 상담 관계 쓰기·종결/재개/보관, 새 상담 세션 마법사 | Phase 6 |
| 비회원 상담 입장·재방문 자격·회원 전환 | Phase 7 (`counseling_guests` 는 테이블만 만들고 이전된 행 외에는 비어 있음) |
| contract(M6): `ck_sessions_one_parent` CHECK, NOT NULL 승격, 템플릿 이사(`class_templates`), `access_code` 쓰기 중단 | Phase 8 |
| 열람 범위 확장(진행하지 않는 강사의 기록·리포트 열람, 센터 관리자 상담 비공개) | Phase 3 (`D-05`·`D-28`). **Phase 1 읽기 API 는 현행 세션 접근 범위를 넘지 않는다** |
| `reports.approved_by_user_id/approved_at` 에 값 쓰기 | Phase 5. Phase 1 은 컬럼만 추가하고 기존 행은 NULL 유지 |
| 리포트 생성 큐·워커 | SDD-212 에서 별도 처리 |
| 스키마 드리프트 정리 | SDD-213 완료. 리비전 `e036a0000052` 가 현재 head |
| 엔진(진행·입장·뇌파·녹음/STT/요약·리포트 생성) 수정 | 모든 Phase 공통 금지 |

## 확정 결정 (뒤집지 않음)

| # | 확정 | 출처 |
|---|---|---|
| 1 | 클래스=프로그램 / 세션=회차, 명상 클래스·상담 분리, 기관 단위 on/off 없음. 부모는 테이블 2개 + `sessions` 의 FK 2개 중 하나(옵션 A) | `기획.md` §3·§5 #2 |
| 2 | 추가형(nullable)만. NOT NULL·CHECK 는 M6 까지 미룸. 구 `/sessions/*` 61개·세션 id·참여자 id·WS 룸 이름 불변. 엔진 불변 | `기획.md` §9 공통 원칙 |
| 3 | 롤백은 **코드 revert 뿐**, DB 는 되돌리지 않는다. 마이그레이션 다운그레이드는 운영 롤백에 쓰지 않는다 | `기획.md` §12 롤백 총칙 |
| 4 | `host_id` 컬럼 유지(의미를 "진행 강사"로 확정), 회차 번호는 `seq`, 보강 구분은 `session_kind` | `기획.md` §5 #3·#4 |
| 5 | **D-55** 활성 참여자 ≥2 인 상담 유형 세션 → 명상 클래스(유형 라벨 유지) · **D-56** 기타(custom)는 규칙 자동 분류 + 모호건 호스트 1회 확인 · **D-57** 같은 상담사·회원은 한 상담 관계로 묶기 / 내담자 불명 세션은 보관용 관계(삭제 금지) / 종결 추정 안 함 | `결정-필요.md` 확정 기록 (Brian, 2026-10-17 "기본값으로") |
| 6 | **D-60** 이전은 무중단. SDD-210 prod 컷오버와의 선후는 일정 확인 후 확정 → **컷오버는 2026-10-18 완료**(빈 운영 환경 시작, 릴리스 `20261018-033707-c8d4d8b`)이므로 선후는 "컷오버 후"로 사실이 정해짐 | `결정-필요.md` 확정 기록, `specs/sdd-210-prod-environment/cutover-result.md` |
| 7 | **D-62** 호칭(지도사 · 상담 N회차 · 흡수 · 구성원)은 Phase 2 에서 적용. 이 SDD 는 문구를 바꾸지 않는다 · **D-64** 상담 메뉴는 Phase 2 부터 기존 화면 재배치로 노출 | `결정-필요.md` 확정 기록 |
| 8 | 그 외 결정은 "각 Phase 시작 전 기본값 확인(기본값 진행 허용)". Phase 1 에 걸리는 것은 `D-60`·`D-61`·`D-63`(+ 이전 규칙 `D-55`~`D-57`) | `기획.md` §9 Phase 1, `결정-필요.md` §0 |
| 9 | 7-Stage SDD: verify 는 구현 전 승인 게이트, 구현 후 완화 금지. spec+plan+verify+summary 4종이 있어야 완료 | `CLAUDE.md` |

## 현황 (이 SDD 의 출발점, 사실만)

| 항목 | 값 | 근거 |
|---|---|---|
| 현재 alembic head | `e036a0000052` (SDD-213 드리프트 정리, 단일 head). **Phase 1 M1 리비전은 `e036a0000053` 부터** (기획·R7 의 `…052`~ 표기는 SDD-213 이 선점해 `…053`~ 로 이동) | `backend/alembic/versions/e036a0000052_sdd_213_schema_drift_cleanup.py` |
| dev 이전 대상 규모 (2026-10-18 05:29 UTC 측정) | 비템플릿 세션 177(숨김 39 포함) · 명상 171 · 임상 6 · 최면 0 · custom 0 · 템플릿 1 | `m0-report.md` §3 A1·A2·A4 |
| 상담 후보 | 회원 1명 쌍 1개(2세션, 기관 혼재 0) · 활성 참여자 0명 임상 4건 · 비회원 상담 참여자 0 · R7/R10 규칙이 갈리는 세션 1건(임상 group, 활성 1명) | `m0-report.md` §3 A3·A5·A6 |
| D-55/56/57 영향 | 기본값 변경 필요 **아니오** (모수 매우 작음) | `m0-report.md` §5 |
| 진행 중 세션 | dev `in_progress` 1건(2026-10-06 생성) — 이전 시점 점검 필요 | `m0-report.md` §3 A9 |
| prod | 2026-10-18 컷오버로 **빈 운영 환경 시작**(초기 계정 3개, 스모크 클래스 1건 취소 상태). 현재 prod head 가 `…051` 인지 `…052` 인지 `미확인` | `cutover-result.md` |
| 기준선 | M0 의 비템플릿 177(숨김 포함)로 고정했으나 E2E 가 계속 행을 추가하므로 **구현 직전 재측정**한다 | `m0-report.md` §4 |
| 롤백 트랩 | `deploy-dev.yml` 은 `dist`·`backend/app`·`backend/alembic` 만 복원, DB 는 되돌리지 않음 | `기획.md` §12, `조사/R7` §2, `.github/workflows/deploy-dev.yml` |

## 조사로 바로잡은 전제 (결정을 뒤집는 것이 아니라 사실 정정)

| # | 문서의 전제 | 확인 결과 |
|---|---|---|
| 1 | M1 리비전 번호 `e036a0000052`~ (R7 §5) | 052 는 SDD-213 이 사용 → **053~** (M3 제약은 057 예정) |
| 2 | 신규 테이블 12개 (영향도 §0) | `class_templates` 는 contract(M6, Phase 8)에서 생성 → **Phase 1 은 11개** (기획 §9 P1-1 과 일치) |
| 3 | 비회원 신원 테이블명 `counseling_guest_clients` (R1) | 기획 §5 #6 확정에 따라 **`counseling_guests`** |
| 4 | `session_kind` "판단 보류" (R1 §8.8) | 기획 §9 P1-1 이 M1 컬럼으로 명시 → **포함** |
| 5 | "코드를 읽는 6개 파일" 폴백 (기획 §9 P1-6) | 코드 전수 조사에서 `access_code` 를 참조하는 서비스 파일은 8개(`reminder_service`·`code_service`·`class_code_service`·`class_code_reissue`·`org_public_service`·`dashboard_service`·`session_service`·`session_email_invite_service`) → plan 의 Task P2 가 전수 재확인 |
| 6 | `/class` 와 `/classes` | `/class` 접두사는 이미 `class_audio.py` 가 사용 중. `/classes`·`/counseling` 은 미등록(충돌 없음, 혼동 주의) |
| 7 | SDD-213 리비전의 주석 "Phase 1 의 users 변경이 NOT NULL 을 가정" | 기획 문서의 Phase 1 범위에는 `users` 변경이 없다. 이 주석은 가정이며 확정된 요구가 아니다 → U2 |

## 사용자 결정 필요

> 비즈니스 성격의 항목만 둔다. 기술 선택(리비전 분할, 제약 방식, 코드 구조 등)은 plan 이 확정한다. Brian 이 "추천안대로"라고만 답하면 모두 추천안으로 진행한다.

| ID | 결정 사항 | 옵션 | **추천안** | 근거·영향 | 차단 시점 |
|---|---|---|---|---|---|
| **U1** | **분류 규칙 승인** (Phase 1 진입 게이트 — M0 보고만으로는 승인되지 않음, `m0-report.md` §5) | ① 기본값 규칙 그대로 승인 ② 일부 수정 | **① 승인** | D-55/56/57 기본값 적용 시 dev 영향: 상담 6건·custom 0건·1:1 인데 활성 2명 이상 0건. 규칙이 갈리는 1건은 목록 보고로 충분. 승인 전에는 합성 데이터 테스트까지만 하고 **실데이터 dry-run·apply 는 하지 않는다** | M2 dry-run 전 |
| **U2** | **`users` 테이블 변경 포함 여부** | ① 제외(Phase 6 `D-37` 로 이관) ② 포함(범위 지정 필요) | **① 제외** | 기획상 Phase 1 에 `users` 변경이 없고, 영역별 자동 승인 분리(`D-37`)는 Phase 6 시작 전 확정 항목. 제외하면 SDD-213 이 정리한 `users.auth_provider` 와의 충돌 가능성도 없다. 포함하려면 어떤 컬럼인지 알려주어야 한다 | 구현 시작 전 |
| **U3** | **prod 반영 순서와 이전(M2) 시점** — 컷오버가 이미 끝났으므로 `D-60` 의 "선후"는 사실로 정해졌고, 남은 것은 시점 | ① dev 에서 전 단계 완주·검증 후 prod 에 동일 절차(M1 → M2 수동 → M3 → M4 → 재백필) ② dev·prod 동시 진행 | **① dev 먼저** | prod 는 빈 운영에 가까워 이전 대상이 거의 없지만(스모크 취소 클래스 1건·초기 계정), 첫 PG 실행이 prod 가 되지 않도록 dev 완주를 선행. prod 는 `release-build` → Brian 승인 → `deploy-prod`, M2 는 SSM 경유 수동. 무중단(`D-60` 확정) 유지 | prod 릴리스 전 |
| **U4** | **분류가 모호한 건 / 배치를 알 수 없는 건의 처리** — (a) 규칙이 갈리는 세션(dev 1건), (b) custom 모호건, (c) 새로 만든 상담 세션이 만들 때는 참여자가 없어 "내담자 미상(보관용)" 관계로 들어가는 경우 — 현행 코드에는 상담 세션의 참여자가 나중에 코드로 입장하므로 생성 시점에 내담자를 알 수 없다 | ① Phase 1 은 기본 규칙대로 배치하고 `flags` 로 표시·보고만, 호스트에게 묻는 화면(`D-56`)과 보관용 관계 재배치는 Phase 2·6 에서 ② Phase 1 에 재배치 규칙까지 포함 | **① 표시·보고만** | 호스트에게 묻는 UI 는 Phase 1 범위 밖(화면 변경 0). 재배치 규칙은 기획 문서에 정의가 없다(`미확인`) → 상담 UX 를 만드는 Phase 6 에서 확정. Phase 1 은 일일 점검 질의로 건수만 감시 | M4 배포 전 |
| **U5** | **시안(Phase 2) 승인 시점** — 시안 3종 37화면이 커밋됨(`234d99d2`), 승인 여부 `미확인` | ① Phase 1 구현과 병행해 승인(Phase 2 시작 전까지) ② Phase 1 완료 후 | **① 병행** | Phase 1 은 시안과 무관하게 진행 가능(UI 변경 0). 다만 읽기 API 응답 필드가 시안 요구를 덮는지 plan §11 매핑표로 검증하므로, 시안 수정이 있으면 API 가산 필드가 달라질 수 있다 | Phase 2 시작 전 |

### 확인만 요청 (결정 아님, 기본값으로 진행)

| ID | 내용 | 기본 처리 |
|---|---|---|
| C1 | `D-61` 구 앱 호환 윈도우: 30일 + 레거시 호출 0 수렴 확인 후 종료 승인 | 기본값. M5 시작일을 summary 에 기록 |
| C2 | `D-63` 이전된 비회원 상담 안내 | dev 대상 0건(임상 비회원 0). 기본값 "다음 상담 때 초대 재발송 안내" 유지, prod 는 대상 없음 |
| C3 | 현재 prod head 가 `…052` 반영 상태인지 | `미확인` — plan §9 사전 점검 항목. 052 는 `UPDATE` 문을 포함해 `check_migrations` 가 파괴적으로 분류할 수 있으므로 다음 prod 릴리스의 `confirm_destructive` 필요 여부를 릴리스 빌드 요약으로 확인 |
| C4 | 법무 확인 | Phase 1 은 해당 항목 없음. 백필의 비회원 개인정보 복제는 **동일 목적 범위 내 복제**이며 스크럽을 동기화한다(신규 수집·목적 변경 아님). 이 해석에 이의가 있으면 알려 주세요 |

## Phase 2 시안과의 연결

시안은 Phase 2 의 입력이고 Phase 1 의 입력은 아니다. 연결은 "시안이 요구하는 읽기 데이터를 Phase 1 이 줄 수 있는가" 한 가지다.

| 시안 | 화면 수 | Phase 1 이 제공해야 하는 것 | 이번에 제공하지 않는 것(후속 Phase 데이터) |
|---|---|---|---|
| `host-classes.html` (CH01~CH30) | 14 | 클래스 목록·상세·회차 목록(진행 강사·상태·`seq`), 열린 세션 표시용 상태 | 편성 마법사·일괄 편집·강사 변경(Phase 3), 멤버/출석 탭(Phase 4), 리포트 탭·추이(Phase 5) |
| `member-classes.html` (MC01~MC07) | 7 | 내 클래스 목록·상세·회차 타임라인의 기초 필드(클래스명·`seq`·진행 강사·상태) | 결석·보강·중간 합류 표기(Phase 4), 변화 서사(Phase 5), 비회원 제한 뷰(Phase 4) |
| `counseling.html` (CN01~CN16) | 16 | 상담 관계 목록·상세(상담사·내담자 표시·회차 목록·상태) | 종결/재개/보관·새 상담 세션 마법사(Phase 6), 관계 코드 입장·회원 전환(Phase 7) |

필드 단위 매핑과 누락 점검은 plan §11 과 verify `DS-*` 에 있다. Phase 1 이 줄 수 없는 필드는 시안에 있더라도 Phase 2 에서 "데이터 없음"으로 처리하거나 후속 Phase 와 함께 켜야 한다.

## 완료 기준 (SDD 4종 + Phase 1 게이트)

spec(이 문서) + plan + verify(구현 전 승인) + summary(구현 후). 추가로 `기획.md` §9 Phase 1 완료 기준:

- 이전 검증 쿼리 **V1~V19 통과** (`영향도.md` §4.5)
- **스트레이 세션 0** (M4 직후 백필 재실행 포함)
- **구 앱 회귀 통과** (SDD-211 계약 골든 61 라우트 가산 전용 + 응답 형태 17 시나리오)
- **이전 건수 대조** (type 별·참여자 수)
- PG 스모크(빈 DB + 덤프 복원본) 통과, 마이그레이션 안전 검증(멱등·데이터 보존·구 코드 호환)

## 상태

- ① Spec: **작성 완료 — Brian go/no-go 대기** (2026-10-18). 사용자 결정 U1~U5 대기.
- ② Plan / ③ Verify: **작성 완료 — verify 승인 전 어떤 Task 도 시작하지 않는다.**
- ④~⑦: 미착수
