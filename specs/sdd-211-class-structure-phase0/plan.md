# SDD-211 Plan — Phase 0 선행 정리 (Stage ②)

> 2026-10-18 · 기준 커밋 `3b93f692`(develop) · 입력: `spec.md`, `brief.md`, `investigation/01~07`, `기획.md` §9/§12/§13/§14, `영향도.md`, `결정-필요.md`, SDD-209/210 선례.
> 표기: **확인** = 이번에 코드로 확인(`파일:줄`) / `미확인` / **[조사 NN]** = `investigation/NN-*.md` 의 해당 절(줄 근거 포함). 경로 접두 `backend/app/`→`app/`, `frontend/src/`→`fe/`.
> **구현 전 verify 승인 없이는 어떤 Task 도 시작하지 않는다.** 이 문서와 verify.md 는 코드·DB·서버를 건드리지 않고 작성했다.

## 0. 조사로 확정한 사실

### 0.1 정정·발견 (spec 의 '바로잡은 전제' 상세)

| # | 사실 | 근거 | 설계 영향 |
|---|---|---|---|
| F1 | 호스트 판정 복제 헬퍼 **9곳 / 6개 파일 / 호출 33곳**, 의미가 다른 4계열: (A) 호스트 전용·기관 검사 없음 4곳, (B) 호스트 전용 + **기관 활성 검사(409)·기관 행 `FOR UPDATE` 잠금** 1곳(`session_service.py:742-755`), (C) 호스트 전용·문구 상이 1곳(`session_email_invite_service.py:64-76`), (D) 호스트 또는 참여자 3곳 | [조사 01] §1 | 단일 함수가 기관 검사를 일괄 통일하면 녹음·영상·리포트 생성·이메일 초대가 새로 409 가 됨 → **액션별 정책 플래그**로 현행 보존 |
| F2 | 403 문구 3종(`host 상담사만 가능합니다`/`호스트만 초대할 수 있습니다`/`접근 권한이 없습니다`). 문구를 단언하는 기존 테스트는 `tests/test_report.py:123` 하나뿐 | [조사 01] §1·§4 | 문구 보존은 기존 테스트가 지켜주지 않음 → **특성화 테스트 먼저** |
| F3 | 어느 복제본도 role 을 보지 않음(org_admin·platform_admin 도 비호스트면 403). `video.py:81,108` 만 platform_admin 우회 | [조사 01] D4 | `authorize_session` 이 role 우회를 넣으면 **권한 확대** → 금지 |
| F4 | 세션 생성·복제·수정·템플릿·새 실행 라우트 5개(`app/api/v1/session.py:86,203,272,288,314`)는 `get_current_user` 만 사용. `require_roles` 는 이미 존재(`app/api/deps.py:75-86`, 403 본문 `이 작업을 수행할 권한이 없습니다`). **client 정상 호출 경로 없음**(프론트 `RoleGuard(['counselor','org_admin'])` `fe/App.tsx:191-193`, "클래스 신청하기"=채팅 메시지, e2e·부하테스트·백엔드 테스트 전수) | [조사 02] §0·§2 | 가드 적용이 알려진 호출자를 깨지 않음. 남는 `미확인`: 구 Capacitor 번들, role=client 호스트 세션 존재 |
| F5 | `platform_admin` 은 현재 API 로 세션 생성 가능(UI 는 불가). 가드에서 제외하면 동작 변경 | [조사 02] §4 | 사용자 결정 U4 (기본: 제외) |
| F6 | R6-X1 **노출 확정**: `GET /reports`(`app/services/report_service.py:584` 소유자 조건만), `GET /reports/{id}`(`:722-765` 소유자 검사만), `GET /client/home` `recent_report`(`app/api/v1/client_portal.py:257-262`)가 상태 불문. 자동 승인 기본 off(`app/models/user.py:109-111`) → 대부분의 회원 리포트가 승인 전까지 무기한 노출 구간. 비회원 토큰·메일·PDF·AI 비서·내보내기는 `completed` 만 허용(안전, 테스트 고정) | [조사 03] §0·§2 | 쿼리 수준 필터. 승인 전 `counselor_comment` 초안도 회원에게 보이던 것이 함께 닫힘 |
| F7 | 노출이 **테스트로 고정**: `tests/test_mb2_high_severity_fixes.py:163-183`(pending_review 소유 회원 GET → 200), `tests/test_report_bulk_actions.py:89-108`. SDD-027 codex 점검이 요구했으나(`specs/027-…/02-codex-integration-check.md:53,83`) 미구현 | [조사 03] §2.3·§4.2 | 두 테스트의 개정은 **구현 전 verify 에서 확정**(verify §4 RX-개정표) — "완화"가 아니라 정책 변경 |
| F8 | 빈 DB `alembic upgrade head` **실패**(14번째 `30c1bfbc724f`: `backend/alembic/versions/30c1bfbc724f_*.py:24` 가 `c8f3a1b5d201`(`…_013_chat_room_participants.py:22`) 이 이미 만든 `chat_room_participants` 를 재생성 — **두 파일 모두 직접 확인**). 이 리비전만 건너뛰면 나머지 83개 통과(로컬 PG 16.13, 총 ≈1.2초). 필요분 4건(`careers.updated_at`, `qualifications.updated_at`, `careers.role` 200→100, `careers.is_current NOT NULL`)뿐. 리비전 **84개**, head 1개 `e036a0000051` | [조사 04] §0·§2 | P0 Task 로 멱등화. 이미 적용된 DB 는 재실행하지 않으므로 dev/prod 무영향(추론 — dev `alembic current` 는 `미확인`) |
| F9 | 테스트는 인메모리 SQLite `create_all`(`tests/conftest.py:195-203`). PG 부분 인덱스는 모델에 `postgresql_where`+`sqlite_where` 를 **손으로 이중 작성**, 복합 FK 현재 0건, SQLite 는 FK 미강제. 마이그레이션이 CI 에서 한 번도 안 돎 | [조사 04] §3·§4 | PG 잡 + `pg` 마커 하네스. 복합 FK 테스트는 대상 테이블이 생기는 Phase |
| F10 | `deploy-dev.yml` 은 `ci-feature` 를 `needs` 하지 않음(독립) → CI 가 빨개도 dev 배포는 막히지 않음. 롤백 트랩은 `dist`·`backend/app`·`backend/alembic` 만 복원(`:118-144`), DB 되돌림 없음 | [조사 04] §1.1 | 새 PG 잡의 "차단" 의미는 브랜치 보호 필수 점검 등록이 있어야 실현(현황 `미확인`, Brian 수동) |
| F11 | `/sessions/*` 61 은 재현(`/sessions` 프리픽스 58 + 경로에 `{session_id}` 가 있는 admin 2·reports 1). 58개 중 50개 `response_model`, **8개 미지정**(입장 핵심 `join`·`livekit-token`·`markers` 포함). 응답 형태를 고정하는 기존 테스트 없음. `enter/verify` 는 키 집합 **추가 금지**(`tests/test_sdd209_b5a_entry.py:58`) | [조사 05] §0·§2 | OpenAPI 골든(주) + 응답 형태 골든(보강), 봉인 응답 예외 |
| F12 | 내비 라벨 비교식 **10개/3파일**: `SidebarNav.tsx:212-218`(4), `layout/BottomTabBar.tsx:61-65`(3), `client/BottomTabBar.tsx:52-56`(3). 배지 계산식이 세 컴포넌트에서 **서로 다름**(채팅). `MobileDrawer` 는 알림 배지만 받음(`MobileDrawer.tsx:42`). 하단 탭·`클래스` 배지를 직접 검증하는 기존 테스트 0개 | [조사 06] §1 | 키 전환은 "비교 기준만 라벨→키", 배지 계산 통합 금지, 특성화 테스트 먼저 |
| F13 | `BANNED_COPY` 는 `frontend/e2e/class-flow/lib.mjs:272` 한 곳(CI 미연결 수동 하니스). 22개 중 영역 의존은 `세션\|수업\|오픈` 3개, 나머지 19개는 SDD-209 UX 금지(영역 무관). vitest 가드 `class-flow-shell-terms.test.ts` 는 `세션` 한 단어만 | [조사 06] §2 | 영역별 분리는 "정책 정의의 분리"(적용 경로 분리 아님) |
| F14 | 서버 문구 중앙 템플릿 없음. 유형 라벨 4곳 중복·**값이 다름**(`명상수업`/`명상 수업`, fallback `클래스`/`상담`). 세션 알림 제목을 고정하는 백엔드 테스트 **0건**. 알림 제목 = 이메일 제목(`notification_service.py:186-192`) | [조사 06] §3 | 특성화 테스트 먼저, variant 별 별도 키로 값 보존 |
| F15 | M0: R7/R10 SQL 의 컬럼은 모두 존재. 활성 참여자 정의가 R7 D-2/D-4 와 R10 Q2/Q4/Q5 에서 다름 → 하나(`ACT`)로 통일. 기존 러너(`specs/sdd-209-class-flow-redesign/baseline-snapshot.py:30`)는 `SELECT` 시작만 허용 → `WITH` 질의는 서브쿼리로 재작성. `custom_type_name` 은 호스트 자유 입력(≤30자, `app/models/session.py:44`) — R10 Q3 의 "개인정보 아님"은 근거 없음. R7 §4.1·§7.2 의 `class_id` 등은 head 에 없음(M0 사용 금지) | [조사 07] §1.2 | 라벨 원문은 기본 비출력(U6) |
| F16 | 기준선 102 = dev `sessions`, `is_template=false`, 전 상태, head `e036a0000041`(`baseline.md:46,53`). SDD-210 134 = 질의 원문 **미기록**(`spec.md:16`, `plan.md:93`). 원인 `미확인`; 최유력 가설 = 측정 시점 차 + E2E 잔여 클래스(상태 증분: 예정 +17·완료 +14가 E2E 패턴과 부합) | [조사 07] §3 | 판별 질의 C2~C4 를 단일 감독 패스에 포함 |
| F17 | dev EC2 는 SSM 미등록 → 문서화된 접속 경로는 SSH(선례 `baseline.md:46`). RDS 비공개(5432 는 자기 SG). dev 스냅샷은 **전부 비암호화**(개인·생체 포함). 인스턴스명 `mindbreeze-dev`, 프로파일 `looxid-las`, 리전 `ap-northeast-1` | [조사 07] §2.1·§4.1 | SSH 선례 사용, 스냅샷 보관·접근 결정 U7 |

### 0.2 알려진 한계 (확인하지 못한 것은 §10)

- 서버 문구 출력·호스트 판정의 비호스트 응답·승인 전 회원 노출 일부는 **기존 테스트가 고정하지 않는다** → 각 트랙 첫 Task 가 현행 동작을 박제(특성화)한다.
- 스키마 덤프 픽스처는 **현재 head 로 고정**되므로 현재 `upgrade head` 는 no-op 이다. 가치는 Phase 1 의 M1 이후 델타가 얹히면서 생긴다([조사 04] §5). 과거 데이터 가드 마이그레이션(`e036a0000044`·`…030`·`…026`)은 head 픽스처에서는 실행되지 않는다(= 데이터를 둔 채 검증되지 않음 — §10 #6).

---

## 1. 목적·범위 요약

spec.md 참조. 범위 7항목: 용어 사전/키 기반 배지/가드 분리 · `authorize_session` · 역할 가드 · PG 스모크 · 구 계약 스냅샷 · R6-X1 · M0 설계. **스키마 변경 0**, 신규 마이그레이션 0(기존 `30c1bfbc724f` 1개 멱등화만), 엔진 불변.

---

## 2. 기술 결정 (plan 이 확정 — 사용자 결정 아님)

| ID | 결정 | 이유 |
|---|---|---|
| TD1 | **`authorize_session` 은 user_id 문자열 기반**, 모듈 `app/services/session_authz.py`. 두 진입점: `get_session_authorized(db, session_id, user_id, action)`(로드+판정, 현행 헬퍼 1:1 대체)와 `authorize_session(db, user_id, session, action)`(이미 로드된 세션용, `approve_report` 계열). 액션 enum = **현 호출 지점 단위**([조사 01] §3.3 25개). 액션마다 정책 `{rule: HOST|HOST_OR_PARTICIPANT, deny_detail, require_active_org}`. 에러 우선순위 고정 **400(ID)→404→403→409(기관)**. `db.query(Session).filter(...)` 유지(`db.get` 금지 — 전역 숨김 필터 보존, [조사 01] D3). **role 우회 도입 금지**. `Actor(id, role)` 확장은 Phase 3. `session_service` 를 import 하지 않음(순환 방지, 기관 검사는 함수 내부 지연 import) | 응답 바이트 동일, 권한 확대 방지, Phase 3 에서 HOST 규칙을 한 곳에서 변경 |
| TD2 | **교체는 shim → 호출부 0 → 삭제** 순서. `app/ws/record_namespace.py:59` 가 private 이름 `_get_session_for_participant` 를 import 하므로 마지막까지 위임 shim 유지. 스위프(`session_service.py:1106`)는 호스트 id 로 `transition_status` 를 호출해 계열 B 를 통과 — `SYSTEM` actor 도입 금지 | [조사 01] D5·D7 |
| TD3 | 9곳 밖의 호스트 판정은 **통합하지 않고 특성화 테스트만** 추가: `_can_access_report` 계열(org_admin·참여자 통과), `approve_report` 인라인 비교(`report_service.py:914`, 세션 없음도 403·문구 상이), `set_speaking`(400 이 403 보다 먼저), `resolve_audio_sync_host`, `video.py:81,108`(platform_admin 우회), `export_service.authorize`(404 은닉), `ChatRoom.host_id`(다른 컬럼). Phase 3 에서 후속 액션으로 흡수 검토 | Phase 0 은 동작 동일 리팩터 |
| TD4 | **역할 가드**: `Depends(require_roles("counselor","org_admin"))` 를 5개 라우트에 적용(`POST /sessions`, `PUT /{id}`, `duplicate`, `save-as-template`, `new-run`). 별도 문구·형식 신설 안 함(403 `이 작업을 수행할 권한이 없습니다`). `DELETE`·상태 전이·초대 등은 호스트 판정이 이미 막으므로 제외(문구 변경 위험 회피). 역할 가드(라우트 의존성)와 호스트 판정(서비스)은 **층이 다르므로 구현 순서를 독립** | [조사 02] §4.1 |
| TD5 | **R6-X1 수정 지점**: ① `list_reports` 회원 분기 쿼리에 `Report.status == "completed"`(총계·페이지네이션 정합) ② `get_report` — 소유자 검사 **뒤**, `is_read` 마킹 **앞**에서 client 이고 미완료면 404(존재 은닉; RPT-IDOR-001 의 타 참여자 403 계약 유지) ③ `client_portal` `recent_report` 에 `status=="completed"`(+`type=="client"`) ④ `mark_all_read` 에 `status=="completed"`. 응답 스키마·필드 불변. 승인·자동 승인·재생성 흐름 불변. **`report-status`·WS `report:progress` 의 상태 문자열은 Phase 0 에서 변경하지 않음**(호스트 UI 와 공유 필드, 내용 노출 아님) → 잔여 노출로 기록(§7 위험) | [조사 03] §5.1 |
| TD6 | **PG 스모크**: `ci-feature.yml` 에 새 잡 `backend-pg-smoke`(`postgres:16` 서비스 컨테이너, `DATABASE_URL` 하나만 필요, 최소 패키지 설치, `timeout-minutes: 10`, 필터 없이 항상 실행). 단계: `alembic heads` 정확히 1개 → 빈 DB `upgrade head` → 스키마 덤프 복원 + 합성 시드 → `upgrade head` → `alembic check`(정보성, `continue-on-error`). **upgrade 만 검증, downgrade 왕복 없음**(롤백 정책 일관). "스냅샷 복원본" = **스키마 전용 덤프 + 합성 시드**(실데이터 덤프 기각 — 공개 저장소·비암호화 스냅샷). `deploy-dev.yml` 변경 없음 | [조사 04] §5·§7, [조사 07] E10 |
| TD7 | **`30c1bfbc724f` 멱등화**는 삭제가 아니라 `sa.inspect` 존재 검사 가드(필요분 4건 보존). 결과 스키마가 모델 메타데이터와 같은 테이블 수(62)임을 확인. 리비전 id·체인 불변 | [조사 04] §2 |
| TD8 | **계약 스냅샷**: (a) OpenAPI 서브셋 골든(주 방어선, 가산 전용 규칙) + (b) 응답 형태 골든 17 시나리오(미지정 dict 8개·불투명 필드 보강) 둘 다. 위치 `backend/tests/contract/`. 값이 아닌 **형태(키+타입 태그)** 만 저장해 비결정성 제거. 골든 쓰기는 `UPDATE_CONTRACT_GOLDEN=1` 에서만, `CI=true` 이면 거부. 의도적 파괴는 `golden/breaking_exemptions.json`(SDD 번호·사유·`expires_phase`) 항목으로만 가능. `enter/verify` 는 `strict_keys` 봉인. **골든은 Phase 0 시작 시점 동작을 박제**(버그 포함, 수정·정리 금지) → 모든 변경 Task 보다 먼저 커밋 | [조사 05] §5 |
| TD9 | **용어**: `lib/terms.ts` 는 `Record<TermKey, Record<TermArea, string>>`(영역 `meditation`·`counseling`), Phase 0 에서 두 영역 값 동일. 키는 화면 위치별 항목 정체성(`dashboard`=`대시보드`/`home`=`홈`/`org-dashboard`=`기관 대시보드` 분리 등 16개). 컴포넌트 파일에서 함수 export 금지(`react-refresh/only-export-components: error`) → 순수 `.ts`. 배지 결합은 키로, **계산식 통합 금지**(세 컴포넌트 식 상이). `NavItem.badge` 죽은 필드·`ShellFrame.tsx` 키·`host-shell-data.ts:98` 는 건드리지 않음 | [조사 06] §4 |
| TD10 | **서버 `session_terms.py` 범위** = 알림 제목 11개 + 본문 fallback `세션` 8개 + `session_invite_service.py:87-88` + 유형 라벨 4곳(variant 별 키). 메일/푸시 본문·에러 `detail` 제외. 미지 키는 `KeyError`(조용한 fallback 금지). 서버에 `area` 가 아직 없으므로 호출부는 기본값 사용 | [조사 06] §3.4 |
| TD11 | **가드 분리 데이터**: `frontend/e2e/class-flow/banned/{common,meditation,counseling}.json`(정규식 소스). `composeBanned('meditation')` 가 현행 `BANNED_COPY` 와 **바이트 동일**(meditation 항목을 앞에). `counseling` 규칙은 정의만, **적용 경로 0개**. `class-flow-shell-terms.test.ts` 는 `세션` 단독 검사 유지(검사 범위 확대 금지 — 현재 통과 여부 `미확인`인 `수업`·`오픈` 추가는 게이트 변경) | [조사 06] §4.4 |
| TD12 | **M0 질의**: A1~A11(+B0, C2~C4, 기준선 재실행 C6), 전부 `SELECT` 시작·서브쿼리 전개(매크로 `<A>`), 출력은 범주형·구간·집계만. 읽기 전용 **3중 강제**(연결 옵션 `default_transaction_read_only=on`+`statement_timeout`, `BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY` … `ROLLBACK`, 문장별 `^select` + 금지어 정규식). 한 트랜잭션 단일 패스(질의 간 시점 일치). 파일 위치 `specs/sdd-211-class-structure-phase0/m0-prequery.{sql,py}`. **조사 07 에 없던 질의 2개 추가(범주형 집계만)**: **A10** `users.role × 호스트 세션 수`(role=client 호스트 세션 유무 — 역할 가드 `미확인` 해소), **A11** `reports(type='client', user_id IS NOT NULL) × status × is_read` 건수(R6-X1 수정의 영향 규모, R6-X7 `미확인` 해소 — 이메일·내용 비조회) | [조사 07] §1, [조사 02] §4 `미확인` 2, [조사 03] §5.2 |
| TD13 | **실행 경로**: SSH 선례(서버에서만 DB 도달, `.env.dev` 의 `DATABASE_URL` 환경변수로 읽기, `set -x` 금지, 임시 파일 `umask 077` 후 삭제). SSM 등록은 SDD-210 범위로 두고 묶지 않음 | [조사 07] M0-D3 |
| TD14 | **롤백**: 모든 Task 는 코드 revert 로 되돌린다. DB 변경 0. 마이그레이션 수정 P0 는 신규 빈 DB 에서만 동작이 달라짐 | `기획.md` §12 |
| TD15 | **커밋·푸시**: 격리 worktree 에서 `test(sdd-211):`/`feat(sdd-211):`/`fix(sdd-211):` 로 Task 단위 로컬 커밋, **푸시는 I1 에서만**(RED 상태 커밋이 CI 에 올라가지 않도록) | SDD-209 선례 |

---

## 3. Task 분해 (28개)

규모: **S** ≤ 45분 · **M** 45~90분. 모두 테스트 먼저(RED→GREEN). 트랙: **G** 기준선 · **C** 계약 스냅샷 · **A** 호스트 판정 · **R** 역할 가드 · **X** R6-X1 · **P** PG 스모크 · **T** 용어 · **M** M0 · **I** 통합. 테스트 ID 는 verify.md.

### 3.1 선행 게이트·안전망 (Wave 0 — 변경 Task 보다 먼저)

| Task | 내용 | 소유 파일 | 테스트(verify) | 완료 기준 | 선행 | 규모 |
|---|---|---|---|---|---|---|
| G0 | **기준선 측정**: 전체 `pytest -q`(CI 제외 항목 동일)·`npx vitest run`(전체)·`npx tsc -p tsconfig.app.json --noEmit`·`npx eslint src/` 결과와 **실패 목록**을 기록. 작업 트리 타인 미커밋 변경(`designs/class-structure-redesign/` 등) 확인·불간섭 | `specs/sdd-211-class-structure-phase0/baseline.md`(신규) | G1·G2·G3 입력 | 통과/실패 건수·실패 파일명 확정(프론트 기존 실패 16건 목록 확보) | verify 승인 | S |
| C1 | 계약 비교기 `compat.py`(OpenAPI 서브셋 추출·`$ref` 인라인·가산 전용 비교)·`shape.py`(JSON→형태 트리·호환 비교) + 합성 스펙 단위 테스트 12 | `backend/tests/contract/{__init__,compat,shape}.py`, `test_contract_compat_rules.py` | CS-3 | 규칙표 각 행(삭제/이름변경/타입/널/필수/enum/요청 필수화/새 선택 통과) 합성 입력으로 판정 정확 | G0 | S |
| C2 | OpenAPI 골든 생성 + 계약 테스트 5 + 갱신 스위치(`UPDATE_CONTRACT_GOLDEN`, `CI=true` 거부) + 예외 파일 형식·만료 검증 | `backend/tests/contract/{conftest.py,test_sessions_openapi_contract.py,golden/sessions_openapi.json,golden/breaking_exemptions.json}` | CS-1·CS-2·CS-4·CS-7·CS-8 | 61 op 집합·가산 호환 통과, 골든 diff 가 현행 동작 박제 | C1 | S |
| C3 | 응답 형태 시나리오 17 + 골든(`join`·`livekit-token`·`markers`·`video/url` 등 미지정 dict, 불투명 필드 내부 키, `enter/verify` 봉인) | `backend/tests/contract/{shape-scenarios}`: `test_sessions_response_shapes.py`, `golden/sessions_shapes.json` | CS-5·CS-6·CS-9·CS-10 | 17 시나리오 통과, 변이 주입 시 실패 | C2 | M |
| A0 | **호스트 판정 특성화 테스트**(현행에서 통과해야 하며 이후 변경 금지): 액션별 비호스트 403 + detail, 기관 비활성 409(B 계열)·통과(A/C 계열), org_admin/platform_admin 403, 숨김 404·제거 참여자 403, 스위프 경로, 비참여자 403, 우선순위, 기존 공백 7(end·save-as-template·markers·PUT record·audio chunk/stop·video stop·approve_report) | `backend/tests/test_sdd211_authz_characterization.py`(신규) | AZ-1~AZ-8 | 현행 코드에서 전부 GREEN | G0 | M |
| T0-FE | **내비 라벨/배지 특성화**: 4역할 `SidebarNav`·`layout/BottomTabBar`·`client/BottomTabBar` 렌더 `[href, 텍스트(배지 제외)]` 골든 배열, 배지 현행값(`sessionInvites` 0/3/10 → 없음/3/9+, 채팅·리포트·알림, 드로어 경로) | `frontend/tests/nav-labels-characterization.test.tsx`(신규) | TM-1·TM-2 | 현행 코드에서 GREEN | G0 | S |
| T0-BE | **서버 문구 특성화**: `notify_event` 캡처로 알림 제목/본문(open/start/end/cancel, 생성 2변형, 수정, 직접 취소, 초대 2경로, 제외, 대기 승격, 리마인드; **제목 없는 세션 fallback 포함**) 골든 + 유형 라벨 3함수 × 5유형 | `backend/tests/test_session_terms_characterization.py`(신규) | TM-10 | 현행 코드에서 GREEN | G0 | M |
| X1 | **회원 리포트 가시성 테스트(RED)** T1~T16 + 개정 대상 기존 테스트의 **개정표 확정**(§5.2). 구현 전 기준(현행 노출 재현 포함)을 로컬 증거로 기록 | `backend/tests/test_sdd211_member_report_visibility.py`(신규) | RX-1~RX-16 | 신규 테스트 중 노출 관련은 RED, 회귀 고정(PDF·토큰·staff)은 GREEN | G0 | S |
| P0 | **`30c1bfbc724f` 멱등화**: 존재 검사 가드, 필요분 4건 보존. 수정 전 빈 DB 실패 재현 로그·수정 후 통과·스키마 대조 | `backend/alembic/versions/30c1bfbc724f_add_updated_at_to_qualifications_and_.py` | PG-2·PG-3·PG-4 | 로컬 임시 PG 16 에서 빈 DB `upgrade head` 성공, 테이블 62(+`alembic_version`) | G0 | S |

### 3.2 호스트 판정 단일화 (A) — BE-worker 1

| Task | 내용 | 소유 파일 | 테스트 | 완료 기준 | 선행 | 규모 |
|---|---|---|---|---|---|---|
| A1 | `session_authz.py`: 정책표(액션 enum 25), `get_session_authorized`/`authorize_session`, 단위 테스트(액션×주체 매트릭스) | `app/services/session_authz.py`(신규), `backend/tests/test_session_authz.py`(신규) | AZ-9 | 단위 GREEN, 특성화 A0 무수정 GREEN(아직 호출부 미교체) | A0 | M |
| A2 | **저위험 순 교체**: ① `audio_service`(3) → `video_service`(3) → `report_service.generate_report`(1) → `record_service.update_record`(1) ② `session_email_invite_service`(2, 문구 상이) ③ 계열 D: `record_service` 3곳 → `session_service._get_session_for_user`/`_for_participant`(WS shim 유지). 교체마다 로컬 커밋 + A0 + 해당 파일 기존 테스트 | `app/services/{audio_service,video_service,report_service,record_service,session_email_invite_service}.py`, `app/services/session_service.py`(계열 D 부분) | AZ-1~AZ-8·AZ-10·AZ-12 | A0 무수정 GREEN, 기존 테스트 GREEN | A1 | M |
| A3 | **계열 B 교체(마지막)**: `session_service` 내부 12곳 + 외부 4곳(`app/api/v1/session.py:631,703`, `session_invite_service.py:53`, `research_consent_service.py:243`). 기관 검사는 shim 으로 두었다 일괄 교체. 이후 옛 private 헬퍼 호출 0 확인 → 삭제, `record_namespace.py:59` import 를 새 함수로 | `app/services/{session_service,session_invite_service,research_consent_service}.py`, `app/api/v1/session.py`, `app/ws/record_namespace.py` | AZ-1~AZ-12 | 정적 검사(복제 헬퍼 정의 0, 호출 0) + A0·기존 전체 GREEN, 계약 골든(C3) GREEN | A2, C3 | M |

### 3.3 역할 가드 (R) — BE-worker 1 (A3 뒤 같은 파일 `app/api/v1/session.py`)

| Task | 내용 | 소유 파일 | 테스트 | 완료 기준 | 선행 | 규모 |
|---|---|---|---|---|---|---|
| R1 | 테스트 먼저(RED): client 토큰 5개 라우트 → 403 + 문구, counselor/org_admin 정상, platform_admin(U4 반영), 비로그인 401, 잘못된 body + client → 403(422 아님). 이후 가드 적용. 가드 적용 뒤 **전체 pytest 로 기존 테스트 영향 확정**(role=client 로 세션 생성하던 테스트 발견 시 목록화해 Brian 보고 — 임의로 role 을 바꾸지 않음) | `app/api/v1/session.py`(5 라우트 `Depends`), `backend/tests/test_sdd211_session_role_guard.py`(신규) | RG-1~RG-8 | 5 라우트 403 확인, 기존 테스트 신규 실패 0 | A3, U4 | S |

### 3.4 R6-X1 (X) — BE-worker 1 (`report_service.py` 는 A2 뒤)

| Task | 내용 | 소유 파일 | 테스트 | 완료 기준 | 선행 | 규모 |
|---|---|---|---|---|---|---|
| X2 | TD5 ①~④ 적용. X1 RED 가 GREEN 으로, 개정표의 기존 2 테스트 개정 | `app/services/report_service.py`, `app/api/v1/client_portal.py`, 기존 테스트 2개(개정표 범위만) | RX-1~RX-16 | X1 전부 GREEN, 개정표 외 기존 테스트 무수정 GREEN, PDF·토큰·staff 회귀 GREEN | A2, X1, U1 | S |
| X3 | 프론트 안내(U2 반영): 승인 전 완료 클래스 "리포트 보기"·알림 이동 시 모달이 던지는 `리포트를 찾을 수 없습니다`(`fe/pages/client/ClientReportDetailModal.tsx:37`, **확인**) 를 중립 안내 문구로 교체. 목록 테스트(`client-report-list.test.tsx`)·모달 테스트(`client-report-modal.test.tsx`)를 U1 결정에 맞춰 조정. **새 문구는 용어 가드(`세션\|수업\|오픈`) 0건** | `fe/pages/client/ClientReportDetailModal.tsx`(필요 시 `fe/pages/client/ClientReportListPage.tsx`), `frontend/tests/client-report-{list,modal}.test.tsx` | RX-17·RX-18·TM-9 | 신규 문구 1종 외 문구 변경 0, 프론트 테스트 GREEN | X2, U2 | S |

### 3.5 PG 스모크 (P) — BE-worker 2

| Task | 내용 | 소유 파일 | 테스트 | 완료 기준 | 선행 | 규모 |
|---|---|---|---|---|---|---|
| P1 | `backend-pg-smoke` 잡(`postgres:16`, 최소 패키지 설치, `alembic heads`==1, 빈 DB `upgrade head`, `alembic_version`==head). 임시 브랜치에서 일부러 깨뜨린 리비전으로 잡이 **실패**함을 1회 확인(머지 금지) | `.github/workflows/ci-feature.yml` | PG-1·PG-2·PG-7·PG-9·PG-11·PG-12 | 잡 GREEN, 실패 주입 시 RED | P0 | S |
| P2 | **스키마 전용 덤프 픽스처 + 합성 시드 + 위생 가드**: dev 에서 `pg_dump --schema-only --no-owner --no-privileges`(+`alembic_version` 한 행)로 `backend/tests/fixtures/pg/baseline_e036a0000051.sql`. **dev DB 읽기(메타데이터)가 필요 → Brian go 후 SSH 절차**. 합성 시드(`@example.com`, 이름 `테스트`)는 사람이 작성. CI: 위생 grep(`^(COPY|INSERT INTO)` alembic_version 제외 0건), 복원→시드→`upgrade head`. 덤프 스키마 vs 빈 DB 체인 스키마 **1회 diff 보고**(F8 의 드리프트 크기 확인) | `backend/tests/fixtures/pg/*.sql`(신규), `ci-feature.yml`(잡 단계) | PG-5·PG-6 | 복원+시드+upgrade 성공, 위생 0건, diff 보고 | P1, Brian go | M |
| P3 | `pg` 마커 하네스(`DATABASE_URL` 이 PG 일 때만 실행되는 `tests/pg/` 픽스처) + 샘플 제약 테스트 2: `uq_sessions_active_access_code` 활성 중복 거부·종료 후 재사용 허용, 모델 `postgresql_where`/`sqlite_where` 번역 일치 | `backend/tests/pg/{conftest.py,test_pg_constraints.py}`(신규), `backend/pytest.ini` 또는 `conftest` 마커 등록, `ci-feature.yml` | PG-8 | PG 잡에서 2개 통과, SQLite 기본 `pytest -q` 에서는 skip | P1 | S |
| P4 | `alembic check` 정보성 단계(`continue-on-error`) + 감지 건수 로그 + 후속 정리 목록(`investigation/04` §6 ≈12건 드리프트)을 summary 로 | `ci-feature.yml` | PG-10 | 잡 비실패, 건수 기록 | P1 | S |

### 3.6 용어 사전 (T) — FE-worker (T4 만 BE-worker 1, A3 뒤)

| Task | 내용 | 소유 파일 | 테스트 | 완료 기준 | 선행 | 규모 |
|---|---|---|---|---|---|---|
| T1 | `fe/lib/terms.ts` + 골든 일치 테스트(모든 키·영역 값 == 현행 리터럴 복사본, 키 개수 고정, 미지 키 방어) | `fe/lib/terms.ts`(신규), `frontend/tests/terms.test.ts`(신규) | TM-3 | GREEN | T0-FE | S |
| T2 | 3개 파일 내비 항목에 안정 `key` 부여, `getBadge`/탭 배지 비교를 키로, 렌더는 `term(key)`. `label ===` 0건. **배지 계산식 통합 금지** | `fe/components/layout/SidebarNav.tsx`, `fe/components/layout/BottomTabBar.tsx`, `fe/components/client/BottomTabBar.tsx`, `frontend/tests/nav-badge-by-key.test.tsx`(신규) | TM-1·TM-2(무수정 통과)·TM-4·TM-5·TM-6·TM-9 | T0-FE 무수정 GREEN, 키-배지 결합·드로어·정적 검사 GREEN | T0-FE, T1 | M |
| T3 | 금지어 JSON 3종 + `lib.mjs` 합성(`composeBanned`, `copyConfig(area)`, `scanSources(…, area)`) + `class-flow-shell-terms.test.ts` 영역 구조화 + 사전 값 가드 + counseling 규칙 단위 테스트 | `frontend/e2e/class-flow/banned/{common,meditation,counseling}.json`(신규), `frontend/e2e/class-flow/lib.mjs`, `frontend/tests/class-flow-shell-terms.test.ts`, `frontend/tests/terms-guard.test.ts`(신규) | TM-7·TM-8·TM-9 | `composeBanned('meditation') === 현행 원문`, 기존 가드 동작 불변 | G0 | S |
| T4 | `app/services/session_terms.py` + 호출부 치환(`session_service`·`session_invite_service`·`reminder_service`·`agent_policy`·`report_comment_service`). 변수·호출 순서·DB·응답 스키마 불변(문자열 치환만) | `app/services/session_terms.py`(신규), 호출부 5개 파일, `backend/tests/test_session_terms.py`(신규) | TM-10(무수정 통과)·TM-11·TM-12·TM-13 | T0-BE 무수정 GREEN, 기존 `test_sdd097_*`·`test_sdd209_b7_*`·`test_notification_outbox` GREEN | T0-BE, A3 | M |

### 3.7 M0 사전 조회 (M) — BE-worker 2 (M2·M3 는 Brian 승인 단계)

| Task | 내용 | 소유 파일 | 테스트 | 완료 기준 | 선행 | 규모 |
|---|---|---|---|---|---|---|
| M1 | `m0-prequery.sql`(A1~A11, B0, C2~C4, C6 기준선 재전개)와 `m0-prequery.py`(읽기 전용 3중 강제 러너). 러너 단위 테스트(INSERT·`WITH`·금지어·`;` 분할). **빈 PG(alembic 적용본, 실데이터 없음)에서 모든 질의 `EXPLAIN`** 으로 컬럼·문법 검증. 리뷰어 체크리스트 R0~R10 기록, sha256 기록 | `specs/sdd-211-class-structure-phase0/m0-prequery.{sql,py}`, 러너 테스트(`backend/tests/test_sdd211_m0_runner.py`) | M0-1~M0-4 | 체크리스트 통과 기록, EXPLAIN 오류 0 | P1(PG 하네스) | M |
| M2 | **수동 RDS 스냅샷**(dev, 명령 단위 Brian 승인 후). 이름 `mindbreeze-dev-pre-classrestructure-m0-YYYYMMDD`, 태그, `available`/암호화 여부 기록. 템플릿은 [조사 07] §4.3 | (코드 없음) 기록: `m0-report.md` 스냅샷 표 | M0-5 | `Status=available`, `Encrypted=false` 기록, ID 가 Linear·보고서에 기재 | M1, Brian 승인 | S |
| M3 | **감독 실행·보고**(Brian go + 배포·E2E 비실행 시간 확인 후): SSH 선례 절차로 단일 REPEATABLE READ 패스 실행 → 출력 회수 → 서버 임시 파일 삭제 → 소량 셀 억제 적용 `m0-report.md` → 102 vs 134 판정 → D-55/56/57 영향 예·아니오 → Brian 수령 확인 | `specs/sdd-211-class-structure-phase0/m0-report.md`(신규) | M0-6~M0-11 | verify §3.7 수락 조건 전부 | M2, Brian go | S |

### 3.8 통합 (I)

| Task | 내용 | 소유 | 테스트 | 완료 기준 | 선행 | 규모 |
|---|---|---|---|---|---|---|
| I1 | 전체 회귀(pytest 전체·vitest 전체·tsc·eslint·build) → 기준선 대비 신규 실패 0 → worktree 에서 **푸시**(`sdd/211-phase0` → PR → develop) → CI(프론트·백엔드·PG 잡) 확인 → dev 자동 배포 → `e2e-smoke.yml`(smoke·journeys·regressions·full-journey) 통과 → 배포 후 계약 스냅샷 재확인 → 수동 호출 절차(§6.2 [조사 03])는 **별도 승인** 후 실행 | 없음 | G·VR 전부 | 합격표 전 항목 체크 | 코드 Task 전부 | M |
| I2 | `summary.md`(구현 결과·디버깅·테스트·SDD-210 인수사항), Linear SDD-211 코멘트에 spec·plan·verify·summary·`m0-report` 게시, `brief.md`/investigation 정리 | `specs/sdd-211-class-structure-phase0/summary.md` | 해당 없음 | 4종 존재 | I1, M3 | S |

**Task 합계: 28개** — 트랙별 G 1(G0) · C 3(C1~C3) · A 4(A0~A3) · R 1(R1) · X 3(X1~X3) · P 5(P0~P4) · T 6(T0-FE·T0-BE·T1~T4) · M 3(M1~M3) · I 2(I1·I2). 규모별 S 17 · M 11. 3.1 표(9개: G0·C1~C3·A0·T0-FE·T0-BE·X1·P0)는 Wave 0 안전망이고 나머지 19개가 Wave 1~2 이다.

---

## 4. 파일 소유권 · 병렬 계획

### 4.1 워커와 소유 영역 (한 파일은 한 소유자만 수정)

| 워커 | Task | 소유 파일 |
|---|---|---|
| **BE-1** (직렬) | G0, A0, A1, A2, A3, R1, X1, X2, T0-BE, T4 | `session_authz.py`, `session_service.py`, `audio_/video_/record_/report_/session_email_invite_/session_invite_/research_consent_service.py`, `app/api/v1/session.py`, `app/ws/record_namespace.py`, `client_portal.py`, `reminder_service.py`, `agent_policy.py`, `report_comment_service.py`, `session_terms.py` 및 해당 신규 테스트 |
| **BE-2** | C1~C3, P0~P4, M1, M2, M3 | `backend/tests/contract/**`, `backend/tests/pg/**`, `backend/tests/fixtures/pg/**`, `.github/workflows/ci-feature.yml`, `alembic/versions/30c1bfbc724f_*`, `m0-prequery.*`, `m0-report.md` |
| **FE-1** | T0-FE, T1, T2, T3, X3 | `fe/lib/terms.ts`, `SidebarNav.tsx`, 두 `BottomTabBar.tsx`, `ClientReportDetailModal.tsx`, `frontend/e2e/class-flow/{lib.mjs,banned/**}`, 프론트 신규/수정 테스트 |
| **I** | I1, I2 | 푸시·PR·summary |

### 4.2 직렬 의존 (충돌 지점)

- `session_service.py`: A2(계열 D) → A3(계열 B) → T4(문구 치환). **같은 워커가 순서대로.**
- `app/api/v1/session.py`: A3(호출 교체 `:631,:703`) → R1(5 라우트 `Depends`).
- `report_service.py`: A2(`generate_report` 교체 `:276`) → X2(`list_reports`·`get_report`·`mark_all_read`).
- `ci-feature.yml`: P1 → P2 → P3 → P4(같은 잡에 단계 추가).
- 병렬 가능: BE-1(A0 → …) ∥ BE-2(C·P·M) ∥ FE-1(T·X3). C3 는 A3 보다 반드시 먼저 커밋(골든 = 변경 전 동작).

### 4.3 병합·커밋 순서

Wave 0 (verify 승인 직후) `G0` → { `C1→C2→C3`, `A0`, `T0-FE`, `T0-BE`, `X1`, `P0→P1` } → Wave 1 `{A1→A2→A3→R1, X2, T4}` ∥ `{T1→T2, T3, X3}` ∥ `{P2, P3, P4, M1}` → Wave 2 `M2 → M3`(Brian 승인) · `I1 → I2`. 특성화·골든 테스트는 이후 구현 커밋에서 **수정 금지**(verify G7).

---

## 5. 변경되는 현행 동작

### 5.1 체감 변화 (사용자에게 보이는 것)

| # | 현행 | 변경 후 | 영향 대상 | 근거 |
|---|---|---|---|---|
| 1 | 회원이 승인 전·생성 중·실패 리포트를 목록·상세·홈 카드로 볼 수 있음(상담사 초안 코멘트 포함) | **승인(`completed`) 후에만** 보임. 목록 총계·홈 카드·읽음 처리 정합. 타 참여자 403 계약 유지 | 자동 승인을 켜지 않은 호스트(기본 off)의 모든 회원 | F6, U1 |
| 2 | 완료 클래스에서 "리포트 보기" → 승인 전엔 "리포트를 찾을 수 없습니다" 오류(수정 후 발생) | 중립 안내 1문장(U2). 그 외 문구 변경 없음 | 위와 동일 | [조사 03] §5.2 |
| 3 | `report_generation_failed` 인앱 알림 → 눌러 이동 시 404 가 될 수 있음 | 알림은 유지(U3 기본), 이동 시 U2 안내 | 동일 | [조사 03] 경로 11 |
| 4 | client 토큰으로 세션 생성·복제·수정·템플릿 저장·새 실행 가능(UI 는 막혀 있어 알려진 호출자 없음) | **403** `이 작업을 수행할 권한이 없습니다` | 이론상 직접 API 호출자·미확인 구 앱 번들 | F4, TD4 |
| 5 | client 가 **타인** 세션 PUT 시 403 `host 상담사만 가능합니다` | 403 `이 작업을 수행할 권한이 없습니다`(상태코드 동일, detail 변경) | 동일 | [조사 02] §4.1 |
| 6 | `platform_admin` 이 API 로 세션 생성 가능 | 기본 403(U4) | 운영자 직접 호출(알려진 호출자 없음) | F5 |

### 5.2 기존 테스트 개정표 (구현 전 확정 — verify §5 와 동일)

| 테스트 | 현재 단언 | 개정 | 사유 |
|---|---|---|---|
| `backend/tests/test_mb2_high_severity_fixes.py:177-183` | pending_review 소유 회원 `GET /reports/{id}` → 200 | pending_review → **404**(존재 은닉), 소유자 200 단언은 `completed` 리포트로 이동, 타 참여자 403 단언 **유지** | 정책 변경(U1=A). 노출 허용을 계약으로 고정하던 단언 |
| `backend/tests/test_report_bulk_actions.py:89-108` | 호스트가 generate 한 pending_review 가 회원 목록 `total>=1` | 승인 후 목록 확인으로 순서 변경 | 동일 |
| `frontend/tests/client-report-list.test.tsx:18,59-60` | `sent_at:null` 행이 "대기"로 표시 | U1 결정에 맞춰 조정(U1=A 이면 비승인 행 미표시, B 이면 자리표시자) | 동일 |

이 3건 외 기존 테스트는 **무수정으로 통과**해야 한다.

### 5.3 보이지 않는 변화

호스트 판정 통합(응답 바이트 동일, 특성화 테스트가 증명), 용어 사전(글자 동일), 계약 골든·PG 잡·M0(읽기 전용)은 사용자에게 보이지 않는다. `30c1bfbc724f` 수정은 신규 빈 DB 에서만 동작이 달라진다.

---

## 6. CI 변경

| 항목 | 변경 | 근거 |
|---|---|---|
| 새 잡 `backend-pg-smoke` | `ci-feature.yml` 에 추가(트리거 동일: `develop`·`feature/**`·`fix/**`·`sdd/**` push, `develop` 대상 PR). `postgres:16` 서비스, `timeout-minutes: 10`, `paths` 필터 없음(항상 실행) | [조사 04] §7 |
| 시간 영향 | 로컬 측정: 마이그레이션 적용 ≈1.2초, `alembic heads` 0.16초(PG 16.13, M4). **CI 러너 값은 `미확인`**. 사전 추정 1~2분(컨테이너 기동 10~30초 + 최소 pip + 마이그레이션 2회), 기존 `backend` 잡과 **병렬**이라 wall-clock 증가는 거의 없고 러너 분 소모만 증가(추정). I1 에서 `gh run view --json jobs` 로 단계별 소요 측정 → verify PG-11 | [조사 04] §7.3 |
| `backend` 잡 | 변경 없음. 계약 스냅샷 약 34 테스트는 기존 `pytest -q` 에 자동 포함(추가 약 5~8초 추정, `미확인`) | [조사 05] §6 |
| `frontend` 잡 | 변경 없음(테스트 단계 `continue-on-error` 유지) → 신규 FE 테스트가 실패해도 CI 가 막지 않으므로 verify 가 **로컬/CI 로그에서 해당 파일 pass 를 직접 확인**하도록 요구(T12) | [조사 06] T12 |
| `deploy-dev.yml` | 변경 없음. PG 잡은 `deploy-dev` 의 `needs` 가 아니므로 실패해도 배포가 막히지 않음 → 브랜치 보호의 필수 상태 점검 등록(Brian 수동, 현황 `미확인`)이 있어야 "차단" 이 실현 | F10 |
| `e2e-smoke.yml` | 변경 없음. 배포 후 자동 실행(smoke·journeys·regressions·full-journey) | `deploy-dev.yml:307-310` |
| 스키마 덤프 위생 | PG 잡 안에서 `COPY`/`INSERT INTO`(alembic_version 제외) 0건 검사 | [조사 04] §5 |

---

## 7. 위험 · 롤백

| # | 위험 | 가능성/영향 | 대응 | 롤백 |
|---|---|---|---|---|
| R1 | 호스트 판정 통합이 응답을 바꿈(기관 검사 통일, 문구, 우선순위, `db.get` 필터 우회) | 중/높음 | 특성화 테스트 선행·무수정, 액션별 정책 플래그, `db.query` 유지, 계약 골든 GREEN | 코드 revert |
| R2 | 통합 함수에 role 우회가 들어가 권한 확대 | 낮음/높음 | AZ-3(org_admin·platform_admin 403) 고정 | 코드 revert |
| R3 | R6-X1 수정으로 회원 화면에서 리포트가 사라져 문의 발생(자동 승인 off 호스트의 회원 전원) | 중/중 | U1·U2 결정, 안내 문구, 승인 흐름 불변. 건수는 M0 에 추가 집계 후보 `미확인`(R6-X7) | 코드 revert(데이터 변경 없음) |
| R4 | `report-status`·WS 의 `pending_review` 문자열이 회원에게 계속 노출(내용 아님) | 낮음/낮음 | **Phase 0 에서 변경 안 함** — 호스트 UI 와 공유 필드. 후속(Phase 5) 에서 회원 컨텍스트 분리 | — |
| R5 | 역할 가드로 구 Capacitor 번들·role=client 호스트 세션 보유자의 편집이 막힘 | 낮음/중 | M0 A10 로 role=client 호스트 세션 유무 집계, 가드 적용 후 전체 pytest, 문제 시 가드 revert(독립 커밋) | 코드 revert |
| R6 | `30c1bfbc724f` 수정이 이미 적용된 DB 에 영향 | 낮음/중 | 이미 적용된 DB 는 재실행 안 함(추론). P2 의 dev 덤프 diff 로 확인. 리비전 id·체인 불변 | 코드 revert |
| R7 | PG 잡이 차단 게이트로 작동하지 않음(`deploy-dev` 는 CI 와 독립) | 높음/중 | 브랜치 보호 필수 상태 점검 등록을 Brian 수동 작업으로 요청 | — |
| R8 | 스키마 덤프 픽스처에 개인정보 유입 / 유지 비용 | 낮음/높음 | 스키마 전용·합성 시드·위생 grep, 실데이터 덤프 기각 | 픽스처 삭제 |
| R9 | 계약 골든이 현행 버그를 박제 | — | 의도된 설계(구 앱 호환). 의도적 변경은 예외 파일+리뷰 | — |
| R10 | M0 질의가 개인정보를 노출 / 서버 부하 | 낮음/높음 | 금지 컬럼 체크리스트·바깥 SELECT 정적 검사·읽기 전용 3중·`statement_timeout 15s`·소량 셀 억제·`custom_type_name` 비출력(U6). 공개 저장소이므로 원문 수치는 Brian 비공개 전달 | 해당 없음(읽기 전용) |
| R11 | dev 스냅샷 **비암호화**에 개인·생체 정보 | 낮음/중 | 공유 금지·접근 최소·보관 기간(U7), 삭제 승인 체크 | 스냅샷 삭제(Brian 승인) |
| R12 | 서버 문구 치환이 메일 제목을 바꿈(알림 제목 = 메일 제목) | 낮음/중 | T0-BE 가 제목/본문 골든을 먼저 박제, 서버 사전은 알림 제목·fallback·유형 라벨에 한정 | 코드 revert |
| R13 | 병렬 작업이 `session_service.py` 등에서 충돌 | 중/낮음 | §4.2 직렬 규칙·한 워커 | — |
| R14 | 타인 미커밋 변경(`designs/class-structure-redesign/` 등 untracked)과 섞임 | 중/낮음 | 격리 worktree, `git add` 는 파일 지정, G0 에서 확인 | — |
| R15 | dev 가 현재 실사용자 운영 → R6-X1·가드가 즉시 실사용자에 적용 | 높음/중 | verify 승인 + U1~U4 응답 후에만, I1 에서 E2E 스모크, 필요 시 즉시 revert | 코드 revert |

**롤백 총칙**: 정상 롤백 = 각 커밋 revert(DB 변경 없음). 가시 변경(X2·X3, R1)은 독립 커밋이므로 개별 revert 가 가능하다. `deploy-dev.yml` 롤백 트랩이 `dist`·`backend/app`·`backend/alembic` 을 복원하므로 `30c1bfbc724f` 수정도 함께 복원된다(스키마 영향 없음).

---

## 8. 배포 순서

1. **verify 승인**(Brian) + 사용자 결정 U1~U7·확인 C1 응답(또는 기본값 수락).
2. 격리 worktree `sdd/211-phase0` 에서 Wave 0 → Wave 1 (로컬 커밋, **푸시 금지**).
3. I1: 전체 회귀 → 푸시 → PR(develop 대상) → CI 3잡 GREEN → 머지 → `deploy-dev.yml` 자동 배포(릴리스 1) → `e2e-smoke` 통과 → 계약 스냅샷 재확인.
4. M0: M2(스냅샷, 명령 승인) → M3(감독 실행·보고). **분류 규칙 승인은 별개의 Phase 1 진입 게이트**(보고만으로 승인된 것이 아님).
5. I2: summary·Linear. Brian 최종 리뷰(Stage ⑦).
6. **prod 반영**은 SDD-210 의 `release-build`→Brian 승인→`deploy-prod` 경로를 따른다(Phase 0 자체는 prod 에 직접 배포하지 않음). 순서는 §9.

DB 마이그레이션 배포 0건(신규 리비전 0). 배포 중 `in_progress` 세션 영향 없음(스키마 변경 없음).

---

## 9. D-60 — SDD-210 prod 컷오버와의 선후 확인 결과

| 확인 항목 | 결과 | 근거 |
|---|---|---|
| SDD-210 상태 | spec·plan·verify **작성 완료, Brian 승인 대기, 구현 착수 금지** | `specs/sdd-210-prod-environment/spec.md:3` |
| 컷오버 일정 | **미확정** — 일시·공지는 Brian 결정 B-7(제안: 평일 야간 02:00~03:00 KST), 개인정보처리방침 게시(N-6)가 컷오버 진행 필수 조건 | `plan.md:317`, `spec.md:59,80` |
| **선후** | **`미확인`** (일정이 정해지지 않았으므로 확정 불가) | — |
| Phase 0 의 의존 | **없음.** Phase 0 은 DB 스키마를 바꾸지 않으므로 컷오버 전·후 어느 쪽에서도 독립적으로 진행·롤백 가능 | spec.md 범위 |
| **선후가 실제로 영향을 주는 곳** | Phase 1 의 M2(백필 apply) 위치와 prod 리허설 범위 — 컷오버 일정 확정 후 Phase 1 plan 에서 결정(D-60 의 본래 질문) | `기획.md` §14 #13, `R7:285` |
| 상호작용 ① | SDD-210 **T-15**(빈 DB 에 `alembic upgrade head` 리허설, `plan.md:202`)는 **현재 첫 단계에서 실패**(F8). SDD-210 의 "85개 체인"은 84개(`__pycache__` 포함 오계수). → **P0·P1 을 먼저 병합**해야 T-15 가 의미를 가짐. 이 사실은 SDD-210 문서를 수정하지 않고 Brian 에게 알린다(이 SDD 의 쓰기 범위 밖) | [조사 04] F5·F6 |
| 상호작용 ② | R6-X1 수정·역할 가드는 dev(현재 실운영)에 먼저 반영되고, 컷오버 시 dev 스냅샷 복원본에 코드가 포함된 릴리스 후보로 이전됨. **릴리스 후보 SHA 동결(`plan.md:232`) 전**에 반영하면 T-15/T-17 리허설이 이 동작까지 검증 | `plan.md:232` |
| 상호작용 ③ | SDD-210 은 dev 외부 발송 차단·dev 비식별화(D9)를 컷오버 후 수행. M0 조회(dev, 읽기 전용)와 수동 스냅샷(비암호화)은 그 **전**에 끝내는 것이 안전 | spec.md §3-5 |
| 권고(기본값) | Phase 0 을 SDD-210 구현 착수와 **독립으로** 진행하되, **P0·P1(마이그레이션 멱등화 + PG 스모크)을 우선 병합**. 컷오버 일정(B-7) 확정을 Brian 에게 요청 → Phase 1 의 M2 위치 결정 | — |

---

## 10. 구현 전 미확정 (확인하지 못한 것)

1. **구 Capacitor 앱 번들**이 client 토큰으로 `POST/PUT /sessions…` 를 호출하는지 — 번들 접근 불가([조사 02] §2.3). M0 A10 으로 role=client 호스트 세션 유무만 집계 가능.
2. 운영/개발 DB 의 **승인 전 회원 리포트 건수·열람 이력**(R6-X7), 자동 승인 사용 비율 — 조회 금지로 `미확인`. M0 의 **A11**(리포트 상태×읽음 건수)이 건수를 해소(자동 승인 사용 비율은 `users.auto_approve_report` 집계를 A11 변형으로 추가할 수 있으나 호스트 단위 소량 셀이라 U5 억제 규칙 적용).
3. 102→134 증분 32건의 구성, SDD-210 134 의 질의 원문, DB 시간대(B0 로 확인) — M3 판별 질의 결과로만 확정.
4. dev 서버 `alembic current`·스키마 상태(`30c1bfbc724f` 적용 이력, dev 와 빈 체인 DB 의 스키마 차이 ≈12건 드리프트), 실제 dev 스키마 덤프 크기 — P2 에서 확인.
5. **CI 러너 소요 시간**·기존 `backend` 잡 소요·러너 `psql` 유무·브랜치 보호 규칙/CODEOWNERS — I1 측정.
6. 데이터 의존 마이그레이션 가드(`e036a0000044` 활성 코드 중복 시 중단, `…030` 정규화 충돌 시 중단, `…026` dedup)는 **head 고정 픽스처에서 실행되지 않음** — 이 가드를 데이터와 함께 검증하는 방법은 과거 리비전 시점 덤프가 필요(PITR 복원, SDD-210 T-17 영역). Phase 0 범위 밖.
7. 프론트 기존 실패 16건의 파일명, `class-flow/selftest.mjs`·`fit.mjs`(Playwright 필요, CI 미연결)의 현재 통과 여부 — G0 에서 가능한 범위만 측정.
8. Capacitor 앱의 푸시 제목 변환 여부, 채팅 `or "세션"`(`chat_service.py:686`) 사용자 노출 여부 — Phase 2.
9. 서버의 `psql` 설치·SSH 키 현재 위치·`DBInstanceIdentifier` CLI 출력값·단일 AZ 스냅샷 시작 시 I/O 영향 — M2·M3 실행 단계에서 확인.
10. `users.role` DB 제약(CHECK/Enum) 유무, 백엔드 어디에도 `role == "admin"` 이 없는지.
11. R6 이탈 참가자 목록/상세 불일치(R6-X2), `core/database.py:16-44` 전역 필터가 회원 리포트 JOIN 에 실제 적용되는지(실행 미검증).
12. `db.get(Session, id)` 가 전역 숨김 필터를 우회하는지(실행 미검증, TD1 은 `db.query` 유지로 회피), 동적 접근(`getattr` 등)으로 호스트 헬퍼를 쓰는 곳(이름 기준 grep 으로만 전수).

---

## 11. 사용자 결정 필요 (비즈니스·정책만, 기본값 포함)

기본값대로 가면 "**기본값대로**"라고만 답하면 된다(`결정-필요.md` 관례: 기본값 진행 허용). 단 U1~U4 는 사용자에게 보이는 변경이므로 verify 승인 때 명시 확인한다.

| ID | 질문 | 옵션 | **기본값** | 영향 | 차단 Task |
|---|---|---|---|---|---|
| **U1** | 승인 전 리포트를 회원 화면에서 어떻게 처리할까요? | **A 행 자체 숨김** / B "승인 대기" 자리표시자 행을 보이되 본문·열람 불가(SDD-118 의 "대기" 배지 의도에 가까움, 응답 수준 마스킹이 필요해 범위 증가) | **A** | 회원 화면, X2·X3, 테스트 개정표 | X2, X3 |
| **U2** | 승인 전 "리포트 보기"·알림 이동 시 무엇을 보여줄까요? | **중립 안내 1문장**(제안 문구: `아직 전달된 리포트가 없어요. 확인이 끝나면 알려드릴게요.`) / 버튼 비활성+문구 / 현행 오류 유지 | **중립 안내 1문장** | 새 문구 1종(용어 가드 통과 필수) | X3 |
| **U3** | 리포트 생성 **실패** 인앱 알림(`report_generation_failed`)을 회원에게 계속 보낼까요? | **유지(내용 노출 아님)** / 회원 대상 중단(호스트에게만) | **유지** | 알림 정책 | — (변경 시 X2 범위 확대) |
| **U4** | `platform_admin` 이 API 로 세션을 만들 수 있게 둘까요? | **차단**(기획서의 `counselor`·`org_admin` 한정) / 허용(현행 유지) | **차단** | 운영자 직접 호출 이력은 `미확인` | R1 |
| **U5** | M0 보고서(공개 저장소에 커밋)의 소량 셀 처리는? | **사람·기관 단위 셀(A5·A6·A7b·A8·C3b)만 `<3` 억제, 원본 수치는 Brian 에게만 비공개 전달** / 억제 없이 커밋 / 전부 비공개 | **사람·기관 단위만 억제** | 재식별 위험 | M3 |
| **U6** | `custom` 유형의 **자유 입력 라벨 원문**을 확인할까요? (호스트가 입력한 ≤30자, 사람 이름 가능) | **1단계만**(건수·키워드 분류·빈도 분포, 라벨 비출력). 원문(A4d)은 필요할 때만 Brian 입회 하 화면 출력 전용·기록 금지 / 원문 미확인(호스트 확인 질문으로 대체) | **1단계만** | D-56 분류 정확도 | M3 |
| **U7** | 수동 RDS 스냅샷(**비암호화**, 개인·생체 포함)의 보관과 암호화 사본은? | **M5 호환 윈도우 종료(≥30일) + Brian 삭제 승인까지 보관, 암호화 사본은 만들지 않음(SDD-210 컷오버 전용)** / 짧게 보관 후 삭제 | **기본값** | 개인정보 보관 | M2 |
| **C1** (확인 요청) | **SDD-210 컷오버 일정(B-7)** 이 정해지면 알려주세요. 정해지면 Phase 1 의 M2(백필 apply) 위치를 확정합니다. 지금은 Phase 0 이 독립이라 차단은 아닙니다 | — | 일정 확정 시 통보 | Phase 1 plan | — |

별도 알림(결정 아님): ① SDD-210 T-15 는 현재 첫 단계에서 실패(리비전 `30c1bfbc724f`)하며 이 SDD 의 P0·P1 이 해소 ② 브랜치 보호 필수 상태 점검 등록은 Brian 수동 작업 ③ P2(dev 스키마 덤프)·M2(스냅샷)·M3(조회) 실행은 각각 Brian go 가 필요하다(읽기 전용이지만 dev=실운영 DB).

---

## 12. 조사 문서 색인

| 문서 | 내용 |
|---|---|
| `investigation/01-host-authorize.md` | 복제 헬퍼 9곳 전수·동작 차이 D1~D8·`authorize_session` 설계·액션 표·테스트 공백 |
| `investigation/02-role-guard.md` | 생성·수정 라우트 Depends·client 호출자 전수·`require_roles`·role 문자열 값·403 형식 |
| `investigation/03-r6x1-pending-review.md` | 경로별 노출 판정 20행·테스트 현황·수정안·테스트 16개·dev 호출 절차(미실행) |
| `investigation/04-ci-pg-smoke.md` | 리비전 체인·빈 DB 실패 원인·PG 전용 DDL·덤프 픽스처 옵션·잡 설계 |
| `investigation/05-contract-snapshot.md` | 61 라우트 집계·미지정 8개·골든 설계·가산 전용 규칙·테스트 ≈34 |
| `investigation/06-terms-keys.md` | 비교식 10개·배지 계산식·가드 분리·서버 문구·`session_terms.py` 골격·특성화 증명 |
| `investigation/07-m0-prequery-design.md` | A1~A9 SQL(모델 검증, A10·A11 은 이 plan 이 추가)·읽기 전용 3중 강제·102 vs 134 가설·스냅샷 절차 |

---

## 13. 사용자 결정 확정 기록 (Brian, 2026-10-18)
| ID | 확정 | plan 영향 |
|---|---|---|
| U1 | 승인 전 리포트는 **목록에서 보이되 상태를 `리뷰 중`으로 표시**(숨기지 않음). 본문·상담사 코멘트 초안은 열람 불가 | 기본값 A(행 숨김) → **B(자리표시자 행)로 변경**. TD5 재설계 필요: 목록/홈 카드 응답에서 미승인 건은 본문·코멘트·내용 필드를 마스킹하고 `status`(`리뷰 중`)만 노출, 상세 조회(`GET /reports/{id}`)는 미승인이면 본문 없이 상태 안내만 반환(또는 404가 아닌 마스킹 응답). 응답 스키마 가산·마스킹이 생기므로 구 계약 골든(TD8)에 예외 항목 등록. 개정 테스트표(RX)와 verify 재확정 필요 |
| U2 | U1 변경에 맞춰 재정의: `리뷰 중` 항목을 열면 `리뷰 중이에요. 확인이 끝나면 알려드릴게요.` 안내(문구는 plan 에서 제안, 용어 가드 통과) | 문구 1종 |
| U3 | 기본값 유지(생성 실패 알림 유지) | — |
| U4 | **platform_admin 의 API 세션 생성 허용** | TD4 역할 가드를 `counselor`·`org_admin`·`platform_admin` 3역할로 변경, 기본값(차단) 폐기 |
| U5 | 확인 대기 (아래 질문) | M3 보류 |
| U6 | 자유 입력 라벨 **원문은 플랫폼 관리자에게 공개**(조회 허용) | 원문 열람 경로를 플랫폼 관리자 화면/조회로 허용. 라벨 원문은 저장소 커밋 보고서에는 여전히 넣지 않음(공개 저장소) |
| U7 | 기본값(≥30일·삭제 승인까지 보관) | — |

### 13.1 추가 확정 (Brian, 2026-10-18)
- **U5 = A**: 분포 보고서는 전체 합계·분포만 저장소에 커밋하고, 사람·센터 단위 상세 표는 커밋하지 않고 Brian 에게만 전달. 소량 셀 억제 기준 불필요.
- **U6 보정**: "플랫폼 관리자" = Brian 과 그 대리인들(`platform_admin` 역할 보유자 전체). 라벨 원문 열람은 이 역할에 허용.
- **신규 요구(리포트 몰림 대응)**: 리포트 생성이 한꺼번에 몰리면 부하가 크므로 **큐 방식으로 처리**한다. 현황(코드 확인): STT → 요약 → `generate_reports_for_session` 이 Celery chain 으로 이미 비동기 실행되지만(`audio_service.py:215-228`, `report_task.py:704`), 리포트 전용 큐·워커 동시성·우선순위·상한·적체 가시화 설계는 없음(`celery_app.py:41` task_routes 는 `exports` 만 분리, 워커는 `mindbreeze-worker` 단일). → **Phase 0 범위에서 제외하고 별도 항목(리포트 생성 큐 분리·동시성·적체 모니터링·세션 종료 일괄 몰림 완화)으로 설계**. 선행 조사 후 SDD 번호 부여.
