# SDD-211 Verify — 구현 전 QA 체크리스트 (Stage ③, 구현 전 게이트)

> **구현 후 완화 금지.** 이 문서는 구현 시작 전에 확정한다. 구현 중·후에 항목을 삭제·완화·예외 추가하지 않는다. 기준에 못 미치면 기준을 고치지 말고 구현을 고치거나, **선택지와 비용을 제시해 Brian 승인을 받은 뒤** 하단 `변경 이력`에 사유와 함께 반영한다. 사후 작성 금지(`CLAUDE.md` 7-Stage SDD).
> 근거: `spec.md` · `plan.md`(Task·확정 결정 U1~U7·확인 C1·§13/§13.1 확정 기록) · `investigation/01~07` · `기획.md` §13 · SDD-209 verify 형식.
> 표기: 모든 확인 항목은 `[ ]` 체크박스. 판정 코드: **U**=단위 **B**=백엔드 pytest **F**=프론트 vitest **C**=CI 잡 **E**=dev E2E **M**=수동(Brian 입회·승인) **S**=정적 검사(grep·diff).
> **확정 결정 전제 (2026-10-18, plan §13·§13.1)**: RX(리포트 가시성)는 **U1=B**(미승인 리포트 `리뷰 중` 행 노출 + 본문·코멘트 초안·오류 원문 마스킹) · **U2**(안내 `리뷰 중이에요. 확인이 끝나면 알려드릴게요.`) · **U3**(생성 실패 알림 유지), RG(역할 가드)는 **U4**(`counselor`·`org_admin`·`platform_admin` 허용, `client` 만 차단), M0는 **U5=A**(전체 합계·분포만 커밋, 사람·센터 단위 표 비커밋)·**U6**(자유 입력 라벨 원문은 `platform_admin` 역할 보유자에게만, 커밋 보고서 제외)·**U7**(스냅샷 기본값) 기준이다. 이 기준이 바뀌면 구현 **전에** 해당 행을 개정해 `변경 이력`에 기록한다.

## 0. 검증 층과 실행 명령

| 층 | 이름 | 실행 | 대상 |
|---|---|---|---|
| V-B | 백엔드 | `cd backend && pytest -q --tb=short --ignore=tests/test_sprint4_integration.py --deselect=tests/test_sdd070_pdf_metrics.py::test_real_pdf_metric_pages` (CI 와 동일 제외) | AZ·RG·RX·CS·TM-10~12·M0-4 + 기존 전체 |
| V-F | 프론트 | `cd frontend && npx vitest run <파일>` 및 전체 `npx vitest run` | TM-1~9·RX-17~21 + 기존 전체 |
| V-S | 정적 | `npx tsc -p tsconfig.app.json --noEmit` · `npx eslint src/` · `npm run build` · `cd backend && alembic heads` · `git diff --name-only` · grep | G·AZ-11·TM-6·PG-6 |
| V-C | CI | GitHub Actions `ci-feature.yml`(frontend·backend·**backend-pg-smoke**) | PG-* |
| V-E | dev E2E | `e2e-smoke.yml`(smoke·journeys·regressions·full-journey) — 배포 후 자동 | VR-3·VR-4 |
| V-M | 수동 | Brian 승인·입회 필요: dev 스키마 덤프 읽기(P2)·스냅샷(M2)·M0 조회(M3)·dev 수동 호출 | PG-5·M0-5~M0-12 |

- 프론트 CI `Test` 단계는 `continue-on-error: true` 라 FE 신규 테스트 실패가 CI 를 막지 않는다 → **합격 판정은 로컬/CI 로그에서 해당 파일 pass 를 직접 확인**(G2).
- 프론트 `tsc` 는 `npx tsc --noEmit`(루트 `files: []`)이 아니라 **`-p tsconfig.app.json`** 로 검사한다(SDD-209 T0 기록).
- 기준선: Task **G0** 가 구현 전 `baseline.md` 에 pytest/vitest/tsc/eslint 의 통과·실패 목록을 기록한다. "신규 실패 0" 은 이 기록 대비다.

---

## 1. 공통 합격 기준 (모든 Task)

| 확인 | ID | 기준 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | G1 | **백엔드 신규 실패 0**: `pytest` 전체가 G0 기준선의 실패 목록 외에 실패하지 않는다. 개정표(§5)의 **1건**(`test_report_bulk_actions.py` `test_mark_all_read`)을 제외한 기존 테스트 파일에 수정이 없다 | B·S | 신규 실패 0, 기존 테스트 diff = 개정표 범위 |
| [ ] | G2 | **프론트 신규 실패 0**: `npx vitest run` 전체 결과에서 G0 에서 통과하던 파일이 모두 통과, 신규 파일 전부 통과. CI `Test` 가 비차단이므로 **로그에서 파일별 pass 를 확인해 기록** | F | 신규 실패 0, 신규 파일 pass 목록 첨부 |
| [ ] | G3 | `npx tsc -p tsconfig.app.json --noEmit` 오류 0 · `npx eslint src/` 0 · `npm run build` 성공 | S | 0 |
| [ ] | G4 | **DB 스키마 변경 0**: `backend/alembic/versions/` 의 신규 파일 0개, 수정 파일은 `30c1bfbc724f_*.py` **1개뿐**, `alembic heads` = `e036a0000051` 1개. 모델 컬럼 추가·삭제 0 | S | 충족 |
| [ ] | G5 | **변경 최소화**: `git diff --name-only <기준 SHA>..HEAD` 가 plan §4.1 소유 파일 + 신규 테스트·골든·픽스처 + `specs/sdd-211-…/` 안에만 있다. 엔진(진행·입장·뇌파·녹음/STT/요약·리포트 *생성* 로직) 파일 수정 0 — 리포트 **조회·직렬화** 경로(`list_reports`·`get_report`·`mark_all_read`·`recent_report`·`_mask_unapproved`)와 그 스키마(`schemas/report.py`·`schemas/client.py`)는 예외. **리포트 생성 큐 분리는 범위 밖**(plan §14): `celery_app.py`·`report_task.py`·`audio_service.py` 의 큐/라우팅/체인 변경 0 | S | 범위 밖 파일 0 |
| [ ] | G6 | **사용자 노출 문구 변경 최소**: 변경은 (a) 회원 화면 신규 문구 **정확히 2종** — 배지·칩 `리뷰 중`, 안내 `리뷰 중이에요. 확인이 끝나면 알려드릴게요.` (b) R1 의 거부 detail `이 작업을 수행할 권한이 없습니다` (client 가 타인 세션 PUT 시 `host 상담사만 가능합니다` 에서 변경) 뿐. 서버·프론트 문구 리터럴 diff 를 열거해 대조 | S·TM-13·RX-21 | 목록 외 변경 0 |
| [ ] | G7 | **안전망 테스트 불변**: 특성화(`test_sdd211_authz_characterization.py`·`nav-labels-characterization.test.tsx`·`test_session_terms_characterization.py`)와 계약 골든(`tests/contract/golden/*`)은 **작성 커밋 이후 구현 커밋에서 수정 0**. `git log --follow` 로 증명. 골든 생성 커밋이 A·R·X·T4 변경 커밋보다 앞선다(CS-9) | S | 수정 0, 순서 충족 |
| [ ] | G8 | `any` 사용 0(신규·수정 TS), 객체·배열 직접 변경 0, 주석은 한글·WHY 만, 파일명 kebab-case/snake_case | S | 0 |
| [ ] | G9 | **비밀·개인정보 0**: 신규·수정 파일(픽스처·보고서·로그 샘플 포함)에 이메일(`@example.com` 제외)·전화·UUID 실값·토큰·비밀번호·DB 접속 문자열·IP 0건 | S | grep 0건 |
| [ ] | G10 | PR 의 CI 3잡(frontend·backend·backend-pg-smoke) GREEN, 머지 후 dev 자동 배포 성공, 이어지는 `e2e-smoke` 4스크립트 통과 | C·E | 충족 |

---

## 2. 트랙별 시나리오

### 2.1 구 계약 스냅샷 (C1~C3) — CS

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | CS-1 | `/sessions/*` 라우트 집합: 경로에 `/sessions` 또는 `{session_id}` 를 포함한 **61개**(메서드+경로+성공 상태코드) 가 골든과 일치. 삭제·이름변경·성공코드 변경은 실패, 신규 라우트 추가는 통과(경고 출력) | B | 일치 |
| [ ] | CS-2 | OpenAPI 서브셋(61 op + 참조 스키마) **가산 전용** 호환: 응답 속성 삭제/이름변경/타입·format 변경/널 확대/골든의 required 해제는 실패, 새 속성 추가는 통과. 요청: 속성 삭제·타입 변경·선택→필수·새 필수 속성·enum 값 삭제 실패, 새 선택 속성 통과. `$ref` 는 인라인 해소 후 의미 비교(스키마 이름 변경 무시) | B | 통과/실패 규칙표대로 |
| [ ] | CS-3 | 비교기 자체 단위 테스트 **≥12**: 합성 스펙으로 규칙표 각 행(삭제·이름변경·타입·널·필수·enum·요청 필수화·새 선택 통과·오탐 방지) | U | 12/12 |
| [ ] | CS-4 | 응답 enum 값 **삭제와 추가 모두 기본 실패**(구 앱의 `switch(status)` 보호). `breaking_exemptions.json` 에 `{id, op, path, change, sdd, reason, expires_phase}` 항목이 있을 때만 통과. 예외 파일 형식 위반·만료(`expires_phase` 경과) 시 실패. **기본 내용은 빈 배열** | B | 충족 |
| [ ] | CS-5 | 응답 형태 시나리오 **17개**(각 1 테스트): `POST /sessions`(201), `GET /sessions`, `GET /sessions/{id}`, `PUT`, `open`, `start`, `end`, `enter/verify`, `enter`(비회원), `entry-state`, **`join`**, **`livekit-token`**, **`markers`**, `GET/PUT record`(불투명 내부 키), `report-status`+`report-choice/summary`, `eeg-rollup`·`checkin`·`invite/email`, `video/url`. 저장 대상은 **값이 아닌 형태(키+타입 태그)**, 골든의 모든 키가 현재 응답에 존재·타입 일치(골든 null 은 키 존재만), 추가 키는 통과. 에러 응답(401/403/404/409/422) 형태 2~3개 포함 | B | 17/17 |
| [ ] | CS-6 | **봉인 응답**: `POST /sessions/enter/verify` 는 키 집합이 정확히 `{title, scheduled_at, host_name}`(`strict_keys`). 키가 늘면 **실패**(개인정보 비노출, `tests/test_sdd209_b5a_entry.py:58` 와 같은 요구) | B | 충족 |
| [ ] | CS-7 | 골든 갱신 스위치: `UPDATE_CONTRACT_GOLDEN=1` 에서만 골든 쓰기, `CI=true` 이면 쓰기 **거부**(CI 가 골든을 조용히 덮어쓰는 사고 방지) | B | 충족 |
| [ ] | CS-8 | `response_model` 미지정 라우트 8개(`entry/revoke`, `DELETE {id}`, `join`, `livekit-token`, `markers`, `video/url`, `video/stream`, `report-email/view`) 목록을 골든화 — **신규 미지정 라우트가 생기면 경고/실패** | B | 충족 |
| [ ] | CS-9 | **순서**: 계약 골든 생성 커밋(C2·C3)이 호스트 판정 교체(A2·A3)·역할 가드(R1)·R6-X1(X2)·용어(T2·T4) 변경 커밋보다 **앞서** 있다 | S | `git log` 순서 충족 |
| [ ] | CS-10 | **변이 주입(메타 테스트)**: 임시로 응답 필드 1개 삭제·타입 변경·라우트 1개 삭제를 주입하면 CS-1·CS-2·CS-5 가 각각 실패함을 확인(주입은 커밋하지 않음). 결과를 summary 에 기록 | B | 3/3 실패 확인 |
| [ ] | CS-11 | **리포트 마스킹의 계약 영향(U1=B)**: ① `breaking_exemptions.json` 은 계속 **빈 배열**(예외 등록 없음) ② `ReportResponse` 에 추가된 속성은 `in_review` 하나뿐 — CS-2 가 `POST /reports/generate/{session_id}` 의 **신규 속성 경고**만 출력하고 실패하지 않음 ③ `GET /reports`·`GET /reports/{id}`(61 라우트 밖)는 형태 단언으로 고정: 미승인 응답의 키 집합 == 승인 응답의 키 집합(둘 다 `ReportResponse` 키 + `in_review`), 값의 타입 태그가 기존 계약과 같음(`content`=object, 지표=number\|null) | B | 충족 |

**수량 기준**: 계약 테스트 합계 **≥35**(비교기 12 + OpenAPI 5 + 형태 17 + 리포트 형태 1). 골든은 Phase 0 시작 시점 동작을 **그대로** 박제한다(버그 포함, 정리 금지). 골든 diff 가 이후 PR 에 있으면 추가 줄만 허용.

### 2.2 호스트 판정 단일화 (A0~A3) — AZ

특성화 테스트(A0)는 **현행 코드에서 통과**해야 하며 교체 후에도 수정 없이 통과해야 한다(G7).

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | AZ-1 | 비호스트 거부 매트릭스: plan 정책표 25개 액션 각각에 대해 비호스트 요청 → 상태코드 + **detail 문자열 단언**. 문구 3종: `host 상담사만 가능합니다`(계열 A·B), `호스트만 초대할 수 있습니다`(이메일 초대, 계열 C), `접근 권한이 없습니다`(계열 D 비참여자) | B | 25/25 |
| [ ] | AZ-2 | **기관 비활성(D1 보존)**: 호스트 소속 기관 비활성 상태에서 계열 B(`PUT /sessions/{id}`, `GET live-metrics`, `POST livekit-token`) → **409** `비활성화된 기관에서는 이 작업을 수행할 수 없습니다`, 반대로 계열 A/C(`audio/start`, `PUT record`, `POST invite/email`, `report generate`) → **통과**. 통합 후에도 동일 | B | 양쪽 일치 |
| [ ] | AZ-3 | **role 우회 없음**: 타 세션에 대해 `org_admin`·`platform_admin` 이 호스트 전용 엔드포인트 → **여전히 403**(권한 확대 방지) | B | 403 |
| [ ] | AZ-4 | 숨김 세션 → 호스트 판정 경로 전부 **404**, 제거된 참여자 → 계열 D **403** (ORM 전역 필터 의존 고정) | B | 충족 |
| [ ] | AZ-5 | 스위프 경로: 호스트 id 로 `transition_status(... restrict_from={"open"})` 호출이 통과(`session_service.py:1106`), `SYSTEM` actor 미도입 | B | 통과 |
| [ ] | AZ-6 | 계열 D: 비참여자의 `GET /sessions/{id}`·`GET /record`·`GET /transcript`·`GET /report-status` → 403 `접근 권한이 없습니다`, 참여자·호스트 → 200 | B | 충족 |
| [ ] | AZ-7 | **에러 우선순위** 400(ID 형식) → 404 → 403 → 409(기관) 고정: 존재하지 않는 id + 비호스트 → 404(403 아님), 잘못된 UUID → 400(이메일 초대는 `잘못된 ID 형식입니다`) | B | 충족 |
| [ ] | AZ-8 | 기존 테스트 공백 7곳 메움: 비호스트 `end`·`save-as-template`·`markers`·`PUT record`·audio `chunk`/`stop`·video `stop`·`approve_report`(문구 `host 상담사만 승인 가능합니다`) → 403 | B | 7/7 |
| [ ] | AZ-9 | `session_authz` 단위: 액션 × {호스트, 비호스트, 참여자, 비참여자} 매트릭스에서 정책(`rule`·`deny_detail`·`require_active_org`)이 정책표와 일치 | U | 전 조합 일치 |
| [ ] | AZ-10 | WS `record_namespace` 구독: 호스트·참여자 허용, 비참여자 거부가 교체 전후 동일(위임 shim → 새 함수) | B | 충족 |
| [ ] | AZ-11 | **정적 완료 검사**: 옛 복제 헬퍼 정의(`def _get_session_as_host`, `def _get_host_session`, `def _get_session_for_user`, `def _get_session_for_participant`)와 호출이 `app/` 에서 **0건**, `record_namespace.py` 의 private import 0건 | S | 0 |
| [ ] | AZ-12 | 기존 호스트·참여자 관련 테스트(`test_session.py`·`test_sdd209_b5b_ownership.py`·`test_session_chat.py`·`test_report.py`·`test_audio_record.py`·`test_video_record.py` 등)가 **무수정 통과** | B | 신규 실패 0 |

### 2.3 역할 가드 (R1) — RG

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | RG-1 | **client 토큰**으로 `POST /sessions`·`PUT /sessions/{id}`·`POST …/duplicate`·`save-as-template`·`new-run` → **403**, body `{"detail":"이 작업을 수행할 권한이 없습니다"}` (5/5) — **차단되는 역할은 `client` 뿐** | B | 5/5 |
| [ ] | RG-2 | `counselor`·`org_admin` 토큰으로 위 5개 정상 동작(201/200). `org_admin` 은 본인 세션만, 타인 세션은 호스트 판정 403 유지 | B | 충족 |
| [ ] | RG-3 | **U4 확정(허용 유지)**: `platform_admin` 토큰으로 위 5개가 **가드 적용 전후 동일하게 성공**한다(상태코드·응답 형태). 가드 적용 전 현행 동작을 먼저 특성화(RED 단계에서 GREEN)하고 적용 후 무수정 통과. 단 타인 세션의 호스트 전용 조작은 여전히 403(AZ-3) | B | 5/5 통과 |
| [ ] | RG-4 | 비로그인 → 401 유지(`test_session.py` 의 `test_02_비로그인_세션_생성_401`) | B | 401 |
| [ ] | RG-5 | client 가 **타인** 세션 `PUT` → 403 이며 detail 이 `이 작업을 수행할 권한이 없습니다`(변경 사실을 테스트로 명시) | B | 충족 |
| [ ] | RG-6 | 가드를 걸지 않은 라우트(`DELETE`·open/start/end/cancel·초대·참가자 삭제·chat-enabled 등)의 동작·문구 불변 — `test_sdd209_b5b_ownership.py::test_AZ10…`·`test_session_chat.py::test_09…` 무수정 통과 | B | 통과 |
| [ ] | RG-7 | client + 잘못된 body → 403(의존성 우선, 422 아님) | B | 403 |
| [ ] | RG-8 | 가드 적용 뒤 **전체 pytest** 로 기존 테스트 영향 확정. role=client 로 세션을 만들던 테스트가 발견되면 **목록을 Brian 에게 보고**(임의로 role 을 바꿔 통과시키지 않음). 프론트 라우트 가드 변경 0(`fe/App.tsx` diff 0) | B·S | 신규 실패 0 또는 보고 후 승인 |
| [ ] | RG-9 | 허용 3역할 × 5라우트 매트릭스(15)와 차단 `client` × 5라우트(5)를 **표 기반 한 테스트**로 고정 — 이후 역할 목록 변경(예: 역할 추가)이 테스트 수정 없이는 불가능하도록 | B | 20/20 |

### 2.4 R6-X1 — 승인 전 리포트 `리뷰 중` 마스킹 (X1~X3) — RX

공통 픽스처: 회원 M 의 `type="client"` 리포트를 상태별로 시드(`pending_analysis`(content generating), `pending_review`, `error`(`content.error`·`generation_error` 포함), `completed`). **sentinel 문자열**(예: `SECRET_HEADLINE`, `SECRET_SUMMARY`, `SECRET_COMMENT`, `ERR_TRACE`)을 `content.headline`·`content.summary`·`content.counselor_comment`·`generation_error` 에 심고 지표(`eeg`)에 비영 값을 넣어, 응답 JSON 문자열 어디에도 sentinel 이 없고 지표가 null 임을 단언한다. 구현 전(RED): 마스킹 시나리오는 **현행에서 실패**, 회귀 고정 시나리오는 **현행에서 통과**(X1 에서 증거 기록).

**마스킹 정의 (allow-list)** — `in_review == true` 응답에서
- 반드시 **null/빈 값**: `content`(정규화 빈 구조 — `summary`·`counselor_comment` None, `insights`·`markers` `[]`, `eeg` 키 없음, 그 외 키 없음), `HRVMotionSummary` 10개(`sdnn_mean`·`rmssd_mean`·`lf_hf_ratio_mean`·`heart_rate_mean`·`heart_rate_min`·`heart_rate_max`·`respiratory_rate_mean`·`lf_power_mean`·`hf_power_mean`·`motion_mean`), `generation_error`, `data_credibility`, `pdf_url`, `subjective_state`
- **보존**(값 유지): `id`·`session_id`·`type`·`status`(원문)·`generation_status`·`is_read`·`created_at`·`session_title`·`counselor_name`·`session_type`·`scheduled_at`·`sent_at`·본인 `participant_name`/`gender`/`birth_date`/`report_email`·`user_id`·`participant_id`
- **신규**: `in_review: true` (승인된 리포트·staff 조회에서는 `false`)
- 위에 열거되지 않은 키가 응답에 생기면 테스트 실패(이후 필드 추가로 인한 누출 방지)

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | RX-1 | 회원 `GET /reports`: 4상태 시드 → **4행 모두 반환**, 비승인 3행은 `in_review true` + 마스킹 정의 전부 충족, `completed` 행은 `in_review false` + 전체 content. 응답 JSON 전체에 sentinel 부재 | B | 충족 |
| [ ] | RX-2 | **총계·페이지 불변**: `completed` 3 + 비승인 2, `limit=2` → `total==5`, 페이지 합 5행, 정렬 순서 불변(마스킹 전후 동일) | B | 충족 |
| [ ] | RX-3 | 회원 `GET /reports/{id}`: `pending_review` → **200** + 마스킹 정의 충족, 호출 후에도 DB `is_read == False` | B | 200, False |
| [ ] | RX-4 | 회원 상세 `pending_analysis`·`error`(parametrize) → 200 + 마스킹, `error` 의 예외 원문(`ERR_TRACE`)이 응답에 없음, `is_read` 불변 | B | 충족 |
| [ ] | RX-5 | 회원 상세 `completed` → 200 전체 content, `is_read True`(기존 계약 유지) | B | 충족 |
| [ ] | RX-6 | **타 참여자 403 유지(RPT-IDOR-001)**: 같은 세션 A·B 가 각자 `pending_review` 보유 → A 가 B 의 리포트 조회 시 **403**(마스킹 200 아님). 소유자 검사가 마스킹보다 먼저 | B | 403 |
| [ ] | RX-7 | 호스트 `POST /reports/{id}/approve` 전/후: 전 — 목록·상세 마스킹, 후 — `in_review false` + 전체 content, `report_ready` 알림 정확히 1건, **`is_read` 는 열람 전까지 False 유지(승인 후 NEW 정상)** | B | 충족 |
| [ ] | RX-8 | `POST /reports/approve-all` 후 회원 N명 모두 상세 `in_review false` + 전체 content | B | N/N |
| [ ] | RX-9 | 자동 승인 호스트(`auto_approve_report=True`) + 세션 종료 파이프라인(celery eager): 생성 직후 `pending_review` 구간에는 마스킹, 승인 완료 후 전체 | B | 충족 |
| [ ] | RX-10 | `GET /client/home` `recent_report`: `pending_review` 1건만 보유 → 행 반환 + `in_review true`(id·제목 `MM월 DD일 리포트`·created_at 불변, 내용 필드 없음), `completed` 추가 후 → `in_review false` | B | 충족 |
| [ ] | RX-11 | `PUT /reports/read-all`: `pending_review` 1 + `completed` 1 (둘 다 미읽음) → `count == 1`, 비승인 건은 `is_read False` 유지 | B | 충족 |
| [ ] | RX-12 | **회귀 고정** 회원 `GET /reports/{id}/pdf` → 403 | B | 403 |
| [ ] | RX-13 | **잔여 노출 문서화**: 회원 `GET /sessions/{sid}/report-status` 와 WS `report:progress` 의 `report_status` 문자열은 **Phase 0 에서 변경하지 않는다** — 현행 계약을 단언으로 고정하고 "후속(Phase 5) 변경 시 개정" 주석 | B | 현행 동일 |
| [ ] | RX-14 | **회귀 고정(이미 안전한 경로, 불변)**: 비회원 토큰 열람 JSON·토큰 PDF·메일 링크 HTML 이 `pending_review` 에서 403, 승인 후에만 열림; AI 비서 컨텍스트에 `pending_review` 부재; 데이터 내보내기가 `report_pending` 경고. 기존 `test_sdd052_report_view.py:102-107`·`test_sdd070_report_pdf.py:122-125`·`test_agent_policy.py`·`test_data_exports.py:230-254` **무수정 통과** | B | 통과 |
| [ ] | RX-15 | staff 경로 불변: 호스트·org_admin 의 `GET /reports`·`/reports/{id}` 는 `pending_review`·합성 "생성 중/실패" 행을 **마스킹 없이** 그대로 반환, `in_review false` | B | 충족 |
| [ ] | RX-16 | 재생성: 미승인 리포트 재생성(선택 변경) 중·후에도 계속 마스킹, 승인본 재생성은 `completed` 유지(회원에게 계속 전체 content) | B | 충족 |
| [ ] | RX-17 | 프론트 목록: `in_review` 행은 배지 `리뷰 중`, 요약 텍스트 없음, NEW 배지 없음, 행 클릭 시 모달 열림; `in_review` 없는/false 행은 기존 `확인 가능`/`대기` 표시 그대로(기존 `client-report-list.test.tsx` **무수정 통과**) | F | 통과 |
| [ ] | RX-18 | 프론트 모달: 응답 `in_review` → **소프트 페이지**(제목=세션 제목 + 안내 문구 정확 일치 `리뷰 중이에요. 확인이 끝나면 알려드릴게요.`), `ClientReportViewer`·PDF·공유 UI 미렌더; 승인된 리포트는 뷰어 그대로; 행이 없을 때 `리포트를 찾을 수 없습니다`(`client-report-modal.test.tsx:113`) **무수정 통과** | F | 통과 |
| [ ] | RX-19 | 프론트 홈 카드: `in_review` 행에 `리뷰 중` 칩, NEW 없음, `생성 중` 칩은 `generation_status=processing` 일 때만(기존 로직 불변), 클릭 이동 경로 `/app/reports?report={id}` 불변 | F | 통과 |
| [ ] | RX-20 | 프론트 `reportStore.refresh`: `unread` 집계가 `is_read == false` 이면서 `in_review` 가 아닌 행만 센다(탭 NEW 카운트 정합), `pendingReview`(상담사용) 집계 불변 | F | 통과 |
| [ ] | RX-21 | **문구 가드**: `fe/lib/report-review-copy.ts` 의 두 문자열이 정확 일치, `composeBanned('meditation')`(공통 19 + `세션\|수업\|오픈`) 정규식에 0건, 해요체, 영문 대문자 아이브로우 0, `Extended_Pictographic` 0. 새 문구가 들어간 파일 3종이 기존 가드 `class-flow-shell-terms.test.ts` 의 `세션` 검사도 통과 | F | 0건 |
| [ ] | RX-22 | **구 앱 호환(키 보존)**: 미승인(마스킹) 응답의 키 집합 == 승인 응답의 키 집합 (둘 다 `ReportResponse` 키 + `in_review`), `content` 는 객체(null 아님), 지표는 number\|null 타입 유지, `status`·`generation_status` 값 문자열 불변. 구 번들 실제 렌더는 `미확인`(plan §10 #13) — 실기기 수동 확인 결과를 summary 에 기록(가능 시) | B·M | 충족 |

**수량 기준**: `test_sdd211_member_report_visibility.py` RX-1~RX-16·RX-22 매핑 테스트 **≥17**, 프론트 `client-report-in-review.test.tsx` RX-17~RX-21 **≥5**. 수정 전 dev 수동 재현(plan [조사 03] §6.2 5·6·7단계)과 수정 후 재확인은 **별도 승인 하에서만** 실행(M, dev=실운영, 테스트 계정·`[SDD211-TEST]` 제목 세션만, 응답 본문(`content`) 저장 금지, 환경변수 이름만 사용). 단 [조사 03] §6.2 표의 "수정 후" 기대값(404·미포함)은 **U1=B 이전 기준이라 폐기** — 이 표(RX-1·3·10)가 기대값이다.

### 2.5 PG 마이그레이션 스모크 (P0~P4) — PG

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | PG-1 | `alembic heads` 정확히 1개(`e036a0000051`) — PG 잡 안에서 명시 단계로 검사 | C | 1개 |
| [ ] | PG-2 | **빈 DB** `alembic upgrade head` 성공(종료코드 0), `alembic current` == `heads`, `alembic_version` 1행 | C | 충족 |
| [ ] | PG-3 | **수정 전 실패 증거**: P0 이전 커밋에서 같은 단계가 `DuplicateTable: "chat_room_participants"` 로 실패함을 로컬 임시 PG 16 로그로 기록(재현 증거). 수정 후 통과 | M·B | 증거 첨부 |
| [ ] | PG-4 | P0 수정 결과 스키마 검증: 테이블 **62개 + `alembic_version`**(모델 메타데이터 62와 일치), 필요분 4건 존재(`careers.updated_at`, `qualifications.updated_at`, `careers.role` 길이 100, `careers.is_current NOT NULL`). 리비전 id·체인 불변(`alembic history` 84개) | C·M | 충족 |
| [ ] | PG-5 | **스냅샷 복원본**: 스키마 전용 덤프(`baseline_e036a0000051.sql`, `alembic_version` 1행 포함) 복원 → 합성 시드 삽입 → `upgrade head` 성공. 현재 head 에서는 no-op 임을 로그에 명시(Phase 1 M1 부터 의미). 덤프 vs 빈 DB 체인 스키마 **diff 건수를 보고**(약 12건 드리프트 추정 확인) | C·M | 충족 + diff 보고 |
| [ ] | PG-6 | **픽스처 위생**: `backend/tests/fixtures/pg/*.sql` 에 `COPY`/`INSERT INTO`(alembic_version 제외) 0건, 이메일 패턴은 `@example.com` 만, 전화·UUID 실값·토큰 0건. CI 단계로 자동 검사하고 로컬 grep 도 수행 | C·S | 0건 |
| [ ] | PG-7 | PG 잡 구성: `postgres:16` 서비스(운영 RDS PG 16 일치), 설치 패키지가 `requirements.txt` 와 **동일 버전 고정**, 필요한 환경변수는 `DATABASE_URL` 하나(비밀 없음, 영숫자 비밀번호) | S | 충족 |
| [ ] | PG-8 | `pg` 마커 하네스 + 샘플 2: `uq_sessions_active_access_code` — PG 에서 활성 세션 코드 중복 거부·종료 후 재사용 허용, 모델 `postgresql_where`/`sqlite_where` 번역 일치. 기본 `pytest -q`(SQLite)에서는 skip, PG 잡에서 실행 | C | 2/2, SQLite 에서 skip |
| [ ] | PG-9 | **잡이 실제로 막는다**: 임시 브랜치(머지 금지)에서 일부러 깨뜨린 리비전을 넣어 `backend-pg-smoke` 가 **RED** 가 됨을 1회 확인하고 `gh run` 링크를 summary 에 기록 | C | RED 확인 |
| [ ] | PG-10 | `alembic check` 는 정보성(`continue-on-error: true`): 감지 건수를 로그에 남기고 잡은 실패하지 않는다. 기존 드리프트 목록이 summary 후속 backlog 에 있다 | C | 비실패, 건수 기록 |
| [ ] | PG-11 | **CI 시간 측정**: `gh run view <id> --json jobs` 로 새 잡 단계별 소요와 기존 `backend` 잡 소요를 전/후 기록. 기준: 새 잡 **≤ 5분**(timeout 10분), 워크플로 전체 wall-clock 증가 **≤ 1분**(병렬 실행). 초과 시 기준을 고치지 않고 원인·비용을 Brian 에게 보고 | M | 기준 충족 또는 승인 |
| [ ] | PG-12 | `deploy-dev.yml`·`e2e-smoke.yml` 변경 0(롤백 트랩 무영향). PG 잡이 `deploy-dev` 의 `needs` 가 아님을 문서화하고, **브랜치 보호 필수 상태 점검 등록 요청**을 Brian 에게 전달(설정은 Brian 수동) | S | diff 0 |

### 2.6 용어 사전·키 기반 배지·가드 분리 (T0~T4) — TM

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | TM-1 | `FE-NAV-01~04` **라벨 골든**: 역할 4종(counselor·org_admin·client·platform_admin)의 `SidebarNav` 렌더 `nav a` 의 `[href, 텍스트(배지 제외)]`, `layout/BottomTabBar`(역할별), `client/BottomTabBar` 가 현행 글자 그대로. **T0-FE 에서 작성한 파일이 T2 후 무수정으로 통과** | F | 통과 |
| [ ] | TM-2 | `FE-NAV-05` **배지 현행값**: `sessionInvites` 0/3/10 → 없음/`3`/`9+`, 채팅·리포트·알림 배지 계산식이 세 컴포넌트 각각 현행과 동일(통합 금지) | F | 통과 |
| [ ] | TM-3 | `FE-TERM-01~03`: `term(key, area)` 가 모든 키(16)·두 영역 값 == 현행 리터럴 복사본(`toBe`), 키 개수 고정, 미지 키 방어(타입 오류/런타임 throw) | F | 통과 |
| [ ] | TM-4 | `FE-NAV-06` **키-배지 결합**: `terms` 를 mock 해 `class` 라벨을 임의 값으로 바꿔 렌더해도 배지가 `class` 항목에만 붙음(3개 컴포넌트 각각) | F | 3/3 |
| [ ] | TM-5 | `FE-NAV-07` 드로어 경로: `SidebarNav` 에 `notificationBadge` 만 줄 때 채팅·리포트·클래스 배지 0 유지(현행 동작 보존) | F | 충족 |
| [ ] | TM-6 | `FE-NAV-08` 정적: `/\blabel\s*===\s*['"]/` 가 3개 파일에서 **0건**(재도입 방지) | F·S | 0 |
| [ ] | TM-7 | `FE-GUARD-01~03`: `composeBanned('meditation')` == 현행 `BANNED_COPY` 원문(바이트 동일, `\\bQR\\b` 이스케이프 포함), common+meditation 항목 합 == 22, `BANNED_COPY` export 유지 | F | 통과 |
| [ ] | TM-8 | `FE-GUARD-04~06`: counseling 규칙이 `상담 세션` 은 통과시키고 `세션 예약`·`클래스 열기` 는 적발, `TERMS` 값이 meditation 금지어(`세션\|수업\|오픈`) 0건. **counseling 규칙의 적용 경로는 0개** | F | 통과 |
| [ ] | TM-9 | 기존 `class-flow-shell-terms.test.ts`(`세션` 단독 검사, SWEPT 10경로)·`agent-counselor-sidebar.test.tsx` **무수정 통과**. 검사 범위 확대(`수업`·`오픈`) 금지 | F | 통과 |
| [ ] | TM-10 | `BE-TERM-C01~C13` **서버 문구 특성화**: 세션 이벤트 알림 제목/본문(open·start·end·cancel, 생성 scheduled/open, 수정, 직접 취소, 초대 2경로, 제외, 대기 승격, 리마인드; **제목 없는 세션의 fallback `세션`/`클래스` 포함**) + 유형 라벨 3함수 × 5유형(`명상수업` vs `명상 수업`, fallback `클래스` vs `상담`). T0-BE 작성분이 T4 후 무수정 통과 | B | 13/13 |
| [ ] | TM-11 | `BE-TERM-01~03`: `session_terms.*` 반환 == 골든 리터럴, 영역 두 값 모두 동일(Phase 0 불변), 미지 키 → `KeyError` | U | 통과 |
| [ ] | TM-12 | 기존 `test_sdd097_session_reminders.py`·`test_sdd209_b7_invite_remind.py`·`test_notification_outbox.py` 무수정 통과 | B | 통과 |
| [ ] | TM-13 | **문구 diff 0**: T1~T4 커밋의 사용자 노출 한국어 리터럴 diff 를 열거해 "사전으로 이동한 것"뿐임을 확인(추가·삭제·변경된 글자 0). 알림 제목 = 이메일 제목 연동(`notification_service.py:186-192`)으로 메일 제목도 불변 | S | 변경 글자 0 |

### 2.7 M0 사전 조회 (M1~M3) — M0

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | M0-1 | `m0-prequery.sql` 리뷰 체크리스트 **R0~R10**([조사 07] §1.7) 전부 통과, 리뷰어(작성자와 다른 사람/에이전트)·일시·sha256 기록 | M·S | 11/11 |
| [ ] | M0-2 | 빈 PostgreSQL(alembic 적용본, **실데이터 없음**)에서 A1~A11·B0·C2~C4·C6 전 질의 `EXPLAIN` 컬럼·문법 오류 0. **실데이터 복원본을 CI/GitHub Actions 에 올리지 않는다** | C·B | 오류 0 |
| [ ] | M0-3 | **금지 컬럼 정적 검사**: 바깥 SELECT 목록·`GROUP BY`·`ORDER BY` 에 ID 열·이름·이메일·제목·메모·코드 값·`custom_type_name`(A4d 제외)·`guest_*`·`report_email` 값이 없음([조사 07] §1.4 표와 1:1 대조). 모든 질의가 `SELECT` 로 시작, 문장 구분 `;` 외 `;`·`--` 없음 | S | 위반 0 |
| [ ] | M0-4 | **러너 단위 테스트**: `INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/COPY/CALL/LOCK`·`WITH` 시작·`SET`(LOCAL 외)·금지 함수가 들어오면 **실행 전 거부**, 연결 옵션에 `default_transaction_read_only=on`·`statement_timeout` 포함, 트랜잭션이 `ROLLBACK` 으로 끝남. **A4d(라벨 원문)는 `--include-labels` 없이는 실행되지 않고, 실행 시 결과가 공유 가능 출력과 다른 파일로 분리**된다. 소량 셀 억제 로직이 러너에 없다(U5=A) | U | 전 케이스 거부 |
| [ ] | M0-5 | 수동 RDS 스냅샷: `Status=available`, `PercentProgress=100`, `SnapshotType=manual`, 암호화 여부(`Encrypted=false` 예상) 기록, 스냅샷 **공유 속성 없음** 확인(`describe-db-snapshot-attributes`), ID 를 보고서·Linear 에 기재. 사용자 승인한 명령 단위로만 실행 | M | 충족 |
| [ ] | M0-6 | 조회는 **단일 `REPEATABLE READ, READ ONLY` 트랜잭션 한 번의 패스**에서 A1~A11·B0·C2~C4·C6 가 모두 나왔다(질의 간 시점 일치). 보고서에 `db_now`·`db_timezone`·`alembic_head = e036a0000051`(단일) 기재. **A10(호스트 role 분포)으로 role=client 호스트 세션 유무를, A11(회원 리포트 상태×읽음 집계)로 R6-X1 영향 건수를 보고**(역할 가드·R6-X7 `미확인` 해소, 둘 다 범주형 집계만) | M | 충족 |
| [ ] | M0-7 | **출력 위생 (U5=A·U6)**: 커밋되는 `m0-report.md` 는 **전체 합계·분포만** 담는다. 사람·센터 단위 상세 표(A8 센터별 표, 호스트·회원 단위 표 등)는 **커밋 파일에 0건**이며 Brian 에게만 전달한다. 이메일·UUID 패턴 0건, `custom_type_name` **원문 0건**(키워드 분류 건수·라벨 종류 수·빈도 분포만). 소량 셀 억제(`<3`)는 하지 않는다 | S·M | 위반 0 |
| [ ] | M0-8 | **102 vs 134 판정**: "원인 확인됨(증거 질의 ID 명시)" 또는 "`미확인` + 남은 불확실성". 판독 규칙은 [조사 07] §3.3 의 사전 선언(결과를 보고 바꾸지 않음). 이후 대조 기준은 **A1 의 비템플릿(숨김 포함) 합**으로 고정 | M | 판정 기록 |
| [ ] | M0-9 | 분류 규칙 영향 요약: (a) A3 의 "R7/R10 이 갈리는 세션 수" (b) A2 의 규칙 코드별(C1/C2/C3/R1/R2/R3) 예상 건수 (c) A4b 커버리지 (d) A5 묶기 효과·기관 혼재 (e) A6 비회원 상담 규모, 그리고 **D-55/D-56/D-57 기본값을 바꿀 필요가 있는지 예/아니오**. 분류 규칙 **승인**은 별개의 Phase 1 진입 게이트임을 명시 | M | 충족 |
| [ ] | M0-10 | Brian 의 수령 확인(Linear 코멘트 또는 채팅 "확인")을 `summary.md` 에 한 줄로 기록 | M | 기록 |
| [ ] | M0-11 | 서버 임시 파일(`~/m0/`) 전체 삭제 확인, 출력 파일 권한 0600, `set -x` 미사용, `DATABASE_URL` 값이 어디에도 출력되지 않음 | M | 확인 |
| [ ] | M0-12 | **라벨 원문 열람 규칙 (U6)**: A4d 는 `platform_admin` 역할 보유자(Brian 및 대리인)의 요청으로만 실행하고 M3 기록에 "실행 요청자가 platform_admin" 한 줄을 남긴다. 결과는 별도 파일(`out-labels-*.txt`, 0600)로 platform_admin 에게만 전달하고 전달 후 서버·로컬 임시본을 삭제한다. 저장소·Linear 코멘트·`summary.md` 에는 원문을 넣지 않으며(공개 저장소, 열람자 권한 보장 불가) 보고서에는 "라벨 N종 검토함, 분류 영향 예·아니오" 같은 **메타 문장**만 쓴다 | M·S | 충족 |

---

## 3. 회귀 (SDD-208/209 · E2E 스모크)

| 확인 | ID | 시나리오 | 방법 | 합격 |
|---|---|---|---|---|
| [ ] | VR-1 | SDD-209 백엔드 테스트 `pytest tests/test_sdd209_*.py` 전부 G0 기준선과 동일하게 통과(입장·자격 B5a/B5b, 리포트 필터 B3, 이메일 초대 B14, 삭제 스위프 B12, 연구 내보내기 B13, 준비·입장 B9 등) | B | 신규 실패 0 |
| [ ] | VR-2 | 프론트 SDD-208/209 케이스: `npx vitest run tests/class-player-* tests/class-flow-*` 가 G0 기준선과 동일 | F | 신규 실패 0 |
| [ ] | VR-3 | 배포 후 `e2e-smoke.yml` 4스크립트(`smoke.mjs`·`journeys.mjs`·`regressions.mjs`·`full-journey.mjs`) 통과. 내비 라벨이 본문 텍스트 `includes` 로 검사되므로 글자 불변이 필수(`expectText` 기반) | E | 통과 |
| [ ] | VR-4 | `full-journey.mjs` 의 리포트 단계(승인 → 재발송)가 R6-X1 수정 후에도 통과. 해당 스크립트가 회원 토큰으로 승인 전 조회를 단언하지 않음을 확인(`grep` 기준, 변수 추적 `미확인` → 실행 결과로 확정) | E | 통과 |
| [ ] | VR-5 | `class-flow/selftest.mjs`·`fit.mjs`(Playwright 필요, CI 미연결)를 **로컬에서** 변경 전/후 실행해 `BANNED_COPY` 합성 후에도 selftest 의 금지어 주입 케이스(`세션`·`6자리`)가 계속 적발됨을 확인. 실행 불가 시 `미확인`으로 기록하고 TM-7 로 대체 | M | 동일 또는 `미확인` 기록 |
| [ ] | VR-6 | 배포 후 계약 스냅샷 재실행(CS-1·CS-2·CS-5) — 배포된 코드 기준 GREEN | B·E | 통과 |

---

## 4. 보안 시나리오 (모음)

| 확인 | ID | 시나리오 | 연결 | 합격 |
|---|---|---|---|---|
| [ ] | SC-1 | **client 토큰으로 세션 생성 → 403**(`기획.md` §9 완료 기준) | RG-1 | 403 |
| [ ] | SC-2 | **승인 전 리포트의 본문·지표·상담사 코멘트 초안·오류 원문이 회원 응답에 없음**(목록·상세·홈 `recent_report`·읽음 처리) | RX-1·RX-3·RX-4·RX-10·RX-11 | 비노출 |
| [ ] | SC-3 | 타 참여자의 리포트 접근은 계속 403(마스킹 200 이 아님), 소유자의 승인 전 접근은 마스킹 200 | RX-6·RX-3 | 충족 |
| [ ] | SC-4 | 비회원 토큰·PDF·메일·AI 비서·내보내기의 `completed` 필터가 약화되지 않음 | RX-14 | 통과 |
| [ ] | SC-5 | 호스트 판정 통합이 org_admin·platform_admin 의 권한을 확대하지 않음 | AZ-3 | 403 |
| [ ] | SC-6 | 스키마 덤프·합성 시드·보고서·로그에 개인정보·비밀 없음 | PG-6·G9·M0-7 | 0건 |
| [ ] | SC-7 | M0 조회가 읽기 전용이며 개인정보 컬럼을 조회·출력하지 않음 | M0-3·M0-4 | 위반 0 |
| [ ] | SC-8 | 비암호화 dev 스냅샷이 공유되지 않았고 보관·삭제 계획(U7)이 기록됨 | M0-5 | 충족 |
| [ ] | SC-9 | `custom_type_name` 원문이 저장소 커밋물·Linear·`summary.md` 에 없고 `platform_admin` 에게만 전달됨 | M0-7·M0-12 | 0건 |

---

## 5. 기존 테스트 개정표 (유일한 허용 예외 — 구현 전 확정)

> U1=B(행 유지 + 상태코드 200 유지)에서는 "노출 허용을 계약으로 고정하던 단언" 중 **아래 1건만** 틀려진다. 그 외 기존 테스트의 수정은 금지(G1·G7). 개정은 "완화"가 아니라 정책 변경(TD5 ④)의 반영이다.

| 테스트 | 현재 단언 | 개정 후 단언 | 비고 |
|---|---|---|---|
| `backend/tests/test_report_bulk_actions.py:89-108` (`test_mark_all_read`) | 호스트가 `generate` 한 pending_review client 리포트를 회원이 `read-all` → `count >= 1`, 이후 목록 **모든 행 `is_read`** | **승인 후** `read-all` 하도록 호출 순서 변경(`count == 1`, 모든 행 `is_read`). 미승인 건이 `read-all` 로 읽음 처리되지 않는 반대 단언은 신규 파일 RX-11 | `mark_all_read` 가 `completed` 만 처리 |

**무수정 통과를 요구하는 기존 테스트(개정 대상 아님 — 근거 포함)**

| 테스트 | 근거 |
|---|---|
| `backend/tests/test_mb2_high_severity_fixes.py:163-183` | pending_review 소유 회원 GET → **200 유지**, 타 참여자 403 유지. 본문 마스킹은 RX-3 가 신규 파일에서 단언 |
| `frontend/tests/client-report-list.test.tsx` (`sent_at:null` → `대기`) | 픽스처에 `in_review` 가 없어 기존 분기를 탐(가산 필드 부재 시 현행 동작). `리뷰 중` 렌더는 RX-17 이 신규 파일에서 단언 |
| `frontend/tests/client-report-modal.test.tsx:113` (`리포트를 찾을 수 없습니다`) | U2 확정으로 리포트 행이 없을 때의 기존 오류 문구는 유지 |
| `backend/tests/test_sdd052_report_view.py`·`test_sdd070_report_pdf.py`·`test_agent_policy.py`·`test_data_exports.py` | 비회원/PDF/AI 비서/내보내기 불변(RX-14) |

---

## 6. 측정

| 항목 | 방법 | 기록 위치 |
|---|---|---|
| 기준선 통과/실패 | `pytest -q …`·`npx vitest run`·`tsc`·`eslint` 전체 실행 후 건수·실패 파일명 | `baseline.md`(G0) |
| 신규 테스트 수 | 계약 ≥35 · AZ 특성화 매트릭스(25 액션 + 공백 7 + 기타) · 단위 AZ-9 · RG ≥9(매트릭스 포함 20 케이스) · RX 백엔드 ≥17 + 프론트 ≥5 · FE-NAV 8 · FE-TERM 3 · FE-GUARD 6 · BE-TERM-C 13 + BE-TERM 3 · 러너 단위 · `pg` 2 | `summary.md` |
| CI 시간 | 전/후 `gh run view <id> --json jobs` 단계별 `startedAt/completedAt` | `summary.md` (PG-11) |
| 로컬 마이그레이션 시간 | 임시 PG 16 로 빈 DB `upgrade head` 총 시간(참고: 기존 측정 ≈1.2초) | `summary.md` |
| 호스트 판정 호출 지점 | 교체 전 33 → 교체 후 복제 헬퍼 호출 0 (AZ-11 grep 결과) | `summary.md` |
| M0 결과 | 질의 ID 별 **합계·분포 표**(사람·센터 단위 표 제외, U5=A) — 커밋 / 센터별·호스트별 상세와 라벨 원문 — 커밋 금지, Brian·platform_admin 에게만 | `m0-report.md` |

---

## 7. 합격 판정과 게이트

1. **구현 착수 조건**: 이 verify 에 대한 Brian 승인. 사용자 결정 U1~U7 은 확정됨(plan §13·§13.1), 확인 요청 C1(SDD-210 컷오버 일정)은 비차단.
2. **Wave 0 완료 조건**: G0 기준선 확정, 계약 골든·호스트 판정 특성화·내비/서버 문구 특성화가 **현행 코드에서 GREEN**, X1 의 노출 시나리오가 RED(현행 노출 재현).
3. **Phase 0 완료 조건**(`기획.md` §9): CS·AZ·RG·RX·PG·TM 의 `B/U/F/C/S` 항목 전부 통과 + G1~G10 + VR-1~VR-6 + **분포 조회 결과 Brian 보고**(M0-1~M0-12).
4. **통과하지 못한 항목이 있으면** 기준을 고치지 않고 (a) 구현을 고치거나 (b) 선택지와 비용을 제시해 Brian 승인을 받아 `변경 이력`에 사유와 함께 반영한다.
5. M2·M3·P2 의 dev 접근(스키마 덤프·스냅샷·조회)은 **읽기 전용이어도 dev=현재 실운영 DB** 이므로 각 단계에 Brian 의 명시적 go 가 필요하다. 이 문서 작성 단계에서는 실행하지 않았다.

---

## 변경 이력

| 일시 | 변경 | 사유 | 승인 |
|---|---|---|---|
| 2026-10-18 | 최초 작성 (구현 전) | Stage ③ | 승인 대기 |
| 2026-10-18 | **개정 1 (구현 전)**: U1=A→**B**(RX 전면 재작성 18→22, 마스킹 allow-list·소프트 페이지·NEW 집계·키 보존), U2 문구 확정(RX-18·RX-21), U4 3역할(RG-3 재정의·RG-9 추가), U5=A·U6(M0-4·M0-7 개정, M0-12 추가, SC-9 추가), 계약 CS-11 추가, 기존 테스트 개정표 3건→1건, G1·G5·G6 개정 | Brian 결정 확정(plan §13·§13.1) | 구현 전 개정 — 승인 대기 |
