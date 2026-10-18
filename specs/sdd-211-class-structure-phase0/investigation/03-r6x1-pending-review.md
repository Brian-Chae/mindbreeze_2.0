# 03. R6-X1 조사 — 회원(role=client)이 승인 전(`pending_review`) 리포트를 볼 수 있는가

> 조사 방식: 코드 읽기 + 기존 pytest 3건 로컬 실행(외부 서비스 불필요, SQLite 픽스처). dev/prod 서버·DB 호출 없음, 코드 수정 없음.
> 근거 표기: `파일:줄` (ROOT = `/Volumes/Looxid SSD/looxid/repository/mindbreeze_2.0`, 이하 `backend/app/` 접두 생략 가능). 확인 못 한 것은 `미확인`.
> 질문 출처: `docs/class-session-restructure/조사/R6-리포트분석.md:135`(관찰), `:312`(R6-X1), `기획.md:612`(X14).

## 0. 결론 (한 줄)

**노출됨(EXPOSED).** 로그인 회원은 본인 `client` 리포트를 **상태와 무관하게** 목록·상세·홈 카드로 볼 수 있다. 승인 게이트(`pending_review → completed`)는 *발송·알림·PDF·토큰 링크·AI 비서* 에만 걸려 있고, **회원 앱 화면용 REST(`GET /reports`, `GET /reports/{id}`, `GET /client/home`)에는 걸려 있지 않다.** 이 노출을 "고정"하는 기존 테스트가 존재한다(§2). 프론트의 "대기" 배지는 보안 통제가 아니며 행은 열린다(§3).

비회원(토큰 링크/메일/PDF), AI 비서, 연구용 내보내기는 `completed` 만 허용 → **NOT EXPOSED**(코드 + 테스트로 고정됨).

---

## 1. 상태값과 "회원에게 보이게 되는 시점"

### 1.1 `Report.status` 값 (상태머신)

| 값 | 의미 | 정의/전이 근거 |
|---|---|---|
| `pending_analysis` | 행 생성 직후·분석 대기/재생성 중. 컬럼 기본값 | `models/record.py:218` (default), `services/report_service.py:333-337`(상담사/개별 생성: `content={"status":"generating"}`), `:411-418`(자동 client 리포트), `services/report_email_service.py:96-97`(회원/비회원 메일 신청 시 `content={}`), `tasks/report_task.py:504-505`(미승인 재생성 시 되돌림) |
| `pending_review` | 분석 성공, 상담사 승인 대기(= 승인 게이트) | `tasks/report_task.py:561-564`(`was_approved` 가 아니면 `pending_review`) |
| `completed` | 승인됨(`content.approved=True`, `sent_at` 설정) | `services/report_service.py:919-927` |
| `error` | 분석 실패. content 에 예외 메시지(`error`, `error_message`) 저장 | `tasks/report_task.py:583-591` |

- 별도 축 `generation_status`(pending/processing/ready/partial)는 승인과 독립(`models/record.py:219-226`). `sent` 같은 별도 status 값은 **없다**(발송 여부는 `sent_at`/`participant.report_email_sent_at`).
- 상태 문자열 정의는 프론트 계약과 일치: `frontend/src/lib/api/report-status.ts:12-31`.

### 1.2 최초 상태 — `pending_review` 가 최초 상태인가?

- **아니오.** 모든 생성 경로의 최초 상태는 `pending_analysis` (위 표). `pending_review` 는 `generate_report_inline` 이 성공한 뒤에만 도달(`tasks/report_task.py:564`).
- 생성 트리거: 세션 종료 후 Celery `tasks.generate_reports_for_session` 가 상담사 리포트 → 참가자별 client 리포트를 순차 생성(`tasks/report_task.py:725-726`). 상담사가 수동 `POST /reports/generate/{sid}`(`api/v1/reports.py:63-72`)로도 가능.
- **회원에게 "생성 중" 자리표시자가 보이는가?** 회원 목록은 행이 존재하면 상태 불문 반환하므로, `pending_analysis`(`content={"status":"generating"}`, `generation_status=processing`) 행도 목록에 나온다. 프론트 홈 카드는 `generation_status==='processing'` 일 때 "생성 중" 칩을 표시(`frontend/src/pages/client/ClientHomePage.tsx:414,439-443`) — 즉 **현행 UI 가 회원에게 생성 중 행을 노출하는 것을 전제**로 짜여 있다. 단, 상담사용 *합성* 행(`_synthesize_missing_report`, `report_service.py:479-524`)은 **회원에게는 없다**(회원 분기는 합성 없음: `:575` 주석).
- 승인 경로 4종: ① 단건 `POST /reports/{id}/approve`(`api/v1/reports.py:161-168` → `report_service.py:908-977`, 호스트 본인만 `:914-915`), ② 일괄 `POST /reports/approve-all`(`api/v1/reports.py:96-102` → `report_service.py:997-1012`, `Session.host_id==본인 & status=='pending_review'`), ③ 자동 승인: 호스트 `User.auto_approve_report`(기본 `False`: `models/user.py:109-111`) 가 켜진 경우 생성 직후 `approve_report` 호출(상담사 리포트 `report_service.py:343-354`, client 리포트 `:429-434`), ④ 재승인은 멱등(`:922`). 승인 시 `report_ready` 알림(`:929-947`), 메일 재예약(`:963-964`), AI 비서 훅(`:965-975`).
- **기본값이 `auto_approve_report=False`** 이므로, 자동 승인을 켜지 않은 상담사의 모든 회원 리포트는 승인 전까지 `pending_review` 상태로 **무기한** 머문다 → 회원이 보는 노출 구간이 길다. 자동 승인 상담사도 `generate_report_inline` 이 `pending_review` 를 먼저 **커밋**(`report_task.py:633`)한 뒤 `approve_report` 를 호출하므로 짧은 노출 창이 있다(`report_service.py:343-354`, `:429-434`).

---

## 2. 경로별 판정표 (회원 관점)

판정: EXPOSED = 회원이 `pending_*`/`error` 리포트 내용을 얻을 수 있음 / NOT EXPOSED / `미확인`.

| # | 경로 | 파일:줄 | 상태 필터 | 정확한 조건 | 판정 | 전제 조건 |
|---|---|---|---|---|---|---|
| 1 | **회원 리포트 목록** `GET /api/v1/reports` | `api/v1/reports.py:75-83` → `services/report_service.py:527-535, 574-585` | **없음** | 비-staff 분기: `FROM reports JOIN sessions WHERE Report.user_id == 본인` (`:584`). `status`·`type` 조건 없음. 응답에 `content` 전체(+`status`,`sent_at`,`generation_status`) 포함(`_serialize`: `:133-204`, `strip_timeline` 은 시계열만 제거 `:163-166`) | **EXPOSED** | 회원 계정 소유 리포트(`user_id` 설정). 비회원 리포트는 `user_id=None` 이라 해당 없음. 탈퇴·제거 참가자의 필터 적용 여부는 R6-X2(`미확인`) |
| 2 | **회원 리포트 상세** `GET /api/v1/reports/{id}` | `api/v1/reports.py:118-124` → `report_service.py:722-765` | **없음** | 접근 검사 = 호스트/같은 기관 org_admin/세션 참가자 행 존재(`_can_access_report` `:823-844`) + counselor 타입은 회원 403(`:732-733`) + client 타입은 소유자만(`:744-749`, RPT-IDOR-001). **status 검사 없음.** 추가로 열람 시 `is_read=True` 커밋(`:761-764`) | **EXPOSED** | 본인 리포트 + 세션 참가자 행 존재(제거/대기취소 행은 ORM 전역 필터로 제외 `core/database.py:16-44`, 실행 검증은 R6-X2 `미확인`) |
| 3 | 회원 홈 `GET /api/v1/client/home` 의 `recent_report` | `api/v1/client_portal.py:212, 254-270`, 스키마 `schemas/client.py:84-88` | **없음** | `Report.user_id == 본인` 최신 1건(`:257-262`) → `id`·`"MM월 DD일 리포트"` 제목·`created_at` 반환(본문 없음, 그러나 존재·시점 노출 + 상세 링크 id 제공) | **EXPOSED(메타데이터)** | — |
| 4 | 읽음 처리 `PUT /reports/read-all` | `api/v1/reports.py:86-93` → `report_service.py:980-994` | 없음 | 본인 소유 전부 `is_read=True`(미승인 포함). 내용 노출은 아니나 **승인 후 "NEW" 배지가 사라지는 부작용** | 부작용(내용 노출 아님) | — |
| 5 | 리포트 PDF 내려받기 `GET /reports/{id}/pdf` | `api/v1/reports.py:105-115` | `status != completed` → 409 (`:113-114`) | `require_roles("counselor","org_admin")` 로 **회원은 403**(`deps.py:75-86`). 테스트 `tests/test_sdd070_report_pdf.py:56-71` | NOT EXPOSED | — |
| 6 | 토큰 공개 열람 JSON `GET /reports/view?token=` | `api/v1/reports.py:28-35` → `services/report_email_service.py:290-325` | `Report.status == "completed"` (`:303`) | 토큰 type=`report_view`, `participant.report_email` 일치, `report_included` 확인(`:309-313`). 비완료 → report 조회 None → 403(`:305-310`) | NOT EXPOSED | 토큰은 7일 유효(`:23-26`), 발급 자체가 completed 이후에만 이뤄짐(경로 8) |
| 7 | 토큰 PDF `GET /reports/view/pdf?token=` | `api/v1/reports.py:38-41` | 위와 동일(`get_report_view_content` 재사용) | 동일 | NOT EXPOSED | — |
| 8 | 비회원 메일 발송/재발송 | `report_email_service.py:187-188`(deliver: `status != "completed"` → 미발송, 상태 문자열 반환), `:237-238`(resend: 비완료 409), `report_task.py:444-445`(예약만) | 있음(completed) | 토큰은 `deliver_report_email`(`:193`)·`resend_report_email`(`:254-259`) 에서만 발급 | NOT EXPOSED | 메일 신청 응답 `{"status":"pending_review","message":"상담사 승인 후 이메일로 발송됩니다"}`(`:121-122`)는 **상태 문구만**(내용 아님) |
| 9 | 메일 링크 HTML 뷰 `GET /sessions/{sid}/report-email/view?token=` | `api/v1/session.py:743-745` → `report_email_service.py:328-342` | `Report.status == "completed"` (`:336-337`) | 위와 동일 | NOT EXPOSED | — |
| 10 | 승인 알림 `report_ready` | `report_service.py:929-947` | 승인 시점에만 발화 | 중복 승인 시 재발송 안 함(`:930`) | NOT EXPOSED | — |
| 11 | 생성 실패 알림 `report_generation_failed` | `tasks/report_task.py:593-608` | 해당 없음(`error` 전이 시) | 소유자(`report.user_id`) = **회원**에게 "리포트 생성에 실패했습니다"+세션 제목 인앱 알림(인앱 기본 ON: `models/user.py:70`, 이메일 기본 OFF `:39`) | **부분 노출(상태 정보)** — 승인 전 내부 상태가 회원에게 전달됨 | 내용 노출은 아님. 제품 결정 필요(§5) |
| 12 | 세션 상세/목록에 리포트 포함 여부 | `schemas/session.py` 에 `Report` 임베드 없음(`report_email_status` 만, 호스트 뷰 `:146-147`); `services/session_service.py` 에 Report 조회 없음(grep) | — | — | NOT EXPOSED (임베드 없음) | 단, 프론트 `deriveDetailAction('done')` 가 "리포트 보기" CTA 를 **리포트 존재/승인 여부와 무관하게** 노출(`frontend/src/lib/class/enter-action.ts:25-26`)하고 모달이 경로 1·2 로 연결(§3) |
| 13 | 리포트 진행 REST `GET /sessions/{sid}/report-status` | `api/v1/records.py:72-84` → `record_service.py:223-231`(호스트 또는 참가자 허용 `:26-41`) → `report_progress_service.compute_report_progress` `:256-286` | 없음 | 응답에 `report_status`(세션 내 **모든** 리포트가 같은 값일 때 그 값, 아니면 null `:283`) 포함 → 회원이 `"pending_review"` 문자열을 볼 수 있음. 본문 없음 | **상태 문자열만 노출** | 회원 참가자. 필드 제거 여부는 결정 사항 |
| 14 | WebSocket `/record` `report:progress` | `ws/record_namespace.py:116-138`(호스트/참여자만 구독), `:153-185`(브로드캐스트) | 없음 | 동일 `report_status`·진행률. 본문 없음 | **상태 문자열만 노출** | 구독 권한 = 세션 호스트/참여자 |
| 15 | SSE | 코드베이스에 리포트용 SSE 없음 — `grep -rn "report" ws/` 는 위 `/record` 네임스페이스뿐 | — | — | 해당 없음(`미확인`: SSE 전체 grep 은 하지 않음, `ws/` 만 확인) | — |
| 16 | AI 비서 컨텍스트 | `services/agent_policy.py:160-187` | `type=client` + `status=completed` + 본인 | "승인 전 리포트가 결과에 들어올 수 없게" 쿼리 수준 필터(`:165-175`). 대화 시작 훅도 `completed` 만(`services/agent_report_chat.py:61-62`) | NOT EXPOSED | 테스트 `tests/test_agent_policy.py:51-58, 74-81` |
| 17 | AI 비서 `_report_facts_for`(상담사 브리핑) | `agent_policy.py:647-661` | 없음 | 상담사 채널 전용·본문 없이 `status` 라벨만(`:657-661`). 회원 채널 아님 | 해당 없음(회원 경로 아님) | — |
| 18 | 연구용/데이터 내보내기 | `services/export_service.py:49-60`(회원 `role` 은 `counselor`/`platform_admin` 만 허용 → 회원 403), `services/export_package.py:138-147`(`Report.status == 'completed'` 만 report.json 포함) | 있음 | 테스트 `tests/test_data_exports.py:230-254` (`pending_review` → `report_pending` 경고, report.json 제외) | NOT EXPOSED | `services/research_export_service.py` 는 `Report` 미참조(grep 0건, 연구 내보내기 별도 모듈) |
| 19 | 기관 활동 이력(org_admin) | `services/org_service.py:457-519` | 없음 | 메타데이터(제목·타입·status·created_at)만, **org_admin 전용**(`org.py` 라우터). 회원 경로 아님 | 해당 없음 | — |
| 20 | 상담사용 코멘트 저장/AI 초안 | `report_comment_service.py:46-67`(`pending_review` 에서만 수정 가능 `:52`) | 상담사 전용 | **간접 위험**: 상담사가 `pending_review` 중에 작성하는 `content.counselor_comment`(초안·수정본)가 경로 1·2 로 회원에게 보임. "승인 후 수정 비허용 — 발송 콘텐츠 확정 원칙"(`:51`)과 모순 | EXPOSED(경로 1·2 의 하위 효과) | — |

### 2.1 회원이 볼 수 있는 내용 (경로 1·2 의 응답 본문)

`ReportResponse`(`schemas/report.py:54-90`) → `status`, `generation_status`, `generation_error`, `data_credibility`, `content`(서사 헤드라인·요약·인사이트·EEG 지표·`counselor_comment`·그룹 세션이 아닐 때 `ai_record`(전사·요약) 등), `subjective_state`, `counselor_name` 등.
- `error` 상태일 땐 `content.error`/`error_message` 에 **예외 문자열 원문**이 그대로 저장돼 있어(`report_task.py:583-588`) 회원 응답에 포함된다 → 내부 오류 정보 노출(보조 위험).
- 그룹 세션의 client 리포트는 `ai_record` 를 의도적으로 제외(`report_task.py:556`). 즉 "다른 참가자 내용" 노출은 별도로 막혀 있으나 **승인 여부**는 막혀 있지 않다.
- `report_included=False` 참가자는 `client_excluded_content` 안내 스텁이 저장되고(`report_task.py:514-521`) 상태는 마찬가지로 `pending_review` 로 간다 → 스텁 자체가 회원에게 보인다(내용 위험은 낮음).

### 2.2 결과 근거의 강도

- 경로 1·2·3: **코드 + 기존 테스트로 확인**. `tests/test_mb2_high_severity_fixes.py:163-183`(`status="pending_review"` 리포트를 만들고 소유 회원 GET → **200** 단언)은 로컬 실행으로 **통과 확인**했다(§2.4). 즉 "승인 전 소유 회원 조회 200"이 현재 *의도된 계약처럼* 고정돼 있다.
- 목록(경로 1)은 `status` 필터 부재를 코드에서 확인(`:584`)했고, `tests/test_report_bulk_actions.py:89-108`이 `pending_review` 상태(자동 승인 OFF 기본값, `tests/test_report.py:284-298`과 동일 흐름)의 회원 리포트를 목록 `total>=1` 로 단언하나 해당 테스트는 **status 값 자체는 단언하지 않는다** → 목록 경로는 "코드 + 간접 테스트", 실호출 검증은 `미확인`(dev 호출 절차 §4.2 에 계획).
- 운영 DB 에서 실제로 `pending_review`/`pending_analysis`/`error` 상태의 회원 리포트가 몇 건인지, 몇 명이 열람했는지는 `미확인`(R6-X7, 조회 권한 없음·미수행).

### 2.3 이전에 이미 지적된 이력

- `specs/027-p1-eeg-rollup-raw-report/02-codex-integration-check.md:53,71,83` — "내담자 목록·상세 조회는 소유자 조건만으로 승인 전 content를 반환한다 … 완료된 승인본만 내담자에게 공개하며 …", "승인 전 노출 문제는 독립적으로 해결해야 한다", verify 에 "승인 전 조회 차단"을 구체화하라고 요구. 그러나 SDD-027 `summary.md:29-35` 와 `verify.md:14-15` 는 "pending_review = 승인 게이트"를 *발송·승인 전이* 로만 다루고 **회원 조회 차단은 구현·검증되지 않았다**(`grep` 로 summary/verify 에서 "조회 차단" 없음). → 권고가 반영되지 않은 채 남은 항목.
- SDD-118(`specs/118-client-report-list/spec.md:8`, `verify.md:11`)은 회원 목록 상태를 "sent_at 기준 **확인 가능/대기**"로 정의 — 즉 **"대기" 행을 회원에게 보이는 것이 SDD-118 의 의도된 설계**였던 것으로 읽힌다(승인 전 행이 목록에 있고 배지만 다름). 이 설계 의도가 *내용까지 열리는 것* 을 의도한 것인지는 문서상 `미확인`(문서에 명시 없음).

### 2.4 로컬 테스트 실행 결과 (외부 서비스 불요, `-p no:cacheprovider`)

```
backend/venv/bin/python -m pytest -p no:cacheprovider -q \
  tests/test_report_bulk_actions.py::test_mark_all_read \
  tests/test_mb2_high_severity_fixes.py::test_rpt_idor_client_리포트_타참여자_403 \
  tests/test_report.py::test_report_12_자동승인_OFF이면_기존_수동승인_상태_유지
→ 3 passed
```
- 의미: (a) `pending_review` 소유 회원 조회 200 이 현재 통과 = 노출이 코드 현실, (b) 자동 승인 OFF 면 `pending_review` 유지(생성 직후 `status=="pending_review"`, `sent_at is None`). 테스트 DB 는 SQLite(`tests/conftest.py:198-` create_engine) 라 PostgreSQL 고유 동작(부분 인덱스 등)은 검증 못 함.

---

## 3. 프론트엔드 (회원)

| 항목 | 위치 | 동작 | 보안 통제 여부 |
|---|---|---|---|
| 목록 호출 | `frontend/src/pages/client/ClientReportListPage.tsx:181-183` | `listReports({page,limit:20})`(검색 시 전체 `listReports()`) — status 파라미터/필터 **없음** | — |
| 상태 배지 | 같은 파일 `:30-43`, 사용처 `:227,279` | `sent_at` 유무만으로 "확인 가능"/"대기" 표시. **`status` 는 읽지 않음** | **아님**(표시용) |
| 행 클릭 | `:221,257-260,281-284` | `disabled={!report.id}` 외 제한 없음 → "대기" 행도 클릭하면 상세 모달 열림 → `getReport(id)`(`ClientReportDetailModal.tsx:38`) → 서버가 200 반환(경로 2) | **아님** |
| 요약/제목 | `:78-86` | `content.summary`/`headline` 을 목록 카드에 그대로 표시 | **아님** |
| NEW 배지 / 탭바 | `:230,270`, `stores/reportStore.ts:25-29`, `components/client/BottomTabBar.tsx:3,10` | `!is_read` 전체 카운트(미승인 포함) | 아님 |
| 홈 카드 | `pages/client/ClientHomePage.tsx:143,176-185,411-441` | `listReports()` 전체에서 `type==='client'` 최신 3건. 상태 필터 없음. `generation_status==='processing'` 이면 "생성 중" 칩 | 아님 |
| 완료 클래스 CTA | `lib/class/enter-action.ts:25-26`, `pages/client/ClientSessionDetailPage.tsx:119,161-162` | `done` 칩이면 항상 "리포트 보기" → 모달이 `listReports()` 에서 해당 세션의 client 리포트 id 를 찾아 열기(`ClientReportDetailModal.tsx:33-38`) → 승인 전에도 열림 | 아님 |
| 상세 뷰 PDF 버튼 | `components/reports/ClientReportViewer.tsx:136-160` | `pdf_url` 있으면 링크, 아니면 `sent_at` 있을 때만 "PDF 생성(준비 중)" 토스트. 승인 전엔 버튼 자체가 없음(우연한 UI 숨김) | 아님 |
| 프론트 테스트 | `frontend/tests/client-report-list.test.tsx:18,59-60` | 픽스처 `sent_at:null` 행이 "대기"로 표시되는 것을 단언 → 수정 시 의도 확인 필요 | — |

`resolveReportStatus`(`report-status.ts:50-57`)는 상담사 화면용 배지 계산이며 `status` 가 없으면 `sent_at` 으로 폴백하는 로직 → 회원 화면에서는 사용되지 않는다.
**결론: 프론트의 모든 "숨김/배지"는 표시 수준이며, 서버가 막지 않는 한 승인 전 리포트 내용은 회원 브라우저로 전달된다(네트워크 탭/직접 호출로 접근 가능).**

---

## 4. 기존 테스트 현황 (회원 가시성 × 상태)

### 4.1 승인 전 비노출을 **단언하는** 테스트 (회원 REST 외 경로)

| 테스트 | 파일:줄 | 단언 |
|---|---|---|
| AI 비서 컨텍스트에 본인 `pending_review` 리포트 제외 | `tests/test_agent_policy.py:51-58, 74-81, 98-100` | `PENDING_SECRET` 이 컨텍스트·프롬프트에 없음, 본인 승인 건 1건만 |
| 토큰 열람 JSON 이 `pending_review` 에서 403 | `tests/test_sdd052_report_view.py:102-107` | `/reports/view` 403 |
| 토큰 PDF 가 `pending_review` 에서 403 | `tests/test_sdd070_report_pdf.py:122-125` | `/reports/view/pdf` 403 |
| 호스트 PDF 가 `pending_review` 에서 409, 회원 403 | `tests/test_sdd070_report_pdf.py:56-68` | 409 / 403 |
| 메일 발송이 승인 전 미발송 | `tests/test_report_email.py:67-76`, `:36-45` | `deliver_report_email == "pending_review"`, 발송기 미호출, 신청 응답 `pending_review` |
| 재발송이 `pending_review` 에서 예외 | `tests/test_sdd050_report_resend_email.py:88-104` | `HTTPException` |
| 내보내기가 `pending_review` 에서 report.json 제외 | `tests/test_data_exports.py:230-254` | `report_pending` 경고 |
| 회원의 일괄 승인 403 | `tests/test_report_bulk_actions.py:83-86` | 403 |
| 승인 전이(상담사) | `tests/test_sdd027_rollup_raw_report.py:342-370`, `tests/test_report.py:284-298` | 생성 후 `pending_review`, 승인 후 `completed`, 분석 미완 승인 400 |

### 4.2 승인 전 **회원 REST 노출을 고정(허용)하는** 테스트 — 수정 시 함께 바꿔야 함

| 테스트 | 파일:줄 | 현재 단언 | 영향 |
|---|---|---|---|
| RPT-IDOR-001 | `tests/test_mb2_high_severity_fixes.py:135-183` | `status="pending_review"` 리포트의 소유 회원 `GET /reports/{id}` → **200**(`:178-179`), 타 참여자 → 403(`:182-183`) | 수정 시 `:178-179` 를 "승인 전 404(또는 정책값)"로 바꾸고, 소유자 200 단언은 `completed` 로 새로 만든 리포트로 이동. 403(타 참여자) 단언은 유지 |
| mark_all_read | `tests/test_report_bulk_actions.py:89-108` | 호스트가 `generate` 한 client 리포트(자동 승인 OFF → `pending_review`)가 회원 목록에 `total>=1` 로 나옴(`:106-107`) | 수정 시 승인 후 목록에서 확인하도록 순서 수정 |
| 목록 사용자 정보 | `tests/test_sdd065_report_list_user_info.py:87-102,108` | 호스트 목록, `completed` 시드 | 영향 없음 |
| 홈 집계 | `tests/test_mb2_test_quality_fixes.py:397-456` | `status="completed"` 시드 → `recent_report` 반환 | 영향 없음(이미 completed) |

### 4.3 **부재**(공백)인 것

- 회원 `GET /reports`(목록) 가 `pending_analysis`/`pending_review`/`error` 를 제외하는지에 대한 테스트: **없음**.
- 회원 `GET /reports/{id}` 가 승인 전 리포트를 거부하는지: **없음**(위 4.2 는 반대로 허용을 고정).
- `GET /client/home` `recent_report` 가 승인 전 리포트를 제외하는지: **없음**.
- `PUT /reports/read-all` 이 승인 전 리포트의 `is_read` 를 건드리지 않는지: **없음**.
- `report-status`/WS `report_status` 의 회원 노출 범위: **없음**(`tests/test_sdd095_report_progress.py` 는 `pending_review` 문자열이 있으나 진행 상태 계산 중심, 회원 시점 단언은 `미확인`).
- 프론트: 회원 목록이 승인 전 행을 어떻게 다루는지에 대한 계약 테스트는 "대기" 배지 *표시*만(`client-report-list.test.tsx:60`).

---

## 5. 노출이 확인되었으므로 — 최소 수정안 (계획만, 구현 아님)

### 5.1 어디서 거를까

| 지점 | 방식 | 근거/이유 |
|---|---|---|
| `list_reports` 회원 분기 `report_service.py:574-585` | **쿼리 수준**: `.filter(Report.status == "completed")` 추가 | `total`(count)·페이지네이션이 쿼리 기반(`:588-593`)이라 응답 수준 필터는 `total`/페이지 구멍을 만든다. 쿼리에 넣으면 총 건수·창이 정합. 상담사(staff) 분기는 건드리지 않는다 |
| `get_report` 회원 접근 `report_service.py:730-749` 뒤, `is_read` 마킹(`:761`) 앞 | **응답 수준(서비스 내 조기 거부)**: `viewer.role == "client"` 이고 `report.status != "completed"` 이면 **404**(존재 은닉) | 소유자 검사(`:744-749`)를 먼저 두어 *타 참여자 403 계약*(RPT-IDOR-001)을 유지하고, 소유자 + 미승인만 404. `is_read` 부작용을 막기 위해 반드시 마킹 이전에 거부 |
| `client_portal.py:257-262` (`recent_report`) | **쿼리 수준**: `Report.status == "completed"` 추가(+ `type == "client"` 권장) | 홈이 미승인 리포트의 존재·id 를 노출하지 않도록. 현재 `type` 필터도 없음(회원의 `user_id` 가 걸린 counselor 리포트가 있을 일은 없으나 방어) |
| `mark_all_read` `report_service.py:988-992` | `Report.status == "completed"` 추가 | 미승인 건이 "읽음"으로 처리돼 승인 후 NEW 가 사라지는 부작용 방지 |
| `compute_report_progress` 의 `report_status` (`report_progress_service.py:276-283`) | (선택) 회원 컨텍스트에서는 null 로 가리기 | 상태 문자열 노출 최소화. 호스트 UI 계약 변경 위험이 있으므로 사용자 결정/후순위. REST 경로는 `records.py:72-84`, WS 는 `ws/record_namespace.py:153-185` 로 공통 필드라 *호스트 전용 필드와 분리* 필요 |

모델/마이그레이션 변경 없음, 응답 스키마 변경 없음(필드 제거 없음). 롤백 = 코드 revert.

### 5.2 사용자에게 보이는 동작 변화

- 회원이 지금 보던 **승인 대기("대기" 배지) 행과 "생성 중" 행이 목록·홈에서 사라진다.** 영향 범위: 자동 승인을 **켜지 않은** 호스트(기본값 `False`, `models/user.py:109-111`)의 모든 회원 리포트가 승인 전까지(= 무기한). 켠 호스트의 회원은 거의 영향 없음(생성 직후 짧은 창만).
- 완료된 클래스 상세의 **"리포트 보기" CTA 는 남아 있는데**(`enter-action.ts:25-26`) 누르면 `listReports()` 에 행이 없어 "**리포트를 찾을 수 없습니다**"(`ClientReportDetailModal.tsx:37`) 오류가 뜬다 → UX 문구 결정 필요(예: "상담사 확인 후 전달돼요"/CTA 비활성).
- 하단 탭 NEW 카운트(`reportStore.ts:25-29`)는 자동으로 줄어든다(승인 건만 집계).
- `report_generation_failed` 인앱 알림(경로 11)은 그대로 갈 수 있어 알림에서 눌러 이동하면 404 → 알림 정책 결정 필요(회원에게 실패 알림을 보낼지).
- **건수 정량화**: 코드만으로 알 수 있는 것은 "대상 = `reports.type='client' AND user_id IS NOT NULL AND status <> 'completed'`" 라는 조건뿐. 실제 건수·영향받는 회원 수·열람 이력(`is_read=true AND status<>'completed'`)은 **`미확인`**(R6-X7, 운영 DB 미조회; M0 사전 조회 설계의 집계 쿼리 후보로만 제안 — 개인정보 컬럼 없이 `COUNT` 만).
- 레거시 데이터: SDD-027 마이그레이션이 기존 리포트를 `completed` 로 백필(`alembic/versions/b3d9e1f04277_sdd_027_eeg_rollup_raw_report.py:102-103`)하므로 `status='completed'` 필터로 *과거 승인분이 사라질* 위험은 낮다. 단 운영 DB 에 백필 이후 이상 상태 행이 있는지는 `미확인`.

### 5.3 비회원 토큰 링크 · 자동 승인과의 상호작용

- **비회원/토큰 경로는 이미 `completed` 만 허용**(경로 6-9)하므로 수정 불필요·영향 없음. 7일 토큰(`report_email_service.py:23-26`)은 승인 이후에만 발급(`:187-193`, `:237-259`)된다.
- **자동 승인**: 회원 쿼리 필터가 있으면 `generate_report_inline` 이 `pending_review` 를 커밋하는 순간(`report_task.py:633`)부터 `approve_report` 커밋까지의 노출 창이 닫힌다. 자동 승인 흐름 자체(`report_service.py:343-354, 429-434`)는 변경하지 않는다.
- **클래스 단위 일괄 승인(후속 Phase)**: 일괄 승인 게이트가 실제 *공개 게이트* 가 되려면 이 수정이 선행 조건. 승인 시 `report_ready` 알림(`:929-947`)과 메일 재예약(`:963-964`)은 그대로 이 시점이 "회원이 처음 보는 시점"이 된다. `approve_all_reports` 는 `Session.host_id==본인` 만 대상(`:1004-1008`)이라 클래스 강사 확장(R6-D1)은 별도 작업.
- 재생성: 미승인 리포트 재생성은 `pending_analysis` 로 되돌려 다시 숨겨진다(`report_task.py:504-505`); 승인본 재생성은 `completed` 유지(`:496,564`) → 회원 필터와 모순 없음.

### 5.4 바꾸면 안 되는 것

- 상담사/기관관리자 경로(`list_reports` staff 분기 `:547-573`, 합성 "생성 중/실패" 행 `:479-524`, `get_report` 호스트·org_admin, 승인·일괄 승인·자동 승인·코멘트 `pending_review` 한정 `report_comment_service.py:52`).
- RPT-IDOR-001: 타 참여자 → **403** 유지(소유자 검사가 status 검사보다 먼저).
- 토큰 뷰/PDF/메일/재발송/내보내기/AI 비서의 `completed` 필터(이미 올바름, 약화 금지).
- 승인 후 `is_read`/NEW 동작(승인 전 열람이 불가능해지므로 최초 열람 마킹이 승인 후로 자연 이동).
- 응답 스키마·필드 이름(앱/프론트 구버전 호환), 프론트의 상담사용 `resolveReportStatus`.
- 비회원 `user_id=None` 리포트의 소유 판정(`participant_id` 기반)과 7일 토큰 정책.
- `report_included=False` 참가자 스텁 리포트 처리(SDD-209 B3 필터) — 상태 필터와 직교.

### 5.5 사용자 결정이 필요한 항목 (비즈니스만)

1. 승인 전 회원 화면: **(A) 행 자체 숨김(권장 기본값)** vs (B) "승인 대기" 자리표시자 행을 보이되 본문 제거·열람 불가. B 는 SDD-118 의 "대기" 배지 의도와 가깝지만 응답 수준 마스킹(본문 `content` 제거, `id` 처리)이 필요해 구현·테스트 범위가 커진다. 기본값 A.
2. 완료 클래스의 "리포트 보기" CTA 를 승인 전에 어떻게 표시할지(비활성+문구 vs 현행 유지 후 안내).
3. `report_generation_failed` 인앱 알림을 회원에게 계속 보낼지(내용 노출은 아님, 상태 정보).

---

## 6. 검증 절차 (제안만 — 이번 조사에서 **실행하지 않음**)

### 6.1 백엔드 테스트 케이스 (구현 단계에서 추가 · verify.md 에 "구현 전 게이트"로 기재)

공통 픽스처(기존 재사용): `client`(TestClient, SQLite — `tests/conftest.py`), `create_test_counselor`/`_register(client, email, role)`(`tests/test_report.py:9-30`), `_create_session`, `_add_member_participant`(`tests/test_report_bulk_actions.py:45-58`), `Report(...)` 직접 시드(`tests/test_mb2_high_severity_fixes.py:163-173`). 권장 신규 파일: `tests/test_sdd211_member_report_visibility.py`.

| # | 테스트 이름(안) | 시드/Given | When | Then (단언) | 경로 |
|---|---|---|---|---|---|
| T1 | `test_member_list_excludes_non_completed` | 회원 M 의 client 리포트 4건: `pending_analysis`(content generating), `pending_review`, `error`(content.error 포함), `completed` | M 토큰 `GET /reports` | `total==1`, `reports[0].status=="completed"`, 응답 JSON 전체에 `pending`·`error` 본문 문자열 부재 | 1 |
| T2 | `test_member_list_pagination_total_matches` | `completed` 3 + `pending_review` 2, `limit=2` | 1·2페이지 호출 | `total==3`, 페이지 합 3건, 비승인 id 0건 | 1 |
| T3 | `test_member_detail_pending_review_404` | M 소유 `pending_review` | `GET /reports/{id}` | **404**, `is_read` 가 DB 에서 여전히 `False` | 2 |
| T4 | `test_member_detail_each_non_completed_status_404` | `pending_analysis`/`error` (parametrize) | 동일 | 404 | 2 |
| T5 | `test_member_detail_completed_200` | M 소유 `completed` | 동일 | 200, `is_read` True(기존 계약) | 2 |
| T6 | `test_member_detail_other_participant_still_403` | 동일 세션 A·B 의 `pending_review` 리포트 | A 가 B 의 리포트 조회 | **403**(404 아님) — RPT-IDOR-001 계약 유지 | 2 |
| T7 | `test_approve_makes_member_visible` | `pending_review` → 호스트 `POST /reports/{id}/approve` | 승인 전후로 회원 list/detail | 전: 숨김/404, 후: 200 + 목록 1건, `report_ready` 알림 1건 | 1,2,10 |
| T8 | `test_approve_all_makes_member_visible` | 회원 N명 `pending_review` | 호스트 `POST /reports/approve-all` | `approved==N`, 각 회원 detail 200 | 1,2 |
| T9 | `test_auto_approve_member_sees_completed_only` | 호스트 `auto_approve_report=True`, 세션 종료 파이프라인(`celery_eager`) | 회원 list/detail | `completed` 만 노출 | 1,2 |
| T10 | `test_client_home_recent_report_excludes_pending` | `pending_review` 1건만 보유 | `GET /client/home` | `recent_report is None`; completed 추가 시 그 건 id | 3 |
| T11 | `test_mark_all_read_skips_non_completed` | `pending_review` 1 + `completed` 1 (둘 다 `is_read=False`) | `PUT /reports/read-all` | `count==1`, pending 은 `is_read=False` 유지 | 4 |
| T12 | `test_member_cannot_download_pdf` | `completed` | M 토큰 `GET /reports/{id}/pdf` | 403 (회귀 고정) | 5 |
| T13 | `test_report_status_exposure_member` | 세션 `pending_review` 만 존재 | 회원 `GET /sessions/{sid}/report-status` | 현재 계약 문서화(문자열 노출 여부 `report_status`) — 결정에 따라 null 또는 유지 | 13 |
| T14 | `test_guest_token_pending_review_403` / `test_view_pdf_pending_403` | 기존 `tests/test_sdd052_report_view.py:102-107`, `test_sdd070_report_pdf.py:122-125` 재사용 | — | 회귀 유지(이미 통과) | 6,7 |
| T15 | `test_staff_paths_unchanged` | 호스트·org_admin | `GET /reports`(staff), `GET /reports/{id}` | `pending_review`·합성 행 모두 그대로 반환 | 회귀 |
| T16 | `test_regenerate_unapproved_hides_again` | `pending_review` 회원 리포트 → 선택 변경으로 재생성(`refresh_reports_after_choice_change`) | 재생성 중/후 | 비승인 상태 유지 시 계속 숨김, 승인본은 `completed` 유지 | 1,2 |

- 기존 테스트 수정(필수, 구현 PR 에서 함께): `tests/test_mb2_high_severity_fixes.py:177-183`(본인 200 → 승인 후로 이동, 타 참여자 403 유지), `tests/test_report_bulk_actions.py:89-108`(승인 후 목록 확인). **구현 후에도 단언을 완화하지 않는다**(verify 원칙).
- 프론트: `frontend/tests/client-report-list.test.tsx:18,59-60`, `client-report-modal.test.tsx`(오류 상태 `:110`)를 결정(5.5-①)에 맞춰 조정.

### 6.2 dev 환경 수동 호출 절차 (계획 — **실행 금지, 구현 후 별도 승인 하에**)

> **데이터 안전**: 운영(prod) 절대 금지. **dev 전용 테스트 계정·테스트 세션만** 사용한다. 실제 회원/상담사 데이터, 실제 이메일 수신자를 쓰지 않는다. 비밀번호·토큰은 문서/로그/셸 히스토리에 남기지 않는다(환경변수 이름만 사용). 생성한 세션·리포트는 테스트 후 dev 에서 식별 가능한 제목(`[SDD211-TEST]`)으로 두고 정리 절차는 별도 승인.

환경변수 이름(값은 작성하지 않음): `DEV_API_BASE`(예: `…/api/v1` 의 베이스), `DEV_COUNSELOR_EMAIL`, `DEV_COUNSELOR_PASSWORD`, `DEV_MEMBER_EMAIL`, `DEV_MEMBER_PASSWORD`.
로그인은 인증 라우터(`api/v1/auth.py`)의 JWT 발급 엔드포인트를 사용하며 정확한 경로·본문은 `미확인`(이 조사에서 `auth.py` 미열람 — 실행 시 확인). 아래 `$COUNSELOR_TOKEN`, `$MEMBER_TOKEN` 은 셸 변수로만 보관.

| 단계 | 호출 | 기대(수정 **전** 현행) | 기대(수정 **후**) |
|---|---|---|---|
| 1 | 상담사 로그인 → `$COUNSELOR_TOKEN`; 회원 로그인 → `$MEMBER_TOKEN` | 200 | 200 |
| 2 | 상담사: `POST $DEV_API_BASE/sessions` (type `meditation`/`clinical`, 제목 `[SDD211-TEST]`, 가까운 `scheduled_at`) → `session_id` | 201 | 201 |
| 3 | 회원: `POST $DEV_API_BASE/sessions/enter` (세션 `access_code`) → 참가자 행 생성 | 200 | 200 |
| 4 | 상담사: `POST …/sessions/{id}/start` 후 종료(`…/end` 등 — 정확한 종료 경로 `미확인`) 또는 파이프라인 대신 `POST $DEV_API_BASE/reports/generate/{session_id}` with `{"type":"client","participant_id":"<pid>"}` (상담사 자동 승인 OFF 확인: `GET /reports/auto-approve` → `enabled:false`) | 리포트 응답 `status:"pending_review"`, `sent_at:null` | 동일 |
| 5 | 회원: `GET $DEV_API_BASE/reports` | **해당 리포트가 포함됨(노출 재현)** | 미포함(`total` 에서 제외) |
| 6 | 회원: `GET $DEV_API_BASE/reports/{id}` | **200 + content 본문** | **404** |
| 7 | 회원: `GET $DEV_API_BASE/client/home` | `recent_report.id` 가 해당 리포트 | `recent_report: null`(또는 이전 승인 건) |
| 8 | 회원: `GET $DEV_API_BASE/reports/{id}/pdf` | 403 | 403 |
| 9 | 회원: `GET $DEV_API_BASE/sessions/{sid}/report-status` | 200, `report_status:"pending_review"` 문자열 노출 가능 | 결정에 따름(§5.1 선택 항목) |
| 10 | 상담사: `POST $DEV_API_BASE/reports/{id}/approve` | 200, `status:"completed"` | 동일 |
| 11 | 회원: 5·6 재호출 | 목록 포함, 200 | 목록 포함, 200, `is_read` 최초 열람 후 true |
| 12 | (비회원 경로 회귀) 별도 비회원 참가자 + 테스트용 수신 메일함으로 7일 토큰 링크 확인 — **승인 전에는 메일 미발송/링크 403, 승인 후에만 열림** | 일치 | 일치 |

- 각 응답은 **상태코드와 `status`/`total`/`id` 필드 유무만** 기록하고, 본문 전문(`content`)은 저장·공유하지 않는다(테스트 계정 데이터라도 개인정보 습관 유지).
- 수정 **전** 실행은 "노출 재현(5·6·7)"을 증거화하기 위한 것이며, 운영 환경 대상 금지·실계정 사용 금지. 실행 여부는 사용자 승인 필요(이번 Phase 0 spec/plan 단계에서는 *절차만* 기재).

---

## 7. 미확인 / 한계

- 운영 DB 의 비승인 상태 회원 리포트 건수·열람 이력·자동 승인 사용 비율 — `미확인`(R6-X7).
- `core/database.py:16-44` 전역 필터가 `list_reports` 회원 분기의 `JOIN Session`(hidden_at) 및 `get_report` 의 `SessionParticipant` 조회에 실제로 적용되는지 — 코드 해석상 적용되나 실행 검증 안 함(R6-X2). 제거된 참가자가 목록은 보이고 상세는 403 이 될 수 있는 불일치 가능성도 `미확인`.
- 목록 경로(1)의 "실제 HTTP 응답에 `pending_review` 행 포함"은 코드 읽기 + 간접 테스트로 판단했고, 직접 호출 검증은 수행하지 않음.
- 인증 로그인 엔드포인트의 정확한 경로·종료 경로 — 절차 §6.2 실행 시 확인 필요.
- SSE 전반(`ws/` 외) — 리포트와 무관한 것으로 보이나 전수 grep 은 `ws/` 에 한정.
- SDD-118 의 "대기" 배지가 *내용 열람까지* 허용하려던 의도였는지 — 문서상 명시 없음(`미확인`).
- 프런트엔드 앱(Capacitor android/ios 번들)이 동일 REST 를 쓰는지/구버전 앱이 수정 후 404 를 어떻게 표시하는지 — `미확인`(`frontend/android`, `ios` 존재만 확인).

---

## 개정 주석 (2026-10-18, plan §13·§13.1 반영)

이 메모는 **조사 시점(U1=A 가정)** 의 기록이다. 확정 결정 **U1=B**(행 유지 + `리뷰 중` 마스킹)로 아래 절의 *수정안·기대값*은 **plan.md TD5 와 verify.md RX 가 대체**한다.
- §5.1 "쿼리 수준 `status == completed` 필터 / 미승인 상세 404" → **폐기**. 대체: 행·총계 유지, 응답 직렬화에서 마스킹, 상세는 마스킹 200, `is_read` 미마킹.
- §5.2 "행이 사라진다"·"찾을 수 없습니다 오류" → **해당 없음**. 대체: `리뷰 중` 배지·소프트 페이지.
- §5.5 사용자 결정 1·2·3 → U1=B, U2 문구 확정(`리뷰 중이에요. 확인이 끝나면 알려드릴게요.`), U3 유지.
- §6.1 테스트 T1~T16 → verify RX-1~RX-22 로 재정의(T3·T4 의 404 기대값 폐기). §6.2 dev 수동 호출 표의 "수정 후" 기대값(404·미포함)도 폐기 — RX-1·RX-3·RX-10 이 기대값.
- §0·§2(노출 판정 20행)·§3(프론트)·§4(테스트 현황)의 **사실 관계**는 그대로 유효하다. 추가 확인: `_serialize` 의 최상위 지표 10개·`generation_error`·`pdf_url` 도 노출 대상이었고(`report_service.py:132-200`), `/client/home` 의 `recent_report` 는 프론트 소비처가 없으며 홈 카드는 `listReports()` 를 쓴다.
