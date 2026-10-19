# SDD-218 Plan — 클래스 리포트 관리와 회원 변화 추이

- 상태: Stage ② Plan
- 작성일: 2026-10-20
- 선행: SDD-217 커밋 `6ea5fec2` (워크트리 `-sdd217`, 클린). **develop 머지 전**
- 기준: 아래 계약은 217 워크트리의 실제 코드를 직접 읽고 작성했다. 추정이 아니다.
- 승인 완료: D-36 / D-37 / D-43 / P5-01 / P5-03 (spec.md 확정 기록)
- 미확정: **없음.** P5-02는 2026-10-20 §2 제안대로 확정됐다(spec.md 확정 기록).

---

## 1. 217이 제공하는 재사용 자산 (실측)

| 자산 | 위치 | 218에서의 용도 |
|---|---|---|
| 멱등 명령 실행기 | `services/class_member_commands.py::execute_member_command` | **일괄 작업의 건별 멱등 패턴 원형.** `operation_key` + `request_hash`(sha256) + `result` JSONB, 재실행 시 동일 결과 반환 / 해시 불일치 시 409 `operation_key_reused` |
| 명령 기록 테이블 | `ClassOperation`, `ClassMemberOperation` | 218 일괄 작업 기록 테이블의 설계 선례 |
| 출석 상태 | `attendance_status` ∈ `expected / attended / excused / withdrawn`, `attendance_kind` ∈ `regular / makeup` | R1 리포트 대상 판정, R4 출석 스트립 |
| 보강 연결 | `ClassMakeupAssignment` (source/target session·participant, status) | R4 보강↔원회차 연결, R1 "N회차 보강분" 배지 |
| 출석 변경 이력 | `ClassAttendanceEvent` (old/new status, actor, operation_key) | R4 합류 전/이탈 구간 판정 |
| canonical guest | `participant_dto.canonical_member_id`, `ClassGuestMerge` | D-43 비회원 본인 리포트 열람 자격(축소 금지) |
| 승인 컬럼 | `Report.approved_by_user_id` / `approved_at` (마이그레이션 055) | **그대로 재사용. 신설·backfill 금지** |
| 단건 승인 | `report_service.approve_report()` + `_enqueue_client_email_on_approval()` | 일괄 승인이 호출할 **단일 진입점** |
| 승인 메일 멱등 | `participant.report_email_sent_at is not None` → 재예약 안 함 | 중복 발송 방지가 이미 존재. 일괄 경로도 이 함수를 타야 한다 |
| 권한 판정 | `report_service._can_edit_report()` (`session.host_id == uid` + `validate_instructor`) | **D-36 대행 승인을 위해 확장 필요** (§2) |
| EEG 정규화 | `_normalize_eeg()` — `timeline: list`, `metrics` null 보존, `status: valid/not_measured`, `excluded` | **R4 전반→후반 델타의 유일한 원천은 `content.eeg.timeline`** |
| Alembic | head 1개 `e036a0000057` | 218은 **058** 하나만 추가 |

### 1.1 이미 존재하므로 신규 구현하지 않을 것
- 승인자/시각 컬럼, 단건 승인 API, `POST /reports/approve-all`, 회차 리포트 조회(`GET /classes/{class_id}/sessions/{session_id}/reports`), 승인 전 마스킹(`_mask_unapproved`), 메일 발송 큐(`report_email_service`), 강사별 `auto_approve_report` 설정 + API.
- 오래된 기획서의 "승인 컬럼 신설 / 전체 회차 리포트 조회 신규 구현" 기술은 **폐기**한다.

---

## 2. 설계 결정

### D-36 대행 승인 — `_can_edit_report` 확장
현재: `user.role == "counselor" and session.host_id == uid` (+ 정기형이면 `validate_instructor`).
변경: **승인 전용 판정 함수를 신설**하고 기존 `_can_edit_report`(편집용)는 건드리지 않는다.

```
can_approve_report(db, user, session) :=
    _can_edit_report(...)                      # 해당 회차 진행 지도사 (기존 의미 그대로)
 or is_current_lead_instructor(db, cls, user)  # 현재 주강사 대행 (신규)
```
- 편집(`update_report`, `require_report_host`)은 **지금 권한 그대로**. 승인만 넓힌다.
- `org_admin`·일반 보조 강사에게 부여하지 않는다.
- 대행 승인 시에도 `approved_by_user_id`에는 **실제 승인자**를 쓴다(주강사 본인 id). 대행 여부는 작업 기록에 남긴다.
- 실행 시점에 재검사한다(§3 2단계). 접수 시점 권한으로 실행하지 않는다.

### D-37 자동 승인 공통 안전 분리
`User.auto_approve_report`는 `role == "counselor"` 조건으로 `generate_client_reports_for_session`에서만 쓰인다.
- 이번 범위: 호출 지점에서 **세션 종류(명상 클래스 / 상담)를 구분하는 분기점만 도입**한다. 두 영역 모두 현재와 동일하게 동작시킨다(동작 변경 0).
- 상담 측 정책 변경·설정 UI 분리는 Phase 6. **이번에 상담 동작을 바꾸지 않는다.**

### P5-01 변화 델타의 원천
- 원천은 `content.eeg.timeline`뿐이다. `eeg.score`는 **사용 금지**(spec R5).
- `timeline`이 없거나 전/후 구간 표본이 기준 미달이면 **미산출**로 표시한다. 값을 만들지 않는다.
- `status == "not_measured"`, `excluded == True`, 미동의, 결석은 **각각 다른 표시**로 구분한다(0 치환 금지).
- 산출 결과는 `content.eeg.change`에 **가산**한다. 기존 키를 덮지 않는다.

### P5-02 비동기 일괄 작업 계약 (확정 제안)
```
POST   /api/v1/classes/{class_id}/report-jobs        → 202 {job_id, accepted, excluded[]}
GET    /api/v1/classes/{class_id}/report-jobs/{job_id} → 200 {status, items[]}
POST   /api/v1/classes/{class_id}/report-jobs/{job_id}/retry → 202 (실패 건만)
```
- 요청 본문: `{action: "approve"|"regenerate"|"resend_email", operation_key, targets: [report_id...]}`
- `items[]` 각 원소: `{report_id, member_name, state, reason_code, approved_by, processed_at}`
- `state` ∈ `succeeded / failed / excluded / pending`
  - **`failed`(재시도 가능)과 `excluded`(정책상 처리 제외)를 분리한다.** 시안 승인 사항.
  - `excluded` 사유: `absent`(결석), `consent_withdrawn`(실행 중 동의 철회), `not_target`(리포트 대상 아님), `forbidden`(실행 시 권한 상실)
- 기존 `POST /reports/approve-all`과 단건 `POST /reports/{id}/approve`의 **응답·의미는 변경하지 않는다.**

---

## 3. 일괄 작업 실행 모델

3단계로 분리한다. 각 단계는 시안 R2의 화면 단계와 1:1 대응한다.

| 단계 | 하는 일 | 실패 시 |
|---|---|---|
| ① 접수 | `operation_key` 중복 검사 → 작업 레코드 생성 → 202 반환 | 동일 key·동일 해시 = 기존 job_id 반환(멱등). 해시 불일치 = 409 |
| ② 대상 확정·권한 재검사 | 실행 시점에 `can_approve_report` 재평가, 결석·미대상·철회 건을 `excluded`로 확정 | 전건 제외여도 작업은 성공으로 종료 |
| ③ 건별 처리 | 건마다 독립 트랜잭션. `approve_report()` 단일 진입점 호출 | 해당 건만 `failed`. 다른 건에 영향 없음 |

**멱등 보장 지점**
- 승인: `approve_report`가 `report.approved_at or _now()` 패턴으로 이미 멱등.
- 메일: `participant.report_email_sent_at is not None` 가드가 이미 존재 → 재실행해도 중복 발송 없음.
- 알림·AI 비서 후속: 승인 전이(`status != completed → completed`)에서만 발화하도록 확인한다. 이미 완료된 건 재처리 시 무발화.
- 워커 재시도: 건별 처리 레코드에 `(job_id, report_id)` 유니크를 걸어 중복 처리 차단.

---

## 4. 파일 담당 표

단일 담당(Brian 세션 1개)으로 진행한다. 217과 충돌하는 파일은 **217 머지 후에만** 손댄다.

| # | 파일 | 변경 | 217 충돌 |
|---|---|---|---|
| BE-1 | `alembic/versions/e036a0000058_*.py` | 신규 — 일괄 작업 테이블 2종 | 없음(057 뒤) |
| BE-2 | `models/class_report_job.py` | 신규 — `ClassReportJob`, `ClassReportJobItem` | 없음 |
| BE-3 | `models/__init__.py` | 등록 2줄 | **있음** |
| BE-4 | `services/class_report_job_service.py` | 신규 — §3 3단계 실행기 | 없음 |
| BE-5 | `services/report_service.py` | `can_approve_report` 신설, `_can_edit_report` 불변 | **있음** |
| BE-6 | `services/class_report_trend_service.py` | 신규 — R4/R5 집계, timeline→change 산출, 3명 미만 숨김 | 없음 |
| BE-7 | `api/v1/class_reports.py` | 신규 — §2 P5-02 3개 경로 + 추이 조회 | 없음 |
| BE-8 | `api/v1/__init__.py` | 라우터 등록 | **있음** |
| BE-9 | `tasks/report_job_tasks.py` | 신규 — Celery 건별 처리 | 없음 |
| FE-1 | `components/class/structure/class-report-manage.tsx` | 신규 — R1 | 없음 |
| FE-2 | `components/class/structure/class-report-job.tsx` | 신규 — R2 | 없음 |
| FE-3 | `components/class/structure/member-class-trend.tsx` | 신규 — T1 | 없음 |
| FE-4 | `components/class/structure/class-session-summary.tsx` | 신규 — T2 | 없음 |
| FE-5 | `components/class/structure/class-team-reports.tsx` | 기존 탭에 R1 연결 | 없음 |
| FE-6 | `lib/api/class-reports.ts` | 신규 — 쿼리 훅 | 없음 |

신규 파일 위주라 217과의 실제 충돌면은 **3개 파일(등록 라인)**뿐이다.

---

## 5. 태스크 순서

> **T0 완료 전에는 BE-3/5/8을 수정하지 않는다.**

| # | 태스크 | 완료 조건 |
|---|---|---|
| T0 | 217 develop 머지 후 218 리베이스 | `git rebase origin/develop` 통과, `check-alembic-heads.py` 헤드 1개 |
| T1 | **verify.md 작성 → 승인** | 🚨 구현 전 필수 게이트 |
| T2 | BE-1·2 스키마 + 058 | PG 마이그레이션 up/down 스모크 |
| T3 | BE-5 `can_approve_report` | 진행 지도사·주강사·보조강사·org_admin·퇴사자 5케이스 테스트 (RED→GREEN) |
| T4 | BE-4·9 일괄 실행기 | 멱등·부분 실패·실행 중 철회·권한 상실 테스트 |
| T5 | BE-7 API | 202 응답, 기존 단건/approve-all 회귀 통과 |
| T6 | BE-6 추이 집계 | timeline 결손·미착용·미동의·결석 구분, 3명 미만 숨김, IDOR |
| T7 | D-37 공통 분리 | 명상·상담 양쪽 동작 변경 0 회귀 |
| T8 | FE-1~6 | 승인된 시안 대조, 4뷰포트 |
| T9 | 통합 검증 | 실 서버·실 PG 여정, N+1 쿼리 수 측정 |

---

## 6. 하지 않는 것

- 과거 자료 **백필 실행**. 설계만 한다(R6). 운영 백필은 별도 승인 건.
- 상담 Phase 6·7 기능, 새 리포트 유형, 개인 장기 기준선, 새 EEG/STT/LLM 엔진.
- 점수·순위·강사 비교·`eeg.score` 추이 사용.
- `_can_edit_report`의 편집 권한 확대, `org_admin` 열람 범위 확대.
- 217 코드의 218 워크트리 수동 복사.

---

## 7. 열린 위험

| 위험 | 대응 |
|---|---|
| 217이 develop 머지 전이라 T0 전까지 BE 구현 불가 | 문서·FE 시안·테스트 설계를 선행. T1 verify 작성은 지금 가능 |
| `content.eeg.timeline` 구조가 회차마다 불균일할 수 있음 | T6에서 실제 데이터 표본을 먼저 조사. 기준 미달이면 **미산출**로 떨어뜨린다 |
| 일괄 작업 중 대량 메일 큐 적체 | SDD-212 리포트 큐 분리와 간섭 여부를 T5에서 확인 |
| `_enqueue_client_email_on_approval`이 best-effort(예외 삼킴) | 일괄 경로에서는 예약 실패를 `items[].reason_code`로 노출해 사용자가 재시도할 수 있게 한다 |
